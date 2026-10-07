import { describe, expect, test } from "vitest";
import path from "node:path";
import { PI_MCP_EXTENSIONS, resolvePiSpawn, TW_RELPATH } from "../src/main/pi/spawn";

/**
 * §13 round 26 — what a spawn does with each tool switch. Every switch rides HV_BUILTINS, whose
 * keys are listed EXPLICITLY in spawn.ts; a key missing there never reaches the bridge, which is
 * exactly how the Schedules switch silently did nothing until this round.
 */
const builtins = (over: Record<string, unknown> = {}) => ({
  plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true,
  document: true, memory: true, memoryAppend: "", schedules: true,
  mcp: true, subagents: true, workflows: true, skills: true, coreOff: [] as string[],
  ...over,
});
const spawnWith = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  resolvePiSpawn("/w", "/s", "/rt", { builtinTools: builtins(over) as never, ...extra });

describe("HV_BUILTINS carries every switch", () => {
  test("schedules:false reaches the bridge", () => {
    expect(JSON.parse(spawnWith({ schedules: false }).env.HV_BUILTINS).schedules).toBe(false);
  });
});

const argsOf = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) => spawnWith(over, extra).args;
const valueAfter = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

describe("§13 round 26 — spawn obeys the switches", () => {
  test("subagents:false drops tintinweb; on keeps it", () => {
    expect(argsOf({ subagents: false })).not.toContain(path.join("/rt", TW_RELPATH));
    expect(argsOf({})).toContain(path.join("/rt", TW_RELPATH));
  });
  test("mcp:false wins over the caller's mcp:true, and HV_MCP is unset", () => {
    const s = spawnWith({ mcp: false }, { mcp: true });
    expect(s.args).not.toContain(PI_MCP_EXTENSIONS[1]);
    expect(s.env.HV_MCP).toBeUndefined();
    expect(spawnWith({}, { mcp: true }).args).toContain(PI_MCP_EXTENSIONS[1]);
  });
  test("skills:false passes no --skill even when handed skills, and discovery stays off", () => {
    const a = argsOf({ skills: false }, { skills: ["/a/skill"] });
    expect(a).not.toContain("--skill");
    expect(a).toContain("--no-skills");
  });
  test("one --exclude-tools list: core tools plus SubagentWorkflow", () => {
    expect(valueAfter(argsOf({ coreOff: ["bash", "write"], workflows: false }), "--exclude-tools")).toBe("bash,write,powershell,SubagentWorkflow");
    expect(argsOf({})).not.toContain("--exclude-tools");
  });
  test("Windows: powershell is excluded alongside the --tools allowlist", () => {
    const a = argsOf({ coreOff: ["powershell"] }, { agentShell: "powershell" });
    expect(valueAfter(a, "--exclude-tools")).toBe("powershell,bash");
    expect(a).toContain("--tools");
  });
  test("HV_BUILTINS lists every new key", () => {
    const b = JSON.parse(spawnWith({ mcp: false, subagents: false, workflows: false, skills: false, coreOff: ["ls"] }).env.HV_BUILTINS);
    expect(b).toMatchObject({ mcp: false, subagents: false, workflows: false, skills: false, coreOff: ["ls"] });
  });
});
