import { describe, expect, it } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { makePlatform, type PlatformDeps } from "../src/main/platform";
import { SHELL_TOOLS, isShellTool } from "../pi-runtime/extensions/hv-rules";
import { WRITE_CAPABLE_TOOLS } from "../pi-runtime/extensions/hv-subagent-boundary";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { shellSteerLine } from "../pi-runtime/extensions/hv-terminal";
import { toolLabel } from "../src/renderer/src/toolLabel";
import { OUTPUT_TOOLS } from "../src/renderer/src/components/ToolCard";

/**
 * PRD §4 (Windows round): the agent's shell is whichever one Pi would pick — Git Bash
 * if present, else Pi's own `powershell` tool. Key-free.
 *
 * The hazard this guards is not "PowerShell does not work". It is that `bash` is
 * spelled as a LITERAL in eight places that each mean "the arbitrary-shell tool", so
 * a PowerShell session would slip every one of them: no permission summary, no
 * §12 write-capable classification, no plan-mode allowlist — each failing OPEN.
 */
function fakePlatform(over: Partial<PlatformDeps>) {
  return makePlatform({
    platform: "darwin",
    execPath: "/x",
    env: {},
    existsSync: () => false,
    exec: () => ({ status: 0, stdout: "" }),
    ...over,
  });
}

const model = { provider: "openrouter", modelId: "x" };

describe("spawn hands Pi the shell the machine actually has", () => {
  it("passes no --tools when the shell is bash — Pi's own default set stands", () => {
    const s = resolvePiSpawn("/ws", "/sessions", "/rt", { model, agentShell: "bash" });
    expect(s.args).not.toContain("--tools");
    expect(s.env.HV_AGENT_SHELL).toBe("bash");
  });

  it("names Pi's powershell tool instead of bash on the fallback path", () => {
    const s = resolvePiSpawn("/ws", "/sessions", "/rt", { model, agentShell: "powershell" });
    const i = s.args.indexOf("--tools");
    expect(i).toBeGreaterThan(0);
    // Pi's builtins are exactly read/bash/edit/write/grep/find/ls (+powershell);
    // this is that set with the shell swapped, never a narrowed one.
    expect(s.args[i + 1]).toBe("read,powershell,edit,write,grep,find,ls");
    expect(s.args[i + 1]).not.toContain("bash");
    expect(s.env.HV_AGENT_SHELL).toBe("powershell");
  });

  it("defaults to bash when nothing says otherwise, so no caller can lose the shell", () => {
    const s = resolvePiSpawn("/ws", "/sessions", "/rt", { model });
    expect(s.env.HV_AGENT_SHELL).toBe("bash");
    expect(s.args).not.toContain("--tools");
  });
});

describe("the platform picks it, re-probed every spawn", () => {
  it("Git Bash present ⇒ bash", () => {
    const p = fakePlatform({
      platform: "win32",
      env: { ProgramFiles: "C:\\Program Files" },
      existsSync: (f) => f === "C:\\Program Files\\Git\\bin\\bash.exe",
    });
    expect(p.agentShell().shell).toBe("bash");
  });

  it("Git Bash absent ⇒ powershell", () => {
    expect(fakePlatform({ platform: "win32", env: {} }).agentShell().shell).toBe("powershell");
  });
});

describe("every set that means `the shell` names both", () => {
  it("SHELL_TOOLS is exactly bash + powershell", () => {
    expect([...SHELL_TOOLS].sort()).toEqual(["bash", "powershell"]);
    expect(isShellTool("bash")).toBe(true);
    expect(isShellTool("powershell")).toBe(true);
  });

  it("but NOT the terminal tools, which are a different thing with their own rules", () => {
    expect(isShellTool("terminal_run")).toBe(false);
    expect(isShellTool("read")).toBe(false);
  });

  it("§12: powershell is write-capable, so the boundary classifies it like bash", () => {
    // Miss this and a delegation's capability ceiling reads a PowerShell child as
    // read-only while it can write anything.
    expect(WRITE_CAPABLE_TOOLS.has("powershell")).toBe(true);
    expect(WRITE_CAPABLE_TOOLS.has("bash")).toBe(true);
  });

  it("§23: plan mode runs powershell through the SAME allowlist, not the floor-ask default", () => {
    // Falling through to floor-ask would turn plan mode's block into a permission
    // PROMPT for arbitrary shell — the one thing plan mode exists to prevent.
    const mutate = gatePlanCall("powershell", { command: "Remove-Item -Recurse ." });
    expect(mutate.kind).toBe("block");
    const bash = gatePlanCall("bash", { command: "rm -rf ." });
    expect(bash.kind).toBe("block");
  });

  it("§7: a powershell result is an output tool, so its card shows what came back", () => {
    expect(OUTPUT_TOOLS.has("powershell")).toBe(true);
  });
});

describe("what the user reads", () => {
  it("a powershell call gets a plain headline carrying the raw command", () => {
    // No PowerShell grammar in V1: the command IS the headline, which is honest and
    // cannot mis-describe what is about to run.
    const l = toolLabel("powershell", { command: "Get-ChildItem -Recurse | Measure-Object" });
    expect(l.icon).toBe("terminal");
    expect(l.label).toContain("Get-ChildItem -Recurse");
  });

  it("and still says something sensible with no command at all", () => {
    expect(toolLabel("powershell", {}).label.length).toBeGreaterThan(3);
  });

  it("the terminal steer line names the shell the session actually has", () => {
    expect(shellSteerLine("bash")).toContain("`bash`");
    expect(shellSteerLine("powershell")).toContain("`powershell`");
    // Never mention a tool this session does not have (§26's rule).
    expect(shellSteerLine("powershell")).not.toContain("bash");
    // Both keep the point of the line: long-running work goes to terminal_run.
    for (const shell of ["bash", "powershell"]) {
      expect(shellSteerLine(shell)).toContain("terminal_run");
    }
  });
});
