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
    expect(valueAfter(argsOf({}), "--exclude-tools")).toBe("powershell");
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

// GUI pass: on macOS/Linux Pi registers its Windows `powershell` tool, inactive, and getAllTools()
// lists it — so Agent tools showed a tool the agent can never call, even with every switch on
// (and the only tool left with every core switch off). A bash session excludes it outright.
describe("§13 round 26 — a bash session never lists powershell", () => {
  test("excluded with every switch on, and alongside a switched-off tool", () => {
    expect(valueAfter(argsOf({}), "--exclude-tools")).toBe("powershell");
    expect(valueAfter(argsOf({ coreOff: ["ls"] }), "--exclude-tools")).toBe("ls,powershell");
  });
  test("a Windows powershell session keeps it", () => {
    expect(argsOf({}, { agentShell: "powershell" })).not.toContain("--exclude-tools");
  });
});

// GUI pass: with no session open, Agent tools asks the UTILITY client (anyClient), which read the
// switches once at its spawn and was never restarted — so the page kept listing switched-off tools.
// A switch change restarts it, the same way a key change does.
describe("§13 round 26 — a switch change restarts the utility client", () => {
  test("hv:builtins-set awaits restartUtility after saving", async () => {
    const fs = await import("node:fs");
    const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
    const handler = ipc.slice(ipc.indexOf('ipcMain.handle("hv:builtins-set"'), ipc.indexOf('ipcMain.handle("hv:builtins-set"') + 900);
    expect(handler).toMatch(/setBuiltinTools\(t\);[\s\S]*await restartUtility\(\)/);
  });
});

describe("§13 round 27 — HV_IMAGE_MODEL", () => {
  test("set only when main names a model; absent means the tool is not registered", () => {
    expect(spawnWith({}, { imageModel: "google/gemini-3.1-flash-lite-image" }).env.HV_IMAGE_MODEL).toBe("google/gemini-3.1-flash-lite-image");
    expect(spawnWith({}).env.HV_IMAGE_MODEL).toBeUndefined();
  });
});
