/**
 * `PromptRow` — the row shared by All Tools (§13 round 6) and "On your behalf"
 * (§19, 2026-08-30): a switch, a read-only prompt, an append box.
 *
 * The renderer suite has NO DOM (vitest.config.ts includes tests/**\/*.test.ts
 * only — no .tsx, no jsdom, no testing-library), so a visual contract is pinned
 * in two halves: the copy as an exported CONSTANT, and the absence of a second
 * copy as a source scan. That is the better shape here anyway — what matters is
 * that the append-never-override sentence exists in exactly ONE place, and an
 * absence is precisely what a render test cannot fail on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { APPEND_HELP } from "../src/renderer/src/components/PromptRow";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the append-never-override rule is stated, and states both halves", () => {
  // PRD §13 round 6: the built-in text stays authoritative and visible, the
  // user adds to it. Both halves have to be said or the box reads as an editor.
  expect(APPEND_HELP).toMatch(/can't be edited/);
  expect(APPEND_HELP).toMatch(/appended after it/);
});

test("BuiltinToolsBlock uses the shared row instead of its own copy", () => {
  const src = read("src/renderer/src/components/BuiltinToolsBlock.tsx");
  expect(src).toMatch(/PromptRow/);
  // The help string and the switch both lived here as local definitions. One
  // definition each, now, or the two pages drift apart on the sentence that
  // explains why the prompt is read-only.
  expect(src).not.toMatch(/The built-in prompt above can't be edited/);
  expect(src).not.toMatch(/function TogglePill/);
});

test("the read-only prompt block exists in exactly one component", () => {
  // Three rows rendered this <pre> verbatim before the extraction.
  const files = [
    "src/renderer/src/components/PromptRow.tsx",
    "src/renderer/src/components/BuiltinToolsBlock.tsx",
  ];
  const total = files.reduce((n, f) => n + (read(f).match(/built-in prompt \(read-only\)/g) ?? []).length, 0);
  expect(total).toBe(1);
});
