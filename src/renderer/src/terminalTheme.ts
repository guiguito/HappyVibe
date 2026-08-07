/**
 * §26 — the three terminal palettes, as data.
 *
 * A palette is data, so it is contrast-tested rather than eyeballed
 * (`tests/terminal-theme.test.ts`). That test is not decoration: measuring the
 * palettes as first specced showed the 4.5:1 rule failing its own DEFAULT
 * style — Workshop red 3.10, green 4.25, blue 3.77, magenta 3.02 — because
 * they were the app's CSS accent tokens reused verbatim, and those tokens were
 * chosen against CREAM. The rule stood and the hexes moved; every corrected
 * value below carries the token it came from and the ratio it used to fail, so
 * nobody "restores the brand colours" and silently reintroduces the bug.
 *
 * Scope of the rule: the six CHROMATIC normal-intensity colours (ANSI 1-6).
 * Exempt, and why:
 *   - black (0) and white (7) — the achromatic pair, which programs use as
 *     BACKGROUNDS. `black` on a dark background is 1.00 by definition, and no
 *     light theme can make `white` readable on white; Solarized Light has the
 *     same property and ships. `minimumContrastRatio` is the mitigation.
 *   - the brights (8-15) — the rule says normal-intensity, and a bright is by
 *     construction an emphasis variant of a colour already proven readable.
 */

import type { TerminalStyle } from "../../main/terminalSettings";

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  /** 8-digit hex: xterm wants the alpha baked in. */
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_PALETTES: Record<TerminalStyle, TerminalPalette> = {
  /**
   * Workshop (default) — the exact treatment chat code blocks already use
   * (`styles.css:123-130`: --color-ink background, --color-paper text), so a
   * terminal beside a transcript reads as the same object rather than a
   * foreign black box.
   */
  workshop: {
    background: "#33251a", // --color-ink
    foreground: "#faf4e8", // --color-paper          13.50:1
    cursor: "#ee5a24", // --color-tangerine
    cursorAccent: "#33251a",
    selectionBackground: "#f5a62359", // --color-honey @ 35%, matching ::selection
    black: "#33251a", // exempt: this IS the background
    red: "#dc6f62", // was --color-berry #cf3f2e     3.10 ✗ → 4.57
    green: "#4fa052", // was --color-leaf #4c9a4f    4.25 ✗ → 4.56
    yellow: "#f5a623", // --color-honey               7.30 ✓ unchanged
    blue: "#6492c9", // was --color-sky #4f83c2      3.77 ✗ → 4.57
    magenta: "#a382bb", // was --color-plum #8a5fa8   3.02 ✗ → 4.55
    cyan: "#3f9e96", //                              4.61 ✓ unchanged
    white: "#e3d3b8", // --color-line
    brightBlack: "#8d7a63", // --color-ink-soft
    brightRed: "#ee5a24",
    brightGreen: "#6dbb70",
    brightYellow: "#fbc55e",
    brightBlue: "#74a3dc",
    brightMagenta: "#bfa0d4", // lightened from #a97fc4, which normal magenta
    // had caught up with once IT was corrected
    brightCyan: "#5cbdb4",
    brightWhite: "#fffcf5", // --color-card
  },

  /**
   * Paper (light) — the app's own cream, so the whole window is one
   * temperature. The ANSI colours are darkened rather than reused: honey on
   * cream is unreadable.
   */
  paper: {
    background: "#faf4e8", // --color-paper
    foreground: "#33251a", //                        13.50:1
    cursor: "#ee5a24",
    cursorAccent: "#faf4e8",
    selectionBackground: "#f5a62359",
    black: "#33251a",
    red: "#b5301f", //                               5.63 ✓
    green: "#3a7d3d", //                             4.59 ✓
    yellow: "#94660f", // was #9a6a10                4.31 ✗ → 4.60
    blue: "#3c6ba6", //                              4.98 ✓
    magenta: "#74499a", //                           6.06 ✓
    cyan: "#2e7b74", // was #2f7d76                  4.44 ✗ → 4.56
    white: "#e3d3b8", // exempt: programs use 7 as a background
    brightBlack: "#8d7a63",
    brightRed: "#cf4413",
    brightGreen: "#4c9a4f",
    brightYellow: "#c07d0c",
    brightBlue: "#4f83c2",
    brightMagenta: "#8a5fa8",
    brightCyan: "#3f9e96",
    brightWhite: "#fffcf5",
  },

  /**
   * Carbon (neutral dark) — the app palette de-warmed, for long sessions.
   * Tangerine cursor is the only brand cue left. Passed the contrast rule as
   * first drafted: it was designed rather than borrowed.
   */
  carbon: {
    background: "#1a1512",
    foreground: "#e8e2d8", //                        14.05:1
    cursor: "#ee5a24",
    cursorAccent: "#1a1512",
    selectionBackground: "#5c9fd659",
    black: "#1a1512",
    red: "#e05252", //                               4.74 ✓
    green: "#5faf5f", //                             6.71 ✓
    yellow: "#d7a83a", //                            8.23 ✓
    blue: "#5c9fd6", //                              6.37 ✓
    magenta: "#a97fc4", //                           5.62 ✓
    cyan: "#4fb3aa", //                              7.21 ✓
    white: "#d5cec2",
    brightBlack: "#6b6259",
    brightRed: "#ee7373",
    brightGreen: "#7cc47c",
    brightYellow: "#e5be5e",
    brightBlue: "#7fb6e0",
    brightMagenta: "#c09fd6",
    brightCyan: "#6fc7bf",
    brightWhite: "#f5f2ec",
  },
};

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance. Ignores any alpha suffix. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio, 1..21. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
