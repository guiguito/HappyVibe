import { describe, it, expect } from "vitest";
import {
  floatToInt16,
  passesLengthGate,
  peakRms,
  passesEnergyGate,
  MIN_CLIP_MS,
} from "../src/renderer/src/voice/gates";

describe("float32 -> int16", () => {
  it("maps the full scale and CLAMPS beyond it — a hot mic must saturate, never wrap", () => {
    const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32768);
    expect(out[3]).toBe(32767);
    expect(out[4]).toBe(-32768);
    // 0.5 * 0x7fff is 16383.5, and Int16Array truncates toward zero. Asymmetric
    // scaling is the point: +1 must reach 32767 exactly without overflowing.
    expect(out[5]).toBe(16383);
  });

  it("returns an Int16Array of the same length", () => {
    const out = floatToInt16(new Float32Array(320));
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(320);
  });

  it("round-trips ordinary sample values within a quantisation step", () => {
    const src = new Float32Array([0.25, -0.25, 0.75, -0.75]);
    const back = Array.from(floatToInt16(src), (v) => v / 32768);
    for (let i = 0; i < src.length; i++) expect(Math.abs(back[i] - src[i])).toBeLessThan(1e-3);
  });
});

describe("length gate — an accidental tap must never reach the model", () => {
  it("rejects under 300 ms and accepts at or over it", () => {
    expect(MIN_CLIP_MS).toBe(300);
    expect(passesLengthGate(4_799, 16000)).toBe(false); // 299.9 ms
    expect(passesLengthGate(4_800, 16000)).toBe(true); // exactly 300 ms
    expect(passesLengthGate(16_000, 16000)).toBe(true);
    expect(passesLengthGate(0, 16000)).toBe(false);
  });

  it("does not divide by a zero sample rate", () => {
    expect(passesLengthGate(16_000, 0)).toBe(false);
  });
});

describe("energy gate — silence must not invoke the model at all", () => {
  it("rejects digital silence", () => {
    expect(passesEnergyGate(new Int16Array(16000))).toBe(false);
    expect(peakRms(new Int16Array(0))).toBe(0);
  });

  it("rejects room tone below the noise floor", () => {
    const quiet = new Int16Array(16000).fill(30); // ~0.0009 rms
    expect(passesEnergyGate(quiet)).toBe(false);
  });

  it("accepts ordinary speech level", () => {
    const speech = Int16Array.from({ length: 16000 }, (_, i) => Math.round(8000 * Math.sin(i / 8)));
    expect(passesEnergyGate(speech)).toBe(true);
    expect(peakRms(speech)).toBeGreaterThan(0.1);
  });

  it("brackets the floor: just under is rejected, just over is accepted", () => {
    // No int16 value lands exactly on 0.005 (0.005 * 32768 = 163.84), so the
    // boundary is asserted by bracketing it rather than by pretending to hit it.
    const under = new Int16Array(1000).fill(163); // 0.004974
    const over = new Int16Array(1000).fill(164); // 0.005005
    expect(passesEnergyGate(under)).toBe(false);
    expect(passesEnergyGate(over)).toBe(true);
  });

  it("honours a caller-supplied floor, which is what makes it tunable", () => {
    const clip = new Int16Array(1000).fill(1000); // ~0.0305
    expect(passesEnergyGate(clip, 0.05)).toBe(false);
    expect(passesEnergyGate(clip, 0.01)).toBe(true);
  });
});
