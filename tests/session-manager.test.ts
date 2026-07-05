import { beforeEach, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager, sweepOrphans, type ManagedClient, type SessionExit } from "../src/main/SessionManager";

class FakeClient extends EventEmitter implements ManagedClient {
  static nextPid = 1000;
  readonly pid = ++FakeClient.nextPid;
  startedAt = 0;
  async start(): Promise<void> {
    this.startedAt = Date.now();
  }
  stop(): void {
    // real kill() is async — emulate
    setImmediate(() => this.emit("exit", { code: null }));
  }
  crash(code: number): void {
    this.emit("exit", { code });
  }
}

let dir: string;
let pidFile: string;
let spawned: FakeClient[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sm-"));
  pidFile = path.join(dir, "pids.json");
  spawned = [];
});

const makeManager = (opts: { maxActive?: number; staggerMs?: number } = {}): SessionManager =>
  new SessionManager({
    pidFile,
    staggerMs: 0,
    ...opts,
    spawn: () => {
      const c = new FakeClient();
      spawned.push(c);
      return c;
    },
  });

const readPidFile = (): Record<string, string> => JSON.parse(fs.readFileSync(pidFile, "utf8"));

test("enforces the active cap with a clear error", async () => {
  const m = makeManager({ maxActive: 2 });
  await m.start("s1", "/ws");
  await m.start("s2", "/ws");
  await expect(m.start("s3", "/ws")).rejects.toThrow(/cap reached \(2 active\)/i);
  expect(m.activeIds().sort()).toEqual(["s1", "s2"]);
});

test("maxActive is clamped to the hard cap of 8", async () => {
  const m = makeManager({ maxActive: 50 });
  for (let i = 0; i < 8; i++) await m.start(`s${i}`, "/ws");
  await expect(m.start("s9", "/ws")).rejects.toThrow(/cap/i);
});

test("one crash does not affect other sessions and reports intentional=false", async () => {
  const m = makeManager();
  const exits: SessionExit[] = [];
  m.on("session-exit", (e: SessionExit) => exits.push(e));
  await m.start("a", "/ws");
  await m.start("b", "/ws");

  spawned[0].crash(7);
  expect(exits).toEqual([{ sessionId: "a", code: 7, intentional: false }]);
  expect(m.get("a")).toBeNull();
  expect(m.get("b")).not.toBeNull();
  // crashed session can be restarted (slot was freed)
  await m.start("a", "/ws");
  expect(m.get("a")).not.toBeNull();
});

test("stop() reports intentional=true and frees the slot", async () => {
  const m = makeManager({ maxActive: 1 });
  const exit = new Promise<SessionExit>((r) => m.on("session-exit", r));
  await m.start("a", "/ws");
  m.stop("a");
  expect((await exit).intentional).toBe(true);
  await m.start("b", "/ws"); // slot freed
});

test("tracks pids on disk and removes them on exit", async () => {
  const m = makeManager();
  await m.start("a", "/ws");
  await m.start("b", "/ws");
  expect(Object.values(readPidFile()).sort()).toEqual(["a", "b"]);

  spawned[0].crash(1);
  expect(Object.values(readPidFile())).toEqual(["b"]);
});

test("starting an already-active session returns the same client", async () => {
  const m = makeManager();
  const c1 = await m.start("a", "/ws");
  const c2 = await m.start("a", "/ws");
  expect(c1).toBe(c2);
  expect(spawned).toHaveLength(1);
});

test("concurrent starts of the same session never double-spawn", async () => {
  const m = makeManager({ staggerMs: 30 });
  const [c1, c2] = await Promise.all([m.start("a", "/ws"), m.start("a", "/ws")]);
  expect(c1).toBe(c2);
  expect(spawned).toHaveLength(1);
});

test("simultaneous starts are staggered", async () => {
  const m = makeManager({ staggerMs: 60 });
  await Promise.all([m.start("a", "/ws"), m.start("b", "/ws"), m.start("c", "/ws")]);
  const times = spawned.map((c) => c.startedAt).sort((x, y) => x - y);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(40);
  expect(times[2] - times[1]).toBeGreaterThanOrEqual(40);
});

test("orphan sweep kills only tracked pids whose command matches our runtime", () => {
  fs.writeFileSync(
    pidFile,
    JSON.stringify({ "101": "s1", "102": "s2", "103": "s3" })
  );
  const killed: number[] = [];
  const cmds: Record<number, string | null> = {
    101: "/usr/bin/node .../pi-coding-agent/dist/cli.js --mode rpc", // ours
    102: "vim important.txt", // pid recycled by another process — must NOT kill
    103: null, // already dead
  };
  const result = sweepOrphans(pidFile, (pid) => cmds[pid] ?? null, (pid) => killed.push(pid));
  expect(result).toEqual([101]);
  expect(killed).toEqual([101]);
  expect(readPidFile()).toEqual({}); // file reset after sweep
});

test("orphan sweep with no pid file is a no-op", () => {
  expect(sweepOrphans(pidFile, () => null, () => { throw new Error("must not kill"); })).toEqual([]);
});
