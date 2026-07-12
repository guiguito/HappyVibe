import { describe, expect, test } from "vitest";
import {
  delegationLabel,
  formatElapsed,
  isSubagentTool,
  joinToolPermissions,
  mergeTrace,
  parseAgents,
  parseTools,
  traceFromEnd,
  traceFromUpdate,
  type PermState,
} from "../src/renderer/src/agents";

const notify = (o: unknown) => ({ method: "notify", message: JSON.stringify(o) });

describe("parseAgents", () => {
  test("extracts the agents array from an hv.agents notify", () => {
    const agents = [{ name: "code-explorer", description: "read-only", source: "builtin", path: "/a.md" }];
    expect(parseAgents(notify({ kind: "hv.agents", agents }))).toEqual(agents);
  });
  test("null for non-notify or wrong kind", () => {
    expect(parseAgents({ method: "select", title: "{}" })).toBeNull();
    expect(parseAgents(notify({ kind: "hv.tools", tools: [] }))).toBeNull();
  });
  test("missing agents array → empty array (still ours)", () => {
    expect(parseAgents(notify({ kind: "hv.agents" }))).toEqual([]);
  });
});

describe("parseTools", () => {
  test("extracts the tools array from an hv.tools notify", () => {
    const tools = [{ name: "bash", description: "run a command", source: "builtin" }];
    expect(parseTools(notify({ kind: "hv.tools", tools }))).toEqual(tools);
  });
  test("null for the wrong kind", () => {
    expect(parseTools(notify({ kind: "hv.agents", agents: [] }))).toBeNull();
  });
});

describe("joinToolPermissions (renderer)", () => {
  test("keeps description/source and attaches the verdict; missing → ask", () => {
    const tools = [
      { name: "bash", description: "run", source: "builtin" },
      { name: "write", description: "write file", source: "builtin" },
    ];
    const verdicts: Record<string, PermState> = { bash: "deny" };
    expect(joinToolPermissions(tools, verdicts)).toEqual([
      { name: "bash", description: "run", source: "builtin", permission: "deny" },
      { name: "write", description: "write file", source: "builtin", permission: "ask" },
    ]);
  });
});

describe("isSubagentTool", () => {
  test("true only for the subagent tool", () => {
    expect(isSubagentTool("subagent")).toBe(true);
    expect(isSubagentTool("bash")).toBe(false);
    expect(isSubagentTool(undefined)).toBe(false);
  });
});

describe("subagent trace extraction", () => {
  // LIVE update shape (observed pi-subagents 0.33.1): results[].messages present.
  const updatePayload = {
    details: {
      results: [
        {
          agent: "code-explorer",
          messages: [
            { role: "user", content: "say hello" },
            { role: "assistant", content: [{ type: "text", text: "HELLO FROM SUBAGENT" }] },
          ],
        },
      ],
    },
  };
  // FINAL end shape: NO messages; model/usage under modelAttempts[]; finalOutput.
  const endPayload = {
    details: {
      results: [
        {
          agent: "code-explorer",
          exitCode: 0,
          finalOutput: "HELLO FROM SUBAGENT",
          modelAttempts: [{ model: "deepseek/deepseek-v4-flash", usage: { input: 1924, output: 177, cost: 0.0003, turns: 1 } }],
        },
      ],
    },
  };

  test("traceFromUpdate flattens the live child transcript", () => {
    const r = traceFromUpdate(updatePayload).results[0];
    expect(r.agent).toBe("code-explorer");
    expect(r.messages).toEqual([
      { role: "user", text: "say hello" },
      { role: "assistant", text: "HELLO FROM SUBAGENT" },
    ]);
  });

  test("traceFromEnd reads model/usage from modelAttempts + finalOutput (no transcript)", () => {
    const r = traceFromEnd(endPayload).results[0];
    expect(r.model).toBe("deepseek/deepseek-v4-flash");
    expect(r.usage).toEqual({ input: 1924, output: 177, cost: 0.0003, turns: 1 });
    expect(r.finalOutput).toBe("HELLO FROM SUBAGENT");
    expect(r.messages).toEqual([]); // end carries no transcript
  });

  test("mergeTrace keeps the live transcript while adopting the end outcome", () => {
    const merged = mergeTrace(traceFromUpdate(updatePayload), traceFromEnd(endPayload));
    const r = merged.results[0];
    expect(r.messages.map((m) => m.text)).toContain("HELLO FROM SUBAGENT"); // from update
    expect(r.model).toBe("deepseek/deepseek-v4-flash"); // from end
    expect(r.usage?.input).toBe(1924);
  });

  test("mergeTrace guards a final result with no messages field (falls back to live)", () => {
    // A raw result lacking `messages` must not throw on `.length` — it falls
    // back to the live transcript (empty-array logic unchanged, only guarded).
    const live = traceFromUpdate(updatePayload);
    const final = { results: [{ agent: "greeter" } as unknown as (typeof live.results)[number]] };
    const merged = mergeTrace(live, final);
    expect(merged.results[0].messages.map((m) => m.text)).toContain("HELLO FROM SUBAGENT");
  });

  test("flattens toolCall blocks in a child message", () => {
    const trace = traceFromUpdate({
      details: { results: [{ agent: "x", messages: [{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] }] }] },
    });
    expect(trace.results[0].messages[0].text).toBe('bash({"command":"ls"})');
  });

  test("no results → empty trace (not a crash)", () => {
    expect(traceFromUpdate(undefined).results).toEqual([]);
    expect(traceFromEnd({}).results).toEqual([]);
  });
});

// ── W1.2 floating run card helpers ───────────────────────────────────────────

describe("delegationLabel", () => {
  test("prefers intent over task", () => {
    expect(delegationLabel({ intent: "map the auth flow", task: "long raw task text" })).toBe("map the auth flow");
  });

  test("falls back to task, collapsing whitespace", () => {
    expect(delegationLabel({ task: "  say\n  hello " })).toBe("say hello");
  });

  test("truncates long labels with an ellipsis", () => {
    const label = delegationLabel({ task: "x".repeat(300) });
    expect(label.length).toBe(90);
    expect(label.endsWith("…")).toBe(true);
  });

  test("empty/garbage args → empty label (not a crash)", () => {
    expect(delegationLabel(undefined)).toBe("");
    expect(delegationLabel({ intent: "   " })).toBe("");
    expect(delegationLabel({ intent: 42, task: null })).toBe("");
  });
});

describe("formatElapsed", () => {
  test("seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42_000)).toBe("42s");
  });

  test("minutes with zero-padded seconds", () => {
    expect(formatElapsed(187_000)).toBe("3m 07s");
    expect(formatElapsed(60_000)).toBe("1m 00s");
  });

  test("negative clamps to zero", () => {
    expect(formatElapsed(-500)).toBe("0s");
  });
});
