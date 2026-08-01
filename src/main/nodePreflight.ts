/**
 * §13 round 8: is there a Node runtime on PATH for `npx` stdio catalog entries?
 *
 * §3's standalone promise means the packaged app ships everything IT needs, but
 * a user-configured stdio server running `npx` needs the user's own Node. The
 * catalog discloses that before the click rather than letting the install fail
 * into an opaque red badge afterwards.
 *
 * Electron-free so it is unit-testable. ponytail: PATH scan, no spawn — a probe
 * process per app start is not worth it; switch to `spawnSync` if a user ever
 * reports a shimmed node that this misses.
 */
import fs from "node:fs";
import path from "node:path";

let cached: boolean | undefined;

function onPath(bin: string): boolean {
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

export function hasNodeRuntime(): boolean {
  if (cached === undefined) cached = onPath("node") && onPath("npx");
  return cached;
}

/** Tests only — the real app probes once per launch. */
export function resetNodeRuntimeCache(): void {
  cached = undefined;
}
