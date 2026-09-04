import { describe, it, expect } from "vitest";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("parseBuiltins", () => {
  it("defaults everything on when unset", () => {
    expect(parseBuiltins(undefined)).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });
  it("reads explicit offs", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: true }))).toEqual({ plan: false, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });
  it("carries the plan prompt append", () => {
    expect(parseBuiltins(JSON.stringify({ planAppend: "Prefer small diffs." })).planAppend).toBe("Prefer small diffs.");
  });
  it("defaults on for corrupt input rather than silently disabling a tool", () => {
    expect(parseBuiltins("{not json")).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });
});

describe("parseBuiltins — plan requires ask_user (Important 3 defence in depth)", () => {
  it("forces askUser on when plan is on, even if the config says otherwise", () => {
    expect(parseBuiltins(JSON.stringify({ plan: true, askUser: false }))).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });

  it("honours askUser:false once plan is off", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: false }))).toEqual({ plan: false, askUser: false, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });

  it("defaults (plan on) also force askUser on", () => {
    expect(parseBuiltins(JSON.stringify({ askUser: false }))).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true });
  });

  // §32: the web group. Same fail-open convention as its neighbours — a corrupt
  // value must never silently remove a tool the user believes is on.
  it("§32: web defaults on, reads an explicit off, and fails open", () => {
    expect(parseBuiltins(undefined).web).toBe(true);
    expect(parseBuiltins(JSON.stringify({ web: false })).web).toBe(false);
    expect(parseBuiltins(JSON.stringify({ web: true })).web).toBe(true);
    expect(parseBuiltins("not json").web).toBe(true);
    // one switch, one group: turning web off says nothing about the neighbours
    const off = parseBuiltins(JSON.stringify({ web: false }));
    expect(off.browser).toBe(true);
    expect(off.terminal).toBe(true);
  });
});
