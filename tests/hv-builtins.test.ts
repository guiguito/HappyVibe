import { describe, it, expect } from "vitest";
import { coreToolNames, excludedTools, normalizeCoreOff, offToolRefusal, parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("parseBuiltins", () => {
  it("defaults everything on when unset", () => {
    expect(parseBuiltins(undefined)).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });
  it("reads explicit offs", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: true }))).toEqual({ plan: false, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });
  it("carries the plan prompt append", () => {
    expect(parseBuiltins(JSON.stringify({ planAppend: "Prefer small diffs." })).planAppend).toBe("Prefer small diffs.");
  });
  it("defaults on for corrupt input rather than silently disabling a tool", () => {
    expect(parseBuiltins("{not json")).toEqual({ plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });
});

describe("parseBuiltins — Ask user is independent of Plan mode (2026-10-10)", () => {
  it("honours askUser:false with plan on — the plan prompt then asks in the reply", () => {
    expect(parseBuiltins(JSON.stringify({ plan: true, askUser: false }))).toEqual({ plan: true, askUser: false, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });

  it("honours askUser:false once plan is off", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: false }))).toEqual({ plan: false, askUser: false, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });

  it("defaults (plan on) keep askUser:false too", () => {
    expect(parseBuiltins(JSON.stringify({ askUser: false }))).toEqual({ plan: true, askUser: false, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: false, skills: true, coreOff: [] });
  });

  // §32: the web group. Same fail-open convention as its neighbours — a corrupt
  // value must never silently remove a tool the user believes is on.
  it("§32: web defaults on, reads an explicit off, and fails open", () => {
    expect(parseBuiltins(undefined).web).toBe(true);
    expect(parseBuiltins(JSON.stringify({ web: false })).web).toBe(false);
    expect(parseBuiltins(JSON.stringify({ web: true, document: true, memory: true, memoryAppend: "", schedules: true })).web).toBe(true);
    expect(parseBuiltins("not json").web).toBe(true);
    // one switch, one group: turning web off says nothing about the neighbours
    const off = parseBuiltins(JSON.stringify({ web: false }));
    expect(off.browser).toBe(true);
    expect(off.terminal).toBe(true);
  });
});

describe("§33 memory", () => {
/** §33 — memory: default on, off only on an explicit false, append is a string. Fail-open like
 *  every other toggle: a corrupt HV_BUILTINS must never silently disable a tool the user
 *  believes is on. */
it("memory defaults on and is off only on an explicit false", () => {
  expect(parseBuiltins(undefined).memory).toBe(true);
  expect(parseBuiltins("{}").memory).toBe(true);
  expect(parseBuiltins("garbage").memory).toBe(true);
  expect(parseBuiltins(JSON.stringify({ memory: false })).memory).toBe(false);
  expect(parseBuiltins(JSON.stringify({ memory: 0 })).memory).toBe(true); // only `false`, not falsy
});

it("memoryAppend rides HV_BUILTINS as a string, defaulting to empty", () => {
  expect(parseBuiltins(undefined).memoryAppend).toBe("");
  expect(parseBuiltins(JSON.stringify({ memoryAppend: "x" })).memoryAppend).toBe("x");
  expect(parseBuiltins(JSON.stringify({ memoryAppend: 5 })).memoryAppend).toBe("");
});
});

describe("parseBuiltins — §35 schedules", () => {
  it("defaults on, and reads an explicit off", () => {
    expect(parseBuiltins(undefined).schedules).toBe(true);
    expect(parseBuiltins(JSON.stringify({ schedules: false })).schedules).toBe(false);
  });
});

// §13 round 26: every tool the agent has can be switched off — families as one switch,
// Pi's core tools one by one. Same fail-open convention as every key above.
describe("parseBuiltins — §13 round 26 family and core switches", () => {
  it("defaults the families on, Workflows off (round 27) and coreOff empty", () => {
    const b = parseBuiltins(undefined);
    expect([b.mcp, b.subagents, b.workflows, b.skills, b.coreOff]).toEqual([true, true, false, true, []]);
  });
  it("reads explicit offs, and coreOff keeps only core tool names", () => {
    const b = parseBuiltins(JSON.stringify({ mcp: false, skills: false, coreOff: ["bash", "Agent", 3] }));
    expect([b.mcp, b.skills, b.coreOff]).toEqual([false, false, ["bash", "powershell"]]);
  });
  it("names powershell as the shell on Windows", () => {
    expect(coreToolNames("powershell")).toEqual(["read", "powershell", "edit", "write", "grep", "find", "ls"]);
    expect(coreToolNames("bash")).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
    expect(parseBuiltins(JSON.stringify({ coreOff: ["powershell"] })).coreOff).toEqual(["powershell", "bash"]);
  });
  it("excludes SubagentWorkflow only while sub-agents are on", () => {
    expect(excludedTools(parseBuiltins(JSON.stringify({ workflows: false, coreOff: ["ls"] })))).toEqual(["ls", "SubagentWorkflow"]);
    expect(excludedTools({ coreOff: ["bash"], subagents: true, workflows: true })).toEqual(["bash", "powershell"]);
    expect(excludedTools(parseBuiltins(JSON.stringify({ workflows: false, subagents: false })))).toEqual([]);
    // §13 round 27: Workflows ships off, so a default session excludes it.
    expect(excludedTools(parseBuiltins(undefined))).toEqual(["SubagentWorkflow"]);
  });
  it("refuses only a switched-off tool", () => {
    const b = parseBuiltins(JSON.stringify({ coreOff: ["bash"] }));
    expect(offToolRefusal("bash", b)).toMatch(/switched off 'bash'/);
    expect(offToolRefusal("read", b)).toBeNull();
  });
});

// Final review (round 26): the shell is ONE switch. The stored name is whichever shell the
// session had when the user clicked, but the shell can change under it (Git Bash installed
// later on Windows), and tintinweb children always get `bash`. So either name means both.
describe("§13 round 26 — the shell is one switch", () => {
  it("either shell name switches both off", () => {
    expect(normalizeCoreOff(["powershell"])).toEqual(["powershell", "bash"]);
    expect(normalizeCoreOff(["bash", "ls"])).toEqual(["bash", "ls", "powershell"]);
    expect(normalizeCoreOff(["ls"])).toEqual(["ls"]);
  });
  it("a child is refused bash when the user switched the shell off as powershell", () => {
    expect(offToolRefusal("bash", { coreOff: ["powershell"] })).toMatch(/switched off 'bash'/);
  });
  it("a malformed coreOff is empty, never a throw", () => {
    expect(normalizeCoreOff("bash" as never)).toEqual([]);
    expect(normalizeCoreOff(undefined)).toEqual([]);
    expect(normalizeCoreOff(["nope", 3] as never)).toEqual([]);
  });
});
