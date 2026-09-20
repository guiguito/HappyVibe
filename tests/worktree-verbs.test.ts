import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addWorktree, listWorktrees, resetGitAvailability, worktreeVerbs } from "../src/main/git";

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
