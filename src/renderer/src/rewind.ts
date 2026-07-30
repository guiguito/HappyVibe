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
