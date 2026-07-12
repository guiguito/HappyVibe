/**
 * W2.3 nested AGENTS.md core — pure module in the hv-rules/hv-context style:
 * imported by the bridge at runtime AND directly by vitest, one implementation.
 *
 * Pi discovers AGENTS.md/CLAUDE.md UPWARD from cwd at session start ONLY
 * (verified: dist/core/resource-loader.js loadProjectContextFiles). Nested
 * (downward) AGENTS.md support per https://agents.md/ is built ENTIRELY here:
 * the bridge tracks file paths touched by file tools, resolves the NEAREST
 * AGENTS.md walking UP from each touched file's directory — stopping at the
 * session cwd EXCLUSIVE (the root file is already one of Pi's context files,
 * so it can never be duplicated as "nested") — and injects the discovered
 * files into each turn's system prompt (before_agent_start's return value is
 * a single-turn systemPrompt replacement, never persistent).
 *
 * fs access is injected (exists/read callbacks) so every function here is a
 * pure function of its inputs.
 */
import * as path from "node:path";

/** Built-in file tools whose input names a file path. Bash cwd heuristics are
 *  deliberately OUT of scope (W2.3) — file tools only. */
export const FILE_TOOLS = new Set(["read", "edit", "write"]);

/** Per-file injection cap. Oversized nested files are truncated with a note. */
export const NESTED_FILE_CAP = 8 * 1024;

/** Target file path from a file tool's input (Pi accepts `path` | `file_path`). */
export function toolFilePath(input: Record<string, unknown>): string | null {
  const p = input.path ?? input.file_path;
  return typeof p === "string" && p.trim() !== "" ? p : null;
}

/**
 * The NEAREST AGENTS.md walking UP from the touched file's directory, stopping
 * at `cwd` EXCLUSIVE — `<cwd>/AGENTS.md` is Pi's root context file, never
 * nested (structural dedupe vs the root). Files outside cwd (absolute paths
 * elsewhere, ".." escapes) yield null: nothing scoped to inject. `file` may be
 * relative (resolved against cwd, matching how Pi's tools treat it).
 */
export function nearestAgentsMd(file: string, cwd: string, exists: (p: string) => boolean): string | null {
  const root = path.resolve(cwd);
  let dir = path.dirname(path.resolve(root, file));
  while (dir !== root) {
    const rel = path.relative(root, dir);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null; // outside cwd
    const candidate = path.join(dir, "AGENTS.md");
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root — cannot happen inside cwd, belt and braces
    dir = parent;
  }
  return null;
}

/** One nested file as reported to the UI (hv.context-files notify + snapshot). */
export interface NestedFile {
  /** cwd-relative subtree dir the file scopes ("sub/pkg"). */
  dir: string;
  /** absolute file path. */
  path: string;
  chars: number;
}

/**
 * Stable (path-sorted) UI list. Content is re-read via `read` so `chars` is
 * current; files deleted since discovery drop out silently.
 */
export function nestedFileList(
  files: Iterable<string>,
  cwd: string,
  read: (p: string) => string | null,
): NestedFile[] {
  const root = path.resolve(cwd);
  const out: NestedFile[] = [];
  for (const p of [...files].sort()) {
    const content = read(p);
    if (content === null) continue;
    out.push({ dir: path.relative(root, path.dirname(p)) || ".", path: p, chars: content.length });
  }
  return out;
}

/**
 * The system-prompt suffix injected for ONE turn. Each file's content is
 * re-read at injection time (cheap, always current) and capped at
 * NESTED_FILE_CAP with a truncation note. Returns "" when nothing survives.
 */
export function renderNestedSection(
  files: Iterable<string>,
  cwd: string,
  read: (p: string) => string | null,
): string {
  const root = path.resolve(cwd);
  const blocks: string[] = [];
  for (const p of [...files].sort()) {
    let content = read(p);
    if (content === null) continue;
    let note = "";
    if (content.length > NESTED_FILE_CAP) {
      content = content.slice(0, NESTED_FILE_CAP);
      note = `\n\n[truncated at ${NESTED_FILE_CAP} chars]`;
    }
    const dir = path.relative(root, path.dirname(p)) || ".";
    blocks.push(`### ${dir}/AGENTS.md (applies to files under ${dir}/)\n\n${content.trimEnd()}${note}`);
  }
  if (blocks.length === 0) return "";
  return (
    "\n\n## Nested AGENTS.md (scoped instructions)\n\n" +
    "These AGENTS.md files live in subdirectories this session has touched. " +
    "Each applies to work under its own directory; the closest file takes precedence.\n\n" +
    blocks.join("\n\n")
  );
}
