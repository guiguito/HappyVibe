# Git Integration (PRD §29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A beginner-safe full-ish git client — Changes drawer tab, per-hunk undo, save/sync/branch verbs, drafted commit messages — over the system git, with git as a feature and never a runtime dependency.

**Architecture:** One main-process runner (`src/main/git.ts`) over the system git binary (resolved shell PATH, `--no-optional-locks` reads, explicit repo root on every call), pure parsers vitest-importable without Electron, `hv:git-*` IPC shaped like `hv:mcp-*`, and a renderer `ChangesPanel` + `DiffView` that render **git's own hunks** (never the js `diff` library) so the hunk you see is the hunk `git apply -R` undoes. All panel actions are human-only (no `git_commit` tool); mutating verbs sit behind the same `activity.isIdle` gate MCP live-reload uses.

**Tech Stack:** system git (feature-detected), Node `child_process`, existing Electron IPC/preload plumbing, React renderer, vitest with throwaway real-git temp repos (key-free, `skipIf` when git absent).

**Spec:** PRD §29 (`docs/prd.md`, "## 29. Git integration") — the full round-locked spec. Long-form rationale: Notion page `3b1d33dfffca807ca1cad8b48c86b7a4`.

## Global Constraints

- Full gate = `npm run gate` (build → non-live suite, one command). Never run `npm run typecheck` separately before it.
- **NEVER pipe a test run to `tail`/`grep`** — redirect to a log file, `echo "EXIT=$?"`, then grep the log.
- No live-Pi batch required: this feature touches neither `pi-runtime/extensions/`, `src/main/pi/`, nor any live test file. After each task confirm `npm run live:why` prints nothing and SAY so.
- Every fs writer is path-confined (pattern: `files.ts` `resolveInWorkspace`). Every git call takes an explicit repo root — never assume the workspace path (worktrees-designed-for rule).
- All reads pass `--no-optional-locks` (global flag position: `git --no-optional-locks <verb> …`) so a background status never takes the index lock against the agent's own git commands.
- Human-only invariant: **no git tool is registered**. Nothing in `pi-runtime/` changes in this feature.
- Every mutating panel action is audited via `log.append` with `who: "human"` (the `ipc.ts:2041` shape).
- New tab types are forbidden: diffs are a mode of the existing file tab (`allFiles` invariant, `tabs.ts:132`).
- The renderer never invents its own diff for the panel: hunks come parsed from main, from git's unified output.
- Vocabulary: top-altitude copy uses only **Save a version / Sync / Undo**; git words (stash, staged, amend) appear only in the lower panel areas and mono command lines.

## File Map

| File | Role |
|---|---|
| `src/main/gitParse.ts` (new) | Pure parsers: porcelain v2, unified diff → hunks, numstat, log, stash list, ahead/behind. Electron-free. |
| `src/main/git.ts` (new) | Runner, availability + repo probe (5 outcomes, cached), readers/writers, init preview/apply, junk detection, reverse-apply undo. |
| `src/main/gitWatch.ts` (new) | Tiny non-recursive `.git` watch (`HEAD` + `index`) per workspace. |
| `src/main/gitMessage.ts` (new) | "Write it for me" one-shot draft (the `titles.ts` pattern). |
| `src/main/config.ts` (modify) | Seed-once default git permission rules; `gitMessageModel` persisted setting. |
| `src/main/ipc.ts` (modify) | `hv:git-*` handlers, idle gate, `hv:git-changed` push (watcher + `.git` watch + turn end, suppressed while busy), audit. |
| `src/preload/index.ts`, `src/renderer/src/hv.d.ts` (modify) | IPC surface. |
| `src/renderer/src/gitui.ts` (new) | Pure renderer helpers: badge tint thresholds, panel state machine, grouping. |
| `src/renderer/src/components/ChangesPanel.tsx` (new) | The drawer tab: branch bar, message box, baselines, file list, stashes, history, on-ramp, error states. |
| `src/renderer/src/components/DiffView.tsx` (new) | Shared git-hunk renderer with per-hunk/per-file Undo. |
| `src/renderer/src/App.tsx` (modify) | Drawer tab header `Files | Changes`, resizable drawer, toolbar badge, gitStatus state, turn-end refresh. |
| `src/renderer/src/components/Sidebar.tsx` (modify) | Workspace-row branch line + branch menu. |
| `src/renderer/src/components/FileTab.tsx` (modify) | Third pill state Source / Changes / Preview. |
| `src/renderer/src/components/WorkspaceSettingsView.tsx` (modify) | "Version control: git not found · Install" line. |
| `src/renderer/src/describeCommand.ts` (modify) | Richer git labels (branch names, commit messages from the string). |
| Tests | `tests/git-parse.test.ts`, `tests/git.test.ts`, `tests/git-message.test.ts`, `tests/git-rules-seed.test.ts`, `tests/gitui.test.ts`, `tests/describe-command.test.ts` (extend). |

---

### Task 1: Pure parsers — `gitParse.ts`

**Files:**
- Create: `src/main/gitParse.ts`
- Test: `tests/git-parse.test.ts`

**Interfaces (Produces — later tasks rely on these exact names):**

