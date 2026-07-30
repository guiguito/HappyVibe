import { describe, expect, test } from "vitest";
import { costPill, fmtCost, fmtDuration, fmtNum } from "../src/renderer/src/analytics-format";

describe("fmtNum", () => {
  test("small numbers pass through rounded", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(999)).toBe("999");
    expect(fmtNum(999.4)).toBe("999");
  });
  test("thousands / millions / billions compact", () => {
    expect(fmtNum(1234)).toBe("1.2k");
    expect(fmtNum(1000)).toBe("1k");
    expect(fmtNum(2_500_000)).toBe("2.5M");
    expect(fmtNum(3_000_000_000)).toBe("3B");
  });
  test("non-finite → 0", () => {
    expect(fmtNum(NaN)).toBe("0");
  });
});

describe("fmtCost", () => {
  test("zero and sub-cent", () => {
    expect(fmtCost(0)).toBe("$0.00");
    expect(fmtCost(0.0012)).toBe("$0.0012");
  });
  test("normal cents", () => {
    expect(fmtCost(1.5)).toBe("$1.50");
    expect(fmtCost(12.345)).toBe("$12.35");
  });
});

describe("fmtDuration", () => {
  test("null / negative / non-finite → em dash", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(-5)).toBe("—");
    expect(fmtDuration(NaN)).toBe("—");
  });
  test("seconds, minutes, hours", () => {
    expect(fmtDuration(45_000)).toBe("45s");
    expect(fmtDuration(12 * 60_000)).toBe("12m");
    expect(fmtDuration(80 * 60_000)).toBe("1h 20m");
  });
});

/**
 * The cost pill's branch table. Extracted from CostBubble so it can be asserted
 * directly — this repo tests renderer logic as pure functions (computeGauge,
 * delegationHint) rather than mounting components.
 *
 * The case that forced a three-state model: a ChatGPT/Copilot subscription is
 * priced by Pi at full API rates, so a boolean "priced" flag rendered dollars
 * the user does not owe. "plan" must never show money, and must never be amber
 * (it is a fact, not a gap).
 */
describe("costPill", () => {
  const t = (over: Partial<HvLedgerTotal> = {}): HvLedgerTotal => ({
    calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
    metered: 0, plan: 0, unknown: 0, ...over,
  });

  test("nothing measured is a dash, never $0.00", () => {
    expect(costPill(t())).toEqual({ label: "—", tone: "quiet" });
  });

  test("a fully metered session shows the money, calm", () => {
    expect(costPill(t({ calls: 3, metered: 3, cost: 0.29 }))).toEqual({ label: "$0.29", tone: "calm" });
  });

  test("a fully plan-billed session shows 'plan' and NO dollars, calm not amber", () => {
    expect(costPill(t({ calls: 5, plan: 5, cost: 4.22 }))).toEqual({ label: "plan", tone: "calm" });
  });

  test("all-unknown is $? and amber", () => {
    expect(costPill(t({ calls: 2, unknown: 2 }))).toEqual({ label: "$?", tone: "amber" });
  });

  test("partly unknown keeps the known total AND marks it incomplete", () => {
    // The "+?" is load-bearing: "$1.50" alone claims that is the whole bill.
    expect(costPill(t({ calls: 4, metered: 3, unknown: 1, cost: 1.5 }))).toEqual({ label: "$1.50+?", tone: "amber" });
  });

  test("metered + plan is calm — plan is not a missing number", () => {
    expect(costPill(t({ calls: 4, metered: 2, plan: 2, cost: 1.5 }))).toEqual({ label: "$1.50", tone: "calm" });
  });

  test("plan + unknown flags only the unknown", () => {
    expect(costPill(t({ calls: 4, plan: 2, unknown: 2 }))).toEqual({ label: "$?", tone: "amber" });
  });

  test("metered + plan needs no suffix — nothing is missing", () => {
    expect(costPill(t({ calls: 4, metered: 2, plan: 2, cost: 1.5 }))).toEqual({ label: "$1.50", tone: "calm" });
  });
});
