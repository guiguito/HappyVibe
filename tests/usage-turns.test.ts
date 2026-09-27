import { describe, expect, it } from "vitest";
import { TurnTracker } from "../src/main/usage/turns";

describe("§39 TurnTracker", () => {
  it("counts tool calls, distinct edited files and sub-agent runs; never a path", () => {
    const t = new TurnTracker();
    t.start("s", false, 1_000);
    t.onEvent("s", { type: "tool_execution_start", toolName: "edit", args: { path: "/a.ts" } });
    t.onEvent("s", { type: "tool_execution_end", toolName: "edit" });
    t.onEvent("s", { type: "tool_execution_start", toolName: "write", args: { path: "/a.ts" } });
    t.onEvent("s", { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } });
    t.onEvent("s", { type: "tool_execution_start", toolName: "Agent", args: {} });
    const p = t.end("s", { outcome: "completed" }, 4_400)!;
    expect(p).toEqual({ outcome: "completed", durationSec: 3, toolCalls: 4, filesEdited: 1, subagentRuns: 1, scheduled: false });
    expect(JSON.stringify(p)).not.toContain("/a.ts");
  });
  it("ends exactly once: a second end is null, and the next turn starts at zero", () => {
    const t = new TurnTracker();
    t.start("s", true, 0);
    t.onEvent("s", { type: "tool_execution_start", toolName: "bash", args: {} });
    expect(t.end("s", { outcome: "error", errorKind: "pi_exit" }, 2_000)).toMatchObject({ outcome: "error", errorKind: "pi_exit", toolCalls: 1, scheduled: true });
    expect(t.end("s", { outcome: "completed" }, 3_000)).toBeNull();
    t.start("s", false, 5_000);
    expect(t.end("s", { outcome: "aborted" }, 6_000)).toMatchObject({ toolCalls: 0, outcome: "aborted" });
  });
  it("an end with no start is null, and events for an unstarted session are ignored", () => {
    const t = new TurnTracker();
    t.onEvent("x", { type: "tool_execution_start", toolName: "bash" });
    expect(t.end("x", { outcome: "completed" })).toBeNull();
  });
  it("isBusy reports an in-flight turn", () => {
    const t = new TurnTracker();
    expect(t.isBusy("s")).toBe(false);
    t.start("s", false);
    expect(t.isBusy("s")).toBe(true);
  });
});
