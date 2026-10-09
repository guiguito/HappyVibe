import type { TranscriptItem } from "./components/Transcript";
import { hasRestorable, type RewindPreview, type RewindScope } from "./rewind";

/**
 * §17 round 28 — a live bubble learns Pi's own `message.timestamp` from the user-role
 * `message_end`; main finds the fork's entry by it (history.ts userEntryAt). Text first
 * (several may be unstamped), else the oldest unstamped one AFTER the last stamped bubble:
 * a prompt template's bubble shows what was TYPED while Pi's message holds the
 * expansion. An orphan Pi never echoed sits before a stamped one, so it can't steal
 * the stamp and shift every later bubble by one. Synthetic bubbles (the
 * askUser answers summary) are not Pi user messages and never get a stamp.
 */
export function stampPiTs(items: TranscriptItem[], piTs: number, text: string): TranscriptItem[] {
  const open = (x: TranscriptItem): boolean => x.kind === "user" && x.piTs == null && !x.synthetic;
  let i = items.findIndex((x) => open(x) && x.kind === "user" && x.text.trim() === text.trim());
  if (i < 0) {
    const last = items.findLastIndex((x) => x.kind === "user" && x.piTs != null);
    const j = items.slice(last + 1).findIndex(open);
    i = j < 0 ? -1 : last + 1 + j;
  }
  if (i < 0) return items;
  const next = items.slice();
  next[i] = { ...items[i], piTs } as TranscriptItem;
  return next;
}

/** The Fork dialog mirrors Rewind's scopes, minus "Files only" — a fork always changes the conversation. */
export function forkScopes(preview: RewindPreview | null | undefined): RewindScope[] {
  return hasRestorable(preview) ? ["conversation", "both"] : ["conversation"];
}

export const FORK_DIALOG = {
  title: "Fork from this message?",
  body: "A new session opens in a new tab with everything before this message, and this message goes into its composer so you can edit and resend it. This session stays exactly as it is.",
  confirm: "Fork",
  bothHint: "Also roll the workspace back to before this message. This session shares those files.",
} as const;

/** §17 round 28: where a fork's "Forked from" marker goes — before the first item newer than
    the fork. Unstamped items (tool cards) never decide it; a duplicate lands at the end. */
export function forkMarkerIndex(items: Array<{ ts?: number }>, atMs: number): number {
  const i = items.findIndex((x) => x.ts != null && x.ts > atMs);
  return i < 0 ? items.length : i;
}

/** One copy for the marker's plain text and its clickable-title variant (Transcript.tsx). */
export const FORK_MARKER_PREFIX = "Forked from";

/** `null` = the original no longer exists. */
export function forkMarkerCopy(originalTitle: string | null): string {
  return `${FORK_MARKER_PREFIX} ${originalTitle ?? "a deleted session"}`;
}

/** A sub-agent run from before the fork: its children belong to the original, so the card cannot
    expand; this line links to the original instead (plain text once it is deleted). */
export const PRE_FORK_CARD_COPY = "From the original session";
