/**
 * HappyVibe skills bridge helpers (§14) — PURE module, zero non-node imports.
 * Lives next to the bridge (Pi's loader resolves it at runtime) and is imported
 * by vitest. Main writes the per-session manifest to HV_SKILLS_FILE; the bridge
 * reads it here to serve `use_skill`, detect raw SKILL.md reads, steer the model
 * toward use_skill, and report skill context weight.
 *
 * The manifest is the session's ACTUALLY-LOADED skills (main already resolved
 * approved ∩ enabled ∩ active-for-workspace and passed the same dirs as --skill),
 * so the bridge never re-derives trust — it only reflects what Pi loaded.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillManifestEntry {
  name: string;
  dir: string;
  skillMdPath: string;
  scope: "global" | "workspace";
  estTokens: { card: number; body: number };
}
export interface SkillManifest {
  skills: SkillManifestEntry[];
}

const EMPTY: SkillManifest = { skills: [] };

export function loadManifest(file: string | undefined = process.env.HV_SKILLS_FILE): SkillManifest {
  if (!file) return EMPTY;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SkillManifest;
    return Array.isArray(parsed?.skills) ? { skills: parsed.skills } : EMPTY;
  } catch {
    return EMPTY; // absent/corrupt — no skills this session
  }
}

export function findByName(m: SkillManifest, name: string): SkillManifestEntry | undefined {
  return m.skills.find((s) => s.name === name);
}

/** Input keys carrying file paths across Pi's built-in file tools (mirrors hv-rules PATH_KEYS). */
const PATH_KEYS = /^(path|file_?path|file)$/i;

/**
 * When a `read` targets an active skill's SKILL.md, return that skill — the
 * raw-read fallback (model loaded a skill without use_skill). Matches absolute
 * paths and paths relative to cwd.
 */
export function matchReadPath(
  m: SkillManifest,
  input: Record<string, unknown>,
  cwd: string,
): SkillManifestEntry | undefined {
  const args: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (PATH_KEYS.test(k) && typeof v === "string" && v) args.push(v);
  }
  for (const p of args) {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
    const hit = m.skills.find((s) => s.skillMdPath === p || s.skillMdPath === abs);
    if (hit) return hit;
  }
  return undefined;
}

/** Skill system-prompt weight per scope (chars/4 card estimate + count) for the context panel. */
export function skillTokenLines(m: SkillManifest): {
  global: { tokens: number; count: number };
  workspace: { tokens: number; count: number };
} {
  const acc = { global: { tokens: 0, count: 0 }, workspace: { tokens: 0, count: 0 } };
  for (const s of m.skills) {
    const bucket = s.scope === "workspace" ? acc.workspace : acc.global;
    bucket.tokens += s.estTokens?.card ?? 0;
    bucket.count += 1;
  }
  return acc;
}

/**
 * System guidance steering the model to use_skill (which carries a customer-
 * facing intent and cards distinctly) instead of a raw `read` of a SKILL.md.
 * Empty when no skills are loaded (nothing to steer).
 */
export function buildUseSkillGuidance(m: SkillManifest): string {
  if (m.skills.length === 0) return "";
  return (
    "\n\n<happyvibe-skills>\n" +
    "When a task matches an available skill, load it by calling the `use_skill` tool " +
    "with the skill's name and a short `intent` (what you're doing and why) — do NOT " +
    "read the SKILL.md file directly. use_skill returns the skill's full instructions.\n" +
    "</happyvibe-skills>"
  );
}
