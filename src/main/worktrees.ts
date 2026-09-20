import path from "node:path";
import type { WorktreeEntry } from "./gitParse";
import { normPath, type SessionMeta } from "./store";

/**
 * §29 worktrees — a worktree is a ROOT, not a workspace.
 *
 * This is the one place that answers three questions for main:
 *   - which roots the app admits            → `roots()`
 *   - whose config a given root reads       → `parentOf` / `projectOf`
 *   - what a project row shows              → `of(parent)`
 *
 * It never touches the registry file. Git's `worktree list` is the source of
 * truth and `ipc.ts` refreshes this cache from it; nothing here persists, so a
 * worktree removed in an outside terminal cannot leave a stale entry behind.
 *
 * **A registered path wins.** A linked worktree the user added as a workspace
 * of its own — the Orca / Claude Code shape, `~/orca/workspaces/<repo>/<name>`
 * — stays a project row with its own settings: it is never listed under its
 * parent and never routed to the parent's config. Without that rule an existing
 * user's workspace would silently change meaning on upgrade.
 */
export type WorktreeInfo = Pick<WorktreeEntry, "path" | "branch" | "head" | "locked" | "prunable">;

export class WorktreeIndex {
  private byParent = new Map<string, { parent: string; list: WorktreeInfo[] }>();

  /**
   * @param registered   the workspace registry's current paths.
   * @param discoverSync a SYNCHRONOUS `git worktree list` for one parent. Not
   *   optional in production and injected only so the unit tests can drive the
   *   index without a real repo.
   *
   * The sync discovery exists because `roots()` — the admission list every fs
   * entry point consults — is reached from synchronous code and must be right
   * the FIRST time anything asks. Both GUI bugs of this round came from it
   * answering out of a cache nothing had warmed yet: a worktree's tabs were
   * pruned on restart, and its file tree was refused as "Unknown workspace"
   * when the drawer opened before the first git-status. One `execFileSync` per
   * parent, once; every later answer is the cache, refreshed asynchronously by
   * `set` on the normal paths.
   */
  constructor(
    private readonly registered: () => string[],
    private readonly discoverSync: (root: string) => WorktreeEntry[] = () => [],
  ) {}

  /** Warm this parent if nothing has discovered it yet. */
  private ensure(parent: string): void {
    const key = normPath(parent);
    if (this.byParent.has(key)) return;
    this.byParent.set(key, { parent, list: [] }); // claim first: a repo with none must not re-spawn git
    this.set(parent, this.discoverSync(parent));
  }

  private isRegistered(p: string): boolean {
    const k = normPath(p);
    return this.registered().some((w) => normPath(w) === k);
  }

  /** Store git's answer for a parent. True when anything changed — the push is gated on it. */
  set(parent: string, entries: WorktreeEntry[]): boolean {
    const list: WorktreeInfo[] = entries.map(({ path: p, branch, head, locked, prunable }) => ({
      path: p,
      branch,
      head,
      locked,
      prunable,
    }));
    const key = normPath(parent);
    const before = JSON.stringify(this.byParent.get(key)?.list ?? []);
    this.byParent.set(key, { parent, list });
    return before !== JSON.stringify(list);
  }

  remove(parent: string): void {
    this.byParent.delete(normPath(parent));
  }

  /** Shown under `parent`: git's list minus any path that is a registered workspace. */
  of(parent: string): WorktreeInfo[] {
    this.ensure(parent);
    return (this.byParent.get(normPath(parent))?.list ?? []).filter((w) => !this.isRegistered(w.path));
  }

  all(): Record<string, WorktreeInfo[]> {
    const out: Record<string, WorktreeInfo[]> = {};
    for (const parent of this.registered()) out[parent] = this.of(parent);
    return out;
  }

  /** The registered workspace an UNREGISTERED worktree belongs to; null for anything else. */
  parentOf(p: string): string | null {
    if (this.isRegistered(p)) return null;
    const k = normPath(p);
    // Over the REGISTRY, not over what happens to be cached: an unwarmed parent
    // is exactly the case this has to answer for.
    for (const parent of this.registered()) {
      if (this.of(parent).some((w) => normPath(w.path) === k)) return parent;
    }
    return null;
  }

  /** Whose config a root reads: the parent for an unregistered worktree, else itself. */
  projectOf(p: string): string {
    return this.parentOf(p) ?? p;
  }

  /**
   * Every root the app admits — registered workspaces ∪ the worktrees under
   * them whose folder still exists. This is the list form of the spec's
   * `isWorkspaceRoot`: the fs helpers already take a list of admitted roots,
   * so the predicate is `roots().some(…)` and needs no second function.
   *
   * A `prunable` worktree is excluded: its folder is gone, so admitting it
   * would let a file read resolve against a directory that is not there.
   */
  roots(): string[] {
    const reg = this.registered();
    return [...reg, ...reg.flatMap((w) => this.of(w).filter((x) => !x.prunable).map((x) => x.path))];
  }
}

/** Where the app puts a worktree it creates: app data, never inside the user's repo. */
export function worktreeDir(agentDir: string, projectKey: string, slug: string): string {
  return path.join(agentDir, "worktrees", projectKey, slug);
}

/**
 * The parent's sessions ∪ every listed worktree's — Forget/Delete, the audit
 * filter and the sidebar count. `sessionsOfWorkspace` stays the per-ROOT answer
 * (the idle gate wants exactly that); this is the per-PROJECT one, so forgetting
 * a project cannot orphan a worktree's sessions — round 11's defect, one level down.
 */
export function sessionsOfProject(
  sessions: SessionMeta[],
  parent: string,
  worktreePaths: string[],
): SessionMeta[] {
  const keys = new Set([parent, ...worktreePaths].map(normPath));
  return sessions.filter((s) => keys.has(normPath(s.workspaceId)));
}
