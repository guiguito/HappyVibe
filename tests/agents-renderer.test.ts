import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REDACTED_PROMPT } from "../pi-runtime/extensions/hv-rules";
import { GAUGE_TONE } from "../src/renderer/src/components/ChatView";
import { EDITABLE_SOURCES, SOURCE_TONE } from "../src/renderer/src/components/AgentsView";
import { SOURCE_ORDER, agentBlurb, sortAgents } from "../src/renderer/src/agents";
import {
  asyncResultInfo,
  delegationHint,
  delegationLabel,
  formatElapsed,
  isSubagentQuery,
  isSubagentTool,
  joinToolPermissions,
  mergeTrace,
  parseAgents,
  parseSubagentEvent,
  parseTools,
  runLabel,
  traceFor,
  traceFromEnd,
  traceFromUpdate,
  subagentUsageLine,
  type DelegationRun,
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

  // pi-subagents 0.40.0 dropped `messages` from BOTH projections: the streamed
  // update now sends `snapshot.messages = undefined` + compact `toolCalls`
  // (execution.ts snapshotStreamResult), and the terminal result has stripped
  // messages the same way since 0.34 (compactForegroundResult). So `toolCalls` is
  // the only transcript-ish thing left, and it is present on both paths.
  const toolCallsPayload = {
    details: {
      results: [
        {
          agent: "code-explorer",
          toolCalls: [
            { text: "read(src/a.ts)", expandedText: "read(src/a.ts, offset: 1)" },
            { text: "grep(TODO)" },
          ],
          finalOutput: "found two TODOs",
        },
      ],
    },
  };

  test("derives transcript rows from toolCalls when messages is absent (0.40 shape)", () => {
    const r = traceFromUpdate(toolCallsPayload).results[0];
    expect(r.agent).toBe("code-explorer");
    // expandedText preferred when present, else text.
    expect(r.messages).toEqual([
      { role: "tool", text: "read(src/a.ts, offset: 1)" },
      { role: "tool", text: "grep(TODO)" },
    ]);
    expect(r.finalOutput).toBe("found two TODOs");
  });

  // Captured VERBATIM from a real 0.58 tool_execution_update (probe fg,
  // 2026-08-28; docs/validation/d1.md §pi-subagents 0.58). 0.50-0.53 emitted no
  // update at all for a subagent; 0.58 restored streaming AND added sibling
  // fields the mapping has never seen — `progress`, `progressSummary`,
  // `transcriptPath`, `capabilityAudit`, `effects`, `outputState`. The fixture
  // keeps them so an over-eager mapping change that trips over an unknown key
  // fails here rather than in an expanded card.
  const live058Payload = {
    details: {
      mode: "single",
      runId: "0caa2c48-ebc6-43bf-949d-829bd0156be6",
      progress: [{ index: 0, agent: "code-explorer", status: "completed", task: "[prompt redacted]" }],
      results: [
        {
          index: 0,
          agent: "code-explorer",
          task: "[prompt redacted]",
          toolCalls: [{ text: "read /tmp/notes.md", expandedText: "read /tmp/notes.md" }],
          progress: { index: 0, agent: "code-explorer", status: "completed", recentTools: [{ tool: "read" }] },
          progressSummary: { toolCount: 1, tokens: 5231, durationMs: 45274 },
          transcriptPath: "/tmp/subagent-artifacts/0caa2c48_code-explorer_0_transcript.jsonl",
          usage: { input: 3352, output: 1879, cacheRead: 1536, cacheWrite: 0, cost: 0.000657208116, turns: 2 },
          model: "deepseek/deepseek-v4-flash",
          exitCode: 0,
          outputMode: "text",
          outputState: "written",
          capabilityAudit: {},
          effects: {},
          launchContractDigest: "sha256:…",
          artifactPaths: [],
          finalOutput: "## Detailed Report: notes.md",
        },
      ],
    },
  };

  test("maps a real 0.58 streamed update, extra sibling fields and all", () => {
    const r = traceFromUpdate(live058Payload).results[0];
    expect(r.agent).toBe("code-explorer");
    expect(r.messages).toEqual([{ role: "tool", text: "read /tmp/notes.md" }]);
    // usage/model come from the top level here, not from modelAttempts[].
    expect(r.usage?.cost).toBeCloseTo(0.000657208116);
    expect(r.model).toBe("deepseek/deepseek-v4-flash");
    expect(r.exitCode).toBe(0);
    expect(r.finalOutput).toBe("## Detailed Report: notes.md");
  });

  test("the streamed 0.58 update still carries no `messages`", () => {
    // The delivery came back, the SHAPE did not change: toolCalls remains the
    // transcript source. If a future pin restores `messages`, the test above
    // ("real messages still win") is what starts preferring it.
    const raw = live058Payload.details.results[0] as Record<string, unknown>;
    expect("messages" in raw, "0.58 streams toolCalls, not messages").toBe(false);
  });

  test("the end projection derives the same rows from toolCalls", () => {
    expect(traceFromEnd(toolCallsPayload).results[0].messages).toHaveLength(2);
  });

  test("real messages still win over toolCalls when both are present", () => {
    // Belt and braces: any pin that restores `messages` should be preferred, since
    // it carries the child's prose and toolCalls does not.
    const both = {
      details: {
        results: [{
          agent: "a",
          messages: [{ role: "assistant", content: [{ type: "text", text: "prose" }] }],
          toolCalls: [{ text: "read(x)" }],
        }],
      },
    };
    expect(traceFromUpdate(both).results[0].messages).toEqual([{ role: "assistant", text: "prose" }]);
  });

  test("mergeTrace falls back to the live toolCalls rows", () => {
    const merged = mergeTrace(traceFromUpdate(toolCallsPayload), traceFromEnd(endPayload));
    // end has neither messages nor toolCalls → keep what the update derived.
    expect(merged.results[0].messages).toHaveLength(2);
    expect(merged.results[0].finalOutput).toBe("HELLO FROM SUBAGENT");
  });

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

  test("never captions a card with pi-subagents 0.50's redaction", () => {
    // 0.50 replaces task/goal with REDACTED_PROMPT on every surface the UI could
    // read. The bridge substitutes the task it remembered at tool_call time, and
    // this is the backstop for any path that reads upstream's value directly. An
    // empty caption is the intended degradation — showing "[prompt redacted]" to a
    // user who just typed the task is worse than showing nothing.
    expect(delegationLabel({ task: REDACTED_PROMPT })).toBe("");
    expect(delegationLabel({ intent: REDACTED_PROMPT, task: "the real task" })).toBe("the real task");
    expect(runLabel(REDACTED_PROMPT)).toBe("");
    expect(runLabel("map the repo")).toBe("map the repo");
    expect(runLabel(undefined)).toBe("");
  });

  test("an async dispatch RE-KEYS its card to the runId instead of deleting it", () => {
    // The 0.50 regression this guards: every top-level delegation now runs as
    // mode:"workflow", and that path emits `subagent:async-complete` but NEVER
    // `subagent:async-started` (measured twice with a probe extension). The card
    // used to be raised by the `started` notify, so an async delegation showed the
    // user nothing for its whole life and then dropped a result in — the inverse of
    // PRD §12. tool_execution_end carries details.asyncId and the card already has
    // the real agent and task from the call's own args, so the card is converted
    // rather than dropped. Pinned as a source scan (the renderer suite has no DOM):
    // the old `delete next[t.toolCallId]` with no re-key is the bug.
    const app = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
    const block = app.slice(app.indexOf("const detached = asyncResultInfo(t.result)"));
    expect(block.slice(0, 1200)).toMatch(/next\[detached\.asyncId\]\s*=/);
    // Still idempotent against a `started` notify that DID arrive — but it no
    // longer lets that notify's caption WIN. 2026-08-29: `subagent:async-started`
    // carries no tool call id, so two same-agent delegations in one turn cannot be
    // told apart there, and a real session had a Beat Saber run captioned
    // "Minesweeper". `fg.label`/`fg.agent` come from tool_execution_start's own
    // args and are exact per call, so the merge prefers them over the guess.
    expect(block.slice(0, 1200), "an already-raised card is merged, not replaced")
      .toMatch(/const raised = next\[detached\.asyncId\]/);
    expect(block.slice(0, 1200), "the exact label wins over the notify's")
      .toMatch(/label: fg\.label \|\| raised\.label/);
    expect(block.slice(0, 1200), "and so does the exact agent")
      .toMatch(/agent: fg\.agent \|\| raised\.agent/);
  });

  test("asyncResultInfo reads the runId the completion notify will use", () => {
    // Measured 2026-08-17: details.asyncId === details.runId === the runId on the
    // hv.subagent complete notify, so a card keyed by asyncId is the same card the
    // completion and the /hv-subagent-list resync will find.
    expect(asyncResultInfo({ details: { asyncId: "fa7d236f", runId: "fa7d236f" } })).toEqual({ asyncId: "fa7d236f" });
    expect(asyncResultInfo({ details: {} })).toBeNull();
    expect(asyncResultInfo(undefined)).toBeNull();
  });

  test("the async card and the resync path both route through runLabel", () => {
    // Renderer tests have no DOM (vitest.config.ts collects .ts only), so the
    // contract is pinned in two halves: the mapping above as data, and the ABSENCE
    // of the raw reads here as a source scan — an absence is exactly what a render
    // test would not fail on. Both sites used to be `sub.task ?? ""` / `x.task ?? ""`,
    // which is how the redaction would reach the screen.
    const app = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
    expect(app).not.toMatch(/label:\s*sub\.task\s*\?\?/);
    expect(app).not.toMatch(/label:\s*x\.task\s*\?\?/);
    expect(app).toMatch(/label:\s*runLabel\(sub\.task\)/);
    expect(app).toMatch(/label:\s*runLabel\(x\.task\)/);
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

describe("delegationHint (composer copy)", () => {
  const run = (agent: string, status: DelegationRun["status"] = "running"): DelegationRun => ({
    id: `t-${agent}`,
    kind: "fg",
    toolCallId: `t-${agent}`,
    agent,
    label: "",
    startedAt: 0,
    status,
  });
  const asyncRun = (agent: string, status: DelegationRun["status"] = "running"): DelegationRun => ({
    id: `r-${agent}`,
    kind: "async",
    agent,
    label: "",
    startedAt: 0,
    status,
  });

  test("null when nothing runs (empty or all finished)", () => {
    expect(delegationHint([])).toBeNull();
    expect(delegationHint([run("explorer", "done"), run("summarizer", "error")])).toBeNull();
  });

  test("one running FOREGROUND agent → blocking copy", () => {
    expect(delegationHint([run("code-explorer")])).toBe(
      "Type away — messages will be answered when code-explorer finishes",
    );
  });

  test("several running foreground agents → counted copy, finished runs excluded", () => {
    expect(delegationHint([run("a"), run("b"), run("c", "done")])).toBe(
      "Type away — messages will be answered when 2 agents finish",
    );
  });

  test("any running ASYNC run → non-blocking background copy", () => {
    expect(delegationHint([asyncRun("code-explorer")])).toBe(
      "Subagents are working in the background — keep chatting; results drop in when they finish",
    );
    // mixed: async copy wins (chatting works)
    expect(delegationHint([run("fg"), asyncRun("bg")])).toContain("in the background");
  });
});

describe("parseSubagentEvent", () => {
  test("parses each lifecycle stage; ignores non-subagent notifies", () => {
    expect(parseSubagentEvent(notify({ kind: "hv.subagent", stage: "started", runId: "r1", agent: "scout", asyncDir: "/tmp/x" }))).toMatchObject({ stage: "started", runId: "r1", agent: "scout" });
    expect(parseSubagentEvent(notify({ kind: "hv.subagent", stage: "control", runId: "r1", activityState: "needs_attention" }))?.activityState).toBe("needs_attention");
    expect(parseSubagentEvent(notify({ kind: "hv.subagent", stage: "complete", runId: "r1", status: "success" }))?.status).toBe("success");
    expect(parseSubagentEvent(notify({ kind: "hv.subagent", stage: "active", runs: [{ runId: "r1", asyncDir: "/tmp/x" }] }))?.runs).toHaveLength(1);
    expect(parseSubagentEvent(notify({ kind: "hv.agents", agents: [] }))).toBeNull();
    expect(parseSubagentEvent({ method: "select" })).toBeNull();
    expect(parseSubagentEvent({ method: "notify", message: "not json" })).toBeNull();
  });
});

describe("asyncResultInfo", () => {
  test("detects details.asyncId on an async-dispatch tool result", () => {
    expect(asyncResultInfo({ content: [], details: { asyncId: "run-9", results: [] } })).toEqual({ asyncId: "run-9" });
  });
  test("null for a foreground result (no asyncId)", () => {
    expect(asyncResultInfo({ details: { results: [{ agent: "x", finalOutput: "hi" }] } })).toBeNull();
    expect(asyncResultInfo(undefined)).toBeNull();
    expect(asyncResultInfo({ details: { asyncId: "" } })).toBeNull();
  });
});

describe("traceFor (V2.C1 sticky-section trace lookup)", () => {
  const trace = { results: [{ agent: "code-explorer", messages: [], finalOutput: "hi" }] };
  const items = [
    { kind: "user" },
    { kind: "tool", card: { toolCallId: "other" } },
    { kind: "tool", card: { toolCallId: "call-1", trace } },
  ];

  test("finds the trace on the matching subagent tool card", () => {
    expect(traceFor(items, "call-1")).toBe(trace);
  });

  test("undefined for a card without a trace yet, or no matching card", () => {
    expect(traceFor(items, "other")).toBeUndefined();
    expect(traceFor(items, "missing")).toBeUndefined();
    expect(traceFor([], "call-1")).toBeUndefined();
  });
});

describe("a subagent status poll is not a delegation", () => {
  // Reported from a real session: one delegation produced FOUR tool calls, and the
  // third — `subagent {action:"status", id}` — drew a delegation card with no agent
  // and no task, rendering literally "→ asked ?". It is the model polling its own
  // machinery, not work anyone asked for.
  test("recognises the poll the model actually sent", () => {
    expect(isSubagentQuery({ action: "status", id: "7753ae03" })).toBe(true);
    expect(isSubagentQuery({ action: "list" })).toBe(true);
  });

  test("never hides a real delegation", () => {
    // The delegation from the same session.
    expect(isSubagentQuery({ agent: "code-explorer", task: "Explore the architecture" })).toBe(false);
    // Conservative on purpose: pi-subagents 0.50 sends NO args on
    // tool_execution_end, so "no agent" alone would suppress genuine work.
    expect(isSubagentQuery(undefined)).toBe(false);
    expect(isSubagentQuery({})).toBe(false);
    // An action that also names an agent is a dispatch, not a query.
    expect(isSubagentQuery({ action: "run", agent: "code-explorer" })).toBe(false);
    // A blank action is not an action.
    expect(isSubagentQuery({ action: "   " })).toBe(false);
  });

  test("App.tsx suppresses the card, beside the wait tool it belongs with", () => {
    // Absence assertion — the renderer suite has no DOM, so the wiring is pinned by
    // source scan (tests/modal-layer.test.ts pattern). The card must be skipped
    // BEFORE tool_execution_start builds one, or the sticky run card appears too.
    const app = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
    const guard = app.indexOf("isSubagentQuery(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(app.indexOf('e.type === "tool_execution_start"'));
  });
});

describe("subagentUsageLine", () => {
  test("shows tokens and turns", () => {
    expect(subagentUsageLine({ input: 1000, output: 240, turns: 3 })).toBe("1.2k tok · 3 turns");
  });
  test("singularises one turn", () => {
    expect(subagentUsageLine({ input: 10, output: 0, turns: 1 })).toBe("10 tok · 1 turn");
  });
  test("omits turns when upstream did not report them", () => {
    expect(subagentUsageLine({ input: 10, output: 5 })).toBe("15 tok");
  });
  test("null with no usage at all", () => {
    expect(subagentUsageLine(undefined)).toBeNull();
  });
  // PRD §19 ruling 3: pi-subagents prices from its own registry, which knows
  // nothing about flat-subscription providers, so its dollars are not ours to
  // show. Money returns as a RUN-level total once the child's provider is
  // available from its own session file.
  test("never renders money — `usage` carries no provider to classify it", () => {
    expect(subagentUsageLine({ input: 10, output: 5, turns: 1 })).not.toMatch(/\$/);
  });
  test("the card no longer formats a raw child cost", () => {
    const card = readFileSync(path.resolve(__dirname, "../src/renderer/src/components/ToolCard.tsx"), "utf8");
    expect(card).not.toMatch(/fmtCost/);
  });
});

// ── The run card header (§12, 2026-08-29 — the fleet round) ──────────────────
//
// The renderer suite has no DOM, so a visual contract is pinned in two halves:
// the mapping as exported DATA, and the ABSENCE as a source scan. The absence
// half is the one that matters here — an intent that quietly stayed on the
// header row is exactly what a screenshot glance forgives.
describe("the delegation run card header", () => {
  const CHAT = path.join(__dirname, "..", "src", "renderer", "src", "components", "ChatView.tsx");
  const chat = readFileSync(CHAT, "utf8");

  test("renders the gauge from childGauge, never from a second threshold table", () => {
    expect(chat).toContain("childGauge(run.live?.context)");
    // A percentage computed inline here would drift from §9's zones silently:
    // both gauges would still look plausible, on different scales.
    expect(chat).not.toMatch(/run\.live\?\.context\.window\s*\/\s*run\.live\?\.context\.limit/);
  });

  test("the gauge tones are the session bubble's zones, not fresh colours", () => {
    for (const zone of ["calm", "amber", "red"] as const) {
      expect(GAUGE_TONE[zone]).toBeTruthy();
    }
    expect(GAUGE_TONE.calm).toContain("leaf");
    expect(GAUGE_TONE.amber).toContain("honey");
    expect(GAUGE_TONE.red).toContain("berry");
  });

  test("no longer puts the intent on the header row", () => {
    // The old shape was this exact span, nested INSIDE the agent-name span.
    // An absence cannot be screenshotted, which is why it is asserted here.
    expect(chat).not.toContain('<span className="text-ink-soft font-medium"> — {run.label}</span>');
  });

  test("the gauge is gated on `running`, so a finished card shows no live number", () => {
    expect(chat).toContain("const gauge = running ? childGauge(run.live?.context) : null;");
  });
});

// ── The Agents page's source taxonomy (§12, 2026-08-29) ─────────────────────
describe("the agent inventory's five sources", () => {
  test("every source the bridge can emit has a tone", () => {
    // A source with no tone falls through to a grey default that reads like a
    // deliberate neutral rather than a missing case.
    for (const source of ["builtin", "bundled", "user", "project", "package"]) {
      expect(SOURCE_TONE[source]).toBeTruthy();
    }
  });

  test("only the paths hv:write-agent can actually write are editable", () => {
    // hv:write-agent is path-confined to the app-owned + project dirs. An Edit
    // button on any other row is a button that fails.
    expect([...EDITABLE_SOURCES].sort()).toEqual(["bundled", "project"]);
    for (const readOnly of ["builtin", "user", "package"]) {
      expect(EDITABLE_SOURCES.has(readOnly)).toBe(false);
    }
  });

  test("ours stays visually distinct from upstream's", () => {
    // If these ever collapse to the same tone the page goes back to being
    // unable to say which agents the user owns.
    expect(SOURCE_TONE.bundled).not.toBe(SOURCE_TONE.builtin);
  });
});

// ── The delegate-this affordances (§12, 2026-08-29) ─────────────────────────
describe("delegating from the flow", () => {
  const CHAT2 = path.join(__dirname, "..", "src", "renderer", "src", "components", "ChatView.tsx");
  const chat2 = readFileSync(CHAT2, "utf8");

  test("an agent pick never writes to the file label map", () => {
    // mentionMap is what extractMentions resolves on send. An entry there would
    // make the app try to attach a file named after the agent.
    const pick = chat2.slice(chat2.indexOf("const pickAgentMention"), chat2.indexOf("const pickAgentMention") + 700);
    expect(pick).not.toContain("mentionMap.current.set");
  });

  test("an agent match opens the @ menu even when no file matches", () => {
    expect(chat2).toContain("mention.items.length > 0 || mentionAgents.length > 0");
  });

  test("the roster chip dismisses by click-catcher, never by blur", () => {
    // A blur-dismissed menu unmounts between mousedown and mouseup and loses its
    // own clicks — reported twice in this app as an unclickable menu.
    const chip = chat2.slice(chat2.indexOf("function AgentsChip"), chat2.indexOf("function SkillsChip"));
    expect(chip).toContain('className="fixed inset-0 z-20"');
    expect(chip).toContain("onMouseDown");
    expect(chip).not.toContain("onBlur");
  });
});

// ── The roster has to be FETCHED, or both affordances are empty ─────────────
describe("the agent roster reaches the composer without visiting Settings", () => {
  test("App requests it per session, not only from the Agents page", () => {
    // Found during the fleet round: listAgents was called ONLY by AgentsView on
    // mount, so `agents` stayed null until the user opened the settings page —
    // and @agent plus the delegate chip were empty for exactly the user the
    // "delegate from the flow" item exists for. An absence, so: source scan.
    const app = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
    expect(app).toContain("void window.hv.listAgents(selectedId);");
  });
});

// ── A read-only agent's prompt is still readable (§12, 2026-08-29) ──────────
describe("viewing a prompt we cannot write", () => {
  const VIEW = path.join(__dirname, "..", "src", "renderer", "src", "components", "AgentsView.tsx");
  const view = readFileSync(VIEW, "utf8");

  test("View is offered exactly where Edit is not", () => {
    expect(view).toContain("{!EDITABLE_SOURCES.has(a.source) && a.systemPrompt && (");
    expect(view).toContain("{EDITABLE_SOURCES.has(a.source) && (");
  });

  test("the prompt comes from discovery, never from a widened file read", () => {
    // main's agent read is path-confined to dirs the app owns; a package agent
    // can live under the global npm root. Reading the prompt off the discovery
    // notify is what lets the page show it without opening that up.
    expect(view).toContain("agent.systemPrompt");
    expect(view).not.toContain("readAgent(agent.path)".replace("agent.path", "viewing.path"));
  });

  test("the read-only view offers no Save", () => {
    // An absence: a Save that silently failed would be worse than no Save.
    const viewer = view.slice(view.indexOf("function AgentPromptView"), view.indexOf("function AgentEditor"));
    expect(viewer).not.toContain("Save");
    expect(viewer).not.toContain("writeAgent");
    expect(viewer).toContain("duplicate it to make a version you can edit");
  });
});

// ── Inventory ordering (§12, 2026-08-29) ───────────────────────────────────
describe("sortAgents", () => {
  const mk = (name: string, source: string): { name: string; source: string } => ({ name, source });

  test("puts the user's own agents on top and HappyVibe's furniture last", () => {
    const sorted = sortAgents([
      mk("worker", "bundled"), mk("reviewer", "builtin"), mk("my-agent", "user"),
      mk("repo-agent", "project"), mk("pkg-agent", "package"),
    ]);
    expect(sorted.map((a) => a.source)).toEqual(["user", "project", "builtin", "package", "bundled"]);
  });

  test("sorts alphabetically inside a group", () => {
    const sorted = sortAgents([mk("scout", "builtin"), mk("delegate", "builtin"), mk("oracle", "builtin")]);
    expect(sorted.map((a) => a.name)).toEqual(["delegate", "oracle", "scout"]);
  });

  test("an unknown source sorts LAST, never above the user's own", () => {
    // A source added upstream must not silently take the top of the page.
    const sorted = sortAgents([mk("mystery", "something-new"), mk("mine", "user")]);
    expect(sorted.map((a) => a.name)).toEqual(["mine", "mystery"]);
  });

  test("does not mutate its input", () => {
    const input = [mk("worker", "bundled"), mk("mine", "user")];
    sortAgents(input);
    expect(input.map((a) => a.name)).toEqual(["worker", "mine"]);
  });

  test("every source the bridge can emit has an explicit rank", () => {
    for (const s of ["builtin", "bundled", "user", "project", "package"]) {
      expect(SOURCE_ORDER[s]).toBeTypeOf("number");
    }
  });
});

// ── The child trace needs no toggle (§12, 2026-08-29 round 2) ───────────────
describe("the expanded run card shows reasoning without a second click", () => {
  const CHAT3 = path.join(__dirname, "..", "src", "renderer", "src", "components", "ChatView.tsx");
  const chat3 = readFileSync(CHAT3, "utf8");

  test("no Show/Hide thinking control survives", () => {
    // An absence: the control was ceremony in front of something the user had
    // already asked for by expanding the card.
    expect(chat3).not.toContain("Show thinking");
    expect(chat3).not.toContain("Hide thinking");
    expect(chat3).not.toContain("toggleTrace");
  });

  test("the fetch is gated on `open`, so a collapsed card reads nothing", () => {
    expect(chat3).toContain("if (!open || !transcriptPath) {");
    expect(chat3).toContain("[open, transcriptPath, run.live]");
  });

  test("recentTools stays as the fallback when there is no trace yet", () => {
    // The trace supersedes it (same calls, in order, with the reasoning), but a
    // run whose transcript has not landed still needs to show something.
    expect(chat3).toContain("{!childTrace?.length && (run.live?.recentTools ?? [])");
  });
});

// ── Display copy vs the model's copy (§12, 2026-08-30) ─────────────────────
describe("agentBlurb", () => {
  const mk = (name: string, source: string, description: string) => ({ name, source, description });

  test("replaces upstream's frontmatter with the human-facing line", () => {
    expect(agentBlurb(mk("scout", "builtin", "Fast codebase recon that returns compressed context for handoff")))
      .toBe("Fast local codebase recon: relevant files, entry points, data flow, risks");
  });

  test("only for BUILTIN — a user's own `scout` keeps its own description", () => {
    // Keyed by name, so without the source check we would overwrite someone's
    // agent with upstream's copy about a different agent entirely.
    expect(agentBlurb(mk("scout", "user", "my own scout"))).toBe("my own scout");
    expect(agentBlurb(mk("scout", "project", "the repo's scout"))).toBe("the repo's scout");
  });

  test("falls through for a builtin we have no copy for", () => {
    expect(agentBlurb(mk("something-new", "builtin", "upstream's words"))).toBe("upstream's words");
  });

  test("carries no copy for the agents we disable", () => {
    // researcher/oracle are disabled, so a blurb for them would be dead code
    // that quietly implied they were still on offer.
    expect(agentBlurb(mk("researcher", "builtin", "upstream"))).toBe("upstream");
    expect(agentBlurb(mk("oracle", "builtin", "upstream"))).toBe("upstream");
  });

  test("the MODEL still gets the frontmatter, not this copy", () => {
    // The roster injection reads `a.description` directly; agentBlurb is a
    // renderer export and must never reach hv-agents.ts.
    const hvAgents = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "hv-agents.ts"), "utf8");
    expect(hvAgents).not.toContain("agentBlurb");
    expect(hvAgents).toContain("a.description.slice(0, 200)");
  });
});

describe("the agents pill is quiet at rest", () => {
  const CHAT4 = path.join(__dirname, "..", "src", "renderer", "src", "components", "ChatView.tsx");
  const chat4 = readFileSync(CHAT4, "utf8");
  const chip = chat4.slice(chat4.indexOf("function AgentsChip"), chat4.indexOf("function SkillsChip"));

  test("no fill and no emoji at rest; the app's own glyph instead", () => {
    expect(chip).not.toContain("bg-honey-soft text-tangerine-deep text-[11px]");
    expect(chip).not.toContain("🤖");
    expect(chip).toContain('<ToolIcon kind="robot"');
  });

  test("it still looks pressable — a border at rest, a fill on hover", () => {
    expect(chip).toContain("border border-line");
    expect(chip).toContain("hover:bg-honey-soft");
  });

  test("the skills pill keeps its fill — the point was one loud pill, not none", () => {
    const skills = chat4.slice(chat4.indexOf("function SkillsChip"));
    expect(skills).toContain("bg-plum-soft");
  });
});

// ── The switch is a switch (2026-08-30) ────────────────────────────────────
describe("agents use the app's shared Toggle", () => {
  const AV = path.join(__dirname, "..", "src", "renderer", "src", "components", "AgentsView.tsx");
  const av = readFileSync(AV, "utf8");

  test("a switch, not a checkbox", () => {
    // These apply immediately (next turn), so they must not read as a
    // selection waiting on a Save.
    expect(av).toContain("<Toggle");
    expect(av).not.toContain('type="checkbox"');
  });

  test("it is the SHARED component, not a fourth copy", () => {
    // Three near-identical switches already existed. A fourth was the wrong
    // direction; this asserts the extraction stuck.
    expect(av).toContain('from "./Toggle"');
    const toggle = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "components", "Toggle.tsx"), "utf8");
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain("aria-checked");
    // VoiceView adopted it rather than keeping its own copy.
    const voice = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "components", "VoiceView.tsx"), "utf8");
    expect(voice).toContain('from "./Toggle"');
    expect(voice).not.toContain("function Toggle(");
  });
});
