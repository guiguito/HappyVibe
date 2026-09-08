/**
 * §7 round 23 — which window shows a blocking prompt.
 *
 * Round 21 scoped a session's permission and ask-user dialogs to that session's
 * PANE, and that carries over unchanged into a second window because the pane
 * is in that window's DOM. What it does not answer is which window, so this
 * does: the one holding the session's chat tab, else the focused one, else the
 * primary. Every other window shows only the pending count and the shared dock
 * badge, so one prompt is never two dialogs.
 *
 * Main learns the holder from each renderer DECLARING the sessions it holds, so
 * this never parses a tab id — main still cannot tell a tab from a filename.
 *
 * Pure, and electron-free, so the suite can drive it directly.
 */
export function promptWindowFor(
  sessionId: string | undefined,
  holderOf: (sid: string) => number | null,
  focusedId: number | null,
  primaryId: number | null,
): number | null {
  // A prompt with no session belongs to the APP (the utility client's login and
  // provider setup), so it must not chase a holder.
  if (sessionId === undefined) return primaryId;
  return holderOf(sessionId) ?? focusedId ?? primaryId;
}
