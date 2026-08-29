/**
 * §12 (2026-08-29, the fleet round): a delegation child's context occupancy,
 * as a percentage in the SAME zones as the session gauge.
 *
 * Reusing `zoneOf` rather than picking fresh thresholds is the whole point —
 * §9's gauge already taught the user what amber means, and a sub-agent's head
 * filling up should read in the colours they have learned. A second threshold
 * table here would drift the first time §9's are tuned, and the drift would be
 * invisible: both gauges would still look plausible, on different scales.
 *
 * Returns null whenever there is nothing to divide, which is how the card shows
 * NO gauge rather than a 0% standing in for "not measured yet". `contextLimit`
 * is absent from the child's status whenever its resolved model is not in Pi's
 * registry, so this is the common case, not an edge one (PRD §19 ruling 3).
 */
import { zoneOf, type GaugeZone } from "./context";
import { fmtNum } from "./analytics-format";

export interface ChildGauge {
  /** 0-100, clamped. Drives the ZONE; not what the pill prints. */
  percent: number;
  /**
   * What the pill prints. `<1%` when there IS a reading but it rounds to zero
   * — found in the GUI pass: a 1M-window model sits at ~2k for the first half
   * minute of a run, and a bare "0%" reads as a broken gauge rather than as an
   * almost-empty one. A genuine zero still prints "0%".
   */
  text: string;
  zone: GaugeZone;
  /** "12.8k/200k" — the tooltip's figures, never the pill's own label. */
  label: string;
}

export function childGauge(context?: { window: number; limit: number }): ChildGauge | null {
  if (!context || !Number.isFinite(context.limit) || context.limit <= 0) return null;
  if (!Number.isFinite(context.window)) return null;
  const percent = Math.max(0, Math.min(100, Math.round((context.window / context.limit) * 100)));
  const text = percent === 0 && context.window > 0 ? "<1%" : `${percent}%`;
  return { percent, text, zone: zoneOf(percent), label: `${fmtNum(context.window)}/${fmtNum(context.limit)}` };
}
