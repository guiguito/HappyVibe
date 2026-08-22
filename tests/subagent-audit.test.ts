/**
 * FR7 — the child guard's decisions become EventLog rows.
 *
 * Reads the guard's per-run JSONL (never rendered text, per the FR), and is
 * deliberately confined: the directory comes from our own env var, but a reader
 * that trusts its input is one bug away from tailing anything on disk.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readGuardAudit, rollupGuardAudit, guardAuditRows, clearGuardAudit } from "../src/main/subagentAudit";
import { sourceText } from "../src/renderer/src/components/AuditView";

let root: string;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-audit-root-"));
  dir = path.join(root, "child-audit");
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (runId: string, ...lines: string[]): void =>
  fs.writeFileSync(path.join(dir, `${runId}.jsonl`), lines.join("\n"));

const row = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ts: "2026-08-21T10:00:00.000Z", runId: "r1", tool: "read",
    decision: "allow", wouldHave: "allow", source: "child", summary: "{}", ...over,
  });

describe("readGuardAudit", () => {
  it("reads a run's rows in order", () => {
    write("r1", row({ tool: "read" }), row({ tool: "write", decision: "deny", wouldHave: "ask" }));
    const rows = readGuardAudit(root, dir, "r1");
    expect(rows).toHaveLength(2);
    expect(rows[0].tool).toBe("read");
    expect(rows[1].decision).toBe("deny");
  });

  it("skips a torn final line instead of losing the whole file", () => {
    // The guard appends, so a read that races a write sees a partial last line.
    // Dropping the file would lose every decision before it.
    write("r1", row(), row({ tool: "write" }), '{"ts":"2026-08-21T10:00:0');
    expect(readGuardAudit(root, dir, "r1")).toHaveLength(2);
  });

  it("skips a line that parses but is not a decision row", () => {
    write("r1", row(), JSON.stringify({ hello: "world" }));
    expect(readGuardAudit(root, dir, "r1")).toHaveLength(1);
  });

  it("returns empty for a run with no file, without throwing", () => {
    expect(readGuardAudit(root, dir, "nope")).toEqual([]);
  });

  it("REFUSES a directory outside the confined root", () => {
    fs.writeFileSync(path.join(root, "outside.jsonl"), row());
    expect(readGuardAudit(root, "/etc", "passwd")).toEqual([]);
    expect(readGuardAudit(root, path.join(root, "..", "elsewhere"), "r1")).toEqual([]);
  });

  it("REFUSES a runId that tries to climb out", () => {
    // The runId becomes a filename; upstream generates a UUID, but it arrives
    // through an env var and a file path, so it is validated rather than trusted.
    expect(readGuardAudit(root, dir, "../../etc/passwd")).toEqual([]);
    expect(readGuardAudit(root, dir, "a/b")).toEqual([]);
  });
});

describe("guardAuditRows", () => {
  it("reads every run in the directory", () => {
    write("r1", row({ runId: "r1" }));
    write("r2", row({ runId: "r2", decision: "deny" }));
    const rows = guardAuditRows(root, dir);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.runId))).toEqual(new Set(["r1", "r2"]));
  });

  it("ignores non-jsonl files", () => {
    write("r1", row());
    fs.writeFileSync(path.join(dir, "notes.txt"), "not mine");
    expect(guardAuditRows(root, dir)).toHaveLength(1);
  });
});

describe("rollupGuardAudit", () => {
  it("counts attempts and denials", () => {
    const rows = readGuardAudit(root, dir, "r1");
    expect(rollupGuardAudit(rows)).toEqual({ attempted: 0, denied: 0 });
    write("r1", row(), row({ tool: "write", decision: "deny" }), row({ tool: "edit", decision: "deny" }));
    expect(rollupGuardAudit(readGuardAudit(root, dir, "r1"))).toEqual({ attempted: 3, denied: 2 });
  });

  it("produces a rollup even for an entirely uneventful run", () => {
    // The point of the rollup: a child that did nothing surprising still leaves a
    // trace, so silence in the audit log is not ambiguous.
    write("r1", row(), row());
    expect(rollupGuardAudit(readGuardAudit(root, dir, "r1"))).toEqual({ attempted: 2, denied: 0 });
  });
});

describe("clearGuardAudit", () => {
  it("removes a drained run's file", () => {
    write("r1", row());
    expect(clearGuardAudit(root, dir, "r1")).toBe(true);
    expect(fs.existsSync(path.join(dir, "r1.jsonl"))).toBe(false);
  });

  it("is safe to call twice and refuses outside the root", () => {
    expect(clearGuardAudit(root, dir, "r1")).toBe(false);
    expect(clearGuardAudit(root, "/etc", "passwd")).toBe(false);
  });
});

describe("AuditView renders a child decision distinctly", () => {
  const base = { ts: "2026-08-21T10:00:00.000Z", tool: "write", summary: "{}", decision: "deny" as const };

  it("labels it sub-agent and NAMES the agent", () => {
    const t = sourceText({ ...base, source: "subagent", agent: "code-explorer", wouldHave: "ask" } as never);
    expect(t).toContain("sub-agent");
    expect(t).toContain("code-explorer");
  });

  it("keeps the teachable clause the column exists for", () => {
    const t = sourceText({ ...base, source: "subagent", agent: "x", wouldHave: "ask" } as never);
    expect(t).toMatch(/rules would have asked/);
  });

  it("degrades without an agent name rather than printing undefined", () => {
    const t = sourceText({ ...base, source: "subagent", wouldHave: "ask" } as never);
    expect(t).toContain("sub-agent");
    expect(t).not.toMatch(/undefined/);
  });

  it("does not disturb the parent's own sources", () => {
    expect(sourceText({ ...base, source: "user", wouldHave: "ask" } as never)).toContain("user");
    // the pre-rename fold still holds
    expect(sourceText({ ...base, source: "dangerous", wouldHave: "ask" } as never)).toContain("bypass");
  });
});

/**
 * Where the agent NAME comes from, pinned by source scan (main-side wiring, and
 * the repo's established pattern for it).
 *
 * Nothing in the event stream hands it over at the moment it is needed:
 * `tool_execution_end` carries no `args` at all, and the completion notify
 * reports upstream's generic `agent:"workflow"` which the bridge drops. So it has
 * to be correlated START→END on toolCallId. Getting this wrong is silent — rows
 * simply stop naming the child — which is why it is asserted rather than trusted.
 */
