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
