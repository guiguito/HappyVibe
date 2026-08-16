import { describe, expect, it } from "vitest";
import { restoreLayout, restoredSessions } from "../src/renderer/src/layoutPersist";
import {
  allChats,
  allFiles,
  allTerminals,
  emptyTabs,
  liveSlots,
  openChat,
  openFile,
  openTerminal,
  openBrowserTab,
  allBrowsers,
  allChats,
  splitAt,
  splitHalf,
  type WorkspaceTabs,
} from "../src/renderer/src/tabs";

const alive = (
  sessions: string[],
  terminals: string[],
  browsers: string[] = [],
  workspaces?: string[],
): { sessions: Set<string>; terminals: Set<string>; browsers: Set<string>; workspaces?: Set<string> } => ({
  browsers: new Set(browsers),
  sessions: new Set(sessions),
  terminals: new Set(terminals),
  ...(workspaces ? { workspaces: new Set(workspaces) } : {}),
});

/** What actually crosses the wire: JSON, not a live object. */
const stored = (t: Record<string, WorkspaceTabs>): unknown => JSON.parse(JSON.stringify(t));

describe("restoreLayout", () => {
  it("round-trips a layout whose every subject is still alive", () => {
    let t = openChat(emptyTabs, "s1");
    t = openFile(t, "src/a.ts");
    t = openTerminal(t, "t1");
    const back = restoreLayout(stored({ ws1: t }), alive(["s1"], ["t1"]));
    expect(allChats(back.ws1!)).toEqual(["s1"]);
    expect(allFiles(back.ws1!)).toEqual(["src/a.ts"]);
    expect(allTerminals(back.ws1!)).toEqual(["t1"]);
  });

  it("round-trips a full 2x2 including its divider positions", () => {
    let t = openFile(emptyTabs, "a.ts");
    t = splitAt(t, 0, "v");
    t = openTerminal(t, "t1");
    t = splitHalf(t, 0);
    t = openChat(t, "s1");
    t = { ...t, sizes: { main: 0.3, cross: 0.7 } };
    const back = restoreLayout(stored({ ws1: t }), alive(["s1"], ["t1"]))!.ws1!;
    expect(liveSlots(back)).toEqual(liveSlots(t));
    expect(back.split).toBe("v");
    expect(back.subSplit).toEqual([true, false]);
    expect(back.sizes).toEqual({ main: 0.3, cross: 0.7 });
  });

  it("drops chats whose session is gone and terminals whose PTY is gone, keeping files", () => {
    // The point of the whole module: a tab that outlives its subject renders
    // nothing and cannot be closed. A FILE needs no liveness check — the
    // editor already handles a missing file.
    let t = openChat(emptyTabs, "dead");
    t = openFile(t, "src/a.ts");
    t = openTerminal(t, "deadterm");
    const back = restoreLayout(stored({ ws1: t }), alive([], []))!.ws1!;
    expect(allChats(back)).toEqual([]);
    expect(allTerminals(back)).toEqual([]);
    expect(allFiles(back)).toEqual(["src/a.ts"]);
  });

  it("keeps the live half of a mixed set", () => {
    let t = openChat(emptyTabs, "alive");
    t = openChat(t, "dead");
    t = openTerminal(t, "t-alive");
    t = openTerminal(t, "t-dead");
    const back = restoreLayout(stored({ ws1: t }), alive(["alive"], ["t-alive"]))!.ws1!;
    expect(allChats(back)).toEqual(["alive"]);
    expect(allTerminals(back)).toEqual(["t-alive"]);
  });

  it("collapses a pane emptied entirely by pruning", () => {
    let t = openFile(emptyTabs, "src/a.ts");
    t = splitAt(t, 0, "v");
    t = openChat(t, "dead");
    const back = restoreLayout(stored({ ws1: t }), alive([], []))!.ws1!;
    expect(liveSlots(back)).toEqual([0]);
    expect(back.split).toBeNull();
    expect(back.panes[1]).toBeNull();
    expect(back.focused).toBe(0);
    expect(allFiles(back)).toEqual(["src/a.ts"]);
  });

  it("collapses several panes emptied by pruning, without losing the survivors", () => {
    // Pruning shifts slots under itself as panes collapse, which is why the
    // implementation re-finds each tab instead of trusting a captured slot.
    let t = openTerminal(emptyTabs, "dead1");
    t = splitAt(t, 0, "v");
    t = openTerminal(t, "dead2");
    t = splitHalf(t, 0);
    t = openFile(t, "keep.ts");
    const back = restoreLayout(stored({ ws1: t }), alive([], []))!.ws1!;
    expect(allFiles(back)).toEqual(["keep.ts"]);
    expect(allTerminals(back)).toEqual([]);
    expect(liveSlots(back)).toEqual([0]);
    expect(back.split).toBeNull();
  });

  it("drops a workspace whose every tab was pruned rather than storing an empty pane", () => {
    const t = openChat(emptyTabs, "dead");
    expect(restoreLayout(stored({ ws1: t }), alive([], []))).toEqual({});
  });

  it("keeps workspaces independent", () => {
    const a = openTerminal(emptyTabs, "t1");
    const b = openFile(emptyTabs, "b.ts");
    const back = restoreLayout(stored({ ws1: a, ws2: b }), alive([], ["t1"]));
    expect(Object.keys(back).sort()).toEqual(["ws1", "ws2"]);
    expect(allTerminals(back.ws1!)).toEqual(["t1"]);
    expect(allFiles(back.ws2!)).toEqual(["b.ts"]);
  });

  it("refuses junk rather than throwing — a corrupt layout costs tabs, not the app", () => {
    expect(restoreLayout(undefined, alive([], []))).toEqual({});
    expect(restoreLayout(null, alive([], []))).toEqual({});
    expect(restoreLayout("nope", alive([], []))).toEqual({});
    expect(restoreLayout(42, alive([], []))).toEqual({});
    expect(restoreLayout([], alive([], []))).toEqual({});
    expect(restoreLayout({ ws1: { panes: "bad" } }, alive([], []))).toEqual({});
    expect(restoreLayout({ ws1: { panes: [] } }, alive([], []))).toEqual({});
    expect(restoreLayout({ ws1: null }, alive([], []))).toEqual({});
  });

  it("repairs a hand-edited layout instead of trusting it", () => {
    const back = restoreLayout(
      {
        ws1: {
          panes: [{ tabs: ["a.ts", "a.ts"], active: "nope" }, null, null, null],
          split: "diagonal",
          subSplit: [true, true],
          focused: 3,
          sizes: { main: 9, cross: -1 },
        },
      },
      alive([], []),
    )!.ws1!;
    expect(back.split).toBeNull(); // an unknown direction is no split
    expect(back.subSplit).toEqual([false, false]); // cannot sub-split an unsplit pane
    expect(back.panes[0]!.tabs).toEqual(["a.ts"]); // deduplicated
    expect(back.panes[0]!.active).toBe("a.ts"); // an active tab that is not present
    expect(back.focused).toBe(0); // a focus on a dead slot
    expect(back.sizes.main).toBe(0.9); // clamped
    expect(back.sizes.cross).toBe(0.1);
  });

  it("drops a sub-split slot that the geometry does not allow", () => {
    const back = restoreLayout(
      {
        ws1: {
          panes: [
            { tabs: ["a.ts"], active: "a.ts" },
            null,
            { tabs: ["orphan.ts"], active: "orphan.ts" },
            null,
          ],
          split: null,
          subSplit: [true, false],
          focused: 2,
          sizes: { main: 0.5, cross: 0.5 },
        },
      },
      alive([], []),
    )!.ws1!;
    // Slot 2 cannot exist without a primary split, so it goes with it.
    expect(liveSlots(back)).toEqual([0]);
    expect(allFiles(back)).toEqual(["a.ts"]);
  });
});

