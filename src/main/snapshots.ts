/**
 * §9 rewind file rollback — a content-addressed snapshot store.
 *
 * One whole-workspace manifest per user prompt and per turn completion. No git
 * binary (PRD §3 standalone promise; same call as skills/gitImport.ts).
 *
 * Two invariants the tests pin:
 *  - an excluded path is outside the manifest AND outside restore, so restore
 *    can never delete a build directory;
 *  - symlinks are skipped, never followed — reading through one would escape
 *    workspace confinement.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES, isVisibleEntry, resolveInWorkspace } from "./files";

/**
 * Build outputs, on top of the ignore list the file tree and watcher share
 * (files.ts IGNORED_DIRS + dotfile rules, via isVisibleEntry). Deliberately a
 * SEPARATE set: widening the shared one would change what the tree shows.
 */
export const SNAPSHOT_EXCLUDE = new Set([
  "dist", "build", "out", ".next", ".nuxt", "target",
  "venv", ".venv", "__pycache__", "coverage", ".turbo", ".cache",
]);

export interface Manifest {
  /** workspace-relative path → sha256 hex of contents */
  files: Record<string, string>;
  /** paths over MAX_FILE_BYTES — recorded, never silently dropped */
  tooLarge: string[];
}

export interface ManifestDiff { changed: string[]; added: string[]; removed: string[] }

/** mtime+size → hash, so an unchanged file is stat'd but not re-read. */
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

function hashFile(abs: string, st: fs.Stats): string {
  const hit = hashCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  hashCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

export function buildManifest(registeredWorkspaces: string[], workspaceId: string): Manifest {
  const root = resolveInWorkspace(registeredWorkspaces, workspaceId, "");
  const files: Record<string, string> = {};
  const tooLarge: string[] = [];

  const walk = (abs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!isVisibleEntry(e.name)) continue;
      if (e.isDirectory() && SNAPSHOT_EXCLUDE.has(e.name)) continue;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        walk(childAbs);
        continue;
      }
      // isFile() alone: a symlink reports false here, so links are skipped.
      if (!e.isFile()) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(childAbs);
      } catch {
        continue;
      }
      const rel = path.relative(root, childAbs);
      if (st.size > MAX_FILE_BYTES) {
        tooLarge.push(rel);
        continue;
      }
      try {
        files[rel] = hashFile(childAbs, st);
      } catch {
        /* unreadable mid-walk — treat as absent */
      }
    }
  };
  walk(root);
  tooLarge.sort();
  return { files, tooLarge };
}

export function diffManifests(from: Manifest, to: Manifest): ManifestDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [p, h] of Object.entries(to.files)) {
    const before = from.files[p];
    if (before === undefined) added.push(p);
    else if (before !== h) changed.push(p);
  }
  for (const p of Object.keys(from.files)) if (to.files[p] === undefined) removed.push(p);
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

function sameManifest(a: Manifest, b: Manifest): boolean {
  const d = diffManifests(a, b);
  return d.changed.length === 0 && d.added.length === 0 && d.removed.length === 0;
}

export type SnapshotKind = "pre" | "post";

export interface SnapshotRecord {
  /** 1-based, monotonic within a session. */
  seq: number;
  /** "pre" snapshots are restore targets; "post" is the freshness reference. */
  kind: SnapshotKind;
  /** First toolCallId of the turn that followed a "pre" snapshot. */
  toolCallId: string | null;
  createdAt: string;
  /** Set for Plan Mode Implement baselines ("implement") and restore guards ("safety"). */
  label?: string;
  manifest: Manifest;
}

const sessionDirFor = (root: string, sessionId: string): string => path.join(root, sessionId);
const recordsFile = (root: string, sessionId: string): string =>
  path.join(sessionDirFor(root, sessionId), "snapshots.jsonl");
const blobPath = (root: string, sessionId: string, hash: string): string =>
  path.join(sessionDirFor(root, sessionId), "blobs", hash);

/** Torn last line is skipped, never thrown — same contract as log.ts / calls.ts. */
export function listSnapshots(root: string, sessionId: string): SnapshotRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(recordsFile(root, sessionId), "utf8");
  } catch {
    return [];
  }
  const out: SnapshotRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SnapshotRecord);
    } catch {
      /* torn write — skip */
    }
  }
  return out;
}

