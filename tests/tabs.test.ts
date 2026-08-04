import { expect, test } from "vitest";
import {
  activateTab, activeTabOf, allChats, allFiles, bufferKey, chatTab, closeTab, emptyTabs, isChatTab,
  closePane, closeSessionTabs, liveSlots, moveTab, openChat, openFile, splitAt, splitOptions, resolveCardPath, sessionOf, setSize, splitHalf, splitPane,
  unsplit,
} from "../src/renderer/src/tabs";

// ── tab identity: a chat is per SESSION (round 11) ───────────────────────────

test("emptyTabs starts with one empty pane and no split", () => {
  expect(liveSlots(emptyTabs)).toEqual([0]);
  expect(emptyTabs.panes[0]).toEqual({ tabs: [], active: null });
  expect(emptyTabs.split).toBeNull();
  expect(emptyTabs.sizes.main).toBe(0.5);
});

test("chatTab round-trips through sessionOf; a file path is not a chat", () => {
  expect(sessionOf(chatTab("abc"))).toBe("abc");
  expect(isChatTab(chatTab("abc"))).toBe(true);
  expect(sessionOf("src/a.ts")).toBeNull();
  expect(isChatTab("src/a.ts")).toBe(false);
});

test("opening a second session ADDS a tab instead of replacing the first", () => {
  let t = openChat(emptyTabs, "s1");
  t = openChat(t, "s2");
  expect(t.panes[0].tabs).toEqual([chatTab("s1"), chatTab("s2")]);
  expect(t.panes[0].active).toBe(chatTab("s2"));
});

test("reopening an already-open session focuses its tab, adding nothing", () => {
  let t = openChat(openChat(emptyTabs, "s1"), "s2");
  t = openChat(t, "s1");
  expect(t.panes[0].tabs).toHaveLength(2);
  expect(t.panes[0].active).toBe(chatTab("s1"));
});

test("allChats lists every session with an open chat tab, across panes", () => {
  let t = openChat(openChat(emptyTabs, "s1"), "s2");
  t = splitPane(t, "v");
  t = openChat(t, "s3");
  expect(allChats(t).sort()).toEqual(["s1", "s2", "s3"]);
});

// ── files ────────────────────────────────────────────────────────────────────

test("openFile adds and activates in the focused pane; reopening refocuses", () => {
  let t = openFile(emptyTabs, "src/a.ts");
  expect(t.panes[0].tabs).toEqual(["src/a.ts"]);
  t = openFile(t, "b.md");
  t = openFile(t, "src/a.ts");
  expect(t.panes[0].tabs).toEqual(["src/a.ts", "b.md"]); // no duplicate
  expect(t.panes[0].active).toBe("src/a.ts");
});

test("allFiles lists file paths across every pane, excluding chats", () => {
  let t = openFile(openChat(emptyTabs, "s1"), "a");
  t = splitPane(t, "v");
  t = openFile(t, "b");
  t = splitHalf(t, 1);
  t = openFile(t, "c");
  expect(allFiles(t).sort()).toEqual(["a", "b", "c"]);
});

test("closeTab focuses the right neighbour, then the left", () => {
  let t = openFile(openFile(openFile(emptyTabs, "a"), "b"), "c");
  t = activateTab(t, 0, "b");
  t = closeTab(t, 0, "b");
  expect(t.panes[0].active).toBe("c"); // right neighbour
  t = closeTab(t, 0, "c");
  expect(t.panes[0].active).toBe("a"); // left neighbour
});

test("closing the last tab leaves one empty pane, not a broken layout", () => {
  let t = openFile(emptyTabs, "a");
  t = closeTab(t, 0, "a");
  expect(liveSlots(t)).toEqual([0]);
  expect(t.panes[0].tabs).toEqual([]);
  expect(t.split).toBeNull();
});

// ── 2×2 splits ───────────────────────────────────────────────────────────────

test("splitPane opens an empty second half and focuses it", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  expect(t.split).toBe("v");
  expect(liveSlots(t)).toEqual([0, 1]);
  expect(t.panes[1]).toEqual({ tabs: [], active: null });
  expect(t.focused).toBe(1);
  t = openFile(t, "b");
  expect(t.panes[1]!.tabs).toEqual(["b"]);
});

test("splitPane again only changes the primary direction", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitPane(t, "h");
  expect(t.split).toBe("h");
  expect(liveSlots(t)).toEqual([0, 1]);
});

