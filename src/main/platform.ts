/**
 * PRD §4 (Windows round, 2026-09-14): the ONE place that answers a platform question.
 *
 * Every call site that used to branch on `process.platform` reads this instead, so a
 * fake Windows platform can be injected on macOS CI and the behaviour pinned
 * (tests/platform.test.ts) before a Windows box ever runs it. The alternative —
 * fifteen scattered branches — is fifteen decisions each only testable on the
 * platform it breaks.
 *
 * Electron-free and vitest-importable, like spawn.ts. The default instance is built
 * from `process`; tests call `makePlatform()` with their own deps.
 */
import { spawnSync } from "node:child_process";
import { existsSync as fsExistsSync } from "node:fs";
import path from "node:path";

export interface PlatformDeps {
  platform: NodeJS.Platform;
  execPath: string;
  env: Record<string, string | undefined>;
  existsSync: (p: string) => boolean;
  /** Synchronous exec, injected so tests never spawn a real process. */
  exec: (cmd: string, args: string[]) => { status: number | null; stdout: string };
  /** Signal sender, injected for the same reason. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

export type AgentShell = "bash" | "powershell";

export interface Platform {
  readonly name: NodeJS.Platform;
  readonly isWindows: boolean;
  /** Node-capable exec path for Electron-as-node children. */
  nodeExecPath(): string;
  /** PI_SUBAGENT_PI_BINARY, relative to `pi-runtime/`. */
  childLauncher(): string;
  /** Take a process AND its descendants down. */
  killTree(pid: number): void;
  /** A pid's full command line, or null when it is gone. */
  readCommand(pid: number): string | null;
  /** The default interactive shell for §26 terminals. */
  terminalShell(): string;
  /** The arguments that default shell wants. */
  terminalShellArgs(): string[];
  /** Which shell tool the agent gets, probed where Pi probes. */
  agentShell(): { shell: AgentShell; bashPath: string | null };
  /** Canonical comparison key for a workspace path. */
  workspaceKey(p: string): string;
  /** Shells present on this machine, for the terminal settings hint. */
  detectedShells(): Array<{ label: string; path: string }>;
}

/**
 * `C:\Windows\System32\bash.exe` (and its Sysnative twin) is the WSL launcher, not a
 * Windows bash. It runs in a different filesystem namespace: the workspace the
 * permission engine confines to is `C:\ws` there only as `/mnt/c/ws`, so every path a
 * tool call reports would sit outside the boundary main believes it is enforcing.
 * Pi knows the path too (`isLegacyWslBashPath`, which switches to stdin transport),
 * but knowing how to TALK to it is not the same as it being the right shell for us.
 *
 * Measured on the dogfood machine: with Git not on PATH, `where bash` returns this
 * first — so an unguarded probe finds it on a stock Windows install.
 */
