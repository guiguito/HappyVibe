import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { buildManifest, captureSnapshot, listSnapshots, SnapshotAborted, stampSnapshot } from "../src/main/snapshots";
import { runSnapshotOp, type SnapshotOp } from "../src/main/snapshotOps";
import {
  SNAPSHOT_BUDGET_MS, STOP_GRACE_MS, SnapshotHost, SnapshotTimeout, type SnapshotWorkerLike,
} from "../src/main/snapshotHost";

/**
 * §9 rewind runs OFF the main thread. A capture walks the whole workspace and
 * reads every changed file; on the main thread that froze the app — measured
 * 2026-10-28 with a home folder as workspace (~420k files, iCloud-only files
 * downloaded by the read): freezes of 23 s to 328 s, each ended by a force quit.
 */

const NOW = "2026-10-28T12:00:00.000Z";
let ws: string;
let root: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snapw-ws-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snapw-root-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

const blobsOf = (sessionId: string): string[] => {
  try {
    return fs.readdirSync(path.join(root, sessionId, "blobs"));
  } catch {
    return [];
  }
};

describe("a capture can be stopped, and a stopped capture leaves nothing behind", () => {
  test("the walk checks the stop between entries", () => {
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(ws, `f${i}.txt`), String(i));
    let calls = 0;
    expect(() => buildManifest([ws], ws, () => ++calls > 2)).toThrow(SnapshotAborted);
  });

  test("stopped while copying blobs: no record", () => {
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(ws, `f${i}.txt`), String(i));
    let calls = 0;
    // 5 walk checks pass, then the first blob check stops it.
    expect(() => captureSnapshot(root, "s1", [ws], ws, "pre", NOW, undefined, () => ++calls > 5)).toThrow(SnapshotAborted);
    expect(listSnapshots(root, "s1")).toEqual([]);
  });

  test("stopped at the last check, after every blob: still no record — past it a turn could stamp one", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "a");
    let calls = 0;
    // 1 walk check + 1 blob check pass; the check before the record stops it.
    expect(() => captureSnapshot(root, "s1", [ws], ws, "pre", NOW, undefined, () => ++calls > 2)).toThrow(SnapshotAborted);
    expect(listSnapshots(root, "s1")).toEqual([]);
  });

  test("blobs and records are written through a temporary name, never left half-written under the final one", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    const rec = captureSnapshot(root, "s1", [ws], ws, "pre", NOW)!;
    stampSnapshot(root, "s1", "call-1");
    expect(blobsOf("s1")).toEqual([rec.manifest.files["a.txt"]]);
    expect(fs.readdirSync(path.join(root, "s1")).filter((f) => f.includes(".tmp-"))).toEqual([]);
    expect(listSnapshots(root, "s1")[0].toolCallId).toBe("call-1");
  });
});

describe("runSnapshotOp — the worker's whole vocabulary", () => {
  const never = (): boolean => false;

  test("a capture answers with its seq, never its manifest (that lists every file)", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "a");
    const r = runSnapshotOp({ op: "capture", root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "pre", now: NOW }, never);
    expect(r).toEqual({ seq: 1 });
  });

  test("stamp, preview and restore round-trip a rewind", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "before");
    runSnapshotOp({ op: "capture", root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "pre", now: NOW }, never);
    runSnapshotOp({ op: "stamp", root, sessionId: "s1", toolCallId: "call-1" }, never);
    fs.writeFileSync(path.join(ws, "a.txt"), "after");
    runSnapshotOp({ op: "capture", root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "post", now: NOW }, never);

    const req = { root, sessionId: "s1", roots: [ws], workspaceId: ws, toolCallIds: ["call-1"] };
    expect(runSnapshotOp({ op: "preview", ...req }, never)).toEqual({ willRestore: ["a.txt"], willDelete: [], stale: [] });
    const done = runSnapshotOp({ op: "restore", ...req, now: NOW }, never) as { seq: number; result: { restored: string[] } };
    expect(done.seq).toBe(1);
    expect(done.result.restored).toEqual(["a.txt"]);
    expect(fs.readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("before");
    expect(runSnapshotOp({ op: "preview", ...req, toolCallIds: ["unknown"] }, never)).toBeNull();
  });

  test("revertImplement restores the implement baseline; deleteSession removes the session", () => {
    fs.writeFileSync(path.join(ws, "plan.md"), "v1");
    runSnapshotOp({ op: "capture", root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "pre", now: NOW, label: "implement" }, never);
    fs.writeFileSync(path.join(ws, "plan.md"), "v2");
    runSnapshotOp({ op: "capture", root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "post", now: NOW }, never);
    const r = runSnapshotOp({ op: "revertImplement", root, sessionId: "s1", roots: [ws], workspaceId: ws, now: NOW }, never) as { restored: string[] };
    expect(r.restored).toEqual(["plan.md"]);
    expect(fs.readFileSync(path.join(ws, "plan.md"), "utf8")).toBe("v1");

    runSnapshotOp({ op: "deleteSession", root, sessionId: "s1" }, never);
    expect(fs.existsSync(path.join(root, "s1"))).toBe(false);
  });
});

