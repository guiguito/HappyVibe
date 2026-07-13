import { beforeEach, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager, sweepOrphans, type ManagedClient, type SessionExit } from "../src/main/SessionManager";
import { deleteSessionFile, SessionIndex } from "../src/main/store";
import { EventLog } from "../src/main/log";

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

const makeManager = (
  opts: { maxActive?: number; staggerMs?: number; hibernate?: (liveIds: string[]) => Promise<string | null> } = {}
): SessionManager =>
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

test("at the cap with no hibernation candidate, start() refuses with a clear error", async () => {
  const m = makeManager({ maxActive: 2 }); // no hibernate cb → nothing is idle
  await m.start("s1", "/ws");
  await m.start("s2", "/ws");
  await expect(m.start("s3", "/ws")).rejects.toThrow(/all 2 running sessions are actively working/i);
  expect(m.activeIds().sort()).toEqual(["s1", "s2"]);
});

test("maxActive is clamped to the hard cap of 8", async () => {
  const m = makeManager({ maxActive: 50 });
  for (let i = 0; i < 8; i++) await m.start(`s${i}`, "/ws");
  await expect(m.start("s9", "/ws")).rejects.toThrow(/all 8 running sessions/i);
});

// ── W1.3: invisible auto-hibernation ────────────────────────────────────────

test("overflow hibernates the callback's pick, then spawns the newcomer", async () => {
  const asked: string[][] = [];
  const m = makeManager({
    maxActive: 2,
    hibernate: async (live) => {
      asked.push(live);
      return "s1";
    },
  });
  const exits: SessionExit[] = [];
  m.on("session-exit", (e: SessionExit) => exits.push(e));
  await m.start("s1", "/ws");
  await m.start("s2", "/ws");
  await m.start("s3", "/ws"); // over the cap — s1 hibernated to make room
  expect(asked).toEqual([["s1", "s2"]]); // newcomer never offered as victim
  expect(exits).toEqual([{ sessionId: "s1", code: null, intentional: true }]); // never a "crash"
  expect(m.activeIds().sort()).toEqual(["s2", "s3"]);
  expect(spawned).toHaveLength(3);
});

test("hibernate returning null (all active) rejects and spawns nothing extra", async () => {
  const m = makeManager({ maxActive: 2, hibernate: async () => null });
  await m.start("s1", "/ws");
  await m.start("s2", "/ws");
  await expect(m.start("s3", "/ws")).rejects.toThrow(/actively working — stop one/i);
  expect(m.activeIds().sort()).toEqual(["s1", "s2"]);
  expect(spawned).toHaveLength(2);
});

test("a hibernated session can be started again (restore path frees + reuses the slot)", async () => {
  const m = makeManager({ maxActive: 2, hibernate: async (live) => live[0] });
  await m.start("s1", "/ws");
  await m.start("s2", "/ws");
  await m.start("s3", "/ws"); // hibernates s1
  await m.start("s1", "/ws", "/tmp/s1.session"); // reopen → hibernates s2
  expect(m.activeIds().sort()).toEqual(["s1", "s3"]);
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

// ── V2.C2: delete flow — same order as the hv:delete-session handler ────────

test("delete flow: live session is stopped first, index entry and confined file removed, events logged", async () => {
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const index = new SessionIndex(path.join(dir, "session-index.json"));
  const log = new EventLog(path.join(dir, "events.jsonl"));
  const m = makeManager();

  const meta = index.create("/ws");
  const piFile = path.join(sessions, `${meta.id}.jsonl`);
  fs.writeFileSync(piFile, "{}");
  index.update(meta.id, { piSessionFile: piFile });
  await m.start(meta.id, "/ws");

  // Handler order: live → stop (session.end) → index.remove → confined file
  // delete → session.delete event.
  const exits: SessionExit[] = [];
  m.on("session-exit", (e: SessionExit) => exits.push(e));
  expect(m.get(meta.id)).not.toBeNull(); // live → stop-first branch taken
  await log.append({ type: "session.end", sessionId: meta.id, workspaceId: meta.workspaceId });
  m.stop(meta.id);
  await new Promise((r) => setImmediate(r));
  expect(exits).toEqual([{ sessionId: meta.id, code: null, intentional: true }]); // never a "crash"

  index.remove(meta.id);
  deleteSessionFile(sessions, index.get(meta.id)?.piSessionFile ?? piFile);
  await log.append({ type: "session.delete", sessionId: meta.id, workspaceId: meta.workspaceId });

  expect(index.get(meta.id)).toBeUndefined();
  expect(fs.existsSync(piFile)).toBe(false);
  const types = (await log.read({ sessionId: meta.id })).map((e) => e.type);
  expect(types).toEqual(["session.end", "session.delete"]);
});
