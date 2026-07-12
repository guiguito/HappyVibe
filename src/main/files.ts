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

/** mtime for external-change detection; null when the file vanished. */
export function statMtime(registeredWorkspaces: string[], workspaceId: string, relPath: string): number | null {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
}
