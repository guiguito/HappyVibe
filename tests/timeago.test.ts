import { describe, expect, it } from "vitest";
import { formatDuration, timeago, timeagoLong } from "../src/renderer/src/timeago";

// Round 15 — the sidebar's session age and the transcript's "N ago" / turn
// duration. Pure; `now` is always injected so nothing here reads a real clock.

const NOW = Date.parse("2026-08-16T12:00:00Z");
const ago = (ms: number): string => timeago(NOW - ms, NOW);

describe("timeago", () => {
  it("buckets by the largest unit that fits", () => {
    expect(ago(0)).toBe("now");
    expect(ago(30_000)).toBe("now"); // under a minute
    expect(ago(60_000)).toBe("1m");
    expect(ago(5 * 60_000)).toBe("5m");
    expect(ago(59 * 60_000)).toBe("59m");
    expect(ago(60 * 60_000)).toBe("1h");
    expect(ago(3 * 3_600_000)).toBe("3h");
    expect(ago(23 * 3_600_000)).toBe("23h");
    expect(ago(24 * 3_600_000)).toBe("1d");
    expect(ago(2 * 86_400_000)).toBe("2d");
    expect(ago(29 * 86_400_000)).toBe("29d");
    expect(ago(30 * 86_400_000)).toBe("1mo");
    expect(ago(70 * 86_400_000)).toBe("2mo");
  });

  it("never prints a negative age", () => {
    // A machine that slept, or clock skew, must not render "-3m".
    expect(timeago(NOW + 60_000, NOW)).toBe("now");
  });

  it("survives garbage rather than rendering NaN", () => {
    expect(timeago(Number.NaN, NOW)).toBe("now");
  });
});

describe("formatDuration", () => {
  it("keeps a decimal for the fast turns, where it is the whole story", () => {
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(4_000)).toBe("4.0s");
  });

  it("rounds to whole seconds past ten", () => {
    expect(formatDuration(34_000)).toBe("34s");
    expect(formatDuration(59_400)).toBe("59s");
  });

  it("splits minutes and hours", () => {
    expect(formatDuration(130_000)).toBe("2m 10s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_840_000)).toBe("1h 4m");
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("returns empty for nonsense rather than a fake number", () => {
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("timeagoLong", () => {
  it("says 'just now' rather than 'now ago'", () => {
    // Round 16: the transcript appended " ago" unconditionally, so a message
    // sent a second earlier read "now ago".
    expect(timeagoLong(NOW, NOW)).toBe("just now");
    expect(timeagoLong(NOW - 30_000, NOW)).toBe("just now");
    expect(timeagoLong(NOW + 60_000, NOW)).toBe("just now"); // clock skew
  });

  it("suffixes every other bucket", () => {
    expect(timeagoLong(NOW - 60_000, NOW)).toBe("1m ago");
    expect(timeagoLong(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(timeagoLong(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(timeagoLong(NOW - 70 * 86_400_000, NOW)).toBe("2mo ago");
  });

  it("never emits the string 'now ago'", () => {
    for (const ms of [0, 1_000, 59_999, 60_000, 3_600_000, 86_400_000]) {
      expect(timeagoLong(NOW - ms, NOW)).not.toContain("now ago");
    }
  });
});
