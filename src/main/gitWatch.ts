import fs from "node:fs";
import path from "node:path";

/**
 * §1b — a tiny non-recursive watch on `<workspace>/.git`.
 *
 * Necessary rather than nice: the file-tree watcher (watch.ts) deliberately
 * FILTERS `.git` through isVisibleEntry, so nothing in the app would otherwise
 * notice a branch switched in an outside terminal, and the sidebar's `⎇ main`
 * would sit stale forever.
 *
 * **Why this fingerprints instead of filtering by filename.** The obvious build
 * — watch `.git` non-recursively, act only on events named HEAD or index — does
 * not work on macOS, measured rather than assumed: writing a file three levels
 * down in `.git/objects/ab/` reports THREE events, `change ".git"`,
 * `rename "objects"` and `rename "HEAD"`. That last one is a lie, and it is the
 * one a name filter lets through, so a single commit's object churn would
 * trigger a `git status` per object — the exact stampede the filter was meant to
 * prevent. So every event is debounced down to one check of what actually
 * matters: the contents of HEAD (which branch) and the mtime+size of the index
 * (what is staged). Unchanged fingerprint, no callback.
 */

interface GitWatch {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
  fingerprint: string;
}

const watches = new Map<string, GitWatch>();

const DEBOUNCE_MS = 120;

/**
 * Cheap and exact: HEAD is one short line naming the branch, and the index's
 * mtime+size moves whenever the staged set does. Reading the index itself would
 * mean hashing a file that is megabytes in a large repo, for no extra signal.
 */
function fingerprint(gitPath: string): string {
  let head = "";
  try {
    head = fs.readFileSync(path.join(gitPath, "HEAD"), "utf8").trim();
  } catch {
    head = "";
  }
  let index = "";
  try {
    const s = fs.statSync(path.join(gitPath, "index"));
    index = `${s.mtimeMs}:${s.size}`;
  } catch {
    index = "";
  }
  return `${head}|${index}`;
}

/**
 * Watch a workspace's `.git`. Idempotent: a repeat call for the same workspace
 * keeps the existing watcher (and its original callback), so two consumers never
 * produce two callbacks for one change.
 */
export function watchGitDir(workspace: string, onChange: () => void): void {
  if (watches.has(workspace)) return;

  const gitPath = path.join(workspace, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(gitPath);
  } catch {
    return; // not a repo, or one we cannot see — §5's job, not the watcher's
  }
  // A `.git` FILE is a submodule or a linked worktree: the real directory is
  // elsewhere, so there is nothing here to watch. The panel still works — the
  // probe asks git rather than sniffing — it just refreshes on the other seams.
  if (!stat.isDirectory()) return;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(gitPath, { recursive: false });
  } catch {
    return; // watching unsupported here; the fs watcher and turn-end still refresh
  }

  const w: GitWatch = { watcher, timer: null, fingerprint: fingerprint(gitPath) };
  watches.set(workspace, w);

  watcher.on("error", () => unwatchGit(workspace));
  watcher.on("change", () => {
    if (w.timer) return;
    w.timer = setTimeout(() => {
      w.timer = null;
      const next = fingerprint(gitPath);
      if (next === w.fingerprint) return; // object churn, packing, a gc — not our business
      w.fingerprint = next;
      onChange();
    }, DEBOUNCE_MS);
  });
}

export function unwatchGit(workspace: string): void {
  const w = watches.get(workspace);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  w.watcher.close();
  watches.delete(workspace);
}

export function unwatchAllGit(): void {
  for (const [ws] of watches) unwatchGit(ws);
}
