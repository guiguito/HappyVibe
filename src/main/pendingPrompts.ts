/**
 * §35 — the blocking ui-requests main has forwarded and nobody has answered yet.
 *
 * Before this, main kept only COUNTS and broadcast each envelope exactly once.
 * That was fine while every prompt was raised by a session a human had just
 * typed into, and wrong the moment a SCHEDULE could raise one: a Full run
 * hitting `ask` at 3 a.m. with every window closed sent its modal to nobody,
 * and the window opened at 9 never learned the prompt existed. The badge said
 * 1 forever, the run waited forever (prompts never time out, by design), and
 * nothing on screen explained either. Retaining the envelope is what lets a
 * window ask for what is outstanding when it opens.
 *
 * Only BLOCKING methods are kept, which is the reason main had two maps before:
 * `uiOwners` holds every ui-request including notifies, and a notify is
 * fire-and-forget, so nothing ever deletes it. Counting that map made the
 * sidebar's attention badge climb with every transcript card a session ever
 * drew. Keeping those for replay would be the same bug with a bigger appetite.
 *
 * Pure and electron-free so vitest drives it directly.
 */
export interface PendingEnvelope {
  id: string;
  sessionId: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
}

export class PendingPrompts {
  /** Insertion-ordered, so a replay arrives in the order the agent asked. */
  private readonly map = new Map<string, PendingEnvelope>();

  constructor(private readonly blocking: ReadonlySet<string>) {}

  /** Returns whether anything was retained (i.e. whether the counts moved). */
  note(env: PendingEnvelope): boolean {
    if (!this.blocking.has(env.method)) return false;
    this.map.set(env.id, env);
    return true;
  }

  /** Answered, cancelled or dropped. Returns whether it was actually outstanding. */
  clear(id: string): boolean {
    return this.map.delete(id);
  }

  /** A session crashed or exited: its prompts can never be answered now. */
  dropSession(sessionId: string): boolean {
    let dropped = false;
    for (const [id, e] of this.map) {
      if (e.sessionId === sessionId) {
        this.map.delete(id);
        dropped = true;
      }
    }
    return dropped;
  }

  /** sessionId → how many prompts it is waiting on. The `hv:pending-changed` payload. */
  counts(exclude?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.map.values()) {
      if (e.sessionId === exclude) continue;
      out[e.sessionId] = (out[e.sessionId] ?? 0) + 1;
    }
    return out;
  }

  /** Everything outstanding, oldest first — what a newly opened window replays. */
  list(): PendingEnvelope[] {
    return [...this.map.values()];
  }
}
