import { computeGauge, type Gauge, type GaugeZone, type SessionStats } from "../context";

/**
 * WS9: compact context indicator — a small clickable % bubble.
 * green <35 / orange 35–80 / red >80 (context.ts thresholds). The
 * measured/estimated label + token counts live in the tooltip (trust rule);
 * the bubble itself stays quiet enough to sit in the tab strip.
 */
const ZONE: Record<GaugeZone, string> = {
  calm: "border-leaf/60 bg-leaf-soft text-leaf",
  amber: "border-honey/60 bg-honey-soft text-tangerine-deep",
  red: "border-berry/60 bg-berry-soft text-berry",
};

export function ContextBubble({
  stats,
  fallbackWindow,
  onOpen,
}: {
  stats: SessionStats | null;
  fallbackWindow?: number | null;
  onOpen: () => void;
}): React.JSX.Element {
  const gauge: Gauge | null = computeGauge(stats, fallbackWindow);

  if (!gauge) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Context window usage — open the breakdown"
        aria-label="Context usage"
        className="font-mono text-[11px] font-bold rounded-full border-2 border-line bg-card px-2.5 py-1 text-ink-soft hover:border-honey cursor-pointer transition-colors"
      >
        —%
      </button>
    );
  }

  if (gauge.source === "pending") {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Context just compacted — Pi re-measures usage on the next response. Open the breakdown."
        aria-label="Context usage: measuring"
        className="font-mono text-[11px] font-bold rounded-full border-2 border-line bg-card px-2.5 py-1 text-ink-soft animate-pulse cursor-pointer"
      >
        …%
      </button>
    );
  }

  const percent = gauge.percent ?? 0;
  const tokens = gauge.tokens ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${tokens.toLocaleString()} / ${gauge.contextWindow.toLocaleString()} tokens (${gauge.source}) — open the breakdown`}
      aria-label={`Context usage ${percent}% (${gauge.source})`}
      className={`font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 cursor-pointer hover:brightness-[0.97] transition-all ${ZONE[gauge.zone]}`}
    >
      {percent}%
    </button>
  );
}
