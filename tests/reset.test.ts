import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { appWorktrees, markForReset, removeAppWorktrees, resetBlockers, wipeIfMarked, RESET_MARKER } from "../src/main/reset";

// §17 round 25 — Clear all data.
const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, encoding: "utf8" });
function repoWithWorktree(): { agentDir: string; repo: string; wt: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-reset-")));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  const agentDir = path.join(root, "userData", "pi-agent");
  const wt = path.join(agentDir, "worktrees", "proj", "feat");
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", "feat", wt);
  return { agentDir, repo, wt };
}

describe("app-data worktrees", () => {
  test("found by scanning the folder, not the workspace index", () => {
    const { agentDir, wt } = repoWithWorktree();
    expect(appWorktrees(agentDir)).toEqual([wt]);
  });
  test("none when the folder doesn't exist", () => {
    expect(appWorktrees(path.join(os.tmpdir(), "nope-" + Date.now()))).toEqual([]);
  });
  test("a dirty worktree blocks the reset and is named", async () => {
    const { agentDir, wt } = repoWithWorktree();
    fs.writeFileSync(path.join(wt, "draft.txt"), "unsaved");
    expect((await resetBlockers(agentDir)).map((b) => b.path)).toEqual([wt]);
  });
  test("a clean one is removed through git: folder gone, repo entry gone, branch kept", async () => {
    const { agentDir, repo, wt } = repoWithWorktree();
    expect(await resetBlockers(agentDir)).toEqual([]);
    expect(await removeAppWorktrees(agentDir)).toEqual([]);
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain(wt);
    expect(git(repo, "branch", "--list", "feat")).toContain("feat");
  });
  test("a worktree whose repo can't be found BLOCKS — its files may hold unsaved work (review I1)", async () => {
    const { agentDir, repo, wt } = repoWithWorktree();
    fs.rmSync(repo, { recursive: true, force: true }); // moved, renamed, or on an unplugged drive
    const b = await resetBlockers(agentDir);
    expect(b.map((x) => x.path)).toEqual([wt]);
    expect(b[0].reason).toMatch(/project can.t be found/);
  });
});

describe("boot wipe", () => {
  test("one undeletable entry doesn't stop the rest, and the marker still goes (review I2)", () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ud-"));
    const locked = path.join(ud, "locked");
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, "held.txt"), "x");
    fs.chmodSync(locked, 0o500); // its child can't be unlinked — stands in for Windows EBUSY
    fs.writeFileSync(path.join(ud, "zz-config.json"), "{}");
    markForReset(ud);
    try {
      expect(wipeIfMarked(ud)).toBe(true);
      expect(fs.existsSync(path.join(ud, "zz-config.json"))).toBe(false);
      expect(fs.existsSync(path.join(ud, RESET_MARKER))).toBe(false); // a later boot never wipes again
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
  test("does nothing without the marker", () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ud-"));
    fs.writeFileSync(path.join(ud, "config.json"), "{}");
    expect(wipeIfMarked(ud)).toBe(false);
    expect(fs.existsSync(path.join(ud, "config.json"))).toBe(true);
  });
  test("removes everything, marker included, when marked", () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ud-"));
    fs.mkdirSync(path.join(ud, "pi-agent"), { recursive: true });
    fs.writeFileSync(path.join(ud, "pi-agent", "mcp-auth.json"), "{}");
    markForReset(ud);
    expect(fs.existsSync(path.join(ud, RESET_MARKER))).toBe(true);
    expect(wipeIfMarked(ud)).toBe(true);
    expect(fs.readdirSync(ud)).toEqual([]);
  });
});

const src = (f: string): string => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("wiring", () => {
  test("the boot wipe runs before anything reads userData (crash queue, config)", () => {
    const idx = src("src/main/index.ts");
    expect(idx.indexOf("wipeIfMarked(")).toBeGreaterThan(-1);
    expect(idx.indexOf("wipeIfMarked(")).toBeLessThan(idx.indexOf("installCrash("));
  });
  test("HV_USER_DATA isolates a test run (a reset must never be GUI-tested on real data)", () => {
    expect(src("src/main/index.ts")).toContain("process.env.HV_USER_DATA");
  });
  test("resetAll re-checks blockers itself — never trusts the dialog's earlier answer", () => {
    const ipc = src("src/main/ipc.ts");
    const h = ipc.slice(ipc.indexOf('"hv:reset-all"'), ipc.indexOf('"hv:reset-all"') + 900);
    expect(h).toContain("resetBlockers(");
    expect(h).toContain("app.relaunch()");
  });
  test("before removing worktrees: sessions AND their terminals stop (a shell's cwd locks the folder on Windows; review I3)", () => {
    const ipc = src("src/main/ipc.ts");
    const h = ipc.slice(ipc.indexOf('"hv:reset-all"'), ipc.indexOf('"hv:reset-all"') + 1200);
    expect(h).toContain('endSession(s.id, "stop")');
    expect(h.indexOf("terminals.killAll()")).toBeGreaterThan(-1);
    expect(h.indexOf("terminals.killAll()")).toBeLessThan(h.indexOf("removeAppWorktrees("));
  });
  test("a refusal from git says so — never 'unsaved work' or 'Nothing was deleted'", () => {
    const ipc = src("src/main/ipc.ts");
    const h = ipc.slice(ipc.indexOf('"hv:reset-all"'), ipc.indexOf('"hv:reset-all"') + 1200);
    expect(h).toContain("removed: true");
    expect(src("src/renderer/src/components/PrivacyView.tsx")).toContain("Some worktrees couldn't be removed");
  });
  test("the dialog names the project folders it leaves alone", () => {
    const pv = src("src/renderer/src/components/PrivacyView.tsx");
    expect(pv).toContain(".pi-subagents/");
    expect(pv).toContain(".agents/plans/");
  });
});
