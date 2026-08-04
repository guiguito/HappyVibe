import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

/**
 * Command (prompt template) discovery + content hashing (PRD §24) — PURE,
 * electron-free, vitest-importable. A near-clone of `../skills/discovery.ts`,
 * one axis simpler: a command is ONE `.md` file, so the approval key is a file
 * path rather than a directory. Main scans the locations Pi would load so the
 * user can review before a command is reachable, and hashes the file so an edit
 * flips an approved command back to needs-review.
 *
 * Verified against the pinned Pi 0.83.0 (`core/prompt-templates.js`), which is
 * why three skills concepts are absent rather than ported:
 *  - the directory walk: `loadTemplatesFromDir` is a FLAT `.md` readdir, so this
 *    scan is flat too. A `commands/git/commit.md` nesting is a Claude Code
 *    convention Pi does not read; discovering it would list a command that can
 *    never be invoked.
 *  - `scriptCount`: a command has no sibling files to execute. The equivalent
 *    risk signal is `hasBashInjection` — CC's inline `` !`cmd` `` is silently
 *    passed through as a literal by Pi, so the command degrades rather than runs.
 *  - `loadable`/`error`: Pi has no hard requirement to fail. A missing
 *    `description` falls back to the first body line (line 88-96), so EVERY
 *    readable `.md` loads and there is no error state to surface.
 *
 * `name` is likewise not a frontmatter key (line 85: `basename(filePath)` minus
 * `.md`) — renaming a command means renaming its file.
 */

export type PromptTemplateSource = "managed" | "workspace" | "linked" | "bundled";

export interface DiscoveredPromptTemplate {
  /** Absolute path to the `.md` file — the `--prompt-template` arg AND the approval key. */
  id: string;
  /** basename minus `.md` — Pi has no frontmatter `name` key. */
  name: string;
  /** frontmatter.description, else Pi's first-body-line fallback; "" for an empty file. */
  description: string;
  /** frontmatter["argument-hint"], the `/name <hint>` suffix the composer shows. */
  argumentHint?: string;
  source: PromptTemplateSource;
  /** sha256 over the file's bytes — approval key part 2. */
  hash: string;
  /** The template text Pi expands (frontmatter stripped) — the inspector body and the diff. */
  body: string;
  /** Body contains CC's inline bash injection, which Pi passes through literally. Risk pill, never a block. */
  hasBashInjection: boolean;
  /** chars/4 for the body, paid only when the command is invoked. No `card`: a command never enters the system prompt, so its resting cost is zero. */
  estTokens: { body: number };
}

/** Pi truncates a fallback description at this many chars, then appends "…" (`prompt-templates.js:92-95`). */
const DESC_MAX = 60;

/**
 * Minimal YAML frontmatter reader — only the two scalar keys Pi reads from a
 * prompt template (`description`, `argument-hint`); `allowed-tools` and anything
 * else is ignored, consistent with §14. Same regex approach as
 * `parseSkillFrontmatter`, plus the body, because the body is what Pi expands
 * and what the description falls back to.
 *
 * Newlines are normalized and the post-frontmatter body trimmed to match Pi's
 * own `utils/frontmatter.js` — otherwise our hash/diff/token count would
 * describe a slightly different string than the one Pi actually sends.
 */
export function parsePromptTemplateFrontmatter(content: string): { description?: string; argumentHint?: string; body: string } {
  const normalized = content.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---/.exec(normalized);
  if (!m) return { body: normalized }; // no frontmatter → the whole file is the body, untrimmed (Pi does the same)
  const out: { description?: string; argumentHint?: string; body: string } = { body: normalized.slice(m[0].length).trim() };
  // Real YAML, for the same reason as skills/discovery.ts parseSkillFrontmatter:
  // Pi's frontmatter reader IS yaml.parse, so a one-line `key: value` scan
  // disagrees with Pi on any multi-line scalar — and a long `description:` split
  // over several lines is exactly what real Claude Code commands ship.
  // Fails soft: malformed YAML leaves description/argumentHint unset, which is
  // the same degraded-not-broken outcome as a template with no frontmatter.
  let fm: unknown;
  try {
    fm = parseYaml(m[1]);
  } catch {
    return out;
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) return out;
  const rec = fm as Record<string, unknown>;
  if (typeof rec.description === "string") out.description = rec.description.trim();
  if (typeof rec["argument-hint"] === "string") out.argumentHint = rec["argument-hint"].trim();
  return out;
}

/**
 * Content hash of a command: sha256 over the file's raw bytes. Unlike a skill
 * there is no file list to fold in — the file IS the command, so a byte change
 * is the only thing that can invalidate an approval. Unreadable → a sentinel
 * that matches no approval record, so it reads as needs-review rather than
 * silently staying trusted.
 */
export function hashPromptTemplateFile(file: string): string {
  const h = createHash("sha256");
  try {
    h.update(fs.readFileSync(file));
  } catch {
    h.update("\0<unreadable>");
  }
  return h.digest("hex");
}

/** Parse one `.md` file into a DiscoveredPromptTemplate. */
export function readPromptTemplateFile(file: string, source: PromptTemplateSource): DiscoveredPromptTemplate {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    /* unreadable — an empty command, still listed so the user can see it exists */
  }
  const fm = parsePromptTemplateFrontmatter(raw);
  // Pi's fallback, verbatim: the first line with any non-whitespace, sliced (NOT
  // trimmed) at 60 chars with "..." only when it was actually cut.
  let description = (fm.description ?? "").trim();
  if (!description) {
    const firstLine = fm.body.split("\n").find((l) => l.trim());
    if (firstLine) description = firstLine.slice(0, DESC_MAX) + (firstLine.length > DESC_MAX ? "..." : "");
  }
  return {
    id: file,
    name: path.basename(file, ".md"),
    description,
    argumentHint: fm.argumentHint,
    source,
    hash: hashPromptTemplateFile(file),
    body: fm.body,
    hasBashInjection: fm.body.includes("!`"),
    estTokens: { body: Math.ceil(fm.body.length / 4) },
  };
}

/**
 * Scan a location for commands. Flat and non-recursive over `*.md`, matching
 * Pi's `loadTemplatesFromDir` — including its symlink handling (a symlink to a
 * file counts; a broken one is skipped). Dotfiles and `node_modules` are
 * skipped as elsewhere. Sorted by name so the UI order and the spawn arg order
 * are stable. A missing scan root yields [].
 */
export function scanPromptTemplatesDir(root: string, source: PromptTemplateSource): DiscoveredPromptTemplate[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredPromptTemplate[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || !e.name.endsWith(".md")) continue;
    const abs = path.join(root, e.name);
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        isFile = fs.statSync(abs).isFile();
      } catch {
        continue; // broken symlink
      }
    }
    if (isFile) out.push(readPromptTemplateFile(abs, source));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
