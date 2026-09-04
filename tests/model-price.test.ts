import { expect, test } from "vitest";
import { formatModelPrice, modelPriceTitle } from "../src/renderer/src/modelPrice";

/**
 * PRD §16 round 21 — a model row's price, under §19's three-state billing rule.
 *
 * The three states are not a nicety: a naive render of Pi's registry is wrong
 * in BOTH directions, and both were live defects in the cost ledger first.
 */

test("a metered model reads as in / out per million tokens", () => {
  expect(formatModelPrice({ billing: "metered", priceIn: 3, priceOut: 15 })).toBe("$3 / $15 per Mtok");
});

test("fractional rates keep their decimals, whole ones keep none", () => {
  expect(formatModelPrice({ billing: "metered", priceIn: 0.08, priceOut: 0.17 })).toBe("$0.08 / $0.17 per Mtok");
  expect(formatModelPrice({ billing: "metered", priceIn: 1, priceOut: 2.5 })).toBe("$1 / $2.50 per Mtok");
  // Thousandths are real; rounding a rate is the one thing this must not do.
  expect(formatModelPrice({ billing: "metered", priceIn: 0.075, priceOut: 0.3 })).toBe("$0.075 / $0.30 per Mtok");
});

test("a subscription provider never shows dollars", () => {
  // PRD §19 ruling 3: Pi prices openai-codex at full API rates on a flat plan.
  const s = formatModelPrice({ billing: "plan", priceIn: 1.25, priceOut: 10 });
  expect(s).toBe("on your plan");
  expect(s).not.toMatch(/\$/);
});

test("an unpriced model says unknown, never $0", () => {
  // An unpriced model defaults to ALL-ZERO rates, so zero means "no price
  // exists" — rendering it as free is the §19 defect this exists to prevent.
  const s = formatModelPrice({ billing: "unknown", priceIn: 0, priceOut: 0 });
  expect(s).toBe("price unknown");
  expect(s).not.toMatch(/\$0/);
});

test("missing rates are unknown, not zero", () => {
  expect(formatModelPrice({})).toBe("price unknown");
  expect(formatModelPrice({ billing: "metered" })).toBe("price unknown");
  // HALF a price is worse than none — §19 ruling 4's "quietly half right".
  expect(formatModelPrice({ billing: "metered", priceIn: 3 })).toBe("price unknown");
});

test("a tiered model shows its base rate and names the threshold on hover", () => {
  const m = { billing: "metered" as const, priceIn: 1.25, priceOut: 10, priceTierAbove: 200_000 };
  expect(formatModelPrice(m)).toBe("$1.25 / $10 per Mtok");
  expect(modelPriceTitle(m)).toMatch(/above 200,000/);
});

test("an untiered model has no price tooltip to add", () => {
  expect(modelPriceTitle({ billing: "metered", priceIn: 3, priceOut: 15 })).toBeUndefined();
  expect(modelPriceTitle({ billing: "plan", priceIn: 1, priceOut: 2, priceTierAbove: 100 })).toBeUndefined();
  expect(modelPriceTitle({ billing: "unknown", priceTierAbove: 100 })).toBeUndefined();
});
