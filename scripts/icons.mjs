/**
 * Renders build/icon.svg into build/icons/<N>x<N>.png for the Linux package
 * (PRD §4, Linux round). Committed output — run it only when the icon changes:
 *
 *   npm run icons
 *
 * Chromium is the rasteriser because it is the one this repo already ships, so
 * this costs no new dependency; and every size is rendered FROM THE VECTOR
 * rather than downscaled from the 1024px PNG, which is the whole point at 16px.
 * Left unconfigured, electron-builder would instead derive the Linux icons by
 * downscaling the macOS .icns (linuxOptions.d.ts:49).
 *
 * Three things here look like style and are load-bearing — each one produced a
 * silent hang or a wrong file when it was the other way round (measured
 * 2026-09-20, macOS, Electron 44):
 *
 *   1. NO TOP-LEVEL AWAIT. `await app.whenReady()` at module scope deadlocks:
 *      the ready event fires only after the entry module finishes evaluating,
 *      and top-level await is exactly what stops it finishing. The symptom is
 *      the worst available — Electron starts, prints NOTHING, and hangs
 *      forever, so it reads as a capture problem rather than a module one.
 *   2. `createRequire`, not `import { app } from "electron"`. Paired with (1)
 *      the static import hung before the first statement ran; it is very
 *      probably fine now that the await is gone, but this form is the one that
 *      was actually measured working and it costs one line.
 *   3. `offscreen: true`. A hidden ordinary window has no compositor output on
 *      macOS, so capturePage never settles. Offscreen paints without showing.
 *   4. ONE window, ONE load, ONE capture — then resize. Creating a window per
 *      size worked for the FIRST size and then failed every later load with
 *      ERR_FAILED (-2): the renderer does not survive the sequence. Rendering
 *      once at 1024 and resizing down is not a quality compromise either, it is
 *      supersampling a vector render, which beats asking Chromium to lay out
 *      16 CSS pixels — and it makes the output identical on a Retina Mac and a
 *      1× CI box, which a raw capturePage is NOT (it answers at the display
 *      scale factor, so the same script produced 256px files for a 128px
 *      window).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = createRequire(import.meta.url)("electron");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 32, 48, 64, 128, 256, 512];
/** Rendered once at this size, then resized down — see note 4 above. */
const MASTER = 1024;
const OUT = path.join(ROOT, "build", "icons");

async function main() {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  const svg = readFileSync(path.join(ROOT, "build", "icon.svg"), "utf8");

  // A FILE, not a data: URL — a data: URL navigation answered ERR_FAILED (-2)
  // on an ordinary window while working on an offscreen one, and a rasteriser
  // that depends on which window type you asked for is not worth keeping.
  const html = path.join(os.tmpdir(), "hv-icon.html");
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
      `svg{display:block;width:${MASTER}px;height:${MASTER}px}</style>` +
      svg,
  );

  const win = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });
  await win.loadFile(html);
  const master = await win.webContents.capturePage();

  // Self-check: a capture that lost the alpha channel comes back as an opaque
  // square and looks entirely plausible in a file listing. toBitmap() is BGRA,
  // so byte 3 of pixel (0,0) is the corner's alpha — and the corner sits
  // outside the squircle, so it MUST be transparent.
  const corner = master.toBitmap()[3];
  if (corner !== 0) {
    throw new Error(`corner alpha is ${corner}, expected 0 — the capture lost transparency`);
  }

  for (const size of SIZES) {
    const img = master.resize({ width: size, height: size, quality: "best" });
    writeFileSync(path.join(OUT, `${size}x${size}.png`), img.toPNG());
    console.log(`[icons] ${size}x${size}.png`);
  }

  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
