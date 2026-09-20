# Git worktrees — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project row in the sidebar lists the git worktrees of that repository; a worktree is a root the user can open sessions, tabs and terminals in; the Changes panel can create one, merge one back and remove one — all human-only, all through the existing git layer.

**Architecture:** A worktree is a ROOT, never a workspace: it is never written to the registry, `git worktree list --porcelain` is the source of truth, and a session in one simply stores the worktree path as its `workspaceId`. One new main module (`src/main/worktrees.ts`) owns the discovery cache and answers three questions — `roots()` (what the app admits), `parentOf(path)` (whose config to read) and `of(parent)` (what the sidebar shows). Verbs are `git.ts` functions behind `hv:*` handlers shaped like the existing `hv:git-*` ones. The renderer gets one new prop (`worktrees`) and one new payload field (`worktreeOf`); everything else keys on `wsId` already.

**Tech Stack:** git ≥ 2.42 via the existing `run()` in `src/main/git.ts`; vitest with real temp repos (`tests/memory-store.test.ts` harness); React sidebar/panel; no new dependencies.

**Spec:** Notion "Git Worktrees" (`3bbd33dfffca80d5b83cdc4ab3497efc`, locked 2026-09-20); PRD `docs/prd.md` §5 (2026-09-20 decision) and §29 (2026-09-20 decision). Read both before starting.

## Global Constraints

- **The app creates worktrees OUTSIDE the repository:** `<agentDir>/worktrees/<projectKey>/<slug>/`, `projectKey = workspaceMemoryKey(ws, gitCommonDir(ws))` (the §33 key, reused, not re-derived). Never `<workspace>/.worktrees/`, never a `.git/info/exclude` line, never `.gitignore`.
- **A registered path wins.** A linked worktree that is itself a registered workspace is its own project row, never listed under its parent, and `parentOf` answers `null` for it.
- **One predicate.** `worktrees.roots()` is the list form of the spec's `isWorkspaceRoot` — the fs helpers already take a list of admitted roots, so the predicate is `roots().some(…)` and no second function is needed. Every fs entry point that takes a SESSION's `workspaceId` or a renderer-supplied path admits roots through `worktrees.roots()`. Every read of project CONFIG (model override, bypass, activations, memory toggle, skills dirs, `.mcp.json`, schedules, the workspace settings page) keeps `workspaces.list()` / `workspaces.get*()` and routes a worktree through `worktrees.projectOf()`. A new call site that re-spells either check is a review red.
- **Human-only.** No tool creates, merges or removes a worktree. Every verb is audited as `git.action` with `who: "human"` through the existing `auditGit`.
- **Show every worktree git reports**, minus the main worktree and registered paths. Sidebar navigates; the Changes panel acts. No `⋯` menus, no split buttons in the sidebar.
- **git is a feature, never a dependency** (§29): every new `git.ts` function returns `[]` / `{ok:false}` on `no-git` / `no-repo`; nothing throws for a missing binary.
- **Windows:** every path compare goes through `normPath` (store.ts); git answers forward slashes and `path.resolve` folds them.
- **`npm run gate` green after every task. Never pipe a test run to `tail`/`grep`** — redirect to a file and grep the file (CLAUDE.md §Tests).
- **`npm run live:why` will print nothing for this round** (no `pi-runtime/` or `src/main/pi/` change); say so in the commit, do not run the live batch.
- Copy goes through `HOWTO_COPY` / `EMPTY_COPY`; every key must have a `copy="key"` call site or its test fails.

## File map

| File | Responsibility |
|---|---|
| `src/main/gitParse.ts` | `WorktreeEntry`, `parseWorktreeList` (pure) |
| `src/main/git.ts` | `listWorktrees`, `worktreeVerbs`, `addWorktree`, `mergeCheck`, `mergeBranch`, `removeWorktree`, `pruneWorktrees` |
| `src/main/worktreeSlug.ts` | **new, import-free** — `worktreeSlug`; the renderer imports it for the folder preview (the `schedules.ts` rule: one `import fs` here puts `node:fs` in the browser bundle) |
| `src/main/worktrees.ts` | **new** — `WorktreeIndex` (discovery cache + `roots`/`parentOf`/`projectOf`/`of`/`all`), `worktreeDir`, `sessionsOfProject` |
| `src/main/gitWatch.ts` | fingerprint gains `.git/worktrees` mtime |
| `src/main/gitRules.ts` | `git worktree remove --force*` → ask |
| `src/main/ipc.ts` | index wiring, `roots()` at fs entry points, `projectOf` in `spawnOpts`, handlers, pushes, Forget/Delete, audit/analytics remap |
| `src/preload/index.ts`, `src/renderer/src/hv.d.ts` | `worktreeList`, `onWorktreesChanged`, `worktreeAdd`, `worktreeRemove`, `worktreePrune`, `gitMergeCheck`, `gitMerge`; `HvWorktreeInfo`; payload `worktreeOf` + `worktreeAdd` |
| `src/renderer/src/App.tsx` | `worktrees` state, alive set, branch loads over all roots, `activateRoot` |
| `src/renderer/src/components/Sidebar.tsx` | Worktrees heading + rows, per-path collapse, prunable row |
| `src/renderer/src/components/ChangesPanel.tsx` | header suffix, *New worktree…* row + dialog, worktree cluster + dialogs |
| `src/renderer/src/components/HowItWorks.tsx` | `worktrees` copy |
| `tests/worktrees-parse.test.ts`, `tests/worktrees.test.ts`, `tests/worktree-verbs.test.ts`, `tests/worktrees-roots.test.ts` | new |
| `tests/git-rules-seed.test.ts`, `tests/layout-persist.test.ts`, `tests/how-it-works.test.ts` | one assertion each |
| `docs/validation/wt1.md`, `CLAUDE.md` | measurements; the two traps |

---

## Phase 1 — see them

### Task 1: `parseWorktreeList` + the porcelain contract

**Files:**
- Modify: `src/main/gitParse.ts` (append after `parseLog`)
- Test: `tests/worktrees-parse.test.ts`

**Interfaces:**
- Produces: `interface WorktreeEntry { path: string; head: string; branch: string | null; bare: boolean; locked: boolean; prunable: boolean }` and `parseWorktreeList(out: string): WorktreeEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorktreeList } from "../src/main/gitParse";

/**
 * Captured from git 2.50.1 (Apple Git-155) on 2026-09-20 against a throwaway repo:
 * one linked worktree, locked; one detached worktree whose folder was then deleted
 * (so git reports it prunable). Paths shortened, nothing else edited.
 */
const PORCELAIN = `worktree /tmp/x/m
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/main

worktree /tmp/x/det
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
detached
prunable gitdir file points to non-existent location

worktree /tmp/x/wt
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/side
locked

`;

describe("parseWorktreeList", () => {
  it("reads the three record shapes: branch, detached+prunable, locked", () => {
    const e = parseWorktreeList(PORCELAIN);
    expect(e.map((x) => x.path)).toEqual(["/tmp/x/m", "/tmp/x/det", "/tmp/x/wt"]);
    expect(e[0]).toMatchObject({ branch: "main", locked: false, prunable: false, bare: false });
    expect(e[1]).toMatchObject({ branch: null, prunable: true });
    expect(e[2]).toMatchObject({ branch: "side", locked: true });
    expect(e[0].head).toBe("9d40ce9b2216ab451bfab39e89ec843f48049c4e");
  });
  it("empty output is an empty list", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

const HAVE_GIT = ((): boolean => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch { return false; } })();

/**
 * Contract: the installed git still speaks the keys we parse. A future git that
 * renames `prunable` fails HERE, not as a sidebar row that silently stays clickable.
 */
describe.skipIf(!HAVE_GIT)("git worktree list --porcelain contract", () => {
  it("every key in live output is one we know, and the three states round-trip", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-parse-"));
    const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf8" });
    const m = path.join(root, "m"); fs.mkdirSync(m);
    git(m, "init", "-q"); git(m, "config", "user.email", "t@x"); git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a"); git(m, "add", "-A"); git(m, "commit", "-qm", "i");
    git(m, "worktree", "add", "-q", path.join(root, "wt"), "-b", "side");
    git(m, "worktree", "add", "-q", "--detach", path.join(root, "det"));
    git(m, "worktree", "lock", path.join(root, "wt"));
    fs.rmSync(path.join(root, "det"), { recursive: true, force: true });
    const out = git(m, "worktree", "list", "--porcelain");
    const keys = new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]));
    for (const k of keys) expect(["worktree", "HEAD", "branch", "detached", "bare", "locked", "prunable"]).toContain(k);
    const e = parseWorktreeList(out);
    expect(e.find((x) => x.branch === "side")?.locked).toBe(true);
    expect(e.find((x) => x.branch === null)?.prunable).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/worktrees-parse.test.ts > /tmp/v.log 2>&1; echo EXIT=$?; tail -20 /tmp/v.log` → `parseWorktreeList is not a function`.

- [ ] **Step 3: Implement** (append to `gitParse.ts`):

```ts
export interface WorktreeEntry {
  path: string;
  head: string;
  /** Short name (`refs/heads/` stripped); null when detached. */
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** `git worktree list --porcelain` — one record per blank-line-separated block. */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of out.split(/\n\n+/)) {
    let e: WorktreeEntry | null = null;
    for (const line of block.split("\n")) {
      const sp = line.indexOf(" ");
      const key = sp === -1 ? line : line.slice(0, sp);
      const val = sp === -1 ? "" : line.slice(sp + 1);
      if (key === "worktree") e = { path: val, head: "", branch: null, bare: false, locked: false, prunable: false };
      else if (!e) continue;
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
```

- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add src/main/gitParse.ts tests/worktrees-parse.test.ts && git commit -m "feat(§29): parse git worktree list --porcelain, pinned to the installed git"`

---

### Task 2: `listWorktrees`, the `WorktreeIndex`, the slug

**Files:**
- Modify: `src/main/git.ts` (after `listBranches`)
- Create: `src/main/worktreeSlug.ts`, `src/main/worktrees.ts`
- Test: `tests/worktrees.test.ts`

**Interfaces:**
- Consumes: `WorktreeEntry`, `parseWorktreeList` (Task 1); `requireRepo`, `run`, `safeReal` (git.ts, existing); `normPath`, `SessionMeta` (store.ts).
- Produces:
  - `listWorktrees(workspace: string): Promise<WorktreeEntry[]>` — linked worktrees only (main and bare dropped), paths `path.resolve`d.
  - `worktreeSlug(branch: string): string` (import-free file).
  - `type WorktreeInfo = Pick<WorktreeEntry, "path"|"branch"|"head"|"locked"|"prunable">`
  - `class WorktreeIndex { constructor(registered: () => string[]); set(parent, entries): boolean; remove(parent): void; of(parent): WorktreeInfo[]; all(): Record<string, WorktreeInfo[]>; parentOf(p): string | null; projectOf(p): string; roots(): string[] }`
  - `worktreeDir(agentDir: string, projectKey: string, slug: string): string`
  - `sessionsOfProject(sessions: SessionMeta[], parent: string, worktreePaths: string[]): SessionMeta[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listWorktrees, resetGitAvailability } from "../src/main/git";
import { worktreeSlug } from "../src/main/worktreeSlug";
import { WorktreeIndex, sessionsOfProject, worktreeDir } from "../src/main/worktrees";
import type { SessionMeta } from "../src/main/store";

const entry = (p: string, branch: string | null = "b", extra: Partial<{ prunable: boolean; locked: boolean }> = {}) =>
  ({ path: p, head: "abc", branch, bare: false, locked: false, prunable: false, ...extra });

describe("worktreeSlug", () => {
  it("folds separators and punctuation, trims, caps at 64", () => {
    expect(worktreeSlug("feat/log in!")).toBe("feat-log-in");
    expect(worktreeSlug("a".repeat(80))).toHaveLength(64);
    expect(worktreeSlug("///")).toBe("worktree");
  });
});

describe("worktreeSlug.ts is import-free", () => {
  it("has no import statement — the renderer bundles it", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/main/worktreeSlug.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import /m);
  });
});

describe("WorktreeIndex", () => {
  const registered = ["/p/main", "/p/orca-wt"];
  const idx = new WorktreeIndex(() => registered);
  idx.set("/p/main", [entry("/p/orca-wt", "orca"), entry("/p/wt1", "feat"), entry("/p/gone", null, { prunable: true })]);

  it("of(parent) drops a registered path — the registered path wins", () => {
    expect(idx.of("/p/main").map((w) => w.path)).toEqual(["/p/wt1", "/p/gone"]);
  });
  it("parentOf routes only UNREGISTERED worktrees", () => {
    expect(idx.parentOf("/p/wt1")).toBe("/p/main");
    expect(idx.parentOf("/p/orca-wt")).toBeNull();
    expect(idx.parentOf("/p/main")).toBeNull();
    expect(idx.projectOf("/p/wt1")).toBe("/p/main");
    expect(idx.projectOf("/p/orca-wt")).toBe("/p/orca-wt");
  });
  it("roots() = registered ∪ unregistered worktrees that still have a folder", () => {
    expect(idx.roots()).toEqual(["/p/main", "/p/orca-wt", "/p/wt1"]);
  });
  it("set() reports change, remove() forgets a parent", () => {
    const i2 = new WorktreeIndex(() => ["/a"]);
    expect(i2.set("/a", [entry("/a-wt")])).toBe(true);
    expect(i2.set("/a", [entry("/a-wt")])).toBe(false);
    i2.remove("/a");
    expect(i2.of("/a")).toEqual([]);
    expect(i2.all()).toEqual({});
  });
});

describe("sessionsOfProject", () => {
  const s = (id: string, ws: string): SessionMeta => ({ id, workspaceId: ws, createdAt: "", updatedAt: "" } as unknown as SessionMeta);
  it("includes the parent's and each worktree's sessions, nothing else", () => {
    const all = [s("1", "/p/main"), s("2", "/p/wt1"), s("3", "/other")];
    expect(sessionsOfProject(all, "/p/main", ["/p/wt1"]).map((x) => x.id)).toEqual(["1", "2"]);
  });
});

describe("worktreeDir", () => {
  it("is <agentDir>/worktrees/<key>/<slug>", () => {
    expect(worktreeDir("/ad", "k1", "feat-x")).toBe(path.join("/ad", "worktrees", "k1", "feat-x"));
  });
});

const HAVE_GIT = ((): boolean => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch { return false; } })();

