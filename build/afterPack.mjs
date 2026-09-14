/**
 * electron-builder afterPack hook.
 * Copies pi-runtime/node_modules into the bundled Resources/pi-runtime/
 * because electron-builder's createFilter() hardcodes exclusion of root-level
 * node_modules dirs in extraResources sources.
 */
import { cpSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fitsWindowsPathLimit,
  isExcludedFromRuntime,
  longestRelativePath,
  runtimeDest,
  WIN_PATH_LIMIT,
} from "./afterPackLayout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  const src = path.join(__dirname, "..", "pi-runtime", "node_modules");
  const dest = runtimeDest(context);

  console.log(`[afterPack] Copying pi-runtime/node_modules → ${dest}`);
  // verbatimSymlinks keeps npm's relative .bin symlinks relative — without it,
  // cpSync rewrites them to absolute paths on the build machine (broken on install).
  //
  // The filter drops TypeScript declarations, which no packaged app can load and
  // which happen to be the deepest paths in the tree — see isExcludedFromRuntime.
  cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (from) => !isExcludedFromRuntime(path.relative(src, from)),
  });

  // A wrong destination used to SUCCEED silently: the path was hardcoded to
  // `${productName}.app`, so a Windows build created a .app folder nothing loads and
  // shipped a runtime with no node_modules. Prove the copy landed where the app will
  // look for it, by the one file every session needs.
  const probe = path.join(dest, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  if (!existsSync(probe) || !statSync(probe).isFile()) {
    throw new Error(`[afterPack] pi-runtime copy did not land: ${probe} is missing`);
  }

  if (electronPlatformName === "win32") {
    // Measured, not assumed: the nested scoped deps under pi-runtime are deep, and
    // NSIS installs per-user under %LOCALAPPDATA%\Programs\. If the worst case does
    // not fit MAX_PATH, the fix is flattening those deps via pi-runtime overrides —
    // decided when we have the number, which is why this prints it either way.
    const longest = longestRelativePath(path.join(appOutDir, "resources"));
    console.log(
      `[afterPack] longest path under resources/: ${longest.length} chars (${longest.rel})`,
    );
    if (!fitsWindowsPathLimit(longest.length)) {
      throw new Error(
        `[afterPack] worst-case install path exceeds ${WIN_PATH_LIMIT} chars ` +
          `(longest relative: ${longest.length}, ${longest.rel}). Flatten the nested ` +
          `scoped deps with pi-runtime overrides before shipping.`,
      );
    }
  }

  // Copying into the bundle breaks electron-builder's code signature.
  // Ad-hoc re-sign the whole bundle LAST so the app isn't reported as "damaged".
  // ponytail: ad-hoc (--sign -) only; swap for a Developer ID identity when notarizing.
  if (electronPlatformName === "darwin") {
    const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
    console.log("[afterPack] Ad-hoc re-signing bundle…");
    // §27/§8.4: --entitlements is LOAD-BEARING, not tidiness. This re-sign runs
    // AFTER electron-builder has applied the entitlements, and codesign writes
    // only the entitlements it is handed — so without this argument it replaces
    // every signature it touches, including the Helper that actually captures
    // audio, with an entitlement-free one. The microphone then yields a live
    // track of pure zeros and the app-level config looks perfectly correct
    // while you debug it. Verify with:
    //   codesign -d --entitlements - "<app>/Contents/Frameworks/HappyVibe Helper.app"
    const entitlements = path.join(__dirname, "entitlements.mac.plist");
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, appPath],
      { stdio: "inherit" },
    );
  }
  console.log("[afterPack] Done.");
}
