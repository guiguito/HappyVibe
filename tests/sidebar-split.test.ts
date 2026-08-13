/**
 * §7 round 12 — the sidebar split is a PROPORTION.
 *
 * Round 11 persisted the tree's height in pixels, which is a different split at
 * a different window size. The migration is the interesting part: a stored
 * `380` must not be read as a fraction (it would clamp to the maximum and pin
 * the tree open forever), so anything > 1 degrades to auto.
 */
import { describe, expect, test } from "vitest";
import {
  AUTO,
  MAX_FRACTION,
  MIN_FRACTION,
  clampFraction,
  fractionFor,
  readSplit,
  writeSplit,
} from "../src/renderer/src/sidebarSplit";

describe("readSplit", () => {
  test("a fraction round-trips", () => {
    expect(readSplit("0.42")).toBeCloseTo(0.42);
    expect(readSplit(writeSplit(0.6))).toBeCloseTo(0.6);
  });

  test("a round-11 PIXEL value degrades to auto rather than pinning the tree", () => {
    // This is the whole migration: no version key, no rewrite pass.
    expect(readSplit("380")).toBe(AUTO);
    expect(readSplit("1024")).toBe(AUTO);
  });

  test("absent, zero and nonsense are auto", () => {
    expect(readSplit(null)).toBe(AUTO);
    expect(readSplit(undefined)).toBe(AUTO);
    expect(readSplit("")).toBe(AUTO);
    expect(readSplit("nonsense")).toBe(AUTO);
    expect(readSplit("0")).toBe(AUTO);
    expect(readSplit("-0.5")).toBe(AUTO);
  });

  test("out-of-range fractions clamp so neither half becomes unusable", () => {
    expect(readSplit("0.01")).toBe(MIN_FRACTION);
    expect(readSplit("1")).toBe(MAX_FRACTION);
  });
});

describe("fractionFor", () => {
  test("converts a dragged pixel height against the sidebar's own height", () => {
    expect(fractionFor(300, 600)).toBeCloseTo(0.5);
  });

  test("clamps at both ends", () => {
    expect(fractionFor(5, 600)).toBe(MIN_FRACTION);
    expect(fractionFor(595, 600)).toBe(MAX_FRACTION);
  });

  test("a zero-height sidebar (not laid out yet) is auto, never NaN", () => {
    expect(fractionFor(100, 0)).toBe(AUTO);
  });
});

describe("clampFraction", () => {
  test("is the single place the bounds live", () => {
    expect(clampFraction(0.5)).toBe(0.5);
    expect(clampFraction(0)).toBe(MIN_FRACTION);
    expect(clampFraction(9)).toBe(MAX_FRACTION);
  });
});
