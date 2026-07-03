/**
 * electron-builder afterPack hook.
 * Copies pi-runtime/node_modules into the bundled Resources/pi-runtime/
 * because electron-builder's createFilter() hardcodes exclusion of root-level
 * node_modules dirs in extraResources sources.
 */
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productName;

  const src = path.join(__dirname, "..", "pi-runtime", "node_modules");
  // On macOS, the .app is inside appOutDir
  const dest = path.join(
    appOutDir,
    `${productName}.app`,
    "Contents",
    "Resources",
    "pi-runtime",
    "node_modules"
  );

  console.log(`[afterPack] Copying pi-runtime/node_modules → ${dest}`);
  cpSync(src, dest, { recursive: true });
  console.log("[afterPack] Done.");
}
