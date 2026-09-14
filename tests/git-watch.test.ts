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
  gitDir = path.join(dir, ".git");
  fs.mkdirSync(path.join(gitDir, "objects", "ab"), { recursive: true });
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(gitDir, "index"), "binary-ish");
});

afterEach(async () => {
  unwatchAllGit();
  // One turn of the loop between close() and the delete: the cancellation of the
  // underlying ReadDirectoryChangesW request is asynchronous on Windows, and the
  // retries cover the directory still being handle-locked. The crash this file used to
  // take is handled at EXIT, in the afterAll below — the delay here was not enough on
  // its own, which is what said the problem was the worker exiting rather than the rm.
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

/**
 * Let Windows finish tearing down the native handles this file opened before the
 * worker process exits.
 *
 * `FSWatcher.close()` and `pty.kill()` both return immediately and complete
 * ASYNCHRONOUSLY on Windows — the ConPTY teardown is visible in CI's own cleanup,
 * which reports orphaned `conhost` and `bash` processes. When the worker exits with
 * that work in flight, the completion lands on a dead process and the worker dies with
 * ACCESS_VIOLATION (0xC0000005) or STATUS_STACK_BUFFER_OVERRUN (0xC0000409) — after
 * every test in the file has PASSED, which is how it presented: a green file list and
 * a failed run.
 *
 * Deterministic on the Windows runner, never reproducible on a Windows dev box. It is
 * a test-harness accommodation for a platform behaviour, not a product bug: the app
 * does not exit microseconds after killing a terminal.
 */
afterAll(async () => {
  if (process.platform === "win32") await new Promise((r) => setTimeout(r, 300));
});
