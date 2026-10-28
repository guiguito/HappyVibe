/**
 * Appearance › Theme — light, dark, or whatever the computer is set to.
 *
 * Dark is the same idea as Compact: the colour TOKENS change, not the
 * components. Every colour in the app is a `--color-*` variable from theme.css,
 * so one unlayered rule in styles.css (`:root[data-theme="dark"]`) redefines
 * them all and nothing can be forgotten; tests/color-scheme.test.ts fails if a
 * token is added to theme.css without a dark value. The switch is `data-theme`
 * on the root, always the RESOLVED scheme ("light" or "dark"), so the CSS never
 * has to know about "system".
 *
 * Global, like Density: main stores it in config.json, hands it to every window
 * at boot so a dark app never paints one light frame, and sets Electron's
 * `nativeTheme.themeSource` to it — which is what turns menus, dialogs and
 * scrollbars dark too, and what `prefers-color-scheme` reports in the renderer,
 * so "system" resolves there with a plain media query.
 *
 * Imports nothing: main validates with it, the renderer draws the page from it.
 */

export type ColorScheme = "light" | "dark" | "system";

/** Light, as the app has always looked: a new setting changes nobody's app. */
export const DEFAULT_COLOR_SCHEME: ColorScheme = "light";

export const COLOR_SCHEMES: ReadonlyArray<{ id: ColorScheme; name: string; note: string }> = [
  { id: "light", name: "Light", note: "Cream paper and warm ink." },
  { id: "dark", name: "Dark", note: "The same warm colours on a dark background, easier on the eyes at night." },
  { id: "system", name: "Match system", note: "Light or dark like the rest of your computer, and switches when it does." },
];

export function isColorScheme(v: unknown): v is ColorScheme {
  return v === "light" || v === "dark" || v === "system";
}

/** What gets painted: "system" becomes what the computer says now. */
export function resolveColorScheme(s: ColorScheme, systemDark: boolean): "light" | "dark" {
  return s === "system" ? (systemDark ? "dark" : "light") : s;
}

/**
 * A window's background before its page paints (and behind a resize), one per
 * painted scheme. These are `--color-paper` in each; the test pins them equal.
 */
export const WINDOW_BACKGROUND = { light: "#faf4e8", dark: "#1d1813" } as const;
