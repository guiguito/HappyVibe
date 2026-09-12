import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReadonlyPrompt, gateReadonlyCall, READONLY_BLOCKED, READONLY_PROMPT_MARKER, readonlyFromEnv } from "../pi-runtime/extensions/hv-readonly";
import { BLOCKED_PLAN_TOOLS } from "../pi-runtime/extensions/hv-plan";

describe("gateReadonlyCall", () => {
  it("blocks everything Plan mode blocks", () => {
    for (const t of BLOCKED_PLAN_TOOLS) expect(gateReadonlyCall(t, {}).kind, t).toBe("block");
  });

  it("ALSO blocks the plan tools and the schedule writers — a read-only run plans nothing and schedules nothing", () => {
    for (const t of ["plan_start", "plan_complete", "plan_status_update", "schedule_create", "schedule_update", "schedule_delete"]) {
      expect(READONLY_BLOCKED.has(t), t).toBe(true);
      expect(gateReadonlyCall(t, {}).kind, t).toBe("block");
    }
  });

  it("passes reads, schedule_list and an allowlisted bash", () => {
    for (const t of ["read", "grep", "ls", "find", "schedule_list", "memory_recall", "web_search"]) {
      expect(gateReadonlyCall(t, {}).kind, t).toBe("pass");
    }
    expect(gateReadonlyCall("bash", { command: "git status" }).kind).toBe("pass");
    expect(gateReadonlyCall("bash", { command: "rm -rf x" }).kind).toBe("block");
  });

  it("floor-asks the unknown (MCP) and needs-boundary for subagent — the plan gate's verdicts, unchanged", () => {
    expect(gateReadonlyCall("mcp", {}).kind).toBe("floor-ask");
    expect(gateReadonlyCall("subagent", {}).kind).toBe("needs-boundary");
  });

  it("every block reason names the RUN, never a mode the user did not pick", () => {
    for (const t of [...BLOCKED_PLAN_TOOLS, ...READONLY_BLOCKED]) {
      const g = gateReadonlyCall(t, {});
      expect(g.kind === "block" && g.reason, t).toMatch(/read-only run/i);
      expect(g.kind === "block" && g.reason, t).not.toMatch(/plan mode/i);
    }
    const bash = gateReadonlyCall("bash", { command: "rm -rf x" });
    expect(bash.kind === "block" && bash.reason).not.toMatch(/plan mode/i);
  });
});

describe("readonlyFromEnv / buildReadonlyPrompt", () => {
  it("is on only for the literal \"1\"", () => {
    expect(readonlyFromEnv({ HV_READONLY: "1" })).toBe(true);
    expect(readonlyFromEnv({ HV_READONLY: "true" })).toBe(false);
    expect(readonlyFromEnv({ HV_READONLY: "" })).toBe(false);
    expect(readonlyFromEnv({})).toBe(false);
  });

  it("names only the blocked tools the model actually has, and never a plan tool", () => {
    const p = buildReadonlyPrompt(["read", "edit", "bash", "plan_complete"]);
    expect(p.startsWith(`<happyvibe_readonly_run>\n${READONLY_PROMPT_MARKER}`)).toBe(true);
    expect(p).toContain("edit");
    expect(p).not.toContain("terminal_run");   // not registered this session
    expect(p).not.toContain("plan_complete");  // never advertised as a thing to avoid
    expect(p).toMatch(/report/i);
  });

  it("says something sensible when the session registered nothing blockable", () => {
    expect(buildReadonlyPrompt(["read"])).toContain("file edits and shell writes");
  });
});

describe("bridge wiring (source scan)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");

  it("the readonly clamp runs before the bypass check", () => {
    const clamp = src.indexOf("gateReadonlyCall(");
    expect(clamp).toBeGreaterThan(0);
    expect(clamp).toBeLessThan(src.indexOf("if (dangerous && !plan.enabled"));
  });

  it("the clamp is NOT gated by builtins.plan — this mode outlives that toggle", () => {
    const clamp = src.indexOf("if (readonly) {");
    expect(clamp).toBeGreaterThan(0);
    // Nothing between the clamp and the enclosing handler may re-open a builtins.plan block.
    const before = src.slice(src.indexOf("const handleToolCall"), clamp);
    expect(before).not.toMatch(/if \(builtins\.plan[^)]*\) \{[^}]*$/);
    expect(src).toMatch(/const readonly = readonlyFromEnv\(process\.env\)/);
  });

  it("bypass yields to the clamp", () => {
    expect(src).toMatch(/if \(dangerous && !plan\.enabled && !readonly\)/);
  });

  it("the prompt block is appended and the pill notify fires at session_start", () => {
    expect(src).toMatch(/readonly \? "\\n\\n" \+ buildReadonlyPrompt\(/);
    expect(src).toContain('kind: "hv.readonly"');
  });

  it("a blocked call is audited as its own source, so the log never reads as plan mode", () => {
    expect(src).toMatch(/source: "readonly"/);
  });
});
