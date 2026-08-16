import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type FileDiff,
  type GitFileChange,
  type GitStatusResult,
  type LogEntry,
  type StashEntry,
  mergeNumstat,
  parseLog,
  parseNumstat,
  parsePorcelainV2,
  parseStashList,
  parseUnifiedDiff,
} from "./gitParse";
import { loginShellPath, mergePath } from "./shellPath";

/**
 * §29 — the only place in the app that spawns git.
 *
 * Three rules the whole feature rests on:
 *  - **git is a feature, never a runtime dependency** (PRD §3). Every entry point
 *    resolves to one of five states and `no-git` is an ordinary one, not an error.
 *  - **Every call takes an explicit repo root**, never "the workspace path". That
 *    is what makes worktrees a later root-resolver rather than a rewrite (§6).
 *  - **Reads pass `--no-optional-locks`.** A background status otherwise takes the
 *    index lock and can race the agent's own git commands mid-turn.
 */

export type RepoState =
  | { kind: "no-git" }
  | { kind: "no-repo" }
  | { kind: "repo"; root: string; subdir: string | null; unborn: boolean }
  | { kind: "error"; message: string; fix: string | null };

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Directories whose contents nobody means to commit. Drives the §5b starter
 *  .gitignore AND the pre-existing-repo junk guard on Save a version. */
export const JUNK_DIRS: readonly string[] = [
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "__pycache__",
  "coverage",
  ".DS_Store",
  ".gradle",
  "vendor",
];

const READ_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 120_000;
/** git's own name for the empty tree is asked per-repo, never hard-coded: a
 *  SHA-256 repo has a different one, and §5d's whole baseline depends on it. */
const emptyTreeCache = new Map<string, string>();

let gitBinary = "git";
let availability: boolean | null = null;
const probeCache = new Map<string, RepoState>();

/** Test seam: point the runner at a binary that does not exist, to exercise §5a. */
export function setGitBinaryForTest(bin: string | null): void {
  gitBinary = bin ?? "git";
}

export function resetGitAvailability(): void {
  availability = null;
  probeCache.clear();
  emptyTreeCache.clear();
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: mergePath(process.env.PATH, loginShellPath()) ?? process.env.PATH,
    // Never let git open an editor, a pager or a credential prompt on a
    // background call — a hung child is worse than a named failure.
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

/**
 * One runner. `write: false` (the default) prepends `--no-optional-locks`;
 * network verbs get the longer timeout. Never `shell: true` — every argument is
 * passed as argv, so a branch name can never become a command.
 */
export function run(
  cwd: string,
  args: string[],
  opts: { write?: boolean; network?: boolean; stdin?: string } = {}
): Promise<GitRunResult> {
  const full = opts.write ? args : ["--no-optional-locks", ...args];
  return new Promise((resolve) => {
    const child = execFile(
      gitBinary,
      full,
      {
        cwd,
        env: gitEnv(),
        timeout: opts.network ? NETWORK_TIMEOUT_MS : READ_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024, // a big diff is normal; a truncated one is a lie
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException & { code?: number })?.code;
        resolve({
          ok: !err,
          stdout: stdout ?? "",
          stderr: stderr ?? (err ? String(err.message) : ""),
          code: typeof code === "number" ? code : err ? 1 : 0,
        });
      }
    );
    if (opts.stdin !== undefined) {
      child.stdin?.end(opts.stdin);
    }
  });
}

/** Is there a usable git at all? Cached — one spawn per app run. */
export async function gitAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  const r = await run(process.cwd(), ["--version"]);
  availability = r.ok;
  return availability;
}

/**
 * git prints the exact remedy for the dubious-ownership case. We surface it as a
 * copyable line and DO NOT run it — `safe.directory` is a global security
 * setting, and a Changes panel has no business writing one (§5e).
 */
function extractFix(stderr: string): string | null {
  const m = /git config --global --add safe\.directory .+/.exec(stderr);
  return m ? m[0].trim() : null;
}

/** §5 — the five outcomes, cached per workspace. Never sniffs `.git`. */
export async function probeWorkspace(workspace: string): Promise<RepoState> {
  const cached = probeCache.get(workspace);
  if (cached) return cached;

  const state = await computeState(workspace);
  probeCache.set(workspace, state);
  return state;
}

