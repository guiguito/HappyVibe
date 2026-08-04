import { expect, test } from "vitest";
import { errorSummary } from "../src/renderer/src/components/ToolCard";

test("first non-empty line, trimmed — the stack stays behind the toggle", () => {
  expect(errorSummary("\n\nENOENT: no such file\nstack line 1\nstack line 2")).toBe("ENOENT: no such file");
});

test("long single lines are clipped with an ellipsis", () => {
  expect(errorSummary("x".repeat(200), 40)).toBe("x".repeat(40) + "…");
});

test("a line exactly at the limit is not clipped", () => {
  expect(errorSummary("y".repeat(40), 40)).toBe("y".repeat(40));
});

test("non-string results are stringified", () => {
  expect(errorSummary({ code: "EACCES" })).toContain("EACCES");
});

test("empty or missing results yield a stable fallback", () => {
  expect(errorSummary("")).toBe("The tool reported an error.");
  expect(errorSummary(undefined)).toBe("The tool reported an error.");
  expect(errorSummary(null)).toBe("The tool reported an error.");
  expect(errorSummary("\n \n")).toBe("The tool reported an error.");
});
