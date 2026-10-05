/**
 * §13 (2026-10-05): the MCP page on Pi's built-in MCP — copy as DATA, absences by source scan
 * (no DOM in this suite).
 */
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_OVERRIDDEN_PILL, MCP_SIGNIN_COPY } from "../src/renderer/src/components/McpServersSection";

const src = readFileSync("src/renderer/src/components/McpServersSection.tsx", "utf8");

test("sign-in copy", () => {
  expect(MCP_SIGNIN_COPY).toEqual({
    waiting: "Waiting for sign-in in your browser…",
    reopen: "Open the sign-in page again",
    cancel: "Cancel",
  });
});

test("a workspace server a global one overrides says so", () => {
  expect(MCP_OVERRIDDEN_PILL.label).toBe("overridden");
  expect(MCP_OVERRIDDEN_PILL.title).toBe("Overridden by your global server of the same name");
  expect(src).toMatch(/state === "overridden"/);
});

test("Cancel really cancels the sign-in (frees Pi's callback port), not just the modal", () => {
  expect(src).toContain("window.hv.mcpSigninCancel()");
  expect(src).toContain("window.hv.onMcpSignin(");
});

test("adapter-era keys are gone from the page; descriptions render only when present", () => {
  expect(src).not.toMatch(/cfg\.disabled|directTools/);
  expect(src).toMatch(/\{t\.description && /);
});
