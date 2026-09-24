import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  JUNK_DIRS,
  appendGitignore,
  deleteBranch,
  detectJunk,
  discardUntracked,
  gitDiff,
  gitHistory,
  gitStatus,
  initPreview,
  initRepo,
  invalidateProbe,
  listBranches,
  probeWorkspace,
  resetGitAvailability,
  branchCommits,
  remoteUrl,
  saveVersion,
  setGitBinaryForTest,
  stageFile,
  stash,
  switchBranch,
  undoFile,
  undoHunk,
} from "../src/main/git";
import { hunkPatch } from "../src/main/gitParse";

/**
 * §29. Real git, real repos in a temp dir — the parsers are unit-tested against
 * captured fixtures in git-parse.test.ts, so what THIS file is for is the half a
 * fixture cannot prove: that our argv actually produces those fixtures, and that
 * a reverse-applied hunk really lands on disk.
 *
 * Key-free, so it stays in the fast suite; skipped entirely when git is absent
 * (§5a is a supported state, not a broken machine).
 */
const GIT_OK = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

let dir: string;

/** A repo with one commit: src/a.ts (10 lines), docs/keep.md. */
function makeRepo(root: string): void {
  run(root, ["init", "-q", "-b", "main", "."]);
  run(root, ["config", "user.email", "t@example.com"]);
  run(root, ["config", "user.name", "T"]);
  // The fixture owns its own line-ending policy (PRD §4, Windows round). Git for
  // Windows ships core.autocrlf=true in its SYSTEM config, so `git apply -R`,
  // `git restore` and `git stash pop` all write CRLF into the working tree — correct
  // git behaviour for that config, and nothing to do with the code under test, but it
  // turned every "the undone file now reads X" assertion red. Pinned here rather than
  // normalised at each assertion, so the tests keep comparing exact bytes.
  run(root, ["config", "core.autocrlf", "false"]);
  run(root, ["config", "core.eol", "lf"]);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/a.ts"), "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
  fs.writeFileSync(path.join(root, "docs/keep.md"), "keep\n");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-qm", "init"]);
}

function run(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  // stdout too: git reports "nothing to commit" there, and a Windows CI failure
  // with an empty stderr was undiagnosable without it.
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed (${r.status ?? r.error?.message}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-git-"));
  resetGitAvailability();
});

afterEach(() => {
  setGitBinaryForTest(null);
  resetGitAvailability();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!GIT_OK)("probeWorkspace — the five outcomes", () => {
  it("reports no-repo for a plain folder", async () => {
    expect(await probeWorkspace(dir)).toEqual({ kind: "no-repo" });
  });

  it("reports a repo with its root", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const s = await probeWorkspace(dir);
    expect(s.kind).toBe("repo");
    if (s.kind !== "repo") throw new Error("unreachable");
    expect(fs.realpathSync.native(s.root)).toBe(fs.realpathSync.native(dir));
    expect(s.subdir).toBeNull();
    expect(s.unborn).toBe(false);
  });

  it("reports a SUBDIRECTORY of a repo with the real root and the subpath", async () => {
    makeRepo(dir);
    const sub = path.join(dir, "src");
    invalidateProbe(sub);
    const s = await probeWorkspace(sub);
    if (s.kind !== "repo") throw new Error(`expected repo, got ${s.kind}`);
    expect(fs.realpathSync.native(s.root)).toBe(fs.realpathSync.native(dir));
    expect(s.subdir).toBe("src");
  });

  it("reports an unborn HEAD as a repo, not an error", async () => {
    run(dir, ["init", "-q", "-b", "main", "."]);
    invalidateProbe(dir);
    const s = await probeWorkspace(dir);
    if (s.kind !== "repo") throw new Error(`expected repo, got ${s.kind}`);
    expect(s.unborn).toBe(true);
  });

  it("reports no-git when the binary cannot be run", async () => {
    setGitBinaryForTest(path.join(dir, "definitely-not-git"));
    resetGitAvailability();
    invalidateProbe(dir);
    expect(await probeWorkspace(dir)).toEqual({ kind: "no-git" });
  });

  it("caches the probe until invalidated", async () => {
    expect(await probeWorkspace(dir)).toEqual({ kind: "no-repo" });
    makeRepo(dir);
    expect(await probeWorkspace(dir)).toEqual({ kind: "no-repo" }); // still cached
    invalidateProbe(dir);
    expect((await probeWorkspace(dir)).kind).toBe("repo");
  });
});

