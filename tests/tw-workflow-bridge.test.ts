/**
 * PRD §12 decision 7 (2026-09-26), live: a tintinweb workflow is approved as CODE.
 *  - the prompt shows the full script and offers exactly Allow · Deny;
 *  - Deny runs nothing;
 *  - an approved workflow is a run like any delegation (started → complete on the bus
 *    relay, so the busy gate and the run card cover it), and STOP ends it whole;
 *  - a `gate:` shell command NEVER runs (P5a), whatever the user approved;
 *  - an agent type that does not exist fails loud rather than becoming general-purpose.
 * The scripts are files this test writes, passed by `scriptPath`, so the model only has
 * to name a path — never retype code.
 */
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { TINTINWEB_SETTINGS } from "../src/main/subagentSettings";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { askUntil } from "./reask";

const runtime = path.join(process.cwd(), "pi-runtime");
type Ui = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type Sub = { stage: string; runId?: string; agent?: string; status?: string };

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

async function boot(answer: "Allow" | "Deny") {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twwf-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twwf-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twwf-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { subagentsLib: "tintinweb", agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
  const uis: Ui[] = [];
  const subs: Sub[] = [];
  const ends: Array<{ toolName?: string; result?: unknown }> = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => {
    const r = u as Ui;
    uis.push(r);
    if (r.method === "select") c.respondUi(r.id, { value: answer });
    if (r.method === "notify") {
      try { const m = JSON.parse(r.message ?? "") as Sub & { kind?: string }; if (m.kind === "hv.subagent") subs.push(m); } catch { /* not ours */ }
    }
  });
  c.on("event", (e) => { const ev = e as { type?: string }; if (ev.type === "tool_execution_end") ends.push(e as never); });
  await c.start();
  const workflowPrompts = () => uis.filter((u) => u.method === "select").flatMap((u) => {
    try { const t = JSON.parse(u.title ?? "") as Record<string, unknown>; return t.kind === "hv.permission" && t.tool === "workflow" ? [{ u, t }] : []; } catch { return []; }
  });
  const audits = () => uis.filter((u) => u.method === "notify").flatMap((u) => {
    try { const m = JSON.parse(u.message ?? "") as Record<string, unknown>; return m.kind === "hv.audit" ? [m] : []; } catch { return []; }
  });
  return { c, ws, sessionDir, subs, ends, workflowPrompts, audits };
}

const run = (file: string) =>
  `Use the SubagentWorkflow tool right now with scriptPath '${file}' and nothing else — no inline script. Then end your turn with one line.`;

const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 250)); }
  return true;
};

test.skipIf(!KEY)("the prompt shows the script and offers Allow · Deny only; Deny runs nothing", async () => {
  const b = await boot("Deny");
  const script = `export const meta = { name: 'hv-deny', description: 'd' }\nreturn await agent('Say ALPHA.', { agentType: 'code-explorer' })\n`;
  const file = path.join(b.ws, "deny.workflow.js");
  fs.writeFileSync(file, script);
  const ok = await askUntil(() => b.c.send({ type: "prompt", message: run(file) }), () => b.workflowPrompts().length > 0);
  expect(ok).toBe(true);
  const p = b.workflowPrompts()[0];
  expect(p.u.options).toEqual(["Allow", "Deny"]);
  expect((p.t.workflow as { script: string; agents: Array<{ type: string }> }).script).toBe(script);
  expect((p.t.workflow as { agents: Array<{ type: string }> }).agents.map((a) => a.type)).toEqual(["code-explorer"]);
  await new Promise((r) => setTimeout(r, 2000));
  expect(b.audits().some((a) => a.tool === "workflow" && a.decision === "deny" && a.source === "user")).toBe(true);
  expect(b.subs.filter((s) => s.stage === "started")).toEqual([]);
  const kids = path.join(b.sessionDir, "subagents");
  expect(fs.existsSync(kids) ? fs.readdirSync(kids) : []).toEqual([]);
}, 240_000);

test.skipIf(!KEY)("an approved workflow is a run: started → complete; and a gate command never runs", async () => {
  const b = await boot("Allow");
  const marker = path.join(b.ws, "gate-ran.txt");
  const file = path.join(b.ws, "gate.workflow.js");
  fs.writeFileSync(file, `export const meta = { name: 'hv-gate', description: 'd' }\nconst r = await agent('Reply with the single word ALPHA.', { agentType: 'code-explorer', gate: 'touch ${marker}' })\nreturn r\n`);
  const ok = await askUntil(() => b.c.send({ type: "prompt", message: run(file) }), () => b.subs.some((s) => s.stage === "started" && s.agent === "workflow"));
  expect(ok, JSON.stringify(b.subs)).toBe(true);
  const runId = b.subs.find((s) => s.stage === "started" && s.agent === "workflow")!.runId!;
  expect(runId.startsWith("wf_")).toBe(true);
  expect(await waitFor(() => b.subs.some((s) => s.stage === "complete" && s.runId === runId), 150_000), JSON.stringify(b.subs)).toBe(true);
  expect(fs.existsSync(marker), "P5a: the gate's shell command must never run").toBe(false);
}, 300_000);

test.skipIf(!KEY)("STOP ends a workflow run whole, as interrupted", async () => {
  const b = await boot("Allow");
  const file = path.join(b.ws, "long.workflow.js");
  fs.writeFileSync(file, `export const meta = { name: 'hv-long', description: 'd' }\nconst a = await agent('Run the bash command sleep 90, then reply DONE.', { agentType: 'worker' })\nreturn a\n`);
  const ok = await askUntil(() => b.c.send({ type: "prompt", message: run(file) }), () => b.subs.some((s) => s.stage === "started" && s.agent === "workflow"));
  expect(ok).toBe(true);
  const runId = b.subs.find((s) => s.stage === "started" && s.agent === "workflow")!.runId!;
  await new Promise((r) => setTimeout(r, 4000));
  await b.c.send({ type: "prompt", message: `/hv-subagent-interrupt ${runId}` });
  expect(await waitFor(() => b.subs.some((s) => s.stage === "complete" && s.runId === runId), 60_000), JSON.stringify(b.subs)).toBe(true);
  expect(b.subs.find((s) => s.stage === "complete" && s.runId === runId)!.status).toBe("interrupted");
}, 300_000);

test.skipIf(!KEY)("an agent type that does not exist is refused — never silently general-purpose", async () => {
  const b = await boot("Allow");
  const file = path.join(b.ws, "nope.workflow.js");
  fs.writeFileSync(file, `export const meta = { name: 'hv-nope', description: 'd' }\nreturn await agent('Say hi.', { agentType: 'no-such-agent' })\n`);
  const ok = await askUntil(() => b.c.send({ type: "prompt", message: run(file) }), () => b.subs.some((s) => s.stage === "started" && s.agent === "workflow"));
  expect(ok).toBe(true);
  const runId = b.subs.find((s) => s.stage === "started" && s.agent === "workflow")!.runId!;
  expect(await waitFor(() => b.subs.some((s) => s.stage === "complete" && s.runId === runId), 60_000)).toBe(true);
  // The refusal reaches the SCRIPT as its agent() call's failure (upstream's contract), so
  // the run itself may still settle; what must never happen is a substituted child — with
  // fallbackSubagent "none" nothing is built at all, which is what this proves.
  const kids = path.join(b.sessionDir, "subagents");
  expect(fs.existsSync(kids) ? fs.readdirSync(kids) : []).toEqual([]);
}, 240_000);
