import type { TranscriptItem } from "./components/Transcript";

/**
 * §24: fold an `hv.command {typed, expanded}` pairing into the transcript.
 *
 * The same notify has to fix up two different optimistic renderings, because
 * the composer takes two different paths:
 *  - agent IDLE  → App appends the TYPED text immediately (App.tsx send()), so
 *    the item to fix reads `/review src/foo.ts`.
 *  - agent BUSY  → the bubble arrives later from `queue_update`, which carries
 *    Pi's ALREADY-EXPANDED text (App.tsx:802), so the item to fix reads the
 *    whole expansion.
 * Matching on either form collapses both into one rule, and the result is
 * identical in both cases — which is the entire point, since today the two
 * paths render the same keystrokes differently.
 *
 * `text` is normalised to the EXPANSION on purpose: it is what the model
 * actually received, what the session file will hold, and therefore what a
 * later reload will show. Storing the typed text here instead would recreate
 * the live-vs-rehydrated divergence this feature exists to remove.
 *
 * Scans from the end and stops at the first match — a repeated `/review` must
 * decorate the invocation that just happened, not the first one in the session.
 * Returns the ORIGINAL array when nothing matches, so callers can skip the
 * re-render (an unmatched pairing is a no-op, never a mutation).
 */
export function applyCommandPair(
  items: TranscriptItem[],
  pair: { typed: string; expanded: string },
): TranscriptItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "user") continue;
    // Already decorated (a duplicate notify, or a restore that got there first).
    if ("command" in it && it.command) continue;
    if (it.text !== pair.typed && it.text !== pair.expanded) continue;
    const next = items.slice();
    next[i] = { ...it, text: pair.expanded, command: { typed: pair.typed } };
    return next;
  }
  return items;
}
