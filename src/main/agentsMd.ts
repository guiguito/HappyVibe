import fs from "node:fs";
import path from "node:path";

/**
 * AGENTS.md support (B2). Pi loads context files at session start (cwd upward,
 * plus the CLAUDE.md alias) — NOT live, hence the "applies to new or restarted
 * sessions" note in the UI.
 *
 * File access is STRICTLY confined to `<workspace>/AGENTS.md` for a registered
 * workspace: the renderer-supplied workspaceId is a trust boundary.
 */
function resolveWorkspaceFile(registeredWorkspaces: string[], workspaceId: string, name: string): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) {
    throw new Error("Unknown workspace");
  }
  const file = path.resolve(ws, name);
  // Belt-and-braces: the result must be exactly <workspace>/<name>.
  if (file !== path.join(ws, name) || path.dirname(file) !== ws) {
    throw new Error("Path escapes workspace");
  }
  return file;
}

export function resolveAgentsMd(registeredWorkspaces: string[], workspaceId: string): string {
  return resolveWorkspaceFile(registeredWorkspaces, workspaceId, "AGENTS.md");
}

// ── W2.3 missing-file flow: CLAUDE.md copy (same trust boundary) ────────────

export function hasClaudeMd(registeredWorkspaces: string[], workspaceId: string): boolean {
  return fs.existsSync(resolveWorkspaceFile(registeredWorkspaces, workspaceId, "CLAUDE.md"));
}

/**
 * Copies <workspace>/CLAUDE.md → <workspace>/AGENTS.md (explicit user action —
 * the ONE write this flow performs). Returns the copied content for the editor.
 */
export function copyClaudeMdToAgentsMd(registeredWorkspaces: string[], workspaceId: string): string {
  const content = fs.readFileSync(resolveWorkspaceFile(registeredWorkspaces, workspaceId, "CLAUDE.md"), "utf8");
  fs.writeFileSync(resolveAgentsMd(registeredWorkspaces, workspaceId), content, "utf8");
  return content;
}

export function readAgentsMd(registeredWorkspaces: string[], workspaceId: string): string | null {
  const file = resolveAgentsMd(registeredWorkspaces, workspaceId);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null; // missing file — UI offers "propose one"
  }
}

export function writeAgentsMd(registeredWorkspaces: string[], workspaceId: string, content: string): void {
  fs.writeFileSync(resolveAgentsMd(registeredWorkspaces, workspaceId), content, "utf8");
}

/**
 * WS5: resolve a NESTED AGENTS.md path confined to the workspace. Unlike
 * resolveWorkspaceFile (root only), this allows subdirectories but still
 * requires the file to stay inside the workspace and be named AGENTS.md.
 */
function resolveNestedAgentsMd(registeredWorkspaces: string[], workspaceId: string, relPath: string): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) throw new Error("Unknown workspace");
  if (path.basename(relPath) !== "AGENTS.md") throw new Error("Only AGENTS.md files may be written");
  const file = path.resolve(ws, relPath);
  const rel = path.relative(ws, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path escapes workspace");
  return file;
}

/**
 * WS5: write the agents-md-maker's structured draft — root + nested AGENTS.md —
 * each path-confined. Returns the workspace-relative paths written (for the
 * "Saved N files" notice + audit). The sub-agent never writes; the app does.
 */
export function writeAgentsMdFiles(
  registeredWorkspaces: string[],
  workspaceId: string,
  files: Record<string, string>,
): string[] {
  const written: string[] = [];
  const ws = path.resolve(workspaceId);
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolveNestedAgentsMd(registeredWorkspaces, workspaceId, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    written.push(path.relative(ws, abs));
  }
  return written;
}
