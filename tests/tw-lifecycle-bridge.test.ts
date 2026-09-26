/**
 * PRD §12 (2026-09-26), live: tintinweb's lifecycle reaches main as the SAME
 * `hv.subagent` notifies the nicobailon relay sends — started → session → complete
 * for one run id — and the two controls main drives work: the resync reports a
 * running run while it runs (the busy gate's input, which keeps hibernation and MCP
 * reload away from it), and STOP ends a run as "interrupted", never as an error.
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
type Ui = { id: string; method?: string; message?: string };
type Sub = { stage: string; runId?: string; agent?: string; status?: string; summary?: string; sessionFile?: string; runs?: Array<{ runId: string }> };

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

async function boot() {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twlife-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twlife-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twlife-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(ws, `f${i}.txt`), `hello ${i}\n`);
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }, { layer: "tool", pattern: "bash", action: "allow" }], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { subagentsLib: "tintinweb", agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
  const subs: Sub[] = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => {
    const r = u as Ui;
    if (r.method === "select") c.respondUi(r.id, { value: "Allow" });
    if (r.method !== "notify") return;
    try { const m = JSON.parse(r.message ?? "") as Sub & { kind?: string }; if (m.kind === "hv.subagent") subs.push(m); } catch { /* not ours */ }
  });
  await c.start();
  return { c, subs, sessionDir };
}

const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 250)); }
  return true;
};

test.skipIf(!KEY)("started → session → complete for one run id; the resync sees it while it runs", async () => {
  const { c, subs, sessionDir } = await boot();
  const started = () => subs.find((s) => s.stage === "started" && s.agent === "worker");
  const ok = await askUntil(() => c.send({
    type: "prompt",
    message: "Use the Agent tool now with subagent_type 'worker' (background, the default), description 'Sleep then list', and prompt: 'Run the bash command \"sleep 15\", then run \"ls\" and report the file names.' Then end your turn with one line.",
  }), () => !!started(), { waitMs: 60_000 });
  expect(ok, JSON.stringify(subs)).toBe(true);
  const runId = started()!.runId!;

  // The busy gate's input: while it runs, the resync names it.
  await c.send({ type: "prompt", message: "/hv-subagent-list" });
  expect(await waitFor(() => subs.some((s) => s.stage === "active" && s.runs?.some((r) => r.runId === runId)), 10_000), "resync lists the running run").toBe(true);

  expect(await waitFor(() => subs.some((s) => s.stage === "session" && s.runId === runId), 20_000), "the child's session file is announced").toBe(true);
  const sessionFile = subs.find((s) => s.stage === "session" && s.runId === runId)!.sessionFile!;
  expect(sessionFile.startsWith(path.join(sessionDir, "subagents") + path.sep), sessionFile).toBe(true);

  expect(await waitFor(() => subs.some((s) => s.stage === "complete" && s.runId === runId), 120_000), "completion arrives for the SAME run id").toBe(true);
  const done = subs.find((s) => s.stage === "complete" && s.runId === runId)!;
  expect(done).toMatchObject({ agent: "worker", status: "success" });
  expect(done.summary!.length).toBeLessThanOrEqual(500);

  // After it settles, nothing is running.
  const before = subs.length;
  await c.send({ type: "prompt", message: "/hv-subagent-list" });
  expect(await waitFor(() => subs.slice(before).some((s) => s.stage === "active" && (s.runs ?? []).length === 0), 10_000)).toBe(true);
}, 300_000);

test.skipIf(!KEY)("STOP ends a run as interrupted, never as an error", async () => {
  const { c, subs } = await boot();
  const started = () => subs.find((s) => s.stage === "started");
  const ok = await askUntil(() => c.send({
    type: "prompt",
    message: "Use the Agent tool now with subagent_type 'worker' (background), description 'Long sleep', and prompt: 'Run the bash command \"sleep 120\" and report when done.' Then end your turn with one line.",
  }), () => !!started(), { waitMs: 60_000 });
  expect(ok).toBe(true);
  const runId = started()!.runId!;
  await new Promise((r) => setTimeout(r, 4000));
  await c.send({ type: "prompt", message: `/hv-subagent-interrupt ${runId}` });
  expect(await waitFor(() => subs.some((s) => s.stage === "complete" && s.runId === runId), 30_000), JSON.stringify(subs)).toBe(true);
  expect(subs.find((s) => s.stage === "complete" && s.runId === runId)!.status).toBe("interrupted");
  expect(subs.some((s) => s.stage === "interrupt-sent" && s.runId === runId)).toBe(true);
}, 300_000);
