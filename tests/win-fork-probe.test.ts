// THROWAWAY probe (branch guiguito/win-fork-probe) — never merged. Windows CI hangs the fork
// one-shot ~1 run in 3 (0.7 s normally, >30 s when it fails). This traces every step of many
// forks so a hang shows WHERE: boot never reaches RPC, the first write is lost, or Pi stalls.
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { nodeExecPath, PI_CLI_RELPATH, resolveForkSpawn } from "../src/main/pi/spawn";
import { forkSessionFile } from "../src/main/sessionFork";
import { userEntryAt } from "../src/main/history";

const runtime = path.join(process.cwd(), "pi-runtime");
let tmp: string, dir: string, agent: string, src: string;
const userTs: number[] = [];

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-probe-"));
  dir = path.join(tmp, "sessions"); agent = path.join(tmp, "agent");
  fs.mkdirSync(dir); fs.mkdirSync(agent);
  const c = new PiClient({
    execPath: nodeExecPath(),
    args: [path.join(runtime, PI_CLI_RELPATH), "--mode", "rpc", "--session-dir", dir,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"), "--provider", "faux", "--model", "script"],
    cwd: tmp,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOME: tmp, PI_CODING_AGENT_DIR: agent, HV_TEST_RUNTIME: runtime,
      HV_FAUX_STEPS: JSON.stringify([{ text: "one" }, { text: "two" }]) },
  });
  c.on("event", (e: { type: string; message?: { role?: string; timestamp?: number } }) => {
    if (e.type === "message_end" && e.message?.role === "user" && typeof e.message.timestamp === "number") userTs.push(e.message.timestamp);
  });
  await c.start();
  for (const text of ["first", "second"]) {
    const ended = new Promise<void>((res) => { const h = (e: { type: string }) => { if (e.type === "agent_end") { c.off("event", h); res(); } }; c.on("event", h); });
    await c.send({ type: "prompt", message: text });
    await ended;
  }
  src = ((await c.send({ type: "get_state" })).data as { sessionFile: string }).sessionFile;
  c.stop();
}, 90_000);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A PiClient that writes down everything, and on a hang asks once more before dying. */
function traced(label: string) {
  const t0 = Date.now();
  const log: string[] = [];
  const at = (s: string) => log.push(`+${String(Date.now() - t0).padStart(5)}ms ${s}`);
  let probe: Promise<void> = Promise.resolve();
  const make = (spec: ConstructorParameters<typeof PiClient>[0]) => {
    const c = new PiClient({ ...spec, env: { ...spec.env, PI_TIMING: "1" } });
    let pending = 0;
    c.on("exit", (e: { code: number | null }) => at(`exit code=${e.code}`));
    c.on("event", (e: { type: string }) => at(`event ${e.type}`));
    return {
      async start() {
        await c.start();
        const child = (c as unknown as { child: import("node:child_process").ChildProcess }).child;
        at(`spawned pid=${child.pid}`);
        child.stdout!.on("data", (d: string) => at(`stdout ${JSON.stringify(String(d).slice(0, 160))}`));
        child.stderr!.on("data", (d: string) => at(`stderr ${JSON.stringify(String(d).replace(/\s+/g, " ").slice(0, 400))}`));
      },
      async send(cmd: { type: string; [k: string]: unknown }) {
        pending++; at(`send ${cmd.type}`);
        try { const r = await c.send(cmd); at(`reply ${cmd.type} ok=${(r as { success?: boolean }).success}`); return r; }
        finally { pending--; }
      },
      stop() {
        if (pending === 0) { c.stop(); return; }
        at(`STOP with ${pending} pending — re-asking get_state`);
        probe = Promise.race([
          c.send({ type: "get_state" }).then(() => at("re-ask ANSWERED (first write lost or stuck handler)")),
          new Promise<void>((r) => setTimeout(() => { at("re-ask SILENT 5s (Pi not reading / not booted)"); r(); }, 5000)),
        ]).catch((e: Error) => at(`re-ask threw ${e.message}`)).finally(() => c.stop());
      },
    };
  };
  return { make, dump: async () => { await probe; console.log(`[probe ${label}]\n${log.join("\n")}`); } };
}

const N = 15;
test(`${N} forks + ${N} duplicates, each traced`, async () => {
  const hit = userEntryAt(fs.readFileSync(src, "utf8"), userTs[1])!;
  const failures: string[] = [];
  const ms: number[] = [];
  vi.spyOn(console, "error").mockImplementation(() => {}); // PI_TIMING noise — the trace keeps stderr
  for (let i = 0; i < N * 2; i++) {
    const kind = i % 2 ? "duplicate" : "fork";
    const tr = traced(`${kind} #${i}`);
    const t = Date.now();
    try {
      await forkSessionFile(resolveForkSpawn(tmp, dir, runtime, src, agent), dir, kind === "fork" ? hit.entryId : undefined, tr.make, 12_000);
      ms.push(Date.now() - t);
    } catch (e) {
      failures.push(`${kind} #${i}: ${(e as Error).message}`);
      await tr.dump();
    }
  }
  console.log(`[probe] ok=${ms.length} times=${ms.join(",")} failures=${JSON.stringify(failures)}`);
  expect(failures).toEqual([]);
}, 600_000);
