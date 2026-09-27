/**
 * `find` is a read-only Pi builtin, so it is safe-default-allowed like read/grep/ls —
 * and, like them, still ASKS when it reaches outside the workspace (2026-09-27).
 */
import { expect, it } from "vitest";
import { EMPTY_RULES, evaluate, FILE_TOOLS, SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";

it("find is safe inside the workspace", () => {
  expect(SAFE_TOOLS.has("find")).toBe(true);
  expect(evaluate(EMPTY_RULES, { tool: "find", input: { pattern: "**/*", path: "/ws/src" }, workspace: "/ws" }))
    .toMatchObject({ action: "allow", source: "safe-default" });
});

it("find outside the workspace still asks", () => {
  expect(FILE_TOOLS.has("find")).toBe(true);
  expect(evaluate(EMPTY_RULES, { tool: "find", input: { pattern: "*", path: "/etc" }, workspace: "/ws" }))
    .toMatchObject({ action: "ask", source: "outside-workspace", outsidePath: "/etc" });
});
