/**
 * §7 round 27 — what the screen does once Pi says what it did with a message.
 * Pure, so the rule is pinned without a DOM (tests/send-outcome.test.ts).
 */
export function sendOutcome(
  guessedBusy: boolean,
  r: { disposition: "started" | "queued" | "handled" },
): { removeBubble: boolean; idle: boolean } {
  return {
    // Only an idle guess drew a bubble; a queued message is drawn by its chip, then its delivery.
    removeBubble: !guessedBusy && r.disposition === "queued",
    // A command (extension) took it: no agent_end will ever come to clear the busy dots.
    idle: r.disposition === "handled",
  };
}
