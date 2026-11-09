import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY, DENSITIES, isDensity } from "../src/main/density";

/**
 * Appearance › Density. Compact is one CSS variable (`--spacing`, from which
 * Tailwind derives every spacing step) plus the conversation's column token,
 * switched by `data-density` on the root. No DOM in this suite: the contract
 * is pinned as data and by source scan, and against the built CSS when there is
 * one.
 */
const R = path.join(import.meta.dirname, "..", "src");
const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

describe("density — the choices", () => {
  it("three, from roomiest to tightest, comfortable the default", () => {
    expect(DENSITIES.map((d) => d.id)).toEqual(["comfortable", "compact", "ultra-compact"]);
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  it("anything else is not a density (a stale or hand-edited config falls back)", () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("ultra-compact")).toBe(true);
    for (const v of ["Compact", "dense", "ultracompact", "", null, undefined, 1]) expect(isDensity(v)).toBe(false);
  });
});

describe("density — the wiring", () => {
  it("compact overrides the spacing scale and the chat column, unlayered so it beats Tailwind's theme layer", () => {
    const css = read("renderer/src/styles.css");
    const rule = css.slice(css.indexOf(':root[data-density="compact"]'), css.indexOf("}", css.indexOf(':root[data-density="compact"]')));
    expect(rule).toMatch(/--spacing: 0\.2rem;/);
    expect(rule).toMatch(/--container-chat: 64rem;/);
    // Not inside an @layer block: everything before it is closed.
    const before = css.slice(0, css.indexOf(':root[data-density="compact"]'));
    expect((before.match(/{/g) ?? []).length).toBe((before.match(/}/g) ?? []).length);
    expect(read("renderer/src/theme.css")).toMatch(/--container-chat: 48rem;/);
  });

  it("ultra-compact is compact's spacing on a 14px root: rem-sized text shrinks with the spacing around it", () => {
    const css = read("renderer/src/styles.css");
    const at = css.indexOf(':root[data-density="ultra-compact"]');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toMatch(/font-size: 14px;/);
    expect(rule).toMatch(/--spacing: 0\.2rem;/);
    expect(rule).toMatch(/--container-chat: 72rem;/);
    const before = css.slice(0, at);
    expect((before.match(/{/g) ?? []).length).toBe((before.match(/}/g) ?? []).length);
  });

  it("the conversation's column is the token, everywhere it was 48rem", () => {
    for (const f of ["renderer/src/components/ChatView.tsx", "renderer/src/components/Transcript.tsx"]) {
      expect(read(f), f).not.toContain("max-w-3xl");
      expect(read(f), f).toContain("max-w-chat");
    }
  });

  it("arrives with the boot, so a compact app never paints a comfortable frame first", () => {
    expect(read("main/index.ts")).toMatch(/e\.returnValue = \{ windowId: w\?\.id \?\? -1, record, density: getDensity\(\)/);
    const main = read("renderer/src/main.tsx");
    expect(main.indexOf("applyDensity(window.hv?.boot?.density)")).toBeGreaterThan(-1);
    expect(main.indexOf("applyDensity(window.hv?.boot?.density)")).toBeLessThan(main.indexOf("createRoot("));
  });

  it("a change is stored and pushed to every window", () => {
    const ipc = read("main/ipc.ts");
    const h = ipc.slice(ipc.indexOf('"hv:set-density"'), ipc.indexOf('"hv:set-density"') + 200);
    expect(h).toContain("isDensity(d)");
    expect(h).toContain("setDensity(d)");
    expect(h).toContain('send("hv:density-changed", d)');
  });

  it("the BUILT stylesheet has the column utility and the compact rule", () => {
    const dir = path.join(import.meta.dirname, "..", "out", "renderer", "assets");
    // Meaningful only after `npm run build`; `npm run gate` builds first.
    if (!fs.existsSync(dir)) return;
    const built = fs.readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(built).toMatch(/\.max-w-chat\s*\{\s*max-width:\s*var\(--container-chat\)/);
    expect(built).toMatch(/:root\[data-density=["']?compact["']?\]/);
    expect(built).toMatch(/:root\[data-density=["']?ultra-compact["']?\]/);
  });
});
