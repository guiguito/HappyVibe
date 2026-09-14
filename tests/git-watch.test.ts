import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, afterAll } from "vitest";
import { unwatchAllGit, unwatchGit, watchGitDir } from "../src/main/gitWatch";

/**
 * §1b — the narrow `.git` watch.
 *
 * This exists because the file-tree watcher deliberately FILTERS `.git`
 * (watch.ts, via isVisibleEntry), so a branch switched in an outside terminal
 * would otherwise sit stale in the sidebar forever. It is deliberately not
 * recursive: `.git/objects` churns on every operation, and a watch that fires
 * per loose object would run a `git status` per object.
 */

let dir: string;
let gitDir: string;

const settle = (ms = 600): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll for a POSITIVE outcome rather than sleeping a fixed amount. Under the
 * full parallel suite the callback arrives late, not never, and a fixed sleep
 * turns "slower machine" into "failing test" — the ui-fallback-bridge lesson.
 */
async function waitFor(cond: () => boolean, timeoutMs = 5_000, keepPoking?: () => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    // `fs.watch` arms asynchronously, so a write issued immediately after
    // watchGitDir can land before the watcher exists and be missed entirely —
    // rare alone, reliable under the loaded full suite. Re-poking makes the
    // test assert "a HEAD change fires the callback" rather than "the very
    // first write after arming does", which is the claim we actually care
    // about: in the app the watch is installed long before any branch switch.
    keepPoking?.();
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitwatch-"));
  made.push(dir);
  gitDir = path.join(dir, ".git");
  fs.mkdirSync(path.join(gitDir, "objects", "ab"), { recursive: true });
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(gitDir, "index"), "binary-ish");
});

/**
 * Temp dirs are collected and removed at the END, never in afterEach — and on Windows
 * not at all.
 *
 * The `afterEach` used to close the watcher and delete the directory it had just been
 * watching. On the Windows runner that killed the worker with
 * STATUS_STACK_BUFFER_OVERRUN (exit 3221226505) after every test in the file had
 * PASSED, so the file list read green and the run did not. `FSWatcher.close()` only
 * begins cancelling the underlying ReadDirectoryChangesW request, and deleting the
 * directory it refers to is what libuv cannot survive — a delay before the delete was
 * not enough, which is how we know it is the delete and not the timing.
 *
 * It never reproduces on a Windows dev box (300 close-then-delete cycles survive), so
 * the runner is the only witness. Not removing them there costs a few directories on a
 * VM whose disk is discarded minutes later, and costs no assertion at all — this file
 * is about what the watcher REPORTS, not about tidying up after itself.
 */
const made: string[] = [];

afterEach(() => {
  unwatchAllGit();
});

afterAll(() => {
  if (process.platform === "win32") return;
  for (const d of made) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("watchGitDir", () => {
  it("fires when HEAD changes — the outside-terminal branch switch", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    let n = 0;
    const poke = (): void => fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/feature${n++}\n`);
    poke();
    await waitFor(() => fired > 0, 5_000, poke);

    expect(fired).toBeGreaterThan(0);
  });

  it("fires when the index changes", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    let n = 0;
    const poke = (): void => fs.writeFileSync(path.join(gitDir, "index"), `changed${n++}`);
    poke();
    await waitFor(() => fired > 0, 5_000, poke);

    expect(fired).toBeGreaterThan(0);
  });

  it("IGNORES object churn — even though macOS reports a spurious HEAD event for it", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    // A commit writes many of these. Measured on macOS, writing one file under
    // .git/objects/ab/ reports `change ".git"`, `rename "objects"` AND
    // `rename "HEAD"` — so a filename filter would let the churn straight
    // through and run a `git status` per object. The fingerprint is what
    // actually stops it.
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(gitDir, "objects", "ab", `obj${i}`), "x");
    }
    await settle();

    expect(fired).toBe(0);
  });

  it("coalesces a burst into a single callback", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    let writes = 0;
    const burst = (): void => {
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/b${writes}\n`);
        writes++;
      }
    };
    burst();
    await waitFor(() => fired > 0, 5_000, burst);
    await settle(); // and give a second, wrong callback time to show up

    // The claim is the ratio, not the exact count: dozens of writes collapse to
    // one or two callbacks. (A single extra is possible when a write lands in
    // the same tick the debounce timer fires — harmless, and far from "one
    // git status per write", which is what this guards.)
    expect(writes).toBeGreaterThanOrEqual(10);
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThanOrEqual(2);
  });

  it("stops firing once unwatched", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);
    unwatchGit(dir);

    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/other\n");
    await settle();

    expect(fired).toBe(0);
  });

  it("is a no-op on a folder with no .git, and never throws", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "hv-nogit-"));
    try {
      expect(() => watchGitDir(plain, () => {})).not.toThrow();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it("keeps one watcher per workspace when started twice", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);
    watchGitDir(dir, () => fired++); // a second consumer must not double-fire

    let n = 0;
    const poke = (): void => fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/twice${n++}\n`);
    poke();
    await waitFor(() => fired > 0, 5_000, poke);
    await settle();

    // One consumer's callback, not two — however many pokes it took to arm.
    expect(fired).toBeLessThanOrEqual(n);
    expect(fired).toBeGreaterThan(0);
  });
});
