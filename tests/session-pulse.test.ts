import { describe, expect, it } from "vitest";
import { drawOffset, PULSE_TIMING, pulseDecision, type PulseState } from "../src/renderer/src/sessionPulse";

const T0 = 1_000_000;
const ok = (over: Partial<PulseState> = {}): PulseState => ({
  asked: false,
  openedAt: T0,
  offsetMs: 0,
  now: T0 + 11 * 60_000,
  turns: 3,
  busy: false,
  promptOpen: false,
  bannerShowing: false,
  focused: true,
  available: true,
  ...over,
});

describe("PULSE_TIMING", () => {
  it("normal is 10 min + U(0,20 min), ≥3 turns; fast is 20 s, no offset, 1 turn", () => {
    expect(PULSE_TIMING.normal).toEqual({ earliestMs: 600_000, offsetMaxMs: 1_200_000, minTurns: 3 });
    expect(PULSE_TIMING.fast).toEqual({ earliestMs: 20_000, offsetMaxMs: 0, minTurns: 1 });
  });
});

describe("drawOffset", () => {
  it("is seeded: same rand → same offset, spanning the whole window", () => {
    expect(drawOffset(PULSE_TIMING.normal, () => 0)).toBe(0);
    expect(drawOffset(PULSE_TIMING.normal, () => 0.5)).toBe(600_000);
    expect(drawOffset(PULSE_TIMING.normal, () => 0.999999)).toBeLessThan(1_200_000);
    expect(drawOffset(PULSE_TIMING.fast, () => 0.9)).toBe(0);
  });
});

describe("pulseDecision", () => {
  it("shows when every gate is open", () => {
    expect(pulseDecision(ok(), PULSE_TIMING.normal)).toBe(true);
  });

  it("each gate alone flips it off", () => {
    const flips: Partial<PulseState>[] = [
      { asked: true },
      { now: T0 + 9 * 60_000 },
      { offsetMs: 5 * 60_000, now: T0 + 12 * 60_000 },
      { turns: 2 },
      { busy: true },
      { promptOpen: true },
      { bannerShowing: true },
      { focused: false },
      { available: false },
    ];
    for (const f of flips) expect(pulseDecision(ok(f), PULSE_TIMING.normal), JSON.stringify(f)).toBe(false);
  });

  it("the fast arm shows at 20 s after one turn", () => {
    expect(pulseDecision(ok({ now: T0 + 20_000, turns: 1 }), PULSE_TIMING.fast)).toBe(true);
    expect(pulseDecision(ok({ now: T0 + 19_999, turns: 1 }), PULSE_TIMING.fast)).toBe(false);
  });

  it("asked wins over everything — never a second ask", () => {
    expect(pulseDecision(ok({ asked: true, now: T0 + 999 * 60_000, turns: 99 }), PULSE_TIMING.normal)).toBe(false);
  });
});
