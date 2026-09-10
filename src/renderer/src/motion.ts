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
export const DUR = { fast: 180, base: 220, panel: 270, flight: 480 } as const;

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
  opts: { duration?: number; round?: boolean; fromRect?: DOMRect; fit?: "stretch" | "contain" } = {},
): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  // `fromRect` exists for the case where the ACTION that creates the
  // destination also hides the origin. "Open as tab" does exactly that: the new
  // tab takes over the pane, so one frame later the circle is inside a hidden
  // pane and measures 0x0 — and this function then declines, correctly but
  // uselessly. The caller measures first and hands the rect in.
  const a = opts.fromRect ?? fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  // A zero rect means the element is display:none or not laid out yet. Flying
  // from or to nothing is a flicker, not an animation.
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return Promise.resolve();

  const ghost = fromEl.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  // A clone inherits ATTRIBUTES, and `data-leaving` is an attribute that drives
  // CSS. By the time "open as tab" clones the circle, that circle is already
  // retiring — so the ghost arrived carrying the exit and rendered at 0.15
  // scale, a 5px speck instead of a 36px token. Strip every state marker: a
  // ghost is a picture of the thing at rest, never a participant in its state.
  ghost.removeAttribute("data-leaving");
  for (const n of ghost.querySelectorAll("[data-leaving]")) n.removeAttribute("data-leaving");
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
  const startRadius = getComputedStyle(fromEl).borderRadius;

  /**
   * Two flights, two intents, and the difference is visible.
   *
   * "stretch" (the default) makes the ghost BECOME the destination: it matches
   * its box exactly, on each axis independently. That is right for card→circle,
   * where the ghost has to arrive AS the circle — one shared ratio would land
   * it the wrong shape at the moment it is supposed to be that circle.
   *
   * "contain" makes the ghost go INTO the destination: one ratio for both axes
   * so it keeps its shape, ending a little smaller than the target and centred
   * on it. Circle→tab needs this — stretching a 36px circle into an 86x40 tab
   * scales it 2.4x wide against 1.1x tall, and it arrives as an oval. Reported
   * on sight, and the reporter was right.
   */
  let dx: number, dy: number, sx: number, sy: number, endRadius: string;
  if (opts.fit === "contain") {
    // 0.7 so it nests visibly INSIDE rather than filling the target edge to
    // edge — "it went in there" reads better than "it became that".
    const s = (Math.min(b.width / a.width, b.height / a.height) * 7) / 10;
    sx = s;
    sy = s;
    // transformOrigin is the top-left corner, so the scaled centre sits at
    // `a.left + a.width * s / 2` — the translate has to close the gap between
    // that and the destination's centre, not between the two corners.
    dx = b.left + b.width / 2 - (a.left + (a.width * s) / 2);
    dy = b.top + b.height / 2 - (a.top + (a.height * s) / 2);
    // It keeps its own shape, so it keeps its own corners.
    endRadius = startRadius;
  } else {
    dx = b.left - a.left;
    dy = b.top - a.top;
    sx = b.width / a.width;
    sy = b.height / a.height;
    endRadius = opts.round ? "50%" : getComputedStyle(toEl).borderRadius;
  }

  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1, 1)", borderRadius: startRadius, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: endRadius, opacity: 0.95 },
    ],
    { duration, easing: EASE.out, fill: "forwards" },
  );

  // The text is HELD, then goes late.
  //
  // It used to fade over the first 40%, which meant the ghost spent the last
  // two thirds of its flight as a blank rounded rectangle — reported as "I
  // don't see anything", and rightly: the thing you are meant to follow had
  // already lost the only feature that identified it. A headline squeezed into
  // 36px really is smear, so it still goes; it just goes at the END, while the
  // ghost is shrinking and there is no longer room for it.
  for (const t of ghost.querySelectorAll<HTMLElement>("*")) {
    if (t.childElementCount === 0 && t.textContent?.trim()) {
      t.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration, fill: "forwards" });
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
      duration: 300,
      easing: EASE.out,
    });
  }
}
