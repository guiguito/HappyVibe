/**
 * HappyVibe's owned patch to Pi's OAuth sign-in page (PRD §16, 2026-10-05).
 *
 * A subscription sign-in ends on a page the Pi child serves on localhost, and Pi hardcodes its own
 * logo there with no setting to change it. Pi's bundle inlines that page into every sign-in chunk
 * (one name is hashed), so the chunks are FOUND by scanning, not listed. Each gets our icon
 * (derived from build/icon.svg) and a success line that points back to the app. Same applier as
 * the tintinweb patch: an anchor that moves at a Pi bump fails the install.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyHunks } from "./patch-tintinweb.mjs";

export const CHUNKS = "node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks";
export const PI_LOGO = `var LOGO_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" aria-hidden="true"><path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/><path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/><path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/></svg>'`;
export const PI_SUCCESS = `function oauthSuccessHtml(message){return renderPage({title:"Authentication successful",heading:"Authentication successful",message})}`;

/** build/icon.svg as an inline mark: the page's 72px logo box sizes it, not its own 1024px. */
export function logoSvg(iconSvg) {
  return iconSvg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/ width="\d+" height="\d+"/, ' aria-hidden="true"')
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}

export function hunks(chunksDir, iconSvg) {
  const files = fs.readdirSync(chunksDir).filter((f) => fs.readFileSync(path.join(chunksDir, f), "utf8").includes("var LOGO_SVG="));
  if (!files.length) throw new Error("[patch-pi-oauth-page] no chunk inlines Pi's sign-in page any more — re-derive the patch against this Pi version");
  return files.flatMap((file) => [
    { id: "oauth-logo", file, find: PI_LOGO, replace: `var LOGO_SVG=/*hv-patch:oauth-logo*/${JSON.stringify(logoSvg(iconSvg))}` },
    // "…You can close this window." → "…You can close this window and return to HappyVibe."
    { id: "oauth-return", file, find: PI_SUCCESS, replace: PI_SUCCESS.replace(",message})", String.raw`,message:message.replace(/\.$/," and return to HappyVibe.")})/*hv-patch:oauth-return*/`) },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(repo, "pi-runtime", CHUNKS);
  const done = applyHunks(dir, hunks(dir, fs.readFileSync(path.join(repo, "build/icon.svg"), "utf8")));
  console.log(`[patch-pi-oauth-page] ${done.length ? `applied ${done.length} hunks` : "already patched"}`);
}
