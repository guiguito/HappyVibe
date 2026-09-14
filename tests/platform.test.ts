import { describe, expect, it } from "vitest";
import { makePlatform, type PlatformDeps } from "../src/main/platform";

/**
 * PRD §4 (Windows round): the ONE module that answers a platform question.
 *
 * Everything here is built from INJECTED deps, so a Windows platform can be
 * constructed on macOS and its behaviour pinned before a Windows box ever runs it —
 * which is the whole reason the seam exists rather than fifteen `process.platform`
 * branches that are each only testable on the platform they break.
 */
function deps(over: Partial<PlatformDeps>): PlatformDeps {
  return {
    platform: "darwin",
    execPath: "/Applications/HappyVibe.app/Contents/MacOS/HappyVibe",
    env: {},
    existsSync: () => false,
    exec: () => ({ status: 0, stdout: "" }),
    ...over,
  };
}

const HELPER =
  "/Applications/HappyVibe.app/Contents/Frameworks/HappyVibe Helper (Plugin).app/Contents/MacOS/HappyVibe Helper (Plugin)";

describe("nodeExecPath", () => {
  it("routes through the Helper (Plugin) on darwin when it exists", () => {
    expect(makePlatform(deps({ existsSync: (f) => f === HELPER })).nodeExecPath()).toBe(HELPER);
  });

  it("falls back to the binary itself when the helper is missing (dev, unbundled)", () => {
    expect(makePlatform(deps({})).nodeExecPath()).toBe(
      "/Applications/HappyVibe.app/Contents/MacOS/HappyVibe",
    );
  });

  it("is process.execPath everywhere else — no Dock-icon problem to solve", () => {
    const p = makePlatform(deps({ platform: "win32", execPath: "C:\\Program Files\\HappyVibe\\HappyVibe.exe" }));
    expect(p.nodeExecPath()).toBe("C:\\Program Files\\HappyVibe\\HappyVibe.exe");
  });
});

describe("childLauncher", () => {
  it("is the .mjs on win32 and the .sh elsewhere", () => {
    // win32 rides pi-subagents' own isNodeScriptPath branch in getPiSpawnCommand;
    // pinned against upstream's source in pi-subagents-contract.test.ts.
    expect(makePlatform(deps({ platform: "win32" })).childLauncher()).toBe("bin/pi-child.mjs");
    expect(makePlatform(deps({ platform: "darwin" })).childLauncher()).toBe("bin/pi-node.sh");
    expect(makePlatform(deps({ platform: "linux" })).childLauncher()).toBe("bin/pi-node.sh");
  });
});

describe("killTree", () => {
  it("uses taskkill /T /F on win32, so descendants go down with the session", () => {
    const calls: Array<[string, string[]]> = [];
    const p = makePlatform(
      deps({
        platform: "win32",
        exec: (c, a) => {
          calls.push([c, a]);
          return { status: 0, stdout: "" };
        },
      }),
    );
    p.killTree(4242);
    expect(calls).toEqual([["taskkill", ["/PID", "4242", "/T", "/F"]]]);
  });

  it("uses the injected signal sender off win32", () => {
    const killed: Array<[number, string]> = [];
    const p = makePlatform(deps({ kill: (pid, sig) => killed.push([pid, sig]) }));
    p.killTree(77);
    expect(killed).toEqual([[77, "SIGTERM"]]);
  });

  // "Already gone" is the normal case here, not an error: hibernation, MCP
  // live-reload and closing a crashed session all reach PiClient.stop() for a child
  // that may have exited on its own. `child.kill()` — what stop() called before the
  // seam — swallows ESRCH internally, so a raising killTree turned a no-op into a
  // throw in MAIN. Caught live by tests/piclient.test.ts "emits exit on crash".
  it("swallows ESRCH, because a process that already exited is not a failure", () => {
    const gone = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    const p = makePlatform(
      deps({
        kill: () => {
          throw gone;
        },
      }),
    );
    expect(() => p.killTree(77)).not.toThrow();
  });

  it("but still raises anything else — EPERM is a real problem worth seeing", () => {
    const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    const p = makePlatform(
      deps({
        kill: () => {
          throw denied;
        },
      }),
    );
    expect(() => p.killTree(77)).toThrow(/EPERM/);
  });
});

