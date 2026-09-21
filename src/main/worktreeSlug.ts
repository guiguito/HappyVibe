/**
 * §29 worktrees — a branch name becomes a folder name.
 *
 * Import-free on purpose, and pinned as such by a test: the RENDERER imports it
 * to preview the folder in the New worktree dialog, so one `import fs` here
 * would put `node:fs` in the browser bundle. It typechecks and it runs in dev;
 * `npm run build` then fails naming a file one level away from the import that
 * dragged it in. Same trap as `schedules.ts` and `terminalSettings.ts`.
 *
 * The slug is never an identity — git's `worktree list` is the source of truth
 * for what exists, and a collision is refused by `addWorktree` before git runs.
 * So this only has to be a legible, filesystem-safe name.
 */
export function worktreeSlug(branch: string): string {
  const folded = branch
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return folded || "worktree";
}
