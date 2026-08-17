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
import { REDACTED_PROMPT } from "../pi-runtime/extensions/hv-rules";
import {
  claimTask,
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
    stashPendingTask(s, "map the repo", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    expect(taskFor(s, "run-1")).toBe("map the repo");
    // Claimed once — a second run must not inherit the same caption.
    expect(claimTask(s, "run-2", "code-explorer")).toBeUndefined();
  });

  it("keeps captions with their own agent when two delegations are in flight", () => {
    // THE failure this design exists to prevent: two delegations dispatched in one
    // turn, announced in either order, must not swap captions. A plain FIFO gets
    // this wrong the moment the second run announces first.
    const s = emptyTaskMap();
    stashPendingTask(s, "map the repo", "code-explorer");
    stashPendingTask(s, "draft the AGENTS.md", "agents-md-maker");

    expect(claimTask(s, "run-b", "agents-md-maker")).toBe("draft the AGENTS.md");
    expect(claimTask(s, "run-a", "code-explorer")).toBe("map the repo");
  });

  it("does not hand a DENIED delegation's caption to the retry that follows", () => {
    // The case that chose a slot over a queue. A denied call still passes through
    // tool_call, so a queue would hold "task A" forever and caption the next
    // code-explorer run with it. Last-write-wins cannot: the retry overwrites
    // before dispatch, because every dispatch records its own caption first.
    const s = emptyTaskMap();
    stashPendingTask(s, "task A — denied", "code-explorer");
    stashPendingTask(s, "task B — allowed", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("task B — allowed");
    expect(claimTask(s, "run-2", "code-explorer")).toBeUndefined();
  });

  it("falls back to the one outstanding dispatch when the event names no agent", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "map the repo", "code-explorer");
    expect(claimTask(s, "run-1")).toBe("map the repo");
  });

  it("refuses to guess when the event names no agent and several are outstanding", () => {
    // A blank caption is a smaller lie than a wrong one.
    const s = emptyTaskMap();
    stashPendingTask(s, "map the repo", "code-explorer");
    stashPendingTask(s, "draft the AGENTS.md", "agents-md-maker");
    expect(claimTask(s, "run-1")).toBeUndefined();
  });

  it("is idempotent per run, so a re-announced run keeps its caption", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "map the repo", "code-explorer");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    expect(claimTask(s, "run-1", "code-explorer")).toBe("map the repo");
    expect(Object.keys(s.pending)).toHaveLength(0);
  });

  it("returns undefined rather than guessing when nothing was stashed", () => {
    const s = emptyTaskMap();
    expect(claimTask(s, "run-1", "code-explorer")).toBeUndefined();
    expect(taskFor(s, "run-1")).toBeUndefined();
    expect(taskFor(s, undefined)).toBeUndefined();
  });
});

describe("refusing to store what must not be displayed", () => {
  it("never stores the 0.50 redaction, even if it arrives as the tool input", () => {
    // Defence in depth: today the tool INPUT still holds the real task, but if a
    // future pin redacts that too, this must degrade to an uncaptioned card rather
    // than launder "[prompt redacted]" into the UI through our own store.
    const s = emptyTaskMap();
    stashPendingTask(s, REDACTED_PROMPT, "code-explorer");
    expect(Object.keys(s.pending)).toHaveLength(0);
    expect(claimTask(s, "run-1", "code-explorer")).toBeUndefined();
  });

  it("ignores empty, blank and non-string tasks", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "", "a");
    stashPendingTask(s, "   ", "a");
    stashPendingTask(s, undefined, "a");
    stashPendingTask(s, 42, "a");
    expect(Object.keys(s.pending)).toHaveLength(0);
  });

  it("caps a caption to a card-sized string", () => {
    // The store rides a session entry; this is a caption, not a transcript. A slot
    // per agent is inherently bounded, so there is no backlog to cap besides this.
    const s = emptyTaskMap();
    stashPendingTask(s, "x".repeat(500), "a");
    expect(s.pending.a.length).toBeLessThanOrEqual(300);
    expect(s.pending.a.endsWith("…")).toBe(true);
  });
});

describe("surviving a respawn or an app restart", () => {
  it("round-trips the run map", () => {
    const s = emptyTaskMap();
    stashPendingTask(s, "map the repo", "code-explorer");
    claimTask(s, "run-1", "code-explorer");
    const restored = restoreTaskMap(serializeTaskMap(s));
    expect(taskFor(restored, "run-1")).toBe("map the repo");
  });

  it("does NOT persist unclaimed tasks", () => {
    // An unclaimed task belongs to a dispatch that never announced a run. Replaying
    // it after a restart would hand its caption to whichever run announces first.
    const s = emptyTaskMap();
    stashPendingTask(s, "never dispatched", "code-explorer");
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
    stashPendingTask(s, "map the repo", "code-explorer");
    claimTask(s, "run-1", "code-explorer");
    releaseTask(s, "run-1");
    expect(taskFor(s, "run-1")).toBeUndefined();
    expect(serializeTaskMap(s).runs).toEqual({});
  });
});
