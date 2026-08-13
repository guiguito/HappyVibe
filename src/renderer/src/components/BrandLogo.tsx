/**
 * §20 round 12 — the app icon IS the brand mark.
 *
 * The three places that used to stand in for it with an `hv` wordmark (the
 * sidebar header, the collapsed rail, the first-run Models page) render this
 * instead, so what the user sees in the Dock and what they see in the app are
 * the same object.
 *
 * Drawn inline rather than imported: the renderer's CSP is `img-src 'self'
 * data:`, so an `<img src={icon}>` would be a blank square in the packaged app
 * — the same class of trap as §27's worklet. Every other glyph in the app is
 * inline SVG for exactly this reason (BrandGlyphs, the nav set, the file tree).
 *
 * Geometry and hexes are copied from `build/icon.svg`; keep them in step if the
 * icon is ever redrawn.
 */

const SIZES = { sm: "size-9", lg: "size-14" } as const;

export function BrandLogo({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof SIZES;
  /** Extra classes on the wrapper — the sidebar adds its hover rotation here. */
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`${SIZES[size]} shrink-0 rotate-3 ${className}`}>
      <svg viewBox="0 0 1024 1024" className="size-full" aria-hidden>
        <rect
          x="42"
          y="42"
          width="940"
          height="940"
          rx="228"
          ry="228"
          fill="#ee5a24"
          stroke="#33251a"
          strokeWidth="38"
        />
        <circle cx="392" cy="422" r="54" fill="#faf4e8" />
        <circle cx="632" cy="422" r="54" fill="#faf4e8" />
        <path
          d="M352 620c50 70 110 105 160 105s110-35 160-105"
          stroke="#faf4e8"
          strokeWidth="52"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
