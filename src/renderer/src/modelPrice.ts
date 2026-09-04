/**
 * PRD §16 round 21 — a model row's price, under §19's three-state billing rule.
 *
 * Pure so the no-DOM renderer suite can pin it. The three states are not a
 * nicety: a naive render of Pi's registry is wrong in BOTH directions. A
 * flat-subscription provider is priced at full API rates in Pi's table, so
 * showing its dollars invents spend; and an UNPRICED model defaults to all-zero
 * rates, so showing $0 claims a model is free when the truth is that no price
 * exists. Both were live defects in the cost ledger before §19 ruling 3.
 *
 * Rates are USD per MILLION tokens with no conversion applied: pi-ai computes
 * `usage.cost.input = (rates.input / 1_000_000) * usage.input`
 * (`pi-ai/dist/models.js:540`), so the registry figure IS the per-Mtok number.
 */

export interface ModelPriceLike {
  billing?: "metered" | "plan" | "unknown";
  /** USD per MILLION tokens. */
  priceIn?: number;
  priceOut?: number;
  /** Input-token threshold above which a higher pricing tier applies. */
  priceTierAbove?: number;
}

/**
 * `$3`, `$2.50`, `$0.08`, `$0.075` — a whole number keeps no decimals, and a
 * fractional rate gets at least two so `$2.50` does not read as `$2.5`. Up to
 * four, because some providers really do price in thousandths and rounding a
 * rate is the one thing this must not do.
 */
const usd = (n: number): string =>
  `$${Number.isInteger(n) ? n : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const priced = (m: ModelPriceLike): boolean =>
  typeof m.priceIn === "number" && typeof m.priceOut === "number" && (m.priceIn > 0 || m.priceOut > 0);

export function formatModelPrice(m: ModelPriceLike): string {
  // Plan wins over everything, exactly as in the ledger: a covered call's
  // dollars are wrong whether Pi computed them or zeroed them.
  if (m.billing === "plan") return "on your plan";
  if (!priced(m)) return "price unknown";
  return `${usd(m.priceIn as number)} / ${usd(m.priceOut as number)} per Mtok`;
}

/** The hover note, or undefined when the row's own text is the whole truth. */
export function modelPriceTitle(m: ModelPriceLike): string | undefined {
  if (m.billing === "plan" || !priced(m)) return undefined;
  if (!m.priceTierAbove) return undefined;
  return `Base rate — a higher tier applies above ${m.priceTierAbove.toLocaleString("en-US")} input tokens`;
}
