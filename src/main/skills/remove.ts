/**
 * §14 round 6 — removing a skill means different things per source:
 *  managed / workspace → real delete from disk
 *  bundled            → refused (installBundledSkills reinstalls at startup)
 *  linked             → unlink the directory reference; never touch the files,
 *                       they belong to another tool (e.g. ~/.claude/skills)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveThroughLinks } from "../realpath";

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
  const abs = resolveThroughLinks(dir);
  const ok = allowedRoots.some((root) => {
    const r = resolveThroughLinks(root);
    return abs !== r && abs.startsWith(r + path.sep);
  });
  if (!ok) throw new Error(`Refusing to delete ${path.resolve(dir)}: outside the managed skill roots.`);
  // Containment FIRST — it is the security-relevant answer — then existence.
  // Both must be explicit branches. Failing closed on a missing target used to be
  // accidental: the resolver returned a bare path.resolve() for a path that does
  // not exist, which on macOS alone mismatched the realpath'd root (/var vs
  // /private/var) and so refused it for a reason that had nothing to do with
  // existence — while Windows and Linux, having no such indirection, sailed past
  // and died inside rmSync with a raw ENOENT. resolveThroughLinks() now walks to
  // the nearest existing ancestor, so every platform reaches this line.
  if (!fs.existsSync(abs)) throw new Error(`Refusing to delete ${path.resolve(dir)}: it does not exist.`);
  fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3 });
}
