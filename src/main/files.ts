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
const DOTFILE_ALLOW = new Set([".pi", ".github", ".agents"]);
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

// ── F3: @file mentions — recursive listing + context-block assembly ──────────

export interface FsEntryRec {
  /** Workspace-relative path (OS separators). */
  rel: string;
  kind: "dir" | "file";
}

/**
 * Recursive listing for @-mention autocomplete — visible entries only, capped.
 * Dirs first then files at each level (name-sorted). Symlinks are listed as
 * files and never recursed into (avoids symlink cycles).
 */
export function listRecursive(
  registeredWorkspaces: string[],
  workspaceId: string,
  maxEntries = 5000,
): FsEntryRec[] {
  const root = resolveInWorkspace(registeredWorkspaces, workspaceId, "");
  const out: FsEntryRec[] = [];
  const walk = (abs: string): void => {
    if (out.length >= maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries
      .filter((e) => isVisibleEntry(e.name) && (e.isDirectory() || e.isFile() || e.isSymbolicLink()))
      .sort((a, b) => {
        const ad = a.isDirectory(), bd = b.isDirectory();
        return ad === bd ? a.name.localeCompare(b.name) : ad ? -1 : 1;
      });
    for (const e of sorted) {
      if (out.length >= maxEntries) return;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        out.push({ rel: path.relative(root, childAbs), kind: "dir" });
        walk(childAbs);
      } else {
        out.push({ rel: path.relative(root, childAbs), kind: "file" });
      }
    }
  };
  walk(root);
  return out;
}

/** Visible files under a directory, recursively (rel to workspace root). */
function walkFiles(absDir: string, root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!isVisibleEntry(e.name)) continue;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) walk(childAbs);
      else if (e.isFile() || e.isSymbolicLink()) out.push(path.relative(root, childAbs));
    }
  };
  walk(absDir);
  return out.sort();
}

/** @-mention injection budget — total chars across all referenced content. */
export const MENTION_CONTEXT_CAP = 200_000;

export interface MentionBlocks {
  /** The assembled `<file>`/`<file-listing>` blocks, or "" if nothing usable. */
  blocks: string;
  /** Human-readable notices (skipped binaries, over-cap dirs, missing paths). */
  warnings: string[];
}

/**
 * Assemble hidden context blocks for @-mentioned paths (files and directories),
 * path-confined. Files inject `<file path>content</file>`; directories inject
 * every text file recursively, but if that would blow the char cap they fall
 * back to a `<file-listing>` of the paths instead (with a warning).
 */
export function buildMentionBlocks(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPaths: string[],
  cap = MENTION_CONTEXT_CAP,
): MentionBlocks {
  const warnings: string[] = [];
  const parts: string[] = [];
  let total = 0;
  const fileBlock = (rel: string, content: string): string => `<file path="${rel}">\n${content}\n</file>`;
  const push = (s: string): void => { parts.push(s); total += s.length + 1; };
  const kchars = (n: number): string => `${Math.round(n / 1000)}k chars`;

  for (const rel of relPaths) {
    let isDir: boolean;
    try {
      isDir = fs.statSync(resolveInWorkspace(registeredWorkspaces, workspaceId, rel)).isDirectory();
    } catch {
      warnings.push(`Could not read ${rel} — not found.`);
      continue;
    }
    if (isDir) {
      const files = walkFiles(
        resolveInWorkspace(registeredWorkspaces, workspaceId, rel),
        resolveInWorkspace(registeredWorkspaces, workspaceId, ""),
      );
      const blocks: string[] = [];
      let dirLen = 0;
      for (const f of files) {
        const r = readWorkspaceFile(registeredWorkspaces, workspaceId, f);
        if (r.kind !== "text") continue; // skip binaries / too-large silently within a dir
        const b = fileBlock(f, r.content);
        blocks.push(b);
        dirLen += b.length + 1;
      }
      if (total + dirLen > cap) {
        const listing = `<file-listing path="${rel}">\n${files.join("\n")}\n</file-listing>`;
        if (total + listing.length <= cap) push(listing);
        warnings.push(`${rel} is too large to inline (${kchars(dirLen)}) — injected a file listing instead.`);
      } else {
        for (const b of blocks) push(b);
      }
    } else {
      const r = readWorkspaceFile(registeredWorkspaces, workspaceId, rel);
      if (r.kind === "binary") { warnings.push(`Skipped ${rel} — looks like a binary file.`); continue; }
      if (r.kind === "too-large") { warnings.push(`Skipped ${rel} — too large (${kchars(r.size)}).`); continue; }
      const b = fileBlock(rel, r.content);
      if (total + b.length > cap) { warnings.push(`Skipped ${rel} — would exceed the ${kchars(cap)} context cap.`); continue; }
      push(b);
    }
  }
  return { blocks: parts.join("\n"), warnings };
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

// ── round 11: the files the user has open, as context ────────────────────────

/** Delimiters kept as constants so the builder and the stripper cannot drift. */
const OPEN_FILES_OPEN = "<open-files>";
const OPEN_FILES_CLOSE = "</open-files>";

/**
 * Round 11: the files the user currently has open in the built-in editor.
 *
 * PATHS ONLY, never contents — the point is "here is what I'm looking at", and
 * the bytes are what `@file` mentions are for. It rides the same per-prompt seam
 * as those mention blocks, so the paths are counted under Conversation in the
 * context breakdown (no new category, no silent inflation of the system-prompt
 * figure) and cost a few dozen tokens rather than a file's worth.
 *
 * Sorted, so an unchanged set renders byte-identically and `openFilesChanged`
 * can be a plain comparison.
 */
export function buildOpenFilesBlock(relPaths: string[]): string {
  if (!relPaths.length) return "";
  return `${OPEN_FILES_OPEN}\n${[...relPaths].sort().join("\n")}\n${OPEN_FILES_CLOSE}`;
}

/**
 * Has the open-file set changed since that session's previous prompt?
 *
 * The block rides each prompt, so without this check turn 1's stale list would
 * sit in context beside turn 5's. Sending only on change keeps the most recent
 * block always current, and an unchanged set costs nothing. `undefined` prev
 * means "nothing sent yet" — but an empty set is still no change, so a session
 * with no open files never sends an empty block.
 */
export function openFilesChanged(prev: string[] | undefined, next: string[]): boolean {
  if (!prev) return next.length > 0;
  if (prev.length !== next.length) return true;
  const a = [...prev].sort();
  const b = [...next].sort();
  return a.some((v, i) => v !== b[i]);
}
