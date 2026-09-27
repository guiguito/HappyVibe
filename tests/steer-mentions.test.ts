/**
 * §7/§12 (2026-09-26): steering from the composer is a PICK, never a parse — and the
 * roster's own `@agent` pick keeps meaning "delegate to it".
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { runMentionItems, steerTarget } from "../src/renderer/src/mentions";

const runs = [
  { id: "t1", runId: "r1", kind: "fg", agent: "worker", status: "running" },
  { id: "r2", kind: "async", agent: "worker", status: "running" },
  { id: "r3", runId: "r3", kind: "async", agent: "code-explorer", status: "done" },
  { id: "wf_1", runId: "wf_1", kind: "async", agent: "workflow", status: "running" },
];

describe("runMentionItems — running runs only, numbered per agent", () => {
  it("offers each running run of a matching agent, numbered", () => {
    expect(runMentionItems(runs, "wor")).toEqual([
      { runId: "r1", agent: "worker", label: "Message worker · run 1" },
      { runId: "r2", agent: "worker", label: "Message worker · run 2" },
    ]);
  });
  it("a finished run is not offered, and a workflow is not a steerable agent", () => {
    expect(runMentionItems(runs, "code")).toEqual([]);
    expect(runMentionItems(runs, "work").map((r) => r.agent)).not.toContain("workflow");
  });
});

describe("steerTarget — a pick, never a parse", () => {
  it("routes only a picked run at the start of the prompt", () => {
    expect(steerTarget("@worker focus on the tests", { runId: "r2", agent: "worker" })).toEqual({ runId: "r2", message: "focus on the tests" });
  });
  it("hand-typed @worker is NOT a steer", () => {
    expect(steerTarget("@worker focus on the tests", null)).toBeNull();
  });
  it("mid-prompt, or an empty message, is not a steer", () => {
    expect(steerTarget("please @worker focus", { runId: "r2", agent: "worker" })).toBeNull();
    expect(steerTarget("@worker   ", { runId: "r2", agent: "worker" })).toBeNull();
  });
  it("targets exactly the picked run id (two runs of one agent never cross)", () => {
    expect(steerTarget("@worker x", { runId: "r1", agent: "worker" })!.runId).toBe("r1");
  });
});

describe("the roster pick is unchanged", () => {
  it("pickAgentMention still inserts plain text and never steers", () => {
    const src = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
    const at = src.indexOf("const pickAgentMention");
    const body = src.slice(at, src.indexOf("};", at));
    expect(body).not.toMatch(/mentionMap/);
    expect(body).not.toMatch(/subagentSteer|setPickedRun/);
  });
});
