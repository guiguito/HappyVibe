import fs from "node:fs";
import path from "node:path";

/**
 * Workspace file access (W2.2) — file tree + editor tabs.
 *
 * Same trust model as agentsMd.ts: the renderer-supplied workspaceId is a
 * trust boundary; every path is confined to a REGISTERED workspace. Module is
 * electron-free so it stays unit-testable.
 */

/** Directories never shown or read (PRD: node_modules/.git ignored). */
const IGNORED_DIRS = new Set(["node_modules", ".git", ".pi-subagents"]);
/** Dotfiles are hidden except these (they carry agent/project config). */
const DOTFILE_ALLOW = new Set([".pi", ".github"]);
/** Editor size cap — beyond this the UI shows an honest "too large" state. */
export const MAX_FILE_BYTES = 1_000_000;

export interface FsEntry {
  name: string;
  kind: "dir" | "file";
}

export type ReadResult =
  | { kind: "text"; content: string; mtimeMs: number }
  | { kind: "too-large"; size: number }
  | { kind: "binary" };

/**
 * Confine a renderer-supplied relative path to a registered workspace.
 * Returns the absolute path; throws on unknown workspace or traversal.
 */
export function resolveInWorkspace(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPath: string
): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) {
    throw new Error("Unknown workspace");
  }
  if (path.isAbsolute(relPath)) throw new Error("Path escapes workspace");
  const abs = path.resolve(ws, relPath);
  if (abs !== ws && !abs.startsWith(ws + path.sep)) throw new Error("Path escapes workspace");
  return abs;
}

/** Visible in the tree? (skips ignored dirs and most dotfiles) */
export function isVisibleEntry(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return false;
  if (name.startsWith(".") && !DOTFILE_ALLOW.has(name)) return false;
  return true;
}

/** One directory level, lazily — dirs first, then files, both name-sorted. */
export function listDir(registeredWorkspaces: string[], workspaceId: string, relDir: string): FsEntry[] {
  const dir = resolveInWorkspace(registeredWorkspaces, workspaceId, relDir);
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => isVisibleEntry(e.name) && (e.isDirectory() || e.isFile() || e.isSymbolicLink()))
    .map((e): FsEntry => ({ name: e.name, kind: e.isDirectory() ? "dir" : "file" }));
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readWorkspaceFile(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPath: string
): ReadResult {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  const st = fs.statSync(abs);
  if (st.size > MAX_FILE_BYTES) return { kind: "too-large", size: st.size };
  const buf = fs.readFileSync(abs);
  // ponytail: NUL-byte sniff is the classic binary heuristic; good enough here.
  if (buf.subarray(0, 8000).includes(0)) return { kind: "binary" };
  return { kind: "text", content: buf.toString("utf8"), mtimeMs: st.mtimeMs };
}

/** Write and return the new mtime (the renderer's external-change baseline). */
export function writeWorkspaceFile(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPath: string,
  content: string
): number {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  fs.writeFileSync(abs, content, "utf8");
  return fs.statSync(abs).mtimeMs;
}

export interface FsDetails {
  kind: "dir" | "file";
  size: number;
  mtimeMs: number;
}

/** Round 4 #7: file/folder details for the tree's right-click "Details" popup. */
export function statDetails(registeredWorkspaces: string[], workspaceId: string, relPath: string): FsDetails {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  const st = fs.statSync(abs);
  return { kind: st.isDirectory() ? "dir" : "file", size: st.size, mtimeMs: st.mtimeMs };
}

/** mtime for external-change detection; null when the file vanished. */
export function statMtime(registeredWorkspaces: string[], workspaceId: string, relPath: string): number | null {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
}

// ── WS8: file-tree mutations (all confined; refuse to clobber) ───────────────

/** Create an empty file (mkdir parents). Refuses to overwrite an existing path. */
export function createFile(registeredWorkspaces: string[], workspaceId: string, relPath: string): void {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  if (fs.existsSync(abs)) throw new Error("A file or folder already exists there");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "", "utf8");
}

/** Create a directory (recursive). Refuses if the path already exists. */
export function createDir(registeredWorkspaces: string[], workspaceId: string, relPath: string): void {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  if (fs.existsSync(abs)) throw new Error("A file or folder already exists there");
  fs.mkdirSync(abs, { recursive: true });
}

/** Move an entry into a destination directory (within the workspace). Refuses to overwrite. */
export function moveEntry(
  registeredWorkspaces: string[],
  workspaceId: string,
  srcRel: string,
  destDirRel: string,
): string {
  const src = resolveInWorkspace(registeredWorkspaces, workspaceId, srcRel);
  const destDir = resolveInWorkspace(registeredWorkspaces, workspaceId, destDirRel);
  const name = path.basename(src);
  const dest = path.join(destDir, name);
  if (dest === src || dest.startsWith(src + path.sep)) throw new Error("Cannot move into itself");
  if (fs.existsSync(dest)) throw new Error(`"${name}" already exists there`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(src, dest);
  return path.relative(path.resolve(workspaceId), dest);
}

/**
 * Import external OS paths (from a drag-and-drop) into a workspace directory,
 * copying recursively. Sources are absolute OS paths (NOT confined — they're
 * external); only the destination is confined. Refuses to overwrite.
 */
export function importEntries(
  registeredWorkspaces: string[],
  workspaceId: string,
  destDirRel: string,
  srcAbsPaths: string[],
): string[] {
  const destDir = resolveInWorkspace(registeredWorkspaces, workspaceId, destDirRel);
  fs.mkdirSync(destDir, { recursive: true });
  const written: string[] = [];
  for (const src of srcAbsPaths) {
    if (!path.isAbsolute(src) || !fs.existsSync(src)) continue;
    const dest = path.join(destDir, path.basename(src));
    if (fs.existsSync(dest)) throw new Error(`"${path.basename(src)}" already exists there`);
    fs.cpSync(src, dest, { recursive: true });
    written.push(path.relative(path.resolve(workspaceId), dest));
  }
  return written;
}