```ts
export interface GitFileChange {
  path: string;                // repo-relative, POSIX separators
  origPath?: string;           // renames only
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;             // true when the index half (X) is non-"."
  additions: number;           // from numstat; 0 until merged
  deletions: number;
}
export interface GitBranchInfo {
  branch: string | null;       // null = detached
  oid: string | null;          // null = unborn HEAD ("(initial)")
  upstream: string | null;
  ahead: number;
  behind: number;
}
export interface GitStatusResult { branch: GitBranchInfo; files: GitFileChange[] }
export interface DiffHunk {
  header: string;              // "@@ -a,b +c,d @@ ctx"
  lines: string[];             // raw unified lines incl. leading +/-/space
  raw: string;                 // header + lines + trailing \n — EXACTLY what apply -R gets
}
export interface FileDiff { path: string; origPath?: string; binary: boolean; hunks: DiffHunk[]; fileHeader: string }
export interface StashEntry { index: number; message: string }
export interface LogEntry { sha: string; subject: string; authorDate: string }

export function parsePorcelainV2(out: string): GitStatusResult;
export function parseUnifiedDiff(out: string): FileDiff[];
export function parseNumstat(out: string): Map<string, { additions: number; deletions: number }>;
export function mergeNumstat(files: GitFileChange[], stats: ReturnType<typeof parseNumstat>): GitFileChange[];
export function parseStashList(out: string): StashEntry[];   // input: `git stash list --format=%gd%x00%gs`
export function parseLog(out: string): LogEntry[];           // input: `git log --format=%H%x00%s%x00%aI`
/** Reassemble ONE hunk into a full patch git apply understands: fileHeader + hunk.raw. */
export function hunkPatch(fd: FileDiff, hunk: DiffHunk): string;
export function totalChangedLines(files: GitFileChange[]): number; // Σ additions+deletions (badge input)
```

Parsing facts the implementer needs (verified against git docs, not guessed):
- porcelain v2 header lines: `# branch.oid <oid|(initial)>`, `# branch.head <name|(detached)>`, `# branch.upstream <name>`, `# branch.ab +A -B`.
- entry lines: `1 XY … <path>` (ordinary), `2 XY … <score> <path>\t<origPath>` (rename), `u …` (unmerged — map to `modified`, never crash), `? <path>` (untracked), `! <path>` (ignored — skip).
- `XY`: X = staged half, Y = worktree half; `A`→added, `M`→modified, `D`→deleted, `R`→renamed. Status precedence: renamed > deleted > added > modified. `staged` = `X !== "."`.
- unified diff: file sections start `diff --git a/<p> b/<p>`; `Binary files … differ` → `binary: true, hunks: []`; `fileHeader` is everything from `diff --git` through the `+++` line (needed verbatim by `hunkPatch`).
- Use `\0`-separated custom formats for log/stash to survive any commit message.

- [ ] **Step 1: Write the failing tests** — fixture strings pasted into the test (one porcelain v2 block covering ordinary/rename/untracked/unmerged + `branch.ab +2 -1`; one two-file unified diff with 3 hunks and one binary file; numstat with a `-	-	bin` line; stash + log NUL formats). Assert every field above, and that `hunkPatch` output starts with the file header and contains exactly one `@@`.
- [ ] **Step 2: Run to verify fail** — `L=/tmp/vitest.log; npx vitest run tests/git-parse.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L` → FAIL (module not found).
- [ ] **Step 3: Implement `gitParse.ts`** — pure string functions, no imports beyond types.
- [ ] **Step 4: Run to verify pass** (same invocation) → EXIT=0.
- [ ] **Step 5: Commit** — `git add src/main/gitParse.ts tests/git-parse.test.ts && git commit -m "feat(git): pure parsers for porcelain v2, unified diff, numstat, stash, log"`

### Task 2: Runner, probe, readers, writers — `git.ts`

**Files:**
- Create: `src/main/git.ts`
- Test: `tests/git.test.ts`

**Interfaces:**
- Consumes: everything in `gitParse.ts`, `loginShellPath`/`mergePath` from `src/main/shellPath.ts`.
- Produces:

```ts
export type RepoState =
  | { kind: "no-git" }                                          // §5a
  | { kind: "no-repo" }                                         // §5b
  | { kind: "repo"; root: string; subdir: string | null; unborn: boolean } // §5c/§5d
  | { kind: "error"; message: string; fix: string | null };     // §5e — git's own words + copyable fix
export function probeWorkspace(workspace: string): Promise<RepoState>;   // cached per workspace
export function invalidateProbe(workspace: string): void;                // called on init / workspace remove
export function gitStatus(ws: string): Promise<{ state: RepoState; status?: GitStatusResult; stashes?: StashEntry[]; lastSubject?: string }>;
export function gitDiff(ws: string, baseline: "head" | "base", opts?: { staged?: boolean; path?: string }): Promise<FileDiff[]>;
export function gitHistory(ws: string, limit: number): Promise<LogEntry[]>;
export function gitShow(ws: string, sha: string): Promise<FileDiff[]>;
export function defaultBranch(root: string): Promise<string | null>;     // origin/HEAD, else main/master ref probe, else null
export function saveVersion(ws: string, message: string, opts: { stagedOnly: boolean; amend: boolean }): Promise<{ ok: true; sha: string } | { ok: false; error: string }>;
export function detectJunk(ws: string, files: GitFileChange[]): string[]; // junk dirs present in the save set
export function appendGitignore(root: string, lines: string[]): Promise<void>;
export function stageFile(ws: string, path: string, stage: boolean): Promise<void>;
export function switchBranch(ws: string, branch: string, opts: { create: boolean; mode: "take" | "stash" }): Promise<{ ok: boolean; error?: string; wouldConflict?: boolean }>;
export function listBranches(ws: string): Promise<string[]>;
export function fetch_(ws: string): Promise<{ ok: boolean; error?: string }>;
export function sync(ws: string): Promise<{ ok: boolean; error?: string; nonFF?: boolean }>;   // fetch → pull --ff-only if behind → push if ahead
export function publish(ws: string): Promise<{ ok: boolean; error?: string }>;                  // push -u origin <branch>
export function stash(ws: string, action: "save" | "pop" | "drop", index?: number): Promise<{ ok: boolean; error?: string }>;
export function undoHunk(ws: string, patch: string): Promise<{ ok: true } | { ok: false; stale: boolean; error: string }>; // apply -R --check first
export function undoFile(ws: string, path: string): Promise<{ ok: boolean; error?: string }>;   // git restore --worktree --staged -- <path>
export function discardUntracked(ws: string, path: string): Promise<{ ok: boolean; error?: string }>; // fs delete, path-confined
export function initPreview(ws: string): Promise<{ refused: string | null; branch: string; gitignore: string }>;
export function initRepo(ws: string, gitignore: string): Promise<{ ok: boolean; error?: string }>;
export const JUNK_DIRS: readonly string[]; // node_modules, .venv, venv, dist, build, out, .next, target, __pycache__, coverage, .DS_Store
```

