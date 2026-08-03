import { describe, expect, it } from "vitest";
import { refuseReservedNames } from "../src/main/promptTemplatesImport";

/**
 * §24 import collision refusal. Pi matches an extension command BEFORE it looks
 * at prompt templates, so importing a file named after an `/hv-*` command would
 * write a file that can never run — refuse it and name the conflict.
 */
describe("refuseReservedNames", () => {
  it("passes an ordinary set of candidates", () => {
    expect(refuseReservedNames([{ name: "review" }, { name: "explain" }])).toBeNull();
    expect(refuseReservedNames([])).toBeNull();
  });

  it("names the candidate that collides with a bridge command", () => {
    expect(refuseReservedNames([{ name: "hv-plan" }])).toBe("hv-plan");
  });

  it("checks every candidate, not just the first", () => {
    expect(refuseReservedNames([{ name: "review" }, { name: "hv-tools" }])).toBe("hv-tools");
  });

  it("does not refuse a name that merely looks reserved", () => {
    expect(refuseReservedNames([{ name: "hv-plan-notes" }, { name: "plan" }])).toBeNull();
  });
});