describe.skipIf(!GIT_OK)("gitStatus", () => {
  it("reports modified, untracked and staged files with line counts", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
    fs.writeFileSync(path.join(dir, "src/new.ts"), "brand new\n");
    fs.writeFileSync(path.join(dir, "docs/keep.md"), "keep\nmore\n");
    run(dir, ["add", "docs/keep.md"]);

    const r = await gitStatus(dir);
    expect(r.state.kind).toBe("repo");
    const files = r.status!.files;
    expect(files.find((f) => f.path === "src/a.ts")).toMatchObject({
      status: "modified",
      staged: false,
      additions: 1,
      deletions: 1,
    });
    expect(files.find((f) => f.path === "src/new.ts")).toMatchObject({ status: "untracked", staged: false });
    expect(files.find((f) => f.path === "docs/keep.md")).toMatchObject({ staged: true, additions: 1 });
    expect(r.status!.branch.branch).toBe("main");
  });

  it("scopes to the workspace subtree when the workspace is a subdirectory", async () => {
    makeRepo(dir);
    const sub = path.join(dir, "src");
    invalidateProbe(sub);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "changed\n");
    fs.writeFileSync(path.join(dir, "docs/keep.md"), "changed outside the workspace\n");

    const r = await gitStatus(sub);
    const paths = r.status!.files.map((f) => f.path);
    expect(paths).toContain("src/a.ts");
    // The whole point of §5c: a file above the workspace is never listed, because
    // every other part of the app refuses to touch it.
    expect(paths).not.toContain("docs/keep.md");
  });
});

describe.skipIf(!GIT_OK)("the unborn flag tracks reality, not the cache", () => {
  it("stops reporting unborn once the first commit lands", async () => {
    // Found in the GUI, not by a test: the probe caches root/subdir (which never
    // move) and used to cache `unborn` with them — so after the on-ramp's first
    // commit the panel still said "nothing here yet", History stayed hidden and
    // the base-branch baseline never appeared. `unborn` now comes from the LIVE
    // porcelain (`# branch.oid (initial)` → a null oid).
    run(dir, ["init", "-q", "-b", "main", "."]);
    run(dir, ["config", "user.email", "t@example.com"]);
    run(dir, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    invalidateProbe(dir);

    const before = await gitStatus(dir);
    if (before.state.kind !== "repo") throw new Error("expected repo");
    expect(before.state.unborn).toBe(true);

    expect((await saveVersion(dir, "first", { stagedOnly: false, amend: false })).ok).toBe(true);

    // NO invalidateProbe here — that is the whole point.
    const after = await gitStatus(dir);
    if (after.state.kind !== "repo") throw new Error("expected repo");
    expect(after.state.unborn).toBe(false);
    expect(await gitHistory(dir, 5)).toHaveLength(1);
  });
});

describe.skipIf(!GIT_OK)("gitDiff", () => {
  it("diffs the working tree against HEAD", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
    const files = await gitDiff(dir, "head");
    expect(files.map((f) => f.path)).toContain("src/a.ts");
    expect(files.find((f) => f.path === "src/a.ts")!.hunks.length).toBeGreaterThan(0);
  });

  it("reads every file as an addition in an unborn repo (§5d — the empty tree)", async () => {
    run(dir, ["init", "-q", "-b", "main", "."]);
    run(dir, ["config", "user.email", "t@example.com"]);
    run(dir, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(dir, "fresh.txt"), "hello\nworld\n");
    run(dir, ["add", "-A"]);
    invalidateProbe(dir);

    const files = await gitDiff(dir, "head");
    const fresh = files.find((f) => f.path === "fresh.txt");
    expect(fresh, "unborn HEAD must still produce a diff").toBeTruthy();
    expect(fresh!.hunks[0].lines.every((l) => l.startsWith("+"))).toBe(true);
  });
});

