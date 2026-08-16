import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitStatus, invalidateProbe, publish, resetGitAvailability, saveVersion, switchBranch, sync } from "../src/main/git";

/**
 * §29 — the remote half, against a REAL GitHub repository.
 *
 * Everything else in the git suite runs on local temp repos, which can prove the
 * argv but not the network verbs: `publish` (push -u), `sync`'s fetch → ff-only
 * pull → push, and — the one that matters most — that a genuinely diverged branch
 * comes back as `nonFF` and MERGES NOTHING, because §7 ships no conflict UI.
 *
 * Safety rules this file follows, in order of how badly they would be missed:
 *  - it NEVER touches the user's own checkout; every test clones into a temp dir;
 *  - it only ever pushes branches named `hv-test-*`, and deletes them afterwards;
 *  - it never pushes to `main`.
 *
 * Skipped automatically when the fixture repo is absent (i.e. in CI) or the
 * network/credentials are not there, so it stays in the fast, key-free suite.
 */

const FIXTURE_DIR = "/Users/guilhemduche/Documents/Github/TestHappyVibeGit";
const REMOTE_URL = "https://github.com/guiguito/TestHappyVibeGit.git";

function reachable(): boolean {
  if (!fs.existsSync(FIXTURE_DIR)) return false;
  const r = spawnSync("git", ["ls-remote", "--heads", REMOTE_URL], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return r.status === 0;
}

const REMOTE_OK = reachable();
const pushedBranches = new Set<string>();
let dir: string;

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** A fresh clone of the real repo, on a uniquely-named throwaway branch. */
function cloneFixture(): { repo: string; branch: string } {
  const repo = path.join(dir, `clone-${Math.random().toString(36).slice(2, 8)}`);
  git(dir, ["clone", "-q", REMOTE_URL, repo]);
  git(repo, ["config", "user.email", "test@happyvibe.local"]);
  git(repo, ["config", "user.name", "HappyVibe Test"]);
  const branch = `hv-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  git(repo, ["checkout", "-q", "-b", branch]);
  return { repo, branch };
}

function remoteHas(branch: string): boolean {
  const out = spawnSync("git", ["ls-remote", "--heads", REMOTE_URL, branch], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return (out.stdout ?? "").includes(`refs/heads/${branch}`);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitremote-"));
  resetGitAvailability();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  // Leave the real repository exactly as we found it, even if a test threw.
  for (const b of pushedBranches) {
    spawnSync("git", ["push", "--quiet", REMOTE_URL, "--delete", b], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  }
}, 180_000);

describe.skipIf(!REMOTE_OK)("publish — the first push of a branch with no upstream", () => {
  it("pushes the branch and sets its upstream", async () => {
    const { repo, branch } = cloneFixture();
    invalidateProbe(repo);
    fs.writeFileSync(path.join(repo, "hello.md"), "# Published by HappyVibe\n");

    const saved = await saveVersion(repo, "feat: a file to publish", { stagedOnly: false, amend: false });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);

    // Before: the branch exists only locally, so the panel offers Publish, not Sync.
    const before = await gitStatus(repo);
    expect(before.status!.branch.upstream).toBeNull();

    const r = await publish(repo);
    pushedBranches.add(branch);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(remoteHas(branch)).toBe(true);

    const after = await gitStatus(repo);
    expect(after.status!.branch.upstream).toBe(`origin/${branch}`);
    expect(after.status!.branch.ahead).toBe(0);
  }, 180_000);
});

describe.skipIf(!REMOTE_OK)("sync", () => {
  it("pushes when ahead", async () => {
    const { repo, branch } = cloneFixture();
    invalidateProbe(repo);
    fs.writeFileSync(path.join(repo, "one.md"), "first\n");
    await saveVersion(repo, "feat: first", { stagedOnly: false, amend: false });
    await publish(repo);
    pushedBranches.add(branch);

    fs.writeFileSync(path.join(repo, "two.md"), "second\n");
    await saveVersion(repo, "feat: second", { stagedOnly: false, amend: false });
    expect((await gitStatus(repo)).status!.branch.ahead).toBe(1);

    const r = await sync(repo);
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const after = await gitStatus(repo);
    expect(after.status!.branch.ahead).toBe(0);
    expect(after.status!.branch.behind).toBe(0);
  }, 180_000);

  it("fast-forwards when behind, without a merge commit", async () => {
    const { repo, branch } = cloneFixture();
    invalidateProbe(repo);
    fs.writeFileSync(path.join(repo, "base.md"), "base\n");
    await saveVersion(repo, "feat: base", { stagedOnly: false, amend: false });
    await publish(repo);
    pushedBranches.add(branch);

    // Someone else pushes to the same branch (a teammate, or the same user on
    // another machine) — this clone is now strictly behind.
    const other = path.join(dir, "other");
    git(dir, ["clone", "-q", "--branch", branch, REMOTE_URL, other]);
    git(other, ["config", "user.email", "other@happyvibe.local"]);
    git(other, ["config", "user.name", "Other"]);
    fs.writeFileSync(path.join(other, "theirs.md"), "from elsewhere\n");
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", "feat: theirs"]);
    git(other, ["push", "-q"]);

    const r = await sync(repo);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(fs.existsSync(path.join(repo, "theirs.md"))).toBe(true);

    // ff-only means a linear history: the tip has ONE parent, never a merge.
    const parents = git(repo, ["rev-list", "--parents", "-1", "HEAD"]).trim().split(" ");
    expect(parents.length).toBe(2); // <commit> <single parent>
  }, 180_000);

  it("STOPS on a genuine divergence and merges nothing", async () => {
    const { repo, branch } = cloneFixture();
    invalidateProbe(repo);
    fs.writeFileSync(path.join(repo, "base.md"), "base\n");
    await saveVersion(repo, "feat: base", { stagedOnly: false, amend: false });
    await publish(repo);
    pushedBranches.add(branch);

    // Remote gains a commit...
    const other = path.join(dir, "other");
    git(dir, ["clone", "-q", "--branch", branch, REMOTE_URL, other]);
    git(other, ["config", "user.email", "other@happyvibe.local"]);
    git(other, ["config", "user.name", "Other"]);
    fs.writeFileSync(path.join(other, "theirs.md"), "theirs\n");
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", "feat: theirs"]);
    git(other, ["push", "-q"]);

    // ...and so do we, locally. The branch has now genuinely diverged.
    fs.writeFileSync(path.join(repo, "mine.md"), "mine\n");
    await saveVersion(repo, "feat: mine", { stagedOnly: false, amend: false });

    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    const r = await sync(repo);

    expect(r.ok).toBe(false);
    expect(r.nonFF, `expected a non-fast-forward verdict, got: ${r.error}`).toBe(true);
    // The promise this test exists for: nothing was merged, nothing was rebased,
    // and the user's own commit is still exactly where they left it.
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(fs.existsSync(path.join(repo, "theirs.md"))).toBe(false);
    expect(git(repo, ["status", "--porcelain=v2"]).includes("u ")).toBe(false); // no conflict state
  }, 180_000);
});

describe.skipIf(!REMOTE_OK)("branching against the real remote", () => {
  it("creates a branch, publishes it, and switches back and forth", async () => {
    const { repo, branch } = cloneFixture();
    invalidateProbe(repo);
    fs.writeFileSync(path.join(repo, "feature.md"), "feature work\n");
    await saveVersion(repo, "feat: work on a branch", { stagedOnly: false, amend: false });
    await publish(repo);
    pushedBranches.add(branch);

    // Back to main, then onto a second branch created from it.
    expect((await switchBranch(repo, "main", { create: false, mode: "take" })).ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "feature.md"))).toBe(false);

    const second = `${branch}-two`;
    expect((await switchBranch(repo, second, { create: true, mode: "take" })).ok).toBe(true);
    fs.writeFileSync(path.join(repo, "second.md"), "second branch\n");
    await saveVersion(repo, "feat: the second branch", { stagedOnly: false, amend: false });
    expect((await publish(repo)).ok).toBe(true);
    pushedBranches.add(second);

    expect(remoteHas(branch)).toBe(true);
    expect(remoteHas(second)).toBe(true);

    // And the first branch's file is back when we return to it.
    expect((await switchBranch(repo, branch, { create: false, mode: "take" })).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "feature.md"), "utf8")).toBe("feature work\n");
  }, 240_000);
});
