import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/main/web/codec";

/**
 * Web mode: Electron's IPC carries structured clones, the socket carries text.
 * Whatever a handler returns or a renderer sends must come out the other side
 * as the same kind of value, or a feature works in a window and breaks in a tab.
 */
const roundTrip = (v: unknown): unknown => (decode(encode({ v } as Record<string, unknown>)) as { v: unknown }).v;

describe("web codec", () => {
  it("keeps plain JSON as it is", () => {
    const v = { a: 1, b: "x", c: [true, null, { d: 2.5 }], e: "" };
    expect(roundTrip(v)).toEqual(v);
  });

  it("brings bytes back as bytes — a Node Buffer arrives as a Uint8Array", () => {
    const out = roundTrip({ img: Buffer.from([0, 1, 254, 255]), f: new Float32Array([1.5, -2]) }) as {
      img: Uint8Array;
      f: Float32Array;
    };
    expect(out.img).toBeInstanceOf(Uint8Array);
    expect([...out.img]).toEqual([0, 1, 254, 255]);
    expect(out.f).toBeInstanceOf(Float32Array);
    expect([...out.f]).toEqual([1.5, -2]);
  });

  it("carries a large buffer (chunked base64, no stack overflow)", () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const out = roundTrip(big) as Uint8Array;
    expect(out.length).toBe(big.length);
    expect(out[1_000_003]).toBe(big[1_000_003]);
  });

  it("brings dates, maps, sets and ArrayBuffers back as themselves", () => {
    const d = new Date("2026-10-26T12:00:00Z");
    const out = roundTrip({ d, m: new Map([["k", 1]]), s: new Set([1, 2]), ab: new Uint8Array([7]).buffer }) as Record<
      string,
      unknown
    >;
    expect(out.d).toEqual(d);
    expect(out.m).toEqual(new Map([["k", 1]]));
    expect(out.s).toEqual(new Set([1, 2]));
    expect(new Uint8Array(out.ab as ArrayBuffer)).toEqual(new Uint8Array([7]));
  });

  it("keeps undefined in an array and as a whole value; drops it as a property", () => {
    expect(roundTrip(undefined)).toBeUndefined();
    expect(roundTrip([1, undefined, 3])).toEqual([1, undefined, 3]);
    expect(Object.keys(roundTrip({ a: 1, b: undefined }) as object)).toEqual(["a"]);
  });

  it("an object that carries the tag key is not mistaken for a tagged value", () => {
    const v = { $hv: "bytes", t: "Uint8Array", b: "AAAA" };
    expect(roundTrip(v)).toEqual(v);
  });

  it("NaN and the infinities come back as themselves, not as null", () => {
    expect(roundTrip([Number.NaN, Infinity, -Infinity, 0])).toEqual([Number.NaN, Infinity, -Infinity, 0]);
  });

  it("a `__proto__` key is an own property on arrival, never the object's prototype", () => {
    const out = decode('{"$hv":"obj","v":{"__proto__":{"polluted":true},"$hv":"x"}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    const plain = decode('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect((plain as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("an Error crosses as its message, as structured clone keeps it", () => {
    expect(roundTrip(new Error("boom"))).toEqual({ message: "boom", name: "Error" });
  });
});
