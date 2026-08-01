/**
 * Brand mark for an MCP server: the real simple-icons glyph when we have one,
 * a tinted monogram when we don't.
 *
 * Round 8 follow-up. simple-icons ships no icon for Firecrawl or Composio
 * (below their notability bar) and REMOVED Playwright, Slack, OpenAI and AWS in
 * v13.0.0's "request permission, or remove" batch — Microsoft still publishes
 * no official Playwright SVG (microsoft/playwright#32888). Re-adding those
 * marks ourselves is precisely what a project that curates brand icons for a
 * living declined to do without permission, so we don't.
 *
 * A monogram costs no assets, needs no network, carries no trademark exposure,
 * and covers every future entry automatically — which a per-brand SVG pile
 * never would. It replaces the blank grey square these rows used to show.
 */

/** Deterministic tint so a given server always looks the same. */
const TINTS = [
  "bg-honey-soft text-tangerine-deep border-honey/60",
  "bg-leaf-soft text-leaf border-leaf/50",
  "bg-berry-soft text-berry border-berry/50",
  "bg-paper-deep text-ink-soft border-line",
] as const;

export function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
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
  /** Display name or server key — drives the monogram and its tint. */
  name: string;
  /** simple-icons class, when one exists. */
  brand?: string;
  size?: "sm" | "lg";
}): React.JSX.Element {
  const box = size === "lg" ? "size-6 text-sm" : "size-4 text-[10px]";
  if (brand) {
    return <i className={`si ${brand} ${size === "lg" ? "text-xl" : "text-base"} shrink-0`} aria-hidden />;
  }
  return (
    <span
      aria-hidden
      className={`${box} ${tintFor(name)} shrink-0 rounded border font-black flex items-center justify-center leading-none`}
    >
      {monogram(name)}
    </span>
  );
}
