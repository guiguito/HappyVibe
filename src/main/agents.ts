import fs from "node:fs";
import path from "node:path";
import { editAgentFile, parseAgentFile, serializeAgentFile, duplicateName } from "../../pi-runtime/extensions/hv-agents";

/**
 * Agent management (B6) — path-confined fs, mirroring agentsMd.ts.
 *
 * Edits/duplicates are confined to `*.md` files directly inside an ALLOWED
 * agent dir: the app-owned built-in dir, or a registered workspace's
 * `.pi/agents`. The renderer-supplied path is a trust boundary — we resolve it
 * and refuse anything that escapes an allowed dir.
 */

/** Allowed dirs: the app built-in dir + every registered workspace's .pi/agents. */
export function allowedAgentDirs(builtinDir: string, registeredWorkspaces: string[]): string[] {
  return [
    path.resolve(builtinDir),
    ...registeredWorkspaces.map((w) => path.resolve(w, ".pi", "agents")),
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
  const target = path.join(dir, `${newName}.md`);
  fs.writeFileSync(target, serializeAgentFile({ ...frontmatter, name: newName }, body), "utf8");
  return target;
}
