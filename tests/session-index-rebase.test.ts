import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionIndex } from "../src/main/store";

// Round-4 regression: the app rename moved userData (hv-scaffold → HappyVibe),
// leaving absolute piSessionFile paths pointing at the old dir → resume loaded
// no history. rebaseSessionFiles heals them onto the current session dir.
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "hv-rebase-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("SessionIndex.rebaseSessionFiles", () => {
  it("rebases a stale path onto the current session dir by basename", () => {
    const indexFile = join(tmp, "session-index.json");
    const oldDir = join(tmp, "hv-scaffold", "sessions");
    const newDir = join(tmp, "HappyVibe", "sessions");
    mkdirSync(newDir, { recursive: true });
    const idx = new SessionIndex(indexFile);
    const meta = idx.create(join(tmp, "ws"));
    // The file lives in the NEW dir; the index still points at the OLD one.
    const base = "2026-01-01T00-00-00-000Z_abc.jsonl";
    writeFileSync(join(newDir, base), "{}");
    idx.update(meta.id, { piSessionFile: join(oldDir, base) });

    idx.rebaseSessionFiles(newDir);

    expect(idx.get(meta.id)?.piSessionFile).toBe(join(newDir, base));
    // persisted to disk
    const onDisk = JSON.parse(readFileSync(indexFile, "utf8"));
    const arr = Array.isArray(onDisk) ? onDisk : onDisk.sessions ?? [];
    expect(arr[0].piSessionFile).toBe(join(newDir, base));
  });

  it("leaves a valid path untouched and skips when no match exists", () => {
    const idx = new SessionIndex(join(tmp, "idx.json"));
    const dir = join(tmp, "sessions");
    mkdirSync(dir, { recursive: true });
    const good = join(dir, "good.jsonl");
    writeFileSync(good, "{}");
    const a = idx.create(join(tmp, "ws"));
    const b = idx.create(join(tmp, "ws"));
    idx.update(a.id, { piSessionFile: good });
    idx.update(b.id, { piSessionFile: join(tmp, "gone", "missing.jsonl") });

    idx.rebaseSessionFiles(dir);

    expect(idx.get(a.id)?.piSessionFile).toBe(good); // untouched
    expect(idx.get(b.id)?.piSessionFile).toBe(join(tmp, "gone", "missing.jsonl")); // no candidate → left as-is
  });
});
