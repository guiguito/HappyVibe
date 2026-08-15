import { describe, it, expect } from "vitest";
import { anyPointInside, rectsOverlap, samplePoints, type Rect } from "../src/renderer/src/browserCoverage";

/**
 * §28 round 1 — why declared overlays are checked by RECTANGLE and not only by
 * hit-testing nine points.
 *
 * Reported as "some dialogs appear covered by the browser". Two causes, both
 * reproduced here as geometry: `pointer-events: none` is invisible to
 * `elementFromPoint` (not expressible in a unit test, but it is why the voice
 * pill was missed), and a small edge-anchored card can sit entirely BETWEEN the
 * nine sample points — which is expressible, and is what these pin.
 */

/** A browser pane filling the right half of a 1512x949 window, below the bars. */
const PANE: Rect = { left: 885, top: 88, right: 1512, bottom: 949 };
const POINTS = samplePoints(PANE, 10);

describe("the nine-point blind spot (§28 round 1)", () => {
  it("the onboarding card overlaps the pane…", () => {
    // fixed inset-0, flex items-end justify-end, p-6, w-80 → bottom-right, 24px in.
    const card: Rect = { left: 1512 - 24 - 320, top: 949 - 24 - 150, right: 1512 - 24, bottom: 949 - 24 };
    expect(rectsOverlap(PANE, card)).toBe(true);
  });

  it("…but no sampled point lands on it — which is why it was missed", () => {
    const card: Rect = { left: 1512 - 24 - 320, top: 949 - 24 - 150, right: 1512 - 24, bottom: 949 - 24 };
    expect(anyPointInside(POINTS, card)).toBe(false);
  });

  it("the voice pill overlaps the pane…", () => {
    // fixed inset-x-0 bottom-10, ~48px tall → a band 40px off the bottom.
    const pill: Rect = { left: 0, top: 949 - 40 - 48, right: 1512, bottom: 949 - 40 };
    expect(rectsOverlap(PANE, pill)).toBe(true);
  });

  it("…and falls between the sample rows too", () => {
    const pill: Rect = { left: 0, top: 949 - 40 - 48, right: 1512, bottom: 949 - 40 };
    expect(anyPointInside(POINTS, pill)).toBe(false);
  });

  it("a full-screen scrim IS caught by sampling — those never needed the rect pass", () => {
    const scrim: Rect = { left: 0, top: 0, right: 1512, bottom: 949 };
    expect(anyPointInside(POINTS, scrim)).toBe(true);
  });

  it("an overlay in the OTHER pane must not hide this one", () => {
    const otherPane: Rect = { left: 256, top: 88, right: 884, bottom: 949 };
    expect(rectsOverlap(PANE, otherPane)).toBe(false);
  });

  it("touching edges are not an overlap", () => {
    expect(rectsOverlap(PANE, { left: 700, top: 88, right: 885, bottom: 949 })).toBe(false);
  });
});
