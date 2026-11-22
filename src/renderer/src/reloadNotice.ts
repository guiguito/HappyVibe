/**
 * docs round #14 — the transcript notice when main respawns a session to apply
 * a config change (`hv:session-reloading`, ipc.ts reloadSession). One line per
 * ReloadReason; tests/mcp-reload-copy.test.ts derives the key set from that
 * type, so a new reason without its words fails there. Import-free: the
 * renderer and vitest both load it.
 *
 * Each line is SHORT: a notice is `max-w-md` and truncates (Transcript.tsx), so
 * the detail lives in its tooltip. And the detail is what the respawn really
 * does since round 29 (7): the session gets its "Allow for session" grants back
 * (an MCP change drops only the `mcp:` ones) and its persistent bypass again.
 * The line used to say "permission grants and dangerous mode reset to safe
 * defaults", which had become wrong both ways — and was cut off anyway.
 */
export const RELOAD_NOTICE: Record<string, string> = {
  mcp: "Reloading to apply MCP server changes",
  skills: "Reloading to apply skill changes",
  promptTemplates: "Reloading to apply prompt changes",
  tools: "Reloading to apply built-in tool changes",
  fileRewind: "Reloading to apply the Rewind setting",
};

export function reloadNotice(reason: string): string {
  return RELOAD_NOTICE[reason] ?? "Reloading to apply your changes";
}

/** The notice's tooltip: what carries over the restart. */
export function reloadNoticeTitle(reason: string): string {
  return (
    "The session restarts to pick up the change. Your conversation carries on, and your “Allow for session” answers still hold" +
    (reason === "mcp" ? ", except those for MCP tools." : ".")
  );
}
