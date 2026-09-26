/**
 * §12 decision 8 (2026-09-26): a run that stops moving is SHOWN, never killed.
 *
 * Upstream #318: a tintinweb child that dies while waiting on the model leaves its record
 * "running" forever — no terminal record, and the session's busy gate never clears. The
 * app cannot tell a hung model call from a slow one, so it does not guess: after 10
 * minutes with nothing written WHILE WAITING ON THE MODEL, the card turns amber and asks.
 * A long tool call (a test suite, a build) is never flagged — the child is working, and
 * its file is quiet only because the tool has not returned yet. Pure; the poller feeds it.
 */
export const STUCK_MS = 10 * 60_000;

export function isStuck(awaitingModel: boolean, idleMs: number): boolean {
  return awaitingModel && idleMs >= STUCK_MS;
}
