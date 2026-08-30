import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { asyncResultInfo, inspectToResults } from "../src/renderer/src/agents";
import { delegationSummary, type ToolCardData } from "../src/renderer/src/components/ToolCard";
import { restoreItems } from "../src/main/restore";
import { toTranscriptItems } from "../src/renderer/src/restoreMap";

/**
 * §12 (2026-08-30): `window.hv.subagentInspect` was built 2026-08-21 and had
 * ZERO renderer callers until this round. It is what a FINISHED async
 * delegation's expanded card reads, because that run's `tool_execution_end`
 * carried a dispatch receipt and never a transcript.
 */
describe("inspectToResults", () => {
  it("maps an inspect reply onto the rows SubagentTraceView already renders", () => {
    const out = inspectToResults(
      {
        finalOutput: "Fourteen files, three entry points.",
        messages: [
          { role: "assistant", kind: "text", text: "Reading vite.config.js" },
          { role: "assistant", kind: "toolCall", text: "vite.config.js", name: "read" },
          { role: "user", kind: "toolResult", text: "export default …", name: "read" },
        ],
      },
      "code-explorer",
    );
    expect(out).toHaveLength(1);
    expect(out[0].agent).toBe("code-explorer");
    expect(out[0].finalOutput).toBe("Fourteen files, three entry points.");
    expect(out[0].messages.map((m) => m.role)).toEqual(["assistant", "assistant", "user"]);
    // A text message stays verbatim…
    expect(out[0].messages[0].text).toBe("Reading vite.config.js");
    // …and a tool call reads as its tool name, the same shape traceFromEnd
    // builds from upstream's compact `toolCalls`.
    expect(out[0].messages[1].text).toBe("read vite.config.js");
  });

  it("falls back to the kind when a call carries no tool name", () => {
    const out = inspectToResults({ messages: [{ role: "assistant", kind: "toolCall", text: "x" }] }, "worker");
    expect(out[0].messages[0].text).toBe("toolCall x");
  });

  it("returns nothing rather than an empty card when there is nothing to show", () => {
    expect(inspectToResults({}, "worker")).toEqual([]);
    expect(inspectToResults({ messages: [] }, "worker")).toEqual([]);
    expect(inspectToResults({ finalOutput: "   " }, "worker")).toEqual([]);
  });

  it("keeps a final output with no transcript", () => {
    const out = inspectToResults({ finalOutput: "done" }, "worker");
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual([]);
    expect(out[0].finalOutput).toBe("done");
  });
});

