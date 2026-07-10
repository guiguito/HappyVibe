/**
 * B7 renderer-side pure formatters for the dashboard. No React, no DOM — unit
 * tested in tests/analytics-format.test.ts. Money is always presented as an
 * ESTIMATE by the calling UI (the number itself is formatted here).
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
