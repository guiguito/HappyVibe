/**
 * §7 round 24 — the thinking block's label carries the STATE, not the content.
 *
 * Three cases and the third is the point: a reopened session's thinking block
 * has no start or end stamp anywhere in the session file, so its duration is
 * not recoverable. It reads a bare "Thought" rather than "Thought for 0s" —
 * §19 ruling 3's rule about an unknown number, one surface over.
 */
export function thinkingLabel(o: { live?: boolean; ms?: number }): string {
  if (o.live) return "Thinking";
  const ms = o.ms;
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "Thought";
  // Round UP, never down: a 200 ms think really happened, and "0s" reads as a bug.
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `Thought for ${s}s` : `Thought for ${Math.floor(s / 60)}m ${s % 60}s`;
}
