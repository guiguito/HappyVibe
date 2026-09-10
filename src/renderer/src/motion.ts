/**
 * Animations round (2026-09-10): the motion vocabulary as DATA, plus the two
 * things CSS cannot do — a flight between two elements that are not related in
 * the DOM, and siblings sliding into the gap one of them left.
 *
 * The tokens are mirrored from `styles.css`'s `@theme` and pinned equal by
 * `tests/motion-tokens.test.ts`: the stylesheet is what Tailwind reads, this is
 * what the helpers and the tests read, and the suite has no DOM to compare them
 * in — so a source scan is the contract.
 */

/** Every duration in the app, in ms. Nothing here may exceed `flight`. */
export const DUR = { fast: 120, base: 150, panel: 180, flight: 320 } as const;

/** Enters and movement are `out`; exits are `in` and always shorter. */
export const EASE = {
  out: "cubic-bezier(0.2, 0, 0, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  pop: "cubic-bezier(0.34, 1.4, 0.64, 1)",
} as const;

let reduced: boolean | null = null;

/**
 * Reduced motion means the SETTLED FRAME, never a faster animation — §22's rule
 * made general. Read once and cached: the setting does not change under a
 * running app, and every helper below calls this on a hot path.
 */
export function reducedMotion(): boolean {
  if (reduced === null) {
    reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return reduced;
}

/**
 * Clone `fromEl`, fly the clone to `toEl`'s rect, drop it. Neither original
 * moves; the ghost is the only thing that travels, which is what lets the
 * source card stay exactly where the user left it.
 *
 * Three things here are load-bearing and each would fail silently:
 *
 * 1. `position: fixed` is an INLINE style, never a class. §28's coverage check
 *    (`BrowserTab.tsx`) gathers candidates by the CLASS WORDS `absolute` /
 *    `fixed` and judges them by bounding box — a ghost carrying either word
 *    would blank a browser pane for the length of the flight.
 * 2. `pointer-events: none`, so a click during the flight reaches the real UI.
 * 3. The clone is `aria-hidden` and stripped of its id: it is a picture of a
 *    control, and a screen reader must not find a second copy of one.
 *
 * Returns a promise that settles when the ghost has been removed — including on
 * a cancelled animation, so a caller awaiting it can never hang.
 */
export function flyGhost(
  fromEl: HTMLElement,
  toEl: HTMLElement,
  opts: { duration?: number; round?: boolean } = {},
): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  // A zero rect means the element is display:none or not laid out yet. Flying
  // from or to nothing is a flicker, not an animation.
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return Promise.resolve();

  const ghost = fromEl.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: "0",
    pointerEvents: "none",
    // Clear of the app's own scale (which tops out at z-50) and well below the
    // modal layer at 100 — a ghost must never cross a dialog.
    zIndex: "30",
    boxSizing: "border-box",
    overflow: "hidden",
    transformOrigin: "top left",
  });
  document.body.appendChild(ghost);

  const duration = opts.duration ?? DUR.flight;
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  // Non-uniform scale, because the source is a wide header row and the target a
  // small square: forcing one ratio would leave the ghost the wrong shape at
  // the moment it is supposed to BE the circle.
  const sx = b.width / a.width;
  const sy = b.height / a.height;
  const anim = ghost.animate(
    [
      {
        transform: "translate(0, 0) scale(1, 1)",
        borderRadius: getComputedStyle(fromEl).borderRadius,
        opacity: 1,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        borderRadius: opts.round ? "50%" : getComputedStyle(toEl).borderRadius,
        opacity: 0.95,
      },
    ],
    { duration, easing: EASE.out, fill: "forwards" },
  );

  // The text goes early: a headline squeezed into 36px is illegible smear, and
  // fading it over the first 40% reads as the card becoming a token.
  for (const t of ghost.querySelectorAll<HTMLElement>("*")) {
    if (t.childElementCount === 0 && t.textContent?.trim()) {
      t.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration, fill: "forwards" });
    }
  }

  const drop = (): void => ghost.remove();
  return anim.finished.then(drop, drop);
}

/**
 * The rects of `parent`'s marked children, taken BEFORE the list changes. Feed
 * the result to `flipChildren` after React has committed the new list.
 */
export function snapshotRects(parent: HTMLElement, attr: string): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  for (const el of parent.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const key = el.getAttribute(attr);
    if (key) m.set(key, el.getBoundingClientRect());
  }
  return m;
}

/**
 * FLIP: a child that MOVED starts from where it used to be and travels to where
 * it now is, so a neighbour leaving reads as the row closing up rather than as
 * everything teleporting one slot left.
 *
 * A child with no previous rect is NEW and is deliberately skipped — its own
 * `starting:` enter owns that, and translating it from nowhere would fight it.
 */
export function flipChildren(parent: HTMLElement, attr: string, prev: Map<string, DOMRect>): void {
  if (reducedMotion()) return;
  for (const el of parent.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const key = el.getAttribute(attr);
    const was = key ? prev.get(key) : undefined;
    if (!was) continue;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (dx === 0 && dy === 0) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: 200,
      easing: EASE.out,
    });
  }
}
