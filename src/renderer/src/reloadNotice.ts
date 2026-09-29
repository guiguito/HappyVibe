/**
 * docs round #14 — the transcript notice when main respawns a session to apply
 * a config change (`hv:session-reloading`, ipc.ts reloadSession). One line per
 * ReloadReason; tests/mcp-reload-copy.test.ts derives the key set from that
 * type, so a new reason without its words fails there. Import-free: the
 * renderer and vitest both load it.
 */
const RESET = "permission grants and dangerous mode reset to safe defaults.";

export const RELOAD_NOTICE: Record<string, string> = {
  mcp: `Reloading to apply MCP server changes — ${RESET}`,
  skills: `Reloading to apply skill changes — ${RESET}`,
  promptTemplates: `Reloading to apply prompt changes — ${RESET}`,
  tools: `Reloading to apply built-in tool changes — ${RESET}`,
};

export function reloadNotice(reason: string): string {
  return RELOAD_NOTICE[reason] ?? `Reloading to apply your changes — ${RESET}`;
}
