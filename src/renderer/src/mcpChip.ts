/**
 * §7 round 21 — the MCP chip's policy, pure so the no-DOM suite can pin it.
 *
 * The workspace filter is a BUG FIX riding along: the `+` menu's submenu this
 * chip replaces listed every configured server, including ones belonging to a
 * workspace this session has nothing to do with — so a session showed servers
 * it could not call.
 */

export interface McpRowLike {
  name: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  state: string;
}

/** Global servers, plus this workspace's own. Order preserved. */
export function serversForWorkspace<T extends McpRowLike>(all: T[], workspace: string | null): T[] {
  return all.filter((r) => r.scope === "global" || (workspace != null && r.workspaceId === workspace));
}

/**
 * `2/3 MCP` — the same connected-of-total shape the skills chip uses.
 *
 * Only `connected` counts. A server that is failing or needs auth is precisely
 * what this chip exists to surface, so folding either into the numerator would
 * hide the one thing worth glancing at.
 */
export function mcpChipLabel(rows: McpRowLike[]): string {
  const up = rows.filter((r) => r.state === "connected").length;
  return `${up}/${rows.length} MCP`;
}

/**
 * docs round #14 — the chip's tooltip. The number is main's own probe
 * (`hv:mcp-status`, app-wide), not this session's connection, so it says so,
 * in the words the MCP page uses for the same badge.
 */
export function mcpChipTitle(rows: McpRowLike[]): string {
  const up = rows.filter((r) => r.state === "connected").length;
  return `${up} of ${rows.length} MCP server${rows.length === 1 ? "" : "s"} answered HappyVibe's check`;
}
