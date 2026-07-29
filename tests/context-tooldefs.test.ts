import { describe, it, expect } from "vitest";
import { buildToolDefs } from "../pi-runtime/extensions/hv-context";

const ALL = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "write", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
];

describe("buildToolDefs", () => {
  it("resolves Pi's string[] selectedTools to named defs sized from their schema", () => {
    const defs = buildToolDefs(["read", "write"], ALL);
    expect(defs.map((d) => d.name)).toEqual(["read", "write"]);
    expect(defs[0].chars).toBeGreaterThan(40);
    expect(defs[1].chars).toBeGreaterThan(defs[0].chars);
  });

  it("still handles a spec-object array (defensive: Pi could change shape)", () => {
    const defs = buildToolDefs(ALL, ALL);
    expect(defs.map((d) => d.name)).toEqual(["read", "write"]);
    expect(defs[0].chars).toBeGreaterThan(40);
  });

  it("names an unknown tool honestly instead of inventing a size", () => {
    const defs = buildToolDefs(["ghost"], ALL);
    expect(defs).toEqual([{ name: "ghost", chars: 0 }]);
  });

  it("returns [] for a non-array", () => {
    expect(buildToolDefs(undefined, ALL)).toEqual([]);
  });
});
