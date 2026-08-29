import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSubagentStatus, statusUnchanged } from "../src/main/subagentStatus";

/** A run dir with a status.json, under os.tmpdir() (confinement requirement). */
function runDir(status?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-substatus-"));
  if (status !== undefined) fs.writeFileSync(path.join(dir, "status.json"), typeof status === "string" ? status : JSON.stringify(status));
  return dir;
}

test("reads and normalizes top-level status fields", () => {
  const dir = runDir({ runId: "r1", state: "running", activityState: "active_long_running", currentTool: "read", turnCount: 2, toolCount: 5 });
  const s = readSubagentStatus(dir);
  expect(s).toMatchObject({ state: "running", activityState: "active_long_running", currentTool: "read", turnCount: 2, toolCount: 5 });
});

test("falls back to steps[0] for per-step live fields", () => {
  const dir = runDir({ runId: "r1", state: "running", steps: [{ currentTool: "grep", turnCount: 3, recentTools: [{ tool: "read", args: "a.ts" }] }] });
  const s = readSubagentStatus(dir);
  expect(s?.currentTool).toBe("grep");
  expect(s?.turnCount).toBe(3);
  expect(s?.recentTools).toEqual([{ tool: "read", args: "a.ts" }]);
});

test("missing file returns null (poll again next tick)", () => {
  const dir = runDir(); // no status.json
  expect(readSubagentStatus(dir)).toBeNull();
});

test("torn/corrupt JSON returns null instead of throwing", () => {
  const dir = runDir('{ "state": "running"'); // truncated write
  expect(readSubagentStatus(dir)).toBeNull();
});

test("refuses a path outside os.tmpdir() (fs confinement)", () => {
  expect(readSubagentStatus("/etc")).toBeNull();
});

test("statusUnchanged compares only live-progress fields", () => {
  const base = { state: "running", activityState: undefined, currentTool: "read", turnCount: 1, toolCount: 2 };
  expect(statusUnchanged(base, { ...base })).toBe(true);
  expect(statusUnchanged(base, { ...base, currentTool: "grep" })).toBe(false);
  expect(statusUnchanged(base, { ...base, turnCount: 2 })).toBe(false);
  expect(statusUnchanged(null, base)).toBe(false);
  expect(statusUnchanged(null, null)).toBe(true);
});

// ── The 0.50 wiring: an async run announces itself from its DISPATCH RESULT ──
//
// pi-subagents 0.50 emits no `subagent:async-started` for a top-level delegation
// (the workflow path; at 0.58 the direct single-child path does — d1.md §0.58)
// (docs/validation/d1.md §pi-subagents 0.50), and THREE things in ipc.ts hung off
// that notify: the hibernation guard (`activity.asyncStarted` — without it a
// session with a running delegation reads as idle and can be stopped mid-run), the
// status poller, and the audit record. They are now driven by
// `tool_execution_end.result.details`, which carries both ids.
//
// The renderer suite has no DOM and ipc.ts is not unit-importable, so this pins the
// two halves that CAN be checked cheaply: that the ids we depend on are read from
// the right place, and that ipc.ts actually wires them (source scan — the
// tests/modal-layer.test.ts pattern, and an absence a render test cannot fail on).

test("the dispatch result carries the runId AND the dir the poller tails", () => {
  // Shape measured 2026-08-17 on a real async delegation. asyncId is the same id
  // the completion notify uses, which is what lets start and stop pair up.
  const details = {
    mode: "workflow",
    runId: "fa7d236f-1704-43c2-93af-b3baa974c090",
    asyncId: "fa7d236f-1704-43c2-93af-b3baa974c090",
    asyncDir: `${os.tmpdir()}/pi-subagents-uid-501/async-subagent-runs/fa7d236f`,
  };
  expect(details.asyncId).toBe(details.runId);
  expect(details.asyncDir.startsWith(os.tmpdir())).toBe(true);
});