describe.skipIf(!GIT_OK)("saveVersion", () => {
  it("commits UNTRACKED files too — add -A, never commit -a", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/new.ts"), "brand new\n");

    const r = await saveVersion(dir, "add the new file", { stagedOnly: false, amend: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // `git commit -a` would have skipped this file entirely — and the on-ramp's
    // first save happens when EVERY file is untracked.
    const tracked = run(dir, ["ls-tree", "--name-only", "-r", "HEAD"]);
    expect(tracked).toContain("src/new.ts");
    expect((await gitStatus(dir)).status!.files).toHaveLength(0);
  });

  it("commits only the staged set when asked", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "staged change\n");
    fs.writeFileSync(path.join(dir, "docs/keep.md"), "unstaged change\n");
    run(dir, ["add", "src/a.ts"]);

    const r = await saveVersion(dir, "only the staged one", { stagedOnly: true, amend: false });
    expect(r.ok).toBe(true);
    const remaining = (await gitStatus(dir)).status!.files.map((f) => f.path);
    expect(remaining).toEqual(["docs/keep.md"]);
  });

  it("refuses with git's own message rather than throwing", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const r = await saveVersion(dir, "nothing to do", { stagedOnly: true, amend: false });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!GIT_OK)("undoHunk — the round trip that makes per-hunk undo honest", () => {
  it("reverse-applies exactly one hunk and leaves the other alone", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const file = path.join(dir, "src/a.ts");
    // Two changes far enough apart that git emits two separate hunks.
    fs.writeFileSync(file, "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n");

    const diff = await gitDiff(dir, "head");
    const fd = diff.find((f) => f.path === "src/a.ts")!;
    expect(fd.hunks.length, "need two hunks for this test to mean anything").toBe(2);

    const r = await undoHunk(dir, hunkPatch(fd, fd.hunks[0]));
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const after = fs.readFileSync(file, "utf8");
    expect(after.startsWith("one\n")).toBe(true); // first hunk undone
    expect(after.trimEnd().endsWith("TEN")).toBe(true); // second hunk untouched
  });

  it("reverse-applies the LAST hunk of a file", async () => {
    // Regression: the parser used to keep the empty string left by the trailing
    // newline, which became a phantom context line on the final hunk — so the
    // patch no longer described the file and every last-hunk undo refused as
    // "stale". It hid because a test that undoes hunk[0] never sees it.
    makeRepo(dir);
    invalidateProbe(dir);
    const file = path.join(dir, "src/a.ts");
    fs.writeFileSync(file, "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n");

    const fd = (await gitDiff(dir, "head")).find((f) => f.path === "src/a.ts")!;
    const last = fd.hunks[fd.hunks.length - 1];
    const r = await undoHunk(dir, hunkPatch(fd, last));
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const after = fs.readFileSync(file, "utf8");
    expect(after.trimEnd().endsWith("ten")).toBe(true); // last hunk undone
    expect(after.startsWith("ONE\n")).toBe(true); // first hunk untouched
  });

  it("round-trips a file with no trailing newline", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const file = path.join(dir, "src/nonl.ts");
    fs.writeFileSync(file, "first\nsecond"); // deliberately unterminated
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "add unterminated file"]);
    fs.writeFileSync(file, "first\nCHANGED");

    const fd = (await gitDiff(dir, "head")).find((f) => f.path === "src/nonl.ts")!;
    const r = await undoHunk(dir, hunkPatch(fd, fd.hunks[0]));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("first\nsecond");
  });

  it("REFUSES a stale patch and leaves the file byte-identical", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const file = path.join(dir, "src/a.ts");
    fs.writeFileSync(file, "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
    const fd = (await gitDiff(dir, "head")).find((f) => f.path === "src/a.ts")!;
    const patch = hunkPatch(fd, fd.hunks[0]);

    // Someone else edits the same region — a parallel session, the editor, a
    // terminal. The patch we computed no longer describes the file.
    const meddled = "COMPLETELY\nDIFFERENT\nCONTENT\n";
    fs.writeFileSync(file, meddled);

    const r = await undoHunk(dir, patch);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.stale).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(meddled); // never overwritten
  });
});

