import fs from "node:fs";
import path from "node:path";
import { removeWorktree, run } from "./git";

/**
 * §17 round 25 — Clear all data. Two halves on purpose: the worktree checkouts go
 * NOW, through git, while the repos can still be told (so no stale entry is left
 * in them); everything else goes at the next BOOT, before anything opens a file
 * in userData, because a running Chromium holds its storage open.
 */
export const RESET_MARKER = ".hv-reset";

/** `<agentDir>/worktrees/<projectKey>/<slug>` — the folder IS the list (a removed workspace's worktrees too). */
export function appWorktrees(agentDir: string): string[] {
  const dirs = (p: string): string[] => {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(p, d.name));
    } catch {
      return [];
    }
  };
  return dirs(path.join(agentDir, "worktrees")).flatMap(dirs);
}

/** The main repo a linked worktree belongs to, or null when that repo is gone. */
async function repoOf(wt: string): Promise<string | null> {
  const r = await run(wt, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!r.ok) return null;
  const common = r.stdout.trim();
  return fs.existsSync(common) ? path.dirname(common) : null;
}

/** Worktrees whose uncommitted work a reset would destroy. Read-only. */
export async function resetBlockers(agentDir: string): Promise<Array<{ path: string; reason: string }>> {
  const out: Array<{ path: string; reason: string }> = [];
  for (const wt of appWorktrees(agentDir)) {
    // A repo that can't be found may be moved, renamed or on an unplugged drive —
    // its working files can still hold unsaved work, so they are never wiped unnamed.
    if (!(await repoOf(wt))) {
      out.push({ path: wt, reason: "its project can't be found — move this folder somewhere safe or delete it, then try again" });
      continue;
    }
    const s = await run(wt, ["status", "--porcelain"]);
    if (s.ok && s.stdout.trim()) out.push({ path: wt, reason: "has uncommitted changes" });
  }
  return out;
}

/** Removes each app worktree through git; returns git's refusals (empty = all gone). */
export async function removeAppWorktrees(agentDir: string): Promise<Array<{ path: string; reason: string }>> {
  const refused: Array<{ path: string; reason: string }> = [];
  for (const wt of appWorktrees(agentDir)) {
    const repo = await repoOf(wt);
    if (!repo) continue; // unreachable after resetBlockers; left for the boot wipe
    // No force: git refuses a dirty or locked tree itself — the second safety net.
    const r = await removeWorktree(repo, wt);
    if (!r.ok) refused.push({ path: wt, reason: r.error });
  }
  return refused;
}

export function markForReset(userData: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, RESET_MARKER), new Date().toISOString());
}

/**
 * Runs before anything reads userData. ONE pass: each entry is retried briefly
 * (a lingering process can hold a file on Windows) and a failure is skipped, never
 * fatal; then the marker goes regardless, so a later boot can't wipe a profile the
 * user has already set up again.
 */
export function wipeIfMarked(userData: string): boolean {
  const marker = path.join(userData, RESET_MARKER);
  if (!fs.existsSync(marker)) return false;
  for (const name of fs.readdirSync(userData)) {
    if (name === RESET_MARKER) continue;
    try {
      fs.rmSync(path.join(userData, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* skipped: a leftover file is better than a second wipe later */
    }
  }
  fs.rmSync(marker, { force: true });
  return true;
}
