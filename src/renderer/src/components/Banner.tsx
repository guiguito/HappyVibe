/**
 * §20 round 17 — the ONE banner.
 *
 * The grammar existed already, hand-rolled four times and at two different
 * border opacities (`border-berry/60` in App, `border-berry/40` in ChatView),
 * which is drift nobody chose. One shape now, one opacity.
 *
 * Principle 10 is the boundary: PERSISTENT state is a pill, TRANSIENT guidance
 * is a banner. The plan-mode banner→pill migration is what made that a rule, so
 * plan mode must never come back through here — `tests/banner.test.ts` fails if
 * it does.
 *
 * Tones are three of §20's five semantic colours: berry = danger/destructive
 * (and berry is ONLY ever that), honey = attention/offer, sky = informational.
 * Guidance never invents a sixth.
 */
export const BANNER_TONE = {
  danger: "bg-berry-soft border-berry/60 text-berry",
  attention: "bg-honey-soft border-honey/60",
  info: "bg-sky-soft border-sky/60",
} as const;

export function Banner({
  tone,
  children,
  onDismiss,
  leaving,
}: {
  tone: keyof typeof BANNER_TONE;
  children: React.ReactNode;
  onDismiss?: () => void;
  /**
   * Animations round (2026-09-10): true while `usePresence` is holding this
   * banner mounted for its exit. A banner takes a strip of height off the top
   * of the app, so appearing and disappearing SHOVES the whole conversation —
   * which is why the reveal is a height (`grid-template-rows` 0fr→1fr, the
   * DelegationRunCard idiom) and not just a fade.
   */
  leaving?: boolean;
}): React.JSX.Element {
  return (
    <div
      data-leaving={leaving || undefined}
      className="grid grid-rows-[1fr] motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-[240ms] motion-safe:ease-hv-out motion-safe:starting:grid-rows-[0fr] motion-safe:starting:opacity-0 motion-safe:data-[leaving]:grid-rows-[0fr] motion-safe:data-[leaving]:opacity-0 motion-safe:data-[leaving]:duration-180 motion-safe:data-[leaving]:ease-hv-in"
    >
      <div
        className={`min-h-0 overflow-hidden flex items-center gap-3 px-6 py-2.5 border-b-2 text-sm font-semibold ${BANNER_TONE[tone]}`}
      >
        {children}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
