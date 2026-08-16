import { computeGauge, type Gauge, type GaugeZone, type SessionStats } from "../context";

/**
 * WS9: compact context indicator — a small clickable % bubble.
 * green <35 / orange 35–80 / red >80 (context.ts thresholds). The
 * measured/estimated label + token counts live in the tooltip (trust rule);
 * the bubble itself stays quiet enough to sit in the tab strip.
 */
/**
 * Round 15: two states per zone. The panel has no close button any more — the
 * pill IS the toggle, so it has to SHOW whether the panel is open, the way the
 * Files/Changes rail buttons already do for theirs.
 *
 * Pressed keeps the zone's hue rather than adopting the generic tangerine of
 * the ⌕ button: the colour here is information (calm / amber / red), so the
 * open-state is expressed by hardening the border and deepening the fill
 * instead of overwriting what the bubble is for.
 */
const ZONE: Record<GaugeZone, { rest: string; pressed: string }> = {
  calm: {
    rest: "border-leaf/60 bg-leaf-soft text-leaf",
    pressed: "border-leaf bg-leaf-soft text-leaf brightness-95",
  },
  amber: {
    rest: "border-honey/60 bg-honey-soft text-tangerine-deep",
    pressed: "border-honey bg-honey-soft text-tangerine-deep brightness-95",
  },
  red: {
    rest: "border-berry/60 bg-berry-soft text-berry",
    pressed: "border-berry bg-berry-soft text-berry brightness-95",
  },
};

/** The neutral bubbles (no measurement yet) have no hue to preserve, so they
    take the same pressed treatment as the ⌕ search button. */
const NEUTRAL_REST = "border-line bg-card text-ink-soft hover:border-honey";
const NEUTRAL_PRESSED = "border-tangerine bg-honey-soft text-tangerine-deep";

export function ContextBubble({
  stats,
  fallbackWindow,
  open,
  onToggle,
}: {
  stats: SessionStats | null;
  fallbackWindow?: number | null;
  /** Round 15: whether the context panel is showing — the pill reflects it. */
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const gauge: Gauge | null = computeGauge(stats, fallbackWindow);
  const verb = open ? "close" : "open";

  if (!gauge) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        title={`Context window usage — ${verb} the breakdown`}
        aria-label="Context usage"
        className={`font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 cursor-pointer transition-colors ${open ? NEUTRAL_PRESSED : NEUTRAL_REST}`}
      >
        —%
      </button>
    );
  }

  if (gauge.source === "pending") {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        title={`Context just compacted — Pi re-measures usage on the next response. ${open ? "Close" : "Open"} the breakdown.`}
        aria-label="Context usage: measuring"
        className={`font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 animate-pulse cursor-pointer ${open ? NEUTRAL_PRESSED : NEUTRAL_REST}`}
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
      onClick={onToggle}
      aria-pressed={open}
      title={`${tokens.toLocaleString()} / ${gauge.contextWindow.toLocaleString()} tokens (${gauge.source}) — ${verb} the breakdown`}
      aria-label={`Context usage ${percent}% (${gauge.source})`}
      className={`font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 cursor-pointer hover:brightness-[0.97] transition-all ${open ? ZONE[gauge.zone].pressed : ZONE[gauge.zone].rest}`}
    >
      {percent}%
    </button>
  );
}
