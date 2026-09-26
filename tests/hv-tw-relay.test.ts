/**
 * tintinweb lifecycle → hv.subagent (PRD §12, 2026-09-26). Fixtures are the payloads
 * captured in Phase 0 (docs/validation/d1.md § tintinweb wire shapes), verbatim.
 */
import { describe, expect, it } from "vitest";
import { registerTwRelay, twNotify, type TwNotify } from "../pi-runtime/extensions/hv-tw-relay";

const STARTED = { id: "4def0fc5-0e58-4e3", type: "code-explorer", description: "List files in current folder" };
const COMPLETED = {
  id: "4def0fc5-0e58-4e3", type: "code-explorer", description: "List files in current folder",
  result: "The current folder contains five files:\n\n1. `file0.txt`\n2. `file1.txt`\n3. `file2.txt`\n4. `file3.txt`\n5. `file4.txt`",
  status: "completed", toolUses: 1, durationMs: 3858,
};
const FAILED_401 = { id: "b8e82bc0-3c8c-457", type: "code-explorer", status: "error", error: "401: {\"message\":\"User not found.\",\"code\":401}", result: "" };

describe("twNotify", () => {
  it("started → the card's run id, agent and caption", () => {
    expect(twNotify("subagents:started", STARTED)).toEqual({ stage: "started", runId: STARTED.id, agent: "code-explorer", task: "List files in current folder" });
  });
  it("completed → success, the answer as summary (capped at 500)", () => {
    const n = twNotify("subagents:completed", { ...COMPLETED, result: "x".repeat(900) })!;
    expect(n).toMatchObject({ stage: "complete", runId: COMPLETED.id, agent: "code-explorer", status: "success" });
    expect(n.summary).toHaveLength(500);
  });
  it("failed → error, and a user STOP reads as interrupted, never as an error", () => {
    expect(twNotify("subagents:failed", FAILED_401)).toMatchObject({ stage: "complete", status: "error", summary: FAILED_401.error });
    expect(twNotify("subagents:failed", { ...FAILED_401, status: "stopped" })!.status).toBe("interrupted");
    expect(twNotify("subagents:failed", { ...FAILED_401, status: "aborted" })!.status).toBe("error");
  });
  it("workflow progress carries its entries", () => {
    expect(twNotify("subagents:workflow-progress", { runId: "wf_1", entries: [{ index: 0 }] })).toEqual({ stage: "workflow-progress", runId: "wf_1", entries: [{ index: 0 }] });
  });
  it("ignores what main does not need, and anything without an id", () => {
    expect(twNotify("subagents:created", STARTED)).toBeNull();
    expect(twNotify("subagents:started", {})).toBeNull();
    expect(twNotify("subagents:workflow-progress", {})).toBeNull();
  });
});

describe("registerTwRelay", () => {
  const harness = (sessionFile?: () => string | undefined) => {
    const handlers = new Map<string, (p: unknown) => void>();
    const sent: TwNotify[] = [];
    const results: string[] = [];
    const running = registerTwRelay({
      on: (ev, h) => handlers.set(ev, h),
      relay: (n) => sent.push(n),
      sessionFileOf: () => sessionFile?.(),
      onResult: (_id, _agent, r) => results.push(r),
    }, 5, 100);
    return { emit: (ev: string, p: unknown) => handlers.get(ev)!(p), sent, results, running };
  };

  it("tracks what is running — the busy gate's input and the resync's answer", () => {
    const h = harness();
    h.emit("subagents:started", STARTED);
    expect([...h.running]).toEqual([STARTED.id]);
    h.emit("subagents:completed", COMPLETED);
    expect([...h.running]).toEqual([]);
    expect(h.sent.map((n) => n.stage)).toEqual(["started", "complete"]);
  });

  it("hands the FULL result to the delivery store, not the 500-char summary", () => {
    const h = harness();
    h.emit("subagents:started", STARTED);
    h.emit("subagents:completed", { ...COMPLETED, result: "y".repeat(3000) });
    expect(h.results[0]).toHaveLength(3000);
  });

  it("announces the child's session file once it exists", async () => {
    let file: string | undefined;
    const h = harness(() => file);
    h.emit("subagents:started", STARTED);
    await new Promise((r) => setTimeout(r, 20));
    file = "/sessions/subagents/child.jsonl";
    await new Promise((r) => setTimeout(r, 30));
    expect(h.sent.find((n) => n.stage === "session")).toEqual({ stage: "session", runId: STARTED.id, sessionFile: file });
  });
});
