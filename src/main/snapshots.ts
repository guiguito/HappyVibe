/**
 * §9 rewind file rollback — a content-addressed snapshot store.
 *
 * One whole-workspace manifest per user prompt and per turn completion. No git
 * binary (PRD §3 standalone promise; same call as skills/gitImport.ts).
 *
 * Two invariants the tests pin:
 *  - an excluded path is outside the manifest AND outside restore, so restore
 *    can never delete a build directory;
 *  - symlinks are skipped, never followed — reading through one would escape
 *    workspace confinement.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES, isVisibleEntry, resolveInWorkspace } from "./files";

/**
 * Build outputs, on top of the ignore list the file tree and watcher share
 * (files.ts IGNORED_DIRS + dotfile rules, via isVisibleEntry). Deliberately a
 * SEPARATE set: widening the shared one would change what the tree shows.
 */
export const SNAPSHOT_EXCLUDE = new Set([
  "dist", "build", "out", ".next", ".nuxt", "target",
  "venv", ".venv", "__pycache__", "coverage", ".turbo", ".cache",
]);

export interface Manifest {
  /** workspace-relative path → sha256 hex of contents */
  files: Record<string, string>;
  /** paths over MAX_FILE_BYTES — recorded, never silently dropped */
  tooLarge: string[];
}

export interface ManifestDiff { changed: string[]; added: string[]; removed: string[] }

/** mtime+size → hash, so an unchanged file is stat'd but not re-read. */
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

function hashFile(abs: string, st: fs.Stats): string {
  const hit = hashCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  hashCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

export function buildManifest(registeredWorkspaces: string[], workspaceId: string): Manifest {
  const root = resolveInWorkspace(registeredWorkspaces, workspaceId, "");
  const files: Record<string, string> = {};
  const tooLarge: string[] = [];

  const walk = (abs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!isVisibleEntry(e.name)) continue;
      if (e.isDirectory() && SNAPSHOT_EXCLUDE.has(e.name)) continue;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        walk(childAbs);
        continue;
      }
      // isFile() alone: a symlink reports false here, so links are skipped.
      if (!e.isFile()) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(childAbs);
      } catch {
        continue;
      }
      const rel = path.relative(root, childAbs);
      if (st.size > MAX_FILE_BYTES) {
        tooLarge.push(rel);
        continue;
      }
      try {
        files[rel] = hashFile(childAbs, st);
      } catch {
        /* unreadable mid-walk — treat as absent */
      }
    }
  };
  walk(root);
  tooLarge.sort();
  return { files, tooLarge };
}

export function diffManifests(from: Manifest, to: Manifest): ManifestDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [p, h] of Object.entries(to.files)) {
    const before = from.files[p];
    if (before === undefined) added.push(p);
    else if (before !== h) changed.push(p);
  }
  for (const p of Object.keys(from.files)) if (to.files[p] === undefined) removed.push(p);
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}
