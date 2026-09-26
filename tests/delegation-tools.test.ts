/**
 * One predicate for "this tool call starts a delegation", across both vendored
 * sub-agent stacks (PRD §12, 2026-09-26 tintinweb round): nicobailon's `subagent`
 * and tintinweb's `Agent`. Four call sites each carried their own literal, so a
 * rename would have missed one — the source scan keeps them from coming back.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { delegationAgent, isDelegationTool, isResultWait } from "../pi-runtime/extensions/hv-rules";

describe("isDelegationTool — both vendored stacks, one predicate", () => {
  it("names the nicobailon and tintinweb delegation tools, nothing else", () => {
    expect(isDelegationTool("subagent")).toBe(true);
    expect(isDelegationTool("Agent")).toBe(true);
    expect(isDelegationTool("agent")).toBe(false);
    expect(isDelegationTool("SubagentWorkflow")).toBe(false);
    expect(isDelegationTool("steer_subagent")).toBe(false);
    expect(isDelegationTool(undefined)).toBe(false);
  });

  it("no call site re-spells the literal", () => {
    for (const f of [
      "src/renderer/src/agents.ts",
      "src/renderer/src/components/ToolCard.tsx",
      "src/main/activity.ts",
      "src/main/ipc.ts",
    ]) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/toolName\s*===\s*"subagent"/);
    }
  });
});

describe("isResultWait — the never-block rule on the tintinweb path", () => {
  it("is a wait only when get_subagent_result asks to block", () => {
    expect(isResultWait("get_subagent_result", { agent_id: "a", wait: true })).toBe(true);
    expect(isResultWait("get_subagent_result", { agent_id: "a" })).toBe(false);
    expect(isResultWait("get_subagent_result", { agent_id: "a", wait: false })).toBe(false);
    expect(isResultWait("get_subagent_result", null)).toBe(false);
    expect(isResultWait("steer_subagent", { wait: true })).toBe(false);
  });
});

describe("delegationAgent — the agent a call names, on either stack", () => {
  it("reads agent (nicobailon) or subagent_type (tintinweb)", () => {
    expect(delegationAgent({ agent: "worker", task: "t" })).toBe("worker");
    expect(delegationAgent({ subagent_type: "code-explorer", prompt: "p" })).toBe("code-explorer");
    expect(delegationAgent({ prompt: "p" })).toBeUndefined();
    expect(delegationAgent({ agent: "" })).toBeUndefined();
    expect(delegationAgent(undefined)).toBeUndefined();
  });
});
