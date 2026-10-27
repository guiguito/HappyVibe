/**
 * Round 29 (PRD §10): "Allow for session" lasts until the app quits.
 *
 * The bridge keeps grants in memory, so every respawn of a session (hibernation wake,
 * an MCP/skills/prompts/tools reload, a switch change) used to forget them. Main sees
 * each grant in the audit stream (`decision: "allow-session"`) and hands the list back
 * through HV_GRANTS at the next spawn of the SAME session id. A fork or duplicate is a
 * new id, so it never inherits; quitting the app ends them because this is memory.
 */
export class SessionGrants {
  private readonly bySession = new Map<string, Set<string>>();

  record(sessionId: string, permTool: string): void {
    let s = this.bySession.get(sessionId);
    if (!s) this.bySession.set(sessionId, (s = new Set()));
    s.add(permTool);
  }

  list(sessionId: string): string[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  /** An MCP configuration change can point a server name somewhere else: its grants go. */
  dropMcp(sessionId: string): void {
    const s = this.bySession.get(sessionId);
    if (s) for (const t of [...s]) if (t.startsWith("mcp:")) s.delete(t);
  }

  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
