import { describe, expect, test } from "vitest";
import { evaluate, type Rule, type RulesFile } from "../pi-runtime/extensions/hv-rules";

/**
 * Round 3 #13 — "Allow for Workspace" / "Always allow" append a tool-layer allow
 * rule (workspace vs global scope). The IPC (src/main/ipc.ts hv:add-permission-rule)
 * is thin glue over the rule engine; this pins the SCOPE semantics it relies on.
 */
const WS = "/Users/me/proj";
const OTHER = "/Users/me/other";
const toolAllow = (tool: string): Rule => ({ layer: "tool", pattern: tool, action: "allow" });
const rules = (global: Rule[] = [], workspaces: Record<string, Rule[]> = {}): RulesFile => ({ global, workspaces });

describe("workspace-scoped grant (#13)", () => {
  test("workspace allow rule allows in that workspace but not another", () => {
    const r = rules([], { [WS]: [toolAllow("bash")] });
    expect(evaluate(r, { tool: "bash", input: {}, workspace: WS }).action).toBe("allow");
    // Other workspace has no rule → bash falls back to the safe default "ask".
    expect(evaluate(r, { tool: "bash", input: {}, workspace: OTHER }).action).toBe("ask");
  });

  test("global allow rule allows everywhere (Always allow)", () => {
    const r = rules([toolAllow("bash")]);
    expect(evaluate(r, { tool: "bash", input: {}, workspace: WS }).action).toBe("allow");
    expect(evaluate(r, { tool: "bash", input: {}, workspace: OTHER }).action).toBe("allow");
  });
});
