import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §27. The renderer's CSP is `script-src 'self'`, and `'self'` does NOT cover
 * `blob:`. The first implementation shipped the audio worklet as a blob URL for
 * bundling convenience, and `audioWorklet.addModule()` was blocked outright:
 *
 *   Loading the script 'blob:http://localhost:5173/…' violates the following
 *   Content Security Policy directive: "script-src 'self'". The action has
 *   been blocked.
 *
 * Dictation failed on every attempt with no usable message. The spec already
 * knew this — §7.3 cites the same CSP as the reason the model download runs in
 * MAIN rather than the renderer — the reasoning just wasn't applied to the
 * worklet. So this pins the invariant on both sides: the worklet is a real
 * same-origin asset, and the CSP is never loosened to permit blob: instead.
 */
const ROOT = path.join(__dirname, "..");
const INDEX_HTML = path.join(ROOT, "src/renderer/index.html");
const WORKLET_JS = path.join(ROOT, "src/renderer/src/voice/voice-worklet.js");
const VOICE_DIR = path.join(ROOT, "src/renderer/src/voice");

describe("voice worklet must survive the renderer CSP", () => {
  const csp =
    /content="([^"]+)"/.exec(
      fs.readFileSync(INDEX_HTML, "utf8").split("Content-Security-Policy")[1] ?? "",
    )?.[1] ?? "";

  it("the CSP still restricts scripts to 'self' — and is NOT loosened for blob:", () => {
    expect(csp).toContain("script-src 'self'");
    // Widening the CSP would "fix" dictation by giving up the guarantee that
    // only bundled, same-origin code can execute in the renderer. Never do it.
    expect(csp).not.toContain("blob:");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("the worklet exists as a real .js file, not a generated blob", () => {
    expect(fs.existsSync(WORKLET_JS)).toBe(true);
    const src = fs.readFileSync(WORKLET_JS, "utf8");
    expect(src).toContain("registerProcessor");
    // The name capture.ts asks for must be the name the file registers.
    expect(src).toContain("'voice-processor'");
    expect(src).toContain("AudioWorkletProcessor");
  });

  it("no voice module builds a blob: or data: URL for a script", () => {
    for (const f of fs.readdirSync(VOICE_DIR)) {
      if (!/\.(ts|js)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(VOICE_DIR, f), "utf8");
      expect(src, `${f} must not createObjectURL a script`).not.toMatch(/createObjectURL/);
      expect(src, `${f} must not addModule a data: URL`).not.toMatch(/addModule\(\s*["']data:/);
    }
  });

  it("capture.ts loads the worklet through Vite's ?url, giving a same-origin asset", () => {
    const src = fs.readFileSync(path.join(VOICE_DIR, "capture.ts"), "utf8");
    expect(src).toMatch(/import\s+\w+\s+from\s+["']\.\/voice-worklet\.js\?url["']/);
    expect(src).toContain("audioWorklet.addModule(");
  });

  it("the vite config keeps the worklet OUT of the data:-URL inline path", () => {
    // Vite inlines assets under 4 kB as data: URLs, and the worklet is ~2 kB.
    // `script-src 'self'` covers neither data: nor blob:, so an inlined worklet
    // is blocked exactly like a blob one — but only in the BUILT app, since dev
    // serves a real file URL. Without this exclusion the feature works all the
    // way through a GUI pass and dies when packaged.
    const cfg = fs.readFileSync(path.join(ROOT, "electron.vite.config.ts"), "utf8");
    expect(cfg).toContain("assetsInlineLimit");
    expect(cfg).toContain("voice-worklet");
  });

  it("the BUILT bundle references the worklet as a file, never inlined", () => {
    // `npm run gate` builds before it tests, so in the gate this runs against
    // fresh output. Skipped when out/ is absent rather than passing vacuously.
    const assetsDir = path.join(ROOT, "out/renderer/assets");
    if (!fs.existsSync(assetsDir)) {
      expect(fs.existsSync(assetsDir), "no build output — run `npm run build` first").toBe(false);
      return;
    }
    const bundles = fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(assetsDir, f), "utf8"));
    const withWorklet = bundles.filter((b) => b.includes("voice-processor"));
    expect(withWorklet.length, "no bundle references the worklet").toBeGreaterThan(0);

    // The worklet must be emitted as its own asset file…
    const emitted = fs.readdirSync(assetsDir).filter((f) => /voice-worklet.*\.js$/.test(f));
    expect(emitted.length, "voice-worklet was not emitted as an asset").toBeGreaterThan(0);

    // …and the URL handed to addModule must not be a data:/blob: script.
    for (const b of withWorklet) {
      const i = b.indexOf("workletUrl =");
      if (i === -1) continue;
      const decl = b.slice(i, i + 200);
      expect(decl, "worklet inlined as a data: URL — CSP will block it").not.toContain("data:text/javascript");
      expect(decl).not.toContain("blob:");
    }
  });

  it("the worklet posts BOTH sample frames and an rms level", () => {
    // The level meter is not decoration: it is the only thing distinguishing
    // "the microphone is dead" from "the model is slow". If the worklet stops
    // posting rms, the meter silently freezes at zero while capture still works.
    const src = fs.readFileSync(WORKLET_JS, "utf8");
    expect(src).toMatch(/postMessage\(/);
    expect(src).toContain("rms");
  });
});