describe("restoredSessions", () => {
  it("lists every session a restored layout still shows, deduplicated", () => {
    let a = openChat(emptyTabs, "s1");
    a = openChat(a, "s2");
    a = openTerminal(a, "t1");
    const b = openChat(emptyTabs, "s1");
    expect(restoredSessions({ ws1: a, ws2: b }).sort()).toEqual(["s1", "s2"]);
  });

  it("is empty for a layout of files and terminals only", () => {
    const t = openTerminal(openFile(emptyTabs, "a.ts"), "t1");
    expect(restoredSessions({ ws1: t })).toEqual([]);
  });
});

// ── §28 round 1: a browser tab whose pane died must not come back ───────────
describe("restoreLayout — browser tabs", () => {
  it("prunes a browser tab whose pane is gone (the normal case at boot)", () => {
    const t = openBrowserTab(openChat(emptyTabs, "s1"), "b1", null);
    // Panes do not survive the app, so the alive set is empty on a cold start.
    const back = restoreLayout(stored({ ws1: t }), alive(["s1"], [], []))!.ws1!;
    expect(allBrowsers(back)).toEqual([]);
    expect(allChats(back)).toEqual(["s1"]); // the chat is untouched
  });

  it("keeps one whose pane is still alive (a renderer reload)", () => {
    const t = openBrowserTab(openChat(emptyTabs, "s1"), "b1", null);
    const back = restoreLayout(stored({ ws1: t }), alive(["s1"], [], ["b1"]))!.ws1!;
    expect(allBrowsers(back)).toEqual(["b1"]);
  });

  it("drops the workspace entirely when the browser was its only tab", () => {
    const t = openBrowserTab(emptyTabs, "b1", null);
    expect(restoreLayout(stored({ ws1: t }), alive([], [], [])).ws1).toBeUndefined();
  });
});

