import fs from "node:fs";
import path from "node:path";

/**
 * APPEND_SYSTEM.md editing (W1.4, PRD "Settings → System Prompt").
 *
 * Pi reads APPEND_SYSTEM.md at session load only — edits apply to NEW or
 * RESTARTED sessions (same note as the AGENTS.md editor). The project file
 * `<workspace>/.pi/APPEND_SYSTEM.md` (trusted project) OVERRIDES the global
 * `<agentDir>/APPEND_SYSTEM.md` — it REPLACES the global additions, they are
 * NOT concatenated. UI copy must say so honestly.
 *
 * File access is confined exactly like agentsMd.ts: the renderer-supplied
 * workspaceId is a trust boundary.
 */

export function globalAppendFile(agentDir: string): string {
  return path.join(agentDir, "APPEND_SYSTEM.md");
}

export function resolveWorkspaceAppend(registeredWorkspaces: string[], workspaceId: string): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) {
    throw new Error("Unknown workspace");
  }
  const file = path.resolve(ws, ".pi", "APPEND_SYSTEM.md");
  // Belt-and-braces: the result must be exactly <workspace>/.pi/APPEND_SYSTEM.md.
  if (file !== path.join(ws, ".pi", "APPEND_SYSTEM.md") || path.dirname(path.dirname(file)) !== ws) {
    throw new Error("Path escapes workspace");
  }
  return file;
}

export function readAppend(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null; // missing file — no additions layer
  }
}

/** Blank content removes the file, so the layer stops applying (a workspace file
 *  overrides the global one even when empty — deleting is the honest "off"). */
export function writeAppend(file: string, content: string): void {
  if (!content.trim()) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}
