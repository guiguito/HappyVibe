import { expect, test } from "vitest";
import { buildGridStyle } from "../src/renderer/src/App";
import { emptyTabs, openFile, setSize, splitHalf, splitPane } from "../src/renderer/src/tabs";

/**
 * The 2×2 geometry must be expressible as named areas in ONE flat grid, because
 * pane content is mounted once and placed by grid-area (tabs.ts invariant). These
 * assert the shape rather than pixels: every live pane gets an area, and a half
 * that is not cross-split SPANS its side instead of leaving a hole.
 */

const areas = (css: React.CSSProperties): string => String(css.gridTemplateAreas ?? "");

test("single pane: one strip, one content, and the toolbar cell", () => {
  const css = buildGridStyle(emptyTabs);
  expect(areas(css)).toBe('"stripA toolbar" "contentA contentA"');
});

test("vertical split: two columns, both halves present", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "v");
  const css = buildGridStyle(t);
  expect(areas(css)).toContain("stripA stripB");
  expect(areas(css)).toContain("contentA contentB");
  expect(String(css.gridTemplateColumns)).toContain("50%");
});

test("the main ratio drives the track sizes", () => {
  const t = setSize(splitPane(openFile(emptyTabs, "a"), "v"), "main", 0.3);
  expect(String(buildGridStyle(t).gridTemplateColumns)).toBe("30% minmax(0,1fr) auto");
});

test("cross-splitting one half gives it an inner strip; the other half SPANS", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  const a = areas(buildGridStyle(t));
  expect(a).toContain("stripC"); // half A's inner strip
  expect(a).not.toContain("stripD"); // half B is not split
  // Half B occupies all three content rows rather than leaving two empty cells.
  expect(a.match(/contentB/g)?.length).toBeGreaterThanOrEqual(6);
});

test("a full 2x2 places all four contents and all four strips", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = openFile(splitHalf(t, 0), "c");
  t = openFile(splitHalf(t, 1), "d");
  const a = areas(buildGridStyle(t));
  for (const n of ["contentA", "contentB", "contentC", "contentD", "stripA", "stripB", "stripC", "stripD"]) {
    expect(a).toContain(n);
  }
  expect(a).toContain("toolbar");
});

test("horizontal split stacks the halves into rows", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "h");
  const a = areas(buildGridStyle(t));
  expect(a).toContain('"stripA toolbar"');
  expect(a).toContain('"stripB stripB"');
});

test("horizontal split with a cross-split half divides into COLUMNS", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "h"), "b");
  t = splitHalf(t, 0);
  const css = buildGridStyle(t);
  expect(areas(css)).toContain("contentA contentC");
  // The cross ratio drives columns here, and main drives rows.
  expect(String(css.gridTemplateColumns)).toContain("50%");
  expect(String(css.gridTemplateRows)).toContain("calc(50% - 44px)");
});

test("every live pane always has an area — no pane can be unrenderable", () => {
  const layouts = [
    emptyTabs,
    splitPane(emptyTabs, "v"),
    splitPane(emptyTabs, "h"),
    splitHalf(splitPane(emptyTabs, "v"), 0),
    splitHalf(splitPane(emptyTabs, "v"), 1),
    splitHalf(splitHalf(splitPane(emptyTabs, "v"), 0), 1),
    splitHalf(splitHalf(splitPane(emptyTabs, "h"), 0), 1),
  ];
  const NAMES = ["contentA", "contentB", "contentC", "contentD"];
  for (const t of layouts) {
    const a = areas(buildGridStyle(t));
    const live = ([0, 1, 2, 3] as const).filter((i) => t.panes[i] != null);
    for (const slot of live) expect(a, `slot ${slot} of ${JSON.stringify(t.subSplit)}`).toContain(NAMES[slot]);
  }
});

/**
 * Regression: the toolbar occupies a third column and content BELOW row 1 spans
 * into it, so `1fr 1fr auto` gave half A (W-toolbar)/2 and half B that plus the
 * toolbar — measured 538 vs 718 px at a claimed 50/50 in the running app, with
 * the draggable handle 90px off the boundary it moves. The first track must be an
 * exact percentage of the FULL width so the boundary lands at `main%`.
 */
test("the first column is an exact percentage, not an fr — the halves must be equal", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "v");
  const cols = String(buildGridStyle(t).gridTemplateColumns);
  expect(cols).toBe("50% minmax(0,1fr) auto");
  expect(cols).not.toContain("0.5fr");
});

test("a dragged main ratio moves the boundary to exactly that percentage", () => {
  const t = setSize(splitPane(openFile(emptyTabs, "a"), "v"), "main", 0.3);
  expect(String(buildGridStyle(t).gridTemplateColumns)).toBe("30% minmax(0,1fr) auto");
});

test("the cross boundary subtracts the strip rows, so its handle sits on the line", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = setSize(splitHalf(t, 0), "cross", 0.4);
  // row2 ends at 44 + (40% - 44) = 40% of the height.
  expect(String(buildGridStyle(t).gridTemplateRows)).toBe("44px calc(40% - 44px) 44px minmax(0,1fr)");
});

test("horizontal split puts the main ratio on the ROWS and cross on the columns", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "h"), "b");
  t = splitHalf(t, 0);
  const css = buildGridStyle(t);
  expect(String(css.gridTemplateRows)).toContain("calc(50% - 44px)");
  expect(String(css.gridTemplateColumns)).toBe("50% minmax(0,1fr) auto");
});
