/**
 * Throwaway wire probe for the pi-subagents 0.50 bump (docs/validation/d1.md).
 *
 * Drives ONE real delegation through the real bridge + pi-subagents at 0.50 and
 * dumps every RPC event and ui-request VERBATIM, so the migration argues from
 * measured shapes instead of inferred ones. Same spawn harness as the live
 * tests (resolvePiSpawn + PiClient), so what it sees is what the app sees.
 *
 *   node --experimental-strip-types --import jiti/register scripts/probe-050.ts async
 *   node --experimental-strip-types --import jiti/register scripts/probe-050.ts fg
 *   node --experimental-strip-types --import jiti/register scripts/probe-050.ts waitoff
 *
 * Writes /tmp/probe-050-<mode>.json. Delete this file once d1.md is written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient.ts";
import { resolvePiSpawn } from "../src/main/pi/spawn.ts";
import { LIVE, MODEL, PROVIDER_ENV } from "../tests/liveModel.ts";

if (!LIVE) throw new Error("need OPENROUTER_API_KEY or DEEPSEEK_API_KEY in .env");
console.error(`[probe] using ${LIVE.label}`);

const mode = (process.argv[2] ?? "async") as "async" | "fg" | "waitoff";
const runtime = path.join(process.cwd(), "pi-runtime");

function makeAgentDir(waitToolEnabled: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe050-dir-"));
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  for (const name of fs.readdirSync(path.join(runtime, "agents"))) {
    fs.copyFileSync(path.join(runtime, "agents", name), path.join(dir, "agents", name));
  }
  fs.mkdirSync(path.join(dir, "extensions", "subagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "extensions", "subagent", "config.json"),
    JSON.stringify({
      asyncByDefault: true,
      completionBatch: { enabled: false },
      intercomBridge: { mode: "off" },
      ...(waitToolEnabled ? {} : { waitTool: { enabled: false } }),
    }),
  );
  return dir;
}

function rulesAllowingSubagent(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "probe050-rules-")), "permission-rules.json");
  fs.writeFileSync(f, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent", action: "allow" }], workspaces: {} }));
  return f;
}

const TASK = "reply with exactly the word PONGPROBE and nothing else";
const prompt = mode === "fg"
  ? `Use the subagent tool right now with async: false (mode: single) to delegate to the agent named 'code-explorer' with the task '${TASK}'. Do not do anything else.`
  : `Use the subagent tool right now (mode: single) to delegate to the agent named 'code-explorer' with the task '${TASK}'. Do not do anything else.`;

const agentDir = makeAgentDir(mode === "waitoff" ? false : true);
const spec = resolvePiSpawn(
  fs.mkdtempSync(path.join(os.tmpdir(), "probe050-cwd-")),
  fs.mkdtempSync(path.join(os.tmpdir(), "probe050-sess-")),
  runtime,
  { agentDir, providerEnv: PROVIDER_ENV, rulesFile: rulesAllowingSubagent(), model: MODEL },
);

const client = new PiClient(spec);
const events: unknown[] = [];
const uis: unknown[] = [];
client.on("event", (e) => { events.push(e); const t = (e as { type?: string }).type; if (t) console.error(`[ev] ${t} ${(e as { toolName?: string }).toolName ?? ""}`); });
client.on("ui-request", (u) => { uis.push(u); console.error(`[ui] ${(u as { method?: string }).method}`); });

const dump = (): void => {
  // Every async run dir on disk, so we can see what status.json actually holds.
  const runsRoot = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("pi-subagents-uid-")).map((d) => path.join(os.tmpdir(), d, "async-subagent-runs"));
  const disk: Record<string, unknown> = {};
  for (const root of runsRoot) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const sf = path.join(root, entry, "status.json");
      if (fs.existsSync(sf)) disk[path.join(root, entry)] = JSON.parse(fs.readFileSync(sf, "utf8"));
      else disk[path.join(root, entry)] = `(dir, no status.json) contents=${fs.existsSync(path.join(root, entry)) && fs.statSync(path.join(root, entry)).isDirectory() ? fs.readdirSync(path.join(root, entry)).join(",") : "n/a"}`;
    }
  }
  const out = `/tmp/probe-050-${mode}.json`;
  fs.writeFileSync(out, JSON.stringify({ mode, task: TASK, events, uis, disk }, null, 2));
  console.error(`\n[probe] wrote ${out} — ${events.length} events, ${uis.length} ui-requests`);
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

try {
  await client.start();
  await client.send({ type: "prompt", message: prompt });
  // Long enough for dispatch + child completion + the triggered delivery turn.
  await sleep(mode === "fg" ? 90_000 : 150_000);
} finally {
  dump();
  client.stop();
  await sleep(500);
  process.exit(0);
}
