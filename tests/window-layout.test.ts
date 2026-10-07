import { describe, expect, it } from "vitest";
import { parseLayoutFile } from "../src/main/windowLayout";

const tabs = {
  "/Users/x/proj": {
    panes: [{ tabs: ["a.ts"], active: "a.ts" }, null, null, null],
    split: null,
    subSplit: [false, false],
    focused: 0,
    sizes: { main: 0.5, cross: 0.5 },
  },
};

describe("parseLayoutFile", () => {
  it("reads the new shape: a list of window records", () => {
    const recs = parseLayoutFile({
      windows: [{ bounds: { x: 1, y: 2, width: 300, height: 200 }, tabsByWs: tabs, ui: { "hv:active-ws": "/Users/x/proj" } }],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.bounds).toEqual({ x: 1, y: 2, width: 300, height: 200 });
    expect(recs[0]!.tabsByWs).toEqual(tabs);
    expect(recs[0]!.ui).toEqual({ "hv:active-ws": "/Users/x/proj" });
  });

  it("migrates the legacy shape (Record<workspaceId, tabs>) to one primary record with empty ui", () => {
    // A workspace id IS its absolute path (WorkspaceRegistry stores paths), so
    // the literal key "windows" cannot occur and the discriminator is safe.
    expect(parseLayoutFile(tabs)).toEqual([{ tabsByWs: tabs, ui: {} }]);
  });

  it("drops junk records, non-string ui values and impossible bounds instead of throwing", () => {
    const recs = parseLayoutFile({ windows: [null, 3, { tabsByWs: {}, ui: { a: 1, b: "x" }, bounds: { x: "no" } }] });
    expect(recs).toEqual([{ tabsByWs: {}, ui: { b: "x" } }]);
  });

  it("refuses a degenerate window size rather than restoring an unusable window", () => {
    const recs = parseLayoutFile({ windows: [{ tabsByWs: {}, ui: {}, bounds: { x: 0, y: 0, width: 4, height: 4 } }] });
    expect(recs[0]!.bounds).toBeUndefined();
  });

  it("junk or absent → no records (the caller opens one default window)", () => {
    expect(parseLayoutFile(undefined)).toEqual([]);
    expect(parseLayoutFile("nope")).toEqual([]);
    expect(parseLayoutFile({ windows: "x" })).toEqual([]);
    expect(parseLayoutFile({ windows: [] })).toEqual([]);
  });

  it("a record with no tabsByWs key at all is junk, but an EMPTY one is a real empty window", () => {
    // The difference matters: ⌘⇧N persists `{tabsByWs:{}, ui:{…}}`, and dropping
    // that would silently stop restoring an empty window the user had open.
    expect(parseLayoutFile({ windows: [{ ui: {} }] })).toEqual([]);
    expect(parseLayoutFile({ windows: [{ tabsByWs: {}, ui: { "hv:sidebar-collapsed": "1" } }] }))
      .toEqual([{ tabsByWs: {}, ui: { "hv:sidebar-collapsed": "1" } }]);
  });
});

import { firstWindowSize } from "../src/main/windowLayout";
import { readFileSync as readSrc } from "node:fs";

describe("round 25: a first launch opens a bigger window, never larger than the screen", () => {
  it("1280 x 860 on a screen with room", () => {
    expect(firstWindowSize({ width: 1728, height: 1079 })).toEqual({ width: 1280, height: 860 });
  });
  it("capped to 90% of a small work area", () => {
    expect(firstWindowSize({ width: 1280, height: 777 })).toEqual({ width: 1152, height: 699 });
  });
  it("is what index.ts uses when no bounds were saved", () => {
    const idx = readSrc("src/main/index.ts", "utf8");
    expect(idx).toContain("firstWindowSize(screen.getPrimaryDisplay().workAreaSize)");
    expect(idx).not.toMatch(/\?\? 900\b/);
  });
});
