import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitFingerprint } from "../src/main/gitWatch";

const HAVE_GIT = ((): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * §29 worktrees — the sidebar learns about a worktree made in an outside
 * terminal through this fingerprint and nothing else. HEAD and the index are
 * both untouched by `worktree add`, so without the third component the row
 * would not appear until the app restarted.
 */
describe.skipIf(!HAVE_GIT)("gitFingerprint", () => {
  it("changes when a worktree is added and HEAD/index did not move", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitwatch-"));
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

    const gitPath = path.join(m, ".git");
    const head = fs.readFileSync(path.join(gitPath, "HEAD"), "utf8");
    const before = gitFingerprint(gitPath);

    git(m, "worktree", "add", "-q", path.join(root, "wt"), "-b", "side");

    expect(fs.readFileSync(path.join(gitPath, "HEAD"), "utf8")).toBe(head); // HEAD did not move
    expect(gitFingerprint(gitPath)).not.toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a repo with no worktrees still fingerprints, and twice the same", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitwatch2-"));
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
    const p = path.join(root, ".git");
    expect(gitFingerprint(p)).toBe(gitFingerprint(p));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
