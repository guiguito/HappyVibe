import { expect, test } from "vitest";
import {
  activateTab, allFiles, bufferKey, CHAT_TAB, closeTab, emptyTabs, moveTab, openFile,
  resolveCardPath, splitPane, unsplit,
} from "../src/renderer/src/tabs";

// ── single-pane tab state (chat = CHAT_TAB tab, always present) ─────────

test("emptyTabs starts with a single pane holding the chat tab", () => {
  expect(emptyTabs.panes).toHaveLength(1);
  expect(emptyTabs.panes[0]).toEqual({ tabs: [CHAT_TAB], active: CHAT_TAB });
  expect(emptyTabs.split).toBeNull();
});

test("openFile adds and activates in the focused pane; reopening refocuses", () => {
  let t = openFile(emptyTabs, "src/a.ts");
  expect(t.panes[0].tabs).toEqual([CHAT_TAB, "src/a.ts"]);
  expect(t.panes[0].active).toBe("src/a.ts");
  t = openFile(t, "b.md");
  t = openFile(t, "src/a.ts");
  expect(t.panes[0].tabs).toEqual([CHAT_TAB, "src/a.ts", "b.md"]); // no duplicate
  expect(t.panes[0].active).toBe("src/a.ts");
});

test("closeTab focuses right neighbor, then left; chat is never emptied away", () => {
  let t = openFile(openFile(openFile(emptyTabs, "a"), "b"), "c");
  t = activateTab(t, 0, "b");
  t = closeTab(t, 0, "b");
  expect(t.panes[0].active).toBe("c"); // right neighbor
  t = closeTab(t, 0, "c");
  expect(t.panes[0].active).toBe("a"); // left neighbor
  t = closeTab(t, 0, "a");
  expect(t.panes[0].active).toBe(CHAT_TAB); // back to chat
  expect(t.panes[0].tabs).toEqual([CHAT_TAB]);
});

test("allFiles lists file paths across panes, excluding chat", () => {
  let t = openFile(openFile(emptyTabs, "a"), "b");
  t = splitPane(t, "v");
  t = openFile(t, "c"); // goes to the new focused (2nd) pane
  expect(allFiles(t).sort()).toEqual(["a", "b", "c"]);
});

// ── split view ──────────────────────────────────────────────────────────

test("splitPane opens an empty second pane and focuses it", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  expect(t.split).toBe("v");
  expect(t.panes).toHaveLength(2);
  expect(t.panes[1]).toEqual({ tabs: [], active: null });
  expect(t.focused).toBe(1);
  // next openFile fills the empty pane
  t = openFile(t, "b");
  expect(t.panes[1].tabs).toEqual(["b"]);
});

test("splitPane again only changes direction", () => {
  let t = splitPane(openFile(emptyTabs, "a"), "v");
  t = openFile(t, "b");
  t = splitPane(t, "h");
  expect(t.split).toBe("h");
  expect(t.panes).toHaveLength(2);
});

test("moveTab moves a tab across panes and collapses an emptied pane", () => {
  let t = openFile(emptyTabs, "a"); // pane0: [chat, a]
  t = splitPane(t, "v"); // pane1: []
  t = openFile(t, "b"); // pane1: [b]
  t = moveTab(t, "a", 1); // pane0: [chat], pane1: [b, a]
  expect(t.panes[0].tabs).toEqual([CHAT_TAB]);
  expect(t.panes[1].tabs).toEqual(["b", "a"]);
  expect(t.panes[1].active).toBe("a");
  // move chat too → pane0 empties → collapse to single pane
  t = moveTab(t, CHAT_TAB, 1);
  expect(t.split).toBeNull();
  expect(t.panes).toHaveLength(1);
  expect(t.panes[0].tabs).toEqual(["b", "a", CHAT_TAB]);
});

test("moveTab is a no-op without a target pane or for an unknown tab", () => {
  const t = openFile(emptyTabs, "a");
  expect(moveTab(t, "a", 1)).toBe(t); // not split
  const s = openFile(splitPane(t, "v"), "b");
  expect(moveTab(s, "nope", 0)).toBe(s);
});

test("unsplit merges the second pane back into the first", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  t = openFile(t, "b");
  t = unsplit(t);
  expect(t.split).toBeNull();
  expect(t.panes).toHaveLength(1);
  expect(t.panes[0].tabs).toEqual([CHAT_TAB, "a", "b"]);
});

test("activateTab focuses a tab and its pane; ignores unknown", () => {
  let t = openFile(emptyTabs, "a");
  t = splitPane(t, "v");
  t = openFile(t, "b"); // pane1
  t = activateTab(t, 0, CHAT_TAB);
  expect(t.focused).toBe(0);
  expect(t.panes[0].active).toBe(CHAT_TAB);
  expect(activateTab(t, 0, "nope")).toBe(t);
});

test("bufferKey is unambiguous across workspaces", () => {
  expect(bufferKey("/ws/one", "a.ts")).not.toBe(bufferKey("/ws/two", "a.ts"));
});

// ── card-path resolution (clickable paths on tool/diff cards) ────────

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
