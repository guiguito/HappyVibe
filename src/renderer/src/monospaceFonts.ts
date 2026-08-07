/**
 * §26 — which monospace families this machine can actually render.
 *
 * The font row used to be a free-text field, which was weak for a reason worth
 * writing down: nobody knows what is installed on their own machine, and a
 * terminal is the one surface where the font MUST be fixed-width. Measured on
 * a stock Mac: `queryLocalFonts()` reports 180 families and exactly **7** of
 * them are monospace. A list of 7 is a choice; a text box against 180 is a
 * guessing game.
 *
 * Worse, the text box failed silently. `SF Mono` — the obvious thing a Mac user
 * types — does NOT resolve from a web context (Apple restricts it to system
 * UI), so it fell back to the default with no feedback anywhere.
 *
 * Detection is by MEASUREMENT rather than metadata, because the Local Font
 * Access API reports family/style and says nothing about advance width:
 *   - resolves()    — does this family exist? Compare it against two different
 *                     fallbacks; a family that resolves wins over both, an
 *                     absent one inherits whichever fallback it was given.
 *   - isMonospace() — do 'i', 'l' and 'W' share an advance width?
 *
 * Both take a `FontProbe` rather than touching canvas directly, so the logic is
 * unit-testable without a DOM (`tests/monospace-fonts.test.ts`).
 *
 * KNOWN LIMIT, handled in the UI rather than here: metrics cannot tell a coding
 * font from a symbol font. `Wingdings 2` is genuinely fixed-width and passes
 * every check. The picker renders each option IN ITS OWN FONT, which is what
 * excludes it — the same reason the palette page shows real swatches.
 */

/** Ships with the app, so it is always offered and is the default. */
export const BUNDLED_MONO = "JetBrains Mono Variable";

/**
 * Probed by name when enumeration is unavailable — `queryLocalFonts` throws
 * `SecurityError: Page needs to be visible` on a backgrounded window (measured),
 * does not exist on every platform, and may be permission-gated. Each entry is
 * still verified by measurement, so an absent one never reaches the menu.
 */
export const PROBE_FAMILIES: readonly string[] = [
  // macOS stock
  "Menlo", "Monaco", "Courier New", "Courier", "Andale Mono", "PT Mono",
  // Windows / Linux stock
  "Consolas", "Lucida Console", "DejaVu Sans Mono", "Liberation Mono",
  "Noto Sans Mono", "Ubuntu Mono",
  // Commonly installed coding fonts
  "JetBrains Mono", "Fira Code", "Fira Mono", "Cascadia Code", "Cascadia Mono",
  "Source Code Pro", "IBM Plex Mono", "Hack", "Inconsolata", "Roboto Mono",
  "Berkeley Mono", "Iosevka", "Victor Mono", "Anonymous Pro", "Space Mono",
  "SF Mono", // listed on purpose: it is verified like the rest, and fails
];

/** Measures text at a fixed size. The one thing the DOM is needed for. */
export interface FontProbe {
  width(spec: string, text: string): number;
}

/** Mixed advances and enough glyphs that two real fonts rarely tie. */
const SAMPLE = "MMMMiiiillWW@#";
const EPS = 0.01;

const quoted = (family: string): string => `"${family.replace(/"/g, "")}"`;

/**
 * Is this family present, or is the browser silently substituting?
 *
 * Asked against two DIFFERENT fallbacks. A family that resolves produces the
 * same width either way, because the fallback is never reached; an absent one
 * inherits serif once and monospace once, and those differ.
 */
export function resolves(probe: FontProbe, family: string): boolean {
  const serif = probe.width("serif", SAMPLE);
  const mono = probe.width("monospace", SAMPLE);
  // Degenerate environment (headless, identical metrics): cannot discriminate,
  // so do not claim a font is missing. Fail towards offering it.
  if (Math.abs(serif - mono) < EPS) return true;
  const q = quoted(family);
  return Math.abs(probe.width(`${q}, serif`, SAMPLE) - probe.width(`${q}, monospace`, SAMPLE)) < EPS;
}

/** Do the narrowest and widest ASCII letters share an advance width? */
export function isMonospace(probe: FontProbe, family: string): boolean {
  const q = quoted(family);
  const i = probe.width(q, "i");
  if (i <= 0) return false;
  return Math.abs(i - probe.width(q, "W")) < EPS && Math.abs(i - probe.width(q, "l")) < EPS;
}

/**
 * Candidates → the ones worth offering: present, fixed-width, deduplicated,
 * alphabetical, with the bundled family pinned first because it is the default
 * and the only one guaranteed to exist.
 */
export function selectMonospace(probe: FontProbe, families: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of families) {
    const family = raw.trim();
    if (!family || seen.has(family)) continue;
    seen.add(family);
    if (family === BUNDLED_MONO) continue; // pinned below, never filtered out
    if (resolves(probe, family) && isMonospace(probe, family)) out.push(family);
  }
  out.sort((a, b) => a.localeCompare(b));
  return [BUNDLED_MONO, ...out];
}

/** A probe backed by a canvas. Null when there is no DOM to measure with. */
export function domProbe(): FontProbe | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  return {
    width(spec, text) {
      ctx.font = `16px ${spec}`;
      return ctx.measureText(text).width;
    },
  };
}

interface FontDataLike {
  family: string;
}

/** Every monospace family this machine can render. Never throws, never empty. */
export async function listMonospaceFamilies(): Promise<string[]> {
  const probe = domProbe();
  if (!probe) return [BUNDLED_MONO];
  // The bundled family is a WEBFONT: measuring it before it loads reports the
  // fallback's metrics and would hide it from its own menu.
  try {
    await document.fonts.ready;
  } catch {
    /* not fatal — the probe list below is still verifiable */
  }

  const candidates = new Set<string>([BUNDLED_MONO, ...PROBE_FAMILIES]);
  const query = (window as unknown as { queryLocalFonts?: () => Promise<FontDataLike[]> })
    .queryLocalFonts;
  if (typeof query === "function") {
    try {
      for (const font of await query()) candidates.add(font.family);
    } catch {
      // SecurityError on a backgrounded window, or the user denied it. The
      // probe list still yields a usable menu, which is why it exists.
    }
  }
  return selectMonospace(probe, candidates);
}
