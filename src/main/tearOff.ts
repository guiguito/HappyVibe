/**
 * §7 round 23 — a drag that ended outside every window is a tear-off.
 *
 * The judgement is MAIN's because main owns the window bounds. It also settles
 * the two cases that look the same from the renderer: a drag cancelled with
 * Escape and a drop that missed a strip both end with no drop target, but both
 * end INSIDE a window, so neither tears off.
 *
 * Pure, and electron-free, so the suite can drive it directly.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Right and bottom are exclusive: a window's edge pixel belongs to the window. */
export const insideAny = (pt: { x: number; y: number }, rects: Rect[]): boolean =>
  rects.some((r) => pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + r.height);