async function computeState(workspace: string): Promise<RepoState> {
  if (!(await gitAvailable())) return { kind: "no-git" };
  if (!fs.existsSync(workspace)) return { kind: "no-repo" };

  const top = await run(workspace, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    const err = top.stderr || "";
    if (/not a git repository/i.test(err)) return { kind: "no-repo" };
    return { kind: "error", message: err.trim(), fix: extractFix(err) };
  }

  const root = top.stdout.trim();
  // realpath both sides: macOS hands us /var vs /private/var and a raw string
  // compare would call every temp-dir repo a subdirectory of itself.
  const realRoot = safeReal(root);
  const realWs = safeReal(workspace);
  const rel = path.relative(realRoot, realWs);
  const subdir = rel === "" ? null : rel.split(path.sep).join("/");

  const head = await run(root, ["rev-parse", "-q", "--verify", "HEAD"]);
  return { kind: "repo", root, subdir, unborn: !head.ok };
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function invalidateProbe(workspace: string): void {
  probeCache.delete(workspace);
}

export function invalidateAllProbes(): void {
  probeCache.clear();
}

/** §5c — every read and write is confined to the workspace subtree by pathspec. */
function pathspec(state: Extract<RepoState, { kind: "repo" }>): string[] {
  return state.subdir ? ["--", state.subdir] : [];
}

async function requireRepo(workspace: string): Promise<Extract<RepoState, { kind: "repo" }> | null> {
  const s = await probeWorkspace(workspace);
  return s.kind === "repo" ? s : null;
}

async function emptyTree(root: string): Promise<string> {
  const hit = emptyTreeCache.get(root);
  if (hit) return hit;
  const r = await run(root, ["hash-object", "-t", "tree", "/dev/null"]);
  const oid = r.stdout.trim() || "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  emptyTreeCache.set(root, oid);
  return oid;
}

export interface GitStatusPayload {
  state: RepoState;
  status?: GitStatusResult;
  stashes?: StashEntry[];
  lastSubject?: string;
}

/** Everything the panel needs for one render, in one round of git calls. */
export async function gitStatus(workspace: string): Promise<GitStatusPayload> {
  const state = await probeWorkspace(workspace);
  if (state.kind !== "repo") return { state };

  const [statusOut, stashOut, logOut] = await Promise.all([
    run(state.root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", ...pathspec(state)]),
    run(state.root, ["stash", "list", "--format=%gd%x00%gs"]),
    run(state.root, ["log", "-1", "--format=%s"]),
  ]);
  if (!statusOut.ok) {
    return { state: { kind: "error", message: statusOut.stderr.trim(), fix: extractFix(statusOut.stderr) } };
  }

  const parsed = parsePorcelainV2(statusOut.stdout);
  /**
   * `unborn` comes from the LIVE status, never from the cached probe. The root
   * and subdir genuinely do not move for a workspace, so caching them is right —
   * but a repo stops being unborn the moment the user makes their first commit,
   * and a cached `true` would leave the panel saying "nothing here yet" forever,
   * with History hidden and the base-branch baseline permanently absent. The
   * porcelain already tells us: `# branch.oid (initial)` parses to a null oid.
   */
  const live: Extract<RepoState, { kind: "repo" }> = { ...state, unborn: parsed.branch.oid === null };
  probeCache.set(workspace, live);

  const numstat = await run(live.root, [
    "diff",
    ...(live.unborn ? [await emptyTree(live.root)] : ["HEAD"]),
    "--numstat",
    ...pathspec(live),
  ]);
  const files = mergeNumstat(parsed.files, parseNumstat(numstat.stdout));

  return {
    state: live,
    status: { branch: parsed.branch, files },
    stashes: parseStashList(stashOut.stdout),
    lastSubject: logOut.ok ? logOut.stdout.trim() : undefined,
  };
}

/**
 * §2 baselines. "head" = working tree vs HEAD ("Since your last save"), "base" =
 * merge-base with the detected default branch ("Against <base>").
 */
export async function gitDiff(
  workspace: string,
  baseline: "head" | "base",
  opts: { staged?: boolean; path?: string } = {}
): Promise<FileDiff[]> {
  const state = await requireRepo(workspace);
  if (!state) return [];

  const scope = opts.path ? ["--", opts.path] : pathspec(state);
  const args = ["diff"];
  if (opts.staged) args.push("--cached");

  if (baseline === "base") {
    const base = await defaultBranch(workspace);
    if (!base) return [];
    args.push(`${base}...`);
  } else if (state.unborn) {
    args.push(await emptyTree(state.root));
  } else {
    args.push("HEAD");
  }

  const r = await run(state.root, [...args, ...scope]);
  if (!r.ok) return [];
  const files = parseUnifiedDiff(r.stdout);

  // Untracked files are invisible to `git diff` but are the ENTIRE content of an
  // on-ramp repo, so they are diffed individually against /dev/null.
  const untracked = await untrackedDiffs(state, opts.path);
  return [...files, ...untracked];
}

async function untrackedDiffs(
  state: Extract<RepoState, { kind: "repo" }>,
  onlyPath?: string
): Promise<FileDiff[]> {
  const ls = await run(state.root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    ...(onlyPath ? ["--", onlyPath] : pathspec(state)),
  ]);
  if (!ls.ok) return [];
  const paths = ls.stdout.split("\n").filter(Boolean);
  const out: FileDiff[] = [];
  for (const p of paths) {
    // `--no-index` against /dev/null gives us a real unified diff for a file git
    // does not track yet — same renderer, same hunk shapes, no special case.
    const d = await run(state.root, ["diff", "--no-index", "--", "/dev/null", p]);
    const parsed = parseUnifiedDiff(d.stdout);
    for (const fd of parsed) out.push({ ...fd, path: p });
  }
  return out;
}

export async function gitHistory(workspace: string, limit: number): Promise<LogEntry[]> {
  const state = await requireRepo(workspace);
  if (!state || state.unborn) return [];
  const r = await run(state.root, ["log", `-${limit}`, "--format=%H%x00%s%x00%aI", ...pathspec(state)]);
  return r.ok ? parseLog(r.stdout) : [];
}

export async function gitShow(workspace: string, sha: string): Promise<FileDiff[]> {
  const state = await requireRepo(workspace);
  if (!state) return [];
  const r = await run(state.root, ["show", "--format=", sha, ...pathspec(state)]);
  return r.ok ? parseUnifiedDiff(r.stdout) : [];
}

/** The base-branch baseline's other half: what IS the default branch here? */
export async function defaultBranch(workspace: string): Promise<string | null> {
  const state = await requireRepo(workspace);
  if (!state) return null;

  const originHead = await run(state.root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead.ok && originHead.stdout.trim()) {
    return originHead.stdout.trim().replace("refs/remotes/", "");
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const v = await run(state.root, ["rev-parse", "--verify", "--quiet", candidate]);
    if (v.ok && v.stdout.trim()) return candidate;
  }
  return null;
}

export async function listBranches(workspace: string): Promise<string[]> {
  const state = await requireRepo(workspace);
  if (!state) return [];
  const r = await run(state.root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return r.ok ? r.stdout.split("\n").filter(Boolean) : [];
}

export type WriteResult = { ok: true; sha?: string } | { ok: false; error: string };

/**
 * §2 — Save a version. `git add -A` scoped to the workspace, then commit; never
 * `commit -a`, which skips untracked files, i.e. saves NOTHING at the exact
 * moment the on-ramp introduces the feature.
 */
export async function saveVersion(
  workspace: string,
  message: string,
  opts: { stagedOnly: boolean; amend: boolean }
): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };

  if (!opts.stagedOnly) {
    const add = await run(state.root, ["add", "-A", ...(state.subdir ? ["--", state.subdir] : ["--", "."])], {
      write: true,
    });
    if (!add.ok) return { ok: false, error: add.stderr.trim() };
  }

  const args = ["commit", "-m", message];
  if (opts.amend) args.push("--amend");
  const c = await run(state.root, args, { write: true });
  if (!c.ok) return { ok: false, error: (c.stderr || c.stdout).trim() };

  const sha = await run(state.root, ["rev-parse", "HEAD"]);
  return { ok: true, sha: sha.stdout.trim() };
}

