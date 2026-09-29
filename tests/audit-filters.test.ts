/**
 * docs-round #7 — the Audit log's source menu filters on the STORED value, every
 * choice matches something, a sub-agent's bypassed call shows under Bypass too, and
 * schedule.* rows are read at all. The guard half is driven through the real
 * in-process guard with a fake policy (tests/child-prompt.test.ts's harness).
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCHEDULE_EVENT_LABELS, SOURCE_FILTERS, matchesFilters, sourceText, toAuditRow } from "../src/renderer/src/components/AuditView";
import { SCHEDULE_EVENT_TYPES } from "../src/main/ipc";
import { setChildPolicy, type ChildPolicy, type PolicyAuditRow } from "../pi-runtime/extensions/hv-child-policy";
import hvChildGuard from "../pi-runtime/extensions/hv-child-guard";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const bridge = fs.readFileSync("pi-runtime/extensions/happyvibe-bridge.ts", "utf8");
const view = fs.readFileSync("src/renderer/src/components/AuditView.tsx", "utf8");
const readAudit = ipc.slice(ipc.indexOf('ipcMain.handle("hv:read-audit"'), ipc.indexOf("// ── B7: local analytics"));

const decision = (data: Record<string, unknown>) =>
  toAuditRow({
    ts: "2026-09-29T10:00:00.000Z", type: "permission.decision", sessionId: "s1", workspaceId: "/w",
    data: { kind: "hv.audit", tool: "bash", summary: "ls", decision: "allow", ...data },
  } as never);
const shows = (r: ReturnType<typeof toAuditRow>, source: string, dec = ""): boolean => matchesFilters(r, dec, source);

describe("the source menu filters on the stored value", () => {
  it("Web tools and Read-only run match their rows — the value, never the label", () => {
    expect(shows(decision({ source: "web", decision: "deny" }), "web")).toBe(true);
    expect(shows(decision({ source: "readonly", decision: "deny" }), "readonly")).toBe(true);
  });

  it("every choice in the menu matches at least one kind of row", () => {
    const rows = [
      ...["rule", "user", "safe-default", "bypass", "plan", "readonly", "subagent", "terminal", "web", "document"].map((source) => decision({ source })),
      toAuditRow({ ts: "t", type: "schedule.fire", data: { scheduleId: "x", title: "Nightly" } } as never),
      toAuditRow({ ts: "t", type: "assistant.oneshot", data: { kind: "title", model: "m", estTokens: 1, ok: true } } as never),
      toAuditRow({ ts: "t", type: "model.excluded", data: { notice: "n" } } as never),
      toAuditRow({ ts: "t", type: "memory.saved", data: { name: "n" } } as never),
      toAuditRow({ ts: "t", type: "feedback.sent", data: { database: "general", formVersion: 1, submissionId: "s", status: "accepted", attachments: 0, bytes: 0 } } as never),
      toAuditRow({ ts: "t", type: "crash.sent", data: { reportId: "r", groupId: "g", isNewGroup: true, kind: "exception", bytes: 1 } } as never),
    ];
    for (const f of SOURCE_FILTERS) expect(rows.some((r) => shows(r, f.value)), f.label).toBe(true);
  });

  it("every source the bridge can write has a choice", () => {
    const union = /type AuditSource = ([^;]+);/.exec(bridge)![1];
    const sources = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThanOrEqual(10);
    const values = SOURCE_FILTERS.map((f) => f.value);
    for (const s of sources) expect(values, s).toContain(s);
  });

  it("Sub-agents and Documents are choices", () => {
    expect(SOURCE_FILTERS).toContainEqual({ value: "subagent", label: "Sub-agents" });
    expect(SOURCE_FILTERS).toContainEqual({ value: "document", label: "Documents" });
  });

  it("Bypass selects the old 'dangerous' rows too", () => {
    expect(shows(decision({ source: "dangerous" }), "bypass")).toBe(true);
    expect(shows(decision({ source: "rule" }), "bypass")).toBe(false);
  });

  it("a sub-agent call the bypass let through shows under BOTH Sub-agents and Bypass", () => {
    const r = decision({ source: "subagent", agent: "worker", bypass: true, wouldHave: "ask" });
    expect(shows(r, "subagent")).toBe(true);
    expect(shows(r, "bypass")).toBe(true);
    expect(sourceText(r as never)).toBe("sub-agent worker · bypass · rules would have asked");
  });

  it("a sub-agent call its rules decided is NOT a bypass row", () => {
    const r = decision({ source: "subagent", agent: "worker", wouldHave: "allow" });
    expect(shows(r, "subagent")).toBe(true);
    expect(shows(r, "bypass")).toBe(false);
  });

  it("the menu is rendered from SOURCE_FILTERS, and nothing compares a label", () => {
    expect(view).toMatch(/SOURCE_FILTERS\.map\(\(f\) => \(/);
    expect(view).not.toMatch(/<option value="rule">/);
    expect(view).not.toMatch(/\(SOURCE_LABEL\[r\.source\] \?\? r\.source\) === source/);
  });
});

describe("schedule rows reach the Audit log", () => {
  it("SCHEDULE_EVENT_TYPES is exactly the labelled set", () => {
    expect([...SCHEDULE_EVENT_TYPES].sort()).toEqual(Object.keys(SCHEDULE_EVENT_LABELS).sort());
  });

  it("hv:read-audit reads every one of them", () => {
    expect(readAudit).toMatch(/SCHEDULE_EVENT_TYPES\.map\(\(t\) => log\.read\(\{ type: t, \.\.\.scoped \}\)\)/);
    expect(readAudit).toMatch(/\.\.\.schedules\.flat\(\)/);
  });

  it("a schedule row answers to Schedules and steps aside under a decision filter", () => {
    const r = toAuditRow({ ts: "t", type: "schedule.skip", data: { title: "Nightly", reason: "busy" } } as never);
    expect(r.row).toBe("schedule");
    expect(shows(r, "schedule")).toBe(true);
    expect(matchesFilters(r, "allow", "")).toBe(false);
  });
});

describe("a sub-agent row records that the bypass decided it", () => {
  const ws = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hv-audit-bypass-")));
  const rulesFile = path.join(ws, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; setChildPolicy(undefined); });

  const lastRow = async (bypass: boolean, boundary: string[], tool: string, input: Record<string, unknown>) => {
    process.env.HV_RULES_FILE = rulesFile;
    if (bypass) process.env.HV_BYPASS = "1";
    else delete process.env.HV_BYPASS;
    delete process.env.HV_READONLY;
    const rows: PolicyAuditRow[] = [];
    const policy: ChildPolicy = {
      extensionPaths: () => [], skillPaths: () => [], refuseSpawn: () => undefined,
      boundaryFor: () => boundary,
      audit: (r) => rows.push(r),
      ask: async () => "deny",
    };
    setChildPolicy(policy);
    let handler: (e: { toolName?: string; input?: unknown }) => unknown = () => undefined;
    const cwd = process.cwd();
    process.chdir(ws);
    try {
      hvChildGuard({ on: (_ev, h) => { handler = h; } });
      await handler({ toolName: tool, input });
    } finally {
      process.chdir(cwd);
    }
    return rows.at(-1);
  };

  it("an allow under bypass carries bypass:true, with what the rules would have said", async () => {
    expect(await lastRow(true, ["bash"], "bash", { command: "npm test" })).toMatchObject({ decision: "allow", bypass: true, wouldHave: "ask" });
  });

  it("a boundary refusal under bypass is NOT marked — the bypass did not decide it", async () => {
    const row = await lastRow(true, ["read"], "bash", { command: "npm test" });
    expect(row).toMatchObject({ decision: "deny" });
    expect(row?.bypass).toBeUndefined();
  });

  it("without a bypass there is no flag", async () => {
    expect((await lastRow(false, ["read"], "read", { path: "rules.json" }))?.bypass).toBeUndefined();
  });

  it("the bridge forwards it onto the hv.audit row", () => {
    const at = bridge.indexOf('source: "subagent",');
    expect(bridge.slice(at, at + 300)).toMatch(/\.\.\.\(row\.bypass \? \{ bypass: true \} : \{\}\)/);
  });
});
