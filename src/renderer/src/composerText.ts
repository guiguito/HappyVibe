/**
 * §27/§3.4. How new text joins what is already typed — ONE definition, shared
 * by dictation and the editor's "Send to chat", so the two cannot drift.
 *
 * Inserts AT THE CARET, padding with single spaces and never a newline.
 *
 * This reverses the 2026-08-07 append rule. That rule was a taste call, not a
 * limitation: appending kept one rule for both paths, and it read badly for the
 * case dictation is actually for — describing intent mid-sentence, then typing
 * the file path. Caret insertion is what a dictation tool is expected to do.
 *
 * Both paths stay unified (feedback round 2, 2026-08-13). The known trade-off,
 * accepted deliberately: a multi-line selection sent from the editor now
 * splices at the caret with a space rather than landing as its own block. If
 * that proves wrong the fix is one conditional here — pad with "\n" when `text`
 * contains a newline — and nowhere else, which is the point of one definition.
 */
export interface ComposerInsert {
  value: string;
  /** Where the caret should sit afterwards: immediately after the inserted text. */
  caret: number;
}

/**
 * Insert `text` into `prev`, replacing the selection `[start, end)`.
 *
 * `start`/`end` are clamped, so a stale caret from a previous value can never
 * produce a spliced-out-of-bounds string.
 */
export function insertAtComposer(
  prev: string,
  text: string,
  start: number,
  end: number,
): ComposerInsert {
  const lo = Math.max(0, Math.min(prev.length, Math.min(start, end)));
  const hi = Math.max(0, Math.min(prev.length, Math.max(start, end)));

  const before = prev.slice(0, lo);
  const after = prev.slice(hi);

  // Pad only against real characters, and only when the inserted text does not
  // already bring its own whitespace — otherwise a transcript that happens to
  // start with a space would produce a double space. A newline counts as
  // whitespace, so dictating at the start of a fresh line adds no leading space.
  const needsLeading = before.length > 0 && !/\s$/.test(before) && !/^\s/.test(text);
  const needsTrailing = after.length > 0 && !/^\s/.test(after) && !/\s$/.test(text);

  const body = `${needsLeading ? " " : ""}${text}${needsTrailing ? " " : ""}`;
  return {
    value: before + body + after,
    // After the text itself, BEFORE any trailing pad — so continuing to type
    // lands inside the sentence rather than past the space we just added.
    caret: before.length + (needsLeading ? 1 : 0) + text.length,
  };
}