describe("readCommand", () => {
  it("reads a win32 command line through CIM, because tasklist prints no arguments", () => {
    // sweepOrphans matches on "pi-coding-agent", which only ever appears in the
    // ARGUMENTS (the executable is HappyVibe.exe) — so a command source that drops
    // them verifies nothing and the sweep silently kills nothing.
    const p = makePlatform(
      deps({
        platform: "win32",
        exec: (c, a) => {
          expect(c).toBe("powershell.exe");
          expect(a.join(" ")).toContain("Win32_Process");
          expect(a.join(" ")).toContain("ProcessId=4242");
          return {
            status: 0,
            stdout:
              '"C:\\HV\\HappyVibe.exe" C:\\HV\\resources\\pi-runtime\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js --mode rpc\r\n',
          };
        },
      }),
    );
    expect(p.readCommand(4242)).toContain("pi-coding-agent");
  });

  it("uses ps on darwin", () => {
    const p = makePlatform(
      deps({
        exec: (c, a) => {
          expect([c, ...a]).toEqual(["ps", "-p", "9", "-o", "command="]);
          return { status: 0, stdout: "/Applications/HappyVibe.app … cli.js --mode rpc\n" };
        },
      }),
    );
    expect(p.readCommand(9)).toContain("cli.js");
  });

  it("answers null for a process that is gone, on both shapes", () => {
    expect(makePlatform(deps({ exec: () => ({ status: 1, stdout: "" }) })).readCommand(1)).toBeNull();
    // Windows answers 0 with EMPTY output for a dead pid, rather than failing.
    expect(
      makePlatform(deps({ platform: "win32", exec: () => ({ status: 0, stdout: "\r\n" }) })).readCommand(1),
    ).toBeNull();
  });
});