describe.skipIf(!GIT_OK)("undoFile and discardUntracked", () => {
  it("restores a tracked file to HEAD", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    const file = path.join(dir, "src/a.ts");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "wrecked\n");
    run(dir, ["add", "src/a.ts"]); // staged too — undo file must clear both halves

    expect((await undoFile(dir, "src/a.ts")).ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("deletes an untracked file and refuses to escape the workspace", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/new.ts"), "brand new\n");
    expect((await discardUntracked(dir, "src/new.ts")).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/new.ts"))).toBe(false);

    const escape = await discardUntracked(dir, "../escape.txt");
    expect(escape.ok).toBe(false);
  });
});

describe.skipIf(!GIT_OK)("switchBranch", () => {
  it("takes clean changes along when nothing conflicts", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["branch", "other"]);
    fs.writeFileSync(path.join(dir, "src/untouched-elsewhere.ts"), "local work\n");

    const r = await switchBranch(dir, "other", { create: false, mode: "take" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "src/untouched-elsewhere.ts"), "utf8")).toBe("local work\n");
  });

  it("reports wouldConflict instead of destroying local work", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "other"]);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "other branch version\n");
    run(dir, ["commit", "-qam", "diverge"]);
    run(dir, ["checkout", "-q", "main"]);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "my uncommitted work\n");

    const r = await switchBranch(dir, "other", { create: false, mode: "take" });
    expect(r.ok).toBe(false);
    expect(r.wouldConflict).toBe(true);
    expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe("my uncommitted work\n");
  });

  it("stashes first when asked, and lists the stash", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "other"]);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "other branch version\n");
    run(dir, ["commit", "-qam", "diverge"]);
    run(dir, ["checkout", "-q", "main"]);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "my uncommitted work\n");

    const r = await switchBranch(dir, "other", { create: false, mode: "stash" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const s = await gitStatus(dir);
    expect(s.stashes!.length).toBe(1);
  });

  it("creates a branch and lists branches", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    expect((await switchBranch(dir, "feature/x", { create: true, mode: "take" })).ok).toBe(true);
    expect(await listBranches(dir)).toContain("feature/x");
  });
});

describe.skipIf(!GIT_OK)("deleteBranch", () => {
  it("deletes a merged branch", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["branch", "spare"]);

    expect((await deleteBranch(dir, "spare")).ok).toBe(true);
    expect(await listBranches(dir)).not.toContain("spare");
  });

  it("REFUSES a branch holding work no other branch has, and says why", async () => {
    // The whole safety story: `-d` is git's own reachability check, which knows
    // more than any test we could write here. Force must stay opt-in.
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "solo"]);
    fs.writeFileSync(path.join(dir, "src/solo.ts"), "only here\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "solo work"]);
    run(dir, ["checkout", "-q", "main"]);

    const r = await deleteBranch(dir, "solo");
    expect(r.ok).toBe(false);
    expect(r.unmerged).toBe(true);
    expect(await listBranches(dir)).toContain("solo");
  });

  it("force deletes the same branch when explicitly asked", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "solo"]);
    fs.writeFileSync(path.join(dir, "src/solo.ts"), "only here\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "solo work"]);
    run(dir, ["checkout", "-q", "main"]);

    expect((await deleteBranch(dir, "solo", true)).ok).toBe(true);
    expect(await listBranches(dir)).not.toContain("solo");
  });

  it("refuses the checked-out branch without an unmerged flag", async () => {
    // The renderer hides the control here, but the guard must not depend on
    // that: git's refusal is a plain error, NOT the force-able kind.
    makeRepo(dir);
    invalidateProbe(dir);
    const r = await deleteBranch(dir, "main");
    expect(r.ok).toBe(false);
    expect(r.unmerged).toBeUndefined();
    expect(await listBranches(dir)).toContain("main");
  });

  it("leaves the working tree alone", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["branch", "spare"]);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "uncommitted work\n");

    expect((await deleteBranch(dir, "spare")).ok).toBe(true);
    // This is why deletion is NOT behind the idle gate: it cannot disturb a
    // session working in the tree.
    expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe("uncommitted work\n");
  });
});

describe.skipIf(!GIT_OK)("stash", () => {
  it("saves, lists and pops", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "work in progress\n");

    expect((await stash(dir, "save")).ok).toBe(true);
    expect((await gitStatus(dir)).status!.files).toHaveLength(0);

    expect((await stash(dir, "pop", 0)).ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe("work in progress\n");
  });
});

describe.skipIf(!GIT_OK)("gitHistory", () => {
  it("reads recent subjects newest first", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "docs/keep.md"), "second\n");
    await saveVersion(dir, "fix(docs): the second commit", { stagedOnly: false, amend: false });

    const log = await gitHistory(dir, 10);
    expect(log[0].subject).toBe("fix(docs): the second commit");
    expect(log[1].subject).toBe("init");
  });
});

