/**
 * PRD §12/§17/§19 (2026-09-26): tintinweb's child sessions, on the main side. They live
 * flat in `<sessionsDir>/subagents/` (PI_CODING_AGENT_SESSION_DIR), and a child names its
 * parent in its own header (`parentSession`), so that header is the ONE link — used by
 * the cost ledger, delete, the sweep, the live card and the inspect reply.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TW_CHILD_DIR, twChildSessionFiles, twChildStatus, twDeleteChildren, twInspect, twSweepOrphans,
} from "../src/main/twChildren";
import { deleteSessionChildren, sweepOrphanedSubagentData } from "../src/main/store";
import { sessionCalls } from "../src/main/sessionLedger";

let dir: string;
let parentA: string;
let parentB: string;
let tmpRoot: string;

const line = (o: unknown) => JSON.stringify(o) + "\n";
const header = (id: string, parent?: string) => line({ type: "session", version: 3, id, timestamp: "2026-09-26T18:00:00.000Z", cwd: "/ws", ...(parent ? { parentSession: parent } : {}) });
const assistant = (content: unknown[], usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } }) =>
  line({ type: "message", id: Math.random().toString(36).slice(2), timestamp: "2026-09-26T18:00:01.000Z", message: { role: "assistant", provider: "openrouter", model: "m", content, usage } });
const toolResult = (toolCallId: string) => line({ type: "message", id: "r", timestamp: "2026-09-26T18:00:02.000Z", message: { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twkids-"));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twkids-tmp-"));
  parentA = path.join(dir, "2026-09-26T18-00-00-000Z_01a0df04-d856-77a7-9a74-b83bee27aaaa.jsonl");
  parentB = path.join(dir, "2026-09-26T18-00-00-000Z_01a0df04-d856-77a7-9a74-b83bee27bbbb.jsonl");
  fs.writeFileSync(parentA, header("01a0df04-d856-77a7-9a74-b83bee27aaaa") + assistant([{ type: "text", text: "parent A" }]));
  fs.writeFileSync(parentB, header("01a0df04-d856-77a7-9a74-b83bee27bbbb") + assistant([{ type: "text", text: "parent B" }]));
  fs.mkdirSync(path.join(dir, TW_CHILD_DIR));
});

const child = (name: string, parent: string, body: string) => {
  const f = path.join(dir, TW_CHILD_DIR, name);
  fs.writeFileSync(f, header(name.replace(/\.jsonl$/, ""), parent) + body);
  return f;
};

describe("twChildSessionFiles — the parentSession header is the link", () => {
  it("finds a parent's children and only its own", () => {
    const a1 = child("a1.jsonl", parentA, assistant([{ type: "text", text: "hi" }]));
    child("b1.jsonl", parentB, assistant([{ type: "text", text: "hi" }]));
    fs.writeFileSync(path.join(dir, TW_CHILD_DIR, "garbage.jsonl"), "not json\n");
    expect(twChildSessionFiles(dir, parentA)).toEqual([a1]);
  });
  it("answers nothing for a parent outside the sessions dir", () => {
    expect(twChildSessionFiles(dir, "/etc/passwd")).toEqual([]);
  });
});

describe("the cost ledger counts each child call once (reportUsage:false)", () => {
  it("parent + its own child, never the other parent's", () => {
    child("a1.jsonl", parentA, assistant([{ type: "text", text: "child a" }]));
    child("b1.jsonl", parentB, assistant([{ type: "text", text: "child b" }]));
    const calls = sessionCalls(dir, parentA, new Set())!;
    expect(calls).toHaveLength(2); // one parent call + one child call
  });
});

describe("twChildStatus — the live card's shape, from the child's own file", () => {
  it("turns, tools, the tool in flight and the recent ones", () => {
    const f = child("a1.jsonl", parentA,
      assistant([{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.txt" } }]) + toolResult("t1") +
      assistant([{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "ls" } }]));
    const s = twChildStatus(dir, f, "worker")!;
    expect(s.turnCount).toBe(2);
    expect(s.toolCount).toBe(2);
    expect(s.currentTool).toBe("bash");
    expect(s.recentTools?.map((t) => t.tool)).toEqual(["read", "bash"]);
    expect(s.children).toEqual([{ sessionFile: f, agent: "worker" }]);
    expect(s.steps).toEqual([{ agent: "worker", transcriptPath: f }]);
  });
  it("refuses a file outside the child dir", () => {
    expect(twChildStatus(dir, parentA, "x")).toBeNull();
  });
});

describe("twInspect — the expanded card's transcript and answer", () => {
  it("messages in order, the last assistant text as the final output", () => {
    const f = child("a1.jsonl", parentA,
      line({ type: "message", id: "u", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "do it" }] } }) +
      assistant([{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.txt" } }]) + toolResult("t1") +
      assistant([{ type: "text", text: "DONE: three files" }]));
    const r = twInspect(dir, f);
    expect(r.finalOutput).toBe("DONE: three files");
    expect(r.messages?.map((m) => `${m.role}:${m.kind}`)).toEqual(["user:text", "assistant:toolCall", "toolResult:toolResult", "assistant:text"]);
    expect(r.messages?.[1].name).toBe("read");
  });
  it("refuses a path outside the child dir", () => {
    expect(twInspect(dir, "/etc/passwd").error?.code).toBe("outside");
  });
});

describe("delete means delete (§17), and the sweep only touches what is provably ours", () => {
  it("deleting a session removes its children and its workflow temp dir, nothing else", () => {
    const a1 = child("a1.jsonl", parentA, assistant([]));
    const b1 = child("b1.jsonl", parentB, assistant([]));
    const wfA = path.join(tmpRoot, "some-cwd-slug", "01a0df04-d856-77a7-9a74-b83bee27aaaa", "tasks");
    const wfOther = path.join(tmpRoot, "some-cwd-slug", "01a0df04-d856-77a7-9a74-b83bee27aaaa-not-ours", "tasks");
    fs.mkdirSync(wfA, { recursive: true });
    fs.mkdirSync(wfOther, { recursive: true });
    twDeleteChildren(dir, parentA, tmpRoot);
    expect(fs.existsSync(a1)).toBe(false);
    expect(fs.existsSync(b1)).toBe(true);
    expect(fs.existsSync(path.dirname(wfA))).toBe(false);
    expect(fs.existsSync(path.dirname(wfOther)), "an exact name match, never a prefix").toBe(true);
  });
  it("store.deleteSessionChildren covers the tintinweb layout too (one call site)", () => {
    const a1 = child("a1.jsonl", parentA, assistant([]));
    deleteSessionChildren(dir, parentA);
    expect(fs.existsSync(a1)).toBe(false);
  });
  it("the sweep removes children whose parent is gone, and keeps the rest", () => {
    const a1 = child("a1.jsonl", parentA, assistant([]));
    const b1 = child("b1.jsonl", parentB, assistant([]));
    fs.rmSync(parentB);
    expect(twSweepOrphans(dir)).toBe(1);
    expect(fs.existsSync(a1)).toBe(true);
    expect(fs.existsSync(b1)).toBe(false);
  });
  it("store.sweepOrphanedSubagentData runs it (one call site)", () => {
    const b1 = child("b1.jsonl", parentB, assistant([]));
    fs.rmSync(parentB);
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(b1)).toBe(false);
  });
});
