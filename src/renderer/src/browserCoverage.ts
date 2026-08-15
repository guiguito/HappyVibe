/**
 * §28 — "is something drawn on top of the browser pane?", as pure geometry.
 *
 * Lives outside BrowserTab so it can be tested without a DOM: the component's
 * job is to gather rectangles, this decides what they mean. The decision matters
 * because a composited WebContentsView has no z-index — whatever is "above" it is
 * really underneath, and swallows its own clicks.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Do two rectangles share any area? Touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom;
}

/**
 * The nine points hit-testing samples inside a pane.
 *
 * Exported for the same reason the overlap test is: the gap between these points
 * IS the failure mode. A small, edge-anchored overlay — the onboarding card sits
 * bottom-right inset 24px — can sit entirely between them, which is why
 * declared overlays are additionally checked by rectangle.
 */
export function samplePoints(pane: Rect, inset: number): Array<[number, number]> {
  const w = pane.right - pane.left;
  const h = pane.bottom - pane.top;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      pts.push([pane.left + inset + (i * (w - 2 * inset)) / 2, pane.top + inset + (j * (h - 2 * inset)) / 2]);
    }
  }
  return pts;
}

/** Is `p` one of the sampled points? (Used to reason about the blind spot.) */
export function anyPointInside(points: Array<[number, number]>, r: Rect): boolean {
  return points.some(([x, y]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}
