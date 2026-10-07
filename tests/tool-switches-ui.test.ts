import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { ALL_OFF_COPY, allToolsOff, FAMILY_SWITCHES, toggleCore } from "../src/renderer/src/toolSwitches";

/**
 * §13 round 26 — the UI half of "every tool can be switched off", pinned as DATA plus a source
 * scan (no DOM in this suite). The absence is the point: Prompts gets no master switch, because
 * prompt templates register no tool and cost no tokens.
 */
const src = (f: string) => fs.readFileSync(`src/renderer/src/components/${f}`, "utf8");
const everythingOff = {
  plan: false, askUser: false, terminal: false, browser: false, web: false, document: false, memory: false, schedules: false,
  mcp: false, subagents: false, workflows: false, skills: false,
  coreOff: ["read", "bash", "edit", "write", "grep", "find", "ls"],
};

describe("§13 round 26 — tool switches UI contract", () => {
  test("all off is detected against the session's own shell", () => {
    expect(allToolsOff(everythingOff, "bash")).toBe(true);
    // On Windows the shell is powershell, which is still on here.
    expect(allToolsOff(everythingOff, "powershell")).toBe(false);
    expect(allToolsOff({ ...everythingOff, skills: true }, "bash")).toBe(false);
    expect(allToolsOff({ ...everythingOff, coreOff: ["read"] }, "bash")).toBe(false);
  });

  test("MCP, Skills and Agents carry their family switch; Prompts does NOT", () => {
    expect(src("McpView.tsx")).toMatch(/<FamilySwitch family="mcp"/);
    expect(src("SkillsView.tsx")).toMatch(/<FamilySwitch family="skills"/);
    expect(src("AgentsView.tsx")).toMatch(/<FamilySwitch family="subagents"/);
    expect(src("PromptTemplatesView.tsx")).not.toMatch(/FamilySwitch/);
    expect(Object.keys(FAMILY_SWITCHES).sort()).toEqual(["mcp", "skills", "subagents"]);
  });

  test("Built-in tools renders the all-off line from the one constant", () => {
    expect(src("BuiltinToolsBlock.tsx")).toMatch(/ALL_OFF_COPY/);
    expect(ALL_OFF_COPY).toBe("The agent can only chat — it has no tools.");
  });

  test("the family rows on Built-in tools are the same switches as the pages", () => {
    // One source, two surfaces (Memory's precedent): the rows render FamilySwitchRow rather than
    // re-typing their own copy.
    expect(src("BuiltinToolsBlock.tsx")).toMatch(/<FamilySwitchRow family="mcp"/);
    expect(src("BuiltinToolsBlock.tsx")).toMatch(/<FamilySwitchRow family="subagents"/);
    expect(src("BuiltinToolsBlock.tsx")).toMatch(/<FamilySwitchRow family="skills"/);
  });
});

describe("§13 round 26 — the shell switch on the Core tools row", () => {
  test("turning the shell on clears both names, so it can't stay off under its other name", () => {
    expect(toggleCore(["powershell", "bash", "ls"], "bash")).toEqual(["ls"]);
    expect(toggleCore(["ls"], "bash")).toEqual(["ls", "bash"]);
    expect(toggleCore(["ls"], "ls")).toEqual([]);
  });
});
