/**
 * §9 rewind. Runs INSIDE a worker thread (node:worker_threads), started by
 * snapshotHost.ts — emitted beside the main bundle as out/main/snapshot-worker.js.
 *
 * A thread, not a utilityProcess: the host stops a capture through a flag in
 * shared memory, which the synchronous walk reads between entries without ever
 * yielding — a separate process could not share it.
 *
 * Protocol:
 *   host -> here   { id, req: SnapshotOp }
 *   here -> host   { id, value } | { id, error, aborted }
 */
import { parentPort, workerData } from "node:worker_threads";
import { runSnapshotOp, type SnapshotOp } from "./snapshotOps";
import { SnapshotAborted } from "./snapshots";

const stop = new Int32Array((workerData as { stop: SharedArrayBuffer }).stop);
const shouldStop = (): boolean => Atomics.load(stop, 0) === 1;

parentPort?.on("message", (m: { id: number; req: SnapshotOp }) => {
  try {
    parentPort?.postMessage({ id: m.id, value: runSnapshotOp(m.req, shouldStop) });
  } catch (e) {
    parentPort?.postMessage({
      id: m.id,
      error: e instanceof Error ? e.message : String(e),
      aborted: e instanceof SnapshotAborted,
    });
  }
});