describe("the card fetches only when it has to", () => {
  const src = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  const card = src.slice(src.indexOf("function SubagentCard"), src.indexOf("export function SubagentTraceView"));

  it("found a SubagentCard body to scan", () => {
    // Guards the negative assertions below from passing vacuously.
    expect(card.length).toBeGreaterThan(2000);
  });

  it("calls subagentInspect", () => {
    expect(card).toContain("window.hv.subagentInspect(sessionId, asyncId)");
  });

  it("fetches on expand, not on mount", () => {
    // The whole reason this route is affordable: it costs no model turn but it
    // does cost an RPC round trip and a 10s timeout, per card, per transcript.
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("if (!open ");
  });

  it("does not fetch a run that already streamed its transcript in", () => {
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("results.length > 0");
  });

  it("only fetches an ASYNC run — a foreground one has no asyncId to inspect", () => {
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("!asyncId");
  });

  it("names a foreign-session refusal instead of spinning", () => {
    // Inspection is scoped to the CURRENT session's children, so a respawn
    // legitimately answers foreign_session. A card that never hears back spins
    // forever, which is the failure this route was built to avoid.
    expect(card).toContain("inspectError");
    expect(card).toContain("foreign_session");
  });

  it("drops what it read on collapse rather than caching it", () => {
    // Reopening a run must show what it says NOW, not what it said then — the
    // same rule the run card's thinking view follows.
    const eff = card.slice(card.indexOf("const [inspected"), card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("setInspected(null)");
  });
});

describe("sessionId reaches the card the same way workspace does", () => {
  const t = readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");

  it("Transcript takes it and hands it to ToolCard", () => {
    expect(t).toMatch(/sessionId\?: string \| null;/);
    expect(t).toContain("<ToolCard card={it.card} workspace={workspace} sessionId={sessionId} onOpenFile={onOpenFile} />");
  });

  it("Transcript passes it through the memoized row", () => {
    // MessageItem is memo'd — a prop that never reaches it silently arrives as
    // undefined and the fetch never fires.
    expect(t).toMatch(/<MessageItem[\s\S]{0,300}sessionId=\{sessionId\}/);
  });

  it("ChatView supplies it", () => {
    expect(chat).toMatch(/<Transcript[\s\S]{0,2000}sessionId=\{sessionId\}/);
  });
});

describe("a RESTORED card keeps the id it needs to inspect its child", () => {
  /**
   * Captured from a real session file during the 2026-08-30 GUI pass, which is
   * how this gap was found at all: every unit test fed a LIVE card
   * (`result.details.asyncId`), while restore.ts flattens the result to its text
   * blocks. The id is spelled inside `[brackets]` in that text and structured in
   * the message's `details` sibling — so it is READ, never parsed back out.
   */
  const raw = [
    { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "subagent", arguments: { agent: "code-explorer", task: "map it" } }] },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "subagent",
      isError: false,
      details: { mode: "single", asyncId: "02320d30-c265-40e0-a1d3-c928c0d6cdcf" },
      content: [{ type: "text", text: "Run fan-out: 1/64 used\nAsync: code-explorer [02320d30-c265-40e0-a1d3-c928c0d6cdcf]" }],
    },
  ];

  it("restore.ts carries details.asyncId onto the card", () => {
    const tool = restoreItems(raw).find((i) => i.kind === "tool");
    expect(tool).toBeDefined();
    expect(tool.asyncId).toBe("02320d30-c265-40e0-a1d3-c928c0d6cdcf");
  });

  it("restoreMap names it, so it is not dropped in silence", () => {
    // That module's own header: a field main sends which is not listed here is
    // dropped silently — which is how the images field was lost once already.
    const items = toTranscriptItems(
      restoreItems(raw).map((i) => (i.kind === "tool" ? { ...i, subagentCost: undefined } : i)),
      { sessionId: "s1", workspaceId: null },
      (() => { let n = 0; return () => ++n; })(),
    );
    const card = items.find((i) => i.kind === "tool").card;
    expect(card.asyncId).toBe("02320d30-c265-40e0-a1d3-c928c0d6cdcf");
  });

  it("a blocking delegation gets no asyncId", () => {
    const fg = [
      raw[0],
      { ...raw[1], details: { mode: "single" }, content: [{ type: "text", text: "the child said hello" }] },
    ];
    expect(restoreItems(fg).find((i) => i.kind === "tool").asyncId).toBeUndefined();
  });

  it("the restored card still does not claim background work", () => {
    // asyncResultInfo answers "still in flight" off the STRUCTURED result only.
    // A restored card is a finished run; teaching that function the restore
    // shape would re-open the bug this round fixed.
    const restoredResult = "Run fan-out: 1/64 used\nAsync: code-explorer [02320d30]";
    expect(asyncResultInfo(restoredResult)).toBeNull();
    const card: ToolCardData = {
      toolCallId: "c", toolName: "subagent", args: {}, status: "done",
      result: restoredResult, asyncId: "02320d30",
    };
    expect(delegationSummary(card)).not.toContain("running in the background");
  });

  it("the card asks with card.asyncId first, then the live structured read", () => {
    const src2 = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
    const card = src2.slice(src2.indexOf("function SubagentCard"), src2.indexOf("export function SubagentTraceView"));
    expect(card).toContain("const asyncId = card.asyncId ?? async?.asyncId ?? null");
  });
});
