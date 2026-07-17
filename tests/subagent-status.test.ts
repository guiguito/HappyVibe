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
