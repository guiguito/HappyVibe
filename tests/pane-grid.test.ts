import { expect, test } from "vitest";
import { buildGridStyle, paneEdges, topRightSlot } from "../src/renderer/src/paneGrid";
import { emptyTabs, openFile, setSize, splitHalf, splitPane } from "../src/renderer/src/tabs";

/**
 * The 2×2 geometry must be expressible as named areas in ONE flat grid, because
 * pane content is mounted once and placed by grid-area (tabs.ts invariant). These
 * assert the shape rather than pixels: every live pane gets an area, and a half
 * that is not cross-split SPANS its side instead of leaving a hole.
 */

const areas = (css: React.CSSProperties): string => String(css.gridTemplateAreas ?? "");

test("single pane: one strip and one content (the toolbar is an overlay, not a cell)", () => {
  const css = buildGridStyle(emptyTabs);
  expect(areas(css)).toBe('"stripA" "contentA"');
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
  expect(String(buildGridStyle(t).gridTemplateColumns)).toBe("30% minmax(0,1fr)");
});

test("cross-splitting one half gives it an inner strip; the other half SPANS", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  const a = areas(buildGridStyle(t));
  expect(a).toContain("stripC"); // half A's inner strip
  expect(a).not.toContain("stripD"); // half B is not split
  // Half B occupies all three content rows rather than leaving two empty cells.
  expect(a.match(/contentB/g)?.length).toBeGreaterThanOrEqual(3);
});

test("a full 2x2 places all four contents and all four strips", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = openFile(splitHalf(t, 0), "c");
  t = openFile(splitHalf(t, 1), "d");
  const a = areas(buildGridStyle(t));
  for (const n of ["contentA", "contentB", "contentC", "contentD", "stripA", "stripB", "stripC", "stripD"]) {
    expect(a).toContain(n);
  }
});

test("horizontal split stacks the halves into rows", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "h");
  const a = areas(buildGridStyle(t));
  expect(a).toContain('"stripA"');
  expect(a).toContain('"stripB"');
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
  expect(cols).toBe("50% minmax(0,1fr)");
  expect(cols).not.toContain("0.5fr");
});

test("a dragged main ratio moves the boundary to exactly that percentage", () => {
  const t = setSize(splitPane(openFile(emptyTabs, "a"), "v"), "main", 0.3);
  expect(String(buildGridStyle(t).gridTemplateColumns)).toBe("30% minmax(0,1fr)");
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
  expect(String(css.gridTemplateColumns)).toBe("50% minmax(0,1fr)");
});

/**
 * Regression: the toolbar used to be a third grid COLUMN, present only in row 1,
 * while content in later rows spanned into it. Measured in the running app on an
 * h-then-v layout: contentC was 628px but its own stripC was 552px, and stripB
 * (a later row) spanned the full 1256px — so no two strips shared a right edge
 * and a strip was narrower than the pane it belonged to. The toolbar is now an
 * absolute overlay, so every strip spans exactly its pane.
 */
test("each strip spans exactly the same tracks as its own content", () => {
  const layouts = [
    emptyTabs,
    splitPane(emptyTabs, "v"),
    splitPane(emptyTabs, "h"),
    splitHalf(splitPane(emptyTabs, "v"), 0),
    splitHalf(splitPane(emptyTabs, "h"), 0),
    splitHalf(splitHalf(splitPane(emptyTabs, "v"), 0), 1),
    splitHalf(splitHalf(splitPane(emptyTabs, "h"), 0), 1),
  ];
  for (const t of layouts) {
    const rows = areas(t === emptyTabs ? buildGridStyle(t) : buildGridStyle(t))
      .split('" "').map((r) => r.replace(/"/g, "").trim().split(/\s+/));
    const width = (name: string): number =>
      Math.max(0, ...rows.map((cells) => cells.filter((c) => c === name).length));
    for (const [strip, content] of [["stripA","contentA"],["stripB","contentB"],["stripC","contentC"],["stripD","contentD"]]) {
      if (width(strip) === 0) continue;
      expect(width(strip), `${strip} vs ${content} in ${JSON.stringify(t.subSplit)} ${t.split}`).toBe(width(content));
    }
  }
});

test("no layout mentions a toolbar track — it is an overlay now", () => {
  const layouts = [emptyTabs, splitPane(emptyTabs, "v"), splitHalf(splitPane(emptyTabs, "h"), 0)];
  for (const t of layouts) expect(areas(buildGridStyle(t))).not.toContain("toolbar");
});


// ── pane borders: no gaps, no doubled rules ─────────────────────────────────

/**
 * Regression: a pane can be in column 2 AND row 2 at once (slot 3 always is), and
 * the old rule returned only one border — so the primary divider stopped halfway
 * down at the cross split. Measured in the app: contentD drew border-t and no
 * border-l while contentB directly above it drew border-l.
 */
test("an unsplit pane draws no edges", () => {
  expect(paneEdges(emptyTabs, 0)).toEqual({ left: false, top: false });
});

test("vertical split: the second half draws its left edge", () => {
  const t = splitPane(emptyTabs, "v");
  expect(paneEdges(t, 0)).toEqual({ left: false, top: false });
  expect(paneEdges(t, 1)).toEqual({ left: true, top: false });
});

test("horizontal split: the second half draws its TOP edge, not a left one", () => {
  const t = splitPane(emptyTabs, "h");
  expect(paneEdges(t, 1)).toEqual({ left: false, top: true });
});

test("slot 3 draws BOTH edges — it is in column 2 and row 2", () => {
  const v = splitHalf(splitPane(emptyTabs, "v"), 1);
  expect(paneEdges(v, 3)).toEqual({ left: true, top: true });
  const h = splitHalf(splitPane(emptyTabs, "h"), 1);
  expect(paneEdges(h, 3)).toEqual({ left: true, top: true });
});

test("a cross partner of the FIRST half draws only the cross edge", () => {
  const v = splitHalf(splitPane(emptyTabs, "v"), 0);
  expect(paneEdges(v, 2)).toEqual({ left: false, top: true }); // stacked under A
  const h = splitHalf(splitPane(emptyTabs, "h"), 0);
  expect(paneEdges(h, 2)).toEqual({ left: true, top: false }); // beside A
});

test("the divider is continuous: every pane in column 2 draws a left edge", () => {
  const t = splitHalf(splitPane(emptyTabs, "v"), 1); // A full height, B over D
  for (const slot of [1, 3]) expect(paneEdges(t, slot).left, `slot ${slot}`).toBe(true);
});

/**
 * §7 round 13: the Files/Changes cluster renders as the last item of ONE strip,
 * and this is the function that picks it. Row 0 only — a cluster in a strip
 * halfway down the window is not "the top bar".
 */
test("topRightSlot: the only pane when nothing is split", () => {
  expect(topRightSlot(emptyTabs)).toBe(0);
});

test("topRightSlot: the RIGHT half of a vertical split", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "v");
  expect(topRightSlot(t)).toBe(1);
});

test("topRightSlot: the TOP half of a horizontal split, never the lower strip", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "h");
  expect(topRightSlot(t)).toBe(0);
});

test("topRightSlot: the top-right cell of a 2x2", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  t = splitHalf(t, 1);
  expect(topRightSlot(t)).toBe(1);
});