Implementation rules (each is a spec line — do not trade away):
- `run(root, args, {write})`: `spawn` the resolved git with `cwd: root`, 30 s timeout (fetch/pull/push: 120 s), env PATH merged via `mergePath(process.env.PATH, loginShellPath())`. Reads prepend `--no-optional-locks`. Never `shell: true`.
- Availability: `git --version` once, cached; a failure (ENOENT, or the CLT-shim non-zero) → `no-git`.
- Probe: `git rev-parse --show-toplevel` in the workspace. Exit 128 + "not a git repository" → `no-repo`. Other 128s (dubious ownership, lock) → `error` with `message` = git's stderr and `fix` extracted when git itself prints a `git config --global --add safe.directory …` line, else null. `subdir` = workspace relative to root when they differ. `unborn` = `git rev-parse -q --verify HEAD` fails.
- **Pathspec confinement (§5c):** when `subdir` is set, every status/diff/add/restore/commit call appends `-- <subdir>`; branch ops and push are repo-wide by design.
- **Unborn baseline (§5d):** diff base = `git hash-object -t tree /dev/null` (asked per repo — SHA-256 repos differ), so `gitDiff` runs `git diff <emptyTree>` and every file reads as an addition; `base` baseline unavailable.
- `saveVersion`: `git add -A -- <subdir|.>` then `git commit -m <msg>` (never `commit -a`); `stagedOnly` skips the add; `amend` adds `--amend`.
- `switchBranch` mode `"take"`: plain `git switch` (create: `-c`); stderr matching "would be overwritten" → `{ok:false, wouldConflict:true}`. Mode `"stash"`: `git stash push -u -m "HappyVibe: switching to <branch>"` then switch.
- `undoHunk`: `git apply -R --check -` fed the patch on stdin; non-zero → `{ok:false, stale:true, error: stderr}` (the stale-check IS the check, no second mechanism); then `git apply -R -`.
- `initPreview`: refuse when workspace resolves to `os.homedir()`, `/`, or a `/Volumes/<x>` root → `refused` names it; branch from `git config --get init.defaultBranch` else `main`; gitignore = the `JUNK_DIRS` entries actually present in the folder, one per line.
- `discardUntracked` resolves through the same confinement pattern as `files.ts` (`resolveInWorkspace`) before unlinking.

- [ ] **Step 1: Write the failing tests** — `tests/git.test.ts`, `describe.skipIf(!gitAvailable)` where `gitAvailable` is a top-of-file `spawnSync("git", ["--version"])` probe. Build throwaway repos in `fs.mkdtempSync` (set `user.email`/`user.name`/`init.defaultBranch=main` locally, `HOME` untouched). Cases: probe all five outcomes (no-repo temp dir; subdir of a repo; unborn fresh init; a normal repo; `no-git` via injecting a bad binary path override — export a `setGitBinaryForTest(path)` hook); status + numstat merge on a repo with 1 modified + 1 untracked + 1 rename; save-version round trip incl. untracked (proves add -A not commit -a); staged-only (`Save 3 of 12` semantics); **undo round-trip**: modify a committed file, `gitDiff`, `hunkPatch`, `undoHunk` → file content back to committed state; stale refusal: same patch after an external edit → `{stale:true}` and file untouched; switch with dirty tree → `wouldConflict` when the branch differs in that file, plain success when not; stash save/pop; initPreview refusal on homedir, gitignore derivation with a planted `node_modules/`; unborn diff = all additions.
- [ ] **Step 2: Run to verify fail** → module not found.
- [ ] **Step 3: Implement `git.ts`.**
- [ ] **Step 4: Run to verify pass**; also run the full fast suite once (`npm test`) to prove nothing regressed.
- [ ] **Step 5: Commit** — `feat(git): runner, five-outcome probe, readers, writers, reverse-apply undo`

### Task 3: "Write it for me" — `gitMessage.ts` + persisted model

**Files:**
- Create: `src/main/gitMessage.ts`
- Modify: `src/main/config.ts` (persist `gitMessageModel: {provider, modelId} | null` beside the existing settings; null = the titles default)
- Test: `tests/git-message.test.ts`

