import { expect, test } from "vitest";
import { workspaceEmoji } from "../src/renderer/src/workspaceEmoji";

test("deterministic for the same path", () => {
  expect(workspaceEmoji("/Users/me/proj")).toBe(workspaceEmoji("/Users/me/proj"));
});

test("trailing slashes do not change the pick", () => {
  expect(workspaceEmoji("/Users/me/proj/")).toBe(workspaceEmoji("/Users/me/proj"));
  expect(workspaceEmoji("/Users/me/proj///")).toBe(workspaceEmoji("/Users/me/proj"));
});

test("different paths spread across the palette", () => {
  const paths = ["/a/one", "/a/two", "/a/three", "/a/four", "/a/five", "/a/six"];
  const picks = new Set(paths.map(workspaceEmoji));
  expect(picks.size).toBeGreaterThan(2);
});

test("always returns a non-empty emoji, even for degenerate input", () => {
  expect(workspaceEmoji("")).toBeTruthy();
  expect(workspaceEmoji("/")).toBeTruthy();
  expect(workspaceEmoji("///")).toBeTruthy();
});

test("a sibling directory generally gets a different emoji", () => {
  // Not guaranteed by the hash, but must hold for these two or the spread is broken.
  expect(workspaceEmoji("/Users/me/HappyVibe")).not.toBe(workspaceEmoji("/Users/me/Flipside"));
});
