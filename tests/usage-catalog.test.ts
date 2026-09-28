import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CATEGORIES, NEVER_SENT_KEYS, SCREENS, USAGE_EVENTS } from "../src/main/usage/events";

const NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_.]{0,39}$/;

describe("§39 the event catalog (D20: its invariants, not a copy of the spec)", () => {
  const entries = Object.entries(USAGE_EVENTS);
  it("has the 23 locked events", () => expect(entries).toHaveLength(23));
  it("every name, key, category and value fits Inlet's rules", () => {
    for (const [name, spec] of entries) {
      expect(name, name).toMatch(NAME);
      expect(name, name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(CATEGORIES, name).toContain(spec.category);
      expect(spec.category.length).toBeLessThanOrEqual(32);
      const params = Object.entries(spec.params);
      expect(params.length, name).toBeLessThanOrEqual(25);
      for (const [k, p] of params) {
        expect(k, `${name}.${k}`).toMatch(KEY);
        expect(k, `${name}.${k}`).toMatch(/^[a-z][A-Za-z0-9]*$/);
        if (p.type === "enum") for (const v of p.values) expect(v.length, `${name}.${k}=${v}`).toBeLessThanOrEqual(256);
      }
    }
  });
  it("every event has a plain-words line for the Privacy page", () => {
    for (const [name, spec] of entries) expect(spec.plain.length, name).toBeGreaterThan(20);
  });
  it("no param key names content (the never-sent list)", () => {
    for (const [name, spec] of entries) for (const k of Object.keys(spec.params)) {
      expect(NEVER_SENT_KEYS as readonly string[], `${name}.${k}`).not.toContain(k);
    }
  });
  it("the imports-nothing rule holds (the renderer imports this file)", () => {
    const src = fs.readFileSync("src/main/usage/events.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
  it("SCREENS equals the renderer's View union", () => {
    const sidebar = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
    const union = sidebar.match(/export type View =([\s\S]*?);/)![1].replace(/\/\/.*$/gm, "");
    const views = [...new Set([...union.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]))].sort();
    expect([...SCREENS].sort()).toEqual(views);
  });
});
