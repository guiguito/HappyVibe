/**
 * The run card's caption store (pi-runtime/extensions/hv-subagent-tasks.ts).
 *
 * pi-subagents 0.50 redacts the delegation task everywhere we could read it back,
 * so the bridge remembers it from its own tool_call. These tests pin the pairing
 * rule and, more importantly, the two refusals: the redaction must never be stored
 * (or the UI shows it anyway, laundered through us), and an unclaimed task must
 * never be replayed after a restart (or it captions somebody else's card).
 *
 * Key-free. Stays in the non-live suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REDACTED_PROMPT } from "../pi-runtime/extensions/hv-rules";
import {
  bindRun,
  claimTask,
  dropPendingTask,
  emptyTaskMap,
  releaseTask,
  restoreTaskMap,
  serializeTaskMap,
  stashPendingTask,
  taskFor,
} from "../pi-runtime/extensions/hv-subagent-tasks";

describe("pairing a dispatched task with the run it starts", () => {
  it("pairs the single-delegation case exactly", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "map the repo", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    expect(taskFor(s, "run-1")).toBe("map the repo");
    // Claimed once — a second run must not inherit the same caption.
    expect(claimTask(s, "run-2", "code-explorer")).toBeUndefined();
  });

  it("binds a run to its OWN dispatch by tool call id — the exact pairing", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-a", "Beat Saber", "code-explorer");
    stashPendingTask(s, "call-b", "Minesweeper", "code-explorer");
    // tool_result carries both ids, so the pairing cannot cross even for one agent.
    expect(bindRun(s, "call-b", "run-mine")).toBe("Minesweeper");
    expect(bindRun(s, "call-a", "run-beat")).toBe("Beat Saber");
    expect(taskFor(s, "run-beat")).toBe("Beat Saber");
    expect(taskFor(s, "run-mine")).toBe("Minesweeper");
  });

  it("two SAME-agent delegations in one turn never swap captions (2026-08-29)", () => {
    // THE REGRESSION, reproduced from a real session. The model emitted two
    // `subagent` toolCall blocks in ONE assistant message, both `code-explorer`:
    // Beat Saber and Minesweeper. Under the old per-agent slot the second stash
    // overwrote the first, the Beat Saber RUN claimed the slot and was captioned
    // "Minesweeper", and the Minesweeper run got no caption at all.
    const s = emptyTaskMap();
    stashPendingTask(s, "call_1547cde0", "Explain how the game Beat Saber works", "code-explorer");
    stashPendingTask(s, "call_27de2d17", "Explain how the Minesweeper implementation works", "code-explorer");

    // Both dispatches survive: nothing is overwritten just because the agent matches.
    expect(Object.keys(s.pending)).toHaveLength(2);

    // The started notify carries no tool call id, so with two outstanding it must
    // refuse rather than hand one run the other's caption.
    expect(claimTask(s, "f94ac707", "code-explorer"), "refuses to guess").toBeUndefined();

    // tool_result then binds each run to its own call, exactly.
    expect(bindRun(s, "call_1547cde0", "f94ac707")).toBe("Explain how the game Beat Saber works");
    expect(bindRun(s, "call_27de2d17", "753c611a")).toBe("Explain how the Minesweeper implementation works");
    expect(taskFor(s, "f94ac707")).toMatch(/Beat Saber/);
    expect(taskFor(s, "753c611a")).toMatch(/Minesweeper/);
  });

  it("keeps captions with their own agent when two delegations are in flight", () => {
    // Different agents still pair on the started notify alone, so the common
    // fan-out keeps its immediate caption rather than waiting for tool_result.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-a", "map the repo", "code-explorer");
    stashPendingTask(s, "call-b", "draft the AGENTS.md", "agents-md-maker");

    expect(claimTask(s, "run-b", "agents-md-maker")).toBe("draft the AGENTS.md");
    expect(claimTask(s, "run-a", "code-explorer")).toBe("map the repo");
  });

  it("does not hand a DENIED delegation's caption to the retry that follows", () => {
    // The case the old one-slot design existed for. Now handled by dropping the
    // refused call's own entry — the bridge knows which id it blocked — instead of
    // relying on a later write to overwrite it.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-denied", "task A — denied", "code-explorer");
    dropPendingTask(s, "call-denied");
    stashPendingTask(s, "call-retry", "task B — allowed", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("task B — allowed");
    expect(claimTask(s, "run-2", "code-explorer")).toBeUndefined();
  });

  it("refuses rather than guessing while a denied dispatch is still outstanding", () => {
    // If the drop is ever missed, the failure must be a BLANK caption, never the
    // refused task shown against a run that is really doing something else.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-denied", "task A — denied", "code-explorer");
    stashPendingTask(s, "call-retry", "task B — allowed", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBeUndefined();
    // …and the exact path still gets it right.
    expect(bindRun(s, "call-retry", "run-1")).toBe("task B — allowed");
  });

  it("falls back to the one outstanding dispatch when the event names no agent", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "map the repo", "code-explorer");
    expect(claimTask(s, "run-1")).toBe("map the repo");
  });

  it("refuses to guess when the event names no agent and several are outstanding", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "map the repo", "code-explorer");
    stashPendingTask(s, "call-2", "draft the AGENTS.md", "agents-md-maker");
    expect(claimTask(s, "run-1")).toBeUndefined();
  });

  it("is idempotent per run, so a re-announced run keeps its caption", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "map the repo", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    // A late bind for the same run must not clobber what it already shows.
    expect(bindRun(s, "call-1", "run-1")).toBe("map the repo");
  });

  it("returns undefined rather than guessing when nothing was stashed", () => {
    const s = emptyTaskMap();
    expect(claimTask(s, "run-1", "code-explorer")).toBeUndefined();
    expect(bindRun(s, "call-1", "run-1")).toBeUndefined();
  });

  it("ignores a dispatch with no tool call id, rather than storing it under a blank key", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "", "map the repo", "code-explorer");
    stashPendingTask(s, undefined, "map the repo", "code-explorer");
    expect(Object.keys(s.pending)).toHaveLength(0);
  });
});

describe("the bridge wires the exact pairing, not just the heuristic", () => {
  const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");

  it("stashes under the tool call id, never under the agent name", () => {
    // The whole bug in one line: keyed by agent, two same-agent dispatches in one
    // assistant message overwrite each other before either run announces.
    const src = readFileSync(BRIDGE, "utf8");
    expect(src).toMatch(/stashPendingTask\(subagentTasks, event\.toolCallId, input\.task, input\.agent\)/);
  });

  it("binds runId to task from tool_result, the one event carrying both ids", () => {
    const src = readFileSync(BRIDGE, "utf8");
    expect(src, "subscribes to tool_result").toMatch(/pi\.on\("tool_result"/);
    expect(src, "binds by tool call id + asyncId").toMatch(/bindRun\(subagentTasks, event\.toolCallId, runId\)/);
    expect(src, "releases the slot when there is no run to caption")
      .toMatch(/dropPendingTask\(subagentTasks, event\.toolCallId\)/);
  });

  it("tool_result is where both ids exist — asserted against Pi's own type", () => {
    // If a pin ever drops toolCallId or details from tool_result, the exact
    // pairing silently degrades to the guessing path. Fail here instead.
    const types = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "types.d.ts"),
      "utf8",
    );
    const base = types.slice(types.indexOf("interface ToolResultEventBase"));
    expect(base.slice(0, 400)).toContain("toolCallId: string");
    expect(types).toMatch(/on\(event: "tool_result"/);
  });
});

describe("refusing to store what must not be displayed", () => {
  it("never stores the 0.50 redaction, even if it arrives as the tool input", () => {
    // Defence in depth: today the tool INPUT still holds the real task, but if a
    // future pin redacts that too, this must degrade to an uncaptioned card rather
    // than launder "[prompt redacted]" into the UI through our own store.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", REDACTED_PROMPT, "code-explorer");
    expect(Object.keys(s.pending)).toHaveLength(0);
    expect(claimTask(s, "run-1", "code-explorer")).toBeUndefined();
  });

  it("ignores empty, blank and non-string tasks", () => {
    const s = emptyTaskMap();
    // Each of these must be rejected on the TASK, so every call carries a valid
    // tool call id — otherwise the id guard rejects first and the test is vacuous.
    stashPendingTask(s, "call-1", "", "a");
    stashPendingTask(s, "call-2", "   ", "a");
    stashPendingTask(s, "call-3", undefined, "a");
    stashPendingTask(s, "call-4", 42, "a");
    stashPendingTask(s, "call-5", { task: "nope" }, "a");
    expect(Object.keys(s.pending)).toHaveLength(0);
  });

  it("caps a caption to a card-sized string", () => {
    // The store rides a session entry; this is a caption, not a transcript.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "x".repeat(500), "a");
    expect(s.pending["call-1"].task.length).toBeLessThanOrEqual(300);
    expect(s.pending["call-1"].task.endsWith("…")).toBe(true);
  });
});

describe("surviving a respawn or an app restart", () => {
  it("round-trips the run map", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-1", "map the repo", "code-explorer");
    claimTask(s, "run-1", "code-explorer");
    const restored = restoreTaskMap(serializeTaskMap(s));
    expect(taskFor(restored, "run-1")).toBe("map the repo");
  });

  it("does NOT persist unclaimed tasks", () => {
    // An unclaimed task belongs to a dispatch that never announced a run. Replaying
    // it after a restart would hand its caption to whichever run announces first.
    const s = emptyTaskMap();
    stashPendingTask(s, "call-x", "never dispatched", "code-explorer");
    const restored = restoreTaskMap(serializeTaskMap(s));
    expect(restored.pending).toEqual({});
    expect(claimTask(restored, "run-1", "code-explorer")).toBeUndefined();
  });

  it("degrades to empty on absent or malformed persisted state", () => {
    // Runs on the session_start path: throwing here would cost the whole session.
    for (const raw of [undefined, null, {}, { runs: null }, { runs: [] }, { runs: "nope" }, "garbage", 7]) {
      expect(restoreTaskMap(raw)).toEqual({ pending: {}, runs: {} });
    }
  });

  it("drops a redacted or empty caption while restoring", () => {
    const restored = restoreTaskMap({ runs: { a: REDACTED_PROMPT, b: "", c: "real caption", d: 5 } });
    expect(restored.runs).toEqual({ c: "real caption" });
  });

  it("forgets a finished run so the entry cannot grow without bound", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "call-x", "map the repo", "code-explorer");
    claimTask(s, "run-1", "code-explorer");
    releaseTask(s, "run-1");
    expect(taskFor(s, "run-1")).toBeUndefined();
    expect(serializeTaskMap(s).runs).toEqual({});
  });
});
