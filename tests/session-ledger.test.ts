import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ledgerTotal } from "../src/main/calls";
import { agentByRunFrom, runByCallFrom, runCalls, sessionCalls } from "../src/main/sessionLedger";

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

function tree(): { dir: string; parent: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-"));
  const parent = path.join(dir, "s1.jsonl");
  fs.writeFileSync(parent, line(1000, "deepseek", "deepseek-v4-flash", 0.01) + "\n");
  const kid = path.join(dir, "s1", "run-x", "run-0");
  fs.mkdirSync(kid, { recursive: true });
  fs.writeFileSync(path.join(kid, "session.jsonl"), line(2000, "deepseek", "deepseek-v4-flash", 0.02) + "\n");
  return { dir, parent };
}

describe("sessionCalls", () => {
  test("includes the children and names the agent", () => {
    const { dir, parent } = tree();
    const calls = sessionCalls(dir, parent, new Set(), new Map([["run-x", "code-explorer"]]))!;
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

describe("runCalls", () => {
  test("narrows to one delegation's own calls", () => {
    const { dir, parent } = tree();
    const calls = runCalls(dir, parent, "run-x", new Set(), "code-explorer");
    expect(calls).toHaveLength(1);
    expect(calls[0].agent).toBe("code-explorer");
    expect(ledgerTotal(calls).cost).toBeCloseTo(0.02, 10);
  });

  test("empty for a run that wrote nothing", () => {
    const { dir, parent } = tree();
    expect(runCalls(dir, parent, "run-nope", new Set())).toEqual([]);
  });

  // FR-C4's two-paths-one-fact rule: the live readout and the restored footer
  // call the SAME function over the SAME files, so they cannot drift.
  test("a run's total is identical live and on reopen", () => {
    const { dir, parent } = tree();
    const live = ledgerTotal(runCalls(dir, parent, "run-x", new Set(), "code-explorer"));
    const restored = ledgerTotal(runCalls(dir, parent, "run-x", new Set(), "code-explorer"));
    expect(restored).toEqual(live);
  });
});

describe("agentByRunFrom", () => {
  test("reads run→agent off the delegation rows main already logs", () => {
    const m = agentByRunFrom([
      { type: "subagent.async_started", data: { runId: "r1", agent: "code-explorer" } },
      { type: "permission.decision", data: { runId: "r2", agent: "nope" } },
      { type: "subagent.async_complete", data: { runId: "r2", agent: "agents-md-maker" } },
      { type: "subagent.async_complete", data: { runId: "r3" } },
    ]);
    expect(m.get("r1")).toBe("code-explorer");
    expect(m.get("r2")).toBe("agents-md-maker");
    expect(m.has("r3")).toBe(false);
  });
});

describe("runByCallFrom", () => {
  test("maps a tool call to its run", () => {
    const m = runByCallFrom([
      { type: "subagent.async_complete", data: { runId: "r1", toolCallId: "call-1" } },
      { type: "subagent.async_started", data: { runId: "r2", toolCallId: "call-2" } },
      { type: "subagent.async_complete", data: { runId: "r3" } },
    ]);
    expect(m.get("call-1")).toBe("r1");
    // started rows carry no toolCallId contract — only the completion does.
    expect(m.has("call-2")).toBe(false);
    expect(m.size).toBe(1);
  });

  // Rows written before toolCallId was added must not break a reopen — they
  // simply contribute no footer (the wouldHave/dangerous-rename lesson).
  test("legacy rows without toolCallId are ignored", () => {
    expect(runByCallFrom([{ type: "subagent.async_complete", data: { runId: "r1", status: "ok" } }]).size).toBe(0);
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
