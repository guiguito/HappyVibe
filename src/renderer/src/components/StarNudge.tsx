import React from "react";
import { BrandLogo } from "./BrandLogo";
import { DUR } from "../motion";
import { usePresence } from "../usePresence";
import { STAR_COPY } from "../starNudge";

/**
 * §36 — the star nudge. Bottom-right, once every few days, two buttons.
 *
 * ponytail: this card's box overlaps any embedded browser pane in the same
 * corner, so §28's coverage check (browserCoverage.ts `paneIsCovered`) blanks
 * that page for as long as the card is up. It comes back on dismiss —
 * BrowserTab's MutationObserver re-runs the check when the card unmounts.
 * ACCEPTED: the card is small, transient, and appears once every few days.
 * The upgrade path if it ever grates is to skip the run when a `:browser:` tab
 * is mounted — never to loosen the coverage check, which has no false
 * positives, only honest ones.
 *
 * Two geometry rules this obeys, both already paid for elsewhere:
 *  - NO `fixed inset-0` positioner. That is exactly the shape
 *    `tests/browser-coverage.test.ts` pins as covering, and a viewport-wide box
 *    around small centred content is the voice-pill bug — it blanked the whole
 *    page for a pill you could see was tiny. The card positions ITSELF.
 *  - It stays on the app's own scale (40) rather than climbing to the modal
 *    layer, which `.hv-overlay`/`.hv-dialog` own at 100. So a permission modal
 *    or an `ask_user` prompt paints OVER this with no gating code here: the
 *    nudge is a request, and it yields to anything the agent is waiting on.
 *    (Spelling the modal layer's number here as a Tailwind class would itself
 *    fail `tests/modal-layer.test.ts`, which scans this file's whole source.)
 */

/**
 * The card's own geometry, exported so `tests/star-nudge.test.ts` can feed it to
 * `paneIsCovered` — the assertion that stops someone re-adding a full-screen
 * positioner around it later. `bottom-6 right-6` = the 24px inset, `w-[340px]`.
 */
export const STAR_NUDGE_BOX = { inset: 24, width: 340 } as const;

/** Feather geometry, hand-drawn like every other icon here — there is no icon library. */
function StarIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

const PRIMARY_BTN =
  "flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const GHOST_BTN =
  "rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

export function StarNudge({
  show,
  onStar,
  onLater,
}: {
  show: boolean;
  onStar: () => void;
  onLater: () => void;
}): React.JSX.Element | null {
  // Keeps the card mounted through its exit — a conditional render is removed
  // before a frame can paint, which is why every overlay here uses this.
  const { mounted, leaving } = usePresence(show, DUR.panel);
  if (!mounted) return null;

  // The whole class list is ONE literal on purpose: `tests/motion-tokens.test.ts`
  // scans the first string of each `className`, so a concatenation would hide
  // the transition from the check rather than satisfy it. And the properties it
  // names are `scale` and `translate`, never `transform` — Tailwind v4 compiles
  // `scale-*`/`translate-*` to their own CSS properties, so a list naming
  // `transform` animates nothing while looking correct. The exit lands on
  // exactly `opacity-0`: BrowserTab reads anything above 0 as still painted, and
  // an invisible remnant would keep the browser pane blanked.
  return (
    <div
      data-leaving={leaving || undefined}
      className={`fixed bottom-6 right-6 z-40 w-[340px] rounded-2xl bg-card border-2 border-ink/70 shadow-pop p-5 motion-safe:transition-[scale,opacity,translate] motion-safe:duration-270 motion-safe:ease-hv-pop motion-safe:starting:opacity-0 motion-safe:starting:scale-[.96] motion-safe:starting:translate-y-3 motion-safe:data-[leaving]:opacity-0 motion-safe:data-[leaving]:scale-[.96] motion-safe:data-[leaving]:translate-y-3 motion-safe:data-[leaving]:duration-180 motion-safe:data-[leaving]:ease-hv-in`}
    >
      <div className="flex items-start gap-2.5">
        <BrandLogo size="sm" />
        <h2 className="flex-1 font-black text-base tracking-tight leading-tight pt-1.5">{STAR_COPY.title}</h2>
        <button
          type="button"
          onClick={onLater}
          aria-label={STAR_COPY.close}
          title={STAR_COPY.close}
          className="text-ink-soft hover:text-ink cursor-pointer font-black text-lg leading-none -mt-0.5"
        >
          ×
        </button>
      </div>

      <p className="mt-2.5 text-sm text-ink-soft leading-relaxed">{STAR_COPY.body}</p>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onStar} className={PRIMARY_BTN}>
          <StarIcon />
          {STAR_COPY.cta}
        </button>
        <button type="button" onClick={onLater} className={GHOST_BTN}>
          {STAR_COPY.later}
        </button>
      </div>
    </div>
  );
}
