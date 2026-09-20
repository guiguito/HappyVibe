import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listWorktrees, resetGitAvailability } from "../src/main/git";
import type { WorktreeEntry } from "../src/main/gitParse";
import { worktreeSlug } from "../src/main/worktreeSlug";
import { WorktreeIndex, sessionsOfProject, worktreeDir } from "../src/main/worktrees";
import type { SessionMeta } from "../src/main/store";

const entry = (
  p: string,
  branch: string | null = "b",
  extra: Partial<Pick<WorktreeEntry, "prunable" | "locked">> = {},
): WorktreeEntry => ({
  path: p,
  head: "abc",
  branch,
  bare: false,
  locked: false,
  prunable: false,
  ...extra,
});

describe("worktreeSlug", () => {
  it("folds separators and punctuation, trims, caps at 64", () => {
    expect(worktreeSlug("feat/log in!")).toBe("feat-log-in");
    expect(worktreeSlug("a".repeat(80))).toHaveLength(64);
    expect(worktreeSlug("///")).toBe("worktree");
  });
});

describe("worktreeSlug.ts is import-free", () => {
  it("has no import statement — the renderer bundles it", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/main/worktreeSlug.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import /m);
  });
});

describe("WorktreeIndex", () => {
  const registered = ["/p/main", "/p/orca-wt"];
  const idx = new WorktreeIndex(() => registered);
  idx.set("/p/main", [entry("/p/orca-wt", "orca"), entry("/p/wt1", "feat"), entry("/p/gone", null, { prunable: true })]);

  it("of(parent) drops a registered path — the registered path wins", () => {
    expect(idx.of("/p/main").map((w) => w.path)).toEqual(["/p/wt1", "/p/gone"]);
  });

  it("parentOf routes only UNREGISTERED worktrees", () => {
    expect(idx.parentOf("/p/wt1")).toBe("/p/main");
    expect(idx.parentOf("/p/orca-wt")).toBeNull();
    expect(idx.parentOf("/p/main")).toBeNull();
    expect(idx.projectOf("/p/wt1")).toBe("/p/main");
    expect(idx.projectOf("/p/orca-wt")).toBe("/p/orca-wt");
  });

  it("roots() = registered ∪ unregistered worktrees that still have a folder", () => {
    expect(idx.roots()).toEqual(["/p/main", "/p/orca-wt", "/p/wt1"]);
  });

  it("set() reports change, remove() forgets a parent", () => {
    const i2 = new WorktreeIndex(() => ["/a"]);
    expect(i2.set("/a", [entry("/a-wt")])).toBe(true);
    expect(i2.set("/a", [entry("/a-wt")])).toBe(false);
    i2.remove("/a");
    expect(i2.of("/a")).toEqual([]);
    expect(i2.all()).toEqual({});
  });
});

describe("sessionsOfProject", () => {
  const s = (id: string, ws: string): SessionMeta =>
    ({ id, workspaceId: ws, createdAt: "", updatedAt: "" }) as unknown as SessionMeta;

  it("includes the parent's and each worktree's sessions, nothing else", () => {
    const all = [s("1", "/p/main"), s("2", "/p/wt1"), s("3", "/other")];
    expect(sessionsOfProject(all, "/p/main", ["/p/wt1"]).map((x) => x.id)).toEqual(["1", "2"]);
  });
});

describe("worktreeDir", () => {
  it("is <agentDir>/worktrees/<key>/<slug>", () => {
    expect(worktreeDir("/ad", "k1", "feat-x")).toBe(path.join("/ad", "worktrees", "k1", "feat-x"));
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

describe.skipIf(!HAVE_GIT)("listWorktrees over a real repo", () => {
  it("drops the main worktree, keeps the linked one, resolves paths", async () => {
    resetGitAvailability();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-list-"));
    const git = (cwd: string, ...a: string[]): void => {
      execFileSync("git", a, { cwd, stdio: "pipe" });
    };
    const m = path.join(root, "m");
    fs.mkdirSync(m);
    git(m, "init", "-q");
    git(m, "config", "user.email", "t@x");
    git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a");
    git(m, "add", "-A");
    git(m, "commit", "-qm", "i");
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");

    const list = await listWorktrees(m);
    expect(list.map((e) => e.branch)).toEqual(["side"]);
    expect(fs.realpathSync(list[0].path)).toBe(fs.realpathSync(wt));

    // Asked from a WORKTREE — which happens when the user registered one as a
    // workspace of its own (the Orca / Claude Code shape) — BOTH the main
    // checkout and the caller itself are dropped. The main checkout is the
    // project and must never appear as somebody's child; a row must never list
    // itself. Here that leaves nothing.
    expect(await listWorktrees(wt)).toEqual([]);
    const second = path.join(root, "wt2");
    git(m, "worktree", "add", "-q", second, "-b", "other");
    expect((await listWorktrees(wt)).map((e) => e.branch)).toEqual(["other"]);

    // Not a repo at all: an empty list, never a throw (§29 — git is a feature).
    expect(await listWorktrees(path.join(root, "not-a-repo"))).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
