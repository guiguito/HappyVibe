/**
 * §9 rewind: main's handle on the snapshot worker. Every snapshot operation goes
 * through here; main never walks or copies workspace files itself.
 *
 * Why: a capture is a synchronous walk of the whole workspace that reads every
 * changed file. On the main thread it froze the app (windows, every session)
 * for as long as it took. Measured 2026-10-28: a home folder used as a workspace
 * is ~420k files, and each iCloud file that is not on the Mac is downloaded by
 * the read. Three freezes of 23 s to 328 s, each ended by a force quit.
 *
 * - ONE worker thread, ONE operation at a time, in the order asked: a stamp
 *   lands after the capture it stamps, a restore after the capture it reads.
 * - Every operation has a time budget (SNAPSHOT_BUDGET_MS). Past it the caller
 *   gets SnapshotTimeout and the worker is asked to stop (a flag in shared
 *   memory the walk reads between entries; a stopped capture writes nothing).
 *   An operation still queued is simply dropped.
 * - A worker blocked inside a single read cannot see the flag, so it is
 *   dropped after STOP_GRACE_MS and the next operation starts a fresh one.
 * - A capture that finishes after its caller gave up is discarded before
 *   anything else runs: its turn may already be writing files, and a record
 *   taken then would be a torn restore point.
 * - A "pre" capture supersedes the same session's after-turn ("post") capture
 *   still queued or running: no turn runs between the two, so the pre records
 *   the same state, later, and serves as the stale-check's reference just as
 *   well. Otherwise a message would spend its budget waiting behind it.
 */
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SnapshotOp, SnapshotOpResults } from "./snapshotOps";
import type { SnapshotKind } from "./snapshots";

export const SNAPSHOT_BUDGET_MS = {
  /** The capture a message waits for before it reaches Pi. Past this, the
   *  message goes without one, and its rewind offers the conversation only —
   *  the rule §9 round 12 already sets for a capture that failed. */
  pre: 5_000,
  /** The after-turn record (the stale-check's reference): nobody waits on it. */
  post: 60_000,
  /** Writing files back: a restore stopped halfway is worse than a slow one. */
  restore: 600_000,
  other: 120_000,
} as const;

export const STOP_GRACE_MS = 2_000;

export class SnapshotTimeout extends Error {
  constructor(readonly budgetMs: number) {
    super(`The file snapshot took longer than ${Math.round(budgetMs / 1000)} s and was stopped.`);
    this.name = "SnapshotTimeout";
  }
}

/** What the host needs of a worker: a node Worker, or a fake in the tests. */
export interface SnapshotWorkerLike {
  postMessage(m: unknown): void;
  // oxlint-disable-next-line typescript/no-explicit-any -- node's Worker.on signature
  on(event: string | symbol, listener: (...args: any[]) => void): unknown;
  terminate(): unknown;
}

type Reply = { id: number; value?: unknown; error?: string };

interface Job {
  req: SnapshotOp;
  budgetMs: number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** A result that arrived after the caller was told it timed out. */
  onLate?: (v: unknown) => void;
}

interface Running {
  id: number;
  job: Job;
  worker: SnapshotWorkerLike;
  grace?: ReturnType<typeof setTimeout>;
}

function spawnWorker(stop: SharedArrayBuffer): SnapshotWorkerLike {
  // electron-vite emits this beside the main bundle (a second rollup input).
  return new Worker(path.join(__dirname, "snapshot-worker.js"), { workerData: { stop } });
}

export class SnapshotHost {
  private worker: SnapshotWorkerLike | null = null;
  private readonly stopBuf = new SharedArrayBuffer(4);
  private readonly stop = new Int32Array(this.stopBuf);
  private queue: Job[] = [];
  private current: Running | null = null;
  private nextId = 1;

  constructor(private readonly spawn: (stop: SharedArrayBuffer) => SnapshotWorkerLike = spawnWorker) {}

  capture(
    a: { root: string; sessionId: string; roots: string[]; workspaceId: string; kind: SnapshotKind; now: string; label?: string },
    budgetMs: number,
  ): Promise<SnapshotOpResults["capture"]> {
    if (a.kind === "pre") this.supersedePost(a.sessionId);
    return this.run({ op: "capture", ...a }, budgetMs, (late) => {
      const seq = (late as SnapshotOpResults["capture"])?.seq;
      if (typeof seq === "number") {
        this.queue.unshift(this.job({ op: "discard", root: a.root, sessionId: a.sessionId, seq }, SNAPSHOT_BUDGET_MS.other));
      }
    }) as Promise<SnapshotOpResults["capture"]>;
  }

  stamp(root: string, sessionId: string, toolCallId: string): Promise<null> {
    return this.run({ op: "stamp", root, sessionId, toolCallId }, SNAPSHOT_BUDGET_MS.other) as Promise<null>;
  }

  discard(root: string, sessionId: string, seq: number): Promise<null> {
    return this.run({ op: "discard", root, sessionId, seq }, SNAPSHOT_BUDGET_MS.other) as Promise<null>;
  }

