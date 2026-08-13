import type { TranscriptItem } from "./components/Transcript";

/**
 * §9 rewind scopes. Default is "conversation" — the pre-round-7 behaviour, so
 * nobody is surprised into a file write by a control they already knew.
 */
export type RewindScope = "conversation" | "both" | "files";

export interface RewindActions { truncateChat: boolean; restoreFiles: boolean }

export function rewindActions(scope: RewindScope): RewindActions {
  return {
    truncateChat: scope !== "files",
    restoreFiles: scope !== "conversation",
  };
}

/** What `hv:rewind-preview` answers with. `null` = no snapshot at this message. */
export interface RewindPreview {
  willRestore: string[];
  willDelete: string[];
  stale: string[];
}

/**
 * §9 round 12 — is there anything for a file rewind to DO?
 *
 * Three states have to read as "no", and only the first was handled before (and
 * only by greying one option, which still asks the user to reason about a
 * control that cannot act):
 *   - `undefined` — the preview is still loading. The file scopes stay hidden
 *     until the answer arrives; revealing then hiding would make options vanish
 *     from under the cursor, which is worse than one that was never offered.
 *   - `null` — no snapshot anchored here (a steer, or a capture that failed).
 *   - a snapshot whose diff is empty — the turn only READ files.
 */
export function hasRestorable(preview: RewindPreview | null | undefined): boolean {
  if (!preview) return false;
  return preview.willRestore.length + preview.willDelete.length > 0;
}

/**
 * The tool calls being undone by a rewind anchored at `idx`. `toolCallId` is
 * the only identifier durable across a reload (renderer ids renumber on every
 * mount), so this set is what main matches snapshots against.
 *
 * Shared by App.tsx (which applies the rewind) and ChatView.tsx (which previews
 * it) so the two can never disagree about what is in scope.
 */
export function tailToolCallIds(items: TranscriptItem[], idx: number): string[] {
  return items.slice(idx).flatMap((x) => (x.kind === "tool" ? [x.card.toolCallId] : []));
}
