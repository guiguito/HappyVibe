import fs from "node:fs";
import path from "node:path";
import { editAgentFile, parseAgentFile, serializeAgentFile, duplicateName } from "../../pi-runtime/extensions/hv-agents";

/**
 * Agent management (B6) — path-confined fs, mirroring agentsMd.ts.
 *
 * Edits/duplicates are confined to `*.md` files directly inside an ALLOWED
 * agent dir: the app-owned built-in dir, or a root's `.pi/agents` or
 * `.agents/agents`, the three folders tintinweb discovers. The renderer-supplied
 * path is a trust boundary — we resolve it and refuse anything that escapes an
 * allowed dir.
 */

/**
 * Allowed dirs: the app built-in dir, plus every admitted root's `.pi/agents` and
 * `.agents/agents`. docs-round #8: the list showed `.agents/agents` agents as
 * "project", and Duplicate/Edit refused them. The app already writes `.agents/plans`.
 */
export function allowedAgentDirs(builtinDir: string, roots: string[]): string[] {
  return [
    path.resolve(builtinDir),
    ...roots.flatMap((w) => [path.resolve(w, ".pi", "agents"), path.resolve(w, ".agents", "agents")]),
  ];
}

/** Resolve + confine an agent file path to a `<allowedDir>/<name>.md`. Throws otherwise. */
export function confineAgentPath(allowedDirs: string[], filePath: string): string {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!resolved.endsWith(".md") || resolved.endsWith(".chain.md")) {
    throw new Error("Not an agent file");
  }
  if (!allowedDirs.some((d) => path.resolve(d) === dir)) {
    throw new Error("Path escapes agent directories");
  }
  return resolved;
}

export function readAgentBody(allowedDirs: string[], filePath: string): { body: string; model?: string } {
  const file = confineAgentPath(allowedDirs, filePath);
  const { frontmatter, body } = parseAgentFile(fs.readFileSync(file, "utf8"));
  return { body, model: frontmatter.model || undefined };
}

/** Edit the system-prompt body and/or agent-tier model of an existing agent file. */
export function writeAgentEdit(
  allowedDirs: string[],
  filePath: string,
  edit: { body?: string; model?: string | null },
): void {
  const file = confineAgentPath(allowedDirs, filePath);
  fs.writeFileSync(file, editAgentFile(fs.readFileSync(file, "utf8"), edit), "utf8");
}

/**
 * Duplicate an agent (PRD: duplicate-only, no create-from-scratch). Copies the
 * source into the SAME dir under a fresh unique name, rewriting frontmatter
 * `name:` to match. Returns the new file path.
 */
export function duplicateAgent(allowedDirs: string[], filePath: string): string {
  const src = confineAgentPath(allowedDirs, filePath);
  const dir = path.dirname(src);
  const { frontmatter, body } = parseAgentFile(fs.readFileSync(src, "utf8"));
  const existing = new Set(
    fs.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")),
  );
  const newName = duplicateName(frontmatter.name || path.basename(src, ".md"), existing);
  // The name comes from the file's own frontmatter (free text, and a repo can supply it), so
  // the copy's path is confined too: a `/` or `..` in it would land outside the agent folders.
  const target = confineAgentPath(allowedDirs, path.join(dir, `${newName}.md`));
  // `x/../fine` collapses to a sibling file inside the same folder and passes the confinement above.
  if (path.basename(target, ".md") !== newName) throw new Error("Agent name can't contain a path");
  // "wx": never overwrite (also covers case-insensitive filesystems).
  fs.writeFileSync(target, serializeAgentFile({ ...frontmatter, name: newName }, body), { encoding: "utf8", flag: "wx" });
  return target;
}
