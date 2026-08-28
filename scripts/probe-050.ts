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
 * Writes /tmp/probe-050-<mode>.json.
 *
 * KEEP THIS. It started as a throwaway for the 0.50 bump and earned its place twice:
 * it found that `subagent:async-started` never fires on the workflow path (a PRD §12
 * regression invisible in source), and it proved the delivery repair end to end
 * (4 tool calls → 1). Every pin bump wants it again — the name says 050 only because
 * that is the bump it was born for.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient.ts";
import { resolvePiSpawn } from "../src/main/pi/spawn.ts";
import { LIVE, MODEL, PROVIDER_ENV } from "../tests/liveModel.ts";
import { externalAgentOverrides } from "../src/main/subagentSettings.ts";

if (!LIVE) throw new Error("need OPENROUTER_API_KEY or DEEPSEEK_API_KEY in .env");
console.error(`[probe] using ${LIVE.label}`);

const mode = (process.argv[2] ?? "async") as "async" | "fg" | "waitoff" | "respawn" | "roster" | "roster-trimmed";
const runtime = path.join(process.cwd(), "pi-runtime");

function makeAgentDir(waitToolEnabled: boolean, trimExternal = false): string {
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
  // 0.58 probe 1: the agent dir normally has NO settings.json, which is exactly
  // upstream's default — so `roster` measures what a user would get without our
  // hygiene write, and `roster-trimmed` measures it with. Uses the SAME pure
  // function main writes through, never a hand-rolled copy of the shape.
  if (trimExternal) {
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      `${JSON.stringify(externalAgentOverrides({}), null, 2)}\n`,
    );
  }
  return dir;
}

function rulesAllowingSubagent(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "probe050-rules-")), "permission-rules.json");
  // BOTH patterns, and the second is the load-bearing one. §12 (2026-08-21) gates
  // a delegation under the per-agent rule name `subagent:<agent>`, so a rule for
  // the bare tool name stopped matching — the prompt was raised, nothing here
  // answers a ui-request, and permission prompts never time out by design. The
  // probe therefore hung on `[ui] select` and measured NOTHING, silently. Tool
  // patterns are globs (globToRegExp), so `subagent:*` covers every agent.
  // Note this deliberately allows `subagent:claude-code` too: the external-agent
  // refusal runs BEFORE the rule engine, so the roster probe proves the refusal
  // fires even when a rule would have permitted it.
  fs.writeFileSync(f, JSON.stringify({
    global: [
      { layer: "tool", pattern: "subagent", action: "allow" },
      { layer: "tool", pattern: "subagent:*", action: "allow" },
    ],
    workspaces: {},
  }));
  return f;
}

// The task makes the child use a TOOL, so the update/end projections have a real
// transcript to carry — a one-turn "say PONGPROBE" child produces neither
// `messages` nor `toolCalls`, which looks identical to upstream having dropped them.
const TASK = "read notes.md with the read tool and write a DETAILED report: list every section heading and both of its facts verbatim. Be thorough and complete — do not summarise or omit any section.";
const ROSTER_PROMPT =
  "Do exactly these three things and nothing else. "
  + "(1) Call the subagent tool with {action:\"list\"} and then write out, verbatim and in full, "
  + "every agent name it returned, one per line, prefixed with ROSTER:. "
  + "(2) Call the subagent tool with {action:\"detail\", agent:\"code-explorer\"} and write out its "
  + "reply verbatim, prefixed with DETAIL:. "
  + "(3) Call the subagent tool to delegate to the agent named 'claude-code' with the task 'say hi', "
  + "and then write out whatever the tool returned verbatim, prefixed with EXTERNAL:.";

const prompt = mode === "roster" || mode === "roster-trimmed"
  ? ROSTER_PROMPT
  : mode === "fg"
  ? `Use the subagent tool right now with async: false to delegate to the agent named 'code-explorer' with the task '${TASK}'. Do not do anything else.`
  // async is the config default, but a model that is told "mode: single" tends to
  // pass async:false as well, so demand it explicitly.
  : `Use the subagent tool right now with async: true to delegate to the agent named 'code-explorer' with the task '${TASK}'. Do not do anything else, and do NOT wait for it.`;

const agentDir = makeAgentDir(mode === "waitoff" ? false : true, mode === "roster-trimmed");
const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "probe050-cwd-")));
fs.writeFileSync(path.join(cwd, "probe-target.txt"), "PONGPROBE\n");
// A file big enough that a faithful report exceeds upstream's 1,000-char
// completion truncation — otherwise the delivery arrives whole and the very thing
// we are probing never happens.
fs.writeFileSync(
  path.join(cwd, "notes.md"),
  Array.from({ length: 40 }, (_, i) =>
    `## Section ${i + 1}: topic-${i + 1}\n- fact ${i + 1}A: the value is ${i * 7 + 3}\n- fact ${i + 1}B: depends on topic-${Math.max(1, i)}\n`).join("\n"),
);
// Hoisted: `respawn` needs to find the session file this run wrote, so it can
// resume it in a SECOND Pi process exactly the way startClient(meta, true) does.
const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe050-sess-"));
const rulesFile = rulesAllowingSubagent();
// `sessionId` is what hv-owner-seed.ts turns into HV_SUBAGENT_OWNER, so the probe
// must pass it or it measures a Pi with no owner claim — which is how the first
// respawn attempt came back with a raw randomUUID in status.json.
const spawnOpts = { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL, sessionId: "probe-session" };
const spec = resolvePiSpawn(cwd, sessionsDir, runtime, spawnOpts);

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