function writeRecords(root: string, sessionId: string, records: SnapshotRecord[]): void {
  fs.mkdirSync(sessionDirFor(root, sessionId), { recursive: true });
  fs.writeFileSync(
    recordsFile(root, sessionId),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

export function captureSnapshot(
  root: string,
  sessionId: string,
  registeredWorkspaces: string[],
  workspaceId: string,
  kind: SnapshotKind,
  now: string,
  label?: string,
): SnapshotRecord | null {
  const manifest = buildManifest(registeredWorkspaces, workspaceId);
  const records = listSnapshots(root, sessionId);
  const newest = records[records.length - 1];

  // Nothing changed since the last record — a read-only turn costs no storage.
  // A labelled record is always kept: it has to stay addressable.
  if (label === undefined && newest && sameManifest(newest.manifest, manifest)) return null;

  const wsRoot = resolveInWorkspace(registeredWorkspaces, workspaceId, "");
  fs.mkdirSync(path.join(sessionDirFor(root, sessionId), "blobs"), { recursive: true });
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const dest = blobPath(root, sessionId, hash);
    if (fs.existsSync(dest)) continue; // content-addressed: identical content, one blob
    try {
      fs.copyFileSync(path.join(wsRoot, rel), dest);
    } catch {
      delete manifest.files[rel]; // vanished mid-capture — never record what we cannot restore
    }
  }

  const rec: SnapshotRecord = {
    seq: (newest?.seq ?? 0) + 1,
    kind,
    toolCallId: null,
    createdAt: now,
    ...(label === undefined ? {} : { label }),
    manifest,
  };
  fs.appendFileSync(recordsFile(root, sessionId), JSON.stringify(rec) + "\n");
  return rec;
}

/**
 * Stamp the newest unstamped "pre" snapshot with the turn's FIRST toolCallId.
 * Later calls in the same turn are no-ops, which is what makes the stamp mean
 * "the state before the turn containing this call".
 */
export function stampSnapshot(root: string, sessionId: string, toolCallId: string): void {
  const records = listSnapshots(root, sessionId);
  const newest = records[records.length - 1];
  if (!newest || newest.kind !== "pre" || newest.toolCallId !== null) return;
  newest.toolCallId = toolCallId;
  writeRecords(root, sessionId, records);
}

export interface RestorePreview { willRestore: string[]; willDelete: string[]; stale: string[] }

export interface RestoreResult {
  restored: string[];
  deleted: string[];
  /** Changed since the agent last touched them — skipped, never overwritten. */
  stale: string[];
  /** Over MAX_FILE_BYTES at capture time, so outside the snapshot. */
  notCaptured: string[];
}

/**
 * The earliest snapshot stamped by any of the rewound tool calls. Correct by
 * construction: a file can only change via a tool call, so a turn with no tool
 * calls has nothing to restore and the next stamped snapshot still describes
 * the state at the anchor.
 */
export function findRestoreTarget(
  root: string,
  sessionId: string,
  toolCallIds: string[],
): SnapshotRecord | null {
  const wanted = new Set(toolCallIds);
  const hits = listSnapshots(root, sessionId).filter(
    (r) => r.kind === "pre" && r.toolCallId !== null && wanted.has(r.toolCallId),
  );
  return hits.length ? hits.reduce((a, b) => (a.seq <= b.seq ? a : b)) : null;
}

/** What the agent last left behind — the reference the stale-check compares to. */
function freshnessManifest(root: string, sessionId: string): Manifest {
  const records = listSnapshots(root, sessionId);
  return records.length ? records[records.length - 1].manifest : { files: {}, tooLarge: [] };
}

function plan(
  root: string,
  sessionId: string,
  registeredWorkspaces: string[],
  workspaceId: string,
  target: SnapshotRecord,
): { restore: string[]; remove: string[]; stale: string[] } {
  const current = buildManifest(registeredWorkspaces, workspaceId);
  const expected = freshnessManifest(root, sessionId);
  const restore: string[] = [];
  const remove: string[] = [];
  const stale: string[] = [];

  // Stale = on disk now, known to the freshness reference, and different from
  // it: something other than the rewound turns changed it.
  const isStale = (p: string): boolean =>
    expected.files[p] !== undefined && current.files[p] !== undefined
      ? expected.files[p] !== current.files[p]
      : false;

  for (const [p, hash] of Object.entries(target.manifest.files)) {
    if (current.files[p] === hash) continue; // already at the target state
    if (isStale(p)) { stale.push(p); continue; }
    restore.push(p);
  }
  for (const p of Object.keys(current.files)) {
    if (target.manifest.files[p] !== undefined) continue; // still expected to exist
    if (isStale(p)) { stale.push(p); continue; }
    remove.push(p);
  }
  return { restore: restore.sort(), remove: remove.sort(), stale: stale.sort() };
}

export function previewRestore(
  root: string,
  sessionId: string,
  registeredWorkspaces: string[],
  workspaceId: string,
  target: SnapshotRecord,
): RestorePreview {
  const p = plan(root, sessionId, registeredWorkspaces, workspaceId, target);
  return { willRestore: p.restore, willDelete: p.remove, stale: p.stale };
}

export function restoreSnapshot(
  root: string,
  sessionId: string,
  registeredWorkspaces: string[],
  workspaceId: string,
  target: SnapshotRecord,
  now: string,
): RestoreResult {
  // Internal guard: a botched restore must itself be recoverable. Planned
  // BEFORE this capture, so the safety record can't become its own reference.
  const { restore, remove, stale } = plan(root, sessionId, registeredWorkspaces, workspaceId, target);
  captureSnapshot(root, sessionId, registeredWorkspaces, workspaceId, "post", now, "safety");

  const restored: string[] = [];
  const deleted: string[] = [];

  for (const rel of restore) {
    // resolveInWorkspace on every write — the confinement invariant, not a
    // formality: rel comes from a manifest read off disk.
    const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, rel);
    const blob = blobPath(root, sessionId, target.manifest.files[rel]);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(blob, abs);
      restored.push(rel);
    } catch {
      stale.push(rel); // blob missing or unwritable — report, never pretend
    }
  }
  for (const rel of remove) {
    const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, rel);
    try {
      fs.rmSync(abs);
      deleted.push(rel);
    } catch {
      stale.push(rel);
    }
  }
  return { restored, deleted, stale: stale.sort(), notCaptured: target.manifest.tooLarge };
}