/** A worker the test answers by hand. */
class FakeWorker extends EventEmitter implements SnapshotWorkerLike {
  posted: Array<{ id: number; req: SnapshotOp }> = [];
  terminated = false;
  constructor(readonly stop: Int32Array) {
    super();
  }
  postMessage(m: unknown): void {
    this.posted.push(m as { id: number; req: SnapshotOp });
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(value: unknown, i = this.posted.length - 1): void {
    this.emit("message", { id: this.posted[i].id, value });
  }
  aborted(i = this.posted.length - 1): void {
    this.emit("message", { id: this.posted[i].id, error: "Snapshot stopped before it finished.", aborted: true });
  }
}

describe("SnapshotHost — one operation at a time, each with a budget", () => {
  let workers: FakeWorker[];
  let host: SnapshotHost;
  const cap = (sessionId = "s1") =>
    ({ root: "/r", sessionId, roots: ["/w"], workspaceId: "/w", kind: "pre" as const, now: NOW });

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    host = new SnapshotHost((stop) => {
      const w = new FakeWorker(new Int32Array(stop));
      workers.push(w);
      return w;
    });
  });
  afterEach(() => vi.useRealTimers());

  test("operations reach the worker in the order asked, the next only after the previous answered", async () => {
    const a = host.capture(cap(), SNAPSHOT_BUDGET_MS.pre);
    const b = host.stamp("/r", "s1", "call-1");
    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((p) => p.req.op)).toEqual(["capture"]);
    workers[0].reply({ seq: 1 });
    await expect(a).resolves.toEqual({ seq: 1 });
    expect(workers[0].posted.map((p) => p.req.op)).toEqual(["capture", "stamp"]);
    workers[0].reply(null);
    await expect(b).resolves.toBeNull();
  });

  test("past its budget a running capture is asked to stop, and its caller is told at once", async () => {
    const a = host.capture(cap(), SNAPSHOT_BUDGET_MS.pre);
    const next = host.stamp("/r", "s1", "call-1");
    const w = workers[0];
    expect(Atomics.load(w.stop, 0)).toBe(0);
    vi.advanceTimersByTime(SNAPSHOT_BUDGET_MS.pre);
    await expect(a).rejects.toBeInstanceOf(SnapshotTimeout);
    expect(Atomics.load(w.stop, 0)).toBe(1);
    // The next operation waits for the worker to acknowledge the stop…
    expect(w.posted).toHaveLength(1);
    w.aborted();
    // …then runs with the flag cleared.
    expect(w.posted.map((p) => p.req.op)).toEqual(["capture", "stamp"]);
    expect(Atomics.load(w.stop, 0)).toBe(0);
    w.reply(null);
    await expect(next).resolves.toBeNull();
  });

  test("an operation still queued at its budget never runs", async () => {
    const a = host.capture(cap("s1"), SNAPSHOT_BUDGET_MS.post);
    const b = host.capture(cap("s2"), SNAPSHOT_BUDGET_MS.pre);
    vi.advanceTimersByTime(SNAPSHOT_BUDGET_MS.pre);
    await expect(b).rejects.toBeInstanceOf(SnapshotTimeout);
    workers[0].reply({ seq: 4 });
    await expect(a).resolves.toEqual({ seq: 4 });
    expect(workers[0].posted.map((p) => p.req.op)).toEqual(["capture"]);
  });

  test("a worker stuck inside one read (an iCloud download) is replaced after the grace period", async () => {
    const a = host.capture(cap(), SNAPSHOT_BUDGET_MS.pre);
    const next = host.preview("/r", "s1", ["/w"], "/w", ["call-1"]);
    vi.advanceTimersByTime(SNAPSHOT_BUDGET_MS.pre);
    await expect(a).rejects.toBeInstanceOf(SnapshotTimeout);
    vi.advanceTimersByTime(STOP_GRACE_MS);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted.map((p) => p.req.op)).toEqual(["preview"]);
    // The dropped worker's late word changes nothing.
    workers[0].reply({ seq: 9 }, 0);
    workers[1].reply(null);
    await expect(next).resolves.toBeNull();
    expect(workers[1].posted.map((p) => p.req.op)).toEqual(["preview"]);
  });

  test("a capture that finishes after its caller gave up is discarded before anything else runs", async () => {
    const a = host.capture(cap(), SNAPSHOT_BUDGET_MS.pre);
    const stamp = host.stamp("/r", "s1", "call-1");
    vi.advanceTimersByTime(SNAPSHOT_BUDGET_MS.pre);
    await expect(a).rejects.toBeInstanceOf(SnapshotTimeout);
    workers[0].reply({ seq: 3 }); // it finished anyway, just before seeing the flag
    expect(workers[0].posted.map((p) => p.req)).toMatchObject([
      { op: "capture" },
      { op: "discard", sessionId: "s1", seq: 3 },
    ]);
    workers[0].reply(null);
    expect(workers[0].posted.map((p) => p.req.op)).toEqual(["capture", "discard", "stamp"]);
    workers[0].reply(null);
    await expect(stamp).resolves.toBeNull();
  });

  test("a message's capture supersedes the same session's after-turn capture, queued or running", async () => {
    const post = (sessionId: string) => ({ ...cap(sessionId), kind: "post" as const });
    const running = host.capture(post("s1"), SNAPSHOT_BUDGET_MS.post);
    const queuedOther = host.capture(post("s2"), SNAPSHOT_BUDGET_MS.post);
    const queuedSame = host.capture(post("s1"), SNAPSHOT_BUDGET_MS.post);
    const pre = host.capture(cap("s1"), SNAPSHOT_BUDGET_MS.pre);
    // Both of s1's post captures answer "nothing recorded" at once; s2's is untouched.
    await expect(running).resolves.toBeNull();
    await expect(queuedSame).resolves.toBeNull();
    expect(Atomics.load(workers[0].stop, 0)).toBe(1);
    workers[0].aborted();
    expect(workers[0].posted.map((p) => [p.req.op, (p.req as { sessionId: string }).sessionId])).toEqual([
      ["capture", "s1"], ["capture", "s2"],
    ]);
    workers[0].reply({ seq: 1 });
    await expect(queuedOther).resolves.toEqual({ seq: 1 });
    workers[0].reply({ seq: 2 });
    await expect(pre).resolves.toEqual({ seq: 2 });
  });

  test("a worker that dies fails its operation, and the next one starts a new worker", async () => {
    const a = host.capture(cap(), SNAPSHOT_BUDGET_MS.pre);
    const b = host.stamp("/r", "s1", "call-1");
    workers[0].emit("exit", 1);
    await expect(a).rejects.toThrow(/stopped/);
    expect(workers).toHaveLength(2);
    workers[1].reply(null);
    await expect(b).resolves.toBeNull();
  });
});

