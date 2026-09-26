/**
 * The run card's change gate (src/main/subagentStatus.ts). A push is skipped when
 * nothing the card shows has moved — so every field the card reads has to count.
 */
import { expect, test } from "vitest";
import { statusUnchanged } from "../src/main/subagentStatus";

test("compares only live-progress fields", () => {
  const base = { state: "running", activityState: undefined, currentTool: "read", turnCount: 1, toolCount: 2 };
  expect(statusUnchanged(base, { ...base })).toBe(true);
  expect(statusUnchanged(base, { ...base, currentTool: "grep" })).toBe(false);
  expect(statusUnchanged(base, { ...base, turnCount: 2 })).toBe(false);
  expect(statusUnchanged(null, base)).toBe(false);
  expect(statusUnchanged(null, null)).toBe(true);
});

test("a child's session file arriving is news — it unlocks the cost readout", () => {
  const before = { state: "running", turnCount: 1 };
  const after = { state: "running", turnCount: 1, children: [{ sessionFile: "/s/subagents/c.jsonl" }] };
  expect(statusUnchanged(before, after)).toBe(false);
  expect(statusUnchanged(after, after)).toBe(true);
});

test("a stuck run turning amber is news (decision 8 rides activityState)", () => {
  const a = { turnCount: 3 };
  expect(statusUnchanged(a, { ...a, activityState: "needs_attention" })).toBe(false);
});

test("a workflow child changing status is news", () => {
  const a = { steps: [{ agent: "worker", status: "working" }] };
  const b = { steps: [{ agent: "worker", status: "done" }] };
  expect(statusUnchanged(a, b)).toBe(false);
  expect(statusUnchanged(a, { ...a })).toBe(true);
});