  preview(root: string, sessionId: string, roots: string[], workspaceId: string, toolCallIds: string[]): Promise<SnapshotOpResults["preview"]> {
    return this.run({ op: "preview", root, sessionId, roots, workspaceId, toolCallIds }, SNAPSHOT_BUDGET_MS.other) as Promise<SnapshotOpResults["preview"]>;
  }

  restore(root: string, sessionId: string, roots: string[], workspaceId: string, toolCallIds: string[], now: string): Promise<SnapshotOpResults["restore"]> {
    return this.run({ op: "restore", root, sessionId, roots, workspaceId, toolCallIds, now }, SNAPSHOT_BUDGET_MS.restore) as Promise<SnapshotOpResults["restore"]>;
  }

  revertImplement(root: string, sessionId: string, roots: string[], workspaceId: string, now: string): Promise<SnapshotOpResults["revertImplement"]> {
    return this.run({ op: "revertImplement", root, sessionId, roots, workspaceId, now }, SNAPSHOT_BUDGET_MS.restore) as Promise<SnapshotOpResults["revertImplement"]>;
  }

  deleteSession(root: string, sessionId: string): Promise<null> {
    return this.run({ op: "deleteSession", root, sessionId }, SNAPSHOT_BUDGET_MS.other) as Promise<null>;
  }

  private supersedePost(sessionId: string): void {
    const isPost = (j: Job): boolean =>
      j.req.op === "capture" && j.req.kind === "post" && j.req.label === undefined && j.req.sessionId === sessionId;
    for (const j of this.queue.filter(isPost)) {
      this.queue = this.queue.filter((q) => q !== j);
      this.settle(j, () => j.resolve(null));
    }
    const cur = this.current;
    if (cur && isPost(cur.job)) {
      // Stopped like an expired one, but its caller hears "nothing recorded".
      Atomics.store(this.stop, 0, 1);
      this.settle(cur.job, () => cur.job.resolve(null));
      cur.grace = setTimeout(() => {
        if (this.current === cur) this.drop(cur.worker);
      }, STOP_GRACE_MS);
    }
  }

  private job(req: SnapshotOp, budgetMs: number, onLate?: (v: unknown) => void): Job {
    const job: Job = { req, budgetMs, resolve: () => {}, reject: () => {}, settled: false, onLate };
    job.timer = setTimeout(() => this.expire(job), budgetMs);
    return job;
  }

  private run(req: SnapshotOp, budgetMs: number, onLate?: (v: unknown) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const job = this.job(req, budgetMs, onLate);
      job.resolve = resolve;
      job.reject = reject;
      this.queue.push(job);
      this.pump();
    });
  }

  /** True when this call settled the job; false when it already was. */
  private settle(job: Job, outcome: () => void): boolean {
    if (job.settled) return false;
    job.settled = true;
    clearTimeout(job.timer);
    outcome();
    return true;
  }

  private expire(job: Job): void {
    const err = new SnapshotTimeout(job.budgetMs);
    const cur = this.current;
    if (cur?.job === job) {
      Atomics.store(this.stop, 0, 1);
      this.settle(job, () => job.reject(err));
      cur.grace = setTimeout(() => {
        if (this.current === cur) this.drop(cur.worker);
      }, STOP_GRACE_MS);
      return;
    }
    this.queue = this.queue.filter((j) => j !== job);
    this.settle(job, () => job.reject(err));
  }

  private pump(): void {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    const worker = this.ensureWorker();
    Atomics.store(this.stop, 0, 0);
    const id = this.nextId++;
    this.current = { id, job, worker };
    worker.postMessage({ id, req: job.req });
  }

  private ensureWorker(): SnapshotWorkerLike {
    if (this.worker) return this.worker;
    const w = this.spawn(this.stopBuf);
    w.on("message", (m: Reply) => this.onReply(w, m));
    w.on("error", (e: Error) => this.onGone(w, e));
    w.on("exit", () => this.onGone(w, new Error("The snapshot worker stopped.")));
    this.worker = w;
    return w;
  }

  private finish(): void {
    if (this.current?.grace) clearTimeout(this.current.grace);
    this.current = null;
    this.pump();
  }

  private onReply(w: SnapshotWorkerLike, m: Reply): void {
    const cur = this.current;
    if (!cur || cur.worker !== w || m.id !== cur.id) return; // a dropped worker's late word
    const job = cur.job;
    if (m.error === undefined) {
      if (!this.settle(job, () => job.resolve(m.value))) job.onLate?.(m.value);
    } else {
      this.settle(job, () => job.reject(new Error(m.error)));
    }
    this.finish();
  }

  private onGone(w: SnapshotWorkerLike, err: Error): void {
    if (this.worker === w) this.worker = null;
    const cur = this.current;
    if (cur && cur.worker === w) {
      this.settle(cur.job, () => cur.job.reject(err));
      this.finish();
    }
  }

  /** Stuck inside one read: leave it to finish on its own and start afresh. */
  private drop(w: SnapshotWorkerLike): void {
    void w.terminate();
    this.onGone(w, new Error("The snapshot worker was stuck and was replaced."));
  }
}

export const snapshotHost = new SnapshotHost();
