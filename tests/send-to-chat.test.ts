import { expect, test } from "vitest";
import { formatSelection } from "../src/renderer/src/sendToChat";

test("a multi-line selection is fenced and headed with path and range", () => {
  const out = formatSelection("src/a.ts", 10, 12, "const a = 1;\nconst b = 2;");
  expect(out).toContain("src/a.ts:10-12");
  expect(out).toContain("const a = 1;");
  expect(out).toContain("```ts");
});

test("a single-line selection names one line, not a range", () => {
  const out = formatSelection("src/a.ts", 7, 7, "x");
  expect(out).toContain("src/a.ts:7");
  expect(out).not.toContain("7-7");
});

test("the fence language comes from the extension", () => {
  expect(formatSelection("a.py", 1, 1, "pass")).toContain("```py");
  expect(formatSelection("a.rs", 1, 1, "x")).toContain("```rs");
});

test("an unknown extension gets a bare fence, not a bogus language", () => {
  const out = formatSelection("a.unknownext", 1, 1, "x");
  expect(out).toContain("```\n");
  expect(out).not.toMatch(/```unknownext/);
});

test("a fence inside the selection cannot break out of the block", () => {
  const out = formatSelection("a.md", 1, 3, "```\ncode\n```");
  // The wrapper must be LONGER than the longest run inside it.
  const longestInside = 3;
  const wrapper = out.slice(out.indexOf("`"), out.indexOf("`") + 10).match(/^`+/)?.[0] ?? "";
  expect(wrapper.length).toBeGreaterThan(longestInside);
});

test("the selection text is never altered", () => {
  const text = "  indented\n\tand tabbed  ";
  expect(formatSelection("a.ts", 1, 2, text)).toContain(text);
});
