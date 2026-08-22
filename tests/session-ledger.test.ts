import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ledgerTotal } from "../src/main/calls";
import { agentByFileFrom, callsFromChildSessions, childSessionsByRunFrom, runByCallFrom, runTotalsByCall, sessionCalls } from "../src/main/sessionLedger";

/** One assistant line in Pi's session-file shape (verified against real files). */
const line = (ts: number, provider: string, model: string, cost: number): string =>
  JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      timestamp: ts,
      provider,
      model,
      usage: { input: 100, output: 20, cacheRead: 7, cacheWrite: 0, cost: { total: cost } },
    },
  });

function tree(): { dir: string; parent: string; childFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-"));
  const parent = path.join(dir, "s1.jsonl");
  fs.writeFileSync(parent, line(1000, "deepseek", "deepseek-v4-flash", 0.01) + "\n");
  const kid = path.join(dir, "s1", "run-x", "run-0");
  fs.mkdirSync(kid, { recursive: true });
  const childFile = path.join(kid, "session.jsonl");
  fs.writeFileSync(childFile, line(2000, "deepseek", "deepseek-v4-flash", 0.02) + "\n");
  return { dir, parent, childFile };
}

describe("sessionCalls", () => {
  test("includes the children and names the agent", () => {
    const { dir, parent, childFile } = tree();
    const calls = sessionCalls(dir, parent, new Set(), new Map([[childFile, "code-explorer"]]))!;
    expect(calls).toHaveLength(2);
    expect(calls[0].agent).toBeUndefined(); // the session's own call
    expect(calls[1].agent).toBe("code-explorer"); // the child's
  });

  test("orders the merged streams by time", () => {
    const { dir, parent } = tree();
    const ts = sessionCalls(dir, parent, new Set())!.map((c) => c.ts);
    expect(ts).toEqual([...ts].sort());
  });

  test("falls back to a generic name when no event named the run", () => {
    const { dir, parent } = tree();
    expect(sessionCalls(dir, parent, new Set())![1].agent).toBe("sub-agent");
  });

  // The whole point: the total must GROW by the child's spend, not restate it.
  // The parent's own `subagent` tool call is part of the parent stream and the
  // child's tokens exist only in the child file, so the two are disjoint.
  test("adds the child's spend to the session total without double counting", () => {
    const { dir, parent } = tree();
    const withKid = ledgerTotal(sessionCalls(dir, parent, new Set())!);
    expect(withKid.calls).toBe(2);
    expect(withKid.cost).toBeCloseTo(0.03, 10);
    expect(withKid.input).toBe(200);
    // A session file with no children beside it contributes only its own call.
    const solo = path.join(dir, "s2.jsonl");
    fs.writeFileSync(solo, line(1000, "deepseek", "deepseek-v4-flash", 0.01) + "\n");
    expect(ledgerTotal(sessionCalls(dir, solo, new Set())!).cost).toBeCloseTo(0.01, 10);
  });

  // PRD §19 ruling 3(a) at the session level: a session whose own file cannot be
  // read has an UNKNOWN cost. Collapsing that to an empty array would report it
  // as $0 — the failure the three-state billing exists to prevent.
  test("null (not empty) when the session's own file cannot be read", () => {
    const { dir } = tree();
    expect(sessionCalls(dir, path.join(dir, "missing.jsonl"), new Set())).toBeNull();
    expect(sessionCalls(dir, undefined, new Set())).toBeNull();
  });

  test("empty (not null) for a session file with nothing billed yet", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-"));
    const parent = path.join(dir, "fresh.jsonl");
    fs.writeFileSync(parent, "");
    expect(sessionCalls(dir, parent, new Set())).toEqual([]);
  });

  // PRD §19 ruling 3(b): a flat-subscription provider's dollars are never shown
  // and never summed — and a child inherits the parent's provider.
  test("classifies a child on a flat subscription as plan, never as dollars", () => {
    const { dir, parent } = tree();
    const calls = sessionCalls(dir, parent, new Set(["deepseek"]))!;
    expect(calls.every((c) => c.billing === "plan")).toBe(true);
    expect(ledgerTotal(calls).cost).toBe(0);
    expect(ledgerTotal(calls).plan).toBe(2);
  });

  // PRD §19 ruling 3(a): tokens burned at a zero rate are UNKNOWN, not free.
  test("flags an unpriced child rather than summing it as zero", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-"));
    const parent = path.join(dir, "s1.jsonl");
    fs.writeFileSync(parent, "");
    const kid = path.join(dir, "s1", "run-x", "run-0");
    fs.mkdirSync(kid, { recursive: true });
    fs.writeFileSync(path.join(kid, "session.jsonl"), line(2000, "hv-custom", "local", 0) + "\n");
    const total = ledgerTotal(sessionCalls(dir, parent, new Set())!);
    expect(total.unknown).toBe(1);
    expect(total.metered).toBe(0);
  });

  test("a torn last line in a child file is skipped, not thrown", () => {
    const { dir, parent } = tree();
    const kid = path.join(dir, "s1", "run-x", "run-0", "session.jsonl");
    fs.appendFileSync(kid, '{"type":"message","message":{"role":"assist');
    expect(() => sessionCalls(dir, parent, new Set())!).not.toThrow();
    expect(sessionCalls(dir, parent, new Set())!).toHaveLength(2);
  });
});

