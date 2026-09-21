/**
 * §29 — pure parsers for git's plumbing output. Electron-free and dependency-free
 * so vitest drives them directly, and so `git.ts` is the only thing that ever
 * spawns a process.
 *
 * Every format below was captured from a real git (2.50.1) against a throwaway
 * repo rather than reasoned about — the shapes that bite are exactly the ones a
 * plausible guess gets wrong: a rename entry lists the NEW path first and the
 * original after a tab, a 100%-similar rename produces a diff section with no
 * hunks at all, and an unborn HEAD reports the literal string `(initial)` where
 * an oid belongs.
 */

export interface GitFileChange {
  /** Repo-relative, POSIX separators — exactly as git prints it. */
  path: string;
  /** Renames only: where the file came from. */
  origPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** True when the index half of XY is non-".": the change is staged. */
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface GitBranchInfo {
  /** null = detached HEAD. */
  branch: string | null;
  /** null = unborn HEAD (a repo with no commits). */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitStatusResult {
  branch: GitBranchInfo;
  files: GitFileChange[];
}

export interface DiffHunk {
  /** "@@ -a,b +c,d @@ ctx" */
  header: string;
  /** Raw unified lines, leading +/-/space kept, including "\ No newline" markers. */
  lines: string[];
  /** header + lines, newline-terminated — EXACTLY what `git apply -R` is fed. */
  raw: string;
}

export interface FileDiff {
  path: string;
  origPath?: string;
  binary: boolean;
  hunks: DiffHunk[];
  /** Everything from `diff --git` up to the first hunk — apply needs it to locate the file. */
  fileHeader: string;
}

export interface StashEntry {
  index: number;
  message: string;
}

export interface LogEntry {
  sha: string;
  subject: string;
  authorDate: string;
}

/**
 * git C-quotes a path only when it contains a control character, a quote or a
 * backslash; a path with plain spaces arrives bare. Both reach us, so both are
 * handled — and a bare path is returned untouched.
 */
function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"') || p.length < 2) return p;
  const body = p.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const c = body[++i];
    if (c === "n") out += "\n";
    else if (c === "t") out += "\t";
    else if (c === "r") out += "\r";
    else if (c >= "0" && c <= "7") {
      // Octal escape: exactly three digits.
      out += String.fromCharCode(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else out += c;
  }
  return out;
}

/**
 * Status from the two-character XY field. Precedence matters when the index and
 * worktree disagree (e.g. "MD" — staged edit, then deleted on disk): the file is
 * gone, and calling it "modified" would offer the user a diff of nothing.
 */
function statusFromXY(xy: string): GitFileChange["status"] {
  if (xy.includes("R")) return "renamed";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "added";
  return "modified";
}

/** `git status --porcelain=v2 --branch` (plus `--untracked-files=all`). */
export function parsePorcelainV2(out: string): GitStatusResult {
  const branch: GitBranchInfo = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const files: GitFileChange[] = [];

  for (const line of out.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.")) {
      const [key, ...rest] = line.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        // "+2 -1"
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }

    const kind = line[0];
    if (kind === "!") continue; // ignored — never shown, never touched

    if (kind === "?") {
      files.push({
        path: unquotePath(line.slice(2)),
        status: "untracked",
        staged: false,
        additions: 0,
        deletions: 0,
      });
      continue;
    }

    if (kind === "1" || kind === "2" || kind === "u") {
      const parts = line.split(" ");
      const xy = parts[1];
      // Ordinary: 1 XY sub mH mI mW hH hI <path>            → path at index 8
      // Rename:   2 XY sub mH mI mW hH hI <score> <path>\t<orig> → at index 9
      // Unmerged: u XY sub m1 m2 m3 mW h1 h2 h3 <path>      → path at index 10
      const pathIndex = kind === "1" ? 8 : kind === "2" ? 9 : 10;
      const tail = parts.slice(pathIndex).join(" ");
      if (kind === "2") {
        const [newPath, origPath] = tail.split("\t");
        files.push({
          path: unquotePath(newPath),
          origPath: unquotePath(origPath ?? ""),
          status: "renamed",
          staged: xy[0] !== ".",
          additions: 0,
          deletions: 0,
        });
      } else {
        files.push({
          path: unquotePath(tail),
          // An unmerged entry has no meaningful XY for our purposes ("UU"), and
          // conflict resolution is out of scope (§7) — show it, never crash.
          status: kind === "u" ? "modified" : statusFromXY(xy),
          staged: kind !== "u" && xy[0] !== ".",
          additions: 0,
          deletions: 0,
        });
      }
    }
  }

  return { branch, files };
}

/**
 * `diff --git a/<x> b/<y>` is genuinely ambiguous when a path contains a space,
 * because git does not quote it there. We only ever fall back to this line for a
 * BINARY file (every other section carries `---`/`+++` or `rename from/to`), and
 * a binary file's two sides are always the same path — so split down the middle
 * and require both halves to agree, which is unambiguous.
 */
function pathsFromDiffGitLine(rest: string): { a: string; b: string } | null {
  if (rest.length % 2 === 0) return null; // "a/P b/P" always has odd length
  const mid = (rest.length - 1) / 2;
  if (rest[mid] !== " ") return null;
  const a = rest.slice(0, mid);
  const b = rest.slice(mid + 1);
  if (!a.startsWith("a/") || !b.startsWith("b/")) return null;
  if (a.slice(2) !== b.slice(2)) return null;
  return { a: a.slice(2), b: b.slice(2) };
}

/** `git diff` / `git diff --cached` / `git show` unified output. */
export function parseUnifiedDiff(out: string): FileDiff[] {
  if (!out.trim()) return [];
  const lines = out.split("\n");
  // The trailing newline leaves a final "" that is not a line at all. Left in, it
  // becomes a phantom context line on the LAST hunk of every diff — and since
  // hunkPatch feeds that hunk straight to `git apply`, the patch would no longer
  // describe the file and every undo of a final hunk would refuse as "stale".
  if (lines[lines.length - 1] === "") lines.pop();
  const files: FileDiff[] = [];

  let cur: {
    headerLines: string[];
    hunks: DiffHunk[];
    binary: boolean;
    aPath: string | null;
    bPath: string | null;
    renameFrom: string | null;
    renameTo: string | null;
    diffGitRest: string;
    hunkHeader: string | null;
    hunkLines: string[];
  } | null = null;

  const closeHunk = (): void => {
    if (!cur?.hunkHeader) return;
    cur.hunks.push({
      header: cur.hunkHeader,
      lines: [...cur.hunkLines],
      raw: `${cur.hunkHeader}\n${cur.hunkLines.join("\n")}\n`,
    });
    cur.hunkHeader = null;
    cur.hunkLines = [];
  };

  const closeFile = (): void => {
    if (!cur) return;
    closeHunk();
    // Resolution order: an explicit rename beats the ---/+++ pair, which beats
    // the ambiguous `diff --git` line (binary-only fallback).
    let path: string | null = null;
    let origPath: string | undefined;
    if (cur.renameTo) {
      path = cur.renameTo;
      origPath = cur.renameFrom ?? undefined;
    } else if (cur.bPath && cur.bPath !== "/dev/null") {
      path = cur.bPath;
      if (cur.aPath && cur.aPath !== "/dev/null" && cur.aPath !== cur.bPath) origPath = cur.aPath;
    } else if (cur.aPath && cur.aPath !== "/dev/null") {
      path = cur.aPath; // deleted file: +++ is /dev/null, the path lives on the --- side
    } else {
      path = pathsFromDiffGitLine(cur.diffGitRest)?.b ?? null;
    }
    if (path !== null) {
      files.push({
        path,
        ...(origPath ? { origPath } : {}),
        binary: cur.binary,
        hunks: cur.hunks,
        fileHeader: cur.headerLines.join("\n"),
      });
    }
    cur = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      cur = {
        headerLines: [line],
        hunks: [],
        binary: false,
        aPath: null,
        bPath: null,
        renameFrom: null,
        renameTo: null,
        diffGitRest: line.slice("diff --git ".length),
        hunkHeader: null,
        hunkLines: [],
      };
      continue;
    }
    if (!cur) continue; // preamble before any file section (e.g. `git show` commit header)

    if (line.startsWith("@@")) {
      closeHunk();
      cur.hunkHeader = line;
      continue;
    }

    if (cur.hunkHeader) {
      // Inside a hunk: +, -, space and the "\ No newline" marker all belong to it.
      // Anything else ends it (the next file section is caught above).
      if (line === "" || "+- \\".includes(line[0])) {
        cur.hunkLines.push(line === "" ? " " : line);
        continue;
      }
      closeHunk();
    }

    cur.headerLines.push(line);
    if (line.startsWith("--- ")) cur.aPath = stripDiffPrefix(line.slice(4));
    else if (line.startsWith("+++ ")) cur.bPath = stripDiffPrefix(line.slice(4));
    else if (line.startsWith("rename from ")) cur.renameFrom = unquotePath(line.slice(12));
    else if (line.startsWith("rename to ")) cur.renameTo = unquotePath(line.slice(10));
    else if (line.startsWith("Binary files ")) cur.binary = true;
  }
  closeFile();
  return files;
}

