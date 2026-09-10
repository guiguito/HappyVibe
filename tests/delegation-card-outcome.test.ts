import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { delegationSummary, type ToolCardData } from "../src/renderer/src/components/ToolCard";
import { parseSubagentEvent } from "../src/renderer/src/agents";

/**
 * §12 (2026-08-30): a finished ASYNC delegation's in-transcript card.
 *
 * Reported from a real session twenty minutes after the run completed: the card
 * still read "Waiting for the subagent to respond…". The cause is structural —
 * an async `tool_execution_end` carries a dispatch receipt with no results, and
 * the completion arrives later on a notify that only the sticky card read.
 */
const dispatched: ToolCardData = {
  toolCallId: "call-1",
  toolName: "subagent",
  args: { agent: "code-explorer", task: "map the architecture" },
  status: "done",
  result: { details: { asyncId: "run-7" } },
};

describe("delegationSummary", () => {
  it("says the run is in the background while no outcome has arrived", () => {
    expect(delegationSummary(dispatched)).toBe("running in the background — result arrives when it finishes");
  });

  it("shows the completion's own summary once it has", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done", summary: "Mapped 14 files." } }))
      .toBe("Mapped 14 files.");
  });

  it("collapses whitespace in that summary", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done", summary: "one\n\ntwo   three" } }))
      .toBe("one two three");
  });

  it("falls back to a plain outcome sentence when the completion carried no summary", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done" } }))
      .toBe("done — the result was folded into the conversation");
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "failed" } }))
      .toBe("failed — nothing was folded into the conversation");
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "stopped" } }))
      .toBe("stopped — nothing was folded into the conversation");
  });

  it("treats an all-whitespace summary as absent rather than rendering a blank line", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done", summary: "   \n " } }))
      .toBe("done — the result was folded into the conversation");
  });

  it("never claims background work on a BLOCKING delegation", () => {
    // async:false returns the child's answer inline; `details.asyncId` is absent.
    const fg: ToolCardData = { ...dispatched, result: { details: {} } };
    expect(delegationSummary(fg)).toBe("");
  });

  it("shows a foreground run's final output", () => {
    const fg: ToolCardData = {
      ...dispatched,
      result: { details: {} },
      trace: { results: [{ agent: "code-explorer", messages: [], finalOutput: "  Fourteen  files.\n" }] },
    };
    expect(delegationSummary(fg)).toBe("Fourteen files.");
  });

  it("surfaces a failure reason from the result's text content", () => {
    const failed: ToolCardData = {
      ...dispatched,
      status: "error",
      result: { content: [{ type: "text", text: "Agent 'nope' requested unavailable child tools" }] },
    };
    expect(delegationSummary(failed)).toBe("Agent 'nope' requested unavailable child tools");
  });

  it("prefers the arrived outcome over the dispatch receipt", () => {
    // The ordering that IS the bug fix: `result` never changes, so if it won,
    // the card would claim background work forever.
    const done: ToolCardData = { ...dispatched, delegation: { outcome: "done", summary: "Done." } };
    expect(delegationSummary(done)).not.toContain("running in the background");
  });
});

describe("the notify carries the summary the card needs", () => {
  it("parseSubagentEvent keeps `summary` off a complete stage", () => {
    const ev = parseSubagentEvent({
      method: "notify",
      message: JSON.stringify({ kind: "hv.subagent", stage: "complete", runId: "run-7", status: "success", summary: "Mapped 14 files." }),
    });
    expect(ev?.summary).toBe("Mapped 14 files.");
  });
});

describe("the waiting line cannot outlive the run", () => {
  const src = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");

  it("SubagentTraceView still refuses to say 'waiting' once anything is known", () => {
    // The guard was written for reopened sessions (`cost`) and never fired on
    // the live path. It now covers the live outcome too.
    const view = src.slice(src.indexOf("export function SubagentTraceView"));
    const guard = view.slice(view.indexOf("results.length === 0"), view.indexOf("Waiting for the subagent"));
    expect(guard).toContain("!cost");
    expect(guard).toContain("!outcome");
  });

  it("the card hands its outcome to the trace view", () => {
    // Formatting-agnostic on purpose: the first version of this pinned a
    // single-line JSX call and broke the moment the same round wrapped it.
    expect(src).toMatch(/<SubagentTraceView[\s\S]{0,200}outcome=\{outcome\}/);
  });
});

describe("App routes the completion to the transcript card", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");

  it("remembers the asyncId → toolCallId link at dispatch", () => {
    expect(app).toContain("asyncCards");
    // The link is computed at tool_execution_end and used to be discarded.
    const end = app.slice(app.indexOf("const detached = asyncResultInfo(t.result)"));
    expect(end.slice(0, 700)).toContain("asyncCards.current[sid] ??= new Map()");
  });

  it("the complete branch updates a tool card, not only the sticky one", () => {
    const complete = app.slice(app.indexOf('sub.stage === "complete"'));
    expect(complete.slice(0, 2500)).toContain("updateToolCard");
    expect(complete.slice(0, 2500)).toContain("delegation: { outcome, summary: sub.summary }");
  });

  it("reads the run's final cost BEFORE the sticky card is torn down", () => {
    const complete = app.slice(app.indexOf('sub.stage === "complete"'), app.indexOf('sub.stage === "active"'));
    const costAt = complete.indexOf("live?.cost");
    // A1 (2026-09-10) renamed the teardown's key: the run is looked up through
    // `findByRunId` now, because `started` may have filed it under its tool
    // call id. The ORDER is the invariant, not the spelling of the key.
    const teardownAt = complete.indexOf("delete next[run.id]");
    expect(costAt).toBeGreaterThan(-1);
    expect(teardownAt).toBeGreaterThan(-1);
    expect(costAt).toBeLessThan(teardownAt);
  });
});
