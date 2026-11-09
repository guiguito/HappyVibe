import { DEFAULT_DENSITY, isDensity, type Density } from "../../main/density";

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