describe("the delegated agent name is correlated START→END", () => {
  const ipc = (): string => fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");

  it("captures the agent on tool_execution_start, the only event carrying args", () => {
    const src = ipc();
    expect(src).toMatch(/tool_execution_start"[\s\S]{0,300}delegatedAgentByCall\.set/);
  });

  it("no longer reads args off the END event, which never has them", () => {
    // The pre-existing quiet bug this fixed: subagent.async_started had always
    // logged agent: undefined.
    expect(ipc()).not.toMatch(/args\?\.agent\s*\}/);
  });

  it("the drain falls back to the correlated name, not the dropped notify field", () => {
    expect(ipc()).toMatch(/sub\.agent \?\? delegatedAgentByRun\.get\(sub\.runId\)/);
  });

  it("both maps are cleaned up, so a long session does not accumulate ids", () => {
    const src = ipc();
    expect(src).toContain("delegatedAgentByCall.delete(");
    expect(src).toContain("delegatedAgentByRun.delete(");
  });

  it("the bridge really does drop upstream's generic name (the reason for all this)", () => {
    const bridge = fs.readFileSync(
      path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");
    expect(bridge).toMatch(/d\.agent === "workflow" \? undefined : d\.agent/);
  });
});

/**
 * The id mismatch this drain is built around, found by a UI test rather than a
 * unit test — which is exactly the class of bug a UI test exists to catch.
 *
 * The guard names its file after PI_SUBAGENT_RUN_ID, the CHILD's own run id. The
 * completion event carries the WORKFLOW async id. Measured in the running app:
 * guard file `0d2c82ad-…`, completion runId `dd0e257a-…`. Keying the drain on the
 * completion id therefore found nothing and silently ingested zero rows, while
 * every individual piece tested green.
 */
describe("the drain must not key on the completing run's id", () => {
  it("finds rows whose runId is nothing like the workflow id", () => {
    write("0d2c82ad-d8b5-44c3-a8c6-056ea8288543",
      row({ runId: "0d2c82ad-d8b5-44c3-a8c6-056ea8288543", tool: "ls" }));
    // What the old code did: look up the workflow id.
    expect(readGuardAudit(root, dir, "dd0e257a-f00d-4bba-89f2-187befcec85e")).toEqual([]);
    // What it does now: scan.
    expect(guardAuditRows(root, dir)).toHaveLength(1);
  });

  it("groups a rollup per CHILD run, so several children are not collapsed", () => {
    write("c1", row({ runId: "c1", tool: "ls" }), row({ runId: "c1", tool: "write", decision: "deny" }));
    write("c2", row({ runId: "c2", tool: "read" }));
    const rows = guardAuditRows(root, dir);
    const byRun = new Set(rows.map((r) => r.runId));
    expect(byRun).toEqual(new Set(["c1", "c2"]));
    expect(rollupGuardAudit(rows.filter((r) => r.runId === "c1"))).toEqual({ attempted: 2, denied: 1 });
    expect(rollupGuardAudit(rows.filter((r) => r.runId === "c2"))).toEqual({ attempted: 1, denied: 0 });
  });

  it("the guard appends by PATH, which is what makes delete-after-drain lossless", () => {
    // A sibling still running has its file deleted mid-flight; because the guard
    // calls appendFileSync with a path (not a held fd), its next write recreates
    // the file and those rows arrive in a later drain instead of being lost.
    const guard = fs.readFileSync(
      path.join(__dirname, "..", "pi-runtime", "extensions", "hv-child-guard.ts"), "utf8");
    expect(guard).toMatch(/appendFileSync\(path\.join\(auditDir/);
    expect(guard, "no long-lived fd").not.toMatch(/openSync|createWriteStream/);
  });

  it("main scans rather than looking up a single run", () => {
    const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
    expect(ipc).toContain("guardAuditRows(root, root)");
    expect(ipc, "the completing run's id must not be the key").not.toMatch(/readGuardAudit\(root, root, runId\)/);
  });
});

describe("a child row under bypass stays identifiable as a child's", () => {
  const base = { ts: "2026-08-21T10:00:00.000Z", tool: "ls", summary: "{}", decision: "allow" as const };

  it("says both which child AND that bypass decided", () => {
    const t = sourceText({ ...base, source: "subagent", agent: "code-explorer", bypass: true, wouldHave: "allow" } as never);
    expect(t).toContain("sub-agent");
    expect(t).toContain("code-explorer");
    expect(t).toContain("bypass");
  });

  it("is NOT folded into a plain parent bypass row", () => {
    // The bug this fixes, seen in the running app: with the fold, a child's
    // actions under bypass rendered exactly like the parent's own and the audit
    // log could no longer answer "what did the sub-agent do".
    const child = sourceText({ ...base, source: "subagent", agent: "x", bypass: true, wouldHave: "allow" } as never);
    const parent = sourceText({ ...base, source: "bypass", wouldHave: "allow" } as never);
    expect(child).not.toBe(parent);
    expect(parent).not.toContain("sub-agent");
  });

  it("main never writes source:\"bypass\" for a child row", () => {
    const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
    expect(ipc).not.toMatch(/r\.source === "bypass" \? "bypass" : "subagent"/);
    expect(ipc).toMatch(/\.\.\.\(r\.source === "bypass" \? \{ bypass: true \} : \{\}\)/);
  });
});

describe("a delegation always leaves a trace", () => {
  it("main emits a zero rollup when the child made no tool calls", () => {
    // Seen in the running app: a child returned empty, made no tool calls, and the
    // audit log therefore said nothing about the delegation at all — which defeats
    // the rollup's purpose of making silence unambiguous.
    const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
    expect(ipc).toMatch(/rows\.length === 0[\s\S]{0,900}attempted: 0, denied: 0/);
  });

  it("that rollup is keyed by the WORKFLOW run id, the only id main has there", () => {
    const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
    expect(ipc).toMatch(/data: \{ runId: completedRunId/);
  });
});
