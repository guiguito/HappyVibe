# Rewind with File Rollback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rewinding a message choose to roll back the workspace files as well as the conversation, with every file stale-checked before it is touched.

**Architecture:** A content-addressed snapshot store in the main process captures one whole-workspace manifest per user prompt and per turn completion, keyed by the turn's first `toolCallId`. Restore diffs the target manifest against disk, skipping any file changed since the agent last touched it. Nothing in `pi-runtime/` changes — main already sees both the single user-prompt entry point and the Pi event stream.

**Tech Stack:** TypeScript, Electron main + React renderer, `node:crypto` sha256, JSONL storage (no SQLite), vitest.

## Global Constraints

- **No git binary.** The store is pure filesystem + sha256. Consistent with `src/main/skills/gitImport.ts:7-13` ("NO git binary (PRD decision)") and `docs/prd.md:53` (standalone promise).
- **No bridge changes.** Do not touch `pi-runtime/extensions/` or `src/main/pi/`. If a task seems to need them, stop and report — it invalidates the design and the test gate.
- **Path confinement.** Every filesystem access goes through `resolveInWorkspace` (`src/main/files.ts:33`). Throw, never clamp.
- **Symlinks are skipped, never followed** — reading through one escapes confinement.
- **Excluded paths are outside the manifest AND outside restore** — restore must never delete a build directory.
- **Restore is human-only.** No tool, no bridge command, no model-reachable path. Audited with `who: "human"` (mirrors `src/main/ipc.ts:1039`).
- **`now` is a parameter, never `Date.now()` inside the module** — mirrors `src/main/plans.ts` for testability.
- Storage root is a parameter (`root: string`), not read from `config.ts` inside the engine.
- House style: JSONL over SQLite; torn last lines are skipped, never thrown (`src/main/log.ts:43`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/main/snapshots.ts` *(create)* | The whole engine: manifest build, blob store, diff, stale-check, restore, retention. Pure helpers exported for unit tests. |
| `tests/snapshots.test.ts` *(create)* | Unit coverage for the engine. |
| `src/main/config.ts` *(modify)* | Add `snapshotDir()` beside `sessionDir()`. |
| `src/main/ipc.ts` *(modify)* | Capture hooks, `toolCallId` stamping, restore IPC, delete-with-session, Plan Mode Implement baseline. |
| `src/preload/index.ts` *(modify)* | `rewindPreview` / `rewindRestore` IPC surface. |
| `src/renderer/src/hv.d.ts` *(modify)* | Types for the two new calls. |
| `src/renderer/src/components/ChatView.tsx` *(modify)* | Three-scope confirm dialog with the affected-file list. |
| `src/renderer/src/App.tsx` *(modify)* | `rewindTo` takes a scope; calls restore for the file scopes. |
| `src/renderer/src/components/PlanCard.tsx` *(modify)* | "Revert implementation" action. |
| `tests/rewind-scope.test.ts` *(create)* | Renderer-side scope logic. |

---

## Task 1: Snapshot engine — manifest build and diff

**Files:**
- Create: `src/main/snapshots.ts`
- Test: `tests/snapshots.test.ts`

**Interfaces:**
- Consumes: `resolveInWorkspace`, `isVisibleEntry`, `MAX_FILE_BYTES` from `src/main/files.ts` (all already exported).
- Produces:
  ```ts
  export interface Manifest { files: Record<string, string>; tooLarge: string[] }
  export interface ManifestDiff { changed: string[]; added: string[]; removed: string[] }
  export const SNAPSHOT_EXCLUDE: Set<string>
  export function buildManifest(registeredWorkspaces: string[], workspaceId: string): Manifest
  export function diffManifests(from: Manifest, to: Manifest): ManifestDiff
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/snapshots.test.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, diffManifests, SNAPSHOT_EXCLUDE } from "../src/main/snapshots";

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snap-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("buildManifest", () => {
  test("hashes visible files and records workspace-relative paths", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    fs.mkdirSync(path.join(ws, "src"));
    fs.writeFileSync(path.join(ws, "src", "b.ts"), "export const b = 1;");

    const m = buildManifest([ws], ws);

    expect(Object.keys(m.files).sort()).toEqual(["a.txt", path.join("src", "b.ts")]);
    // sha256("hello")
    expect(m.files["a.txt"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(m.tooLarge).toEqual([]);
  });

  test("skips the shared ignore list and the snapshot-local build-output list", () => {
    for (const d of ["node_modules", ".git", "dist", "__pycache__"]) {
      fs.mkdirSync(path.join(ws, d));
      fs.writeFileSync(path.join(ws, d, "junk.txt"), "junk");
    }
    fs.writeFileSync(path.join(ws, "keep.txt"), "keep");

    const m = buildManifest([ws], ws);

    expect(Object.keys(m.files)).toEqual(["keep.txt"]);
    expect(SNAPSHOT_EXCLUDE.has("dist")).toBe(true);
  });

  test("skips symlinks rather than following them out of the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hv-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));

    const m = buildManifest([ws], ws);

    expect(m.files).toEqual({});
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test("records an oversized file as not-captured instead of dropping it silently", () => {
    fs.writeFileSync(path.join(ws, "big.bin"), Buffer.alloc(1_000_001, 1));

    const m = buildManifest([ws], ws);

    expect(m.files["big.bin"]).toBeUndefined();
    expect(m.tooLarge).toEqual(["big.bin"]);
  });

  test("rejects an unregistered workspace", () => {
    expect(() => buildManifest([], ws)).toThrow("Unknown workspace");
  });
});

describe("diffManifests", () => {
  test("classifies added, removed and changed paths", () => {
    const from: Manifest = { files: { keep: "h1", gone: "h2", edit: "h3" }, tooLarge: [] };
    const to: Manifest = { files: { keep: "h1", edit: "h9", fresh: "h4" }, tooLarge: [] };

    expect(diffManifests(from, to)).toEqual({
      changed: ["edit"],
      added: ["fresh"],
      removed: ["gone"],
    });
  });

  test("an identical manifest diffs to nothing", () => {
    const m: Manifest = { files: { a: "h" }, tooLarge: [] };
    expect(diffManifests(m, m)).toEqual({ changed: [], added: [], removed: [] });
  });
});
```

Add the missing `Manifest` type import at the top of the test file:
`import type { Manifest } from "../src/main/snapshots";`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/snapshots"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/snapshots.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/snapshots.ts tests/snapshots.test.ts
git commit -m "feat(rewind): content-addressed workspace manifest builder"
```

---

## Task 2: Snapshot store — capture, stamp, list

**Files:**
- Modify: `src/main/snapshots.ts`
- Modify: `tests/snapshots.test.ts`

**Interfaces:**
- Consumes: `buildManifest`, `diffManifests` from Task 1.
- Produces:
  ```ts
  export type SnapshotKind = "pre" | "post";
  export interface SnapshotRecord {
    seq: number;                 // 1-based, monotonic per session
    kind: SnapshotKind;          // "pre" = a restore target; "post" = the freshness reference
    toolCallId: string | null;   // first toolCallId of the turn that followed a "pre"
    createdAt: string;
    label?: string;              // Plan Mode Implement baselines
    manifest: Manifest;
  }
  export function captureSnapshot(root, sessionId, registeredWorkspaces, workspaceId, kind, now, label?): SnapshotRecord | null
  export function stampSnapshot(root: string, sessionId: string, toolCallId: string): void
  export function listSnapshots(root: string, sessionId: string): SnapshotRecord[]
  ```
  `root` is the snapshot storage root (`<userData>/snapshots`). `captureSnapshot` returns `null` when the manifest is identical to the newest record (nothing changed — a read-only turn).

Storage layout, per session:

```
<root>/<sessionId>/blobs/<sha256>
<root>/<sessionId>/snapshots.jsonl     one SnapshotRecord per line, append-only
```

- [ ] **Step 1: Write the failing test**

Append to `tests/snapshots.test.ts`:

```ts
import { captureSnapshot, listSnapshots, stampSnapshot } from "../src/main/snapshots";

const NOW = "2026-07-30T12:00:00.000Z";

describe("captureSnapshot", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("writes a record and one blob per file", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");

    const rec = captureSnapshot(root, "s1", [ws], ws, "pre", NOW);

    expect(rec).not.toBeNull();
    expect(rec!.seq).toBe(1);
    expect(rec!.kind).toBe("pre");
    expect(rec!.toolCallId).toBeNull();
    const blob = path.join(root, "s1", "blobs", rec!.manifest.files["a.txt"]);
    expect(fs.readFileSync(blob, "utf8")).toBe("hello");
  });

  test("returns null when nothing changed since the newest record", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);

    expect(captureSnapshot(root, "s1", [ws], ws, "post", NOW)).toBeNull();
    expect(listSnapshots(root, "s1")).toHaveLength(1);
  });

  test("increments seq and dedupes blobs across snapshots", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    const first = captureSnapshot(root, "s1", [ws], ws, "pre", NOW)!;
    fs.writeFileSync(path.join(ws, "b.txt"), "hello"); // same content, same blob
    const second = captureSnapshot(root, "s1", [ws], ws, "post", NOW)!;

    expect(second.seq).toBe(2);
    expect(second.manifest.files["b.txt"]).toBe(first.manifest.files["a.txt"]);
    expect(fs.readdirSync(path.join(root, "s1", "blobs"))).toHaveLength(1);
  });

  test("sessions are isolated from one another", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);
    captureSnapshot(root, "s2", [ws], ws, "pre", NOW);

    expect(listSnapshots(root, "s1")).toHaveLength(1);
    expect(listSnapshots(root, "s2")).toHaveLength(1);
  });
});

describe("stampSnapshot", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("stamps the newest unstamped pre-snapshot", () => {
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);

    stampSnapshot(root, "s1", "call-1");

    expect(listSnapshots(root, "s1")[0].toolCallId).toBe("call-1");
  });

  test("is a no-op once that snapshot is already stamped", () => {
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);
    stampSnapshot(root, "s1", "call-1");

    stampSnapshot(root, "s1", "call-2"); // second tool call of the same turn

    expect(listSnapshots(root, "s1")[0].toolCallId).toBe("call-1");
  });

  test("never stamps a post snapshot", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "one");
    captureSnapshot(root, "s1", [ws], ws, "post", NOW);

    stampSnapshot(root, "s1", "call-1");

    expect(listSnapshots(root, "s1")[0].toolCallId).toBeNull();
  });
});

describe("listSnapshots", () => {
  test("returns [] for an unknown session and skips a torn last line", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
    expect(listSnapshots(root, "nope")).toEqual([]);

    fs.mkdirSync(path.join(root, "s1"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "s1", "snapshots.jsonl"),
      `{"seq":1,"kind":"pre","toolCallId":null,"createdAt":"${NOW}","manifest":{"files":{},"tooLarge":[]}}\n{"seq":2,"kind`,
    );
    expect(listSnapshots(root, "s1")).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: FAIL — `captureSnapshot is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/snapshots.ts`:

```ts
export type SnapshotKind = "pre" | "post";

export interface SnapshotRecord {
  /** 1-based, monotonic within a session. */
  seq: number;
  /** "pre" snapshots are restore targets; "post" is the freshness reference. */
  kind: SnapshotKind;
  /** First toolCallId of the turn that followed a "pre" snapshot. */
  toolCallId: string | null;
  createdAt: string;
  /** Set for Plan Mode Implement baselines. */
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
  // A labelled (Plan Mode) baseline is always kept: it has to be addressable.
  if (label === undefined && newest && sameManifest(newest.manifest, manifest)) return null;

  const wsRoot = resolveInWorkspace(registeredWorkspaces, workspaceId, "");
  fs.mkdirSync(path.join(sessionDirFor(root, sessionId), "blobs"), { recursive: true });
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const dest = blobPath(root, sessionId, hash);
    if (fs.existsSync(dest)) continue; // content-addressed: identical content, one blob
    try {
      fs.copyFileSync(path.join(wsRoot, rel), dest);
    } catch {
      delete manifest.files[rel]; // vanished mid-capture — do not record what we cannot restore
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

function sameManifest(a: Manifest, b: Manifest): boolean {
  const d = diffManifests(a, b);
  return d.changed.length === 0 && d.added.length === 0 && d.removed.length === 0;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/snapshots.ts tests/snapshots.test.ts
git commit -m "feat(rewind): per-session snapshot store with toolCallId stamping"
```

---

## Task 3: Restore with stale-check, preview, and safety snapshot

**Files:**
- Modify: `src/main/snapshots.ts`
- Modify: `tests/snapshots.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces:
  ```ts
  export interface RestorePreview { willRestore: string[]; willDelete: string[]; stale: string[] }
  export interface RestoreResult { restored: string[]; deleted: string[]; stale: string[]; notCaptured: string[] }
  export function findRestoreTarget(root: string, sessionId: string, toolCallIds: string[]): SnapshotRecord | null
  export function previewRestore(root, sessionId, registeredWorkspaces, workspaceId, target): RestorePreview
  export function restoreSnapshot(root, sessionId, registeredWorkspaces, workspaceId, target, now): RestoreResult
  ```

**Stale rule.** The newest record in the session is what the agent last left
behind. A path whose current on-disk hash differs from that record's hash was
changed by someone else — a parallel session, the user's editor, an external
tool — and is **skipped and named**, never overwritten.

- [ ] **Step 1: Write the failing test**

Append to `tests/snapshots.test.ts`:

```ts
import {
  findRestoreTarget, previewRestore, restoreSnapshot,
} from "../src/main/snapshots";

describe("restore", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Turn 1 edits a.txt and creates new.txt; snapshots bracket the turn. */
  const stageOneTurn = (): SnapshotRecord => {
    fs.writeFileSync(path.join(ws, "a.txt"), "before");
    const pre = captureSnapshot(root, "s1", [ws], ws, "pre", NOW)!;
    stampSnapshot(root, "s1", "call-1");
    fs.writeFileSync(path.join(ws, "a.txt"), "after");
    fs.writeFileSync(path.join(ws, "new.txt"), "created");
    captureSnapshot(root, "s1", [ws], ws, "post", NOW);
    return pre;
  };

  test("findRestoreTarget picks the earliest snapshot stamped by a rewound call", () => {
    stageOneTurn();
    fs.writeFileSync(path.join(ws, "a.txt"), "turn2");
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);
    stampSnapshot(root, "s1", "call-2");

    expect(findRestoreTarget(root, "s1", ["call-2", "call-1"])!.seq).toBe(1);
    expect(findRestoreTarget(root, "s1", ["call-2"])!.seq).toBe(3);
    expect(findRestoreTarget(root, "s1", ["unknown"])).toBeNull();
  });

  test("restores a modified file and deletes one the turn created", () => {
    const target = stageOneTurn();

    const res = restoreSnapshot(root, "s1", [ws], ws, target, NOW);

    expect(fs.readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("before");
    expect(fs.existsSync(path.join(ws, "new.txt"))).toBe(false);
    expect(res.restored).toEqual(["a.txt"]);
    expect(res.deleted).toEqual(["new.txt"]);
    expect(res.stale).toEqual([]);
  });

  test("skips and names a file changed since the agent touched it", () => {
    const target = stageOneTurn();
    fs.writeFileSync(path.join(ws, "a.txt"), "hand edit"); // user or parallel session

    const res = restoreSnapshot(root, "s1", [ws], ws, target, NOW);

    expect(fs.readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("hand edit");
    expect(res.restored).toEqual([]);
    expect(res.stale).toEqual(["a.txt"]);
  });

  test("never deletes an excluded path", () => {
    const target = stageOneTurn();
    fs.mkdirSync(path.join(ws, "dist"));
    fs.writeFileSync(path.join(ws, "dist", "bundle.js"), "built");

    restoreSnapshot(root, "s1", [ws], ws, target, NOW);

    expect(fs.existsSync(path.join(ws, "dist", "bundle.js"))).toBe(true);
  });

  test("takes a safety snapshot before restoring, so the restore itself is recoverable", () => {
    const target = stageOneTurn();
    const before = listSnapshots(root, "s1").length;

    restoreSnapshot(root, "s1", [ws], ws, target, NOW);

    const after = listSnapshots(root, "s1");
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].label).toBe("safety");
  });

  test("previewRestore reports the same sets without touching disk", () => {
    const target = stageOneTurn();

    const p = previewRestore(root, "s1", [ws], ws, target);

    expect(p.willRestore).toEqual(["a.txt"]);
    expect(p.willDelete).toEqual(["new.txt"]);
    expect(fs.readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("after");
  });

  test("reports oversized files as not captured", () => {
    fs.writeFileSync(path.join(ws, "big.bin"), Buffer.alloc(1_000_001, 1));
    fs.writeFileSync(path.join(ws, "a.txt"), "before");
    const pre = captureSnapshot(root, "s1", [ws], ws, "pre", NOW)!;
    stampSnapshot(root, "s1", "call-1");
    fs.writeFileSync(path.join(ws, "a.txt"), "after");
    captureSnapshot(root, "s1", [ws], ws, "post", NOW);

    expect(restoreSnapshot(root, "s1", [ws], ws, pre, NOW).notCaptured).toEqual(["big.bin"]);
  });
});
```

Add `SnapshotRecord` to the type import at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: FAIL — `findRestoreTarget is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/snapshots.ts`:

```ts
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
  // Internal guard: a botched restore must itself be recoverable.
  captureSnapshot(root, sessionId, registeredWorkspaces, workspaceId, "post", now, "safety");

  const { restore, remove, stale } = plan(root, sessionId, registeredWorkspaces, workspaceId, target);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/snapshots.ts tests/snapshots.test.ts
git commit -m "feat(rewind): stale-checked restore with safety snapshot and preview"
```

---

## Task 4: Retention — per-session cap and delete-with-session

**Files:**
- Modify: `src/main/snapshots.ts`
- Modify: `tests/snapshots.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_SNAPSHOTS_PER_SESSION = 50
  export function pruneSnapshots(root: string, sessionId: string): void
  export function deleteSessionSnapshots(root: string, sessionId: string): void
  ```
  `captureSnapshot` calls `pruneSnapshots` after appending. Pruning drops the
  oldest records and garbage-collects blobs no surviving record references.
  **Only `label === "implement"` records are exempt** — a Plan Mode baseline has
  to stay addressable for the life of the session. `"safety"` records are
  ordinary prunable snapshots; exempting them would let every restore add a
  permanent record and defeat the cap.

- [ ] **Step 1: Write the failing test**

Append to `tests/snapshots.test.ts`:

```ts
import { MAX_SNAPSHOTS_PER_SESSION, deleteSessionSnapshots, pruneSnapshots } from "../src/main/snapshots";

describe("retention", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("caps a session and garbage-collects unreferenced blobs", () => {
    for (let i = 0; i < MAX_SNAPSHOTS_PER_SESSION + 5; i++) {
      fs.writeFileSync(path.join(ws, "a.txt"), `v${i}`);
      captureSnapshot(root, "s1", [ws], ws, "pre", NOW);
    }
    const records = listSnapshots(root, "s1");
    expect(records).toHaveLength(MAX_SNAPSHOTS_PER_SESSION);
    // Oldest dropped, newest kept.
    expect(records[records.length - 1].seq).toBe(MAX_SNAPSHOTS_PER_SESSION + 5);
    const live = new Set(records.flatMap((r) => Object.values(r.manifest.files)));
    for (const blob of fs.readdirSync(path.join(root, "s1", "blobs"))) {
      expect(live.has(blob)).toBe(true);
    }
  });

  test("keeps an implement baseline past the cap", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "baseline");
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW, "implement");
    for (let i = 0; i < MAX_SNAPSHOTS_PER_SESSION + 5; i++) {
      fs.writeFileSync(path.join(ws, "a.txt"), `v${i}`);
      captureSnapshot(root, "s1", [ws], ws, "pre", NOW);
    }
    expect(listSnapshots(root, "s1").some((r) => r.label === "implement")).toBe(true);
  });

  test("prunes safety records like any other — they must not defeat the cap", () => {
    for (let i = 0; i < MAX_SNAPSHOTS_PER_SESSION + 5; i++) {
      fs.writeFileSync(path.join(ws, "a.txt"), `v${i}`);
      captureSnapshot(root, "s1", [ws], ws, "post", NOW, "safety");
    }
    expect(listSnapshots(root, "s1")).toHaveLength(MAX_SNAPSHOTS_PER_SESSION);
  });

  test("deleteSessionSnapshots removes the whole session directory", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    captureSnapshot(root, "s1", [ws], ws, "pre", NOW);

    deleteSessionSnapshots(root, "s1");

    expect(fs.existsSync(path.join(root, "s1"))).toBe(false);
    expect(listSnapshots(root, "s1")).toEqual([]);
  });

  test("deleteSessionSnapshots is safe for an unknown session and rejects traversal", () => {
    expect(() => deleteSessionSnapshots(root, "nope")).not.toThrow();
    expect(() => deleteSessionSnapshots(root, "../escape")).toThrow("Invalid session id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: FAIL — `pruneSnapshots is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/snapshots.ts`, and add the `pruneSnapshots(root, sessionId)` call at the end of `captureSnapshot`, immediately before `return rec;`:

```ts
/**
 * ponytail: a flat per-session cap, not a global size budget. Snapshots are
 * deleted with their session, so the ceiling is cap × sessions; a global LRU is
 * the upgrade path if that ever bites.
 */
export const MAX_SNAPSHOTS_PER_SESSION = 50;

/** Session ids come from the renderer — never let one address a parent dir. */
function assertSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId === "." || sessionId === "..") {
    throw new Error("Invalid session id");
  }
}

export function pruneSnapshots(root: string, sessionId: string): void {
  assertSessionId(sessionId);
  const records = listSnapshots(root, sessionId);
  // Only an "implement" baseline is exempt — it must stay addressable for the
  // life of the session. "safety" records are ordinary: exempting them would
  // let every restore add a permanent record and defeat the cap entirely.
  const prunable = records.filter((r) => r.label !== "implement");
  const excess = prunable.length - MAX_SNAPSHOTS_PER_SESSION;
  if (excess <= 0) return;

  const drop = new Set(prunable.slice(0, excess).map((r) => r.seq));
  const kept = records.filter((r) => !drop.has(r.seq));
  writeRecords(root, sessionId, kept);

  const live = new Set(kept.flatMap((r) => Object.values(r.manifest.files)));
  const blobsDir = path.join(sessionDirFor(root, sessionId), "blobs");
  let blobs: string[];
  try {
    blobs = fs.readdirSync(blobsDir);
  } catch {
    return;
  }
  for (const b of blobs) {
    if (!live.has(b)) {
      try { fs.rmSync(path.join(blobsDir, b)); } catch { /* already gone */ }
    }
  }
}

export function deleteSessionSnapshots(root: string, sessionId: string): void {
  assertSessionId(sessionId);
  fs.rmSync(sessionDirFor(root, sessionId), { recursive: true, force: true });
}
```

Also call `assertSessionId(sessionId)` at the top of `captureSnapshot`, `listSnapshots` and `stampSnapshot`. Note `listSnapshots`' existing test asserts `listSnapshots(root, "nope")` returns `[]` — `"nope"` passes the id check, so that test still holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/snapshots.test.ts`
Expected: PASS (26 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/snapshots.ts tests/snapshots.test.ts
git commit -m "feat(rewind): per-session snapshot cap with blob GC"
```

---

## Task 5: Wire capture into main

**Files:**
- Modify: `src/main/config.ts` (add `snapshotDir()`)
- Modify: `src/main/ipc.ts` (capture on prompt, capture on `agent_end`, stamp on `tool_execution_start`, delete with session)

**Interfaces:**
- Consumes: `captureSnapshot`, `stampSnapshot`, `deleteSessionSnapshots` from Tasks 2–4.
- Produces: a populated snapshot store, keyed to live sessions. No new exported API.

There is no unit test for this task — it is pure wiring inside `ipc.ts`, which
has no test harness in this repo. Its verification is the typecheck plus the
Task 7 UI pass. Keep every call site inside a `try/catch` that logs and
continues: **a snapshot failure must never block a prompt.**

- [ ] **Step 1: Add `snapshotDir()` to `src/main/config.ts`**

Directly after the existing `sessionDir()` (`src/main/config.ts:230-234`), matching its shape:

```ts
/** §9 rewind file rollback — content-addressed snapshot store, one dir per session. */
export function snapshotDir(): string {
  const dir = path.join(app.getPath("userData"), "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 2: Capture before forwarding a user prompt**

In `ipc.ts`, import the engine and add the capture immediately before
`await client.send(promptCommand(outgoing, behavior, images));` (`ipc.ts:899`):

```ts
// §9 rewind: the snapshot that a rewind to THIS message restores to. Steers
// join an in-flight turn, so they reuse that turn's snapshot (restores more,
// never less). A capture failure must never block the prompt.
if (behavior !== "steer" && meta?.workspaceId) {
  try {
    captureSnapshot(
      snapshotDir(), sessionId, workspaces.list(), meta.workspaceId,
      "pre", new Date().toISOString(),
    );
  } catch (e) {
    void log.append({
      type: "rewind.capture_failed", sessionId, workspaceId: meta.workspaceId,
      data: { error: e instanceof Error ? e.message : String(e) },
    });
  }
}
```

- [ ] **Step 3: Stamp on the turn's first tool call, and re-capture at `agent_end`**

At the event tap (`ipc.ts:453`, right after `activity.event(sessionId, e);`):

```ts
// §9 rewind: stamp the pending "pre" snapshot with the turn's FIRST toolCallId
// (the only id durable across a reload), and record what the agent left behind
// at agent_end — that record is the stale-check's reference.
const wsId = index.get(sessionId)?.workspaceId;
if (wsId) {
  try {
    if (e.type === "tool_execution_start" && typeof e.toolCallId === "string") {
      stampSnapshot(snapshotDir(), sessionId, e.toolCallId);
    } else if (e.type === "agent_end") {
      captureSnapshot(
        snapshotDir(), sessionId, workspaces.list(), wsId,
        "post", new Date().toISOString(),
      );
    }
  } catch {
    /* snapshotting is best-effort; never disturb the event stream */
  }
}
```

If `e` is not typed with `toolCallId`, widen the local event type at that call
site only — do **not** change `src/main/pi/types.ts` (that is the wire contract).

- [ ] **Step 4: Delete snapshots with the session**

In `hv:delete-session` (`ipc.ts:838-846`), after `deleteSessionFile(...)`:

```ts
deleteSessionSnapshots(snapshotDir(), sessionId);
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck`
Expected: PASS, both projects.

```bash
git add src/main/config.ts src/main/ipc.ts
git commit -m "feat(rewind): capture workspace snapshots around each turn"
```

---

## Task 6: Restore IPC — preview and apply

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/hv.d.ts`

**Interfaces:**
- Consumes: `findRestoreTarget`, `previewRestore`, `restoreSnapshot`.
- Produces, on `window.hv`:
  ```ts
  rewindPreview(sessionId: string, toolCallIds: string[]): Promise<RestorePreview | null>
  rewindRestore(sessionId: string, toolCallIds: string[]): Promise<RestoreResult | null>
  ```
  Both resolve `null` when no snapshot matches (nothing to restore).

- [ ] **Step 1: Add the two handlers to `ipc.ts`**

Place them beside the other session handlers, after `hv:get-session-calls`:

```ts
// §9 rewind file rollback. HUMAN-ONLY by construction: these are IPC handlers
// with no tool, no bridge command, and no model-reachable path — the same
// invariant as the plan-mode power transitions above.
const rewindTarget = (sessionId: string, toolCallIds: string[]) => {
  const meta = index.get(sessionId);
  if (!meta?.workspaceId) return null;
  const target = findRestoreTarget(snapshotDir(), sessionId, toolCallIds);
  return target ? { meta, target } : null;
};

ipcMain.handle("hv:rewind-preview", (_e, sessionId: string, toolCallIds: string[]) => {
  const hit = rewindTarget(sessionId, toolCallIds);
  if (!hit) return null;
  return previewRestore(
    snapshotDir(), sessionId, workspaces.list(), hit.meta.workspaceId, hit.target,
  );
});

ipcMain.handle("hv:rewind-restore", (_e, sessionId: string, toolCallIds: string[]) => {
  const hit = rewindTarget(sessionId, toolCallIds);
  if (!hit) return null;
  const result = restoreSnapshot(
    snapshotDir(), sessionId, workspaces.list(), hit.meta.workspaceId,
    hit.target, new Date().toISOString(),
  );
  void log.append({
    type: "rewind.restore",
    sessionId,
    workspaceId: hit.meta.workspaceId,
    data: {
      who: "human",
      seq: hit.target.seq,
      restored: result.restored.length,
      deleted: result.deleted.length,
      stale: result.stale,
      notCaptured: result.notCaptured,
    },
  });
  return result;
});
```

- [ ] **Step 2: Expose them in `src/preload/index.ts`**

Beside the existing `contextSnapshot` / `contextRemove` entries (`preload/index.ts:135`):

```ts
rewindPreview: (sessionId: string, toolCallIds: string[]) =>
  ipcRenderer.invoke("hv:rewind-preview", sessionId, toolCallIds),
rewindRestore: (sessionId: string, toolCallIds: string[]) =>
  ipcRenderer.invoke("hv:rewind-restore", sessionId, toolCallIds),
```

- [ ] **Step 3: Declare them in `src/renderer/src/hv.d.ts`**

Beside the context declarations (`hv.d.ts:359-361`):

```ts
rewindPreview(sessionId: string, toolCallIds: string[]): Promise<{
  willRestore: string[]; willDelete: string[]; stale: string[];
} | null>;
rewindRestore(sessionId: string, toolCallIds: string[]): Promise<{
  restored: string[]; deleted: string[]; stale: string[]; notCaptured: string[];
} | null>;
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck`
Expected: PASS, both projects.

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(rewind): human-only preview and restore IPC, audited"
```

---

## Task 7: Three-scope confirm dialog

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx:524-556` (the confirm modal), `:648` (the `onRewind` wiring)
- Modify: `src/renderer/src/App.tsx:1048-1068` (`rewindTo`)
- Create: `tests/rewind-scope.test.ts`

**Interfaces:**
- Consumes: `window.hv.rewindPreview` / `rewindRestore` from Task 6.
- Produces:
  ```ts
  export type RewindScope = "conversation" | "both" | "files";
  // App.tsx
  const rewindTo = (it: TranscriptItem, scope: RewindScope): void
  // ChatView.tsx prop
  onRewind?: (it: TranscriptItem, scope: RewindScope) => void;
  ```
  `rewindTo` collects `toolIds` exactly as it does today; for `"both"` and
  `"files"` it also calls `rewindRestore`, and for `"conversation"` it does not.
  The **conversation truncation is skipped entirely** for `"files"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/rewind-scope.test.ts
import { describe, expect, test } from "vitest";
import { rewindActions, type RewindScope } from "../src/renderer/src/rewind";

describe("rewindActions", () => {
  test("conversation scope truncates chat and leaves files alone", () => {
    expect(rewindActions("conversation")).toEqual({ truncateChat: true, restoreFiles: false });
  });

  test("both scope does everything", () => {
    expect(rewindActions("both")).toEqual({ truncateChat: true, restoreFiles: true });
  });

  test("files scope leaves the conversation intact", () => {
    expect(rewindActions("files")).toEqual({ truncateChat: false, restoreFiles: true });
  });

  test("every scope does at least one thing", () => {
    for (const s of ["conversation", "both", "files"] as RewindScope[]) {
      const a = rewindActions(s);
      expect(a.truncateChat || a.restoreFiles).toBe(true);
    }
  });
});

describe("tailToolCallIds", () => {
  const items = [
    { id: 0, kind: "user", text: "first" },
    { id: 1, kind: "tool", card: { toolCallId: "call-a" } },
    { id: 2, kind: "assistant", text: "done" },
    { id: 3, kind: "user", text: "second" },
    { id: 4, kind: "tool", card: { toolCallId: "call-b" } },
    { id: 5, kind: "tool", card: { toolCallId: "call-c" } },
  ] as unknown as Parameters<typeof tailToolCallIds>[0];

  test("collects every toolCallId at and after the anchor index", () => {
    expect(tailToolCallIds(items, 3)).toEqual(["call-b", "call-c"]);
  });

  test("rewinding to the first message collects them all", () => {
    expect(tailToolCallIds(items, 0)).toEqual(["call-a", "call-b", "call-c"]);
  });

  test("a tail with no tool calls yields an empty list", () => {
    expect(tailToolCallIds(items, 5 + 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rewind-scope.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/src/rewind`.

- [ ] **Step 3: Write the module**

```ts
// src/renderer/src/rewind.ts
import type { TranscriptItem } from "./components/Transcript";

/** §9 rewind scopes. Default is "conversation" — the pre-round-7 behaviour. */
export type RewindScope = "conversation" | "both" | "files";

export interface RewindActions { truncateChat: boolean; restoreFiles: boolean }

export function rewindActions(scope: RewindScope): RewindActions {
  return {
    truncateChat: scope !== "files",
    restoreFiles: scope !== "conversation",
  };
}

/**
 * The tool calls being undone by a rewind anchored at `idx`. `toolCallId` is
 * the only identifier durable across a reload (renderer ids renumber), so this
 * set is what main matches snapshots against. Shared by App.tsx (which applies
 * the rewind) and ChatView.tsx (which previews it) so the two can never
 * disagree about what is in scope.
 */
export function tailToolCallIds(items: TranscriptItem[], idx: number): string[] {
  return items
    .slice(idx)
    .flatMap((x) => (x.kind === "tool" ? [x.card.toolCallId] : []));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rewind-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Thread the scope through `App.tsx`**

Change the `rewindTo` signature and guard the truncation:

```ts
const rewindTo = (it: TranscriptItem, scope: RewindScope): void => {
  if (it.id == null) return;
  const sid =
    (selectedId && (transcripts[selectedId] ?? []).some((x) => x.id === it.id) && selectedId) ||
    Object.keys(transcripts).find((k) => transcripts[k].some((x) => x.id === it.id));
  if (!sid) return;
  const items = transcripts[sid] ?? [];
  const idx = items.findIndex((x) => x.id === it.id);
  if (idx < 0) return;
  const tail = items.slice(idx);
  const msgCount = tail.filter((x) => x.kind === "user" || x.kind === "assistant").length;
  const toolIds = new Set(tailToolCallIds(items, idx));
  const { truncateChat, restoreFiles } = rewindActions(scope);

  if (restoreFiles) {
    void window.hv.rewindRestore(sid, [...toolIds]).then((res) => {
      if (!res) return;
      const parts = [`${res.restored.length} restored`, `${res.deleted.length} removed`];
      if (res.stale.length) parts.push(`${res.stale.length} left alone (changed since)`);
      appendItem(sid, { kind: "notice", text: `Files rewound — ${parts.join(", ")}.` });
    });
  }
  if (!truncateChat) return;

  setTranscripts((p) => ({ ...p, [sid]: (p[sid] ?? []).slice(0, idx) }));
  pendingRewind.current[sid] = { msgCount, toolIds };
  void window.hv.contextSnapshot(sid);
};
```

`appendItem(sid, { kind: "notice", text })` is the existing neutral status line
(`Transcript.tsx:92`, used for the compaction notice at `App.tsx:658`). Do not
invent a new `kind`. Import `rewindActions` and `tailToolCallIds` from
`./rewind`, and `RewindScope` as a type.

- [ ] **Step 6: Replace the confirm modal in `ChatView.tsx`**

Keep the existing modal chrome; replace its body. The preview loads when the
dialog opens, so the file list is real, not a guess:

```tsx
{pendingRewind !== null && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setPendingRewind(null)}>
    <div className="w-full max-w-md rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
      <div className="font-bold text-ink mb-1">Rewind to this message?</div>
      <p className="text-sm text-ink-soft mb-3">
        Everything after this point is removed from the conversation and the agent's context, and this
        message moves back into the composer.
      </p>
      <div className="flex flex-col gap-1.5 mb-3">
        {([
          ["conversation", "Conversation only", "Files on disk are left exactly as they are."],
          ["both", "Conversation and files", "Also roll the workspace back to before this message."],
          ["files", "Files only", "Roll the workspace back, keep the conversation."],
        ] as const).map(([value, label, hint]) => (
          <label key={value} className="flex gap-2 items-start cursor-pointer rounded-xl border-2 border-line p-2 hover:bg-paper-deep">
            <input type="radio" name="rewind-scope" className="mt-1" checked={scope === value} onChange={() => setScope(value)} />
            <span>
              <span className="block text-sm font-bold text-ink">{label}</span>
              <span className="block text-xs text-ink-soft">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      {scope !== "conversation" && (
        <div className="text-xs text-ink-soft mb-4 rounded-xl bg-paper-deep p-2">
          {preview === undefined
            ? "Checking which files would change…"
            : preview === null
              ? "No snapshot for this message — no files will change."
              : (
                <>
                  <div><strong>{preview.willRestore.length}</strong> restored, <strong>{preview.willDelete.length}</strong> removed.</div>
                  {preview.stale.length > 0 && (
                    <div className="mt-1">
                      {preview.stale.length} changed since and will be left alone: {preview.stale.slice(0, 3).join(", ")}
                      {preview.stale.length > 3 ? "…" : ""}
                    </div>
                  )}
                </>
              )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setPendingRewind(null)} className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const it = pendingRewind;
            onRewind?.(it, scope);
            if (scope !== "files") setInput("text" in it && typeof it.text === "string" ? it.text : "");
            setPendingRewind(null);
          }}
          className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105"
        >
          Rewind
        </button>
      </div>
    </div>
  </div>
)}
```

Add the two state hooks beside `pendingRewind` (`ChatView.tsx:219`), and load
the preview when the dialog opens. `items` and `sessionId` are already props of
`ChatView` (`ChatView.tsx:39` and `:37`), so the tail is derived here with the
same shared helper `App.tsx` uses — the preview and the action can never
disagree about what is in scope:

```tsx
const [scope, setScope] = useState<RewindScope>("conversation");
const [preview, setPreview] = useState<
  { willRestore: string[]; willDelete: string[]; stale: string[] } | null | undefined
>(undefined);

useEffect(() => {
  if (pendingRewind === null || sessionId === null) {
    setPreview(undefined);
    setScope("conversation"); // every open starts at the safe default
    return;
  }
  const idx = items.findIndex((x) => x.id === pendingRewind.id);
  if (idx < 0) { setPreview(null); return; }
  void window.hv.rewindPreview(sessionId, tailToolCallIds(items, idx)).then(setPreview);
}, [pendingRewind, sessionId, items]);
```

- [ ] **Step 7: Run the non-live suite and commit**

Run the non-live suite exactly as `CLAUDE.md` specifies (derive the exclusion
list from that file, do not copy it from here).
Expected: PASS, including the 4 new scope tests.

```bash
git add src/renderer/src/rewind.ts tests/rewind-scope.test.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx
git commit -m "feat(rewind): three-scope confirm dialog with affected-file preview"
```

---

## Task 8: Plan Mode — Implement baseline and Revert implementation

**Files:**
- Modify: `src/main/ipc.ts` (`hv:plan-implement`, `ipc.ts:992`; new `hv:plan-revert`)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Modify: `src/renderer/src/components/PlanCard.tsx`

**Interfaces:**
- Consumes: `captureSnapshot` (with `label`), `restoreSnapshot`, `listSnapshots`.
- Produces: `window.hv.planRevert(sessionId: string): Promise<RestoreResult | null>`.

The Implement baseline is a **labelled** snapshot, so Task 4's cap never evicts
it. Revert restores the newest record labelled `implement`.

- [ ] **Step 1: Capture the baseline in `hv:plan-implement`**

At the top of the existing handler (`ipc.ts:992`), before it sends the
implement prompt:

```ts
// §23: the baseline a "Revert implementation" restores to. Labelled, so the
// per-session cap never evicts it.
const meta = index.get(sessionId);
if (meta?.workspaceId) {
  try {
    captureSnapshot(
      snapshotDir(), sessionId, workspaces.list(), meta.workspaceId,
      "pre", new Date().toISOString(), "implement",
    );
  } catch { /* best-effort; never block Implement */ }
}
```

- [ ] **Step 2: Add `hv:plan-revert`**

```ts
// Human-only, like every other power transition in this block.
ipcMain.handle("hv:plan-revert", (_e, sessionId: string) => {
  const meta = index.get(sessionId);
  if (!meta?.workspaceId) return null;
  const target = listSnapshots(snapshotDir(), sessionId)
    .filter((r) => r.label === "implement")
    .pop();
  if (!target) return null;
  const result = restoreSnapshot(
    snapshotDir(), sessionId, workspaces.list(), meta.workspaceId,
    target, new Date().toISOString(),
  );
  void log.append({
    type: "plan.revert", sessionId, workspaceId: meta.workspaceId,
    data: { who: "human", restored: result.restored.length, deleted: result.deleted.length, stale: result.stale },
  });
  return result;
});
```

- [ ] **Step 3: Expose it**

`src/preload/index.ts`, beside `planImplement` (`preload/index.ts:67`):

```ts
planRevert: (sessionId: string) => ipcRenderer.invoke("hv:plan-revert", sessionId),
```

`src/renderer/src/hv.d.ts`, beside the plan declarations:

```ts
planRevert(sessionId: string): Promise<{
  restored: string[]; deleted: string[]; stale: string[]; notCaptured: string[];
} | null>;
```

- [ ] **Step 4: Add the action to `PlanCard.tsx`**

In the `implementing` and `implemented` status branches, beside the existing
actions, add a button that confirms first (it writes files):

```tsx
<button
  type="button"
  onClick={() => setConfirmRevert(true)}
  className="rounded-xl bg-card text-ink font-bold text-sm px-3 py-1.5 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
>
  Revert implementation
</button>
```

Gate it behind a confirm — it writes files. Reuse the rewind modal's chrome with
this exact copy:

> **Revert this implementation?**
> The workspace goes back to how it was when you pressed Implement. Files that
> changed since the agent touched them are left alone. **The conversation is not
> affected.**

On confirm:

```tsx
void window.hv.planRevert(sessionId).then((res) => {
  if (!res) return;
  const parts = [`${res.restored.length} restored`, `${res.deleted.length} removed`];
  if (res.stale.length) parts.push(`${res.stale.length} left alone (changed since)`);
  onNotice(`Implementation reverted — ${parts.join(", ")}.`);
});
```

`PlanCard` does not own the transcript, so add an `onNotice(text: string)` prop
and have its parent call the same `appendItem(sid, { kind: "notice", text })`
that `rewindTo` uses — one notice path, not two.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck`, then the non-live suite per `CLAUDE.md`.
Expected: PASS.

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/components/PlanCard.tsx
git commit -m "feat(plan): snapshot at Implement and one-click Revert implementation"
```

---

## Final gate

Run in order, pasting real output — never a summary:

1. `npm run typecheck` (node + web)
2. The non-live suite, with the exclusion list derived from `CLAUDE.md` §Tests
3. `npm run build`

**Live-Pi tests are NOT required for this plan** — the diff touches neither
`pi-runtime/extensions/` nor `src/main/pi/`. If any task made you edit either,
the design has been violated: stop and report rather than running them.

**UI pass required** — `src/renderer/` changes in Tasks 7 and 8. Follow
`.claude/commands/uicheck.md` exactly: `attach {debugPort: 9222}`, never
`start_app`. Screenshot the three-scope dialog with a real file preview, and
screenshot the workspace after a "Conversation and files" rewind. The feature is
not done because types pass — it is done when the screenshot shows it.

## Manual verification checklist

- [ ] Rewind with **Conversation only** — transcript truncates, files untouched.
- [ ] Rewind with **Conversation and files** — a file the agent edited returns to its prior content; a file it created is gone.
- [ ] Rewind with **Files only** — workspace rolls back, transcript unchanged, composer not repopulated.
- [ ] Hand-edit a file the agent touched, then rewind with files — that file is **left alone** and named in the notice.
- [ ] A `dist/` directory survives a rewind untouched.
- [ ] Delete a session — `<userData>/snapshots/<sessionId>/` is gone.
- [ ] Plan Mode: Implement, then **Revert implementation** — workspace returns to the pre-implementation state.
