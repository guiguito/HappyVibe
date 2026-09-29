import type { PendingEnvelope } from "./pendingPrompts";

/**
 * docs round #2 — the latest `hv.dangerous` notify per session, kept while it says ON.
 *
 * The red banner's only signal is that notify, and a notify is forwarded exactly once.
 * The bridge sends it at `session_start`, so a window that was not listening then (the
 * last one closed and reopened from the dock, a second window, ⌘R, a scheduled run that
 * started with none open) starts with no banner while the session runs without asking.
 * `hv:pending-ui-requests` replays it. Not a `PendingPrompts` entry: a notify is
 * fire-and-forget, so nothing would ever answer it and it must NEVER be answered.
 *
 * Pure and electron-free so vitest drives it directly.
 */
export class BypassNotices {
  private readonly bySession = new Map<string, PendingEnvelope>();

  /** Keeps an ON, forgets on OFF. Anything that is not an `hv.dangerous` `{on: boolean}` notify is ignored. */
  note(env: PendingEnvelope): void {
    if (env.method !== "notify") return;
    let p: { kind?: unknown; on?: unknown } | null = null;
    try {
      p = JSON.parse(env.message ?? "") as { kind?: unknown; on?: unknown } | null;
    } catch {
      return; // not JSON, so not ours
    }
    if (p?.kind !== "hv.dangerous" || typeof p.on !== "boolean") return;
    if (p.on) this.bySession.set(env.sessionId, env);
    else this.bySession.delete(env.sessionId);
  }

  /** The session exited (or is respawning): a fresh Pi announces its own bypass at session_start. */
  drop(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /** What a newly opened window replays. */
  list(): PendingEnvelope[] {
    return [...this.bySession.values()];
  }
}
