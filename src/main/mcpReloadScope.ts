/**
 * Which live sessions an MCP config/auth change affects — PURE, electron-free,
 * vitest-importable. A global change (agentDir/mcp.json) touches every session;
 * a workspace change (<ws>/.mcp.json) touches only sessions in that workspace.
 * Workspace paths are compared trailing-slash-insensitively (matching the
 * WorkspaceRegistry's normalization) so "/ws" and "/ws/" never diverge.
 */

export interface ReloadSession {
  id: string;
  workspaceId: string;
}

const norm = (p: string): string => p.replace(/\/+$/, "") || "/";

export function affectedSessionIds(
  scope: "global" | "workspace",
  workspaceId: string | null,
  sessions: ReloadSession[],
): string[] {
  if (scope === "global") return sessions.map((s) => s.id);
  if (!workspaceId) return [];
  const target = norm(workspaceId);
  return sessions.filter((s) => norm(s.workspaceId) === target).map((s) => s.id);
}
