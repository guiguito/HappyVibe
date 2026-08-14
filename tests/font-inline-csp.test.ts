import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Round 12 — a bundled font must never be inlined as a `data:` URL.
 *
 * The renderer's CSP sets no `font-src`, so fonts fall back to
 * `default-src 'self'`, which does not cover `data:`. Vite inlines assets under
 * 4 kB, and exactly one font subset was small enough to qualify —
 * `jetbrains-mono-cyrillic-ext` at 2,028 B — so the built app logged:
 *
 *   Refused to load the font 'data:font/woff2;base64,…' because it violates
 *   the following Content Security Policy directive: "default-src 'self'".
 *
 * This is the same mechanism as §27's worklet (tests/voice-worklet-csp.test.ts),
 * and it hid for the same reason: dev serves a real file URL, and every OTHER
 * subset of the same family is ≥7.5 kB and was emitted as a file — so the font
 * looked fine everywhere except a packaged build, for one script's glyphs.
 *
 * The fix is the config exclusion, never a widened CSP. `font-src 'self' data:`
 * would silence this by giving up the property the CSP exists for.
 */
const ROOT = path.join(__dirname, "..");
const INDEX_HTML = path.join(ROOT, "src/renderer/index.html");
const CONFIG = path.join(ROOT, "electron.vite.config.ts");
const ASSETS = path.join(ROOT, "out/renderer/assets");

describe("bundled fonts must survive the renderer CSP", () => {
  const csp =
    /content="([^"]+)"/.exec(
      fs.readFileSync(INDEX_HTML, "utf8").split("Content-Security-Policy")[1] ?? "",
    )?.[1] ?? "";

  it("the CSP is NOT widened to let a data: font through", () => {
    expect(csp).toContain("default-src 'self'");
    // If a future change adds font-src, it must not carry data:.
    const fontSrc = /font-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(fontSrc, "font-src must not permit data:").not.toContain("data:");
  });

  it("the vite config keeps fonts out of the data:-URL inline path", () => {
    const cfg = fs.readFileSync(CONFIG, "utf8");
    expect(cfg).toContain("assetsInlineLimit");
    // By extension, so the next small subset cannot slip through.
    expect(cfg).toMatch(/woff2\?/);
  });

  it("the predicate refuses every font extension and still allows other assets", () => {
    // Reproduce the config's rule rather than importing it (the config imports
    // electron-vite, which does not load under vitest).
    const cfg = fs.readFileSync(CONFIG, "utf8");
    const m = /\/\\\.\(([^)]+)\)\$\/i/.exec(cfg);
    expect(m, "no font-extension regex found in the config").not.toBeNull();
    const re = new RegExp(`\\.(${m![1]})$`, "i");
    for (const f of ["a.woff", "a.woff2", "a.ttf", "a.otf", "a.eot", "A.WOFF2"]) {
      expect(re.test(f), `${f} should never be inlined`).toBe(true);
    }
    for (const f of ["icon.svg", "shot.png", "data.json"]) {
      expect(re.test(f), `${f} should keep Vite's normal behaviour`).toBe(false);
    }
  });

  it("the BUILT css contains no inlined font", () => {
    // `npm run gate` builds before it tests, so this arm runs against fresh
    // output. Skipped explicitly when out/ is absent rather than passing empty.
    if (!fs.existsSync(ASSETS)) {
      expect(fs.existsSync(ASSETS), "no build output — run `npm run build` first").toBe(false);
      return;
    }
    const css = fs
      .readdirSync(ASSETS)
      .filter((f) => f.endsWith(".css"))
      .map((f) => ({ f, text: fs.readFileSync(path.join(ASSETS, f), "utf8") }));
    expect(css.length, "no css emitted").toBeGreaterThan(0);
    for (const { f, text } of css) {
      expect(text, `${f} inlines a font the CSP will refuse`).not.toContain("data:font");
      expect(text, `${f} inlines a font the CSP will refuse`).not.toMatch(/data:application\/font/);
    }
  });

  it("every font subset is emitted as a real asset file", () => {
    if (!fs.existsSync(ASSETS)) return;
    const fonts = fs.readdirSync(ASSETS).filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f));
    expect(fonts.length, "no fonts emitted at all").toBeGreaterThan(0);
    // The one that used to be inlined, by name — the regression this pins.
    expect(
      fonts.some((f) => /jetbrains-mono-cyrillic-ext/.test(f)),
      "the cyrillic-ext subset is missing — it is the one that gets inlined at 2 kB",
    ).toBe(true);
  });
});
