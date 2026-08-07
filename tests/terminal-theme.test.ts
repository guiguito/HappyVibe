import { describe, expect, it } from "vitest";
import { TERMINAL_PALETTES, contrastRatio, type TerminalPalette } from "../src/renderer/src/terminalTheme";

/**
 * §26: every normal-intensity CHROMATIC ANSI colour clears 4.5:1 against its
 * own background.
 *
 * This test is the feature's headline gate, because the rule as first specced
 * FAILED its own default palette (Workshop red 3.10, green 4.25, blue 3.77,
 * magenta 3.02) — the app's accent tokens had been reused verbatim, and they
 * were chosen against cream, not ink. The hexes moved; this keeps them moved.
 *
 * Exempt, and each for a stated reason rather than convenience:
 *   black (0) / white (7) — the achromatic pair, which programs use as
 *   BACKGROUNDS; black on a dark background is 1.00 by definition and no light
 *   theme can make white readable on white.
 *   brights (8-15) — the rule says normal-intensity.
 */
const CHROMATIC = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#33251a", "#faf4e8")).toBeCloseTo(13.5, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#33251a", "#4fa052")).toBeCloseTo(contrastRatio("#4fa052", "#33251a"), 6);
  });

  it("ignores an alpha suffix rather than misreading it as blue", () => {
    expect(contrastRatio("#33251a", "#f5a62359")).toBeCloseTo(contrastRatio("#33251a", "#f5a623"), 6);
  });
});

describe("terminal palettes", () => {
  it("has exactly the three styles §26 locks", () => {
    expect(Object.keys(TERMINAL_PALETTES).sort()).toEqual(["carbon", "paper", "workshop"]);
  });

  for (const [name, palette] of Object.entries(TERMINAL_PALETTES)) {
    const p = palette as unknown as Record<string, string> & TerminalPalette;

    it(`${name}: every chromatic normal-intensity colour clears 4.5:1`, () => {
      for (const key of CHROMATIC) {
        const ratio = contrastRatio(p.background, p[key]);
        expect(
          ratio,
          `${name}.${key} (${p[key]}) on ${p.background} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the default foreground clears 4.5:1`, () => {
      const ratio = contrastRatio(p.background, p.foreground);
      expect(ratio, `${name}.foreground is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: a bright is never darker than its normal counterpart on a dark bg`, () => {
      // Catches the trap the Workshop correction created: once normal magenta
      // was lightened to pass, it had caught up with brightMagenta, so the two
      // rendered as the same colour and "bold" stopped meaning anything.
      if (contrastRatio(p.background, "#ffffff") < contrastRatio(p.background, "#000000")) return;
      for (const key of CHROMATIC) {
        const bright = `bright${key[0]!.toUpperCase()}${key.slice(1)}`;
        expect(p[key], `${name}.${key} vs ${bright}`).not.toBe(p[bright]);
      }
    });

    it(`${name}: every value is a hex colour xterm accepts`, () => {
      for (const [key, value] of Object.entries(p)) {
        expect(value, `${name}.${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    });
  }
});
