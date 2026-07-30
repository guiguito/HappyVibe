/**
 * §14 round 6 — removing a skill means different things per source:
 *  managed / workspace → real delete from disk
 *  bundled            → refused (installBundledSkills reinstalls at startup)
 *  linked             → unlink the directory reference; never touch the files,
 *                       they belong to another tool (e.g. ~/.claude/skills)
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type DeleteKind = "delete" | "unlink" | "refused";
export interface DeletePlan {
  kind: DeleteKind;
  dir: string;
  reason?: string;
}

/**
 * Policy only — which KIND of removal a skill gets, from its source. Path
 * confinement is NOT decided here; it is enforced by removeSkillDir against
 * the caller's allowed roots.
 */
export function planSkillRemoval(view: { id: string; source: string; dir: string }): DeletePlan {
  if (view.source === "bundled") {
    return { kind: "refused", dir: view.dir, reason: "Bundled skills ship with HappyVibe and are reinstalled at startup — disable it instead." };
  }
  if (view.source === "linked") return { kind: "unlink", dir: view.dir };
  return { kind: "delete", dir: view.dir };
}

/**
 * The configured linked root a skill dir lives under, or undefined. A linked
 * root (e.g. ~/.claude/skills) holds several skill subfolders and unlinking
 * drops the WHOLE root — so the confirm dialog and the delete handler must
 * agree on which root that is. Single source for both.
 */
export function findLinkedRoot(skillDir: string, linkedRoots: string[]): string | undefined {
  const abs = path.resolve(skillDir);
  return linkedRoots.find((d) => {
    const r = path.resolve(d);
    return abs === r || abs.startsWith(r + path.sep);
  });
}

/**
 * Path-confined recursive delete (pattern: files.ts resolveInWorkspace).
 *
 * Confinement resolves SYMLINKS, not just `..`: path.resolve normalizes traversal
 * but leaves links intact, and fs.rmSync only lstats the FINAL component — so a
 * planted link (`<managed>/evil -> /Users/me`) would let `<managed>/evil/Docs`
 * pass a string-prefix check while the delete followed the link. An imported
 * skill archive is an untrusted source of such links, and this handler takes an
 * arbitrary id from the renderer, so both sides are realpath'd before comparing.
 */
export function removeSkillDir(dir: string, allowedRoots: string[]): void {
  const abs = realish(dir);
  const ok = allowedRoots.some((root) => {
    const r = realish(root);
    return abs !== r && abs.startsWith(r + path.sep);
  });
  if (!ok) throw new Error(`Refusing to delete ${path.resolve(dir)}: outside the managed skill roots.`);
  fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3 });
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