describe("callsFromChildSessions", () => {
  test("reads a run's own calls from the recorded paths", () => {
    const { dir, childFile } = tree();
    const calls = callsFromChildSessions(dir, [{ sessionFile: childFile, agent: "code-explorer" }], new Set());
    expect(calls).toHaveLength(1);
    expect(calls[0].agent).toBe("code-explorer");
    expect(ledgerTotal(calls).cost).toBeCloseTo(0.02, 10);
  });

  test("a path that is gone contributes nothing rather than throwing", () => {
    const { dir } = tree();
    expect(callsFromChildSessions(dir, [{ sessionFile: "/nope/session.jsonl" }], new Set())).toEqual([]);
  });

  test("a plan-billed child owes nothing", () => {
    const { dir, childFile } = tree();
    const calls = callsFromChildSessions(dir, [{ sessionFile: childFile }], new Set(["deepseek"]));
    expect(ledgerTotal(calls).cost).toBe(0);
    expect(ledgerTotal(calls).plan).toBe(1);
  });
});

describe("runTotalsByCall", () => {
  /**
   * THE regression this suite exists for. Measured 2026-08-22 in the running
   * app: a delegation whose WORKFLOW async id was 72e6fd2e-… wrote its child
   * session into a directory named 8a2f9f62-… — the run's INNER id. Every id
   * the app holds is the async one, so the first implementation looked the
   * child up by async id, found nothing, and showed no number at all. These
   * fixtures therefore use two DIFFERENT ids on purpose; using one id on both
   * sides is exactly what let the bug through.
   */
  const ASYNC_ID = "72e6fd2e-async";
  const INNER_DIR = "run-x"; // what the directory is actually named
  const rows = (childFile: string) => [
    { type: "subagent.async_started", data: { runId: ASYNC_ID, toolCallId: "call-1", agent: "code-explorer" } },
    { type: "subagent.async_complete", data: { runId: ASYNC_ID, children: [{ sessionFile: childFile, agent: "code-explorer" }] } },
  ];

  test("finds a run's spend even though its directory is named a different id", () => {
    const { dir, childFile } = tree();
    expect(childFile).toContain(INNER_DIR);
    expect(childFile).not.toContain(ASYNC_ID);
    const totals = runTotalsByCall(dir, rows(childFile), new Set());
    expect(totals.get("call-1")?.cost).toBeCloseTo(0.02, 10);
  });

  test("equals what the live card computes for the same run", () => {
    const { dir, childFile } = tree();
    const live = ledgerTotal(callsFromChildSessions(dir, [{ sessionFile: childFile, agent: "code-explorer" }], new Set()));
    expect(runTotalsByCall(dir, rows(childFile), new Set()).get("call-1")).toEqual(live);
  });

  test("no entry for a legacy row that recorded no children", () => {
    const { dir } = tree();
    const legacy = [
      { type: "subagent.async_started", data: { runId: ASYNC_ID, toolCallId: "call-1" } },
      { type: "subagent.async_complete", data: { runId: ASYNC_ID, status: "success" } },
    ];
    expect(runTotalsByCall(dir, legacy, new Set()).size).toBe(0);
  });
});

describe("childSessionsByRunFrom", () => {
  test("reads the recorded child sessions off the completion row", () => {
    const m = childSessionsByRunFrom([
      { type: "subagent.async_complete", data: { runId: "r1", children: [{ sessionFile: "/a/session.jsonl", agent: "code-explorer" }] } },
      { type: "subagent.async_complete", data: { runId: "r2", status: "success" } },
    ]);
    expect(m.get("r1")).toEqual([{ sessionFile: "/a/session.jsonl", agent: "code-explorer" }]);
    expect(m.has("r2")).toBe(false);
  });

  test("drops malformed entries rather than trusting them", () => {
    const m = childSessionsByRunFrom([
      { type: "subagent.async_complete", data: { runId: "r1", children: [{ agent: "x" }, { sessionFile: 7 }] } },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("agentByFileFrom", () => {
  // Keyed by FILE because the ledger finds children by globbing and the rows
  // are keyed by the async id — the path is the only thing both routes share.
  test("maps a child session file to the agent that wrote it", () => {
    const m = agentByFileFrom([
      { type: "subagent.async_complete", data: { runId: "r1", children: [{ sessionFile: "/a/session.jsonl", agent: "code-explorer" }] } },
      { type: "subagent.async_complete", data: { runId: "r2", children: [{ sessionFile: "/b/session.jsonl" }] } },
    ]);
    expect(m.get("/a/session.jsonl")).toBe("code-explorer");
    expect(m.has("/b/session.jsonl")).toBe(false);
  });
});

describe("CostPanel copy", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/renderer/src/components/CostPanel.tsx"), "utf8");

  // The panel used to disclaim sub-agent spend. It is included now, so the
  // disclaimer would be a lie the user reads as authoritative.
  test("no longer says sub-agent spend is reported elsewhere", () => {
    expect(src).not.toMatch(/not here/);
  });

  // PRD §19 (2026-08-22): there are no budgets, so no surface may imply a limit.
  test("never says budget", () => {
    expect(src).not.toMatch(/budget/i);
  });
});
