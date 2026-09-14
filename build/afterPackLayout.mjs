/**
 * Pure helpers for afterPack.mjs, split out so tests can call them with fake contexts
 * for all three platforms (tests/afterpack-layout.test.ts).
 */
import { readdirSync } from "node:fs";
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