**Interfaces:**
- Consumes: `nodeExecPath`, `PI_CLI_RELPATH` from `src/main/pi/spawn.ts` (the `titles.ts:30-45` spawn shape, copied not imported — titles is 26 lines, a shared abstraction is not worth it; `// ponytail:` comment says so).
- Produces:

```ts
export function buildDraftPrompt(input: { diff: string; files: GitFileChange[]; recentSubjects: string[] }, budgetChars: number): string;
export function draftCommitMessage(runtimeDir: string, workspace: string, input: {...as above}, model: {provider:string; modelId:string}, env?: Record<string,string>): Promise<string | null>;
```

- `buildDraftPrompt` is pure: under budget → full diff + the ~20 recent subjects labelled "match this style"; over budget → file list + per-file `+n −m` + first 5 lines of each hunk, and the prompt says the diff was truncated.
- `draftCommitMessage` mirrors `generateTitle` exactly: `pi -p --no-session --no-tools --no-extensions --provider … --model …`, stdin ignored, 60 s timeout, resolve null on any failure (quiet-failure rule — the caller hides the button).

- [ ] **Step 1: failing tests** for `buildDraftPrompt` only (the spawn half is the proven titles pattern; a live model call is not needed and would not be deterministic): under-budget contains the full diff and all subjects; over-budget contains no full hunk bodies, does contain every path and its `+n −m`, and names the truncation.
- [ ] **Step 2: verify fail.** — same redirect invocation.
- [ ] **Step 3: implement.**
- [ ] **Step 4: verify pass.**
- [ ] **Step 5: Commit** — `feat(git): commit-message draft via the one-shot titles pattern`

### Task 4: Default permission rules, seeded once

**Files:**
- Modify: `src/main/config.ts` (seeding), `src/main/index.ts` (call at startup if not already in config init path)
- Test: `tests/git-rules-seed.test.ts`

**Interfaces:**
- Produces: `export function seedDefaultGitRules(rulesPath: string, configDir: string): void` and `export const DEFAULT_GIT_RULES: Rule[]` (the `Rule` shape from `pi-runtime/extensions/hv-rules.ts:16` — `{layer:"command", pattern, action}`).

Rules (exact patterns from PRD §29): ask `git push*`, `git reset --hard*`, `git checkout -- *`, `git clean*`, `git rebase*`; deny `git push --force*`.

- Seed-once flag: a `gitRulesSeeded: true` key in the app config JSON (not a rules-file marker — the user deleting a rule must not resurrect it). If the flag is set, never touch the rules file again.
- Seeding appends to the `global` array of the existing `permission-rules.json` (parse with `parseRulesFile`, write back), creating the file if absent. Seeded rules carry no special marking — they are ordinary user rules, visible and deletable in the Permissions UI (that UI already exists; zero renderer work).

- [ ] **Step 1: failing tests** — fresh temp dir: seeding writes the six rules and sets the flag; second call is a no-op; user deletes a rule + reseed attempt → still deleted; existing user rules in the file are preserved verbatim.
- [ ] **Step 2: verify fail. Step 3: implement. Step 4: verify pass.**
- [ ] **Step 5: Commit** — `feat(git): default ask/deny rules seeded once, deletable like any user rule`

### Task 5: IPC layer, idle gate, `.git` watch, audit