export async function stageFile(workspace: string, relPath: string, stage: boolean): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = stage
    ? await run(state.root, ["add", "--", relPath], { write: true })
    : await run(state.root, ["restore", "--staged", "--", relPath], { write: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

/**
 * §3 — per-hunk undo. `--check` FIRST: that is the stale check, not a second
 * mechanism beside it. A file whose context moved refuses to apply, and refusing
 * is the whole promise ("never overwritten").
 */
export async function undoHunk(
  workspace: string,
  patch: string
): Promise<{ ok: true } | { ok: false; stale: boolean; error: string }> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, stale: false, error: "Not a git repository." };

  const check = await run(state.root, ["apply", "-R", "--check", "-"], { write: true, stdin: patch });
  if (!check.ok) return { ok: false, stale: true, error: check.stderr.trim() };

  const applied = await run(state.root, ["apply", "-R", "-"], { write: true, stdin: patch });
  return applied.ok ? { ok: true } : { ok: false, stale: false, error: applied.stderr.trim() };
}

/** Undo a whole tracked file — both halves, so a staged wreck is undone too. */
export async function undoFile(workspace: string, relPath: string): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = await run(state.root, ["restore", "--worktree", "--staged", "--", relPath], { write: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

/** §3 — an untracked file is DELETED, not undone; the control says so. */
export async function discardUntracked(workspace: string, relPath: string): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  try {
    const root = safeReal(state.root);
    if (path.isAbsolute(relPath)) throw new Error("Path escapes the repository");
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("Path escapes the repository");
    fs.rmSync(abs, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SwitchResult {
  ok: boolean;
  error?: string;
  wouldConflict?: boolean;
}

/**
 * §1 — switching with unsaved changes is a first-class choice, so this reports
 * `wouldConflict` rather than dumping git's refusal on the user. Mode "take" is
 * a plain switch (git carries clean changes across by itself); "stash" parks
 * them first, into a stash the panel can show and pop back.
 */
export async function switchBranch(
  workspace: string,
  branch: string,
  opts: { create: boolean; mode: "take" | "stash" }
): Promise<SwitchResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };

  if (opts.mode === "stash") {
    const s = await run(state.root, ["stash", "push", "-u", "-m", `HappyVibe: switching to ${branch}`], {
      write: true,
    });
    if (!s.ok) return { ok: false, error: s.stderr.trim() };
  }

  const args = ["switch"];
  if (opts.create) args.push("-c");
  args.push(branch);
  const r = await run(state.root, args, { write: true });
  if (r.ok) return { ok: true };

  const conflict = /would be overwritten|local changes|cannot be applied/i.test(r.stderr);
  return { ok: false, error: r.stderr.trim(), ...(conflict ? { wouldConflict: true } : {}) };
}

export async function fetchRemote(workspace: string): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = await run(state.root, ["fetch", "--prune"], { write: true, network: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  /** The remote moved in a way that would need a merge — we stop, never merge (§1). */
  nonFF?: boolean;
}

/**
 * §1 — Sync = fetch, then pull --ff-only if behind, then push if ahead. The
 * ff-only is load-bearing: a non-fast-forward pull says so and stops, because
 * §7 ships no conflict UI and a beginner mid-conflict is the worst state this
 * panel could produce.
 */
export async function sync(workspace: string): Promise<SyncResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };

  const f = await run(state.root, ["fetch", "--prune"], { write: true, network: true });
  if (!f.ok) return { ok: false, error: f.stderr.trim() };

  const status = await run(state.root, ["status", "--porcelain=v2", "--branch"]);
  const { branch } = parsePorcelainV2(status.stdout);
  if (!branch.upstream) return { ok: false, error: "This branch has no upstream yet." };

  if (branch.behind > 0) {
    const p = await run(state.root, ["pull", "--ff-only"], { write: true, network: true });
    if (!p.ok) {
      const nonFF = /not possible to fast-forward|diverged|non-fast-forward/i.test(p.stderr);
      return { ok: false, error: p.stderr.trim(), ...(nonFF ? { nonFF: true } : {}) };
    }
  }
  if (branch.ahead > 0 || branch.behind > 0) {
    const push = await run(state.root, ["push"], { write: true, network: true });
    if (!push.ok) return { ok: false, error: push.stderr.trim() };
  }
  return { ok: true };
}

/** First push of a branch that has no upstream: `push -u origin <branch>`. */
export async function publish(workspace: string): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  const head = await run(state.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.stdout.trim();
  if (!branch || branch === "HEAD") return { ok: false, error: "Detached HEAD — check out a branch first." };
  const r = await run(state.root, ["push", "-u", "origin", branch], { write: true, network: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export async function stash(
  workspace: string,
  action: "save" | "pop" | "drop",
  index = 0
): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  const args =
    action === "save"
      ? ["stash", "push", "-u"]
      : action === "pop"
        ? ["stash", "pop", `stash@{${index}}`]
        : ["stash", "drop", `stash@{${index}}`];
  const r = await run(state.root, args, { write: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

/**
 * §2 — the junk guard. A pre-existing repo with no .gitignore would otherwise
 * let `add -A` sweep node_modules into the very first save.
 */
export function detectJunk(files: GitFileChange[]): string[] {
  const hit = new Set<string>();
  for (const f of files) {
    // ANY segment, not just the first: a monorepo's junk is
    // `packages/web/node_modules/…`, and matching only the root would wave it
    // through in exactly the repos that have the most of it. The .gitignore line
    // we then offer is the bare name, which ignores it at every depth anyway.
    for (const seg of f.path.split("/")) {
      if (JUNK_DIRS.includes(seg)) hit.add(seg);
    }
  }
  return [...hit].sort();
}

export async function appendGitignore(workspace: string, lines: string[]): Promise<void> {
  const state = await requireRepo(workspace);
  const root = state?.root ?? workspace;
  const file = path.join(root, ".gitignore");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = lines.filter((l) => !existing.split("\n").some((e) => e.trim() === l));
  if (!missing.length) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, `${existing}${prefix}${missing.join("\n")}\n`);
}

export interface InitPreview {
  /** Non-null = we refuse, and this says why (§5b: $HOME, /, volume roots). */
  refused: string | null;
  branch: string;
  gitignore: string;
}

export async function initPreview(workspace: string): Promise<InitPreview> {
  const refused = refuseInitReason(workspace);
  let branch = "main";
  if (await gitAvailable()) {
    const cfg = await run(workspace, ["config", "--get", "init.defaultBranch"]);
    if (cfg.ok && cfg.stdout.trim()) branch = cfg.stdout.trim();
  }
  return { refused, branch, gitignore: starterGitignore(workspace) };
}

function refuseInitReason(workspace: string): string | null {
  const abs = path.resolve(workspace);
  if (abs === path.parse(abs).root) return "This is the root of the filesystem.";
  if (abs === safeReal(os.homedir())) return "This is your home folder.";
  if (/^\/Volumes\/[^/]+$/.test(abs)) return "This is the root of a volume.";
  return null;
}

/** Only what is actually in the folder — a starter list naming absent dirs is
 *  noise the user has to read past before they trust the preview. */
function starterGitignore(workspace: string): string {
  let entries: string[] = [];
  try {
    const present = new Set(fs.readdirSync(workspace));
    entries = JUNK_DIRS.filter((d) => present.has(d));
  } catch {
    entries = [];
  }
  if (!entries.includes(".DS_Store") && process.platform === "darwin") entries.push(".DS_Store");
  return entries.join("\n");
}

/** §5b — init, write the .gitignore, and STOP. The first commit is the user's. */
export async function initRepo(workspace: string, gitignore: string): Promise<WriteResult> {
  if (!(await gitAvailable())) return { ok: false, error: "git is not installed." };
  const refused = refuseInitReason(workspace);
  if (refused) return { ok: false, error: refused };

  const preview = await initPreview(workspace);
  const r = await run(workspace, ["init", "-b", preview.branch], { write: true });
  if (!r.ok) return { ok: false, error: r.stderr.trim() };

  if (gitignore.trim()) {
    const file = path.join(workspace, ".gitignore");
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (!existing.trim()) fs.writeFileSync(file, `${gitignore.trimEnd()}\n`);
    else await appendGitignore(workspace, gitignore.split("\n").filter(Boolean));
  }
  invalidateProbe(workspace);
  return { ok: true };
}
