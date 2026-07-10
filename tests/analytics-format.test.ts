import { describe, expect, test } from "vitest";
import { fmtCost, fmtDuration, fmtNum } from "../src/renderer/src/analytics-format";

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
