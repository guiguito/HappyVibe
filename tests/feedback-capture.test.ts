import { describe, expect, it } from "vitest";
import { fitWithin, MAX_PIXELS } from "../src/main/feedback/capture";

describe("fitWithin", () => {
  it("leaves a Retina laptop capture alone (inside 25 MP)", () => {
    expect(fitWithin(3456, 2234, MAX_PIXELS)).toEqual({ width: 3456, height: 2234 });
  });

  it("downsizes a 6K@2x capture to fit, keeping the aspect ratio", () => {
    const r = fitWithin(12288, 6912, MAX_PIXELS);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(Math.abs(r.width / r.height - 12288 / 6912)).toBeLessThan(0.01);
    expect(r.width).toBeGreaterThan(6000); // shrunk, not crushed
  });

  it("never returns zero for a degenerate input", () => {
    expect(fitWithin(1, 1, MAX_PIXELS)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(0, 0, MAX_PIXELS)).toEqual({ width: 1, height: 1 });
  });
});
