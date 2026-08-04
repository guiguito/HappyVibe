import { expect, test } from "vitest";
import { isNearBottom } from "../src/renderer/src/components/Transcript";

const el = (
  scrollTop: number,
  scrollHeight = 1000,
  clientHeight = 400,
): { scrollTop: number; scrollHeight: number; clientHeight: number } => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

test("at the very bottom → near bottom", () => {
  expect(isNearBottom(el(600))).toBe(true);
});

test("within the slack window → still near bottom (so streaming keeps following)", () => {
  expect(isNearBottom(el(520))).toBe(true); // 80px from the bottom, slack 120
});

test("scrolled up past the slack → NOT near bottom (the bug: this must not re-pin)", () => {
  expect(isNearBottom(el(200))).toBe(false);
});

test("content shorter than the viewport is always near bottom", () => {
  expect(isNearBottom(el(0, 300, 400))).toBe(true);
});

test("the slack boundary is inclusive", () => {
  expect(isNearBottom(el(480))).toBe(true); // exactly 120 away
  expect(isNearBottom(el(479))).toBe(false); // 121 away
});
