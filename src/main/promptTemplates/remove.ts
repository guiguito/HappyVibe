/**
 * §24 removal — the §14 policy (skills/remove.ts) one axis simpler: a command is
 * a FILE, not a directory, so "delete" is an unlink of one `.md`:
 *  managed            → real delete from disk
 *  workspace / claude → real delete too, but the confirm copy must say the file
 *                       is typically git-tracked (a `.claude/commands` file is
 *                       team-owned — PRD §24 "read in place, never copied") so
 *                       the user knows they are editing the repo, not just an app
 *                       setting, and that a `git pull` can bring it straight back
 *  bundled            → refused (installBundledPromptTemplates reinstalls at startup)
 *  linked             → unlink the DIRECTORY reference; never touch the files,
 *                       they belong to another tool (e.g. ~/.claude/commands)
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type PromptTemplateDeleteAction = "delete" | "unlink" | "refused";
export interface PromptTemplateDeletePlan {
  action: PromptTemplateDeleteAction;
  /** The file to delete, or — for `unlink` — the linked directory to drop. */
  path: string;
  reason?: string;
}

const GIT_TRACKED =
  "This file lives in the project and is typically git-tracked and team-owned — deleting it changes the repo, and a git pull can bring it back.";

/**
 * Policy only — which KIND of removal a command gets, from its source. Path
 * confinement is NOT decided here; it is enforced by removePromptTemplateFile against
 * the caller's allowed roots.
 */
export function planPromptTemplateRemoval(view: { id: string; source: string }): PromptTemplateDeletePlan {
  if (view.source === "bundled") {
    return {
      action: "refused",
      path: view.id,
      reason: "Bundled prompt templates ship with HappyVibe and are reinstalled at startup — disable it instead.",
    };
  }
  // Scans are flat and non-recursive (discovery.ts), so a linked command's parent
  // dir IS the configured linked root — no findLinkedRoot walk needed.
  if (view.source === "linked") return { action: "unlink", path: path.dirname(view.id) };
  if (view.source === "workspace" || view.source === "claude") {
    return { action: "delete", path: view.id, reason: GIT_TRACKED };
  }
  return { action: "delete", path: view.id };
}

/**
 * Path-confined single-file delete (pattern: files.ts resolveInWorkspace).
 *
 * Confinement resolves SYMLINKS, not just `..`: path.resolve normalizes traversal
 * but leaves links intact, and fs.rmSync only lstats the FINAL component — so a
 * planted link (`<managed>/evil -> /Users/me`) would let `<managed>/evil/notes.md`
 * pass a string-prefix check while the delete followed the link. A git-imported
 * command pack is an untrusted source of such links, and this handler takes an
 * arbitrary id from the renderer, so both sides are realpath'd before comparing.
 * Not recursive: a command is one file, and rmSync throws on a directory.
 */
export function removePromptTemplateFile(file: string, allowedRoots: string[]): void {
  const abs = realish(file);
  const ok = allowedRoots.some((root) => {
    const r = realish(root);
    return abs !== r && abs.startsWith(r + path.sep);
  });
  if (!ok) throw new Error(`Refusing to delete ${path.resolve(file)}: outside the managed prompt-template roots.`);
  fs.rmSync(abs, { maxRetries: 3 });
}

/**
 * realpath where possible, falling back to resolve for a path that doesn't exist
 * yet. Deliberately fails CLOSED: an unresolvable target simply won't match a
 * resolved root, so the delete is refused rather than attempted.
 */
function realish(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
