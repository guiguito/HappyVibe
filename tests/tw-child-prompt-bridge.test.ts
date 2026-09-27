/**
 * §10 (2026-09-26, Phase 4), live: a sub-agent's `ask` reaches the human on the PARENT's
 * channel — a second `select` on the parent's own client, naming the child, offering
 * exactly Allow · Allow for this run · Deny — and each answer means what it says.
 * Asserted on the prompts the client saw and on the filesystem.
 */
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { TINTINWEB_SETTINGS } from "../src/main/subagentSettings";
import { CHILD_CHOICES } from "../pi-runtime/extensions/hv-tw-gate";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { askUntil } from "./reask";

const runtime = path.join(process.cwd(), "pi-runtime");
type Ui = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type Perm = { kind?: string; tool?: string; child?: { agent?: string; runId?: string } };

const WRITER = `---\nname: writer\ndescription: Test agent that declares a write-capable toolset.\ntools: read, write\n---\nYou are a test agent. Do exactly what the task says, using your tools.\n`;

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

/** `answer` decides each CHILD prompt; the parent's own prompts are answered by `parent`. */
async function boot(answer: (p: Perm) => string, opts: { readonly?: boolean; parent?: (p: Perm) => string } = {}) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twask-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twask-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twask-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agents", "writer.md"), WRITER);
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL, readonly: opts.readonly });
  const prompts: Array<{ perm: Perm; options?: string[] }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => {
    const r = u as Ui;
    if (r.method === "notify") {
      try { const m = JSON.parse(r.message ?? "") as Record<string, unknown>; if (m.kind === "hv.audit") audits.push(m); } catch { /* not ours */ }
      return;
    }
    if (r.method !== "select") return;
    let perm: Perm = {};
    try { perm = JSON.parse(r.title ?? "") as Perm; } catch { /* not ours */ }
    prompts.push({ perm, options: r.options });
    c.respondUi(r.id, { value: perm.child ? answer(perm) : (opts.parent ?? (() => "Deny"))(perm) });
  });
  await c.start();
  const childPrompts = () => prompts.filter((p) => p.perm.child);
  return { c, ws, childPrompts, audits };
}

const delegate = (task: string) =>
  `Use the Agent tool right now with subagent_type 'writer', run_in_background false, description 'Write files', and this exact prompt: '${task}'. Do nothing else yourself.`;

test.skipIf(!KEY)("the child's write prompts on the PARENT's client; Allow for this run covers its next write", async () => {
  const b = await boot(() => "Allow for this run");
  const both = () => fs.existsSync(path.join(b.ws, "a.txt")) && fs.existsSync(path.join(b.ws, "b.txt"));
  const ok = await askUntil(
    () => b.c.send({ type: "prompt", message: delegate("create a file a.txt containing A, then a file b.txt containing B") }),
    both,
    { waitMs: 120_000 },
  );
  expect(ok, JSON.stringify(b.childPrompts())).toBe(true);
  const first = b.childPrompts()[0];
  expect(first.perm).toMatchObject({ kind: "hv.permission", tool: "write", child: { agent: "writer" } });
  expect(first.options).toEqual([...CHILD_CHOICES]);
  // ONE prompt for two writes by the same run — the run grant held.
  expect(b.childPrompts().filter((p) => p.perm.child?.runId === first.perm.child?.runId)).toHaveLength(1);
}, 300_000);

test.skipIf(!KEY)("a NEW run prompts again — a run grant dies with its run", async () => {
  const b = await boot(() => "Allow for this run");
  const wrote = (f: string) => () => fs.existsSync(path.join(b.ws, f));
  expect(await askUntil(() => b.c.send({ type: "prompt", message: delegate("create a file one.txt containing 1") }), wrote("one.txt"), { waitMs: 120_000 })).toBe(true);
  expect(await askUntil(() => b.c.send({ type: "prompt", message: delegate("create a file two.txt containing 2") }), wrote("two.txt"), { waitMs: 120_000 })).toBe(true);
  const runs = new Set(b.childPrompts().map((p) => p.perm.child?.runId));
  expect(runs.size, JSON.stringify(b.childPrompts())).toBeGreaterThanOrEqual(2);
}, 360_000);

test.skipIf(!KEY)("the parent's session grant is inherited — the child writes with no prompt", async () => {
  // The parent's own write prompt is answered "Allow for session" first; then the child writes.
  const b = await boot(() => "Deny", { parent: (p) => (p.tool === "write" ? "Allow for session" : "Deny") });
  const ok1 = await askUntil(() => b.c.send({ type: "prompt", message: "Use the write tool yourself right now to create parent.txt containing P. Do nothing else." }), () => fs.existsSync(path.join(b.ws, "parent.txt")), { waitMs: 90_000 });
  expect(ok1).toBe(true);
  const ok2 = await askUntil(() => b.c.send({ type: "prompt", message: delegate("create a file child.txt containing C") }), () => fs.existsSync(path.join(b.ws, "child.txt")), { waitMs: 120_000 });
  expect(ok2, JSON.stringify(b.childPrompts())).toBe(true);
  expect(b.childPrompts()).toEqual([]);
}, 300_000);

test.skipIf(!KEY)("Deny refuses the child's write", async () => {
  const b = await boot(() => "Deny");
  const denied = () => b.audits.some((a) => a.source === "subagent" && a.tool === "write" && a.decision === "deny");
  const ok = await askUntil(() => b.c.send({ type: "prompt", message: delegate("create a file no.txt containing N") }), denied, { waitMs: 120_000 });
  expect(ok, JSON.stringify(b.audits)).toBe(true);
  expect(b.childPrompts().length).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(b.ws, "no.txt"))).toBe(false);
}, 300_000);
