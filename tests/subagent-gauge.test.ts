import { describe, expect, it } from "vitest";
import { childGauge } from "../src/renderer/src/subagentGauge";

/**
 * PRD §12 (2026-08-29, the fleet round) — a delegation child's context gauge.
 *
 * The zones are deliberately NOT re-chosen here: they come from context.ts's
 * `zoneOf`, the same function §9's session bubble uses, so the two surfaces can
 * never disagree about what amber means. These tests assert that reuse by
 * asserting the boundaries, so a forked threshold table fails here.
 */
describe("childGauge", () => {
  it("renders occupancy as a percentage in the session gauge's own zones", () => {
    expect(childGauge({ window: 12_800, limit: 200_000 })).toEqual({ percent: 6, zone: "calm", label: "12.8k/200k" });
    expect(childGauge({ window: 100_000, limit: 200_000 })).toMatchObject({ percent: 50, zone: "amber" });
    expect(childGauge({ window: 180_000, limit: 200_000 })).toMatchObject({ percent: 90, zone: "red" });
  });

  it("puts the zone boundaries exactly where the session gauge puts them", () => {
    // context.ts: calm < 35, amber 35-79, red >= 80.
    expect(childGauge({ window: 34, limit: 100 })?.zone).toBe("calm");
    expect(childGauge({ window: 35, limit: 100 })?.zone).toBe("amber");
    expect(childGauge({ window: 79, limit: 100 })?.zone).toBe("amber");
    expect(childGauge({ window: 80, limit: 100 })?.zone).toBe("red");
  });

  it("is null with no measurement — a missing window is never a 0% gauge", () => {
    // The card renders nothing at all in this case. Showing an empty bar would
    // claim the child's context is empty, which is a different fact from
    // "we could not measure it" (PRD §19 ruling 3).
    expect(childGauge(undefined)).toBeNull();
  });

  it("is null rather than Infinity when the limit is not a divisor", () => {
    expect(childGauge({ window: 10, limit: 0 })).toBeNull();
  });

  it("clamps a window that exceeds its limit rather than reporting over 100%", () => {
    // Reachable: `window` is the latest turn's input + cache-read, and a child
    // that overflowed its window reports the attempt before the run fails.
    expect(childGauge({ window: 260_000, limit: 200_000 })).toMatchObject({ percent: 100, zone: "red" });
  });
});
