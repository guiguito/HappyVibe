import { describe, expect, it } from "vitest";
import {
  BUNDLED_MONO,
  PROBE_FAMILIES,
  isMonospace,
  resolves,
  selectMonospace,
  type FontProbe,
} from "../src/renderer/src/monospaceFonts";

/**
 * A fake font book. `installed` maps a family to its per-character advance
 * widths; anything absent falls back the way a browser does — which is the
 * behaviour `resolves()` exists to detect.
 */
function fakeProbe(installed: Record<string, { i: number; l: number; W: number }>): FontProbe {
  const FALLBACK = { serif: { i: 4, l: 4, W: 14 }, monospace: { i: 8, l: 8, W: 8 } };
  const widthsFor = (spec: string): { i: number; l: number; W: number } => {
    // A CSS font list: first installed family wins, else the generic at the end.
    for (const raw of spec.split(",")) {
      const name = raw.trim().replace(/^["']|["']$/g, "");
      if (installed[name]) return installed[name]!;
      if (name === "serif") return FALLBACK.serif;
      if (name === "monospace") return FALLBACK.monospace;
    }
    return FALLBACK.serif;
  };
  return {
    width(spec, text) {
      const w = widthsFor(spec);
      let total = 0;
      for (const ch of text) total += (w as Record<string, number>)[ch] ?? w.W;
      return total;
    },
  };
}

const MONO = { i: 9, l: 9, W: 9 };
const PROPORTIONAL = { i: 3, l: 3, W: 15 };

const BOOK = fakeProbe({
  [BUNDLED_MONO]: MONO,
  Menlo: MONO,
  "Wingdings 2": MONO, // fixed-width AND useless — metrics cannot tell
  Georgia: PROPORTIONAL,
});

describe("resolves", () => {
  it("is true for an installed family", () => {
    expect(resolves(BOOK, "Menlo")).toBe(true);
    expect(resolves(BOOK, "Georgia")).toBe(true);
  });

  it("is false for a family that is not installed", () => {
    // The SF Mono trap: a Mac user types it, it silently falls back, and the
    // old free-text field gave no feedback at all.
    expect(resolves(BOOK, "SF Mono")).toBe(false);
    expect(resolves(BOOK, "Totally Fake Font")).toBe(false);
  });

  it("strips quotes so a family name cannot break out of the CSS string", () => {
    // These names arrive from queryLocalFonts — OS-supplied, but they are
    // interpolated into a `font` shorthand, so the quote strip is a real guard
    // rather than tidiness. A stripped name stays inert inside its own quotes.
    expect(() => resolves(BOOK, '"; color: red; "')).not.toThrow();
    expect(() => isMonospace(BOOK, '", sans-serif; x:"')).not.toThrow();
    // And it is a strip, not an escape: the quote is simply removed.
    expect(resolves(BOOK, 'Men"lo')).toBe(resolves(BOOK, "Menlo"));
  });

  it("fails towards offering the font when the environment cannot discriminate", () => {
    // serif and monospace measuring identically means the two-fallback trick
    // has no signal. Claiming every font is missing would empty the menu.
    const degenerate = fakeProbe({});
    const flat: FontProbe = { width: (_s, t) => t.length * 7 };
    expect(resolves(flat, "Anything")).toBe(true);
    expect(resolves(degenerate, "Anything")).toBe(false);
  });
});

describe("isMonospace", () => {
  it("is true when i, l and W share an advance", () => {
    expect(isMonospace(BOOK, "Menlo")).toBe(true);
    expect(isMonospace(BOOK, BUNDLED_MONO)).toBe(true);
  });

  it("is false for a proportional font", () => {
    expect(isMonospace(BOOK, "Georgia")).toBe(false);
  });

  it("cannot exclude a fixed-width SYMBOL font — the UI preview does that", () => {
    // Documented rather than pretended away: Wingdings 2 is genuinely
    // fixed-width. The picker renders every option in its own font, which is
    // what makes it obviously wrong on sight.
    expect(isMonospace(BOOK, "Wingdings 2")).toBe(true);
  });
});

describe("selectMonospace", () => {
  it("keeps only installed monospace families", () => {
    const out = selectMonospace(BOOK, ["Menlo", "Georgia", "SF Mono", "Wingdings 2"]);
    expect(out).toContain("Menlo");
    expect(out).not.toContain("Georgia"); // proportional
    expect(out).not.toContain("SF Mono"); // not installed
  });

  it("always pins the bundled family first, even if it was not offered", () => {
    const out = selectMonospace(BOOK, ["Menlo"]);
    expect(out[0]).toBe(BUNDLED_MONO);
    // It ships with the app, so a webfont still loading must not hide it from
    // its own menu.
    const notYetLoaded = fakeProbe({ Menlo: MONO });
    expect(selectMonospace(notYetLoaded, ["Menlo"])[0]).toBe(BUNDLED_MONO);
  });

  it("deduplicates and sorts the rest", () => {
    const book = fakeProbe({ [BUNDLED_MONO]: MONO, Menlo: MONO, Andale: MONO, Zed: MONO });
    expect(selectMonospace(book, ["Zed", "Menlo", "Andale", "Menlo", " Zed "])).toEqual([
      BUNDLED_MONO,
      "Andale",
      "Menlo",
      "Zed",
    ]);
  });

  it("never returns an empty list — there is no free-text escape hatch", () => {
    expect(selectMonospace(fakeProbe({}), [])).toEqual([BUNDLED_MONO]);
    expect(selectMonospace(BOOK, ["Georgia"])).toEqual([BUNDLED_MONO]);
  });

  it("ignores blanks", () => {
    expect(selectMonospace(BOOK, ["", "   ", "Menlo"])).toEqual([BUNDLED_MONO, "Menlo"]);
  });
});

describe("PROBE_FAMILIES", () => {
  it("is the fallback when enumeration is blocked, so it must be non-trivial", () => {
    // queryLocalFonts throws SecurityError on a backgrounded window (measured),
    // and does not exist everywhere. Without this list the menu would be one row.
    expect(PROBE_FAMILIES.length).toBeGreaterThan(20);
    for (const stock of ["Menlo", "Monaco", "Courier New", "Consolas", "DejaVu Sans Mono"]) {
      expect(PROBE_FAMILIES).toContain(stock);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(PROBE_FAMILIES).size).toBe(PROBE_FAMILIES.length);
  });
});