/**
 * Does a detached run's completion still reach a RESPAWNED parent?
 *
 * pi-subagents 0.51 (#1225) refuses any non-foreground completion whose
 * `completionOwnerId` differs from the current process's, and mints that id as a
 * `randomUUID()` per Pi process. HappyVibe respawns Pi and resumes the SAME
 * session file on purpose (hibernation wake, MCP live-reload, app relaunch), so
 * this is the measurement that decides whether the seed is needed at all — and,
 * run again after it lands, whether it works. Source cannot answer it: at 0.50
 * both `async-started` emit sites were present and unconditional and the event
 * still never fired.
 *
 * The child is detached and `unref`'d, so killing the parent mid-run leaves it
 * running — which is exactly the situation being measured.
 */
/** How long to let the child work before killing its parent. */
const SETTLE_MS = 25_000;

/** The run dir for an async id, found the same way dump() finds them. */
function findRunDir(asyncId: string): string | undefined {
  for (const d of fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith("pi-subagents-uid-"))) {
    const candidate = path.join(os.tmpdir(), d, "async-subagent-runs", asyncId);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function runRespawn(): Promise<void> {
  await client.start();
  await client.send({ type: "prompt", message: prompt });

  // Wait for the DISPATCH only, never for the result — the point is to die first.
  const asyncId = await new Promise<string | undefined>((done) => {
    const timer = setTimeout(() => done(undefined), 90_000);
    client.on("event", (e) => {
      const id = (e as { type?: string; result?: { details?: { asyncId?: string } } });
      if (id.type === "tool_execution_end" && id.result?.details?.asyncId) {
        clearTimeout(timer);
        done(id.result.details.asyncId);
      }
    });
  });
  console.error(`[probe] dispatched asyncId=${asyncId ?? "(none — the model never delegated)"}`);
  if (!asyncId) throw new Error("no async delegation dispatched; re-ask rather than believing a negative result");

  // Let the child actually get going. Killing the parent the instant the
  // dispatch returns measures nothing useful: the first attempt did exactly that
  // and the runner was gone inside 2.7 s ("exited or disappeared before writing a
  // result"), so the run failed for reasons unrelated to owner scoping. The real
  // case is a user quitting with a delegation already well under way.
  await sleep(SETTLE_MS);

  const runDir = findRunDir(asyncId);
  const pidOf = (): number | undefined => {
    if (!runDir) return undefined;
    try { return JSON.parse(fs.readFileSync(path.join(runDir, "status.json"), "utf8")).pid as number; } catch { return undefined; }
  };
  const alive = (pid: number | undefined): boolean => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  const childPid = pidOf();
  const aliveBefore = alive(childPid);
  console.error(`[probe] child pid=${childPid} aliveBeforeKill=${aliveBefore} runDir=${runDir ?? "(not found)"}`);
  if (!aliveBefore) throw new Error("the child was already gone before the kill; nothing about owner scoping can be measured from this run");

  const before = events.length;
  events.push({ __probe: "kill-parent", asyncId, childPid, eventsBeforeKill: before });
  client.stop();
  await sleep(3_000);

  // THE confound-killer. "Not delivered" only means anything if the child lived.
  const aliveAfter = alive(childPid);
  console.error(`[probe] child aliveAfterParentKill=${aliveAfter} (detached:true means it should survive)`);
  events.push({ __probe: "child-survived-kill", aliveAfter });

  const sessionFile = fs.readdirSync(sessionsDir)
    .map((f) => path.join(sessionsDir, f))
    .find((f) => f.endsWith(".jsonl"));
  if (!sessionFile) throw new Error("no session file to resume — the probe cannot measure a respawn");
  console.error(`[probe] respawning on ${sessionFile}`);

  // The SAME session file, which is the whole point: at 0.50 that was enough.
  const second = new PiClient(resolvePiSpawn(cwd, sessionsDir, runtime, { ...spawnOpts, resumeFile: sessionFile }));
  events.push({ __probe: "respawn-boundary", sessionFile });
  second.on("event", (e) => { events.push(e); const t = (e as { type?: string }).type; if (t) console.error(`[ev2] ${t} ${(e as { toolName?: string }).toolName ?? ""}`); });
  second.on("ui-request", (u) => { uis.push(u); console.error(`[ui2] ${(u as { method?: string }).method}`); });
  await second.start();
  await sleep(180_000);
  second.stop();

  // The verdict, read off the events that arrived AFTER the boundary marker.
  const boundary = events.findIndex((e) => (e as { __probe?: string }).__probe === "respawn-boundary");
  const after = JSON.stringify(events.slice(boundary + 1));
  const delivered = after.includes("subagent-notify")
    || /Background task (completed|failed)/.test(after)
    || /Detached foreground task (completed|failed)/.test(after);
  console.error(`\n[probe] DELIVERED AFTER RESPAWN: ${delivered}`);
  console.error(`[probe] (${events.length - boundary - 1} events after the respawn boundary)`);
  // The run's own verdict, so "not delivered" can never be confused with "the
  // child failed". Only state:"complete" makes a negative result meaningful.
  const dir = findRunDir(asyncId);
  if (dir) {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")) as { state?: string; completionOwnerId?: string; steps?: Array<{ error?: string }> };
      console.error(`[probe] run state=${st.state} ownerId=${st.completionOwnerId} err=${st.steps?.map((x) => x.error).filter(Boolean).join("; ") || "(none)"}`);
    } catch { console.error("[probe] could not read the run's status.json"); }
  }
}

try {
  if (mode === "respawn") {
    await runRespawn();
  } else {
    await client.start();
    await client.send({ type: "prompt", message: prompt });
    // Long enough for dispatch + child completion + the triggered delivery turn.
    await sleep(mode === "fg" ? 90_000 : mode.startsWith("roster") ? 120_000 : 150_000);
  }
} finally {
  dump();
  client.stop();
  await sleep(500);
  process.exit(0);
}
