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
  expect(String(css.gridTemplateColumns)).toContain("0.5fr");
});

test("the main ratio drives the track sizes", () => {
  const t = setSize(splitPane(openFile(emptyTabs, "a"), "v"), "main", 0.3);
  expect(String(buildGridStyle(t).gridTemplateColumns)).toBe("minmax(0,0.3fr) minmax(0,0.7fr) auto");
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
  expect(String(css.gridTemplateColumns)).toContain("0.5fr");
  expect(String(css.gridTemplateRows)).toContain("0.5fr");
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
