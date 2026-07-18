import fs from "node:fs";
import path from "node:path";
import { isVisibleEntry } from "./files";

/**
 * WS8: native filesystem watching for the file tree — auto-refresh instead of a
 * manual refresh button. One recursive fs.watch per workspace with an open tree
 * (macOS FSEvents / Windows ReadDirectoryChangesW support `recursive` natively).
 *
 * ponytail: recursive fs.watch is NOT supported on Linux — there we'd need a
 * per-dir watcher fan-out; the app is macOS-first so we accept that ceiling and
 * fall back to no watcher (the renderer keeps a manual refresh path on error).
 *
 * Events are debounced and reported as the parent directory (workspace-relative)
 * that changed; the renderer re-lists that dir if it's expanded.
 */

interface Watch {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
  pending: Set<string>;
  refs: number;
}

const watches = new Map<string, Watch>();

const DEBOUNCE_MS = 150;

/**
 * Start a recursive watch on a workspace root (refcounted). F6: the tree AND
 * open editor tabs both want the watch, and each may come and go independently,
 * so we keep one FSWatcher per workspace alive until the last watcher releases
 * it. The onChange callback is the same broadcast for every caller, so a repeat
 * start keeps the existing one.
 */
export function watchWorkspace(workspaceId: string, onChange: (relDirs: string[]) => void): void {
  const existing = watches.get(workspaceId);
  if (existing) { existing.refs++; return; }
  const root = path.resolve(workspaceId);
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true });
  } catch {
    return; // watching unsupported (e.g. Linux recursive) — renderer keeps manual refresh
  }
  const w: Watch = { watcher, timer: null, pending: new Set(), refs: 1 };
  watches.set(workspaceId, w);
  watcher.on("error", () => unwatchWorkspace(workspaceId));
  watcher.on("change", (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    // Ignore churn in ignored trees (node_modules/.git) — matches the tree filter.
    const segs = rel.split(path.sep);
    if (segs.some((s) => !isVisibleEntry(s))) return;
    w.pending.add(segs.slice(0, -1).join("/")); // parent dir, workspace-relative ("" = root)
    if (w.timer) return;
    w.timer = setTimeout(() => {
      const dirs = [...w.pending];
      w.pending.clear();
      w.timer = null;
      onChange(dirs);
    }, DEBOUNCE_MS);
  });
}

export function unwatchWorkspace(workspaceId: string): void {
  const w = watches.get(workspaceId);
  if (!w) return;
  if (--w.refs > 0) return; // still referenced (e.g. tree closed but a tab is open)
  if (w.timer) clearTimeout(w.timer);
  w.watcher.close();
  watches.delete(workspaceId);
}

export function unwatchAll(): void {
  for (const [, w] of watches) {
    if (w.timer) clearTimeout(w.timer);
    w.watcher.close();
  }
  watches.clear();
}
