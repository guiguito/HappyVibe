/**
 * §10 (2026-09-26, Phase 4): a sub-agent's `ask` reaches the human on the PARENT's pane,
 * offering exactly Allow · Allow for this run · Deny, and a child answer never writes a
 * persistent rule. The guard half is driven through the real in-process guard with a fake
 * policy, so what is asserted is the decision, not a source string.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePermission } from "../src/renderer/src/permission";
import { CHILD_CHOICES } from "../pi-runtime/extensions/hv-tw-gate";
import { setChildPolicy, type ChildAsk, type ChildPolicy, type PolicyAuditRow } from "../pi-runtime/extensions/hv-child-policy";
import hvChildGuard from "../pi-runtime/extensions/hv-child-guard";

describe("the prompt", () => {
  it("offers exactly three choices", () => {
    expect([...CHILD_CHOICES]).toEqual(["Allow", "Allow for this run", "Deny"]);
  });
  it("parses the child's identity", () => {
    const info = parsePermission({
      method: "select", options: [...CHILD_CHOICES],
      title: JSON.stringify({ kind: "hv.permission", tool: "bash", summary: "npm test", child: { agent: "worker", runLabel: "run 2", runId: "r2" } }),
    } as never)!;
    expect(info.child).toEqual({ agent: "worker", runLabel: "run 2", runId: "r2" });
  });
  it("a child answer never writes a persistent rule", () => {
    const src = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
    const fn = src.slice(src.indexOf("const respondPermission"), src.indexOf("const respondPermission") + 1500);
    expect(fn).toMatch(/!\s*uiReq\.info\.child\s*&&\s*\(choice === "Allow for workspace"/);
  });
});

describe("the in-process guard asks instead of refusing", () => {
  const ws = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hv-cprompt-")));
  const rulesFile = path.join(ws, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; setChildPolicy(undefined); });

  const harness = (answers: Array<"allow" | "allow-run" | "deny">, grants: string[] = [], readonly = false) => {
    process.env.HV_RULES_FILE = rulesFile;
    delete process.env.HV_BYPASS;
    if (readonly) process.env.HV_READONLY = "1";
    else delete process.env.HV_READONLY;
    const asks: ChildAsk[] = [];
    const rows: PolicyAuditRow[] = [];
    const policy: ChildPolicy = {
      extensionPaths: () => [], skillPaths: () => [], refuseSpawn: () => undefined,
      boundaryFor: () => ["read", "bash", "write"],
      audit: (r) => rows.push(r),
      hasSessionGrant: (t) => grants.includes(t),
      ask: async (req) => { asks.push(req); return answers.shift() ?? "deny"; },
    };
    setChildPolicy(policy);
    let handler: (e: { toolName?: string; input?: unknown }) => unknown = () => undefined;
    const cwd = process.cwd();
    process.chdir(ws);
    try { hvChildGuard({ on: (_ev, h) => { handler = h; } }); } finally { process.chdir(cwd); }
    const call = async (toolName: string, input: Record<string, unknown>) => {
      const prev = process.cwd();
      process.chdir(ws);
      try { return await handler({ toolName, input }); } finally { process.chdir(prev); }
    };
    return { call, asks, rows };
  };

  it("an ask becomes a prompt, and Allow runs it", async () => {
    const h = harness(["allow"]);
    expect(await h.call("bash", { command: "npm test" })).toBeUndefined();
    expect(h.asks.map((a) => a.tool)).toEqual(["bash"]);
    expect(h.rows.at(-1)).toMatchObject({ tool: "bash", decision: "allow", wouldHave: "ask" });
  });

  it("Allow for this run covers the SAME child's next call, and only that tool", async () => {
    const h = harness(["allow-run", "deny"]);
    expect(await h.call("bash", { command: "npm test" })).toBeUndefined();
    expect(await h.call("bash", { command: "npm run lint" })).toBeUndefined();
    expect(h.asks).toHaveLength(1);
    expect(await h.call("write", { path: "x.txt", content: "hi" })).toMatchObject({ block: true });
    expect(h.asks.map((a) => a.tool)).toEqual(["bash", "write"]);
  });

  it("a run grant does not survive into a NEW child", async () => {
    await harness(["allow-run"]).call("bash", { command: "npm test" });
    const second = harness(["deny"]);
    expect(await second.call("bash", { command: "npm test" })).toMatchObject({ block: true });
    expect(second.asks).toHaveLength(1);
  });

  it("the parent's session grant is inherited — no prompt", async () => {
    const h = harness([], ["bash"]);
    expect(await h.call("bash", { command: "npm test" })).toBeUndefined();
    expect(h.asks).toEqual([]);
  });

  it("Deny refuses with the user's reason", async () => {
    const h = harness(["deny"]);
    const r = (await h.call("bash", { command: "npm test" })) as { block?: boolean; reason?: string };
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/denied/i);
    expect(h.rows.at(-1)).toMatchObject({ decision: "deny", wouldHave: "ask" });
  });

  it("a read-only scheduled run never prompts — nobody is there to answer", async () => {
    const h = harness(["allow"], [], true);
    expect(await h.call("bash", { command: "npm test" })).toMatchObject({ block: true });
    expect(h.asks).toEqual([]);
  });

  it("outside the approved boundary is refused outright, never asked", async () => {
    const h = harness(["allow"]);
    expect(await h.call("edit", { path: "x.txt", edits: [] })).toMatchObject({ block: true });
    expect(h.asks).toEqual([]);
  });

  it("safe reads still run with no prompt", async () => {
    const h = harness([]);
    expect(await h.call("read", { path: "rules.json" })).toBeUndefined();
    expect(h.asks).toEqual([]);
  });
});
