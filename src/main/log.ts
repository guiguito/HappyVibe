import { appendFile, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only JSONL event log. One log serves both the audit trail (B4) and
 * local analytics (B7).
 *
 * FROZEN ENVELOPE — every event has exactly this shape; new event types may
 * be added, existing envelope fields must never change meaning:
 *   ts          ISO 8601, written by the logger
 *   type        dot-namespaced, e.g. "session.start", "permission.decision"
 *   sessionId?  Pi session this event belongs to
 *   workspaceId? workspace this event belongs to
 *   data?       type-specific payload
 */
export interface LogEvent {
  ts: string;
  type: string;
  sessionId?: string;
  workspaceId?: string;
  data?: Record<string, unknown>;
}

// ponytail: JSONL over SQLite — no native-module ABI churn on Electron bumps;
// migrate if a workspace exceeds thousands of sessions (documented ceiling).
export class EventLog {
  // Serializes appends so concurrent writers can't interleave partial lines.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  append(event: Omit<LogEvent, "ts">): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    const next = this.queue.then(() => appendFile(this.file, line, "utf8"));
    this.queue = next.catch(() => {}); // one failed write must not wedge the queue
    return next;
  }

  /** Read all events, skipping corrupt lines (e.g. a torn final line after a crash). */
  async read(filter?: Partial<Pick<LogEvent, "type" | "sessionId" | "workspaceId">>): Promise<LogEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const events: LogEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as LogEvent;
        if (filter?.type && ev.type !== filter.type) continue;
        if (filter?.sessionId && ev.sessionId !== filter.sessionId) continue;
        if (filter?.workspaceId && ev.workspaceId !== filter.workspaceId) continue;
        events.push(ev);
      } catch {
        // skip garbage — crash resilience over strictness
      }
    }
    return events;
  }
}
