/**
 * Brand mark for an MCP server, in order of preference:
 *   1. a simple-icons glyph, when the pack ships one
 *   2. an inline vendor glyph, for services it doesn't (BrandGlyphs.tsx)
 *   3. a monogram, so nothing ever renders as a blank square
 *
 * Everything renders in `currentColor` / ink so a row of marks reads as one
 * set. The monogram used to carry a per-name colour tint, which made unknown
 * servers louder than the real logos beside them — the point of the fallback is
 * to be unobtrusive, not to stand out.
 *
 * Round 8 follow-up: simple-icons removed Playwright, Slack, OpenAI and AWS in
 * v13.0.0's "request permission, or remove" batch, and Microsoft still
 * publishes no official Playwright SVG (microsoft/playwright#32888). Those get
 * the monogram rather than a mark shipped without permission.
 */
import { INLINE_GLYPHS, glyphKey } from "./BrandGlyphs";

/**
 * True when BrandMark will render a real LOGO rather than a monogram.
 *
 * It lives beside the component, and reads the same INLINE_GLYPHS table, because
 * the §25 store sorts "recognised brands first" and that sort must ask exactly
 * the question the card answers. It did not: it tested only the simple-icons
 * class, so `firecrawl` — which has no simple-icons entry but DOES have an
 * inline vendor glyph (tier 2 below) — drew a flame while sorting among the
 * monograms.
 */
export function hasBrandMark(card: { name: string; brand?: string }): boolean {
  return !!card.brand || !!INLINE_GLYPHS[glyphKey(card.name)];
}

/** First alphanumeric character, uppercased — "chrome_devtools" → "C". */
export function monogram(name: string): string {
  return (name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
}

export function BrandMark({
  name,
  brand,
  size = "sm",
}: {
  /** Display name or server key — resolves an inline glyph, else the monogram. */
  name: string;
  /** simple-icons class, when one exists. */
  brand?: string;
  size?: "sm" | "lg";
}): React.JSX.Element {
  const lg = size === "lg";

  if (brand) {
    return <i className={`si ${brand} ${lg ? "text-xl" : "text-base"} shrink-0`} aria-hidden />;
  }

  const glyph = INLINE_GLYPHS[glyphKey(name)];
  if (glyph) {
    return (
      <svg
        viewBox={glyph.viewBox}
        className={`${lg ? "size-5" : "size-4"} shrink-0`}
        fill="none"
        aria-hidden
        preserveAspectRatio="xMidYMid meet"
      >
        {glyph.node}
      </svg>
    );
  }

  return (
    <span
      aria-hidden
      className={`${lg ? "size-5 text-[11px]" : "size-4 text-[10px]"} shrink-0 rounded border border-line bg-paper-deep text-ink font-black flex items-center justify-center leading-none`}
    >
      {monogram(name)}
    </span>
  );
}