test("splitting a half gives a third pane; splitting both gives four", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  expect(liveSlots(t)).toEqual([0, 1, 2]);
  expect(t.subSplit).toEqual([true, false]);
  expect(t.focused).toBe(2);
  t = openFile(t, "c");
  t = splitHalf(t, 1);
  expect(liveSlots(t)).toEqual([0, 1, 2, 3]);
  expect(t.subSplit).toEqual([true, true]);
});

test("a half cannot be split twice — 2x2 is the ceiling", () => {
  const t = splitHalf(openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b"), 0);
  expect(splitHalf(t, 0)).toBe(t);
});

test("splitHalf without a primary split is a no-op", () => {
  const t = openFile(emptyTabs, "a");
  expect(splitHalf(t, 0)).toBe(t);
});

test("emptying a cross partner collapses that half only", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  t = openFile(t, "c"); // lands in slot 2
  expect(liveSlots(t)).toEqual([0, 1, 2]);
  t = closeTab(t, 2, "c");
  expect(t.subSplit).toEqual([false, false]);
  expect(liveSlots(t)).toEqual([0, 1]);
  expect(t.split).toBe("v"); // the primary split survives
});

test("emptying half A promotes its cross partner into half A", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  t = openFile(t, "c");
  t = closeTab(t, 0, "a"); // half A's primary pane empties
  expect(t.panes[0].tabs).toEqual(["c"]);
  expect(t.subSplit).toEqual([false, false]);
  expect(liveSlots(t)).toEqual([0, 1]);
});

test("emptying half A entirely slides half B over and drops the split", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = closeTab(t, 0, "a");
  expect(t.split).toBeNull();
  expect(liveSlots(t)).toEqual([0]);
  expect(t.panes[0].tabs).toEqual(["b"]);
});

test("when only a cross-split half remains, its split becomes the primary one", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 1); // slot 3 under half B
  t = openFile(t, "c");
  t = closeTab(t, 0, "a"); // half A gone; B was cross-split
  expect(liveSlots(t)).toEqual([0, 1]);
  expect(t.split).toBe("h"); // was the CROSS axis of "v"
  expect(t.subSplit).toEqual([false, false]);
  expect(allFiles(t).sort()).toEqual(["b", "c"]);
});

test("unsplit merges every pane's tabs into one, in slot order", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = splitHalf(t, 0);
  t = openFile(t, "c");
  t = unsplit(t);
  expect(t.split).toBeNull();
  expect(liveSlots(t)).toEqual([0]);
  expect(t.panes[0].tabs).toEqual(["a", "b", "c"]);
});

// ── moving tabs between panes ────────────────────────────────────────────────

test("moveTab moves a tab across panes and collapses an emptied one", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  t = openFile(t, "b");
  t = moveTab(t, "a", 1);
  expect(t.panes[0]!.tabs).toEqual(["b", "a"]); // pane 0 emptied → B slid over
  expect(t.split).toBeNull();
});

test("moveTab keeps both panes when the source still has tabs", () => {
  let t = openFile(openFile(emptyTabs, "a"), "b");
  t = splitPane(t, "v");
  t = openFile(t, "c");
  t = moveTab(t, "a", 1);
  expect(t.panes[0].tabs).toEqual(["b"]);
  expect(t.panes[1]!.tabs).toEqual(["c", "a"]);
  expect(t.panes[1]!.active).toBe("a");
});

test("moveTab is a no-op without a target pane or for an unknown tab", () => {
  const t = openFile(emptyTabs, "a");
  expect(moveTab(t, "a", 1)).toBe(t); // not split
  const s = openFile(splitPane(t, "v"), "b");
  expect(moveTab(s, "nope", 0)).toBe(s);
});

test("a chat tab can be moved like any other", () => {
  let t = openChat(openFile(emptyTabs, "a"), "s1");
  t = splitPane(t, "v");
  t = openFile(t, "b");
  t = moveTab(t, chatTab("s1"), 1);
  expect(t.panes[1]!.tabs).toContain(chatTab("s1"));
  expect(allChats(t)).toEqual(["s1"]);
});

// ── pane sizes ───────────────────────────────────────────────────────────────

test("sizes default to 0.5 and clamp to a visible range", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "v");
  expect(t.sizes.main).toBe(0.5);
  expect(setSize(t, "main", 0.94).sizes.main).toBe(0.9);
  expect(setSize(t, "main", 0.02).sizes.main).toBe(0.1);
  expect(setSize(t, "main", 0.35).sizes.main).toBe(0.35);
});

