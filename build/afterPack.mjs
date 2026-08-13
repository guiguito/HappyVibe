/**
 * electron-builder afterPack hook.
 * Copies pi-runtime/node_modules into the bundled Resources/pi-runtime/
 * because electron-builder's createFilter() hardcodes exclusion of root-level
 * node_modules dirs in extraResources sources.
 */
import { cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${productName}.app`);

  const src = path.join(__dirname, "..", "pi-runtime", "node_modules");
  const dest = path.join(appPath, "Contents", "Resources", "pi-runtime", "node_modules");

  console.log(`[afterPack] Copying pi-runtime/node_modules → ${dest}`);
  // verbatimSymlinks keeps npm's relative .bin symlinks relative — without it,
  // cpSync rewrites them to absolute paths on the build machine (broken on install).
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true });

  // Copying into the bundle breaks electron-builder's code signature.
  // Ad-hoc re-sign the whole bundle LAST so the app isn't reported as "damaged".
  // ponytail: ad-hoc (--sign -) only; swap for a Developer ID identity when notarizing.
  if (electronPlatformName === "darwin") {
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