describe("main never walks a workspace itself", () => {
  const src = (p: string): string => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");

  test("ipc.ts reaches snapshots only through the host", () => {
    const ipc = src("src/main/ipc.ts");
    expect(ipc).not.toMatch(/from "\.\/snapshots"/);
    expect(ipc).toContain('from "./snapshotHost"');
    const code = ipc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\b(captureSnapshot|stampSnapshot|discardSnapshot|previewRestore|restoreSnapshot|deleteSessionSnapshots|listSnapshots)\(/);
  });

  test("a message waits for its capture within the budget, and a message sent meanwhile waits behind it", () => {
    const ipc = src("src/main/ipc.ts");
    expect(ipc).toMatch(/snapshotHost\.capture\(\s*\{[^}]*kind: "pre"[^}]*\},\s*SNAPSHOT_BUDGET_MS\.pre/);
    expect(ipc).toContain("pendingPre.set(sessionId, capture)");
    expect(ipc).toMatch(/\} else if \(ahead\) \{\s*await ahead;/);
  });

  test("the worker and what it runs never import electron", () => {
    for (const f of ["src/main/snapshotWorker.ts", "src/main/snapshotOps.ts", "src/main/snapshots.ts"]) {
      expect(src(f), f).not.toMatch(/from "electron"/);
    }
  });

  test("electron-vite emits the worker beside the main bundle", () => {
    expect(src("electron.vite.config.ts")).toMatch(/'snapshot-worker': resolve\(__dirname, 'src\/main\/snapshotWorker\.ts'\)/);
    expect(src("src/main/snapshotHost.ts")).toContain('path.join(__dirname, "snapshot-worker.js")');
  });
});

describe("the BUILT worker, in a real thread", () => {
  const built = path.join(import.meta.dirname, "..", "out", "main", "snapshot-worker.js");

  // Meaningful only after `npm run build`; `npm run gate` builds first.
  test.skipIf(!fs.existsSync(built))("captures and restores a workspace without the main thread touching it", async () => {
    const host = new SnapshotHost((stop) => new Worker(built, { workerData: { stop } }));
    fs.writeFileSync(path.join(ws, "a.txt"), "before");
    const pre = await host.capture({ root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "pre", now: NOW }, SNAPSHOT_BUDGET_MS.pre);
    expect(pre).toEqual({ seq: 1 });
    await host.stamp(root, "s1", "call-1");
    fs.writeFileSync(path.join(ws, "a.txt"), "after");
    await host.capture({ root, sessionId: "s1", roots: [ws], workspaceId: ws, kind: "post", now: NOW }, SNAPSHOT_BUDGET_MS.post);
    const done = await host.restore(root, "s1", [ws], ws, ["call-1"], NOW);
    expect(done?.result.restored).toEqual(["a.txt"]);
    expect(fs.readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("before");
    await host.deleteSession(root, "s1");
    expect(fs.existsSync(path.join(root, "s1"))).toBe(false);
  });
});
