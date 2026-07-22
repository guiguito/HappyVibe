import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Skills discovery + content hashing (PRD §14) — PURE, electron-free,
 * vitest-importable. Main (not Pi) scans skill locations so skills become
 * visible/reviewable/gated; the same directories Pi would load, hashed so a
 * content change flips an approved skill back to needs-review.
 *
 * Discovery matches Pi's `core/skills.ts` semantics (verified against the pinned
 * 0.80.10): a directory containing SKILL.md is a skill root (not recursed
 * further); otherwise recurse into subdirectories to find SKILL.md. `name`
 * falls back to the parent directory name; a skill with NO description is not
 * loadable (Pi's one hard rule). We surface that as an `error` status rather
 * than silently dropping it, so the user sees why a skill isn't available.
 *
 * ponytail: loose root-level `.md` skills (Pi's `.pi/skills/*.md` shorthand)
 * are out of scope — every HappyVibe import/creation produces a SKILL.md dir,
 * the standard Agent Skills layout. Add if a real skill pack needs it.
 */

export type SkillSource = "managed" | "workspace" | "linked" | "bundled";

export interface DiscoveredSkill {
  /** Absolute path to the skill directory — the `--skill` arg AND the approval key. */
  id: string;
  /** frontmatter.name, or the directory basename when omitted (Pi's fallback). */
  name: string;
  /** frontmatter.description; "" when missing (→ loadable=false). */
  description: string;
  source: SkillSource;
  /** Absolute path to the SKILL.md file. */
  skillMdPath: string;
  /** sha256 over the skill dir's files (sorted rel path + bytes) — approval key part 2. */
  hash: string;
  /** Executable/script files in the skill dir — the "includes N scripts" risk flag. */
  scriptCount: number;
  /** Workspace-relative-to-skill-dir file list (SKILL.md first), for the inspector. */
  files: string[];
  /** hidden from the system prompt (frontmatter disable-model-invocation) — /skill: only. */
  disableModelInvocation: boolean;
  /** Token estimates (chars/4): `card` = name+description paid every turn; `body` = full SKILL.md, paid only when loaded. */
  estTokens: { card: number; body: number };
  /** Pi would load this at spawn (description present). */
  loadable: boolean;
  /** Why not loadable (e.g. "missing description"), else undefined. */
  error?: string;
}

/** Files whose presence makes a skill "includes N scripts" (executable risk surface). */
const SCRIPT_EXTS = new Set([".sh", ".js", ".mjs", ".cjs", ".ts", ".py", ".rb", ".pl", ".php", ".bash", ".zsh"]);

/**
 * Minimal YAML frontmatter reader — only the scalar keys skills use
 * (name, description, disable-model-invocation). Handles `key: value` with
 * optional single/double quotes; ignores everything else. ponytail: not a full
 * YAML parser — skill frontmatter is flat scalars per the Agent Skills spec.
 */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const out: { name?: string; description?: string; disableModelInvocation: boolean } = {
    disableModelInvocation: false,
  };
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
    else if (key === "disable-model-invocation") out.disableModelInvocation = val === "true";
  }
  return out;
}

/** All files under a dir, recursively, as paths relative to that dir (sorted). Skips .git/node_modules. */
function listSkillFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (e.isFile()) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort();
}

/**
 * Content hash of a skill dir: sha256 over each file's relative path + its
 * bytes, files in sorted order. Sensitive to content edits AND add/remove/rename
 * of any referenced file — a mismatch vs the approved hash means re-review.
 */
export function hashSkillDir(dir: string, relFiles: string[]): string {
  const h = createHash("sha256");
  for (const rel of relFiles) {
    h.update(rel);
    h.update("\0");
    try {
      h.update(fs.readFileSync(path.join(dir, rel)));
    } catch {
      h.update("\0<unreadable>");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

/** Parse one skill directory (must contain SKILL.md) into a DiscoveredSkill. */
export function readSkillDir(dir: string, source: SkillSource): DiscoveredSkill {
  const skillMdPath = path.join(dir, "SKILL.md");
  let raw = "";
  try {
    raw = fs.readFileSync(skillMdPath, "utf8");
  } catch {
    /* SKILL.md unreadable — reported below via loadable=false */
  }
  const fm = parseSkillFrontmatter(raw);
  const name = (fm.name && fm.name.trim()) || path.basename(dir);
  const description = (fm.description ?? "").trim();
  const files = listSkillFiles(dir);
  const scriptCount = files.filter((f) => SCRIPT_EXTS.has(path.extname(f).toLowerCase())).length;
  const loadable = description.length > 0;
  const cardChars = name.length + description.length;
  return {
    id: dir,
    name,
    description,
    source,
    skillMdPath,
    hash: hashSkillDir(dir, files),
    scriptCount,
    files,
    disableModelInvocation: fm.disableModelInvocation,
    estTokens: { card: Math.ceil(cardChars / 4), body: Math.ceil(raw.length / 4) },
    loadable,
    error: loadable ? undefined : raw ? "SKILL.md is missing a description (Pi will not load it)" : "SKILL.md not found or unreadable",
  };
}

/**
 * Scan a location for skills. Matches Pi discovery: a dir with SKILL.md is a
 * skill root (no deeper recursion); otherwise recurse to find SKILL.md dirs.
 * Returns skills keyed by absolute dir path; a missing scan root yields [].
 */
export function scanSkillsDir(root: string, source: SkillSource, maxDepth = 6): DiscoveredSkill[] {
  const out: DiscoveredSkill[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === "SKILL.md" && (e.isFile() || e.isSymbolicLink()))) {
      out.push(readSkillDir(dir, source));
      return; // skill root — do not recurse further
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}
