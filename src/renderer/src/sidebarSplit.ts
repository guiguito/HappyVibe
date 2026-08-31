/**
 * §7 round 12 — the workspace-tree / Settings split, stored as a PROPORTION.
 *
 * Round 11 added the drag handle and persisted the tree's height in **pixels**,
 * which is silently wrong the moment the window changes size: 380 px is two
 * thirds of a short window and a quarter of a tall one, so the split the user
 * chose is not the split they get back. A fraction is the same shape at every
 * height.
 *
 * A legacy pixel value must not be read as a fraction (380 would clamp to the
 * maximum and pin the tree open forever), so anything > 1 degrades to "auto" —
 * the flex behaviour the sidebar had before the handle existed. That is the
 * whole migration: no version key, no rewrite pass, one comparison.
 */

/** "auto" — the pre-handle flex layout. */
export const AUTO = 0;

/** Never leave either half unusable, however hard the handle is dragged. */
export const MIN_FRACTION = 0.2;
export const MAX_FRACTION = 0.8;

export function clampFraction(f: number): number {
  return Math.max(MIN_FRACTION, Math.min(MAX_FRACTION, f));
}

/**
 * Parse the persisted value.
 *   - a fraction in (0, 1]  → clamped and used
 *   - anything > 1          → a round-11 PIXEL value; degrade to auto
 *   - absent / unparseable  → auto
 */
export function readSplit(raw: string | null | undefined): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return AUTO;
  if (v > 1) return AUTO; // legacy px — do not reinterpret as a fraction
  return clampFraction(v);
}

/** Serialise for localStorage. `AUTO` round-trips as "0". */
export function writeSplit(fraction: number): string {
  return String(fraction === AUTO ? AUTO : clampFraction(fraction));
}

/**
 * The fraction a drag lands on, given where the pointer is and how tall the
 * sidebar is. Kept here (rather than inline in the handler) so the clamping is
 * testable without a DOM.
 */
export function fractionFor(heightPx: number, sidebarPx: number): number {
  if (sidebarPx <= 0) return AUTO;
  return clampFraction(heightPx / sidebarPx);
}

/**
 * Does the dragged fraction apply right now?
 *
 * Round 12 established that "a dragged height with the group collapsed is a
 * division of nothing". §16 round 18 put four collapsible groups INSIDE that
 * group, so the same is true one level down: an open `Settings` whose four
 * groups are all shut is ~204px of content, and pinning the tree at its
 * dragged height there leaves the remainder as dead pegboard — the exact
 * defect round 12 fixed, reintroduced one level in.
 */
export function isSized(settingsOpen: boolean, fraction: number, openGroupCount: number): boolean {
  return settingsOpen && openGroupCount > 0 && fraction !== AUTO;
}