test("ipc.ts starts the poll and the idle guard from tool_execution_end, not the notify", () => {
  const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
  const branch = ipc.slice(ipc.indexOf('e.type === "tool_execution_end"'));
  expect(branch.slice(0, 1200)).toMatch(/activity\.asyncStarted\(/);
  expect(branch.slice(0, 1200)).toMatch(/startSubagentPoll\(/);
  // The race guard: a child that finished before its dispatch event was processed
  // must not start a poller nothing will ever stop.
  expect(branch.slice(0, 1200)).toMatch(/finishedAsyncRuns\.has\(/);
  // And completion still marks it, or the guard above can never be true.
  expect(ipc).toMatch(/finishedAsyncRuns\.add\(/);
});

/**
 * pi-subagents 0.52 persists a run's status BEFORE publishing its result file,
 * closing a race where an observer could read a completed result while the run's
 * own status still said `running`.
 *
 * We carry no defensive code for that race and never did — `readSubagentStatus`
 * returning null on a torn read is atomic-write handling, a different thing, and
 * it stays. So this pin exists purely so the ordering cannot regress silently
 * underneath a poller that now depends on it.
 *
 * Asserted as a source-order comparison rather than behaviourally, because
 * reproducing it needs a real child mid-completion: the point is only that the
 * final status write still precedes the result publish inside the same function.
 */
test("upstream persists status before publishing the result (0.52 ordering)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents",
              "src", "runs", "background", "subagent-runner.ts"), "utf8");

  const publish = src.indexOf("writeAsyncResultFile(filePath, payload as Record<string, unknown>)");
  expect(publish, "the async result publish site is still findable").toBeGreaterThan(-1);

  // The last status flush before the publish — writeStatusPayload() is upstream's
  // own coalescing writer for <asyncDir>/status.json.
  const statusFlush = src.lastIndexOf("writeStatusPayload();", publish);
  expect(statusFlush, "a status flush precedes the publish").toBeGreaterThan(-1);
  expect(statusFlush).toBeLessThan(publish);
});

test("our status reader carries no retry/compensation for that race", () => {
  // If someone adds one later, this test is the place to explain why it became
  // necessary — upstream's ordering is supposed to make it unnecessary.
  const ours = fs.readFileSync(path.join(__dirname, "..", "src", "main", "subagentStatus.ts"), "utf8");
  expect(ours).not.toMatch(/setTimeout|retry|attempts/i);
});

/**
 * The child session file the cost readout depends on. Captured from a real 0.53
 * run (2026-08-22): the RUN level has no `sessionFile` at all — it is per STEP,
 * and it is the only link between a run and its own spend, because the
 * directory it names carries the run's INNER id while every id the app holds is
 * the workflow async id.
 */
describe("children (the cost readout's source)", () => {
  const write = (dir: string, status: unknown): void =>
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));

  it("reads sessionFile and agent from every step, not just the first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-status-"));
    write(dir, {
      state: "running",
      steps: [
        { agent: "code-explorer", sessionFile: "/s/a/run-0/session.jsonl" },
        { agent: "agents-md-maker", sessionFile: "/s/b/run-1/session.jsonl" },
      ],
    });
    expect(readSubagentStatus(dir)?.children).toEqual([
      { sessionFile: "/s/a/run-0/session.jsonl", agent: "code-explorer" },
      { sessionFile: "/s/b/run-1/session.jsonl", agent: "agents-md-maker" },
    ]);
  });

  it("absent before the child has a session — never an empty entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-status-"));
    write(dir, { state: "running", steps: [{ agent: "code-explorer" }] });
    expect(readSubagentStatus(dir)?.children).toBeUndefined();
  });

  // It can land on a tick where nothing else moved, and it is what unlocks the
  // readout — so its arrival has to count as a change, or the card stays blank.
  it("its arrival is a change worth pushing", () => {
    const before = { state: "running", turnCount: 1 };
    const after = { state: "running", turnCount: 1, children: [{ sessionFile: "/s/a/run-0/session.jsonl" }] };
    expect(statusUnchanged(before, after)).toBe(false);
    expect(statusUnchanged(after, after)).toBe(true);
  });
});
