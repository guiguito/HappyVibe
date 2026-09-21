import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addWorktree, listWorktrees, mergeBranch, mergeCheck, pruneWorktrees, removeWorktree, resetGitAvailability,
  worktreeVerbs,
} from "../src/main/git";

describe("worktreeVerbs (pure)", () => {
  const head = { branch: "main", sha: "abc1234" };

  it("absent when there is no repo to branch from", () => {
    expect(worktreeVerbs({ kind: "no-git" }, head).ok).toBe(false);
    expect(worktreeVerbs({ kind: "no-repo" }, head).ok).toBe(false);
    expect(worktreeVerbs({ kind: "error", message: "dubious ownership", fix: null }, head).ok).toBe(false);
  });

  it("absent on an unborn HEAD, because git would make an orphan branch", () => {
    // Measured on 2.50.1: `worktree add -b x` on a repo with no commits SUCCEEDS
    // and silently creates an --orphan branch sharing no history, so merging it
    // back would be meaningless. Refusing beats producing that.
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: null, unborn: true }, head)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/first version/i),
    });
    // …and equally when the live status says unborn by having no oid.
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: null, unborn: false }, null).ok).toBe(false);
  });

  it("absent on a subdirectory workspace (§5c), naming why", () => {
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: "pkg", unborn: false }, head)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/subfolder/i),
    });
  });

  it("present on a plain repo, naming the base it would branch from", () => {
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: null, unborn: false }, head)).toEqual({
      ok: true,
      base: head,
    });
  });
});

const HAVE_GIT = ((): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const git = (cwd: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf8" });

const mkRepo = (): { root: string; m: string } => {
  resetGitAvailability();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-add-"));
  const m = path.join(root, "m");
  fs.mkdirSync(m);
  git(m, "init", "-q");
  git(m, "config", "user.email", "t@x");
  git(m, "config", "user.name", "T");
  fs.writeFileSync(path.join(m, "a"), "a");
  git(m, "add", "-A");
  git(m, "commit", "-qm", "i");
  return { root, m };
};

describe.skipIf(!HAVE_GIT)("addWorktree over a real repo", () => {
  it("creates a NEW branch in a folder outside the repo, leaving the parent clean", async () => {
    const { root, m } = mkRepo();
    // The app-data shape: nested directories that do not exist yet.
    const dir = path.join(root, "appdata", "worktrees", "k", "feat-x");
    expect(await addWorktree(m, dir, "feat/x")).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, "a"))).toBe(true);
    // The whole reason for app-data placement: nothing to commit, nothing to ignore.
    expect(git(m, "status", "--porcelain")).toBe("");
    expect((await listWorktrees(m)).map((w) => w.branch)).toEqual(["feat/x"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses an EXISTING branch that is not checked out anywhere", async () => {
    const { root, m } = mkRepo();
    git(m, "branch", "side");
    expect(await addWorktree(m, path.join(root, "wt"), "side")).toEqual({ ok: true });
    expect((await listWorktrees(m)).map((w) => w.branch)).toEqual(["side"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses a branch checked out elsewhere, in git's own words", async () => {
    const { root, m } = mkRepo();
    const r = await addWorktree(m, path.join(root, "wt2"), "main");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/already used by worktree|already checked out/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses an existing folder BEFORE git runs, so no branch is left behind", async () => {
    const { root, m } = mkRepo();
    fs.mkdirSync(path.join(root, "taken"));
    const c = await addWorktree(m, path.join(root, "taken"), "feat/y");
    expect(c).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(git(m, "branch", "--list", "feat/y").trim()).toBe(""); // git never ran
    fs.rmSync(root, { recursive: true, force: true });
  });
});

const commitIn = (dir: string, file: string, text: string): void => {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", `${file}: ${text}`);
};

describe.skipIf(!HAVE_GIT)("mergeCheck — the three preconditions, each named", () => {
  it("refuses when the branch is not ahead", async () => {
    const { root, m } = mkRepo();
    git(m, "worktree", "add", "-q", path.join(root, "wt"), "-b", "side");
    expect(await mergeCheck(m, "side")).toMatchObject({
      ok: false,
      ahead: 0,
      reason: expect.stringMatching(/nothing to merge/i),
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses while the parent has TRACKED changes, but untracked ones are fine", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    commitIn(wt, "b", "1");

    fs.writeFileSync(path.join(m, "a"), "dirty");
    expect(await mergeCheck(m, "side")).toMatchObject({ reason: expect.stringMatching(/unsaved changes/i) });

    git(m, "checkout", "--", "a");
    fs.writeFileSync(path.join(m, "untracked.txt"), "x");
    // git refuses cleanly if an untracked file would be overwritten, changing
    // nothing — so it is not our job to pre-refuse for one.
    expect(await mergeCheck(m, "side")).toMatchObject({ ok: true, ahead: 1, parentBranch: "main" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe.skipIf(!HAVE_GIT)("mergeBranch — and the abort rule", () => {
  it("fast-forwards when it can", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    commitIn(wt, "b", "1");
    expect(await mergeBranch(m, "side")).toEqual({ ok: true, fastForward: true });
    expect(git(m, "log", "--oneline").split("\n").filter(Boolean)).toHaveLength(2);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("makes a merge commit when both sides moved", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    commitIn(wt, "b", "1");
    commitIn(m, "c", "2");
    expect(await mergeBranch(m, "side")).toEqual({ ok: true, fastForward: false });
    expect(git(m, "rev-list", "--count", "HEAD").trim()).toBe("4");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a conflict is ABORTED: the parent tree is byte-identical and the files are named", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    commitIn(wt, "a", "side version");
    commitIn(m, "a", "main version");

    const treeBefore = git(m, "write-tree").trim();
    const headBefore = git(m, "rev-parse", "HEAD").trim();

    const r = await mergeBranch(m, "side");
    expect(r).toMatchObject({ ok: false, aborted: true, conflicts: ["a"] });
    // §7 ships no conflict UI, so the ONLY acceptable outcome is "nothing happened".
    expect(fs.existsSync(path.join(m, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(m, "write-tree").trim()).toBe(treeBefore);
    expect(git(m, "rev-parse", "HEAD").trim()).toBe(headBefore);
    expect(git(m, "status", "--porcelain")).toBe("");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe.skipIf(!HAVE_GIT)("removeWorktree / pruneWorktrees", () => {
  it("refuses a dirty worktree in git's words, then removes with force", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    fs.writeFileSync(path.join(wt, "x"), "x");

    const r = await removeWorktree(m, wt);
    expect(r).toMatchObject({ ok: false, dirty: true, error: expect.stringMatching(/modified or untracked/i) });
    expect(fs.existsSync(wt)).toBe(true); // …and nothing was destroyed on the way

    expect(await removeWorktree(m, wt, true)).toEqual({ ok: true });
    expect(fs.existsSync(wt)).toBe(false);
    expect(await listWorktrees(m)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a LOCKED worktree is refused and gets no force path — the lock was a decision", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    git(m, "worktree", "lock", wt);
    const r = await removeWorktree(m, wt, true);
    expect(r.ok).toBe(false);
    expect((r as { dirty?: boolean }).dirty).toBeUndefined();
    expect((r as { error: string }).error).toMatch(/locked/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("prune clears an entry whose folder is gone", async () => {
    const { root, m } = mkRepo();
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    fs.rmSync(wt, { recursive: true, force: true });
    expect((await listWorktrees(m))[0]?.prunable).toBe(true);
    expect(await pruneWorktrees(m)).toEqual({ ok: true });
    expect(await listWorktrees(m)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
