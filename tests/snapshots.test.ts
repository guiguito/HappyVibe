import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildManifest, captureSnapshot, deleteSessionSnapshots, diffManifests, findRestoreTarget,
  listSnapshots, MAX_SNAPSHOTS_PER_SESSION,
  previewRestore, restoreSnapshot, SNAPSHOT_EXCLUDE, stampSnapshot,
} from "../src/main/snapshots";
import type { Manifest, SnapshotRecord } from "../src/main/snapshots";

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

// ── Task 2: the per-session store ────────────────────────────────────────────

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

// ── Task 3: restore ──────────────────────────────────────────────────────────

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

// ── Task 4: retention ────────────────────────────────────────────────────────

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
