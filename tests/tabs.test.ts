import { expect, test } from "vitest";
import { activateTab, bufferKey, closeFile, emptyTabs, openFile, resolveCardPath } from "../src/renderer/src/tabs";

// ── tab state (chat tab = active: null; files are rel paths) ─────────

test("openFile adds and activates; reopening just refocuses", () => {
  let t = openFile(emptyTabs, "src/a.ts");
  expect(t).toEqual({ files: ["src/a.ts"], active: "src/a.ts" });
  t = openFile(t, "b.md");
  t = openFile(t, "src/a.ts");
  expect(t.files).toEqual(["src/a.ts", "b.md"]); // no duplicate
  expect(t.active).toBe("src/a.ts");
});

test("closeFile focuses right neighbor, then left, then chat", () => {
  let t = openFile(openFile(openFile(emptyTabs, "a"), "b"), "c");
  t = activateTab(t, "b");
  t = closeFile(t, "b");
  expect(t).toEqual({ files: ["a", "c"], active: "c" }); // right neighbor
  t = closeFile(t, "c");
  expect(t).toEqual({ files: ["a"], active: "a" }); // left neighbor
  t = closeFile(t, "a");
  expect(t).toEqual({ files: [], active: null }); // back to chat
});

test("closing an inactive tab keeps the active one; unknown close is a no-op", () => {
  let t = openFile(openFile(emptyTabs, "a"), "b");
  t = closeFile(t, "a");
  expect(t.active).toBe("b");
  expect(closeFile(t, "nope")).toBe(t);
});

test("activateTab ignores unknown targets; null focuses chat", () => {
  const t = openFile(emptyTabs, "a");
  expect(activateTab(t, "nope")).toBe(t);
  expect(activateTab(t, null).active).toBeNull();
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
  // Prefix sibling must not match ("/Users/me/proj2" is NOT inside "/Users/me/proj").
  expect(resolveCardPath("/Users/me/proj", "/Users/me/proj2/a.ts")).toBeNull();
});

test("relative paths normalize; escapes above the root → null", () => {
  expect(resolveCardPath("/ws", "src/a.ts")).toBe("src/a.ts");
  expect(resolveCardPath("/ws", "./src/./a.ts")).toBe("src/a.ts");
  expect(resolveCardPath("/ws", "src/../b.md")).toBe("b.md");
  expect(resolveCardPath("/ws", "../outside")).toBeNull();
  expect(resolveCardPath("/ws", "src/../../x")).toBeNull();
});
