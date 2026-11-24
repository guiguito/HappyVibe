// Key-free: the real bridge, driven by a scripted faux model. Pins end to end what the live batch
// could only catch by luck (2026-11-22): after the user denies `bash touch forbidden.txt`, the
// model's next move — creating the same file with `write` — must ask, not slip through round 29's
// free-edit default. A real model takes that route on some runs only; the faux model takes it
// every time.
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient | undefined;
afterEach(() => client?.stop());

// The app's real spawn args, with the faux model inserted just before the bridge.
function boot(tmp: string, steps: object[]): PiClient {
  const spec = resolvePiSpawn(tmp, path.join(tmp, "sessions"), runtime, { agentDir: path.join(tmp, "agent") });
  const bridge = spec.args.findIndex((a) => a.endsWith("happyvibe-bridge.ts"));
  const args = [...spec.args.slice(0, bridge - 1), "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"), ...spec.args.slice(bridge - 1),
    "--no-session", "--provider", "faux", "--model", "script"];
  return new PiClient({
    ...spec,
    execPath: process.execPath,
    args,
    env: { ...spec.env, HOME: tmp, HV_TEST_RUNTIME: runtime, HV_FAUX_STEPS: JSON.stringify(steps) } as Record<string, string>,
  });
}

type Prompt = { tool: string; summary: string };
async function runTurn(c: PiClient, answer: string): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  c.on("ui-request", (m: { id: string; method?: string; title?: string }) => {
    if (m.method !== "select") return;
    let t: Prompt & { kind?: string };
    try { t = JSON.parse(m.title ?? "{}"); } catch { return; }
    if (t.kind !== "hv.permission") return;
    prompts.push(t);
    c.respondUi(m.id, { value: answer });
  });
  const ended = new Promise<void>((r) => c.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
  await c.start();
  await c.send({ type: "prompt", message: "go" });
  await ended;
  return prompts;
}

const tmpDir = (): string => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-denywrite-"));
  fs.mkdirSync(path.join(tmp, "agent"));
  return tmp;
};

test("control: with nothing denied, a write inside the workspace runs without asking (round 29)", async () => {
  const tmp = tmpDir();
  client = boot(tmp, [{ tool: "write", args: { path: "made.txt", content: "x" } }, { text: "done" }]);
  const prompts = await runTurn(client, "Deny");
  expect(prompts).toEqual([]);
  expect(fs.existsSync(path.join(tmp, "made.txt"))).toBe(true);
}, 60_000);

test("after the user denies bash, the same file through write asks too — and the Deny holds", async () => {
  const tmp = tmpDir();
  client = boot(tmp, [
    { tool: "bash", args: { command: "touch forbidden.txt" } },
    { tool: "write", args: { path: "forbidden.txt", content: "" } },
    { text: "done" },
  ]);
  const prompts = await runTurn(client, "Deny");
  expect(prompts.map((p) => p.tool)).toEqual(["bash", "write"]);
  expect(fs.existsSync(path.join(tmp, "forbidden.txt"))).toBe(false);
}, 60_000);
