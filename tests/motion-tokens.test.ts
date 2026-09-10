import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DUR, EASE } from "../src/renderer/src/motion";

/**
 * Animations round (2026-09-10) — the motion vocabulary has ONE source.
 *
 * The tokens live in `styles.css`'s `@theme` (so Tailwind emits `ease-hv-*`
 * utilities) and are mirrored as data in `motion.ts` (so the WAAPI helpers and
 * these tests can read them). Two copies of a number is exactly the drift
 * §20's Principle 11 forbids, so this file pins them equal — as a SOURCE SCAN,
 * because the renderer suite has no DOM and never will (tests/modal-layer's
 * pattern).
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const CSS = R("src/renderer/src/styles.css");

describe("motion tokens (Animations round, 2026-09-10)", () => {
  it("motion.ts mirrors the CSS easings exactly — one source, two consumers", () => {
    expect(CSS).toContain(`--ease-hv-out: ${EASE.out};`);
    expect(CSS).toContain(`--ease-hv-in: ${EASE.in};`);
    expect(CSS).toContain(`--ease-hv-pop: ${EASE.pop};`);
  });

  it("the pop easing IS the existing dialog overshoot, not a second one beside it", () => {
    expect(CSS).toMatch(/hv-pop-in 180ms cubic-bezier\(0\.34, 1\.4, 0\.64, 1\)/);
    expect(EASE.pop).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
  });

  it("durations are the four the spec names and nothing is over 320 ms", () => {
    expect(Object.values(DUR).sort((a, b) => a - b)).toEqual([120, 150, 180, 320]);
  });

  it("dead shimmer CSS is gone", () => {
    // `.hv-shimmer` had zero callers for the app's whole life. Vocabulary
    // nobody speaks is not vocabulary.
    expect(CSS).not.toContain("hv-shimmer");
  });

  it("the CSP comment no longer blames the CSP for a taste decision", () => {
    // A bundled npm library IS `'self'` and loads fine; only CDN/blob/data are
    // blocked. §27's worklet hit that wall because it was a BLOB URL, not
    // because it was a library. Recording the zero-deps choice against the
    // wrong reason is how it gets reversed for the wrong reason later.
    expect(CSS).not.toContain("an animation runtime cannot load at all");
  });

  it("every new animated class is neutralised under reduced motion", () => {
    // The rule is the SETTLED FRAME, never a faster animation (§22's rule,
    // made general). A class added to the stylesheet without a line here is a
    // motion a reduced-motion user still sees.
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.length).toBeGreaterThan(0);
    for (const cls of ["hv-menu-in", "hv-dialog-flow"]) expect(reduced, cls).toContain(`.${cls}`);
  });
});