describe.skipIf(!GIT_OK)("stageFile", () => {
  it("stages and unstages one path", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "changed\n");

    await stageFile(dir, "src/a.ts", true);
    expect((await gitStatus(dir)).status!.files.find((f) => f.path === "src/a.ts")!.staged).toBe(true);

    await stageFile(dir, "src/a.ts", false);
    expect((await gitStatus(dir)).status!.files.find((f) => f.path === "src/a.ts")!.staged).toBe(false);
  });
});

describe.skipIf(!GIT_OK)("the init on-ramp (§5b)", () => {
  it("previews a branch name and a gitignore derived from what is actually there", async () => {
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/index.ts"), "x\n");

    const p = await initPreview(dir);
    expect(p.refused).toBeNull();
    expect(p.branch.length).toBeGreaterThan(0);
    expect(p.gitignore).toContain("node_modules");
    // Only what is present — a starter gitignore listing dirs that do not exist
    // is noise the user has to read past.
    expect(p.gitignore).not.toContain("__pycache__");
  });

  it("REFUSES the home directory and the filesystem root", async () => {
    expect((await initPreview(os.homedir())).refused).toBeTruthy();
    expect((await initPreview("/")).refused).toBeTruthy();
  });

  it("inits WITHOUT committing, so the first save belongs to the user", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    const p = await initPreview(dir);
    expect((await initRepo(dir, p.gitignore)).ok).toBe(true);

    const s = await gitStatus(dir);
    if (s.state.kind !== "repo") throw new Error(`expected repo, got ${s.state.kind}`);
    expect(s.state.unborn, "init must leave HEAD unborn — no auto-commit").toBe(true);
    expect(s.status!.files.every((f) => f.status === "untracked")).toBe(true);
    expect(s.status!.files.map((f) => f.path)).toContain("a.txt");
  });
});

describe.skipIf(!GIT_OK)("detectJunk and appendGitignore", () => {
  it("names junk directories present in the save set", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/x.js"), "junk\n");
    fs.writeFileSync(path.join(dir, "src/new.ts"), "real work\n");

    const files = (await gitStatus(dir)).status!.files;
    expect(detectJunk(files)).toEqual(["node_modules"]);
  });

  it("catches junk nested inside a monorepo package, not just at the root", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.mkdirSync(path.join(dir, "packages/web/node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, "packages/web/node_modules/x.js"), "junk\n");

    // Matching only the first path segment would wave this through in exactly
    // the repos that have the most of it.
    expect(detectJunk((await gitStatus(dir)).status!.files)).toEqual(["node_modules"]);
  });

  it("finds nothing to complain about in a clean set", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    fs.writeFileSync(path.join(dir, "src/new.ts"), "real work\n");
    expect(detectJunk((await gitStatus(dir)).status!.files)).toEqual([]);
  });

  it("appends to an existing .gitignore without dropping what was there", async () => {
    makeRepo(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "existing-entry\n");
    await appendGitignore(dir, ["node_modules"]);
    const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(text).toContain("existing-entry");
    expect(text).toContain("node_modules");
  });

  it("exports a junk list that includes the usual suspects", () => {
    expect(JUNK_DIRS).toContain("node_modules");
    expect(JUNK_DIRS).toContain("dist");
    expect(JUNK_DIRS).toContain("__pycache__");
  });
});

describe.skipIf(!GIT_OK)("remoteUrl and branchCommits (§29 §7)", () => {
  it("reads origin, and answers null when there is no remote", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    expect(await remoteUrl(dir)).toBeNull();

    run(dir, ["remote", "add", "origin", "https://example.com/o/r.git"]);
    expect(await remoteUrl(dir)).toBe("https://example.com/o/r.git");
  });

  it("lists only the commits this branch adds over the base", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "feature"]);
    fs.writeFileSync(path.join(dir, "one.txt"), "1\n");
    await saveVersion(dir, "feat: the first thing", { stagedOnly: false, amend: false });
    fs.writeFileSync(path.join(dir, "two.txt"), "2\n");
    await saveVersion(dir, "feat: the second thing", { stagedOnly: false, amend: false });

    // Newest first, and "init" (which main already has) is NOT included — a PR
    // body listing commits the base already has would describe the wrong change.
    expect(await branchCommits(dir, "main")).toEqual(["feat: the second thing", "feat: the first thing"]);
  });

  it("is empty on a branch that adds nothing", async () => {
    makeRepo(dir);
    invalidateProbe(dir);
    run(dir, ["checkout", "-q", "-b", "idle"]);
    expect(await branchCommits(dir, "main")).toEqual([]);
  });
});