/** "a/src/x.ts" | "b/src/x.ts" | "/dev/null" → the bare path. */
function stripDiffPrefix(p: string): string {
  const unquoted = unquotePath(p.split("\t")[0]);
  if (unquoted === "/dev/null") return "/dev/null";
  return unquoted.startsWith("a/") || unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
}

/**
 * One hunk, rebuilt into a patch `git apply` accepts. This is the whole reason
 * the panel renders GIT's hunks rather than the js `diff` library's: the hunk the
 * user sees is byte-for-byte the hunk that gets reverse-applied.
 */
export function hunkPatch(fd: FileDiff, hunk: DiffHunk): string {
  return `${fd.fileHeader}\n${hunk.raw}`;
}

/** `git diff --numstat` — "<added>\t<deleted>\t<path>", binary as "-\t-". */
export function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const m = new Map<string, { additions: number; deletions: number }>();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [add, del, ...rest] = line.split("\t");
    let path = rest.join("\t");
    if (!path) continue;
    // Rename form: "old => new" (or "pre{old => new}post" — the braces case is
    // rare enough that the plain form is what we key on).
    const arrow = path.indexOf(" => ");
    if (arrow !== -1) path = path.slice(arrow + 4).replace(/\}$/, "");
    m.set(unquotePath(path), {
      additions: add === "-" ? 0 : Number(add) || 0,
      deletions: del === "-" ? 0 : Number(del) || 0,
    });
  }
  return m;
}

