import { DEFAULT_DENSITY, isDensity, type Density } from "../../main/density";
import { DEFAULT_COLOR_SCHEME, isColorScheme, resolveColorScheme, type ColorScheme } from "../../main/colorScheme";

/**
 * Appearance › Density on the page: the root attribute styles.css keys the
 * compact rule on. Anything unrecognised is the default, never a half-applied
 * layout. Called before the first render (main.tsx, from the boot) and on every
 * change, here or in another window (`hv:density-changed`).
 */
export function applyDensity(d: unknown): Density {
  const density = isDensity(d) ? d : DEFAULT_DENSITY;
  document.documentElement.dataset.density = density;
  return density;
}

/** What the root carries now — the page's starting state. */
export function currentDensity(): Density {
  const d = document.documentElement.dataset.density;
  return isDensity(d) ? d : DEFAULT_DENSITY;
}

/**
 * Appearance › Theme on the page. The root carries two attributes: the CHOICE
 * (`data-color-scheme`, which may be "system") and what it resolves to now
 * (`data-theme`, only ever "light" or "dark"), which is the one styles.css keys
 * the dark tokens on. Same call sites as applyDensity.
 *
 * "system" resolves with prefers-color-scheme, which in Electron reports
 * `nativeTheme.themeSource` — main sets that to the choice — so on "system" it is
 * the computer's setting, and it fires `change` when the computer switches.
 */
const systemDark = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyColorScheme(s: unknown): ColorScheme {
  const scheme = isColorScheme(s) ? s : DEFAULT_COLOR_SCHEME;
  const root = document.documentElement;
  root.dataset.colorScheme = scheme;
  root.dataset.theme = resolveColorScheme(scheme, systemDark?.matches ?? false);
  return scheme;
}

// The computer switched (or main just handed Electron a new themeSource): resolve again.
systemDark?.addEventListener("change", () => applyColorScheme(currentColorScheme()));

export function currentColorScheme(): ColorScheme {
  const s = document.documentElement.dataset.colorScheme;
  return isColorScheme(s) ? s : DEFAULT_COLOR_SCHEME;
}
