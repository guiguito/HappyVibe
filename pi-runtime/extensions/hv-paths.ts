/**
 * PRD §4 (Windows round, 2026-09-14): pure string path comparison.
 *
 * IMPORT-FREE on purpose, like hv-rules.ts — this is consumed by the bridge, the
 * child guard, main AND the renderer (PermissionRulesSection previews a rule with
 * `evaluate`). No `node:path`: the CALLER says whether paths compare
 * case-insensitively, because this module must not know what platform it is on.
 *
 * Why it exists. On Windows a workspace is `C:\ws`, git answers `C:/ws`, the model
 * writes either, and the filesystem is case-insensitive — so "is this path inside the
 * workspace" has four spellings of the same yes. Every layer that answers it
 * (permission rules, the outside-workspace ask, the child guard's write confinement)
 * has to agree, or a rule silently stops applying while still looking correct on the
 * Permissions page.
 *
 * Containment is `=== root || startsWith(root + "/")`, never a bare startsWith, or
 * `/tmp/ws-evil` reads as inside `/tmp/ws`.
 */

/** Backslashes → `/`, repeated separators collapsed, a UNC prefix preserved. */
export function toPosix(p: string): string {
  const s = p.replace(/\\/g, "/");
  const unc = s.startsWith("//");
  const collapsed = s.replace(/\/{2,}/g, "/");
  return unc ? `/${collapsed}` : collapsed;
}

/** Drop trailing separators without eating a root (`/` or `C:/`). */
export function stripTrailingSep(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  if (s !== "") return s;
  return p.startsWith("/") || p.startsWith("\\") ? "/" : p;
}

export function foldCase(p: string, caseInsensitive: boolean): string {
  return caseInsensitive ? p.toLowerCase() : p;
}

/**
 * `/x`, `C:\x`, `c:/x` and `\\server\share` are absolute; `x/y` is not, and neither is
 * drive-RELATIVE `C:x`, which means "the cwd on drive C" and is a different thing.
 */
export function isAbsolutePath(p: string): boolean {
  return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(p);
}

/** Is `target` the root itself, or strictly under it? Both sides normalised first. */
export function containsPath(root: string, target: string, caseInsensitive: boolean): boolean {
  const r = foldCase(stripTrailingSep(toPosix(root)), caseInsensitive);
  const t = foldCase(stripTrailingSep(toPosix(target)), caseInsensitive);
  if (t === r) return true;
  return t.startsWith(r === "/" ? "/" : `${r}/`);
}