describe("terminalShell", () => {
  it("is $SHELL, then the platform's own default", () => {
    expect(makePlatform(deps({ env: { SHELL: "/opt/homebrew/bin/fish" } })).terminalShell()).toBe(
      "/opt/homebrew/bin/fish",
    );
    expect(makePlatform(deps({})).terminalShell()).toBe("/bin/zsh");
    expect(makePlatform(deps({ platform: "linux" })).terminalShell()).toBe("/bin/bash");
  });

  it("is pwsh → powershell → COMSPEC on win32", () => {
    const found = makePlatform(
      deps({
        platform: "win32",
        env: { PATH: "C:\\PS7;C:\\Windows\\System32\\WindowsPowerShell\\v1.0", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
        existsSync: (f) => f === "C:\\PS7\\pwsh.exe",
      }),
    );
    expect(found.terminalShell()).toBe("C:\\PS7\\pwsh.exe");

    const legacy = makePlatform(
      deps({
        platform: "win32",
        env: { PATH: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
        existsSync: (f) => f.endsWith("powershell.exe"),
      }),
    );
    expect(legacy.terminalShell()).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");

    const bare = makePlatform(
      deps({ platform: "win32", env: { PATH: "", COMSPEC: "C:\\Windows\\System32\\cmd.exe" } }),
    );
    expect(bare.terminalShell()).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("never returns an empty string, even with no PATH and no COMSPEC", () => {
    expect(makePlatform(deps({ platform: "win32", env: {} })).terminalShell()).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
  });
});

describe("agentShell", () => {
  it("is bash off win32, with nothing to probe", () => {
    expect(makePlatform(deps({})).agentShell()).toEqual({ shell: "bash", bashPath: null });
  });

  it("probes exactly where Pi does, in Pi's order", () => {
    // Pi's dist/utils/shell.js: %ProgramFiles%\Git\bin\bash.exe, then
    // %ProgramFiles(x86)%\…, then bash.exe on PATH. Following it exactly is what
    // stops us disagreeing with Pi about which shell the agent has.
    const pf = "C:\\Program Files";
    const pf86 = "C:\\Program Files (x86)";

    const primary = makePlatform(
      deps({
        platform: "win32",
        env: { ProgramFiles: pf, "ProgramFiles(x86)": pf86, PATH: "C:\\other" },
        existsSync: (f) => f === `${pf}\\Git\\bin\\bash.exe` || f === `${pf86}\\Git\\bin\\bash.exe`,
      }),
    );
    expect(primary.agentShell()).toEqual({ shell: "bash", bashPath: `${pf}\\Git\\bin\\bash.exe` });

    const x86Only = makePlatform(
      deps({
        platform: "win32",
        env: { ProgramFiles: pf, "ProgramFiles(x86)": pf86, PATH: "" },
        existsSync: (f) => f === `${pf86}\\Git\\bin\\bash.exe`,
      }),
    );
    expect(x86Only.agentShell()).toEqual({ shell: "bash", bashPath: `${pf86}\\Git\\bin\\bash.exe` });

    const onPathOnly = makePlatform(
      deps({
        platform: "win32",
        env: { PATH: "C:\\msys64\\usr\\bin" },
        existsSync: (f) => f === "C:\\msys64\\usr\\bin\\bash.exe",
      }),
    );
    expect(onPathOnly.agentShell()).toEqual({ shell: "bash", bashPath: "C:\\msys64\\usr\\bin\\bash.exe" });
  });

  it("falls back to powershell when no bash exists anywhere", () => {
    const none = makePlatform(
      deps({ platform: "win32", env: { ProgramFiles: "C:\\Program Files", PATH: "" } }),
    );
    expect(none.agentShell()).toEqual({ shell: "powershell", bashPath: null });
  });

  it("does NOT accept the WSL launcher as Git Bash", () => {
    // C:\Windows\System32\bash.exe is the WSL entry point. It runs in a different
    // filesystem namespace, where the workspace path the permission engine confines
    // to does not exist — so treating it as the agent's shell would put every tool
    // call outside the boundary main thinks it is enforcing. Measured on this
    // machine: `where bash` returns it first when Git is not on PATH.
    const wsl = makePlatform(
      deps({
        platform: "win32",
        env: { PATH: "C:\\Windows\\System32" },
        existsSync: (f) => f === "C:\\Windows\\System32\\bash.exe",
      }),
    );
    expect(wsl.agentShell()).toEqual({ shell: "powershell", bashPath: null });
  });
});

describe("workspaceKey", () => {
  it("folds separators and case on win32", () => {
    const w = makePlatform(deps({ platform: "win32" }));
    expect(w.workspaceKey("C:\\Users\\G\\Proj\\")).toBe(w.workspaceKey("c:/users/g/proj"));
  });

  it("does NOT fold case on a case-sensitive platform", () => {
    const m = makePlatform(deps({}));
    expect(m.workspaceKey("/Users/G/Proj")).not.toBe(m.workspaceKey("/users/g/proj"));
  });

  it("strips a trailing separator without eating the root", () => {
    const m = makePlatform(deps({}));
    expect(m.workspaceKey("/Users/G/Proj/")).toBe("/Users/G/Proj");
    expect(m.workspaceKey("/")).toBe("/");
  });
});

describe("detectedShells", () => {
  it("lists what exists on win32, for the settings hint", () => {
    const onDisk = new Set([
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Windows\\System32\\cmd.exe",
    ]);
    const p = makePlatform(
      deps({
        platform: "win32",
        env: {
          PATH: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
          ProgramFiles: "C:\\Program Files",
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        },
        existsSync: (f) => onDisk.has(f),
      }),
    );
    expect(p.detectedShells().map((s) => s.label)).toEqual(["PowerShell", "cmd", "Git Bash"]);
  });

  it("is empty off win32 — there is no picker to feed", () => {
    expect(makePlatform(deps({})).detectedShells()).toEqual([]);
  });
});