**Files:**
- Create: `src/main/gitWatch.ts`
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Test: `tests/git-watch.test.ts` (watch only; handler glue is exercised by the GUI pass — `ipc.ts` handlers are thin delegations, the repo's standing pattern)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `activity.isIdle` (`src/main/activity.ts:92`); `affectedSessionIds` (`src/main/mcpReloadScope.ts`) for "sessions of this workspace"; `log.append` (`ipc.ts:1037` shape).
- Produces (preload names, all under the existing `window.hv`):

```ts
gitState(ws): Promise<RepoState & { available: boolean }>
gitStatus(ws): Promise<ReturnType-of-git.gitStatus>
gitDiff(ws, baseline, opts?): Promise<FileDiff[]>
gitHistory(ws, limit): Promise<LogEntry[]>;  gitShow(ws, sha): Promise<FileDiff[]>
gitBranches(ws): Promise<string[]>;          gitDefaultBranch(ws): Promise<string | null>
gitCommit(ws, message, {stagedOnly, amend}) · gitStage(ws, path, stage) · gitSwitch(ws, branch, {create, mode})
gitFetch(ws) · gitSync(ws) · gitPublish(ws) · gitStash(ws, action, index?)
gitUndoHunk(ws, patch) · gitUndoFile(ws, path) · gitDiscardUntracked(ws, path)
gitInitPreview(ws) · gitInit(ws, gitignore)
gitDraftMessage(ws, stagedOnly): Promise<string | null>
gitMessageModel(): Promise<{provider,modelId} | null> · setGitMessageModel(m)
onGitChanged(cb: (p: {workspaceId: string}) => void): () => void   // hv:git-changed
```

- **Idle gate** — one helper in ipc.ts: `const gitBusy = (ws) => affectedSessionIds(sessions, "workspace", ws).filter(id => !activity.isIdle(id))`. Mutating handlers (switch, stash, pull-inside-sync, undo*, discard, init) return `{ok:false, busy: [session titles]}` when non-empty. Commit, push, fetch, publish, stage skip the gate (history/remote, never files).
- **`hv:git-changed`** fires from three sources, debounced 300 ms per workspace: (1) the existing fs watcher callback in ipc.ts where `hv:fs-changed` is emitted; (2) `gitWatch.ts` — one **non-recursive** `fs.watch` on `<root>/.git` filtered to `HEAD`/`index` events (this is what catches an outside-terminal branch switch, since `watch.ts:54` filters `.git` out); (3) turn end (`agent_end` in the existing event fan-out). Sources (1)+(2) are **suppressed while any session of the workspace is busy** — the turn-end refresh catches everything at once.
- **Audit:** every successful mutating action appends `{type:"git.action", workspaceId, data:{action, detail, who:"human"}}` — e.g. `{action:"undo-hunk", detail:{path, hunks:1}}`, `{action:"commit", detail:{sha, files}}`.
- `gitDraftMessage` resolves the model: persisted `gitMessageModel` else the titles default; assembles input via `gitDiff` + `gitHistory(20)` + `buildDraftPrompt`; audit is not needed (it writes nothing).

- [ ] **Step 1: failing test** — `tests/git-watch.test.ts`: temp dir with a fake `.git/HEAD`; start watch; rewrite HEAD → callback fires once (debounced); touching `.git/objects/xx` does NOT fire; unwatch stops it.
- [ ] **Step 2: verify fail. Step 3: implement `gitWatch.ts`, then the ipc.ts handlers + preload + hv.d.ts types. Step 4: verify pass, then `npm run gate` (typecheck rides the build).**
- [ ] **Step 5: Commit** — `feat(git): hv:git-* IPC, idle gate on tree-mutating verbs, .git watch, audit`

### Task 6: Renderer pure helpers — `gitui.ts`

**Files:**
- Create: `src/renderer/src/gitui.ts`
- Test: `tests/gitui.test.ts`

**Interfaces (Produces):**

```ts
export function badgeTint(changedLines: number): "green" | "amber";   // <50 green, ≥50 amber — NO red tier
export function groupByDir(files: GitFileChange[]): { dir: string; files: GitFileChange[] }[];
export type PrimaryAction =
  | { kind: "save"; label: string; count?: [number, number] }  // "Save a version" | "Save 3 of 12"
  | { kind: "publish" } | { kind: "sync"; n: number } | { kind: "none" };
export function primaryAction(s: { files: GitFileChange[]; stagedCount: number; upstream: string | null; ahead: number; behind: number }): PrimaryAction;
export function statusGlyph(s: GitFileChange["status"]): string;      // A M D R U
```

`primaryAction` truth table (from PRD §29 panel decision): files present & stagedCount 0 → save "Save a version"; files present & staged n of m → save "Save n of m" with count; clean & no upstream & has commits → publish; clean & upstream & ahead+behind>0 → sync(ahead); clean & synced → none (the "All saved ✨" state).

- [ ] **Step 1: failing tests** covering the full truth table, the 49/50 tint boundary, grouping order (dirs sorted, root last), glyphs.
- [ ] **Step 2–4: fail → implement → pass.**
- [ ] **Step 5: Commit** — `feat(git): renderer pure helpers — badge tint, primary action, grouping`

### Task 7: Drawer becomes `Files | Changes` — resizable, badged entry point

**Files:**
- Modify: `src/renderer/src/App.tsx` (drawer block at `App.tsx:2391`, toolbar at `App.tsx:2201`)
- Test: GUI assertions (§Verification) — layout state is App-owned useState/localStorage, no unit seam worth building.

Changes, precisely:
- The `TREE &&` overlay div gains a two-tab header (`Files | Changes`) above its content; active tab per workspace persisted in `localStorage` `hv:drawer-tab:<wsId>`; `Changes` tab **absent entirely** when `gitState.kind === "no-git"` or `available === false`.
- Drawer width: a drag handle on its left edge, `useState` + `localStorage` `hv:drawer-width` (global, not per workspace), clamped 256–720 px, default 256. The existing `w-64` becomes `style={{width}}`.
- Toolbar files icon: when the active workspace's status has files, a count bubble tinted by `badgeTint(totalChangedLines(files))`; clicking with changes present opens the drawer **onto Changes**; with none, onto the remembered tab. No other entry point, no popup — review is user-initiated.
- App owns `gitStatus` per workspace: fetched when a workspace becomes active, on `onGitChanged`, and on turn end (the existing `agent_end` handling in App already exists for other refreshes — piggyback there). Passed down to ChangesPanel/Sidebar/FileTab in later tasks.
- [ ] **Step 1: implement** (no failing-test step — renderer wiring; the observable claims are in §Verification).
- [ ] **Step 2: `npm run gate`** → green.
- [ ] **Step 3: Commit** — `feat(git): drawer gains Files|Changes tabs, resizable width, badged toolbar entry`

### Task 8: `ChangesPanel` — read surfaces and the five outcomes

**Files:**
- Create: `src/renderer/src/components/ChangesPanel.tsx`
- Modify: `src/renderer/src/App.tsx` (render it in the Changes tab)
- Test: GUI assertions; pure logic already tested in Task 6.

Top-to-bottom, exactly the PRD §29 panel order: branch bar (`⎇ name`, switcher opens the branch list, New branch, Fetch; **Sync (n)** appears only when an upstream exists — ahead/behind figures live in the button's `title` tooltip and the mono command line, never the bar) · message box + primary split button from `primaryAction` (dropdown: *Commit staged only* / *Amend last* / *Stash*) · baseline selector (**Since your last save** default / **Against \<base\>** only when `gitDefaultBranch` resolves and HEAD is born) · file list via `groupByDir` with `+n −m`, glyphs, hover actions (stage toggle, open diff, Undo file), untracked under their own heading · **Stashes** row only when `stashes.length > 0` (count → expand → Restore/Delete-confirmed) · **History** collapsed (`gitHistory(ws, 20)`, click → `gitShow` rendered in the same DiffView) · clean state “All saved ✨”.
Five outcomes: `no-git` → the tab isn't rendered at all (Task 7 already guards); `no-repo` → the on-ramp sentence + **Start tracking** (wired in Task 9); `repo` with `subdir` → the branch bar suffixes `· repo at <root> · showing <subdir>`; `unborn` → all-additions list under “Save your first version”; `error` → git's message verbatim in mono + the copyable fix line, writes disabled with the reason, reads still shown.
Every action button, on completion, shows the exact command it ran in a mono line under the panel header (one-slot, latest action) — the two-altitude honesty rule.
Busy-gate errors (`{busy:[…]}`) render as an inline notice naming the sessions, never a dialog.
- [ ] **Step 1: implement. Step 2: `npm run gate` green. Step 3: Commit** — `feat(git): ChangesPanel — branch bar, save/sync, baselines, files, stashes, history, five outcomes`

### Task 9: Panel actions — save (junk guard), sync, switch dialog, init on-ramp, Write-it-for-me

**Files:**
- Modify: `src/renderer/src/components/ChangesPanel.tsx`
- Test: GUI assertions; `detectJunk`/`initPreview`/`buildDraftPrompt` already unit-tested.

- **Save a version:** before committing, `detectJunk` result non-empty → a confirm listing the junk dirs with *Add to .gitignore and save* (calls `appendGitignore` then commit) / *Save everything anyway* — declining still saves, it is their repo.
- **Switch with dirty tree:** attempt `gitSwitch(…, {mode:"take"})`; on `wouldConflict` show the three-choice dialog *Take changes with me* (absent in this case, with the reason) / *Save a version first* / *Stash them*; with a clean-enough tree the take path just succeeds silently. First-class dialog — the one exception to show-git's-message.
- **Sync:** `gitSync`; `nonFF` result → inline notice "The remote has changes that can't fast-forward. Pull stopped — nothing was merged." (no conflict UI, §7 out of scope).
- **Init on-ramp:** Start tracking → `gitInitPreview` → dialog showing the branch name and an **editable** gitignore textarea + the mono `git init` line; `refused` renders the refusal instead of the button. After `gitInit`, the panel shows every file as new under "Save your first version". No auto-commit.
- **Write it for me:** button beside the message box, **rendered only after a successful draft-capability probe** (a provider is configured — reuse the same check the composer uses for model availability); fills the box editable, never commits; `title` tooltip: "Drafts from the diff · ~$0.001 per draft · model: <name>"; a small chevron opens the model dropdown (ModelSelect reused, persisted via `setGitMessageModel`). Failure (null) → button quietly disables for the session, no error surface.
- First-ever commit in a repo (history was empty before the save) → the celebration beat: the "All saved ✨" state plus a one-time confetti-free flourish consistent with the sticker style (a scale-in of the ✨ line is enough — no new dependency).
- [ ] **Step 1: implement. Step 2: `npm run gate` green. Step 3: Commit** — `feat(git): save with junk guard, three-choice switch, ff-only sync, init on-ramp, drafted messages`

### Task 10: `DiffView` + per-hunk undo + FileTab third state

**Files:**
- Create: `src/renderer/src/components/DiffView.tsx`
- Modify: `src/renderer/src/components/FileTab.tsx` (pill at `FileTab.tsx:195`), `src/renderer/src/components/ChangesPanel.tsx` (deleted-file inline diff), `src/renderer/src/App.tsx` (pass `hasChanges`/diff accessor to FileTab)
- Test: GUI assertions; the undo round-trip and stale refusal are pinned in `tests/git.test.ts`.

- `DiffView` renders `FileDiff[]` from main — git's hunks verbatim, add/del/ctx line classes matching the tool cards' existing diff styling. Per hunk: **Undo** (confirm dialog naming the file and "1 hunk", then `gitUndoHunk(ws, hunkPatch(fd, hunk))`); per file: **Undo file** (confirm names the hunk count); untracked file rows read **Discard new file** and confirm. `{stale:true}` → toast "src/foo.ts changed since this diff — nothing was touched" and a refetch. Success → toast naming file + hunk count (never silent).
- `FileTab` pill: `view: "rendered" | "raw" | "changes"`; the Changes segment appears only when App reports the file in the changed set; selecting it renders `DiffView` for that one path (`gitDiff(ws, baseline, {path})`, baseline = the panel's per-workspace selection). Undoing the **last** hunk while in `changes` → view snaps to `raw` (Source) + toast "All changes undone" — the mode never vanishes under the user.
- Deleted files (no tab to open): the panel row expands inline to a `DiffView` of that file.
- [ ] **Step 1: implement. Step 2: `npm run gate` green. Step 3: Commit** — `feat(git): DiffView with per-hunk undo; the file tab learns a Changes mode`

### Task 11: Sidebar branch line, settings capability line, richer git labels

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` (new prop `gitInfo: Record<string, { branch: string | null; changedLines: number | null }>` — `null` branch = not a repo, `null` changedLines = not the active workspace), `src/renderer/src/App.tsx` (feed it), `src/renderer/src/components/WorkspaceSettingsView.tsx`, `src/renderer/src/describeCommand.ts`
- Test: extend `tests/describe-command.test.ts`; rest is GUI-verified.

- Sidebar: second line `⎇ <branch> · <n> changes` under the workspace row — count only for the active workspace, tinted by `badgeTint`; the line is **absent, not greyed**, when `branch` is null; click opens a small branch menu (list from `gitBranches`, current checked, *New branch…* input row) using the click-catcher dismissal idiom every other menu uses (`fixed inset-0` — NOT onBlur, per the TabStrip lesson).
- Branch names for **all** workspaces ride `gitWatch` (cheap); the change count refreshes only with the active workspace's status (no boot-time status sweep of every repo).
- WorkspaceSettingsView: one line — *"Version control: git not found · Install"* → `Install` triggers the CLT installer by spawning `git --version` un-suppressed once (macOS pops the CLT dialog); shown only in the `no-git` state.
- `describeCommand.ts`: extend the `git` branch — `commit` extracts the `-m` message (`Committing: "fix the retry loop"`), `push`/`pull` name the branch/remote when present in the string, add verbs `fetch`, `stash`, `restore`, `init`, `merge`, `rebase`, `clone`, `tag`. File lists are NOT in the string — no card pretends otherwise (the panel link is App-level: tool cards for git commands get a small "View in Changes" affordance ONLY if trivially wireable through existing card props; otherwise skip — the panel's turn-end refresh already covers the need, and the PRD's wording is "links to the Changes panel for those rather than pretending", satisfied by not pretending).
- [ ] **Step 1: failing describeCommand tests** (commit -m extraction, push origin main, stash, init). **Step 2–4: fail → implement → pass.** Then implement the renderer pieces, `npm run gate`.
- [ ] **Step 5: Commit** — `feat(git): sidebar branch line, git-not-found capability line, richer bash git labels`

### Task 12: Full gate + GUI verification pass

- [ ] `npm run gate` → green (build runs both typechecks first). `npm run live:why` → confirm it prints nothing and say so (nothing here touches Pi-facing files).
- [ ] Restart the dev server (main changed — a renderer reload does NOT pick up `src/main`), then run the GUI assertions below with the running app (`/uicheck` discipline: no claiming fixed without a picture).

## GUI Verification — observable claims

Run in the HappyVibe repo itself (a real git repo, currently on `git-integration-v1`) plus one scratch non-repo folder added as a second workspace.

**Changes drawer (the drawer, Files→Changes tab):**
- The drawer header shows `Files | Changes`; the drawer edge drags to resize and the width survives a reload; the chosen tab survives a workspace switch away and back.
- With an edited file, the panel shows the branch bar reading `⎇ git-integration-v1`, the file grouped under its directory with `+n −m`, and a **Save a version** button.
- The mono command line appears under the header after any action, showing the literal git command that ran.
- **Absence:** the branch bar contains no "ahead/behind" text anywhere — those figures exist only in the Sync button's tooltip. **Absence:** no Stashes row is visible when `git stash list` is empty. **Absence:** with a clean tree the message box area shows "All saved ✨" and no Save button.
- Stage exactly 1 of 3 changed files → the button reads `Save 1 of 3`.
- Edit a `node_modules`-free scratch repo, plant `node_modules/x.js` untracked with no `.gitignore` → Save pauses with the junk dialog naming `node_modules`; *Add to .gitignore and save* results in a commit whose diff (History → top entry) contains `.gitignore` and NOT `node_modules/x.js`.

**Diff + undo (file tab pill, observed in the editor):**
- Opening a changed file shows a three-segment pill **Source / Changes / Preview**; an unchanged file shows no Changes segment (**absence**). A non-previewable changed file (e.g. `.ts`) shows Source / Changes only.
- Undo on a single hunk asks a confirm naming the file and hunk count; after confirm the editor content reverts and a toast names the file.
- **Regression sequence (the mode-vanishes riddle):** make exactly one hunk in a file → open Changes mode → Undo the hunk → the pill snaps to Source with the "All changes undone" toast, and the Changes segment is gone.
- **Stale refusal:** open Changes mode, edit the same region in an outside editor, then Undo → a toast says the file changed and nothing was touched; the outside edit survives byte-identical.

**Idle gate (Changes panel, while a session is busy):**
- Start a long agent turn, then try a branch switch → an inline notice names the busy session; Save a version still works during the same turn (commit is not gated).
- End the turn → the badge and panel refresh without clicking anything (turn-end refresh).

**Sidebar:**
- The repo workspace row shows a second line `⎇ git-integration-v1 · n changes`; the count matches the panel's file count.
- **Absence (the thing the feature exists to exclude):** the scratch non-repo workspace row has NO branch line — not a greyed one, none.
- Switch branch in an outside terminal (`git switch -c tmp && git switch -`) → the sidebar line updates within ~a second without touching the app (the `.git` watch).

**Non-repo on-ramp (Changes tab of the scratch workspace):**
- Shows "This project isn't tracking versions yet · Start tracking"; the preview dialog shows an editable `.gitignore` (listing only junk dirs actually present) and the branch name; after init the panel lists every file as new under "Save your first version" — and **absence:** no commit exists yet (History is empty) until the user's own first Save.

**Permissions page (the surface that owns the rules, not the one that changed):**
- Six new rules are listed among ordinary user rules: ask on `git push*`, `git reset --hard*`, `git checkout -- *`, `git clean*`, `git rebase*`, deny on `git push --force*`; deleting one and restarting the app does NOT bring it back (**absence** after restart).

**All Tools page:**
- **Absence:** no `git_commit` / `git_*` tool appears anywhere — the agent's only git is bash.

**Cost dashboard:**
- **Absence:** after using "Write it for me", no new ledger line appears (the tooltip carries the cost disclosure instead).

**Write it for me (Changes panel):**
- With a provider configured, the button fills the message box with an editable draft whose style matches this repo's log (plain sentences, no conventional-commit prefix); the tooltip names the approximate cost and current model; the chevron opens a model picker with the default preselected.

## Execution record (2026-08-16)

All twelve tasks executed. What the plan did not predict, recorded because it is the part worth reading:

- **T1/T2 — two parser bugs the tests caught, not the reader.** The trailing `""` from `split("\n")` became a phantom context line on the LAST hunk of every diff, which would have made every last-hunk undo refuse as "stale"; it hid because the first round-trip test undid `hunks[0]`. And the repo-root comparison needed `realpath` on both sides — macOS answers `/private/var` to a `/var` question, so every temp-dir repo classified as a subdirectory of itself. Both now have named regression tests.
- **T2 — `detectJunk` matched only the first path segment**, surfaced by an unused-parameter typecheck error rather than a failing test. A monorepo's junk is `packages/web/node_modules/…`, so the guard would have waved it through in exactly the repos that have the most of it.
- **T5 — the `.git` watch could not be built as designed.** Filtering events by filename does not work: macOS reports a spurious `rename "HEAD"` for a write three levels down in `.git/objects/`. Replaced with a fingerprint of HEAD's contents + the index's mtime/size. Measured, not guessed.
- **T5 — the NUL-byte guard (`tests/no-nul-bytes.test.ts`) fired**, on two field separators written as literal NULs. Exactly the failure it exists for; both files would have been invisible to grep.
- **New: `tests/git-remote.test.ts`** — the user asked for real-remote coverage, so the network verbs run against `guiguito/TestHappyVibeGit`. Five tests, including the one that matters most: a genuinely diverged branch returns `nonFF` and merges nothing.
- **T3 — the live arm runs on `deepseek-v4-flash`** and is a new live-batch file (`npm run live:why` now prints it). Style-matching verified by hand: this repo's history drafts `feat(git): …`, a plain-sentence history drafts `Add pancake recipe`.
- **Two pre-existing `describe-command` tests changed expectation** (not weakened): they assert `&&` inside a `-m` message does not split the command, which they still prove now that the label quotes the message.

### GUI pass result (2026-08-16, real app, real repo, real remote)

Driven through CDP against the running dev app, using `guiguito/TestHappyVibeGit` (the user's real GitHub test repo) and a throwaway non-repo folder. Every assertion below was observed on screen or in the app's own IPC, not inferred.

Confirmed: drawer `Files | Changes` with the Changes tab absent on no-git · badge `3` tinted green on the toolbar icon and `⎇ main · 3 changes` in the sidebar · **absence: no branch line on the non-repo workspace**, and none on the user's three existing non-repo projects · panel order exactly as specced · **absence: no ahead/behind text in the branch bar** (it is in the Sync tooltip, observed as "2 to send, 0 to receive") · **absence: no Stashes row with no stashes** · "Write it for me" drafted "Add README and source file" live on deepseek-v4-flash, tooltip carrying the cost line · Save a version → toast, clean tree, mono line `$ git add -A && git commit -m "…"` · Sync pushed to GitHub, verified by `ls-remote` · file-tab pill showed Source + Changes (no Preview on a `.txt`) · per-hunk Undo confirmed, reversed exactly one hunk, left the other (`first` restored, `TENTH` untouched) · **regression sequence passed**: undoing the last hunk removed the Changes segment and toasted "All changes undone" · init on-ramp previewed `git init -b main` with an editable `.gitignore` derived from what was actually present (`node_modules`, `.DS_Store`), left HEAD unborn, then celebrated "Saved your first version 🎉" · **absence: `node_modules/dep.js` never appeared in the file list** once the gitignore landed · idle gate refused a switch with "A session is working in this project — …" while commit stayed available · **absence: no `git_*` tool anywhere** (`pi-runtime/extensions/` contains zero git references) · six seeded rules present in the real rules file.

Two bugs found here and fixed (commit `0b35117`): the cached `unborn` flag, and §5b's missing "Save your first version" nudge.

## Self-review notes

- Spec coverage: every §29 decision maps to a task — vocabulary/two-altitude (T8/T9 copy rules + mono line), where-it-lives (T7/T11), file-tab mode (T10), panel order (T8), staging-optional + add -A + junk guard (T2/T9), Write-it-for-me incl. cost tooltip + model dropdown (T3/T9), per-hunk undo four rules (T2/T10), idle gate + ff-only + switch dialog (T5/T9), default rules + engine honesty (T4, honesty lives in the PRD text not code), describeCommand + turn-end refresh (T11/T5), five outcomes (T2/T8/T11), worktrees-designed-for (explicit root in every T2 signature), out-of-scope respected (no conflict UI, no PR/auth, no worktrees).
- The accepted §8 risks need no code: the stale-belief limitation ships as designed (confirm-only), and the "mention this to the agent" checkbox is deliberately NOT built until it bites.
- Type consistency: `GitFileChange`/`FileDiff`/`hunkPatch` names match across T1→T2→T5→T10; `badgeTint`/`primaryAction` match T6→T7→T8→T11.
