import {
  captureSnapshot, deleteSessionSnapshots, discardSnapshot, findRestoreTarget, listSnapshots,
  previewRestore, restoreSnapshot, stampSnapshot,
  type RestorePreview, type RestoreResult, type SnapshotKind,
} from "./snapshots";

/**
 * §9 rewind: every snapshot operation main used to call inline, as one message.
 * The snapshot worker (snapshotWorker.ts) runs them, one at a time, in order;
 * snapshotHost.ts queues them. Pure and electron-free, so the tests call
 * runSnapshotOp directly.
 *
 * Replies are kept small on purpose: a manifest lists every file of the
 * workspace, so a capture answers with its seq, never its record.
 */
export type SnapshotOp =
  | {
      op: "capture"; root: string; sessionId: string; roots: string[]; workspaceId: string;
      kind: SnapshotKind; now: string; label?: string;
    }
  | { op: "stamp"; root: string; sessionId: string; toolCallId: string }
  | { op: "discard"; root: string; sessionId: string; seq: number }
  | { op: "preview"; root: string; sessionId: string; roots: string[]; workspaceId: string; toolCallIds: string[] }
  | { op: "restore"; root: string; sessionId: string; roots: string[]; workspaceId: string; toolCallIds: string[]; now: string }
  | { op: "revertImplement"; root: string; sessionId: string; roots: string[]; workspaceId: string; now: string }
  | { op: "deleteSession"; root: string; sessionId: string };

export interface SnapshotOpResults {
  capture: { seq: number } | null;
  stamp: null;
  discard: null;
  preview: RestorePreview | null;
  /** `seq` is the record restored to — the rewind's audit row names it. */
  restore: { seq: number; result: RestoreResult } | null;
  revertImplement: RestoreResult | null;
  deleteSession: null;
}

export function runSnapshotOp(req: SnapshotOp, shouldStop: () => boolean): SnapshotOpResults[SnapshotOp["op"]] {
  switch (req.op) {
    case "capture": {
      const rec = captureSnapshot(
        req.root, req.sessionId, req.roots, req.workspaceId, req.kind, req.now, req.label, shouldStop,
      );
      return rec ? { seq: rec.seq } : null;
    }
    case "stamp":
      stampSnapshot(req.root, req.sessionId, req.toolCallId);
      return null;
    case "discard":
      discardSnapshot(req.root, req.sessionId, req.seq);
      return null;
    case "preview": {
      const target = findRestoreTarget(req.root, req.sessionId, req.toolCallIds);
      return target ? previewRestore(req.root, req.sessionId, req.roots, req.workspaceId, target, shouldStop) : null;
    }
    case "restore": {
      const target = findRestoreTarget(req.root, req.sessionId, req.toolCallIds);
      if (!target) return null;
      const result = restoreSnapshot(req.root, req.sessionId, req.roots, req.workspaceId, target, req.now, shouldStop);
      return { seq: target.seq, result };
    }
    case "revertImplement": {
      const target = listSnapshots(req.root, req.sessionId).filter((r) => r.label === "implement").pop();
      return target
        ? restoreSnapshot(req.root, req.sessionId, req.roots, req.workspaceId, target, req.now, shouldStop)
        : null;
    }
    case "deleteSession":
      deleteSessionSnapshots(req.root, req.sessionId);
      return null;
  }
}
