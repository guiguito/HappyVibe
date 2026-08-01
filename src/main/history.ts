/**
 * Pre-compaction history, read from Pi's own session file. PURE + electron-free
 * so vitest can drive it (tests/history.test.ts).
 *
 * WHY the file and not an RPC: `get_messages` returns the LIVE context, so
 * everything compaction dropped is gone from it — the same reason the cost
 * ledger reads the file (calls.ts). The file keeps every entry.
 *
 * WHERE the boundary is: Pi writes a `compaction` entry carrying
 * `firstKeptEntryId`, and its own context rule (session-manager.js
 * buildContextEntries) is `[latest compaction] + entries from firstKeptEntryId
 * onward`. So the "earlier" region is exactly the leaf-path entries BEFORE
 * firstKeptEntryId of the LAST compaction. That is Pi's rule read back, not a
 * heuristic — and only the last compaction matters, because Pi ignores the
 * others.
 *
 * The in-context half is NOT rebuilt here: ipc.ts keeps taking it from
 * `get_messages`, which is already post-filter for §9 removals.
 */

import { restoreItems, type RawMessage, type RestoreItem } from "./restore";
import { filterMessages, type AgentMessage, type MarkKey } from "../../pi-runtime/extensions/hv-context";

/** The bridge's marks entry type (happyvibe-bridge.ts CONTEXT_MARKS_TYPE). */
const CONTEXT_MARKS_TYPE = "hv-context-marks";

export interface FileEntry {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: RawMessage & { timestamp?: number };
  /** compaction only — the first entry Pi KEPT in live context. */
  firstKeptEntryId?: string;
  /** custom only. */
  customType?: string;
  data?: unknown;
}

export interface CompactionInfo {
  /** How many compactions are on the leaf path (only the last one bounds context). */
  count: number;
  firstKeptEntryId: string;
}

/**
 * Parse the session JSONL. Tolerant by design: the file is appended live, so the
 * last line can be torn mid-write — a bad line is skipped, never thrown (same
 * contract as EventLog.read and parseCalls).
 */
export function parseEntries(jsonl: string | null | undefined): FileEntry[] {
  if (!jsonl) return [];
  const out: FileEntry[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const e = JSON.parse(raw) as FileEntry;
      if (e && typeof e.id === "string" && typeof e.type === "string") out.push(e);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The active branch: walk `parentId` from the last entry back to the root, then
 * reverse. HappyVibe never forks (§9 removal is mark-based, non-destructive), so
 * in practice the file is linear — but the walk is the same few lines and stays
 * correct if a branch ever appears.
 */
export function leafPath(entries: FileEntry[]): FileEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path: FileEntry[] = [];
  const seen = new Set<string>(); // cycle guard — a malformed file must not hang
  let cur: FileEntry | undefined = entries[entries.length - 1];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

/** The LAST compaction on the path (the only one that bounds context), + a count. */
export function latestCompaction(path: FileEntry[]): CompactionInfo | null {
  let count = 0;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type !== "compaction") continue;
    count += 1;
    if (typeof e.firstKeptEntryId === "string") firstKeptEntryId = e.firstKeptEntryId;
  }
  return count > 0 && firstKeptEntryId ? { count, firstKeptEntryId } : null;
}

/** Newest `hv-context-marks` entry wins — it is a full snapshot of the kill-set. */
function marksOn(path: FileEntry[]): Set<MarkKey> {
  let marks = new Set<MarkKey>();
  for (const e of path) {
    if ((e.type === "custom" || e.type === "custom_message") && e.customType === CONTEXT_MARKS_TYPE) {
      const m = (e.data as { marks?: MarkKey[] } | undefined)?.marks;
      if (Array.isArray(m)) marks = new Set(m);
    }
  }
  return marks;
}

/**
 * The pre-compaction transcript, for DISPLAY only. Empty when the session was
 * never compacted (nothing is missing, so there is nothing to load).
 *
 * Plan cards are dropped: the loaded region is explicitly marked as outside the
 * agent's context, and a PlanCard carries a live Implement button — a plan
 * that lands here is reached from the active-plan pill instead (§23).
 */
export function earlierItems(jsonl: string | null | undefined): RestoreItem[] {
  const path = leafPath(parseEntries(jsonl));
  const compaction = latestCompaction(path);
  if (!compaction) return [];
  const cut = path.findIndex((e) => e.id === compaction.firstKeptEntryId);
  if (cut < 0) return []; // firstKeptEntryId off-path — show nothing rather than guess
  const messages = path
    .slice(0, cut)
    .filter((e) => e.type === "message" && e.message)
    .map((e) => e.message as unknown as AgentMessage);
  const kept = filterMessages(messages, marksOn(path)) as unknown as RawMessage[];
  return restoreItems(kept).filter((it) => it.kind !== "plan");
}

/**
 * Is this session compacted, and how often? Scans lines rather than parsing all
 * of them — this runs on every session open, while earlierItems runs only when
 * the user asks for the history.
 */
export function compactionInfo(jsonl: string | null | undefined): CompactionInfo | null {
  if (!jsonl) return null;
  const lines = jsonl.split("\n").filter((l) => l.includes('"type":"compaction"'));
  if (lines.length === 0) return null;
  return latestCompaction(parseEntries(lines.join("\n")));
}

/**
 * The reason a compaction happened, from our own audit log. NOT in the session
 * file: Pi's `compaction` entry has no `reason` field — only the live
 * `compaction_end` event does, so main logs it (`context.compact`) and we join
 * back on `firstKeptEntryId`.
 *
 * `events` are the session's `context.compact` rows, already filtered by
 * EventLog.read({ type, sessionId }).
 *
 * ponytail: last match wins. Two compactions CAN share a firstKeptEntryId (seen
 * in a real session: entries 491 and 492 both pointed at 418), which makes the
 * join ambiguous; the newer reason is the better answer and the case is
 * cosmetic. Upgrade path = log the compaction entry id, once Pi exposes it on
 * the event.
 *
 * Null for any session compacted before this shipped — the bubble then simply
 * omits the reason rather than inventing one.
 */
export function compactionReason(
  events: { data?: Record<string, unknown> }[],
  firstKeptEntryId: string,
): string | null {
  let reason: string | null = null;
  for (const e of events) {
    if (e.data?.firstKeptEntryId !== firstKeptEntryId) continue;
    if (typeof e.data?.reason === "string") reason = e.data.reason;
  }
  return reason;
}
