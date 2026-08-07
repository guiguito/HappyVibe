import { describe, it, expect } from "vitest";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("parseBuiltins", () => {
  it("defaults everything on when unset", () => {
    expect(parseBuiltins(undefined)).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true });
  });
  it("reads explicit offs", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: true }))).toEqual({ plan: false, askUser: true, planAppend: "", terminal: true });
  });
  it("carries the plan prompt append", () => {
    expect(parseBuiltins(JSON.stringify({ planAppend: "Prefer small diffs." })).planAppend).toBe("Prefer small diffs.");
  });
  it("defaults on for corrupt input rather than silently disabling a tool", () => {
    expect(parseBuiltins("{not json")).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true });
  });
});

describe("parseBuiltins — plan requires ask_user (Important 3 defence in depth)", () => {
  it("forces askUser on when plan is on, even if the config says otherwise", () => {
    expect(parseBuiltins(JSON.stringify({ plan: true, askUser: false }))).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true });
  });

  it("honours askUser:false once plan is off", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: false }))).toEqual({ plan: false, askUser: false, planAppend: "", terminal: true });
  });

  it("defaults (plan on) also force askUser on", () => {
    expect(parseBuiltins(JSON.stringify({ askUser: false }))).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true });
  });
});
