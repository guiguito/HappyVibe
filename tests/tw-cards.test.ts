/**
 * PRD §12 (2026-09-26): the renderer's delegation cards read tintinweb's `Agent` results —
 * the background one keyed by `details.agentId`, the foreground one carrying its answer
 * as TEXT (no `results[]`) — and sessions from before the switch still render. Fixtures
 * are the frames captured in Phase 0 (d1.md § tintinweb wire shapes), verbatim.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { asyncResultInfo, delegationLabel, isSubagentTool, traceFromEnd } from "../src/renderer/src/agents";
import { restoreItems } from "../src/main/restore";

const BG_END = {
  content: [{ type: "text", text: "Agent started in background.\nAgent ID: 4def0fc5-0e58-4e3\nType: code-explorer\nDescription: List files in current folder\n\nYou will be notified when this agent completes.\nUse get_subagent_result to retrieve full results, or steer_subagent to send it messages.\nDo not duplicate this agent's work." }],
  details: { displayName: "code-explorer", description: "List files in current folder", subagentType: "code-explorer", modelName: "deepseek: deepseek v4 flash 0423", tags: ["background"], toolUses: 0, tokens: "", durationMs: 0, status: "background", agentId: "4def0fc5-0e58-4e3" },
};
const FG_END = {
  content: [{ type: "text", text: "Agent completed in 4.7s (1 tool uses, 8.2k token).\n\n5" }],
  details: { displayName: "code-explorer", description: "Count .txt files in cwd", subagentType: "code-explorer", modelName: "deepseek: deepseek v4 flash 0423", tags: ["thinking: high"], toolUses: 1, tokens: "8.2k token", cost: 0.00035664720000000004, turnCount: 2, durationMs: 4749, status: "completed", agentId: "67a074f2-672b-480" },
};

describe("live cards", () => {
  it("a background Agent result is async, keyed by its agentId", () => {
    expect(asyncResultInfo(BG_END)).toEqual({ asyncId: "4def0fc5-0e58-4e3" });
  });

  it("a foreground Agent result is not async, and its TEXT answer becomes the card's trace", () => {
    expect(asyncResultInfo(FG_END)).toBeNull();
    const t = traceFromEnd(FG_END);
    expect(t.results).toHaveLength(1);
    expect(t.results[0]).toMatchObject({ agent: "code-explorer", finalOutput: "5", usage: { turns: 2, cost: 0.00035664720000000004 } });
  });

  it("a background dispatch receipt is NOT a trace (the answer comes later)", () => {
    expect(traceFromEnd(BG_END).results).toEqual([]);
  });

  it("the caption is the model's own short description", () => {
    expect(delegationLabel({ subagent_type: "worker", description: "Fix the parser", prompt: "long prompt…" })).toBe("Fix the parser");
    expect(delegationLabel({ subagent_type: "worker", prompt: "just a prompt" })).toBe("just a prompt");
    expect(delegationLabel({ intent: "Mapping auth", description: "d" })).toBe("Mapping auth");
  });
});

describe("old sessions still read (read-only compat)", () => {
  it("nicobailon's subagent card and asyncId are unchanged", () => {
    expect(isSubagentTool("subagent")).toBe(true);
    expect(asyncResultInfo({ details: { asyncId: "r1" } })).toEqual({ asyncId: "r1" });
    expect(delegationLabel({ agent: "code-explorer", task: "find the router" })).toBe("find the router");
  });
});

describe("a reopened tintinweb session's card can inspect its child", () => {
  it("restore lifts details.agentId (any status) into the card's asyncId", () => {
    const items = restoreItems([
      { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "Agent", arguments: { subagent_type: "code-explorer", description: "d", prompt: "p" } }] },
      { role: "toolResult", toolCallId: "c1", toolName: "Agent", content: FG_END.content, details: FG_END.details },
    ] as never);
    const card = items.find((i) => (i as { kind?: string }).kind === "tool") as { asyncId?: string } | undefined;
    expect(card?.asyncId).toBe("67a074f2-672b-480");
  });

  it("the card names its agent from either stack's args", () => {
    const src = fs.readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
    expect(src).toMatch(/inspectToResults\(r\.reply, delegationAgent\(card\.args\) \?\? "subagent"\)/);
  });
});

// GUI pass 2026-09-27: a FOREGROUND delegation has already completed when its tool_execution_end
// arrives, and the "already finished" guard used to skip the row too — so a reopened session
// could not attach that run's spend to its card. Only the busy marker may be guarded.
it("the delegation row is written for foreground runs too — only the busy marker is guarded", () => {
  const src = fs.readFileSync("src/main/ipc.ts", "utf8");
  const at = src.indexOf('type: "subagent.async_started"');
  const before = src.slice(at - 600, at);
  expect(before).toMatch(/if \(runId && !finishedAsyncRuns\.has\(runId\)\) activity\.asyncStarted\(sessionId, runId\);\s*if \(runId\) \{\s*void log\.append\(\{\s*$/);
});

// GUI pass 2026-09-27: tintinweb's `Agent` args share none of the old work-field names, so
// running them through the machinery guard hid every delegation card. The guard is old-tool only.
it("a tintinweb Agent call is never treated as machinery — the query guard is scoped to `subagent`", async () => {
  const { isSubagentQuery } = await import("../src/renderer/src/agents");
  expect(isSubagentQuery({ subagent_type: "worker", prompt: "do it", description: "Do it" })).toBe(true); // why the scope is needed
  const src = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
  expect(src).toMatch(/toolName === "subagent"\s*&& isSubagentQuery\(/);
  expect(src).not.toMatch(/isSubagentTool\([^)]*\)\s*&& isSubagentQuery\(/);
});
