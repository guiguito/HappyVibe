import { expect, test } from "vitest";
import { buildOpenFilesBlock, openFilesChanged } from "../src/main/files";
import { stripInjectedBlocks } from "../src/renderer/src/mentions";

test("the block lists workspace-relative paths and no content", () => {
  const b = buildOpenFilesBlock(["src/a.ts", "docs/b.md"]);
  expect(b).toContain("src/a.ts");
  expect(b).toContain("docs/b.md");
  expect(b.startsWith("<open-files>")).toBe(true);
  // Never the mention block's content-bearing form — paths only, by design.
  expect(b).not.toContain('<file path=');
});

test("no open files → no block at all", () => {
  expect(buildOpenFilesBlock([])).toBe("");
});

test("paths are sorted, so an unchanged set always renders identically", () => {
  expect(buildOpenFilesBlock(["b", "a"])).toBe(buildOpenFilesBlock(["a", "b"]));
});

test("change detection ignores order and is true on the first send", () => {
  expect(openFilesChanged(undefined, ["a"])).toBe(true);
  expect(openFilesChanged(["a", "b"], ["b", "a"])).toBe(false);
  expect(openFilesChanged(["a"], ["a", "b"])).toBe(true);
  expect(openFilesChanged(["a"], [])).toBe(true);
});

test("an empty set that was already empty is not a change (no first-send block)", () => {
  expect(openFilesChanged([], [])).toBe(false);
});




// The shared renderer-side stripper feeds transcript display, restore AND the
// prompt-template pairing — so <open-files> belongs there, not in each consumer.
test("stripInjectedBlocks removes an open-files block from a displayed message", () => {
  const typed = "what does this do?";
  const sent = `${typed}\n\n${buildOpenFilesBlock(["src/a.ts", "src/b.ts"])}`;
  expect(stripInjectedBlocks(sent)).toBe(typed);
});

test("stripInjectedBlocks removes mention blocks AND an open-files block together", () => {
  const typed = "check @a.ts";
  const sent = `${typed}\n\n<file path="a.ts">x</file>\n\n${buildOpenFilesBlock(["a.ts"])}`;
  expect(stripInjectedBlocks(sent)).toBe(typed);
});
