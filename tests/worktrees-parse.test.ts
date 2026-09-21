import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorktreeList } from "../src/main/gitParse";

/**
 * Captured from git 2.50.1 (Apple Git-155) on 2026-09-20 against a throwaway repo:
 * one linked worktree, locked; one detached worktree whose folder was then deleted
 * (so git reports it prunable). Paths shortened, nothing else edited.
 */
const PORCELAIN = `worktree /tmp/x/m
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/main

worktree /tmp/x/det
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
detached
prunable gitdir file points to non-existent location

worktree /tmp/x/wt
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/side
locked

`;

describe("parseWorktreeList", () => {
  it("reads the three record shapes: branch, detached+prunable, locked", () => {
    const e = parseWorktreeList(PORCELAIN);
    expect(e.map((x) => x.path)).toEqual(["/tmp/x/m", "/tmp/x/det", "/tmp/x/wt"]);
    expect(e[0]).toMatchObject({ branch: "main", locked: false, prunable: false, bare: false });
    expect(e[1]).toMatchObject({ branch: null, prunable: true });
    expect(e[2]).toMatchObject({ branch: "side", locked: true });
    expect(e[0].head).toBe("9d40ce9b2216ab451bfab39e89ec843f48049c4e");
  });

  it("empty output is an empty list", () => {
    expect(parseWorktreeList("")).toEqual([]);
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

/**
 * Contract: the installed git still speaks the keys we parse. A future git that
 * renames `prunable` fails HERE, not as a sidebar row that silently stays clickable.
 */
describe.skipIf(!HAVE_GIT)("git worktree list --porcelain contract", () => {
  it("every key in live output is one we know, and the three states round-trip", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-parse-"));
    const git = (cwd: string, ...a: string[]): string =>
      execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf8" });
    const m = path.join(root, "m");
    fs.mkdirSync(m);
    git(m, "init", "-q");
    git(m, "config", "user.email", "t@x");
    git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a");
    git(m, "add", "-A");
    git(m, "commit", "-qm", "i");
    git(m, "worktree", "add", "-q", path.join(root, "wt"), "-b", "side");
    git(m, "worktree", "add", "-q", "--detach", path.join(root, "det"));
    git(m, "worktree", "lock", path.join(root, "wt"));
    fs.rmSync(path.join(root, "det"), { recursive: true, force: true });

    const out = git(m, "worktree", "list", "--porcelain");
    const keys = new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]));
    for (const k of keys) {
      expect(["worktree", "HEAD", "branch", "detached", "bare", "locked", "prunable"]).toContain(k);
    }
    const e = parseWorktreeList(out);
    expect(e.find((x) => x.branch === "side")?.locked).toBe(true);
    expect(e.find((x) => x.branch === null)?.prunable).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
