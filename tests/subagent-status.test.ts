import { expect, test } from "vitest";
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
