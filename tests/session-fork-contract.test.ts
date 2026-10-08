// Key-free: a real Pi writes a two-turn session through the faux model; the bare one-shot forks it.
import { afterAll, beforeAll, expect, test } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { nodeExecPath, PI_CLI_RELPATH, resolveForkSpawn } from "../src/main/pi/spawn";
import { forkSessionFile } from "../src/main/sessionFork";
import { leafPath, parseEntries, userEntryAt } from "../src/main/history";

const runtime = path.join(process.cwd(), "pi-runtime");
let tmp: string, dir: string, agent: string, src: string;
const userTs: number[] = [];
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const texts = (file: string) =>
  leafPath(parseEntries(fs.readFileSync(file, "utf8")))
    .filter((e) => e.type === "message" && e.message?.role === "user")
    .map((e) => JSON.stringify(e.message?.content));

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-fork-"));
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

test("a live user message_end carries the file entry's own message.timestamp (the piTs key)", () => {
  expect(userTs).toHaveLength(2);
  for (const ts of userTs) expect(userEntryAt(fs.readFileSync(src, "utf8"), ts)).not.toBeNull();
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[0])?.first).toBe(true);
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[1])?.first).toBe(false);
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[1] + 1)).toBeNull();
});

test("fork before the 2nd message: new file, history up to it, original byte-identical, copy deleted", async () => {
  const before = sha(src);
  const filesBefore = new Set(fs.readdirSync(dir));
  const hit = userEntryAt(fs.readFileSync(src, "utf8"), userTs[1])!;
  const t0 = Date.now();
  const forked = await forkSessionFile(resolveForkSpawn(tmp, dir, runtime, src, agent), dir, hit.entryId);
  console.log(`[fk1] fork one-shot: ${Date.now() - t0} ms`);
  expect(sha(src)).toBe(before);
  expect(forked).not.toBe(src);
  expect(texts(forked)).toEqual([texts(src)[0]]);
  const header = JSON.parse(fs.readFileSync(forked, "utf8").split("\n")[0]);
  expect(header.cwd).toBe(JSON.parse(fs.readFileSync(src, "utf8").split("\n")[0]).cwd);
  // Only the fork is new — the intermediate full copy is gone.
  expect(fs.readdirSync(dir).filter((f) => !filesBefore.has(f) && f.endsWith(".jsonl"))).toEqual([path.basename(forked)]);
}, 60_000);

test("duplicate: every entry copied, original byte-identical", async () => {
  const before = sha(src);
  const t0 = Date.now();
  const copy = await forkSessionFile(resolveForkSpawn(tmp, dir, runtime, src, agent), dir);
  console.log(`[fk1] duplicate one-shot: ${Date.now() - t0} ms`);
  expect(sha(src)).toBe(before);
  // The header is the new session's own id; every conversational entry keeps its id.
  const ids = (f: string) => parseEntries(fs.readFileSync(f, "utf8")).filter((e) => e.type !== "session").map((e) => e.id);
  expect(ids(copy).slice(0, ids(src).length)).toEqual(ids(src));
}, 60_000);
