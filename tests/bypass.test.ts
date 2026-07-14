import { describe, expect, test } from "vitest";
import { resolveBypass } from "../src/main/bypass";

/** Round 3 #14 — persistent bypass precedence: workspace ?? global ?? off. */
describe("resolveBypass precedence (#14)", () => {
  test("unset workspace inherits global", () => {
    expect(resolveBypass(false, null)).toBe(false);
    expect(resolveBypass(true, null)).toBe(true);
    expect(resolveBypass(false, undefined)).toBe(false);
    expect(resolveBypass(true, undefined)).toBe(true);
  });

  test("workspace overrides global in both directions", () => {
    expect(resolveBypass(false, true)).toBe(true); // ws turns it ON despite global off
    expect(resolveBypass(true, false)).toBe(false); // ws turns it OFF despite global on
  });
});
