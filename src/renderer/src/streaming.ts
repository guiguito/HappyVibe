/**
 * Perf: streaming hot-path helpers, kept pure so the reducer + tool-index logic
 * are unit-tested without React (tests/streaming.test.ts).
 *
 * The old text_delta path copied the whole transcript array per token AND made
 * Transcript re-parse every message's markdown each delta — O(n²) per turn.
 * Now the in-progress assistant text lives OUTSIDE the transcript array (a live
 * bubble), deltas coalesce to one update per frame, and committed messages get
 * a stable id so React.memo skips re-parsing them.
 */

import type { TranscriptItem } from "./components/Transcript";

// ── in-progress streaming buffer (per session, outside `transcripts`) ─────────

export type StreamBuffers = Record<string, string>;

/**
 * Apply a text delta to the per-session streaming buffer. `active` is whether a
 * stream is already open for this session (mirrors the old `streaming.current`
 * flag): when open we append, otherwise we start a fresh bubble. Returns the new
 * buffer text — the caller decides how to store it.
 */
export function applyDelta(buffers: StreamBuffers, sid: string, delta: string, active: boolean): string {
  return active ? (buffers[sid] ?? "") + delta : delta;
}

/**
 * Round 11: append `text` to the trailing assistant bubble, or push a new one
 * when the transcript does not end in one.
 *
 * Stop closes the streaming bubble synchronously, but the abort still has to
 * travel renderer → main → child stdin, so deltas already in flight arrive
 * afterwards. Through `applyDelta` they would read as `active === false` and
 * start a SECOND bubble mid-sentence — the reported "words cut to a new line".
 * Only the abort window routes here; the bubble break at `tool_execution_start`
 * is intentional and must keep working.
 */
export function mergeIntoLastAssistant(items: TranscriptItem[], text: string): TranscriptItem[] {
  if (!text) return items;
  const last = items[items.length - 1];
  if (last?.kind === "assistant") {
    const next = items.slice(0, -1);
    next.push({ ...last, text: (last.text ?? "") + text });
    return next;
  }
  return [...items, { kind: "assistant", text } as TranscriptItem];
}

// ── tool-card index (avoid re-scanning the whole transcript per update) ───────

/**
 * Update the tool card at `toolCallId` in place using an index map. Returns the
 * same array reference (and unchanged map) when the card isn't found, so a stray
 * update for an unknown card is a no-op instead of an O(n) scan that copies the
 * array for nothing. `update` receives the current card and returns the next.
 */
export function updateToolCard(
  items: TranscriptItem[],
  index: Map<string, number>,
  toolCallId: string,
  update: (card: Extract<TranscriptItem, { kind: "tool" }>["card"]) => Extract<TranscriptItem, { kind: "tool" }>["card"]
): TranscriptItem[] {
  const i = index.get(toolCallId);
  const it = i != null ? items[i] : undefined;
  if (i == null || !it || it.kind !== "tool") return items;
  const next = items.slice();
  next[i] = { ...it, card: update(it.card) };
  return next;
}

/** Record where a tool card lives so `_update`/`_end` can find it in O(1). */
export function indexTool(index: Map<string, number>, toolCallId: string, at: number): void {
  index.set(toolCallId, at);
}
