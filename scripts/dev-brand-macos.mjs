// Dev-only: macOS reads the app-menu title from the RUNNING bundle's Info.plist.
// `npm run dev` launches node_modules/electron/dist/Electron.app, whose name is
// "Electron" — and app.setName() can't override that in dev. So brand that dev
// bundle's Info.plist to "HappyVibe". Idempotent, darwin-only, non-fatal; runs
// as a `predev` hook so a fresh `electron install` (which resets it) is re-branded.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const plist = "node_modules/electron/dist/Electron.app/Contents/Info.plist";
if (!existsSync(plist)) process.exit(0); // electron binary not installed yet

const NAME = "HappyVibe";
try {
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    const cur = execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" }).trim();
    if (cur !== NAME) execFileSync("plutil", ["-replace", key, "-string", NAME, plist]);
  }
  console.log(`[dev-brand] Electron.app menu name set to "${NAME}"`);
} catch (e) {
  console.warn(`[dev-brand] skipped (non-fatal): ${e instanceof Error ? e.message : e}`);
}
