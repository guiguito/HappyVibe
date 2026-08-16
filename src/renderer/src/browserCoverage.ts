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

export function paneViewRect(
  pane: Rect,
  edges: { left: boolean; top: boolean; right: boolean; bottom: boolean } | undefined,
  dividerInset: number,
  drawerWidth: number,
  viewportWidth: number,
): { x: number; y: number; width: number; height: number } {
  const L = edges?.left ? dividerInset : 0;
  const T = edges?.top ? dividerInset : 0;
  const R = edges?.right ? dividerInset : 0;
  const B = edges?.bottom ? dividerInset : 0;
  const drawerLeft = viewportWidth - drawerWidth;
  const RD = drawerWidth > 0 ? Math.max(0, pane.right - drawerLeft) : 0;
  return {
    x: pane.left + L,
    y: pane.top + T,
    width: Math.max(0, pane.right - pane.left - L - R - RD),
    height: Math.max(0, pane.bottom - pane.top - T - B),
  };
}

/**
 * A floating element the pane might be hiding under, reduced to what the
 * decision needs. The component gathers these from the DOM; this module decides
 * what they mean.
 */
export interface Candidate {
  rect: Rect;
  /** Part of this pane's own chrome, or an ancestor of it — never "on top". */
  isSelf: boolean;
  /** The drawer (or anything inside it): the pane makes ROOM for that, see paneViewRect. */
  isDrawer: boolean;
  /** Painted at all. A hidden element still has a rectangle. */
  visible: boolean;
}

/**
 * §28 round 2 — is anything drawn over the pane, asked by RECTANGLE.
 *
 * The 3×3 hit test this replaces had gaps, and the gaps were the failure mode:
 * the onboarding card fell between the nine points, and so did the pane `+`
 * menu dropping in from the top edge — it rendered clipped at the page's top
 * because the view never got out of its way. Rectangles cannot have gaps.
 *
 * The candidates are found WITHOUT a marker list: this app is styled entirely
 * with Tailwind, so every floating surface carries `absolute` or `fixed` as a
 * literal class. That keeps the property the geometric rule was introduced for —
 * it catches surfaces nobody remembered to mark, including ones that do not
 * exist yet — while fixing the part that was unsound.
 */
export function paneIsCovered(view: Rect, candidates: Candidate[]): boolean {
  for (const c of candidates) {
    if (c.isSelf || c.isDrawer || !c.visible) continue;
    if (c.rect.right - c.rect.left < 1 || c.rect.bottom - c.rect.top < 1) continue;
    if (rectsOverlap(view, c.rect)) return true;
  }
  return false;
}
