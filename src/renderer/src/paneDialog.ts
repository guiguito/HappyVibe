/**
 * §7 round 21 — a session's dialogs render inside that session's pane.
 *
 * WHY, and it is a §28 reason rather than a taste one: a viewport-wide dialog
 * and its viewport-wide scrim lie across EVERY pane, which is exactly the
 * situation where a composited `WebContentsView` and the DOM contend over which
 * is on top. The app's answer to that contention is to HIDE the page — so a
 * permission prompt about one session blanked a browser in another. A dialog
 * scoped to one pane never overlaps a browser in a different pane, so the
 * question stops being asked rather than being answered better.
 *
 * Pure so the no-DOM suite can pin it.
 */

/**
 * The pane element to portal into, or null to fall back to the viewport.
 *
 * The null cases are load-bearing, not defensive. A chat pane wrapper is
 * `hidden` whenever the user is on a settings page, and portalling a permission
 * prompt into a hidden element makes it INVISIBLE — while permission prompts
 * never time out by design, so the agent would wait forever with nothing on
 * screen. Same for a pane whose tab was closed while its session kept running.
 */
export function dialogHost(el: HTMLElement | null | undefined): HTMLElement | null {
  if (!el) return null;
  // `offsetParent === null` covers display:none on the element or any ancestor.
  if (el.offsetParent === null) return null;
  // And a positioned-but-collapsed pane has no box to centre anything in.
  return el.getClientRects().length > 0 ? el : null;
}

/** Scoped: absolute within the pane, which must therefore be `relative`. */
export const SCOPED_OVERLAY = "hv-overlay absolute inset-0 bg-ink/50 backdrop-blur-[2px]";
/**
 * Clamped to the pane and scrolling inside it: a narrow pane must not push the
 * dialog out over its neighbour, which is the browser pane this exists to stop
 * covering. `1.5rem` leaves the same visual inset the viewport variant has.
 */
export const SCOPED_CONTENT =
  "hv-dialog absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto";

/** Viewport: what every dialog did before, and still the fallback. */
export const VIEWPORT_OVERLAY = "hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]";
export const VIEWPORT_CONTENT = "hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
