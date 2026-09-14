/**
 * Symlink-resolving path canonicalisation for a target that may not exist yet.
 *
 * `fs.realpathSync` throws on a missing path, and the obvious fallback — return
 * `path.resolve(p)` — silently changes what a containment check MEANS, because on
 * macOS a resolved root and an unresolved target live in different namespaces:
 * `/var/folders/x` realpaths to `/private/var/folders/x`, so a missing file under
 * a real root reads as OUTSIDE it. The two delete handlers relied on exactly that
 * accident to fail closed, which meant they refused a missing target for the wrong
 * reason on macOS and sailed through to a raw ENOENT inside rmSync on Windows and
 * Linux (PRD §4, Windows round).
 *
 * Walking up to the nearest EXISTING ancestor and re-joining the tail answers the
 * same question on every platform, and is strictly stronger than the fallback: a
 * symlink planted in an ANCESTOR of a not-yet-existing target is resolved too.
 * Same pattern as `resolveThroughLinks` in pi-runtime/extensions/hv-child-guard.ts
 * (the child write-confinement guard), which cannot be imported from here — that
 * tree is vendored and loads inside Pi.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Canonical absolute path — the one spelling two references to the same place share.
 *
 * `.native` and not plain `realpathSync`, because on Windows the plain one does NOT
 * expand 8.3 SHORT NAMES: `realpathSync("C:\\PROGRA~1")` answers `C:\\PROGRA~1`, while
 * `realpathSync.native` answers `C:\\Program Files` (measured). That is a third spelling
 * of the same path, after separators and case, and it arrives on its own — `TEMP` is
 * routinely the short form for a user name over 8 characters, so `os.tmpdir()` and
 * git's own output disagree about the very same directory.
 *
 * Caught by CI on a runner whose user is `runneradmin`; invisible on a machine whose
 * user name is already short, which is why it survived the whole port.
 */
export function realpathCanonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    // .native is unavailable on no platform we ship, but a throw here would turn a
    // containment question into a crash; the plain call is still better than nothing.
    return fs.realpathSync(p);
  }
}

export function resolveThroughLinks(p: string): string {
  let head = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(realpathCanonical(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      // Reached the filesystem root without finding anything that exists.
      if (parent === head) return path.resolve(p);
      tail.push(path.basename(head));
      head = parent;
    }
  }
}
