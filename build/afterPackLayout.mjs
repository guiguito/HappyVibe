/**
 * Pure helpers for afterPack.mjs, split out so tests can call them with fake contexts
 * for all three platforms (tests/afterpack-layout.test.ts).
 */
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";

/**
 * Where `pi-runtime/node_modules` has to land so `process.resourcesPath` finds it.
 *
 * This was hardcoded to `${productName}.app` for the app's whole life, guarded by
 * nothing — only the RE-SIGN below it checked the platform. So a Windows build
 * cheerfully created `release/win-unpacked/HappyVibe.app/Contents/Resources/…`, a
 * folder nothing loads: the build went green and the shipped app could not spawn Pi
 * at all.
 */
export function runtimeDest(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName === "darwin") {
    return path.join(
      appOutDir,
      `${packager.appInfo.productName}.app`,
      "Contents",
      "Resources",
      "pi-runtime",
      "node_modules",
    );
  }
  // win32 / linux: electron-builder lays resources flat beside the executable.
  return path.join(appOutDir, "resources", "pi-runtime", "node_modules");
}

/** The deepest relative path under `dir`, for the NSIS long-path budget. */
export function longestRelativePath(dir) {
  let best = { rel: "", length: 0 };
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}${path.sep}${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (r.length > best.length) best = { rel: r, length: r.length };
    }
  };
  walk(dir, "");
  return best;
}

/**
 * The per-user install prefix NSIS uses:
 * `C:\Users\<name>\AppData\Local\Programs\HappyVibe\` — that is 43 characters plus
 * the user name, so 63 allows a generous 20-character one.
 */
export const WIN_INSTALL_PREFIX_BUDGET = 63;

/** MAX_PATH is 260. Keep 5 back so an updater's temp rename still fits. */
export const WIN_PATH_LIMIT = 255;

/**
 * Paths excluded from the packaged runtime.
 *
 * `dist-types` is TypeScript DECLARATIONS — reached only through a package's `types`
 * field, never by `main` or `module`, so a packaged app cannot load one. The AWS SDK
 * that pi-coding-agent nests ships 3,056 of them (4.3 MB), and they are also the
 * DEEPEST paths in the tree: dropping them takes the longest relative path from 190
 * to 180 characters, which is what brings a real install inside MAX_PATH.
 *
 * Measured rather than assumed — the check below prints the number either way.
 */
export function isExcludedFromRuntime(relPath) {
  return relPath.split(/[\\/]/).includes("dist-types");
}

/** Does the deepest path still fit once installed? */
export function fitsWindowsPathLimit(longestLength, prefix = WIN_INSTALL_PREFIX_BUDGET) {
  return prefix + "resources\\".length + longestLength <= WIN_PATH_LIMIT;
}

/**
 * PRD §4 (open-source round, 2026-09-24): is this file a Mach-O binary?
 * `head` is the file's first 8 bytes. Thin magics are stored little-endian on
 * disk; FAT_MAGIC is big-endian and shared with Java's `.class` — told apart by
 * the next word, which is an arch count for a fat binary (a handful) and a
 * class-file version for Java (45+).
 */
export function isMachO(head) {
  if (head.length < 4) return false;
  const le = (head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24)) >>> 0;
  if (le === 0xfeedfacf || le === 0xfeedface) return true;
  const be = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  if (be !== 0xcafebabe && be !== 0xcafebabf) return false;
  if (head.length < 8) return false;
  const n = ((head[4] << 24) | (head[5] << 16) | (head[6] << 8) | head[7]) >>> 0;
  return n > 0 && n < 20;
}

/**
 * Every Mach-O file under `root`, found by scanning — never hand-listed (the set
 * moved 13 → 15 across two pin bumps). Symlinks are skipped: the target is
 * signed where it actually lives, and codesign refuses to sign through a link.
 */
export function machOFiles(root) {
  const out = [];
  const head = Buffer.alloc(8);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const fd = openSync(p, "r");
        try {
          const n = readSync(fd, head, 0, 8, 0);
          if (isMachO(head.subarray(0, n))) out.push(p);
        } finally {
          closeSync(fd);
        }
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The Developer ID to sign pi-runtime with, from `HV_MAC_IDENTITY` (set only by
 * scripts/release-mac.mjs). Null means the ad-hoc path — a laptop build.
 */
export function macSignIdentity(env) {
  const id = env.HV_MAC_IDENTITY?.trim();
  return id ? id : null;
}
