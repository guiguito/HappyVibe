import { describe, expect, it } from "vitest";
import { insideAny } from "../src/main/tearOff";

const r = { x: 100, y: 100, width: 200, height: 100 };

describe("insideAny", () => {
  it("inside one rect", () => {
    expect(insideAny({ x: 150, y: 150 }, [r])).toBe(true);
  });

  it("edges: left/top inclusive, right/bottom exclusive", () => {
    expect(insideAny({ x: 100, y: 100 }, [r])).toBe(true);
    expect(insideAny({ x: 300, y: 150 }, [r])).toBe(false);
    expect(insideAny({ x: 150, y: 200 }, [r])).toBe(false);
  });

  it("outside every rect, and no rects at all", () => {
    expect(insideAny({ x: 50, y: 50 }, [r, { x: 400, y: 400, width: 10, height: 10 }])).toBe(false);
    expect(insideAny({ x: 0, y: 0 }, [])).toBe(false);
  });

  it("inside the SECOND rect still counts", () => {
    // A drop over another window is not a tear-off; it is that window's drop.
    expect(insideAny({ x: 405, y: 405 }, [r, { x: 400, y: 400, width: 10, height: 10 }])).toBe(true);
  });
});