describe.skipIf(!HAVE_GIT)("listWorktrees over a real repo", () => {
  it("drops the main worktree, keeps the linked one, resolves paths", async () => {
    resetGitAvailability();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-list-"));
    const git = (cwd: string, ...a: string[]): void => { execFileSync("git", a, { cwd, stdio: "pipe" }); };
    const m = path.join(root, "m"); fs.mkdirSync(m);
    git(m, "init", "-q"); git(m, "config", "user.email", "t@x"); git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a"); git(m, "add", "-A"); git(m, "commit", "-qm", "i");
    const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    const list = await listWorktrees(m);
    expect(list.map((e) => e.branch)).toEqual(["side"]);
    expect(fs.realpathSync(list[0].path)).toBe(fs.realpathSync(wt));
    // Asked from the WORKTREE, the answer is the same repo's list minus itself's parent? No —
    // git lists every worktree from any of them; the caller decides which is "main".
    expect((await listWorktrees(path.join(root, "not-a-repo-" + Date.now()))).length).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

- [ ] **Step 3: Implement**

`src/main/worktreeSlug.ts` (no imports — pinned above):
```ts
/**
 * §29 worktrees — a branch name → a folder name. Import-free on purpose: the
 * renderer imports it for the dialog's folder preview, and one `import fs`
 * here would put node:fs in the browser bundle (the schedules.ts rule).
 */
export function worktreeSlug(branch: string): string {
  const s = branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  return s || "worktree";
}
```

`src/main/git.ts` (after `listBranches`):
```ts
/**
 * §29 worktrees — every LINKED worktree of this repo. The main worktree is
 * dropped (it is the workspace row) and so is a bare entry. Paths are
 * `path.resolve`d so the renderer, the session index and the registry compare
 * one spelling; realpath is used only for the drop, because macOS answers
 * `/private/var` to a `/var` question.
 */
export async function listWorktrees(workspace: string): Promise<WorktreeEntry[]> {
  const state = await requireRepo(workspace);
  if (!state) return [];
  const r = await run(state.root, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return [];
  const root = safeReal(state.root);
  return parseWorktreeList(r.stdout)
    .filter((e) => !e.bare && safeReal(e.path) !== root)
    .map((e) => ({ ...e, path: path.resolve(e.path) }));
}
```
Add `type WorktreeEntry, parseWorktreeList` to the `./gitParse` import.

`src/main/worktrees.ts`:
```ts
import path from "node:path";
import type { WorktreeEntry } from "./gitParse";
import { normPath, type SessionMeta } from "./store";

/**
 * §29 worktrees — a worktree is a ROOT, not a workspace. This is the one place
 * that answers three questions for main: which roots the app admits (`roots`),
 * whose config a root reads (`parentOf` / `projectOf`), and what a project row
 * shows (`of`). It never touches the registry file; git's `worktree list` is
 * the source of truth and ipc.ts refreshes it through `set`.
 *
 * "A registered path wins": a linked worktree the user added as a workspace of
 * its own (the Orca / Claude Code shape) is its own project row — never listed
 * under its parent, never routed to the parent's config.
 */
export type WorktreeInfo = Pick<WorktreeEntry, "path" | "branch" | "head" | "locked" | "prunable">;

export class WorktreeIndex {
  private byParent = new Map<string, { parent: string; list: WorktreeInfo[] }>();

  constructor(private readonly registered: () => string[]) {}

  private isRegistered(p: string): boolean {
    const k = normPath(p);
    return this.registered().some((w) => normPath(w) === k);
  }

  /** Store git's answer for a parent. True when anything changed. */
  set(parent: string, entries: WorktreeEntry[]): boolean {
    const list: WorktreeInfo[] = entries.map(({ path: p, branch, head, locked, prunable }) => ({ path: p, branch, head, locked, prunable }));
    const key = normPath(parent);
    const before = JSON.stringify(this.byParent.get(key)?.list ?? []);
    this.byParent.set(key, { parent, list });
    return before !== JSON.stringify(list);
  }

  remove(parent: string): void {
    this.byParent.delete(normPath(parent));
  }

  /** Shown under `parent`: git's list minus any registered path. */
  of(parent: string): WorktreeInfo[] {
    return (this.byParent.get(normPath(parent))?.list ?? []).filter((w) => !this.isRegistered(w.path));
  }

  all(): Record<string, WorktreeInfo[]> {
    const out: Record<string, WorktreeInfo[]> = {};
    for (const { parent } of this.byParent.values()) out[parent] = this.of(parent);
    return out;
  }

  /** The registered workspace an UNREGISTERED worktree belongs to; null for anything else. */
  parentOf(p: string): string | null {
    if (this.isRegistered(p)) return null;
    const k = normPath(p);
    for (const { parent } of this.byParent.values()) {
      if (this.of(parent).some((w) => normPath(w.path) === k)) return parent;
    }
    return null;
  }

  /** Whose config a root reads. */
  projectOf(p: string): string {
    return this.parentOf(p) ?? p;
  }

  /** Every root the app admits: registered ∪ unregistered worktrees whose folder exists. */
  roots(): string[] {
    const reg = this.registered();
    return [...reg, ...reg.flatMap((w) => this.of(w).filter((x) => !x.prunable).map((x) => x.path))];
  }
}

export function worktreeDir(agentDir: string, projectKey: string, slug: string): string {
  return path.join(agentDir, "worktrees", projectKey, slug);
}

/** The parent's sessions ∪ every listed worktree's — Forget/Delete, the audit filter, the sidebar count. */
export function sessionsOfProject(sessions: SessionMeta[], parent: string, worktreePaths: string[]): SessionMeta[] {
  const keys = new Set([parent, ...worktreePaths].map(normPath));
  return sessions.filter((s) => keys.has(normPath(s.workspaceId)));
}
```

- [ ] **Step 4: Run, expect PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(§29): worktree discovery, the root index and the slug`

---

### Task 3: the `.git` watch notices a worktree added outside the app

**Files:**
- Modify: `src/main/gitWatch.ts:38-55` (`fingerprint`)
- Test: `tests/git-watch-fingerprint.test.ts`

**Interfaces:**
- Produces: `export function gitFingerprint(gitPath: string): string` (the existing private `fingerprint`, exported and renamed; the internal callers follow).

- [ ] **Step 1: Failing test**

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitFingerprint } from "../src/main/gitWatch";

const HAVE_GIT = ((): boolean => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch { return false; } })();

describe.skipIf(!HAVE_GIT)("gitFingerprint", () => {
  it("changes when a worktree is added and HEAD/index did not move", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitwatch-"));
    const git = (cwd: string, ...a: string[]): void => { execFileSync("git", a, { cwd, stdio: "pipe" }); };
    const m = path.join(root, "m"); fs.mkdirSync(m);
    git(m, "init", "-q"); git(m, "config", "user.email", "t@x"); git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a"); git(m, "add", "-A"); git(m, "commit", "-qm", "i");
    const before = gitFingerprint(path.join(m, ".git"));
    git(m, "worktree", "add", "-q", path.join(root, "wt"), "-b", "side");
    expect(gitFingerprint(path.join(m, ".git"))).not.toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — rename `fingerprint` → `export function gitFingerprint`, update its two callers in `watchGitDir`, and add a third component:

```ts
  // §29 worktrees: `.git/worktrees/` gains or loses an entry when a worktree is
  // added or removed from ANY terminal; without this the sidebar never learns.
  let worktrees = "";
  try {
    worktrees = String(fs.statSync(path.join(gitPath, "worktrees")).mtimeMs);
  } catch {
    worktrees = "";
  }
  return `${head}|${index}|${worktrees}`;
```
Update the doc comment above it: "…and the mtime of `.git/worktrees`".

- [ ] **Step 4: Run, expect PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(§29): the .git watch fingerprints .git/worktrees too`

---

### Task 4: main wiring — roots, projectOf, discovery push, Forget/Delete, audit remap

**Files:**
- Modify: `src/main/ipc.ts` (imports ~L77-99; registry construction; `activeSkillEntries` L655; `resolveSpawnModel` L848; `memoryDirFor` L879; `spawnOpts` L890-935; `hv:remove-workspace` L2800-2826; `hv:read-audit` L4385; analytics L4405-4422; `hv:term-create` L4144; fs block L4995-5034; `hv:git-status` L5120-5128; plus the confinement call sites listed below)
- Modify: `src/preload/index.ts` (git section, ~L230), `src/renderer/src/hv.d.ts` (~L192 and ~L841)
- Test: `tests/worktrees-roots.test.ts` (source scan)

**Interfaces:**
- Consumes: `WorktreeIndex`, `sessionsOfProject` (Task 2), `listWorktrees` (Task 2).
- Produces (wire): `hv:worktree-list` → `Record<string, HvWorktreeInfo[]>`; push `hv:worktrees-changed` `{ workspaceId: string; worktrees: HvWorktreeInfo[] }`; `HvGitStatusPayload.worktreeOf: { path: string; name: string } | null`.
- Produces (renderer API): `worktreeList(): Promise<Record<string, HvWorktreeInfo[]>>`, `onWorktreesChanged(cb): () => void`.

- [ ] **Step 1: The source-scan test (fails until the swap is done)**

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §29 worktrees — ONE predicate. Every fs entry point that takes a session's
 * workspaceId or a renderer path admits roots through `roots()` (registered ∪
 * discovered worktrees). A call that still passes the bare registry list would
 * refuse every file read, save and terminal in a worktree as "Unknown workspace".
 */
const FS_FNS = [
  "resolveInWorkspace", "listDir", "listRecursive", "readWorkspaceFile", "writeWorkspaceFile", "statMtime",
  "statDetails", "createFile", "createDir", "moveEntry", "importEntries", "listPlanProgress",
  "readAgentsMd", "writeAgentsMd", "writeAgentsMdFiles", "hasClaudeMd", "copyClaudeMdToAgentsMd",
  "writePlanFile", "readPlan", "setPlanStatus", "buildMentionBlocks",
];

describe("ipc.ts admits worktree roots at every fs entry point", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/main/ipc.ts"), "utf8");
  it("no fs helper is handed the bare registry list", () => {
    const re = new RegExp(`\\b(${FS_FNS.join("|")})\\(\\s*workspaces\\.list\\(\\)`, "g");
    expect(src.match(re) ?? []).toEqual([]);
  });
  it("snapshot restores and the terminal admit roots()", () => {
    expect(src).toMatch(/snapshotDir\(\), sessionId, roots\(\)/);
    expect(src).toMatch(/roots\(\)\.find\(\(p\) => normPath\(p\) === normPath\(String\(ws\)\)\)/);
  });
  it("config reads stay on the registry, routed through projectOf", () => {
    expect(src).toMatch(/workspaces\.getModel\(project\)/);
    expect(src).toMatch(/resolveBypass\(project/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Wire main**

(a) Imports: add `import { listWorktrees } from "./git"` to the existing git import, and `import { WorktreeIndex, sessionsOfProject } from "./worktrees";`.

(b) Right after `const workspaces = new WorkspaceRegistry(...)`:
```ts
  // §29 worktrees: discovered roots beside the registered ones. `roots()` is the
  // ONE admission list for fs entry points; config reads go through projectOf.
  const worktrees = new WorktreeIndex(() => workspaces.list());
  const roots = (): string[] => worktrees.roots();
  const refreshWorktrees = async (workspaceId: string): Promise<void> => {
    if (!workspaces.list().some((w) => normPath(w) === normPath(workspaceId))) return; // parents only
    if (worktrees.set(workspaceId, await listWorktrees(workspaceId))) {
      send("hv:worktrees-changed", { workspaceId, worktrees: worktrees.of(workspaceId) });
    }
  };
  ipcMain.handle("hv:worktree-list", () => worktrees.all());
```
(`send` is defined at L533 — place this block after it.)

(c) `hv:git-status` (L5120): after `const payload = await gitStatus(workspaceId);` add `void refreshWorktrees(workspaceId);` (for a non-repo `listWorktrees` answers `[]`, which is right), and return
```ts
    const parent = worktrees.parentOf(workspaceId);
    return { ...payload, worktreeOf: parent ? { path: parent, name: path.basename(parent) } : null };
```

(d) The swap. Replace `workspaces.list()` with `roots()` at exactly these call sites (grep `workspaces.list()` and take the ones whose first argument is a session's workspace or a renderer path): the snapshot/rewind calls (`snapshotDir(), sessionId, workspaces.list()` ×6 → `roots()`), `writeAgentsMdFiles`/`readAgentsMd`/`writeAgentsMd`/`hasClaudeMd`/`copyClaudeMdToAgentsMd`, `writePlanFile`/`readPlan`/`setPlanStatus`/`listPlanProgress`, `buildMentionBlocks`, the whole `hv:fs-*` block incl. `resolveInWorkspace` in reveal/trash/watch, and `hv:term-create` (`const known = roots().find(...)`). Leave: mcp.json paths, `.agents/skills` dirs, memory keys, schedules, `hv:skills-set-active`, `hv:list-workspaces`.

(e) `spawnOpts`: first line `const project = workspace ? worktrees.projectOf(workspace) : undefined;` then `activeSkillEntries(workspace, project)`, `resolveSpawnModel(project, sessionId)`, `resolveBypass(project ?? null)`, `memoryDirFor("workspace", workspace, project)`. Signatures:
```ts
  const activeSkillEntries = (workspace: string, project = workspace) => { const activation = workspaces.getSkillsActive(project); /* rest unchanged: files from `workspace` */
  const resolveSpawnModel = (workspace?: string, sessionId?: string) => { /* unchanged body; callers pass the PROJECT */
  const memoryDirFor = (scope, workspaceId?, project = workspaceId) => { /* getMemoryActive(project); key by workspaceId — same folder either way (§33) */
```
Rename the local in `resolveSpawnModel` from `workspace` to `project` so the scan test's `workspaces.getModel(project)` holds, and pass `project` to it from `hv:git-pr-url` unchanged (a worktree's PR draft model is the project's — that call site passes `workspaceId`; wrap it: `resolveSpawnModel(worktrees.projectOf(workspaceId))`).

(f) Forget/Delete: in `hv:remove-workspace`, `const wtPaths = worktrees.of(ws).map((w) => w.path); const affected = sessionsOfProject(index.list(), ws, wtPaths);` and after `terminals.killWorkspace(ws)` add `for (const p of wtPaths) terminals.killWorkspace(p); worktrees.remove(ws);`. `hv:workspace-session-count` → `sessionsOfProject(index.list(), ws, worktrees.of(ws).map((w) => w.path)).length`.

(g) Audit + analytics: a worktree's rows are the project's. In `hv:read-audit`, when `filter?.workspaceId` is set, read with `{ ...filter, workspaceId: undefined }` and keep rows whose `workspaceId` is in `new Set([ws, ...worktrees.of(ws).map((w) => w.path)])`. In the analytics handler, before `aggregate(events, …)`: `events = events.map((e) => { const p = e.workspaceId ? worktrees.parentOf(e.workspaceId) : null; return p ? { ...e, workspaceId: p } : e; });`.

(h) preload:
```ts
  worktreeList: () => ipcRenderer.invoke("hv:worktree-list"),
  onWorktreesChanged: (cb: (p: { workspaceId: string; worktrees: unknown[] }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { workspaceId: string; worktrees: unknown[] });
    ipcRenderer.on("hv:worktrees-changed", h);
    return () => ipcRenderer.removeListener("hv:worktrees-changed", h);
  },
```
hv.d.ts: `interface HvWorktreeInfo { path: string; branch: string | null; head: string; locked: boolean; prunable: boolean }`; add `worktreeOf: { path: string; name: string } | null;` to `HvGitStatusPayload`; add the two methods.

- [ ] **Step 4: `npm run typecheck`; `npx vitest run tests/worktrees-roots.test.ts` PASS; `npm test` green.**
- [ ] **Step 5: Commit** — `feat(§29): main admits worktree roots and routes their config to the project`

---

### Task 5: the sidebar shows them; the panel names the parent

**Files:**
- Modify: `src/renderer/src/App.tsx` (state ~L100; boot `Promise.all` ~L876-895; `gitBranches` effect ~L1836; Sidebar mount ~L3136), `src/renderer/src/components/Sidebar.tsx` (props ~L655-772; row loop ~L1113-1200), `src/renderer/src/components/ChangesPanel.tsx` (branch bar ~L526-532), `src/renderer/src/components/HowItWorks.tsx` (`HOWTO_COPY`)
- Test: `tests/layout-persist.test.ts` (+1), `tests/how-it-works.test.ts` (key list), `tests/sidebar-worktrees.test.ts` (source scan)

**Interfaces:**
- Consumes: `worktreeList`, `onWorktreesChanged`, `HvWorktreeInfo`, `payload.worktreeOf` (Task 4).
- Produces: Sidebar props `worktrees: Record<string, HvWorktreeInfo[]>`, `onActivateRoot: (path: string) => void`, `onCleanUp: (parent: string) => void` (wired to a no-op toast until Task 11).

- [ ] **Step 1: Failing tests**

`tests/layout-persist.test.ts` — add inside `describe("restoreLayout")`:
```ts
  it("keeps a WORKTREE's tabs when the alive set names it (§29 worktrees)", () => {
    const wt = "/p/main-wt";
    const layout = { [wt]: { panes: [{ slots: [{ kind: "file", path: "a.ts" }], active: 0 }], focused: 0 } };
    expect(Object.keys(restoreLayout(stored(layout as never), alive([], [], [], ["/p/main", wt])))).toEqual([wt]);
    expect(Object.keys(restoreLayout(stored(layout as never), alive([], [], [], ["/p/main"])))).toEqual([]);
  });
```
(Adapt the literal to the `WorkspaceTabs` shape the file's other tests build — copy one of their `t(...)` builders rather than the object above if one exists.)

`tests/sidebar-worktrees.test.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string): string => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("§29 worktrees — the sidebar navigates, the panel acts", () => {
  const sidebar = read("src/renderer/src/components/Sidebar.tsx");
  it("draws the heading only when there are worktrees, and no acting menu", () => {
    expect(sidebar).toMatch(/worktrees\[ws\]\?\.length/);
    expect(sidebar).toMatch(/copy="worktrees"/);
    expect(sidebar).not.toMatch(/Merge into|Remove worktree|New worktree/);
  });
  it("a prunable row cannot be activated", () => {
    expect(sidebar).toMatch(/w\.prunable \? \(\) => onCleanUp\(ws\) : \(\) => onActivateRoot\(w\.path\)/);
  });
  const panel = read("src/renderer/src/components/ChangesPanel.tsx");
  it("names the parent in a worktree's header", () => {
    expect(panel).toMatch(/worktree of \{payload\.worktreeOf\.name\}/);
  });
});
```
Add `"worktrees"` to the key list in `tests/how-it-works.test.ts` (L23's `keys`).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

`HowItWorks.tsx` `HOWTO_COPY`:
```ts
  worktrees: {
    title: "What a worktree is",
    body:
      "A worktree is a second copy of this project's files on its own branch, so an agent can work there without touching what you have open here. Its settings are the project's; its files are its own. Make one from the branch menu in Changes, and finish it from the same panel — merge it back, open a pull request, or remove it.",
  },
```

`App.tsx`:
```ts
  const [worktrees, setWorktrees] = useState<Record<string, HvWorktreeInfo[]>>({});
  useEffect(() => {
    void window.hv.worktreeList().then(setWorktrees);
    return window.hv.onWorktreesChanged(({ workspaceId, worktrees: list }) =>
      setWorktrees((p) => ({ ...p, [workspaceId]: list as HvWorktreeInfo[] })));
  }, []);
  const worktreePaths = useMemo(() => Object.values(worktrees).flat().map((w) => w.path), [worktrees]);
```
Boot alive set: add `window.hv.worktreeList()` to the `Promise.all` and `workspaces: new Set([...wsList, ...Object.values(wtMap).flat().map((w) => w.path)])`.
`gitBranches` effect: iterate `[...workspaces, ...worktreePaths]` (deps `[workspaces, worktreePaths]`) and build `gitInfo` over the same union.
```ts
  const activateRoot = (p: string): void => { setActiveWs(p); setView("chat"); };
```
Sidebar mount: `worktrees={worktrees} onActivateRoot={activateRoot} onCleanUp={(ws) => surface(new Error(`Clean up for ${basename(ws)} arrives with the finish verbs.`))}` (Task 11 replaces the stub).

`Sidebar.tsx` — props: `worktrees: Record<string, HvWorktreeInfo[]>; onActivateRoot: (path: string) => void; onCleanUp: (parent: string) => void;`. Inside the workspace row, after the session list `</div>` and still inside `!isCollapsed`:
```tsx
                {(worktrees[ws]?.length ?? 0) > 0 && (
                  <div className="ml-3 mt-1">
                    <div className="flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                      Worktrees
                      <HowItWorks copy="worktrees" compact />
                    </div>
                    {worktrees[ws].map((w) => {
                      const wtSessions = sessions.filter((s) => s.workspaceId === w.path && visible(s)).sort(bySidebarOrder(live));
                      const wtCollapsed = collapsed.has(w.path) && !q;
                      return (
                        <div key={w.path} className={w.prunable ? "opacity-50" : ""}>
                          <div className="group flex items-center gap-1.5 px-1.5 pt-1">
                            <button type="button" onClick={() => toggle(w.path)} aria-expanded={!wtCollapsed} className="shrink-0 cursor-pointer"><Chevron open={!wtCollapsed} /></button>
                            <button
                              type="button"
                              onClick={w.prunable ? () => onCleanUp(ws) : () => onActivateRoot(w.path)}
                              aria-current={w.path === activeWs ? "true" : undefined}
                              className={`flex-1 min-w-0 flex flex-col text-left cursor-pointer ${w.path === activeWs ? "" : "text-ink-soft"}`}
                              title={w.prunable ? `${w.path} — folder is gone; click to clean up` : w.path}
                            >
                              <span className={`truncate text-xs font-bold ${w.path === activeWs ? "rounded bg-honey-soft px-0.5" : ""}`}>{basename(w.path)}</span>
                              <span className="flex items-center gap-1 text-[10px] font-mono truncate">
                                <span aria-hidden>⎇</span>
                                {w.branch ?? `(detached) ${w.head.slice(0, 7)}`}
                                {gitInfo?.[w.path]?.changes != null && gitInfo[w.path].changes! > 0 && (
                                  <span className={gitInfo[w.path].tint === "amber" ? "text-honey font-bold" : "text-leaf font-bold"}>
                                    · {gitInfo[w.path].changes} {gitInfo[w.path].changes === 1 ? "change" : "changes"}
                                  </span>
                                )}
                              </span>
                            </button>
                            {!w.prunable && (
                              <button type="button" title="New session" onClick={() => onNewSession(w.path)} className="text-tangerine hover:text-tangerine-deep cursor-pointer font-black text-sm w-3 shrink-0">+</button>
                            )}
                          </div>
                          {!wtCollapsed && wtSessions.length > 0 && (
                            <div className="ml-6 flex flex-col gap-0.5">{wtSessions.map(sessionRow)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
```
`sessionRow` is whatever the project's session list already maps over — extract the existing per-session JSX into a local `const sessionRow = (s: SessionMeta) => (…)` and use it in both places rather than duplicating it. If `HowItWorks` has no `compact` prop, render it without one and let it take its own line.

`ChangesPanel.tsx`, in the branch bar beside the `state.subdir` line:
```tsx
          {payload?.worktreeOf && (
            <div className="text-[10px] text-ink-soft truncate" title={payload.worktreeOf.path}>
              worktree of {payload.worktreeOf.name}
            </div>
          )}
```

- [ ] **Step 4: `npm run typecheck`; the three tests PASS; `npm test` green.**

- [ ] **Step 5: GUI pass — P1** (dev server; register `~/Documents/Github/HappyVibe` as a workspace; this checkout is its Orca worktree):
  - **Sidebar, HappyVibe row expanded:** a `Worktrees` heading appears under its sessions with a row `worktrees` and a second line `⎇ guiguito/worktrees`. Absence: a workspace that is not a repo shows **no** `Worktrees` heading; the HappyVibe row itself shows **no** `Merge`/`Remove`/`New worktree` control anywhere.
  - **Registered-path-wins:** also add `~/orca/workspaces/HappyVibe/worktrees` as a workspace → it becomes its own project row and is **absent** from HappyVibe's `Worktrees` list; remove it again → it reappears there.
  - **Click the worktree row:** the row carries the honey chip, the collapsed rail highlights **HappyVibe's** initial, the Files drawer lists this checkout's files, and `+` opens a session whose first `ls` tool card shows this folder. Changes panel header reads `worktree of HappyVibe`; the parent's panel does **not** carry that line.
  - **Settings inheritance:** set a model override on HappyVibe's workspace settings page → a new session in the worktree row spawns with that model (composer shows it). The worktree has **no** gear icon.
  - **Restore:** open a file tab in the worktree, quit, relaunch → the tab is back under the worktree root. Then `git worktree remove` it from a terminal (after finishing the pass) → the sidebar row disappears within a second (the `.git` watch), and after a relaunch the tab is gone.
  - **Forget:** on a throwaway repo with one worktree session, *Forget workspace* → the count in the confirm includes the worktree's session and it lands in Archived.

- [ ] **Step 6: Commit** — `feat(§29): worktrees in the sidebar, the parent named in the panel`

---

## Phase 2 — make them

### Task 6: `addWorktree` and verb availability

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/worktree-verbs.test.ts`

**Interfaces:**
- Produces:
  - `type WorktreeAdd = { ok: true; base: { branch: string | null; sha: string } } | { ok: false; reason: string }` and `worktreeVerbs(state: RepoState, head: { branch: string | null; sha: string } | null): WorktreeAdd` (pure).
  - `addWorktree(workspace: string, dir: string, branch: string): Promise<WriteResult>` — refuses an existing `dir` before git runs; uses the branch if it exists locally, else `-b`.

- [ ] **Step 1: Failing tests**

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addWorktree, listWorktrees, resetGitAvailability, worktreeVerbs } from "../src/main/git";

describe("worktreeVerbs (pure)", () => {
  const head = { branch: "main", sha: "abc1234" };
  it("absent when not a repo, unborn, or a subdirectory workspace", () => {
    expect(worktreeVerbs({ kind: "no-git" } as never, head).ok).toBe(false);
    expect(worktreeVerbs({ kind: "no-repo" } as never, head).ok).toBe(false);
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: null, unborn: true }, head)).toMatchObject({ ok: false, reason: expect.stringMatching(/first version/i) });
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: "pkg", unborn: false }, head)).toMatchObject({ ok: false, reason: expect.stringMatching(/subfolder/i) });
  });
  it("present on a plain repo, naming the base", () => {
    expect(worktreeVerbs({ kind: "repo", root: "/r", subdir: null, unborn: false }, head)).toEqual({ ok: true, base: head });
  });
});

const HAVE_GIT = ((): boolean => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch { return false; } })();

describe.skipIf(!HAVE_GIT)("addWorktree over a real repo", () => {
  const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf8" });
  const mkRepo = (): { root: string; m: string } => {
    resetGitAvailability();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wt-add-"));
    const m = path.join(root, "m"); fs.mkdirSync(m);
    git(m, "init", "-q"); git(m, "config", "user.email", "t@x"); git(m, "config", "user.name", "T");
    fs.writeFileSync(path.join(m, "a"), "a"); git(m, "add", "-A"); git(m, "commit", "-qm", "i");
    return { root, m };
  };
  it("creates a NEW branch in a folder outside the repo; parent status stays clean", async () => {
    const { root, m } = mkRepo();
    const dir = path.join(root, "appdata", "worktrees", "k", "feat-x");
    expect(await addWorktree(m, dir, "feat/x")).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, "a"))).toBe(true);
    expect(git(m, "status", "--porcelain")).toBe("");
    expect((await listWorktrees(m)).map((w) => w.branch)).toEqual(["feat/x"]);
  });
  it("uses an EXISTING branch that is not checked out anywhere", async () => {
    const { root, m } = mkRepo();
    git(m, "branch", "side");
    expect(await addWorktree(m, path.join(root, "wt"), "side")).toEqual({ ok: true });
  });
  it("refuses a branch checked out elsewhere with git's message, and a folder that exists before git runs", async () => {
    const { root, m } = mkRepo();
    const r = await addWorktree(m, path.join(root, "wt2"), "main");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/already used by worktree|already checked out/i);
    fs.mkdirSync(path.join(root, "taken"));
    const c = await addWorktree(m, path.join(root, "taken"), "feat/y");
    expect(c).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(git(m, "branch", "--list", "feat/y")).toBe(""); // git never ran
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (git.ts, after `listWorktrees`):

```ts
export type WorktreeAdd =
  | { ok: true; base: { branch: string | null; sha: string } }
  | { ok: false; reason: string };

/**
 * §29 worktrees — may *New worktree…* run here? Pure over the probe so the
 * renderer's disabled item names the same reason the handler refuses with.
 * Unborn: git ≥2.42 silently makes an `--orphan` branch sharing no history,
 * so a merge back would be meaningless. Subdir: the worktree would hold the
 * whole repo and the session cwd would need re-deriving (§5c) — deferred.
 */
export function worktreeVerbs(state: RepoState, head: { branch: string | null; sha: string } | null): WorktreeAdd {
  if (state.kind !== "repo") return { ok: false, reason: "This folder isn’t tracking versions." };
  if (state.unborn || !head) return { ok: false, reason: "Save a first version before branching." };
  if (state.subdir) return { ok: false, reason: "This workspace is a subfolder of its repository — open the repository root to make worktrees." };
  return { ok: true, base: head };
}

/** `git worktree add` — an existing local branch is used, a new one is made with `-b`. */
export async function addWorktree(workspace: string, dir: string, branch: string): Promise<WriteResult> {
  const state = await requireRepo(workspace);
  if (!state) return { ok: false, error: "Not a git repository." };
  if (fs.existsSync(dir)) return { ok: false, error: `${dir} already exists.` };
  const exists = (await run(state.root, ["branch", "--list", branch])).stdout.trim() !== "";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const args = exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir];
  const r = await run(state.root, args, { write: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}
```

- [ ] **Step 4: Run, expect PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(§29): addWorktree, and when the verb is absent`

---

### Task 7: the *New worktree…* dialog

**Files:**
- Modify: `src/main/ipc.ts` (`hv:git-status` return; new handler beside `hv:git-delete-branch`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/components/ChangesPanel.tsx` (branch menu ~L590-612)
- Test: `tests/sidebar-worktrees.test.ts` (+1 scan)

**Interfaces:**
- Consumes: `worktreeVerbs`, `addWorktree` (Task 6); `worktreeSlug` (Task 2); `worktreeDir`, `refreshWorktrees` (Tasks 2, 4); `workspaceMemoryKey`, `gitCommonDir`, `agentDir` (existing).
- Produces: `HvGitStatusPayload.worktreeAdd: { ok: true; base: { branch: string | null; sha: string } } | { ok: false; reason: string }`; `hv:worktree-add(workspaceId, branch) → { ok: true; path: string } | { ok: false; error: string }`; renderer `worktreeAdd(workspaceId, branch)`.

- [ ] **Step 1: Failing scan** — add to `tests/sidebar-worktrees.test.ts`:
```ts
  it("New worktree… lives in the branch menu, absent inside a worktree, disabled with the reason", () => {
    expect(panel).toMatch(/payload\.worktreeOf === null && \(/);         // not offered from a worktree
    expect(panel).toMatch(/aria-disabled=\{!payload\.worktreeAdd\.ok\}/); // never `disabled` — the title is the point
    expect(panel).toMatch(/worktreeSlug\(newWorktree\)/);                 // folder preview from the shared, import-free fn
  });
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

ipc.ts, in `hv:git-status`'s return: `worktreeAdd: worktreeVerbs(payload.state, payload.status?.branch ? { branch: payload.status.branch.branch, sha: payload.status.branch.oid ?? "" } : null)` (read the exact `GitBranchInfo` field names from `gitParse.ts:26-35` and use those).

Handler:
```ts
  ipcMain.handle("hv:worktree-add", async (_e, workspaceId: string, branch: string) => {
    if (!workspaces.list().some((w) => normPath(w) === normPath(workspaceId))) return { ok: false, error: "Unknown workspace" };
    const payload = await gitStatus(workspaceId);
    const verbs = worktreeVerbs(payload.state, /* same head expression as above */);
    if (!verbs.ok) return { ok: false, error: verbs.reason };
    const dir = worktreeDir(agentDir(), workspaceMemoryKey(workspaceId, gitCommonDir(workspaceId)), worktreeSlug(branch));
    const r = await addWorktree(workspaceId, dir, branch.trim());
    if (!r.ok) return r;
    auditGit(workspaceId, "worktree-add", { branch, path: dir });
    await refreshWorktrees(workspaceId);
    return { ok: true, path: dir };
  });
```
preload: `worktreeAdd: (workspaceId: string, branch: string) => ipcRenderer.invoke("hv:worktree-add", workspaceId, branch),`; hv.d.ts accordingly (+ `worktreeAdd` on the payload).

ChangesPanel: state `const [newWorktree, setNewWorktree] = useState("");`, import `{ worktreeSlug } from "../../../main/worktreeSlug"` (check how the panel already reaches `main` — `hv-paths` / `describeCommand` style relative import; follow it). In the branch menu, under the New-branch row and only when `payload.worktreeOf === null`:
```tsx
              {payload.worktreeOf === null && (
                <div className="border-t-2 border-line mt-1 pt-1">
                  <button
                    type="button"
                    aria-disabled={!payload.worktreeAdd.ok}
                    title={payload.worktreeAdd.ok ? `From ${payload.worktreeAdd.base.branch ?? "HEAD"} @ ${payload.worktreeAdd.base.sha.slice(0, 7)}` : payload.worktreeAdd.reason}
                    onMouseDown={(e) => { e.preventDefault(); if (payload.worktreeAdd.ok) { setBranchMenu(false); openNewWorktree(); } }}
                    className="w-full text-left rounded-lg px-2 py-1 text-[11px] font-bold hover:bg-honey-soft aria-disabled:opacity-40 cursor-pointer"
                  >
                    New worktree…
                  </button>
                </div>
              )}
```
`openNewWorktree` raises the existing `Confirm` with a body that owns the input:
```tsx
  const openNewWorktree = (): void => {
    if (!payload?.worktreeAdd.ok) return;
    const base = payload.worktreeAdd.base;
    setConfirm({
      title: "New worktree",
      body: (
        <div className="flex flex-col gap-2">
          <div className="text-ink-soft">A second copy of this project on its own branch, from {base.branch ?? "HEAD"} @ <span className="font-mono">{base.sha.slice(0, 7)}</span>. Nothing runs there until you start a session; an agent will ask before installing anything.</div>
          <input autoFocus value={newWorktree} onChange={(e) => setNewWorktree(e.target.value)} placeholder="Branch name…" className="rounded-lg border-2 border-line bg-paper px-2 py-1 text-[11px] focus:outline-none focus:border-tangerine" />
          <div className="text-[10px] text-ink-soft">Folder: <span className="font-mono">{worktreeSlug(newWorktree || "…")}</span> under HappyVibe’s data, not inside your project.</div>
        </div>
      ),
      confirmLabel: "Make worktree and start a session",
      onConfirm: async () => {
        const branch = newWorktree.trim();
        if (!branch) return;
        setConfirm(null);
        const r = await window.hv.worktreeAdd(workspace, branch);
        if (!r.ok) { flash(r.error.split("\n")[0]); return; }
        setLastCommand(`git worktree add -b ${branch} ${r.path}`);
        setNewWorktree("");
        onWorktreeCreated(r.path);
      },
    });
  };
```
`onWorktreeCreated: (path: string) => void` is a new panel prop; App passes `(p) => { activateRoot(p); void newSession(p); }`. (`Confirm.body` is a ReactNode captured at `setConfirm` time — if the input does not re-render on typing, hold the branch in a `useRef` and a local `useState` inside a tiny `NewWorktreeBody` component instead.)

- [ ] **Step 4: `npm run typecheck`; scans PASS; `npm test` green.**
- [ ] **Step 5: GUI pass — P2**
  - **Branch menu on HappyVibe:** the last row reads `New worktree…`; hovering shows `From main @ <7 chars>`. In a **worktree's** own panel the row is **absent**.
  - **On an unborn repo** (`git init` a temp folder, add it): the row is greyed and its tooltip reads `Save a first version before branching.`; on a subfolder workspace it names the subfolder reason.
  - **Create `feat/demo`:** the dialog's folder line reads `feat-demo`; after confirm a `worktrees` row `feat-demo · ⎇ feat/demo` appears under HappyVibe, the active chip moves to it, and a new session opens there. `git status` in `~/Documents/Github/HappyVibe` prints **nothing** (absence: no `??` line). The folder exists at `~/Library/Application Support/happyvibe/pi-agent/worktrees/<16 hex>/feat-demo`.
  - **Collision:** create `feat/demo` again → toast `… already exists.` and no second row.
  - **Regression sequence:** create, switch back to the parent row, open its branch menu → `feat/demo` is listed and its trash icon is disabled with `checked out in a worktree` in git's words when you try (git's refusal surfaces as the toast).
- [ ] **Step 6: Commit** — `feat(§29): New worktree… from the branch menu, in app data`

---

## Phase 3 — finish them

### Task 8: `mergeCheck` / `mergeBranch` with the abort rule

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/worktree-verbs.test.ts` (+ describe)

**Interfaces:**
- Produces:
  - `interface MergeCheck { ok: boolean; reason?: string; ahead: number; parentBranch: string | null }` and `mergeCheck(parentRoot: string, branch: string): Promise<MergeCheck>`.
  - `type MergeResult = { ok: true; fastForward: boolean } | { ok: false; error: string; conflicts?: string[]; aborted?: boolean }` and `mergeBranch(parentRoot: string, branch: string): Promise<MergeResult>`.

- [ ] **Step 1: Failing tests** (same `mkRepo` helper; add a `commitIn(dir, file, text)` helper):
```ts
describe.skipIf(!HAVE_GIT)("mergeBranch — the abort rule", () => {
  it("fast-forwards when it can", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side"); commitIn(wt, "b", "1");
    expect(await mergeCheck(m, "side")).toMatchObject({ ok: true, ahead: 1, parentBranch: "main" });
    expect(await mergeBranch(m, "side")).toEqual({ ok: true, fastForward: true });
    expect(git(m, "log", "--oneline").split("\n").filter(Boolean)).toHaveLength(2);
  });
  it("makes a merge commit when both moved", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side"); commitIn(wt, "b", "1"); commitIn(m, "c", "2");
    expect(await mergeBranch(m, "side")).toEqual({ ok: true, fastForward: false });
    expect(git(m, "rev-list", "--count", "HEAD").trim()).toBe("4");
  });
  it("a conflict is aborted: MERGE_HEAD absent, write-tree identical, the file named", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side"); commitIn(wt, "a", "side"); commitIn(m, "a", "main");
    const before = git(m, "write-tree").trim();
    const r = await mergeBranch(m, "side");
    expect(r).toMatchObject({ ok: false, aborted: true, conflicts: ["a"] });
    expect(fs.existsSync(path.join(m, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(m, "write-tree").trim()).toBe(before);
    expect(git(m, "status", "--porcelain")).toBe("");
  });
  it("refuses with a reason: nothing to merge, or tracked changes in the parent", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side");
    expect(await mergeCheck(m, "side")).toMatchObject({ ok: false, ahead: 0, reason: expect.stringMatching(/nothing to merge/i) });
    commitIn(wt, "b", "1"); fs.writeFileSync(path.join(m, "a"), "dirty");
    expect(await mergeCheck(m, "side")).toMatchObject({ ok: false, reason: expect.stringMatching(/unsaved changes/i) });
    fs.writeFileSync(path.join(m, "untracked.txt"), "x"); git(m, "checkout", "--", "a");
    expect((await mergeCheck(m, "side")).ok).toBe(true); // untracked files are fine
  });
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export interface MergeCheck { ok: boolean; reason?: string; ahead: number; parentBranch: string | null }

/** §29 worktrees — the three preconditions of *Merge into <parent>*, each named. */
export async function mergeCheck(parentRoot: string, branch: string): Promise<MergeCheck> {
  const state = await requireRepo(parentRoot);
  if (!state) return { ok: false, reason: "Not a git repository.", ahead: 0, parentBranch: null };
  const head = (await run(state.root, ["branch", "--show-current"])).stdout.trim() || null;
  const ahead = Number((await run(state.root, ["rev-list", "--count", `HEAD..${branch}`])).stdout.trim() || 0);
  if (ahead === 0) return { ok: false, reason: "Nothing to merge — save a version in the worktree first.", ahead, parentBranch: head };
  const dirty = (await run(state.root, ["status", "--porcelain", "--untracked-files=no"])).stdout.trim() !== "";
  if (dirty) return { ok: false, reason: "This project has unsaved changes — save a version or stash them first.", ahead, parentBranch: head };
  return { ok: true, ahead, parentBranch: head };
}

export type MergeResult =
  | { ok: true; fastForward: boolean }
  | { ok: false; error: string; conflicts?: string[]; aborted?: boolean };

/**
 * `git merge --no-edit <branch>` in the PARENT. Fast-forward when possible, a
 * merge commit otherwise — `--ff-only` is Sync's rule for a remote, not this.
 * On failure with a merge in progress: name the conflicting paths, then
 * `merge --abort` at once, so the parent tree is byte-identical to before
 * (§7: no conflict UI, ever). Pinned by a write-tree hash in the tests.
 */
export async function mergeBranch(parentRoot: string, branch: string): Promise<MergeResult> {
  const state = await requireRepo(parentRoot);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = await run(state.root, ["merge", "--no-edit", branch], { write: true });
  // git prints "Fast-forward" on stdout for that case and "Merge made by …" otherwise.
  if (r.ok) return { ok: true, fastForward: /^Fast-forward$/m.test(r.stdout) };
  const mergeHead = (await run(state.root, ["rev-parse", "--git-path", "MERGE_HEAD"])).stdout.trim();
  if (mergeHead && fs.existsSync(path.resolve(state.root, mergeHead))) {
    const conflicts = (await run(state.root, ["diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
    await run(state.root, ["merge", "--abort"], { write: true });
    return { ok: false, error: r.stderr.trim() || r.stdout.trim(), conflicts, aborted: true };
  }
  return { ok: false, error: r.stderr.trim() || r.stdout.trim() };
}
```
- [ ] **Step 4: Run, expect PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(§29): merge a worktree's branch into the parent, aborting on conflict`

---

### Task 9: `removeWorktree`, `pruneWorktrees`

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/worktree-verbs.test.ts` (+ describe)

**Interfaces:**
- Produces: `type RemoveResult = { ok: true } | { ok: false; error: string; dirty?: boolean }`; `removeWorktree(parentRoot: string, wtPath: string, force = false): Promise<RemoveResult>`; `pruneWorktrees(parentRoot: string): Promise<WriteResult>`.

- [ ] **Step 1: Failing tests**
```ts
describe.skipIf(!HAVE_GIT)("removeWorktree / pruneWorktrees", () => {
  it("refuses a dirty worktree with git's message and `dirty`, then removes with force", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side"); fs.writeFileSync(path.join(wt, "x"), "x");
    const r = await removeWorktree(m, wt);
    expect(r).toMatchObject({ ok: false, dirty: true, error: expect.stringMatching(/modified or untracked/i) });
    expect(fs.existsSync(wt)).toBe(true);
    expect(await removeWorktree(m, wt, true)).toEqual({ ok: true });
    expect(fs.existsSync(wt)).toBe(false);
    expect(await listWorktrees(m)).toEqual([]);
  });
  it("prune clears an entry whose folder is gone", async () => {
    const { root, m } = mkRepo(); const wt = path.join(root, "wt");
    git(m, "worktree", "add", "-q", wt, "-b", "side"); fs.rmSync(wt, { recursive: true, force: true });
    expect((await listWorktrees(m))[0]?.prunable).toBe(true);
    expect(await pruneWorktrees(m)).toEqual({ ok: true });
    expect(await listWorktrees(m)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export type RemoveResult = { ok: true } | { ok: false; error: string; dirty?: boolean };

/**
 * `git worktree remove` — git refuses a dirty tree ("contains modified or
 * untracked files, use --force to delete it", measured 2.50.1), which comes
 * back as `dirty` so the panel asks a second, sharper question; force is
 * opt-in per removal, the branch-delete shape. A LOCKED tree is refused with
 * git's own message and no force path — the lock was someone's decision.
 */
export async function removeWorktree(parentRoot: string, wtPath: string, force = false): Promise<RemoveResult> {
  const state = await requireRepo(parentRoot);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = await run(state.root, ["worktree", "remove", ...(force ? ["--force"] : []), wtPath], { write: true });
  if (r.ok) return { ok: true };
  const dirty = /modified or untracked files/i.test(r.stderr);
  return { ok: false, error: r.stderr.trim(), ...(dirty ? { dirty: true } : {}) };
}

export async function pruneWorktrees(parentRoot: string): Promise<WriteResult> {
  const state = await requireRepo(parentRoot);
  if (!state) return { ok: false, error: "Not a git repository." };
  const r = await run(state.root, ["worktree", "prune"], { write: true });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() };
}
```
- [ ] **Step 4: Run, expect PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(§29): remove and prune worktrees, git's refusal as the guard`

---

### Task 10: the finish handlers, the gates, the ask rule

**Files:**
- Modify: `src/main/ipc.ts` (beside `hv:git-delete-branch`), `src/main/gitRules.ts:27-34`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Test: `tests/git-rules-seed.test.ts` (+1 line), `tests/worktrees-roots.test.ts` (+1 scan)

**Interfaces:**
- Consumes: `mergeCheck`, `mergeBranch` (Task 8), `removeWorktree`, `pruneWorktrees` (Task 9), `gitGate`, `auditGit`, `pushGitChanged`, `terminals.list`, `terminals.killWorkspace`, `sessionsOfWorkspace`, `refreshWorktrees`.
- Produces (wire): `hv:git-merge-check(worktreePath) → MergeCheck & { busy?: string[] }`; `hv:git-merge(worktreePath) → MergeResult | { ok: false; busy: string[] }`; `hv:worktree-remove(worktreePath, force?) → RemoveResult | { ok: false; busy?: string[]; terminals?: number }`; `hv:worktree-prune(workspaceId) → WriteResult`. Renderer: `gitMergeCheck`, `gitMerge`, `worktreeRemove`, `worktreePrune`.

- [ ] **Step 1: Failing tests** — in `tests/git-rules-seed.test.ts` first `it`: `expect(patterns).toContain("ask git worktree remove --force*");`. In `tests/worktrees-roots.test.ts`:
```ts
  it("merge gates on the PARENT's idle, remove on the WORKTREE's, remove refuses an open terminal", () => {
    expect(src).toMatch(/hv:git-merge"[\s\S]*?gitGate\(parent\)/);
    expect(src).toMatch(/hv:worktree-remove"[\s\S]*?gitGate\(worktreePath\)[\s\S]*?terminals\.list\(worktreePath\)/);
  });
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

gitRules.ts: append `{ layer: "command", pattern: "git worktree remove --force*", action: "ask" },` to `DEFAULT_GIT_RULES`. **Recorded, not fixed:** `seedDefaultGitRules` returns early when already seeded, so existing installs do not receive this rule — re-seeding would resurrect rules the user deleted (the "policy wearing a hat" the file's comment forbids). New installs get it; `bash` still asks for everything by default. Say so in `wt1.md`.

ipc.ts:
```ts
  // ── §29 worktrees: finishing one. Human-only; parent resolved by the index, never by the renderer. ──
  const parentOfWorktree = (p: string): string | null => worktrees.parentOf(p);

  ipcMain.handle("hv:git-merge-check", async (_e, worktreePath: string) => {
    const parent = parentOfWorktree(worktreePath);
    if (!parent) return { ok: false, reason: "Not a worktree of a workspace.", ahead: 0, parentBranch: null };
    const gate = gitGate(parent);
    const branch = worktrees.of(parent).find((w) => normPath(w.path) === normPath(worktreePath))?.branch;
    if (!branch) return { ok: false, reason: "This worktree is on no branch.", ahead: 0, parentBranch: null };
    const check = await mergeCheck(parent, branch);
    return gate ? { ...check, ok: false, busy: gate.busy } : check;
  });

  ipcMain.handle("hv:git-merge", async (_e, worktreePath: string) => {
    const parent = parentOfWorktree(worktreePath);
    if (!parent) return { ok: false, error: "Not a worktree of a workspace." };
    const gate = gitGate(parent);
    if (gate) return { ok: false, busy: gate.busy };
    const branch = worktrees.of(parent).find((w) => normPath(w.path) === normPath(worktreePath))?.branch;
    if (!branch) return { ok: false, error: "This worktree is on no branch." };
    const check = await mergeCheck(parent, branch);
    if (!check.ok) return { ok: false, error: check.reason ?? "Cannot merge." };
    const r = await mergeBranch(parent, branch);
    auditGit(parent, "merge", { branch, from: worktreePath, ok: r.ok, ...(r.ok ? {} : { aborted: r.aborted ?? false, conflicts: r.conflicts ?? [] }) });
    invalidateProbe(parent);
    pushGitChanged(parent, { force: true });
    return r;
  });

  ipcMain.handle("hv:worktree-remove", async (_e, worktreePath: string, force = false) => {
    const parent = parentOfWorktree(worktreePath);
    if (!parent) return { ok: false, error: "Not a worktree of a workspace." };
    const gate = gitGate(worktreePath);
    if (gate) return { ok: false, busy: gate.busy };
    const open = terminals.list(worktreePath).length;
    if (open > 0) return { ok: false, terminals: open, error: "Close the terminal tabs in this worktree first." };
    const r = await removeWorktree(parent, worktreePath, force);
    if (!r.ok) return r;
    for (const s of sessionsOfWorkspace(index.list(), worktreePath)) {
      if (manager.get(s.id)) await endSession(s.id);
      if (!s.archived) index.update(s.id, { archived: true });
    }
    sessionsChanged();
    auditGit(parent, "worktree-remove", { path: worktreePath, force });
    await refreshWorktrees(parent);
    return { ok: true };
  });

  ipcMain.handle("hv:worktree-prune", async (_e, workspaceId: string) => {
    if (!workspaces.list().some((w) => normPath(w) === normPath(workspaceId))) return { ok: false, error: "Unknown workspace" };
    const r = await pruneWorktrees(workspaceId);
    if (r.ok) { auditGit(workspaceId, "worktree-prune", {}); await refreshWorktrees(workspaceId); }
    return r;
  });
```
(`gitGate` takes a workspace id and computes busy sessions by `workspaceId` — a worktree path works unchanged; `invalidateProbe` exists in git.ts.) preload + hv.d.ts: the four methods, plus `interface HvMergeCheck { ok: boolean; reason?: string; ahead: number; parentBranch: string | null; busy?: string[] }` (what `gitMergeCheck` resolves to) and `HvMergeResult` / `HvRemoveResult` mirroring `MergeResult` / `RemoveResult` with the `busy`/`terminals` refusal shapes unioned in.

- [ ] **Step 4: `npm run typecheck`; tests PASS; `npm test` green.**
- [ ] **Step 5: Commit** — `feat(§29): merge-check, merge, remove and prune handlers with their gates`

---

### Task 11: the worktree cluster, the two-stage remove, the prunable row

**Files:**
- Modify: `src/renderer/src/components/ChangesPanel.tsx` (beneath the save cluster, where the PR button lives ~L745), `src/renderer/src/App.tsx` (replace the `onCleanUp` stub), `src/renderer/src/components/Sidebar.tsx` (nothing new — the stub's callback is real now)
- Test: `tests/sidebar-worktrees.test.ts` (+1 scan)

**Interfaces:**
- Consumes: `gitMergeCheck`, `gitMerge`, `worktreeRemove`, `worktreePrune`, `gitDeleteBranch`, `gitPrUrl` (existing), `payload.worktreeOf`.

- [ ] **Step 1: Failing scan**
```ts
  it("the worktree cluster exists only in a worktree's panel, and remove is two-stage", () => {
    expect(panel).toMatch(/payload\.worktreeOf && \([\s\S]*?Merge into[\s\S]*?Remove worktree/);
    expect(panel).toMatch(/r\.dirty[\s\S]*?worktreeRemove\(workspace, true\)/);
    expect(panel).toMatch(/gitDeleteBranch\(payload\.worktreeOf\.path/); // the follow-up deletes from the PARENT
  });
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (ChangesPanel, right after the PR button block; `onWorktreeRemoved: (parent: string) => void` is a new prop App wires to `activateRoot`):

```tsx
            {payload.worktreeOf && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-disabled={!mergeInfo?.ok}
                  title={mergeInfo?.ok ? `git merge --no-edit ${branch?.branch} · ${mergeInfo.ahead} ${mergeInfo.ahead === 1 ? "commit" : "commits"}` : mergeInfo?.busy?.length ? `Waiting for: ${mergeInfo.busy.join(", ")}` : mergeInfo?.reason ?? "…"}
                  onClick={() => mergeInfo?.ok && confirmMerge()}
                  className="rounded-lg border-2 border-line bg-card px-2 py-1 text-[10px] font-bold cursor-pointer hover:border-tangerine aria-disabled:opacity-40"
                >
                  Merge into {mergeInfo?.parentBranch ?? payload.worktreeOf.name}
                </button>
                <button type="button" onClick={confirmRemove} className="rounded-lg border-2 border-line bg-card px-2 py-1 text-[10px] font-bold cursor-pointer hover:border-tangerine">
                  Remove worktree…
                </button>
              </div>
            )}
```
`mergeInfo` is `useState<HvMergeCheck | null>`, refreshed in the same effect that refreshes `prUrl` (on every status change), by `window.hv.gitMergeCheck(workspace)` when `payload?.worktreeOf` is set. The existing *Open a pull request* button already sits above; the three read as one cluster.

```tsx
  const confirmMerge = (): void => {
    if (!mergeInfo?.ok || !payload?.worktreeOf) return;
    const dirtyHere = files.length > 0;
    setConfirm({
      title: `Merge into ${mergeInfo.parentBranch}`,
      body: (
        <>
          <div className="mb-2">{mergeInfo.ahead} {mergeInfo.ahead === 1 ? "commit" : "commits"} from <span className="font-mono">{branch?.branch}</span> will land in {payload.worktreeOf.name}. If they don’t apply cleanly, nothing changes and you’ll see why.</div>
          {dirtyHere && <div className="text-ink-soft">Your unsaved changes here do not come along — save a version first if you want them in.</div>}
        </>
      ),
      confirmLabel: "Merge",
      onConfirm: async () => {
        setConfirm(null);
        const r = await window.hv.gitMerge(workspace);
        setLastCommand(`git merge --no-edit ${branch?.branch}`);
        if (r.ok) {
          flash(r.fastForward ? "Merged (fast-forward)." : "Merged with a merge commit.");
          setConfirm({
            title: "Merged — remove this worktree?",
            body: <div>Its branch is in {payload.worktreeOf!.name} now. Remove the worktree and delete the branch, or keep working here.</div>,
            confirmLabel: "Remove worktree and delete branch",
            onConfirm: async () => { setConfirm(null); await doRemove(false, true); },
          });
          return;
        }
        if ("busy" in r) { setBusyNotice(`Waiting for: ${r.busy.join(", ")}`); return; }
        setConfirm({
          title: r.aborted ? "Couldn’t merge cleanly — nothing changed" : "Couldn’t merge",
          body: (
            <>
              <div className="mb-2 font-mono text-[10px] whitespace-pre-wrap">{r.error}</div>
              {r.conflicts?.length ? <div>Conflicting: {r.conflicts.map((c) => <span key={c} className="font-mono mr-1">{c}</span>)}</div> : null}
              {prUrl !== null && <div className="mt-2 text-ink-soft">A pull request can carry this branch instead.</div>}
            </>
          ),
          confirmLabel: prUrl !== null ? "Open a pull request" : "OK",
          onConfirm: () => { setConfirm(null); if (prUrl !== null) openPr(); },
        });
      },
    });
  };

  const doRemove = async (force: boolean, deleteBranch: boolean): Promise<void> => {
    if (!payload?.worktreeOf) return;
    const parent = payload.worktreeOf.path;
    const b = branch?.branch ?? null;
    const r = await window.hv.worktreeRemove(workspace, force);
    setLastCommand(`git worktree remove${force ? " --force" : ""} ${workspace}`);
    if (!r.ok) {
      if ("busy" in r && r.busy) { setBusyNotice(`Waiting for: ${r.busy.join(", ")}`); return; }
      if ("dirty" in r && r.dirty) {
        setConfirm({
          title: "This worktree has unsaved changes",
          body: <div className="font-mono text-[10px] whitespace-pre-wrap">{r.error}</div>,
          confirmLabel: "Remove it anyway", danger: true,
          onConfirm: async () => { setConfirm(null); await doRemove(true, deleteBranch); },
        });
        return;
      }
      flash(r.error ?? "Could not remove the worktree.");
      return;
    }
    if (deleteBranch && b) {
      const d = await window.hv.gitDeleteBranch(parent, b, false);
      flash(d.ok ? `Removed the worktree and deleted ${b}.` : `Removed the worktree; ${b} kept: ${d.error?.split("\n")[0]}`);
    } else {
      flash("Removed the worktree.");
    }
    onWorktreeRemoved(parent);
  };

  const confirmRemove = (): void => {
    if (!payload?.worktreeOf) return;
    setConfirm({
      title: "Remove this worktree?",
      body: <div>The folder goes; the branch <span className="font-mono">{branch?.branch}</span> stays unless you say so. Sessions here move to Archived.</div>,
      confirmLabel: "Remove worktree",
      secondary: { label: "Remove and delete branch", onPick: async () => { setConfirm(null); await doRemove(false, true); } },
      onConfirm: async () => { setConfirm(null); await doRemove(false, false); },
    });
  };
```
(`openPr` is the existing PR click handler's body — extract it into a named function if it is inline today.)

App: `onCleanUp={(ws) => confirmCleanUp(ws)}` where
```tsx
  const confirmCleanUp = (ws: string): void => setAppConfirm({ /* reuse whichever app-level confirm App already has for Forget workspace */
    title: "Clean up stale worktrees",
    body: `git worktree prune — removes every entry of ${basename(ws)} whose folder is gone. Nothing on disk changes.`,
    confirmLabel: "Clean up",
    onConfirm: async () => { const r = await window.hv.worktreePrune(ws); if (!r.ok) surface(new Error(r.error)); },
  });
```
and `onWorktreeRemoved={activateRoot}` on the panel.

- [ ] **Step 4: `npm run typecheck`; scans PASS; `npm test` green; `npm run gate`.**
- [ ] **Step 5: GUI pass — P3**
  - **Cluster placement:** in `feat-demo`'s Changes panel, beneath the save cluster: `Merge into main` and `Remove worktree…` (and `Open a pull request` once published). In **HappyVibe's own** panel all three worktree controls are **absent**.
  - **Nothing to merge:** fresh worktree → `Merge into main` greyed, tooltip `Nothing to merge — save a version in the worktree first.`
  - **Merge, clean:** commit in the worktree, merge → toast, `git log --oneline -1` in the parent shows the commit, the parent's sidebar change count updates without a click, and the follow-up dialog offers *Remove worktree and delete branch* — dismiss it: the row is still there (never automatic).
  - **Merge, conflict:** edit the same line in both, commit both, merge → dialog titled `Couldn’t merge cleanly — nothing changed` naming the file; in the parent, `git status` is clean and `.git/MERGE_HEAD` is **absent**; the parent's panel shows **no** `unmerged` rows.
  - **Merge gated:** start a long agent turn in a HappyVibe session, press Merge → greyed with `Waiting for: <session title>`.
  - **Remove, dirty:** untracked file in the worktree → first dialog, then the sharper `Remove it anyway` one; after it the row is gone, its session is under Archived, the folder is gone from app data, `git worktree list` no longer names it, and the active root is back on HappyVibe.
  - **Remove refused by a terminal:** open a terminal tab in the worktree, Remove → toast `Close the terminal tabs in this worktree first.`; close it, Remove → succeeds.
  - **Prunable:** `rm -rf` a worktree folder from a shell → the row greys within a second; clicking it raises `Clean up`; confirming removes the row.
  - **Absence to state:** no `⋯` menu and no `Merge`/`Remove` text anywhere in the sidebar (the scan pins it; look anyway).
- [ ] **Step 6: Commit** — `feat(§29): merge, remove and clean up from the Changes panel`

---

### Task 12: docs — what was measured, and the two traps

**Files:**
- Create: `docs/validation/wt1.md`
- Modify: `CLAUDE.md` (Gotchas, after the git watch entry)

- [ ] **Step 1: `wt1.md`** — record, with the commands: the porcelain fixture (git 2.50.1); `worktree add` on an unborn HEAD makes a `0000000 [x]` orphan branch (measured, why the verb is absent); the dirty-remove message (`contains modified or untracked files, use --force to delete it`) and the locked one (`cannot remove a locked working tree; use 'remove -f -f' to override or unlock first` — we surface it, no force path); `.git/worktrees` mtime moves on add/remove; the merge abort leaves `write-tree` identical (test); why app data not `.worktrees/` (the nested-checkout cost, and that `isWorkspaceRoot` was needed regardless); the seed-once rule means `git worktree remove --force*` reaches new installs only; the P1/P2/P3 GUI passes with what was observed; Windows: not run this round — `worktree remove` with a shell holding the dir is expected to fail (the terminal gate exists for it), verify on the next Windows pass.
- [ ] **Step 2: `CLAUDE.md`** — one entry:
  > **§29 worktrees: the app creates them in APP DATA (`<agentDir>/worktrees/<memory-key>/<slug>`), never `<ws>/.worktrees/`, and `worktrees.roots()` is the ONE admission list.** Inside the repo a second checkout is walked by every tool and by the parent's own agent (`grep -r` finds two copies of every file) — that cost decided it, not confinement, which was needed for Orca/Claude-Code worktrees anyway. A registered path WINS: a worktree the user added as a workspace is its own row, never routed to a parent. Every fs entry point admits `roots()`; every config read goes through `worktrees.projectOf()`; `tests/worktrees-roots.test.ts` scans ipc.ts for a call that re-spells either. A linked worktree's `.git` is a FILE, so `watchGitDir` returns early there — its branch line refreshes on turn end and on the fs watcher, not on an outside `git switch` (accepted; the parent's `.git/worktrees` mtime is what makes an outside add/remove appear).
- [ ] **Step 3: `npm run gate`** one last time; `npm run live:why` — expect no output; state it in the commit body.
- [ ] **Step 4: Commit** — `docs(§29): worktrees — measurements, and the two traps that are not in the code`

---

## Verification summary

| Task | Typecheck | Tests | Live-Pi | GUI |
|---|---|---|---|---|
| 1 | node | `tests/worktrees-parse.test.ts` | no | no |
| 2 | node | `tests/worktrees.test.ts` | no | no |
| 3 | node | `tests/git-watch-fingerprint.test.ts` | no | no |
| 4 | node + web | `tests/worktrees-roots.test.ts`, `npm test` | no | no |
| 5 | web | `layout-persist`, `how-it-works`, `sidebar-worktrees` | no | **P1 pass** (assertions in Task 5 step 5) |
| 6 | node | `tests/worktree-verbs.test.ts` | no | no |
| 7 | node + web | `sidebar-worktrees` | no | **P2 pass** (Task 7 step 5) |
| 8, 9 | node | `tests/worktree-verbs.test.ts` | no | no |
| 10 | node + web | `git-rules-seed`, `worktrees-roots` | no | no |
| 11 | web | `sidebar-worktrees`, `npm run gate` | no | **P3 pass** (Task 11 step 5) |
| 12 | — | `npm run gate` | `live:why` prints nothing | — |

**The regression this design risks, as a sequence:** register the parent → open a session in a worktree → *Forget* the parent → the worktree's session must be in Archived, its tabs must not restore, and re-adding the parent must bring the worktree row AND its archived session back. Run it once at the end of P3.