function isWslBashPath(p: string): boolean {
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(p.replace(/\//g, "\\"));
}

function joinWin(dir: string, exe: string): string {
  return `${dir.replace(/[\\/]+$/, "")}\\${exe}`;
}

function onPath(deps: PlatformDeps, exe: string): string | null {
  const sep = deps.platform === "win32" ? ";" : ":";
  for (const dir of (deps.env.PATH ?? "").split(sep).filter(Boolean)) {
    const candidate = deps.platform === "win32" ? joinWin(dir, exe) : `${dir.replace(/\/+$/, "")}/${exe}`;
    if (deps.existsSync(candidate)) return candidate;
  }
  return null;
}

export function makePlatform(deps: PlatformDeps): Platform {
  const win = deps.platform === "win32";
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));

  /** Pi's own order: dist/utils/shell.js:66-91. WSL's launcher is refused (above). */
  const gitBash = (): string | null => {
    const pf = deps.env.ProgramFiles;
    if (pf && deps.existsSync(joinWin(pf, "Git\\bin\\bash.exe"))) return joinWin(pf, "Git\\bin\\bash.exe");
    const pf86 = deps.env["ProgramFiles(x86)"];
    if (pf86 && deps.existsSync(joinWin(pf86, "Git\\bin\\bash.exe"))) return joinWin(pf86, "Git\\bin\\bash.exe");
    const anywhere = onPath(deps, "bash.exe");
    return anywhere && !isWslBashPath(anywhere) ? anywhere : null;
  };

  return {
    name: deps.platform,
    isWindows: win,

    nodeExecPath() {
      // macOS only: LaunchServices registers any .app-bundled binary as Foreground, so
      // an ELECTRON_RUN_AS_NODE child spawned from the main binary gets a generic
      // "exec" Dock icon. The bundled helper carries LSUIElement=1. No other platform
      // has the problem, so no other platform needs the indirection.
      if (deps.platform !== "darwin") return deps.execPath;
      const m = deps.execPath.match(/^(.*)\/Contents\/MacOS\/([^/]+)$/);
      if (!m) return deps.execPath;
      const helper = `${m[1]}/Contents/Frameworks/${m[2]} Helper (Plugin).app/Contents/MacOS/${m[2]} Helper (Plugin)`;
      return deps.existsSync(helper) ? helper : deps.execPath;
    },

    childLauncher() {
      // pi-subagents getPiSpawnCommand (src/runs/shared/pi-spawn.ts): on win32 a
      // PI_SUBAGENT_PI_BINARY matching isNodeScriptPath (/\.(mjs|cjs|js)$/i) is run as
      // `process.execPath <script> …args` — no shell, which is the whole reason a .cmd
      // shim is not needed (Node refuses to spawn a .cmd without shell:true).
      return win ? "bin/pi-child.mjs" : "bin/pi-node.sh";
    },

    killTree(pid) {
      if (win) {
        // TerminateProcess runs no handler, so Pi's SIGTERM path and its
        // killTrackedDetachedChildren() never happen and every bash command and stdio
        // MCP server outlives the session. /T takes the tree.
        //
        // No grace period, measured rather than assumed: Pi appends its session file
        // with appendFileSync, so nothing already written is lost, and its own SIGTERM
        // branch deliberately skips the stdout flush.
        deps.exec("taskkill", ["/PID", String(pid), "/T", "/F"]);
      } else {
        // ESRCH is swallowed because "already gone" is the normal case, not an
        // error: every caller here (hibernation, MCP live-reload, closing a
        // crashed session) reaches stop() for a child that may have exited on its
        // own. `child.kill()` — what PiClient used before the seam — swallows it
        // internally, so raising it here turned a no-op into a throw in MAIN.
        try {
          kill(pid, "SIGTERM");
        } catch (e) {
          if ((e as NodeJS.ErrnoException)?.code !== "ESRCH") throw e;
        }
      }
    },

    readCommand(pid) {
      const r = win
        ? // tasklist prints an image name and no arguments, and the string sweepOrphans
          // matches ("pi-coding-agent") only ever appears in the arguments — the
          // executable is HappyVibe.exe. CIM is the one source that carries them.
          deps.exec("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ])
        : deps.exec("ps", ["-p", String(pid), "-o", "command="]);
      // Windows answers 0 with empty output for a dead pid rather than failing, so an
      // empty line is "gone" on both shapes.
      if (r.status !== 0) return null;
      return r.stdout.trim() || null;
    },

    terminalShell() {
      if (win) {
        return (
          onPath(deps, "pwsh.exe") ??
          onPath(deps, "powershell.exe") ??
          deps.env.COMSPEC ??
          "C:\\Windows\\System32\\cmd.exe"
        );
      }
      const s = deps.env.SHELL;
      if (typeof s === "string" && s) return s;
      // /bin/zsh rather than /bin/sh on macOS: it is the OS default login shell.
      return deps.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    },

    terminalShellArgs() {
      // `-l` is a POSIX LOGIN-shell flag, and it exists for a macOS reason: a
      // GUI-launched app inherits launchd's minimal PATH, so the shell has to read the
      // user's profile to find their tooling. Windows inherits correctly (shellPath.ts
      // has said so since long before this round), and PowerShell rejects the flag
      // outright — "The term '-l' is not recognized" — so the terminal died at spawn
      // with exit code 1 and a tab full of a PowerShell error.
      return win ? [] : ["-l"];
    },

    agentShell() {
      if (!win) return { shell: "bash", bashPath: null };
      const bashPath = gitBash();
      return bashPath ? { shell: "bash", bashPath } : { shell: "powershell", bashPath: null };
    },

    workspaceKey(p) {
      // Empty in, empty out. scheduleStore compares `normPath(input.workspaceId ?? "")`,
      // and path.resolve("") is the CWD — which would let an empty workspace id match a
      // real workspace that happens to be the process's directory.
      if (!p) return "";
      const resolved = (win ? path.win32 : path.posix).resolve(p);
      const trimmed = resolved.replace(/[\\/]+$/, "") || (win ? resolved : "/");
      return win ? trimmed.replace(/\//g, "\\").toLowerCase() : trimmed;
    },

    detectedShells() {
      if (!win) return [];
      const out: Array<{ label: string; path: string }> = [];
      const pwsh = onPath(deps, "pwsh.exe");
      if (pwsh) out.push({ label: "pwsh", path: pwsh });
      const ps = onPath(deps, "powershell.exe");
      if (ps) out.push({ label: "PowerShell", path: ps });
      const cmd = deps.env.COMSPEC;
      if (cmd && deps.existsSync(cmd)) out.push({ label: "cmd", path: cmd });
      const bash = gitBash();
      if (bash) out.push({ label: "Git Bash", path: bash });
      return out;
    },
  };
}

function defaultExec(cmd: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return { status: r.status, stdout: r.stdout ?? "" };
}

/** The real one. */
export const platform: Platform = makePlatform({
  platform: process.platform,
  execPath: process.execPath,
  env: process.env,
  existsSync: fsExistsSync,
  exec: defaultExec,
});