/** Fold numstat counts onto the status list; anything unmatched stays at zero. */
export function mergeNumstat(
  files: GitFileChange[],
  stats: Map<string, { additions: number; deletions: number }>
): GitFileChange[] {
  return files.map((f) => {
    const s = stats.get(f.path);
    return s ? { ...f, additions: s.additions, deletions: s.deletions } : f;
  });
}

/**
 * The badge's input. Lines, not files — one 800-line file outweighs ten
 * one-liners, and "would I be sad to lose this" tracks lines (PRD §29).
 */
export function totalChangedLines(files: GitFileChange[]): number {
  return files.reduce((n, f) => n + f.additions + f.deletions, 0);
}

/** `git stash list --format=%gd%x00%gs` */
export function parseStashList(out: string): StashEntry[] {
  const entries: StashEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [ref, message] = line.split("\x00");
    const m = /stash@\{(\d+)\}/.exec(ref ?? "");
    if (!m) continue;
    entries.push({ index: Number(m[1]), message: message ?? "" });
  }
  return entries;
}

/** `git log --format=%H%x00%s%x00%aI` */
export function parseLog(out: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [sha, subject, authorDate] = line.split("\x00");
    if (!sha) continue;
    entries.push({ sha, subject: subject ?? "", authorDate: authorDate ?? "" });
  }
  return entries;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  /** Short name (`refs/heads/` stripped); null when detached. */
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/**
 * `git worktree list --porcelain` — one record per blank-line-separated block.
 *
 * Four of the seven keys are BARE (`detached`, `bare`, and `locked`/`prunable`
 * when git has no reason to give), so splitting on a space and reading the tail
 * is wrong for them: `line.indexOf(" ")` answering -1 IS the flag. `locked` and
 * `prunable` also arrive WITH a reason attached, which we drop — the row says
 * what it can do, and git's own message is shown when a verb refuses.
 */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of out.split(/\n\n+/)) {
    let e: WorktreeEntry | null = null;
    for (const line of block.split("\n")) {
      const sp = line.indexOf(" ");
      const key = sp === -1 ? line : line.slice(0, sp);
      const val = sp === -1 ? "" : line.slice(sp + 1);
      if (key === "worktree") {
        e = { path: val, head: "", branch: null, bare: false, locked: false, prunable: false };
      } else if (!e) continue;
      else if (key === "HEAD") e.head = val;
      else if (key === "branch") e.branch = val.replace(/^refs\/heads\//, "");
      else if (key === "bare") e.bare = true;
      else if (key === "locked") e.locked = true;
      else if (key === "prunable") e.prunable = true;
    }
    if (e) entries.push(e);
  }
  return entries;
}
