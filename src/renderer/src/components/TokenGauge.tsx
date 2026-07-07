import { computeGauge, type Gauge, type GaugeZone, type SessionStats } from "../context";

const ZONE: Record<GaugeZone, { bar: string; text: string; border: string; bg: string }> = {
  calm: { bar: "bg-leaf", text: "text-ink-soft", border: "border-line", bg: "bg-card" },
  amber: { bar: "bg-honey", text: "text-tangerine-deep", border: "border-honey/60", bg: "bg-honey-soft" },
  red: { bar: "bg-berry", text: "text-berry", border: "border-berry/60", bg: "bg-berry-soft" },
};

const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/**
 * Per-session context gauge (ChatView header). Trust is the product: the
 * measured/estimated label is NEVER omitted. Clicking opens the breakdown panel.
 */
export function TokenGauge({
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
        className="font-mono text-[11px] rounded-full border-2 border-line bg-card px-3 py-1 text-ink-soft hover:border-honey cursor-pointer transition-colors"
      >
        context
      </button>
    );
  }

  const z = ZONE[gauge.zone];
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${gauge.tokens.toLocaleString()} / ${gauge.contextWindow.toLocaleString()} tokens (${gauge.source}) — open the breakdown`}
      className={`group flex items-center gap-2 rounded-full border-2 ${z.border} ${z.bg} pl-2.5 pr-3 py-1 cursor-pointer hover:brightness-[0.98] transition-all`}
    >
      <span className="relative w-14 h-1.5 rounded-full bg-line/60 overflow-hidden">
        <span className={`absolute inset-y-0 left-0 rounded-full ${z.bar}`} style={{ width: `${Math.min(100, gauge.percent)}%` }} />
      </span>
      <span className={`font-mono text-[11px] font-bold ${z.text}`}>{gauge.percent}%</span>
      <span className="font-mono text-[10px] text-ink-soft">
        {fmt(gauge.tokens)}/{fmt(gauge.contextWindow)}
      </span>
      <span
        className={`text-[9px] font-bold uppercase tracking-wide rounded px-1 py-px ${
          gauge.source === "measured" ? "bg-leaf-soft text-leaf" : "bg-paper-deep text-ink-soft"
        }`}
      >
        {gauge.source === "measured" ? "measured" : "est."}
      </span>
    </button>
  );
}
