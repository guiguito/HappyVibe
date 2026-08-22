/**
 * B7 renderer-side pure formatters for the dashboard and the cost panel. No
 * React, no DOM — unit tested in tests/analytics-format.test.ts. Money is always
 * presented as an ESTIMATE by the calling UI (the number itself is formatted
 * here).
 */

/** Compact token/count: 1234 → "1.2k", 2_500_000 → "2.5M". */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

/** USD estimate. Sub-cent sums keep more precision so they don't read as $0.00. */
export function fmtCost(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (usd < 0.01) return "$" + usd.toFixed(4);
  return "$" + usd.toFixed(2);
}

/** Human duration from ms: "—" when unknown, else "45s" / "12m" / "1h 20m". */
export function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Pill tone: quiet = nothing measured, calm = a number we stand behind, amber = a gap. */
export type CostTone = "quiet" | "calm" | "amber";

/**
 * What the session-cost pill says, and how loudly. Pure so the branch table can
 * be asserted directly (CostBubble only maps the tone to classes).
 *
 * Two rules the branches encode:
 *  - a PLAN call never contributes money and never raises amber. Pi prices a
 *    ChatGPT/Copilot subscription at full API rates, so showing those dollars
 *    invents spend; but "your subscription covers it" is a fact, not a gap.
 *  - an UNKNOWN call is the only thing worth alarming about: tokens burned at a
 *    rate we do not have, where $0.00 would read as free.
 */
export function costPill(total: HvLedgerTotal): { label: string; tone: CostTone } {
  if (total.calls === 0) return { label: "—", tone: "quiet" };
  // Nothing metered, nothing unknown ⇒ the whole session rode a subscription.
  if (total.metered === 0 && total.unknown === 0) return { label: "plan", tone: "calm" };
  if (total.metered === 0) return { label: "$?", tone: "amber" };
  // "+?" when part of the bill is unknown — "$1.50" alone would claim that is
  // the whole of it. Plan calls add no suffix: nothing is missing, it is paid for.
  const partial = total.unknown > 0;
  return { label: fmtCost(total.cost) + (partial ? "+?" : ""), tone: partial ? "amber" : "calm" };
}

/**
 * The same money label the cost pill uses, marked as an estimate when it IS one.
 *
 * The pill has no room for the "estimated" badge the cost panel carries, but a
 * card line does — so metered dollars get a "~" while "plan" and "$?" do not: a
 * covered call is a fact and an unknown price is a gap, and neither is an
 * estimate of an amount owed.
 */
export function costEstimateLabel(total: HvLedgerTotal): string {
  const { label } = costPill(total);
  return total.metered > 0 ? `~${label}` : label;
}
