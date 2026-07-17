/**
 * W1.3 — per-session activity knowledge in MAIN, fed from the existing Pi
 * event stream (ipc.ts attach) plus the prompt/permission IPC handlers.
 *
 * Drives invisible auto-hibernation victim selection: a session is IDLE iff
 *   - not busy (prompt sent, agent_end not yet seen),
 *   - no pending permission prompt, and
 *   - no subagent running.
 * Electron-free and pure so vitest drives it directly.
 */

interface Activity {
  busy: boolean;
  pendingPrompts: number;
  subagents: number;
  /**
   * Detached (async) subagent runs still alive for this session, by runId. Unlike
   * `subagents` (foreground tool-call counter, zeroed on agent_end), these OUTLIVE
   * the turn, so they are tracked turn-independently: a live async run must keep
   * the session non-idle or a respawn (hibernation / MCP reload) would kill it.
   */
  asyncRuns: Set<string>;
  lastActivityAt: number;
}

export class SessionActivity {
  private map = new Map<string, Activity>();

  private rec(id: string): Activity {
    let a = this.map.get(id);
    if (!a) {
      a = { busy: false, pendingPrompts: 0, subagents: 0, asyncRuns: new Set(), lastActivityAt: Date.now() };
      this.map.set(id, a);
    }
    return a;
  }

  /** User sent a prompt — busy until agent_end. */
  prompted(id: string): void {
    const a = this.rec(id);
    a.busy = true;
    a.lastActivityAt = Date.now();
  }

  /** Feed every Pi event; keeps busy/subagent state + last-activity fresh. */
  event(id: string, e: { type?: unknown; toolName?: unknown }): void {
    const a = this.rec(id);
    a.lastActivityAt = Date.now();
    if (e.type === "agent_end") {
      a.busy = false;
      a.subagents = 0; // agent_end closes the turn — no dangling subagent counts
    } else if (e.type === "tool_execution_start" && e.toolName === "subagent") {
      a.subagents += 1;
    } else if (e.type === "tool_execution_end" && e.toolName === "subagent") {
      a.subagents = Math.max(0, a.subagents - 1);
    }
  }

  /** An hv.permission prompt is waiting on the user — protects from hibernation. */
  promptOpened(id: string): void {
    this.rec(id).pendingPrompts += 1;
  }

  promptClosed(id: string): void {
    const a = this.map.get(id);
    if (a) a.pendingPrompts = Math.max(0, a.pendingPrompts - 1);
  }

  /** A detached async subagent started (hv.subagent started). Idempotent. */
  asyncStarted(id: string, runId: string): void {
    const a = this.rec(id);
    a.asyncRuns.add(runId);
    a.lastActivityAt = Date.now();
  }

  /** A detached async subagent finished/interrupted (hv.subagent complete). */
  asyncEnded(id: string, runId: string): void {
    const a = this.map.get(id);
    if (a) a.asyncRuns.delete(runId);
  }

  /** Authoritative resync from /hv-subagent-list after a respawn. */
  asyncSet(id: string, runIds: string[]): void {
    this.rec(id).asyncRuns = new Set(runIds);
  }

  /** Session process exited — forget everything about it. */
  remove(id: string): void {
    this.map.delete(id);
  }

  isIdle(id: string): boolean {
    const a = this.map.get(id);
    return !a || (!a.busy && a.pendingPrompts === 0 && a.subagents === 0 && a.asyncRuns.size === 0);
  }

  /**
   * Oldest idle session among `liveIds` by last-activity timestamp — the
   * hibernation victim. Null when every live session is genuinely active.
   * Sessions we've never heard from sort first (lastActivityAt 0).
   */
  oldestIdle(liveIds: string[]): string | null {
    let best: string | null = null;
    let bestTs = Infinity;
    for (const id of liveIds) {
      if (!this.isIdle(id)) continue;
      const ts = this.map.get(id)?.lastActivityAt ?? 0;
      if (ts < bestTs) {
        bestTs = ts;
        best = id;
      }
    }
    return best;
  }
}