describe("a workspace that is no longer registered", () => {
  /**
   * Pruning used to ask only "is this tab's SUBJECT still alive" and never "does
   * this workspace still exist". Remove a workspace that had a file tab open,
   * relaunch, and its tabs came back for a workspace main no longer knows —
   * every `hv:fs-read` and `hv:watch-workspace` for them throwing
   * "Unknown workspace", forever, with no way to reach the tabs and close them.
   */
  it("is dropped entirely, tabs and all", () => {
    const gone = openFile(emptyTabs, "notes.txt");
    const kept = openFile(emptyTabs, "src/a.ts");
    const back = restoreLayout(stored({ removed: gone, live: kept }), alive([], [], [], ["live"]));
    expect(Object.keys(back)).toEqual(["live"]);
    expect(allFiles(back.live!)).toEqual(["src/a.ts"]);
  });

  it("takes its chat tabs with it, so no dead session is reopened", () => {
    const gone = openChat(emptyTabs, "s-gone");
    const kept = openChat(emptyTabs, "s-kept");
    const back = restoreLayout(stored({ removed: gone, live: kept }), alive(["s-gone", "s-kept"], [], [], ["live"]));
    expect(restoredSessions(back)).toEqual(["s-kept"]);
  });

  it("keeps every workspace when the caller does not know the list", () => {
    // Absent `workspaces` means "cannot tell" — and losing a user's tab
    // arrangement on a doubt is worse than the error it would prevent.
    const t = openFile(emptyTabs, "a.ts");
    const back = restoreLayout(stored({ ws1: t }), alive([], []));
    expect(Object.keys(back)).toEqual(["ws1"]);
  });

  it("returns nothing when every workspace is gone", () => {
    const t = openFile(emptyTabs, "a.ts");
    expect(restoreLayout(stored({ ws1: t }), alive([], [], [], []))).toEqual({});
  });
});
