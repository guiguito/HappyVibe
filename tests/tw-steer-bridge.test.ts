/**
 * PRD §12 (2026-09-26), live: steering reaches exactly the run it names. Two concurrent
 * runs of the SAME agent; a steer to one lands as a user message in THAT child's own
 * session file and never in its sibling's — asserted on the files, not on an event.
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
type Sub = { stage: string; runId?: string; agent?: string; sessionFile?: string };

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

// Pi names a child's session file before it first writes it (the file is flushed lazily).
const readIfAny = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 250)); }
  return true;
};

test.skipIf(!KEY)("a steer lands in the run it names, never in its sibling", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  fs.copyFileSync(path.join(runtime, "agents", "worker.md"), path.join(agentDir, "agents", "worker.md"));
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }, { layer: "tool", pattern: "bash", action: "allow" }], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
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

  const sessions = () => subs.filter((s) => s.stage === "session" && s.agent !== "workflow");
  const ok = await askUntil(() => c.send({
    type: "prompt",
    message:
      "Use the Agent tool TWICE in this one turn, both background, both subagent_type 'worker'. " +
      "First: description 'Sleeper A', prompt 'Run the bash command \"sleep 30\", then reply with the word ALPHA.' " +
      "Second: description 'Sleeper B', prompt 'Run the bash command \"sleep 30\", then reply with the word BETA.' Then end your turn.",
  }), () => sessions().length >= 2, { waitMs: 60_000 });
  expect(ok, JSON.stringify(subs)).toBe(true);
  const [a, b] = sessions();

  const secret = `STEER-${Date.now()}`;
  await c.send({ type: "prompt", message: `/hv-subagent-steer ${a.runId} ${Buffer.from(`Also include the word ${secret} in your reply.`).toString("base64")}` });
  expect(await waitFor(() => subs.some((s) => s.stage === "steer-sent" && s.runId === a.runId), 15_000), JSON.stringify(subs)).toBe(true);

  // A steer is delivered after the current tool call; wait for the child to take it.
  expect(await waitFor(() => readIfAny(a.sessionFile!).includes(secret), 90_000), "the steer reached the run it named").toBe(true);
  expect(readIfAny(b.sessionFile!).includes(secret), "and never its sibling").toBe(false);
}, 300_000);

test.skipIf(!KEY)("a steer to a run that is not running is refused, and says so", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer2-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer2-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twsteer2-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
  const subs: Sub[] = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => {
    const r = u as Ui;
    if (r.method !== "notify") return;
    try { const m = JSON.parse(r.message ?? "") as Sub & { kind?: string }; if (m.kind === "hv.subagent") subs.push(m); } catch { /* not ours */ }
  });
  await c.start();
  await new Promise((r) => setTimeout(r, 1500));
  await c.send({ type: "prompt", message: `/hv-subagent-steer no-such-run ${Buffer.from("hello").toString("base64")}` });
  expect(await waitFor(() => subs.some((s) => s.stage === "steer-error" && s.runId === "no-such-run"), 15_000), JSON.stringify(subs)).toBe(true);
}, 60_000);
