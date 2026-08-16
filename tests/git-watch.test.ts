import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
async function waitFor(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
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

afterEach(() => {
  unwatchAllGit();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("watchGitDir", () => {
  it("fires when HEAD changes — the outside-terminal branch switch", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/feature\n");
    await waitFor(() => fired > 0);

    expect(fired).toBeGreaterThan(0);
  });

  it("fires when the index changes", async () => {
    let fired = 0;
    watchGitDir(dir, () => fired++);

    fs.writeFileSync(path.join(gitDir, "index"), "changed");
    await waitFor(() => fired > 0);

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

    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/b${i}\n`);
    await waitFor(() => fired > 0);
    await settle(); // and give a second, wrong callback time to show up

    expect(fired).toBe(1);
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

    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/twice\n");
    await waitFor(() => fired > 0);
    await settle();

    expect(fired).toBe(1);
  });
});
