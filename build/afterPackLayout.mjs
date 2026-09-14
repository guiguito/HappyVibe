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
 * Worst-case per-user install prefix: `C:\Users\<name>\AppData\Local\Programs\HappyVibe\`
 * is 54 characters for an 8-character user name, so 60 covers a longer one.
 */
export const WIN_INSTALL_PREFIX_BUDGET = 60;

/** MAX_PATH is 260; keep 20 back for a temp rename during an update. */
export const WIN_PATH_LIMIT = 240;

/** Does the deepest path still fit once installed? */
export function fitsWindowsPathLimit(longestLength, prefix = WIN_INSTALL_PREFIX_BUDGET) {
  return prefix + "resources\\".length + longestLength <= WIN_PATH_LIMIT;
}
