/**
 * Pure key function for the in-memory MCP status map.
 * Electron-free (vitest-importable).
 */
export function statusKey(
  scope: "global" | "workspace",
  workspaceId: string | null,
  name: string,
): string {
  return `${scope}:${workspaceId ?? ""}:${name}`;
}
