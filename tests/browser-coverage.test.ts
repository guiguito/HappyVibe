import { describe, it, expect } from "vitest";
import { paneIsCovered, paneViewRect, rectsOverlap, type Candidate, type Rect } from "../src/renderer/src/browserCoverage";

/**
 * §28 round 2 — coverage is decided by RECTANGLE, for every floating surface.
 *
 * Round 1 sampled nine points and kept a small declared-rectangle set for the
 * blind spots. The blind spots turned out to be the common case: the onboarding
 * card fell between the points, so did the pane `+` menu entering from the top
 * edge, and `elementFromPoint` is blind to `pointer-events: none` entirely.
 * These pin the geometry with the rects that actually caused reports.
 *
 * The hazard this mechanism accepts, recorded because it bit once: a candidate
 * is judged by its BOX. The voice pill used to be `fixed inset-x-0 … justify-
 * center`, so its box spanned the viewport while its pixels sat in the middle,
 * and a pill nobody could see over the browser blanked the page for the whole
 * recording. It is shrink-to-fit and docked now — but anything else that wraps
 * small content in a full-width positioned box will do the same, and the fix is
 * to shrink the box, not to loosen this test.
 */

/** A browser pane filling the right half of a 1512x949 window, below the bars. */
const PANE: Rect = { left: 885, top: 88, right: 1512, bottom: 949 };

const cand = (rect: Rect, over: Partial<Omit<Candidate, "rect">> = {}): Candidate => ({
  rect,
  isSelf: false,
  isDrawer: false,
  visible: true,
  ...over,
});

describe("the surfaces that were reported (§28)", () => {
  it("catches the onboarding card, which fell between the nine sample points", () => {
    // fixed inset-0, flex items-end justify-end, p-6, w-80 → bottom-right, 24px in.
    const card: Rect = { left: 1512 - 24 - 320, top: 949 - 24 - 150, right: 1512 - 24, bottom: 949 - 24 };
    expect(paneIsCovered(PANE, [cand(card)])).toBe(true);
  });

  it("catches the undocked voice pill, which sampling also missed", () => {
    const pill: Rect = { left: 606, top: 949 - 40 - 48, right: 906, bottom: 949 - 40 };
    expect(paneIsCovered(PANE, [cand(pill)])).toBe(true);
  });

  it("leaves the DOCKED pill alone — it lives inside the other pane", () => {
    const docked: Rect = { left: 420, top: 949 - 90 - 48, right: 720, bottom: 949 - 90 };
    expect(paneIsCovered(PANE, [cand(docked)])).toBe(false);
  });

  it("catches a full-screen scrim", () => {
    expect(paneIsCovered(PANE, [cand({ left: 0, top: 0, right: 1512, bottom: 949 })])).toBe(true);
  });

  it("an overlay in the OTHER pane must not hide this one", () => {
    const otherPane: Rect = { left: 256, top: 88, right: 884, bottom: 949 };
    expect(paneIsCovered(PANE, [cand(otherPane)])).toBe(false);
  });

  it("touching edges are not an overlap", () => {
    expect(rectsOverlap(PANE, { left: 700, top: 88, right: 885, bottom: 949 })).toBe(false);
  });
});

/**
 * §7 round 13: the drawer is the one overlay the pane makes ROOM for. Nothing in
 * the DOM can be painted above a WebContentsView, but the view can be made
 * smaller — so opening a file tree beside the page no longer blanks the page.
 */
describe("paneViewRect", () => {
  const full = { left: 0, top: 44, right: 1000, bottom: 800 };

  it("returns the pane untouched with no dividers and no drawer", () => {
    expect(paneViewRect(full, undefined, 6, 0, 1000)).toEqual({ x: 0, y: 44, width: 1000, height: 756 });
  });

  it("insets away from the drawer so the two can share the screen", () => {
    const r = paneViewRect(full, undefined, 6, 300, 1000);
    expect(r.width).toBe(700);
    expect(r.x).toBe(0);
    // The view now ends exactly where the drawer begins.
    expect(r.x + r.width).toBe(700);
  });

  it("leaves a pane that does not reach the drawer alone", () => {
    // The left half of a vertical split: its right edge is far from the drawer.
    const leftHalf = { left: 0, top: 44, right: 500, bottom: 800 };
    expect(paneViewRect(leftHalf, undefined, 6, 300, 1000).width).toBe(500);
  });

  it("insets a pane only by the part that actually overlaps", () => {
    const rightish = { left: 600, top: 44, right: 1000, bottom: 800 };
    // Drawer occupies 1000-300=700 onward, so 300 of this pane's 400 overlaps.
    expect(paneViewRect(rightish, undefined, 6, 300, 1000).width).toBe(100);
  });

  it("stacks with the divider insets rather than replacing them", () => {
    const r = paneViewRect(full, { left: true, top: false, right: false, bottom: true }, 6, 300, 1000);
    expect(r.x).toBe(6);
    expect(r.width).toBe(1000 - 6 - 300);
    expect(r.height).toBe(756 - 6);
  });

  it("never goes negative when the drawer is wider than the pane", () => {
    const narrow = { left: 900, top: 44, right: 1000, bottom: 800 };
    expect(paneViewRect(narrow, undefined, 6, 600, 1000).width).toBe(0);
  });
});

describe("paneIsCovered", () => {
  const view: Rect = { left: 100, top: 100, right: 500, bottom: 400 };
  const c = (rect: Rect, over: Partial<Omit<Candidate, "rect">> = {}): Candidate => ({
    rect,
    isSelf: false,
    isDrawer: false,
    visible: true,
    ...over,
  });

  it("is not covered by an empty candidate list", () => {
    expect(paneIsCovered(view, [])).toBe(false);
  });

  it("catches a menu clipping in from the TOP EDGE — the case 9 sample points missed", () => {
    // The pane `+` menu drops down from the strip and enters the pane by ~80px.
    const menu: Rect = { left: 200, top: 60, right: 420, bottom: 180 };
    expect(paneIsCovered(view, [c(menu)])).toBe(true);
  });

  it("catches a small edge-anchored card that falls between sample points", () => {
    // The onboarding card: bottom-right, inset 24px.
    const card: Rect = { left: 300, top: 300, right: 476, bottom: 376 };
    expect(paneIsCovered(view, [c(card)])).toBe(true);
  });

  it("ignores a floating element in another pane", () => {
    const elsewhere: Rect = { left: 600, top: 100, right: 900, bottom: 300 };
    expect(paneIsCovered(view, [c(elsewhere)])).toBe(false);
  });

  it("ignores the pane's OWN chrome", () => {
    expect(paneIsCovered(view, [c({ left: 100, top: 100, right: 500, bottom: 140 }, { isSelf: true })])).toBe(false);
  });

  it("ignores the drawer — the pane makes room for that instead of hiding", () => {
    const drawer: Rect = { left: 400, top: 44, right: 700, bottom: 800 };
    expect(paneIsCovered(view, [c(drawer, { isDrawer: true })])).toBe(false);
  });

  it("ignores an element that is not painted", () => {
    expect(paneIsCovered(view, [c({ left: 200, top: 200, right: 300, bottom: 300 }, { visible: false })])).toBe(false);
  });

  it("ignores a zero-size element", () => {
    expect(paneIsCovered(view, [c({ left: 200, top: 200, right: 200, bottom: 200 })])).toBe(false);
  });

  it("touching edges do not count as covering", () => {
    expect(paneIsCovered(view, [c({ left: 500, top: 100, right: 700, bottom: 400 })])).toBe(false);
  });
});
