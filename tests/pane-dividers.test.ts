import { expect, test } from "vitest";
import { crossDividerSpans, emptyTabs, type WorkspaceTabs } from "../src/renderer/src/tabs";

/**
 * §28 round 21 — where the second-level pane divider may be drawn.
 *
 * The reported bug: session on the left, browser on the right, split the
 * session in two and the browser's content disappears — coming back on
 * unsplit. The divider was ONE strip across the whole grid, so it lay over a
 * pane that was not split at all, and the browser correctly hid from a
 * rectangle drawn on top of it.
 */

const tabs = (over: Partial<WorkspaceTabs>): WorkspaceTabs => ({ ...emptyTabs, ...over });
const sizes = { main: 0.5, cross: 0.5 };

test("no split, no cross divider", () => {
  expect(crossDividerSpans(tabs({ split: null, subSplit: [false, false], sizes }))).toEqual([]);
});

test("split but nothing sub-split: still no cross divider", () => {
  expect(crossDividerSpans(tabs({ split: "v", subSplit: [false, false], sizes }))).toEqual([]);
});

test("SESSION LEFT, BROWSER RIGHT, split the left: the strip stops at the divider", () => {
  // This is the whole bug. One strip spanning left-0 right-0 crossed the
  // browser's rect, the geometric coverage check found it, and the page hid.
  const spans = crossDividerSpans(tabs({ split: "v", subSplit: [true, false], sizes: { main: 0.6, cross: 0.5 } }));
  expect(spans).toEqual([{ half: 0, from: 0, to: 0.6 }]);
});

test("split the RIGHT half only: the strip starts at the divider", () => {
  const spans = crossDividerSpans(tabs({ split: "v", subSplit: [false, true], sizes: { main: 0.6, cross: 0.5 } }));
  expect(spans).toEqual([{ half: 1, from: 0.6, to: 1 }]);
});

test("both halves sub-split: TWO strips, one per half, not one spanning both", () => {
  // Two strips rather than one full-width one, so the rule has no special case
  // — and where a browser really is in a sub-split column the divider is at its
  // edge, which DIVIDER_INSET already handles.
  expect(crossDividerSpans(tabs({ split: "v", subSplit: [true, true], sizes: { main: 0.4, cross: 0.5 } }))).toEqual([
    { half: 0, from: 0, to: 0.4 },
    { half: 1, from: 0.4, to: 1 },
  ]);
});

test("a horizontal primary split works the same way, along the other axis", () => {
  expect(crossDividerSpans(tabs({ split: "h", subSplit: [true, false], sizes: { main: 0.3, cross: 0.5 } }))).toEqual([
    { half: 0, from: 0, to: 0.3 },
  ]);
});

test("a one-half strip never spans the full extent", () => {
  for (const split of ["v", "h"] as const) {
    for (const subSplit of [[true, false], [false, true]] as [boolean, boolean][]) {
      const spans = crossDividerSpans(tabs({ split, subSplit, sizes }));
      expect(spans).toHaveLength(1);
      const { half, from, to } = spans[0];
      expect(half === 0 ? from : to, "a one-half strip must stop at the main divider").toBe(half === 0 ? 0 : 1);
      expect(to - from).toBeLessThan(1);
    }
  }
});