test("the cross divider is SHARED by both halves — a flat grid has one inner track", () => {
  let t = splitPane(openFile(emptyTabs, "a"), "v");
  t = setSize(t, "cross", 0.3);
  expect(t.sizes.cross).toBe(0.3);
  expect(setSize(t, "cross", 0.99).sizes.cross).toBe(0.9);
});

// ── focus ────────────────────────────────────────────────────────────────────

test("activateTab focuses a tab and its pane; ignores unknown", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  t = openFile(t, "b"); // slot 1
  t = activateTab(t, 0, "a");
  expect(t.focused).toBe(0);
  expect(activeTabOf(t)).toBe("a");
  expect(activateTab(t, 0, "nope")).toBe(t);
});

test("focused always survives a collapse", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  expect(t.focused).toBe(1);
  t = closeTab(t, 1, "b"); // the focused pane disappears
  expect(liveSlots(t)).toContain(t.focused);
});

// ── unchanged helpers ────────────────────────────────────────────────────────

test("bufferKey is unambiguous across workspaces", () => {
  expect(bufferKey("/ws/one", "a.ts")).not.toBe(bufferKey("/ws/two", "a.ts"));
});

test("absolute path inside the workspace → relative", () => {
  expect(resolveCardPath("/Users/me/proj", "/Users/me/proj/src/a.ts")).toBe("src/a.ts");
  expect(resolveCardPath("/Users/me/proj/", "/Users/me/proj/src/a.ts")).toBe("src/a.ts");
});

test("absolute path outside the workspace → null (no link)", () => {
  expect(resolveCardPath("/Users/me/proj", "/etc/passwd")).toBeNull();
  expect(resolveCardPath("/Users/me/proj", "/Users/me/proj2/a.ts")).toBeNull();
});

test("relative paths normalize; escapes above the root → null", () => {
  expect(resolveCardPath("/ws", "src/a.ts")).toBe("src/a.ts");
  expect(resolveCardPath("/ws", "./src/./a.ts")).toBe("src/a.ts");
  expect(resolveCardPath("/ws", "src/../b.md")).toBe("b.md");
  expect(resolveCardPath("/ws", "../outside")).toBeNull();
  expect(resolveCardPath("/ws", "src/../../x")).toBeNull();
});

// ── round 11 regression: closing a chat tab must not strand the layout ───────

/**
 * Reported: "closed a new session opened from tab bar and design crashed."
 *
 * The center area rendered nothing at all — no strip, no toolbar, not even the
 * empty-pane placeholder — while the sidebar still showed the sessions as open.
 * Cause was in App: `wsId` was derived from the SELECTED session, and closing the
 * focused chat tab cleared `selectedId`, so the whole layout became
 * unrenderable even though every tab, file and unsaved buffer still existed.
 *
 * These pin the two halves of the fix that live in this module: closing a chat
 * leaves a sibling ACTIVE (so selection has somewhere to go), and the layout is
 * never emptied while other tabs remain.
 */
test("closing the active chat activates a sibling chat, so selection has a target", () => {
  let t = openChat(openChat(emptyTabs, "s1"), "s2");
  expect(t.panes[0].active).toBe(chatTab("s2"));
  t = closeTab(t, 0, chatTab("s2"));
  expect(t.panes[0].active).toBe(chatTab("s1"));
  expect(sessionOf(activeTabOf(t)!)).toBe("s1");
});

test("closing the only chat leaves file tabs — and something still active", () => {
  let t = openFile(openChat(emptyTabs, "s1"), "a.ts");
  t = closeTab(t, 0, chatTab("s1"));
  expect(t.panes[0].tabs).toEqual(["a.ts"]);
  expect(activeTabOf(t)).toBe("a.ts");
  expect(allChats(t)).toEqual([]);
});

test("closing a chat in one pane never touches another pane's tabs", () => {
  let t = openChat(openChat(emptyTabs, "s1"), "s2");
  t = splitPane(t, "v");
  t = openFile(t, "a.ts");
  t = closeTab(t, 0, chatTab("s2"));
  expect(t.panes[0].tabs).toEqual([chatTab("s1")]);
  expect(t.panes[1]!.tabs).toEqual(["a.ts"]);
  expect(liveSlots(t)).toEqual([0, 1]);
});

test("closing the last tab of all leaves ONE empty pane that can still render", () => {
  let t = openChat(emptyTabs, "s1");
  t = closeTab(t, 0, chatTab("s1"));
  expect(liveSlots(t)).toEqual([0]);
  expect(t.panes[0]).toEqual({ tabs: [], active: null });
  expect(t.split).toBeNull();
});

test("closeSessionTabs drops a deleted session's tab wherever it lives", () => {
  let t = openChat(openChat(emptyTabs, "s1"), "s2");
  t = splitPane(t, "v");
  t = openChat(t, "s3");
  t = closeSessionTabs(t, "s1");
  expect(allChats(t).sort()).toEqual(["s2", "s3"]);
  t = closeSessionTabs(t, "s3"); // empties pane 1 → collapses
  expect(allChats(t)).toEqual(["s2"]);
  expect(t.split).toBeNull();
});

test("closeSessionTabs is a no-op for a session with no tab", () => {
  const t = openChat(emptyTabs, "s1");
  expect(closeSessionTabs(t, "nope")).toBe(t);
});

// ── per-pane split controls (round 11, after GUI feedback) ───────────────────

/**
 * The global toolbar's "split this half again" acted on the FOCUSED half — state
 * the user cannot see — and "split horizontally" while already split vertically
 * silently ROTATED the layout instead of adding a pane. Both are replaced by
 * per-pane controls, so a button in a strip only ever affects that strip's pane
 * and is offered only when it is legal.
 */
test("an unsplit pane offers both directions", () => {
  expect(splitOptions(emptyTabs, 0)).toEqual({ v: true, h: true });
});

test("once split, a half can only divide on the CROSS axis", () => {
  const v = splitPane(openFile(emptyTabs, "a"), "v");
  expect(splitOptions(v, 0)).toEqual({ v: false, h: true });
  expect(splitOptions(v, 1)).toEqual({ v: false, h: true });
  const h = splitPane(openFile(emptyTabs, "a"), "h");
  expect(splitOptions(h, 0)).toEqual({ v: true, h: false });
});

test("a cross partner is the ceiling — no direction is offered", () => {
  const t = splitHalf(splitPane(openFile(emptyTabs, "a"), "v"), 0);
  expect(splitOptions(t, 2)).toEqual({ v: false, h: false });
});

test("an already-cross-split half offers nothing", () => {
  const t = splitHalf(splitPane(openFile(emptyTabs, "a"), "v"), 0);
  expect(splitOptions(t, 0)).toEqual({ v: false, h: false });
});

test("splitOptions is empty for a slot that does not exist", () => {
  expect(splitOptions(emptyTabs, 1)).toEqual({ v: false, h: false });
});

test("splitAt creates the primary split from the only pane", () => {
  const t = splitAt(openFile(emptyTabs, "a"), 0, "v");
  expect(t.split).toBe("v");
  expect(liveSlots(t)).toEqual([0, 1]);
});

test("splitAt divides the pane it names, not the focused one", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  expect(t.focused).toBe(1);
  t = splitAt(t, 0, "h"); // pane 0, while pane 1 is focused
  expect(t.subSplit).toEqual([true, false]);
  expect(liveSlots(t)).toEqual([0, 1, 2]);
});

test("splitAt is a no-op for an illegal direction — never a silent rotate", () => {
  const t = splitPane(openFile(emptyTabs, "a"), "v");
  expect(splitAt(t, 0, "v")).toBe(t); // would have rotated the layout before
  expect(splitAt(t, 2, "h")).toBe(t); // no such pane
});

test("closePane moves its tabs into a sibling and collapses", () => {
  let t = openFile(openFile(emptyTabs, "a"), "b");
  t = splitPane(t, "v");
  t = openFile(t, "c");
  t = closePane(t, 1);
  expect(t.split).toBeNull();
  expect(liveSlots(t)).toEqual([0]);
  expect(t.panes[0].tabs).toEqual(["a", "b", "c"]);
});

test("closePane keeps the remaining split when four panes become three", () => {
  let t = openFile(splitPane(openFile(emptyTabs, "a"), "v"), "b");
  t = openFile(splitHalf(t, 0), "c");
  t = openFile(splitHalf(t, 1), "d");
  expect(liveSlots(t)).toEqual([0, 1, 2, 3]);
  t = closePane(t, 2);
  expect(t.subSplit).toEqual([false, true]);
  expect(allFiles(t).sort()).toEqual(["a", "b", "c", "d"]); // nothing lost
});

test("closePane refuses on the last pane — there is nowhere to move the tabs", () => {
  const t = openFile(emptyTabs, "a");
  expect(closePane(t, 0)).toBe(t);
});
