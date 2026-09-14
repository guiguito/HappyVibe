# Windows Support (PRD §4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HappyVibe develops, tests and ships on Windows x64 at full parity (with Git for Windows installed), self-sufficient (no Node/Git/WSL prerequisite), through ONE pure platform seam that macOS CI can exercise with a fake Windows platform before a Windows box ever runs it.

**Architecture:** `src/main/platform.ts` (Electron-free, injectable `{platform, env, existsSync, exec}`) answers every platform question — `nodeExecPath`, `childLauncher`, `killTree`, `readCommand`, `terminalShell`, `agentShell`, `workspaceKey`, `detectedShells` — and every call site that branches on `process.platform` today consumes it. A pure string module `pi-runtime/extensions/hv-paths.ts` (shared by bridge, child guard, main and renderer, import-free like `hv-rules.ts`) makes path comparison `/`-normalised and case-folded on win32. The Windows sub-agent launcher is `pi-runtime/bin/pi-child.mjs`, selected by pi-subagents' own win32 `.mjs` rule. Packaging goes per-platform in `build/afterPack.mjs`; a `windows-latest` CI job is the tripwire.

**Tech Stack:** Electron 44, electron-builder 26.15 (NSIS), node-pty 1.1 (ConPTY), vitest, TypeScript 7 (`npm run typecheck` = three passes, run by `npm run build`).

**Spec:** Notion "Windows support" (`3dad33dfffca8009948fda54be4ffd79`, all decisions locked 2026-09-13); PRD `docs/prd.md` §4 Decision (Windows round, 2026-09-13) + §3/§26/§31 folds. Branch: `guiguito/windows`.

---

## Global Constraints

- **Dev topology (decision):** ONE checkout at `C:\Users\Guiguito\Documents\GitHub\HappyVibe` (= `/mnt/c/Users/Guiguito/Documents/GitHub/HappyVibe` in WSL). Claude Code edits from WSL; **nothing is ever `npm install`ed from WSL** — the Electron binary, `sherpa-onnx-*`, `@typescript/native` and rollup are per-platform and one `node_modules` cannot serve both. Every install/test/dev/build runs as native Windows via interop:
  ```bash
  W='cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && '
  eval "$W npm test\""                       # non-live suite on Windows
  eval "$W npm run build\""                  # typecheck + vite build on Windows
  eval "$W npm run dev\""                    # the app, natively (background it)
  ```
  Prerequisites on the Windows side (one-time, by the user): Node **24** (`winget install OpenJS.NodeJS.LTS`), Git for Windows (for the bash path), `.env` copied into the checkout. `npm ci && cd pi-runtime && npm ci` from Windows. **If `ls node_modules/electron/dist` in WSL shows `electron` (a Linux binary) something installed from WSL — delete `node_modules` and `pi-runtime/node_modules` and reinstall from Windows.**
- **The gate is still the gate:** `npm run gate` (macOS) AND, for every task touching `src/main/`, `pi-runtime/`, `tests/` or the scripts, the same via interop on Windows. `npm run live:why` WILL print (bridge + `spawn.ts` change) ⇒ `npm run test:live` once per phase, backgrounded, on macOS (the `.env` there is real). Never pipe a test run to `tail`/`grep` — redirect to a file, read the exit code and the wall time.
- **Never patch vendored source** (`pi-runtime/node_modules/**`). Upstream Windows behaviour is CONSUMED (pi-spawn's `.mjs` rule, Pi's Git Bash probe, `allToolNames`) and PINNED in `tests/pi-subagents-contract.test.ts`; never re-implemented.
- **Sub-agents need Git for Windows (decision).** Do NOT rewrite `pi-runtime/agents/*.md` `tools:` lists per platform. The onboarding line is the whole V1 mitigation.
- **No picker for the terminal shell (decision).** Free text stays; the hint names detected shells.
- **x64 only (decision).** No arm64 target anywhere in `electron-builder.yml`.
- **`hv-rules.ts` and `hv-paths.ts` stay import-free** (no `node:*`) — they are imported by the renderer (`PermissionRulesSection.tsx` previews rules with `evaluate`). Case-insensitivity is a FLAG on `ToolCall`, set by the caller from its own platform.
- **A skip is a decision with a reason.** `it.skipIf(process.platform === "win32")("…", …)` only for behaviour that is genuinely POSIX (Dock helper, `.sh` launcher, `spawn-helper`, `chmod` bits); every other POSIX-shaped test is made portable. `tests/windows-skips.test.ts` pins the list.
- **CLAUDE.md gets a Windows section in the LAST task**, not piecemeal.
- **Commit after every task**, message in the repo's voice (`feat(windows): …`, `fix(windows): …`, `test(windows): …`), ending with the attribution lines from the session's system reminder.

---

## File Structure

**Create**
- `src/main/platform.ts` — the seam. `makePlatform(deps)` + a default `platform` built from `process`. Exports the `Platform` interface.
- `pi-runtime/extensions/hv-paths.ts` — pure string path helpers: `toPosix`, `isAbsolutePath`, `foldCase`, `containsPath`, `stripTrailingSep`.
- `pi-runtime/bin/pi-child.mjs` — Windows sub-agent launcher.
- `scripts/test.mjs` — portable `npm test` (sets both `sk-REPLACE` vars, spawns vitest).
- `build/afterPackLayout.mjs` — pure `runtimeDest(context)` + `longestRelativePath(dir)` used by `afterPack.mjs`; importable by tests.
- `build/win-build.mjs` — `winBuildConfig(env)` (adds `azureSignOptions` only when `HV_WIN_SIGN=azure`) + a `main()` that runs electron-builder for `--win`.
- `src/renderer/src/platformCopy.ts` — `modKey(platform)`, `MOD` constant, `isWin`.
- `tests/platform.test.ts`, `tests/hv-paths.test.ts`, `tests/pi-child-launcher.test.ts`, `tests/agent-shell.test.ts`, `tests/afterpack-layout.test.ts`, `tests/win-build-config.test.ts`, `tests/test-script.test.ts`, `tests/mod-key-copy.test.ts`, `tests/windows-skips.test.ts`.
- `docs/validation/win1.md` — measurements from the Windows machine (M1 exit test, long-path number, ConPTY title, kill tree).

**Modify**
- `src/main/pi/spawn.ts` — `nodeExecPath` moves to platform (re-exported); `childLauncher`; `agentShell` → `--tools` + `HV_AGENT_SHELL`; `windowsHide`.
- `src/main/pi/PiClient.ts:101` — `stop()` via `platform.killTree`.
- `src/main/SessionManager.ts:58-92` — `sweepOrphans` defaults via `platform.readCommand` / `platform.killTree`.
- `src/main/terminalSettings.ts:157-164` — default shell via `platform.terminalShell`.
- `src/main/terminals.ts:159` — `useConpty: true`.
- `src/main/store.ts:560,596-615` — `normPath` + `WorkspaceRegistry.find` via `platform.workspaceKey`.
- `src/main/memory/store.ts:47-49` — `workspaceMemoryKey` folds case on win32.
- `src/main/files.ts:34-46` — `resolveInWorkspace` compares folded paths.
- `src/main/ipc.ts:4100,4110,4177-4187` — workspace compare, terminal log shell, mic status on win32; new handlers `hv:agent-shell`, `hv:terminal-shells`.
- `src/preload/index.ts` — `platform`, `agentShell()`, `terminalShells()`.
- `src/renderer/src/hv.d.ts` — the three above.
- `pi-runtime/extensions/hv-rules.ts:303-348, 253-263` — path normalisation + `caseInsensitivePaths` flag.
- `pi-runtime/extensions/hv-child-guard.ts:122-139` — `escapesWorkspace` via `containsPath`.
- `pi-runtime/extensions/happyvibe-bridge.ts:84,1249`, `hv-subagent-boundary.ts:34`, `hv-plan.ts:307`, `hv-readonly.ts`, `hv-terminal.ts:95` — `SHELL_TOOLS` / `isShellTool` / shell name from `HV_AGENT_SHELL`.
- `src/renderer/src/toolLabel.ts:243`, `components/ToolCard.tsx:369`, `components/TerminalView.tsx:226-230`, `components/OnboardingDialog.tsx`, `onboarding.ts`, `App.tsx:3851`, the 16 `⌘` files.
- `build/afterPack.mjs`, `electron-builder.yml`, `.github/workflows/ci.yml`, `.gitattributes`, `package.json` scripts, `README.md`, `CLAUDE.md`.
- Tests listed per task; the 12 `/tmp`, 3 `chmod`, 2 shebang, 6 `/bin/` files.

---

## Phase M0 — tripwire

### Task 1: LF line endings for every checkout

**Files:**
- Modify: `.gitattributes`

- [ ] **Step 1: Set `eol=lf` repo-wide**

Replace the file's content with:
```
# LF in the working tree on EVERY platform. A Windows checkout with core.autocrlf=true
# would otherwise turn every fixture into CRLF and break each test that compares text
# with "\n" (Windows round, 2026-09-13). .sh launchers are POSIX-only and MUST stay LF.
* text=auto eol=lf
*.sh text eol=lf
*.png binary
*.ico binary
*.icns binary
```

- [ ] **Step 2: Verify no tracked file changes under renormalisation on the current (LF) checkout**

Run: `git add --renormalize . && git status --short | wc -l`
Expected: `0` (macOS/WSL checkouts are already LF; if any file is listed, it carried CRLF and the renormalised version is the correct one — keep it).

- [ ] **Step 3: Commit**

```bash
git add .gitattributes
git commit -m "chore(windows): LF working trees on every platform"
```

### Task 2: A portable `npm test`

**Files:**
- Create: `scripts/test.mjs`
- Modify: `package.json` (`scripts.test`)
- Test: `tests/test-script.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/test-script.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `npm test` IS the non-live suite (CLAUDE.md §Tests): both provider keys are
 * neutralised to sk-REPLACE so every live file skips itself. The inline
 * `VAR=… vitest run` form only works in a POSIX shell, so the guarantee moved
 * into scripts/test.mjs — and this test pins that BOTH vars are still set there,
 * because setting only one would silently turn a 40 s suite into a paid ~6 min one
 * the day a key for the other provider lands in .env.
 */
const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const script = fs.readFileSync(path.join(ROOT, "scripts", "test.mjs"), "utf8");

describe("npm test is portable and still key-free", () => {
  it("routes through scripts/test.mjs, not an inline env assignment", () => {
    expect(pkg.scripts.test).toBe("node scripts/test.mjs");
    expect(pkg.scripts.test).not.toMatch(/=/);
  });
  it("neutralises BOTH provider keys", () => {
    expect(script).toMatch(/DEEPSEEK_API_KEY:\s*"sk-REPLACE"/);
    expect(script).toMatch(/OPENROUTER_API_KEY:\s*"sk-REPLACE"/);
  });
  it("forwards extra arguments to vitest", () => {
    expect(script).toContain("process.argv.slice(2)");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/test-script.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; tail -15 /tmp/vitest.log`
Expected: `EXIT=1`, `ENOENT … scripts/test.mjs`.

- [ ] **Step 3: Write the script**

```js
// scripts/test.mjs
// `npm test` = the NON-LIVE suite. Both provider keys are forced to sk-REPLACE
// (tests/liveModel.ts treats that value as ABSENT and its .env loader only fills
// UNSET vars, so the shell value wins and every live file skips itself). This
// used to be an inline `VAR=… vitest run` in package.json, which no PowerShell or
// cmd.exe can run — hence a script. Pinned by tests/test-script.test.ts.
import { spawnSync } from "node:child_process";

const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DEEPSEEK_API_KEY: "sk-REPLACE", OPENROUTER_API_KEY: "sk-REPLACE" },
  },
);
process.exit(r.status ?? 1);
```

Then in `package.json` change
```json
"test": "DEEPSEEK_API_KEY=sk-REPLACE OPENROUTER_API_KEY=sk-REPLACE vitest run",
```
to
```json
"test": "node scripts/test.mjs",
```
`gate` (`npm run build && npm test`) needs no change.

- [ ] **Step 4: Run the test and the whole non-live suite through the new entry**

Run: `npx vitest run tests/test-script.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?`  → `EXIT=0`
Run: `npm test > /tmp/npmtest.log 2>&1; echo EXIT=$?; tail -6 /tmp/npmtest.log`
Expected: `EXIT=0`, `~15 skipped`, wall time 25–40 s (a 6-minute run means a key leaked through — stop and fix).

- [ ] **Step 5: Commit**

```bash
git add scripts/test.mjs package.json tests/test-script.test.ts
git commit -m "chore(windows): npm test runs the same in PowerShell, cmd and bash"
```

### Task 3: The `windows-latest` CI job (advisory)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Append under `jobs:`:
```yaml
  # Windows round (2026-09-13): the tripwire. Advisory until M2 flips it to
  # required — a red here is the real list of what Windows breaks, instead of a grep.
  test-windows:
    runs-on: windows-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: actions/cache@v4
        with:
          path: ~\AppData\Local\electron\Cache
          key: electron-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npm ci
      - run: cd pi-runtime && npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Commit and push the branch; read the job's red list**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(windows): advisory windows-latest job as the tripwire"
git push -u origin guiguito/windows
```
Open the run (`gh run watch` or the Actions tab). Copy the list of failing test files into `docs/validation/win1.md` under `## M0 — the first red list` (create the file with that heading). This list is the checklist Task 21 works through.

---

## Phase M1 — it launches

### Task 4: The platform seam

**Files:**
- Create: `src/main/platform.ts`
- Modify: `src/main/pi/spawn.ts:14-20` (move `nodeExecPath`, re-export)
- Test: `tests/platform.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/platform.test.ts
import { describe, expect, it } from "vitest";
import { makePlatform, type PlatformDeps } from "../src/main/platform";

/**
 * The seam every platform-specific call site consumes (PRD §4, Windows round).
 * Built from injected deps so a Windows platform can be constructed on macOS CI
 * and pinned here BEFORE a Windows box ever runs it.
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

describe("nodeExecPath", () => {
  it("routes through the Helper (Plugin) on darwin when it exists", () => {
    const helper =
      "/Applications/HappyVibe.app/Contents/Frameworks/HappyVibe Helper (Plugin).app/Contents/MacOS/HappyVibe Helper (Plugin)";
    const p = makePlatform(deps({ existsSync: (f) => f === helper }));
    expect(p.nodeExecPath()).toBe(helper);
  });
  it("is process.execPath everywhere else", () => {
    const p = makePlatform(deps({ platform: "win32", execPath: "C:\\Program Files\\HappyVibe\\HappyVibe.exe" }));
    expect(p.nodeExecPath()).toBe("C:\\Program Files\\HappyVibe\\HappyVibe.exe");
  });
});

describe("childLauncher", () => {
  it("is the .mjs on win32 (pi-subagents' own isNodeScriptPath rule) and the .sh elsewhere", () => {
    expect(makePlatform(deps({ platform: "win32" })).childLauncher()).toBe("bin/pi-child.mjs");
    expect(makePlatform(deps({ platform: "darwin" })).childLauncher()).toBe("bin/pi-node.sh");
    expect(makePlatform(deps({ platform: "linux" })).childLauncher()).toBe("bin/pi-node.sh");
  });
});

describe("killTree / readCommand", () => {
  it("uses taskkill /T /F on win32", () => {
    const calls: Array<[string, string[]]> = [];
    const p = makePlatform(deps({ platform: "win32", exec: (c, a) => { calls.push([c, a]); return { status: 0, stdout: "" }; } }));
    p.killTree(4242);
    expect(calls).toEqual([["taskkill", ["/PID", "4242", "/T", "/F"]]]);
  });
  it("reads a win32 command line through CIM, because tasklist prints no arguments", () => {
    const p = makePlatform(deps({
      platform: "win32",
      exec: (c, a) => {
        expect(c).toBe("powershell.exe");
        expect(a.join(" ")).toContain("Win32_Process");
        expect(a.join(" ")).toContain("ProcessId=4242");
        return { status: 0, stdout: '"C:\\HV\\HappyVibe.exe" C:\\HV\\resources\\pi-runtime\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js --mode rpc\r\n' };
      },
    }));
    expect(p.readCommand(4242)).toContain("pi-coding-agent");
  });
  it("uses ps on darwin and returns null for a gone process", () => {
    const p = makePlatform(deps({ exec: () => ({ status: 1, stdout: "" }) }));
    expect(p.readCommand(1)).toBeNull();
  });
});

describe("terminalShell", () => {
  it("is $SHELL then /bin/zsh on darwin, /bin/bash on linux", () => {
    expect(makePlatform(deps({ env: { SHELL: "/opt/homebrew/bin/fish" } })).terminalShell()).toBe("/opt/homebrew/bin/fish");
    expect(makePlatform(deps({})).terminalShell()).toBe("/bin/zsh");
    expect(makePlatform(deps({ platform: "linux" })).terminalShell()).toBe("/bin/bash");
  });
  it("is pwsh → powershell → COMSPEC on win32, by PATH probe", () => {
    const onPath = new Set(["C:\\PS7\\pwsh.exe"]);
    const p = makePlatform(deps({
      platform: "win32",
      env: { PATH: "C:\\PS7;C:\\Windows\\System32\\WindowsPowerShell\\v1.0", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
      existsSync: (f) => onPath.has(f),
    }));
    expect(p.terminalShell()).toBe("C:\\PS7\\pwsh.exe");
    const noPs = makePlatform(deps({ platform: "win32", env: { PATH: "", COMSPEC: "C:\\Windows\\System32\\cmd.exe" } }));
    expect(noPs.terminalShell()).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

describe("agentShell", () => {
  it("is bash off win32", () => {
    expect(makePlatform(deps({})).agentShell()).toEqual({ shell: "bash", bashPath: null });
  });
  it("probes exactly where Pi does, in Pi's order, and falls back to powershell", () => {
    const pf = "C:\\Program Files";
    const found = makePlatform(deps({
      platform: "win32",
      env: { ProgramFiles: pf, PATH: "" },
      existsSync: (f) => f === `${pf}\\Git\\bin\\bash.exe`,
    }));
    expect(found.agentShell()).toEqual({ shell: "bash", bashPath: `${pf}\\Git\\bin\\bash.exe` });
    const none = makePlatform(deps({ platform: "win32", env: { ProgramFiles: pf, PATH: "" } }));
    expect(none.agentShell()).toEqual({ shell: "powershell", bashPath: null });
  });
});

describe("workspaceKey", () => {
  it("lower-cases and normalises slashes on win32 only", () => {
    const w = makePlatform(deps({ platform: "win32" }));
    expect(w.workspaceKey("C:\\Users\\G\\Proj\\")).toBe(w.workspaceKey("c:/users/g/proj"));
    const m = makePlatform(deps({}));
    expect(m.workspaceKey("/Users/G/Proj")).not.toBe(m.workspaceKey("/users/g/proj"));
    expect(m.workspaceKey("/Users/G/Proj/")).toBe("/Users/G/Proj");
  });
});

describe("detectedShells", () => {
  it("lists what exists on win32, for the settings hint", () => {
    const onDisk = new Set(["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Program Files\\Git\\bin\\bash.exe"]);
    const p = makePlatform(deps({
      platform: "win32",
      env: { PATH: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0", ProgramFiles: "C:\\Program Files", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
      existsSync: (f) => onDisk.has(f) || f === "C:\\Windows\\System32\\cmd.exe",
    }));
    expect(p.detectedShells().map((s) => s.label)).toEqual(["PowerShell", "cmd", "Git Bash"]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/platform.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; tail -5 /tmp/vitest.log`
Expected: `EXIT=1`, cannot find module `../src/main/platform`.

- [ ] **Step 3: Write the seam**

```ts
// src/main/platform.ts
/**
 * PRD §4 (Windows round, 2026-09-13): the ONE place that answers a platform
 * question. Every call site that used to branch on `process.platform` reads
 * this instead, so a fake Windows platform can be injected on macOS CI and the
 * behaviour is pinned (tests/platform.test.ts) before a Windows box runs it.
 *
 * Electron-free and vitest-importable, like spawn.ts. The default instance is
 * built from `process`; tests call makePlatform() with their own deps.
 */
import { spawnSync } from "node:child_process";
import { existsSync as fsExists } from "node:fs";
import path from "node:path";

export interface PlatformDeps {
  platform: NodeJS.Platform;
  execPath: string;
  env: Record<string, string | undefined>;
  existsSync: (p: string) => boolean;
  /** Synchronous exec, injectable so tests never spawn. */
  exec: (cmd: string, args: string[]) => { status: number | null; stdout: string };
}

export type AgentShell = "bash" | "powershell";

export interface Platform {
  readonly name: NodeJS.Platform;
  readonly isWindows: boolean;
  /** Node-capable exec path for Electron-as-node children (Helper (Plugin) on darwin). */
  nodeExecPath(): string;
  /** PI_SUBAGENT_PI_BINARY, relative to pi-runtime/. */
  childLauncher(): string;
  /** Take a session AND its descendants down. */
  killTree(pid: number): void;
  /** The pid's command line, or null when it is gone. */
  readCommand(pid: number): string | null;
  /** The default interactive shell for §26 terminals. */
  terminalShell(): string;
  /** Pi's own shell tool choice, probed where Pi probes (dist/utils/shell.js). */
  agentShell(): { shell: AgentShell; bashPath: string | null };
  /** Canonical comparison key for a workspace path. */
  workspaceKey(p: string): string;
  /** Shells found on this machine, for the settings hint. */
  detectedShells(): Array<{ label: string; path: string }>;
}

function onPath(deps: PlatformDeps, exe: string): string | null {
  for (const dir of (deps.env.PATH ?? "").split(deps.platform === "win32" ? ";" : ":").filter(Boolean)) {
    const candidate = deps.platform === "win32" ? `${dir.replace(/[\\/]+$/, "")}\\${exe}` : `${dir}/${exe}`;
    if (deps.existsSync(candidate)) return candidate;
  }
  return null;
}

export function makePlatform(deps: PlatformDeps): Platform {
  const win = deps.platform === "win32";

  const gitBash = (): string | null => {
    // Pi's own order (dist/utils/shell.js:66-91): ProgramFiles, ProgramFiles(x86), then PATH.
    const pf = deps.env.ProgramFiles;
    if (pf && deps.existsSync(`${pf}\\Git\\bin\\bash.exe`)) return `${pf}\\Git\\bin\\bash.exe`;
    const pf86 = deps.env["ProgramFiles(x86)"];
    if (pf86 && deps.existsSync(`${pf86}\\Git\\bin\\bash.exe`)) return `${pf86}\\Git\\bin\\bash.exe`;
    return onPath(deps, "bash.exe");
  };

  return {
    name: deps.platform,
    isWindows: win,

    nodeExecPath() {
      if (deps.platform !== "darwin") return deps.execPath;
      const m = deps.execPath.match(/^(.*)\/Contents\/MacOS\/([^/]+)$/);
      if (!m) return deps.execPath;
      const helper = `${m[1]}/Contents/Frameworks/${m[2]} Helper (Plugin).app/Contents/MacOS/${m[2]} Helper (Plugin)`;
      return deps.existsSync(helper) ? helper : deps.execPath;
    },

    childLauncher() {
      // pi-subagents getPiSpawnCommand (src/runs/shared/pi-spawn.ts:169): on win32 a
      // PI_SUBAGENT_PI_BINARY matching /\.(mjs|cjs|js)$/i is run as `execPath <script> …args`.
      return win ? "bin/pi-child.mjs" : "bin/pi-node.sh";
    },

    killTree(pid) {
      if (win) {
        // TerminateProcess never runs Pi's SIGTERM handler, so descendants (bash
        // commands, stdio MCP servers) would survive a plain kill. /T takes the tree.
        // No grace period: Pi appends its session file synchronously (measured,
        // session-manager.js:745) and its own SIGTERM path skips the stdout flush.
        deps.exec("taskkill", ["/PID", String(pid), "/T", "/F"]);
      } else {
        process.kill(pid, "SIGTERM");
      }
    },

    readCommand(pid) {
      const r = win
        ? deps.exec("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ])
        : deps.exec("ps", ["-p", String(pid), "-o", "command="]);
      if (r.status !== 0) return null;
      const out = r.stdout.trim();
      return out || null;
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
      return deps.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    },

    agentShell() {
      if (!win) return { shell: "bash", bashPath: null };
      const bashPath = gitBash();
      return bashPath ? { shell: "bash", bashPath } : { shell: "powershell", bashPath: null };
    },

    workspaceKey(p) {
      const resolved = (win ? path.win32 : path.posix).resolve(p).replace(/[\\/]+$/, "");
      return win ? resolved.replace(/\//g, "\\").toLowerCase() : resolved || "/";
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
  existsSync: fsExists,
  exec: defaultExec,
});
```

Then in `src/main/pi/spawn.ts` replace the body of `nodeExecPath` (lines 14-20) with a re-export that keeps every existing import working:
```ts
import { platform } from "../platform";
/** Kept as an export for the sidecar callers (documents.ts, mcpAdapterStore.ts); the
    logic lives in platform.ts now — PRD §4, Windows round. */
export function nodeExecPath(): string {
  return platform.nodeExecPath();
}
```
(Keep the doc comment above it; delete the now-unused `existsSync` import ONLY if nothing else in the file uses it — `opts.appendFile && existsSync(...)` at the `--append-system-prompt` line does, so it stays.)

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/platform.test.ts tests/identity-prompt.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/main/platform.ts src/main/pi/spawn.ts tests/platform.test.ts
git commit -m "feat(windows): the platform seam — one module answers every platform question"
```

### Task 5: The Windows child launcher

**Files:**
- Create: `pi-runtime/bin/pi-child.mjs`
- Modify: `src/main/pi/spawn.ts:37,301` (`PI_SUBAGENT_BIN_RELPATH` → `platform.childLauncher()`)
- Modify: `tests/pi-cli-entry.test.ts:87-94`, `tests/mcp-spawn.test.ts:78-100`
- Test: `tests/pi-child-launcher.test.ts`, `tests/pi-subagents-contract.test.ts` (new group)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pi-child-launcher.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PI_CLI_RELPATH, resolvePiSpawn } from "../src/main/pi/spawn";
import { makePlatform } from "../src/main/platform";

/**
 * PRD §12 on Windows: the child guard's ONLY injection point is the launcher named
 * by PI_SUBAGENT_PI_BINARY. pi-node.sh is a POSIX script; on win32 the launcher is
 * a plain .mjs that pi-subagents runs as `process.execPath <script> …` through its
 * own isNodeScriptPath rule (pinned in pi-subagents-contract.test.ts). Guard is
 * PREPENDED for the same reason pi-node.sh prepends: pi-args puts the task LAST.
 */
const RUNTIME = path.join(__dirname, "..", "pi-runtime");
const src = fs.readFileSync(path.join(RUNTIME, "bin", "pi-child.mjs"), "utf8");

describe("pi-child.mjs", () => {
  it("names the SAME CLI entry as the parent and the .sh launcher", () => {
    expect(src).toContain(PI_CLI_RELPATH);
    expect(src, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });
  it("injects the child guard BEFORE the forwarded argv", () => {
    const guardIdx = src.indexOf('"--extension"');
    const forwardIdx = src.indexOf("process.argv.slice(2)");
    expect(guardIdx).toBeGreaterThan(0);
    expect(forwardIdx).toBeGreaterThan(guardIdx);
    expect(src).toMatch(/extensions[\\/]hv-child-guard\.ts/);
  });
  it("resolves the runtime from its own location, never from cwd", () => {
    expect(src).toContain("import.meta.url");
    expect(src).not.toMatch(/process\.cwd\(\)/);
  });
});

describe("spawn points PI_SUBAGENT_PI_BINARY at the platform's launcher", () => {
  const base = { model: { provider: "openrouter", modelId: "x" } };
  it(".mjs on a win32 platform", () => {
    const win = makePlatform({ platform: "win32", execPath: "C:\\HV\\HappyVibe.exe", env: {}, existsSync: () => false, exec: () => ({ status: 0, stdout: "" }) });
    const s = resolvePiSpawn(base, "C:\\ws", "C:\\HV\\resources\\pi-runtime", "C:\\sessions", win);
    expect(s.env.PI_SUBAGENT_PI_BINARY).toMatch(/[\\/]bin[\\/]pi-child\.mjs$/);
  });
  it(".sh on darwin", () => {
    const s = resolvePiSpawn(base, "/ws", "/rt", "/sessions");
    expect(s.env.PI_SUBAGENT_PI_BINARY).toMatch(/\/bin\/pi-node\.sh$/);
  });
});
```

Add to `tests/pi-subagents-contract.test.ts` (new `describe` at the end of the file):
```ts
describe("the Windows child launcher rides upstream's own .mjs rule", () => {
  // getPiSpawnCommand: on win32 a PI_SUBAGENT_PI_BINARY that isNodeScriptPath() is run
  // as `process.execPath <script> …args`. pi-child.mjs exists BECAUSE of this branch;
  // if a pin bump removes or narrows it, every Windows delegation dies at spawn.
  const spawnSrc = fs.readFileSync(
    path.join(RUNTIME, "node_modules", "pi-subagents", "src", "runs", "shared", "pi-spawn.ts"),
    "utf8",
  );
  it("still has the win32 isNodeScriptPath branch", () => {
    expect(spawnSrc).toMatch(/platform === "win32" && isNodeScriptPath\(piBinary\)/);
    expect(spawnSrc).toMatch(/command: deps\.execPath \?\? process\.execPath,\s*args: \[piBinary, \.\.\.args\]/);
  });
  it("still admits .mjs", () => {
    const m = spawnSrc.match(/function isNodeScriptPath[\s\S]*?return (\/[^/]+\/i)\.test/);
    expect(m, "isNodeScriptPath regexp").toBeTruthy();
    const re = new Function(`return ${m![1]}`)() as RegExp;
    expect(re.test("C:\\x\\pi-child.mjs")).toBe(true);
  });
});
```
(`RUNTIME`, `fs`, `path` already exist at the top of that file — reuse them; if the constant is named differently there, use its name.)

Update the two existing pins so they read ALL launchers:
- `tests/pi-cli-entry.test.ts:87-94` — keep the `.sh` test and add:
  ```ts
  it("pi-child.mjs runs the SAME entry as the parent", () => {
    const mjs = read(path.join(RUNTIME, "bin", "pi-child.mjs"));
    expect(mjs).toContain(PI_CLI_RELPATH);
    expect(mjs, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });
  ```
- `tests/mcp-spawn.test.ts` — the tests at lines 78-100 read `pi-node.sh` and stay as they are (that file is unchanged); add after them:
  ```ts
  test("the Windows launcher prepends the guard too", () => {
    const mjs = fs.readFileSync(path.join(runtime, "bin", "pi-child.mjs"), "utf8");
    expect(mjs.indexOf('"--extension"')).toBeLessThan(mjs.indexOf("process.argv.slice(2)"));
  });
  ```

- [ ] **Step 2: Run them, expect failure**

Run: `npx vitest run tests/pi-child-launcher.test.ts tests/pi-subagents-contract.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; grep -E "✓|✗|×|FAIL" /tmp/vitest.log | head`
Expected: `EXIT=1`; the launcher tests fail on ENOENT; the contract group PASSES already (it pins upstream, which is the point — it is the tripwire for the future).

- [ ] **Step 3: Write the launcher and thread the platform through spawn**

```js
// pi-runtime/bin/pi-child.mjs
// HappyVibe: the WINDOWS sub-agent launcher (PRD §4 Windows round; §12 child guard).
//
// pi-subagents runs PI_SUBAGENT_PI_BINARY as the child command. pi-node.sh does that
// job on macOS/Linux; it is a POSIX script and cannot run here, and a .cmd shim is not
// a drop-in because Node refuses to spawn() a .cmd without shell:true. Upstream's own
// win32 rule (getPiSpawnCommand, pi-spawn.ts) is what makes THIS file work: a
// PI_SUBAGENT_PI_BINARY ending in .mjs/.cjs/.js is run as `process.execPath <script>
// …args`, and process.execPath in the parent Pi is our Electron binary running as Node
// (ELECTRON_RUN_AS_NODE=1 is inherited). No shell, no .exe, no system Node.
//
// Keep the CLI path in step with PI_CLI_RELPATH in src/main/pi/spawn.ts and with
// pi-node.sh — tests/pi-cli-entry.test.ts pins all three.
import { fileURLToPath } from "node:url";
import path from "node:path";

const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
// PREPENDED, never appended: pi-args puts the task LAST as a positional, and whether a
// flag after a positional is still parsed is not worth betting the permission gate on.
const GUARD = path.join(RUNTIME, "extensions", "hv-child-guard.ts");

process.argv = [process.argv[0], CLI, "--extension", GUARD, ...process.argv.slice(2)];
await import(CLI);
```

In `src/main/pi/spawn.ts`:
- Change the launcher constant's comment and keep it for the `.sh` (other code reads it):
  ```ts
  /** POSIX child launcher (macOS/Linux). On win32 `platform.childLauncher()` answers
      `bin/pi-child.mjs` instead — see that file. */
  export const PI_SUBAGENT_BIN_RELPATH = "bin/pi-node.sh";
  ```
- Give `resolvePiSpawn` an optional trailing parameter `plat: Platform = platform` (import the type and the default from `../platform`), and use it:
  - `execPath: plat.nodeExecPath(),`
  - `PI_SUBAGENT_PI_BINARY: path.join(runtimeDir, plat.childLauncher()),`
  (Find the exact signature with `grep -n "export function resolvePiSpawn" src/main/pi/spawn.ts`; append the new parameter LAST so the 18 existing call sites in tests keep compiling.)

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/pi-child-launcher.test.ts tests/pi-cli-entry.test.ts tests/mcp-spawn.test.ts tests/pi-subagents-contract.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/bin/pi-child.mjs src/main/pi/spawn.ts tests/pi-child-launcher.test.ts tests/pi-cli-entry.test.ts tests/mcp-spawn.test.ts tests/pi-subagents-contract.test.ts
git commit -m "feat(windows): pi-child.mjs — the child guard reaches Windows sub-agents through upstream's .mjs rule"
```

### Task 6: Process lifecycle — kill the tree, read the command line, hide the console

**Files:**
- Modify: `src/main/pi/PiClient.ts:101` and its `spawn(...)` call in `start()`
- Modify: `src/main/SessionManager.ts:58-92`
- Test: `tests/session-manager.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/session-manager.test.ts`:
```ts
import { makePlatform } from "../src/main/platform";

describe("sweepOrphans on Windows", () => {
  it("verifies through the platform's readCommand and kills through killTree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sweep-"));
    const pidFile = path.join(dir, "pids.json");
    fs.writeFileSync(pidFile, JSON.stringify({ 4242: { sessionId: "s1" }, 9: { sessionId: "s2" } }));
    const execs: string[] = [];
    const win = makePlatform({
      platform: "win32", execPath: "C:\\HV\\HappyVibe.exe", env: {}, existsSync: () => false,
      exec: (cmd, args) => {
        execs.push([cmd, ...args].join(" "));
        if (cmd === "powershell.exe") {
          return args.join(" ").includes("ProcessId=4242")
            ? { status: 0, stdout: "HappyVibe.exe C:\\rt\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js --mode rpc\r\n" }
            : { status: 0, stdout: "" }; // pid 9: gone (empty CommandLine)
        }
        return { status: 0, stdout: "" };
      },
    });
    const killed = sweepOrphans(pidFile, (pid) => win.readCommand(pid), (pid) => win.killTree(pid));
    expect(killed).toEqual([4242]);
    expect(execs.some((e) => e === "taskkill /PID 4242 /T /F")).toBe(true);
    expect(execs.some((e) => e.startsWith("taskkill /PID 9 "))).toBe(false);
  });
});
```
(`fs`, `path`, `os`, `sweepOrphans` are already imported in that file; check the pid-file shape against `readPids` in `SessionManager.ts` and match it.)

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/session-manager.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?`
Expected: passes or fails only on the pid-file shape — the injected functions already work. If it passes, fine: the value of the test is the DEFAULTS, changed next.

- [ ] **Step 3: Route the defaults and the client through the seam**

`src/main/SessionManager.ts`: replace `defaultReadCmd` and the default `kill` with the platform:
```ts
import { platform } from "./platform";
// …
export function sweepOrphans(
  pidFile: string,
  readCmd: (pid: number) => string | null = (pid) => platform.readCommand(pid),
  kill: (pid: number) => void = (pid) => platform.killTree(pid)
): number[] {
```
Delete `defaultReadCmd` and the now-unused `execFileSync` import if nothing else uses it.

`src/main/pi/PiClient.ts`:
- `stop()` becomes
  ```ts
  stop(): void {
    const pid = this.child?.pid;
    if (pid) platform.killTree(pid);
    else this.child?.kill();
  }
  ```
  with `import { platform } from "../platform";`.
- In `start()`, find the `spawn(` call and add `windowsHide: true` to its options object (beside `stdio`/`env`/`cwd`). No console window may flash per session on Windows.

Also add `windowsHide: true` to the sidecar spawns in `src/main/documents.ts` and `src/main/mcpAdapterStore.ts` (grep `spawn(` in each; both keep `child.kill("SIGKILL")` — they have no children).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/session-manager.test.ts tests/documents*.test.ts tests/mcp-adapter*.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/main/SessionManager.ts src/main/pi/PiClient.ts src/main/documents.ts src/main/mcpAdapterStore.ts tests/session-manager.test.ts
git commit -m "feat(windows): sessions die as a tree, orphans are verified through CIM, no console flashes"
```

### Task 7: `hv-paths.ts` — pure path comparison that survives backslashes and case

**Files:**
- Create: `pi-runtime/extensions/hv-paths.ts`
- Test: `tests/hv-paths.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hv-paths.test.ts
import { describe, expect, it } from "vitest";
import { containsPath, foldCase, isAbsolutePath, stripTrailingSep, toPosix } from "../pi-runtime/extensions/hv-paths";

/**
 * Import-free string helpers shared by the rules engine (bridge + renderer), the
 * child guard and main. On win32 a workspace is `C:\ws`, git says `C:/ws`, the model
 * writes either, and the filesystem is case-insensitive — every "is this inside the
 * workspace" answer must agree regardless. Pure so `path.win32` is never needed.
 */
describe("toPosix / isAbsolutePath", () => {
  it("normalises backslashes and keeps drive letters", () => {
    expect(toPosix("C:\\Users\\G\\ws\\src\\a.ts")).toBe("C:/Users/G/ws/src/a.ts");
    expect(toPosix("/Users/g/ws")).toBe("/Users/g/ws");
  });
  it("knows a drive-letter and a UNC path are absolute", () => {
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("c:/x")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\x")).toBe(true);
    expect(isAbsolutePath("/x")).toBe(true);
    expect(isAbsolutePath("x/y")).toBe(false);
    expect(isAbsolutePath("C:x")).toBe(false); // drive-relative is NOT absolute
  });
});

describe("containsPath", () => {
  it("is exact-root-or-child, never a bare prefix", () => {
    expect(containsPath("/tmp/ws", "/tmp/ws", false)).toBe(true);
    expect(containsPath("/tmp/ws", "/tmp/ws/a", false)).toBe(true);
    expect(containsPath("/tmp/ws", "/tmp/ws-evil/a", false)).toBe(false);
  });
  it("folds case and separators on win32", () => {
    expect(containsPath("C:\\Users\\G\\ws", "c:/users/g/WS/src/a.ts", true)).toBe(true);
    expect(containsPath("C:\\Users\\G\\ws", "C:\\Users\\G\\ws2\\a.ts", true)).toBe(false);
    expect(containsPath("/tmp/ws", "/tmp/WS/a", false)).toBe(false);
  });
  it("strips trailing separators on both sides", () => {
    expect(stripTrailingSep("C:\\ws\\")).toBe("C:\\ws");
    expect(stripTrailingSep("/")).toBe("/");
    expect(containsPath("/tmp/ws/", "/tmp/ws", false)).toBe(true);
  });
  it("foldCase is identity when not case-insensitive", () => {
    expect(foldCase("AbC", false)).toBe("AbC");
    expect(foldCase("AbC", true)).toBe("abc");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/hv-paths.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1` (module not found).

- [ ] **Step 3: Write the module**

```ts
// pi-runtime/extensions/hv-paths.ts
/**
 * PRD §4 (Windows round, 2026-09-13): pure string path comparison.
 *
 * IMPORT-FREE on purpose, like hv-rules.ts — this is consumed by the bridge, the
 * child guard, main AND the renderer (PermissionRulesSection previews rules with
 * `evaluate`). No `node:path`: the caller says whether paths compare
 * case-insensitively (win32) and everything else is string work.
 *
 * Containment is `=== root || startsWith(root + "/")` on POSIX-normalised, optionally
 * case-folded strings — never a bare startsWith, or `/tmp/ws-evil` reads as inside `/tmp/ws`.
 */

/** Backslashes → `/`, runs of separators collapsed, drive letter kept. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, (m, off: number) => (off === 0 ? "//" : "/"));
}

export function stripTrailingSep(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  return s === "" ? (p.startsWith("\\") || p.startsWith("/") ? "/" : p) : s;
}

export function foldCase(p: string, caseInsensitive: boolean): string {
  return caseInsensitive ? p.toLowerCase() : p;
}

/** `/x`, `C:\x`, `c:/x`, `\\server\share` are absolute; `x/y` and drive-relative `C:x` are not. */
export function isAbsolutePath(p: string): boolean {
  return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(p);
}

/** Is `target` the root itself or strictly under it? Both sides normalised first. */
export function containsPath(root: string, target: string, caseInsensitive: boolean): boolean {
  const r = foldCase(stripTrailingSep(toPosix(root)), caseInsensitive);
  const t = foldCase(stripTrailingSep(toPosix(target)), caseInsensitive);
  return t === r || t.startsWith(r === "/" ? "/" : r + "/");
}
```

- [ ] **Step 4: Run the tests and the extensions typecheck**

Run: `npx vitest run tests/hv-paths.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run typecheck:ext > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0` (whole-directory include, Task 4's `tests/extensions-typecheck.test.ts` already covers new files).

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-paths.ts tests/hv-paths.test.ts
git commit -m "feat(windows): hv-paths — pure containment that folds separators and case"
```

### Task 8: Permission rules that match Windows paths

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts:28-34` (ToolCall), `:253-263` (escapesWorkspace), `:342-348` (path layer)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (where the `ToolCall` for `evaluate` is built — `grep -n "workspace:" pi-runtime/extensions/happyvibe-bridge.ts`)
- Modify: `src/renderer/src/components/PermissionRulesSection.tsx:36` (the preview call)
- Test: `tests/hv-rules.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/hv-rules.test.ts`:
```ts
describe("path rules on win32 paths", () => {
  const ws = "C:\\Users\\G\\ws";
  const rules = { global: [{ layer: "path" as const, pattern: "src/**", action: "deny" as const }], workspaces: {} };
  it("a src/** rule matches a backslash path under the workspace", () => {
    const v = evaluate(rules, { tool: "write", input: { path: "C:\\Users\\G\\ws\\src\\a.ts" }, workspace: ws, caseInsensitivePaths: true });
    expect(v.action).toBe("deny");
    expect(v.source).toBe("rule");
  });
  it("matches regardless of case when the caller says the filesystem is case-insensitive", () => {
    const v = evaluate(rules, { tool: "write", input: { path: "c:/users/g/WS/SRC/a.ts" }, workspace: ws, caseInsensitivePaths: true });
    expect(v.action).toBe("deny");
  });
  it("does NOT fold case on a case-sensitive platform", () => {
    const v = evaluate(rules, { tool: "write", input: { path: "/tmp/ws/SRC/a.ts" }, workspace: "/tmp/ws" });
    expect(v.source).not.toBe("rule");
  });
  it("a drive-letter path outside the workspace is outside-workspace, not a relative depth count", () => {
    const v = evaluate({ global: [], workspaces: {} }, { tool: "read", input: { path: "D:\\other\\x.txt" }, workspace: ws, caseInsensitivePaths: true });
    expect(v.source).toBe("outside-workspace");
  });
  it("a sibling with a shared prefix is outside", () => {
    const v = evaluate({ global: [], workspaces: {} }, { tool: "read", input: { path: "C:\\Users\\G\\ws-evil\\x" }, workspace: ws, caseInsensitivePaths: true });
    expect(v.source).toBe("outside-workspace");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/hv-rules.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; grep -E "×|✗|FAIL" /tmp/vitest.log | head` → the four win32 cases fail (`source` is `"default"` / `"rule"` never matches).

- [ ] **Step 3: Normalise before matching**

In `pi-runtime/extensions/hv-rules.ts`:
- Add at the top: `import { containsPath, foldCase, isAbsolutePath, stripTrailingSep, toPosix } from "./hv-paths";` (this keeps the module free of `node:*`; `hv-paths` is import-free).
- Extend `ToolCall`:
  ```ts
  export interface ToolCall {
    tool: string;
    input: Record<string, unknown>;
    /** Absolute workspace cwd the Pi session runs in. */
    workspace: string;
    /** win32: the filesystem is case-insensitive, so paths fold case before matching.
     *  Set by the CALLER from its own platform — this module stays import-free. */
    caseInsensitivePaths?: boolean;
  }
  ```
- Replace the path layer of `ruleMatches` (the block after `// path layer …`):
  ```ts
  // path layer — match any file-ish arg, relative to the workspace when inside it.
  // Everything is POSIX-normalised first: globToRegExp's `[^/]` never sees a
  // backslash, and a `src/**` rule matches `C:\ws\src\a.ts` (Windows round).
  const ci = call.caseInsensitivePaths === true;
  const re = globToRegExp(foldCase(rule.pattern, ci), "path");
  const ws = stripTrailingSep(toPosix(call.workspace)) + "/";
  return pathArgs(call.input).some((raw) => {
    const p = foldCase(toPosix(raw), ci);
    const rel = p.startsWith(foldCase(ws, ci)) ? p.slice(ws.length) : p;
    return re.test(rel) || re.test(p);
  });
  ```
- Replace `escapesWorkspace(p, workspace)` (lines 253-263):
  ```ts
  export function escapesWorkspace(p: string, workspace: string, caseInsensitive = false): boolean {
    if (p.startsWith("~")) return true;
    if (isAbsolutePath(p)) return !containsPath(workspace, p, caseInsensitive);
    let depth = 0;
    for (const seg of toPosix(p).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") { depth--; if (depth < 0) return true; }
      else depth++;
    }
    return false;
  }
  ```
  and its call in `evaluate`: `escapesWorkspace(p, call.workspace, call.caseInsensitivePaths === true)`.
- Update the doc comment above it: delete "posix-only (the app is mac/linux-first)".

Callers set the flag:
- `happyvibe-bridge.ts`: every place that builds `{ tool, input, workspace }` for `evaluate`/`childDecision` adds `caseInsensitivePaths: process.platform === "win32"`. Find them: `grep -n "workspace: " pi-runtime/extensions/happyvibe-bridge.ts pi-runtime/extensions/hv-child-guard.ts pi-runtime/extensions/hv-readonly.ts pi-runtime/extensions/hv-plan.ts`. Define ONE constant near the top of the bridge, `const CI_PATHS = process.platform === "win32";`, and reuse it.
- `src/renderer/src/components/PermissionRulesSection.tsx:36`: the preview `evaluate(...)` call passes `caseInsensitivePaths: window.hv.platform === "win32"` (the `platform` field lands on `window.hv` in Task 10; until then use `navigator.platform.toLowerCase().startsWith("win")` and swap it in Task 10).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/hv-rules.test.ts tests/hv-child-rules.test.ts tests/rules-bridge.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0` (rules-bridge is live and skips without a key; that is expected here — it runs in the phase's live batch).
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-rules.ts pi-runtime/extensions/happyvibe-bridge.ts pi-runtime/extensions/hv-child-guard.ts pi-runtime/extensions/hv-readonly.ts pi-runtime/extensions/hv-plan.ts src/renderer/src/components/PermissionRulesSection.tsx tests/hv-rules.test.ts
git commit -m "fix(windows): path rules match backslash paths and fold case on win32"
```

### Task 9: Path confinement and workspace identity on win32

**Files:**
- Modify: `pi-runtime/extensions/hv-child-guard.ts:122-139`
- Modify: `src/main/files.ts:34-46`
- Modify: `src/main/store.ts:560,596-615`
- Modify: `src/main/memory/store.ts:47-49`
- Modify: `src/main/ipc.ts:4100` (known-workspace compare)
- Test: `tests/child-write-confine.test.ts`, `tests/files.test.ts`, `tests/memory-store.test.ts`, `tests/workspace-model.test.ts` (extend each)

- [ ] **Step 1: Write the failing tests**

`tests/child-write-confine.test.ts` — append:
```ts
describe("containment folds case on win32 (pure arm)", () => {
  // escapesWorkspace resolves through the REAL filesystem (symlinks via the nearest
  // existing ancestor), so a full win32 run needs a Windows box. The comparison
  // itself is pure and pinned here through the shared helper it now uses.
  it("treats C:\\WS\\a and c:/ws/a as the same place", async () => {
    const { containsPath } = await import("../pi-runtime/extensions/hv-paths");
    expect(containsPath("C:\\WS", "c:/ws/out.md", true)).toBe(true);
  });
});
```
`tests/files.test.ts` — append:
```ts
describe("resolveInWorkspace on a case-insensitive filesystem", () => {
  it.skipIf(process.platform !== "win32")("accepts the registered workspace in another case", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-files-"));
    const other = ws.toUpperCase();
    expect(resolveInWorkspace([ws], other, "a.txt")).toBe(path.join(path.resolve(other), "a.txt"));
  });
});
```
`tests/memory-store.test.ts` — append:
```ts
it("keys C:\\WS and c:/ws identically on win32, and NOT on POSIX", () => {
  expect(workspaceMemoryKey("C:\\WS", null, "win32")).toBe(workspaceMemoryKey("c:/ws", null, "win32"));
  expect(workspaceMemoryKey("/tmp/WS", null, "darwin")).not.toBe(workspaceMemoryKey("/tmp/ws", null, "darwin"));
});
```
`tests/workspace-model.test.ts` — append (it already constructs a `WorkspaceRegistry`; reuse its fixture):
```ts
it("finds a workspace registered under another separator/case on a win32 platform", () => {
  const win = makePlatform({ platform: "win32", execPath: "x", env: {}, existsSync: () => false, exec: () => ({ status: 0, stdout: "" }) });
  const reg = new WorkspaceRegistry(tmpConfigPath(), win); // see Step 3 for the ctor arg
  reg.add("C:\\Users\\G\\Proj");
  reg.add("c:/users/g/proj/");
  expect(reg.list()).toHaveLength(1);
});
```

- [ ] **Step 2: Run them, expect failure**

Run: `npx vitest run tests/child-write-confine.test.ts tests/files.test.ts tests/memory-store.test.ts tests/workspace-model.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1` (memory-store: wrong arity; workspace-model: two entries).

- [ ] **Step 3: Implement**

`hv-child-guard.ts` `escapesWorkspace` (lines 131-138): keep `resolveThroughLinks`, replace the loop's comparison:
```ts
import { containsPath } from "./hv-paths";
// …
const ci = process.platform === "win32";
for (const root of roots) {
  if (containsPath(root, target, ci)) return undefined;
}
return target;
```

`src/main/files.ts` `resolveInWorkspace`:
```ts
import { containsPath } from "../../pi-runtime/extensions/hv-paths";
import { platform } from "./platform";
// …
const ws = path.resolve(workspaceId);
const key = platform.workspaceKey(ws);
if (!registeredWorkspaces.some((w) => platform.workspaceKey(w) === key)) throw new Error("Unknown workspace");
if (path.isAbsolute(relPath)) throw new Error("Path escapes workspace");
const abs = path.resolve(ws, relPath);
if (!containsPath(ws, abs, platform.isWindows)) throw new Error("Path escapes workspace");
return abs;
```
(Check how other `src/main` files import from `pi-runtime/extensions` — `grep -rn "pi-runtime/extensions" src/main | head -3` — and use the same relative form.)

`src/main/store.ts`:
- `normPath` becomes `export const normPath = (p: string): string => platform.workspaceKey(p);` with `import { platform, type Platform } from "./platform";`.
- `WorkspaceRegistry` takes an optional trailing constructor arg `private readonly plat: Platform = platform` and `find`/`remove` compare with `this.plat.workspaceKey(...)` instead of `normPath`. (Read the constructor at `store.ts:578-595` and append the parameter LAST.)

`src/main/memory/store.ts:47-49`:
```ts
export function workspaceMemoryKey(wsPath: string, gitCommonDir: string | null, plat: NodeJS.Platform = process.platform): string {
  const basis = gitCommonDir ? path.dirname(path.resolve(gitCommonDir)) : path.resolve(wsPath);
  // win32: the filesystem is case-insensitive and git answers forward slashes, so
  // `C:\ws` and `c:/ws` must be ONE memory folder (Windows round; the slug below
  // already lower-cased, the key did not).
  const norm = basis.replace(/[\\/]+$/, "");
  const folded = plat === "win32" ? norm.replace(/\//g, "\\").toLowerCase() : norm;
  return crypto.createHash("sha256").update(folded).digest("hex").slice(0, 16);
}
```

`src/main/ipc.ts:4100`: replace `p.replace(/\/+$/, "") === String(ws).replace(/\/+$/, "")` with `platform.workspaceKey(p) === platform.workspaceKey(String(ws))` (import `platform` from `./platform` at the top of ipc.ts if not present). Grep the file for the other `replace(/\/+$/, "")` occurrences and convert each the same way: `grep -n 'replace(/\\/+\$/, "")' src/main/ipc.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/child-write-confine.test.ts tests/files.test.ts tests/memory-store.test.ts tests/workspace-model.test.ts tests/session-delete-children.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-child-guard.ts src/main/files.ts src/main/store.ts src/main/memory/store.ts src/main/ipc.ts tests/child-write-confine.test.ts tests/files.test.ts tests/memory-store.test.ts tests/workspace-model.test.ts
git commit -m "fix(windows): one identity per workspace — registry, memory key and confinement fold case on win32"
```

### Task 10: Renderer platform plumbing (`window.hv.platform`, `agentShell`, `terminalShells`)

**Files:**
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/main/ipc.ts` (two handlers)
- Modify: `src/renderer/src/components/PermissionRulesSection.tsx` (swap the Task 8 stopgap)

- [ ] **Step 1: Expose the platform and two probes**

`src/preload/index.ts` — inside the `hv` object exposed to the renderer add:
```ts
  /** PRD §4 Windows round: the renderer's ONE source of platform truth. */
  platform: process.platform,
  agentShell: () => ipcRenderer.invoke("hv:agent-shell") as Promise<{ shell: "bash" | "powershell"; bashPath: string | null }>,
  terminalShells: () => ipcRenderer.invoke("hv:terminal-shells") as Promise<{ default: string; found: Array<{ label: string; path: string }> }>,
```
`src/renderer/src/hv.d.ts` — add the three members to the `Hv` interface with the same types.
`src/main/ipc.ts` — beside the other `ipcMain.handle` registrations (e.g. next to `hv:voice-mic-status`):
```ts
  ipcMain.handle("hv:agent-shell", () => platform.agentShell());
  ipcMain.handle("hv:terminal-shells", () => ({ default: platform.terminalShell(), found: platform.detectedShells() }));
```
`PermissionRulesSection.tsx`: replace the `navigator.platform` stopgap from Task 8 with `window.hv.platform === "win32"`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/renderer/src/hv.d.ts src/main/ipc.ts src/renderer/src/components/PermissionRulesSection.tsx
git commit -m "feat(windows): the renderer learns the platform and the two shell probes"
```

### Task 11: Agent shell policy — bash if present, PowerShell fallback

**Files:**
- Modify: `src/main/pi/spawn.ts` (`PiSpawnOptions.agentShell`, `--tools`, `HV_AGENT_SHELL`), `src/main/ipc.ts` (`spawnOpts` resolves `platform.agentShell().shell`)
- Modify: `pi-runtime/extensions/hv-rules.ts` (add `SHELL_TOOLS`, `isShellTool`), `happyvibe-bridge.ts:84,1249`, `hv-subagent-boundary.ts:34`, `hv-plan.ts:307`, `hv-readonly.ts` (bash allowlist), `hv-terminal.ts:95-96`
- Modify: `src/renderer/src/toolLabel.ts:243`, `components/ToolCard.tsx:369`
- Test: `tests/agent-shell.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent-shell.test.ts
import { describe, expect, it } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { SHELL_TOOLS, isShellTool } from "../pi-runtime/extensions/hv-rules";
import { WRITE_CAPABLE_TOOLS } from "../pi-runtime/extensions/hv-subagent-boundary";
import { OUTPUT_TOOLS } from "../src/renderer/src/components/ToolCard";
import { toolLabel } from "../src/renderer/src/toolLabel";
import { shellSteerLine } from "../pi-runtime/extensions/hv-terminal";

/**
 * PRD §4 Windows round: the agent's shell is whatever Pi would pick (Git Bash, else
 * PowerShell). On the PowerShell path spawn passes `--tools` naming Pi's `powershell`
 * tool, and every set that names `bash` AS A SHELL names `powershell` too.
 */
const base = { model: { provider: "openrouter", modelId: "x" } };

describe("spawn", () => {
  it("passes no --tools when the shell is bash (Pi's default set stands)", () => {
    const s = resolvePiSpawn({ ...base, agentShell: "bash" }, "/ws", "/rt", "/s");
    expect(s.args).not.toContain("--tools");
    expect(s.env.HV_AGENT_SHELL).toBe("bash");
  });
  it("names Pi's powershell tool instead of bash on the fallback path", () => {
    const s = resolvePiSpawn({ ...base, agentShell: "powershell" }, "/ws", "/rt", "/s");
    const i = s.args.indexOf("--tools");
    expect(i).toBeGreaterThan(0);
    expect(s.args[i + 1]).toBe("read,powershell,edit,write,grep,find,ls");
    expect(s.env.HV_AGENT_SHELL).toBe("powershell");
  });
});

describe("the shell-tool sets", () => {
  it("SHELL_TOOLS is exactly bash + powershell", () => {
    expect([...SHELL_TOOLS].sort()).toEqual(["bash", "powershell"]);
    expect(isShellTool("powershell")).toBe(true);
    expect(isShellTool("terminal_run")).toBe(false);
  });
  it("powershell is write-capable for the §12 boundary and an output tool for the card", () => {
    expect(WRITE_CAPABLE_TOOLS.has("powershell")).toBe(true);
    expect(OUTPUT_TOOLS.has("powershell")).toBe(true);
  });
});

describe("what the user reads", () => {
  it("a powershell call gets a plain headline with the raw command — no grammar in V1", () => {
    const l = toolLabel("powershell", { command: "Get-ChildItem -Recurse | Measure-Object" });
    expect(l.icon).toBe("terminal");
    expect(l.label).toBe("Run a PowerShell command: Get-ChildItem -Recurse | Measure-Object");
  });
  it("the terminal steer line names the shell the session actually has", () => {
    expect(shellSteerLine("bash")).toMatch(/^`bash` runs commands/);
    expect(shellSteerLine("powershell")).toMatch(/^`powershell` runs commands/);
    expect(shellSteerLine("powershell")).not.toContain("bash");
  });
});
```
(Check `toolLabel`'s real signature with `grep -n "^export function toolLabel" src/renderer/src/toolLabel.ts` and adapt the call — it may take `(toolName, args, intent?)`.)

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/agent-shell.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1` (missing exports).

- [ ] **Step 3: Implement**

`hv-rules.ts` — beside `SAFE_TOOLS`:
```ts
/** Pi's shell tools. `bash` everywhere; `powershell` on a Windows box with no Git Bash
 *  (PRD §4 Windows round — spawn passes `--tools` naming it). Any gate that treats
 *  `bash` as "arbitrary shell" must treat both the same, so this set is the ONE list. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);
export const isShellTool = (tool: string): boolean => SHELL_TOOLS.has(tool);
```

`spawn.ts`:
- `PiSpawnOptions` gains `/** PRD §4 Windows round: which shell tool Pi runs. Resolved per spawn by platform.agentShell(). */ agentShell?: "bash" | "powershell";`
- In `args`, after `"--no-themes"`:
  ```ts
  // Windows round: no Git Bash ⇒ Pi's bash tool throws on every call, so hand the
  // model Pi's `powershell` tool instead. Pi's builtins are exactly read/bash/edit/
  // write/grep/find/ls (+powershell); this is the same set with the shell swapped.
  ...(opts.agentShell === "powershell" ? ["--tools", "read,powershell,edit,write,grep,find,ls"] : []),
  ```
- In `env`: `HV_AGENT_SHELL: opts.agentShell ?? "bash",`.

`ipc.ts` — in `spawnOpts` (the object handed to `resolvePiSpawn`), add `agentShell: platform.agentShell().shell,` (re-probed at every spawn — that is what makes "install Git, next session uses it" true).

Bridge and siblings — replace each `=== "bash"` that means "a shell":
- `happyvibe-bridge.ts:84`: `if ((isShellTool(toolName) || toolName === "terminal_run") && typeof input.command === "string")`.
- `happyvibe-bridge.ts:1249`: `builtins.terminal && isShellTool(tool) && …`.
- `hv-subagent-boundary.ts:34`: `new Set(["bash", "powershell", "edit", "write", "multi_edit"])`.
- `hv-plan.ts:307`: `if (isShellTool(toolName)) {`.
- `hv-readonly.ts`: wherever the read-only bash allowlist is keyed on `"bash"` (`grep -n '"bash"\|bash' pi-runtime/extensions/hv-readonly.ts`), key it on `isShellTool(tool)`; the prompt sentence "bash is limited to a read-only allowlist" becomes `` `${shell}` is limited… `` where `shell = process.env.HV_AGENT_SHELL ?? "bash"`.
- `hv-terminal.ts:95`: turn the constant into a function and keep the constant for existing importers:
  ```ts
  export function shellSteerLine(shell: string): string {
    return `\`${shell}\` runs commands that finish on their own; a command that would run indefinitely ` +
      "(a dev server, a watcher) goes to `terminal_run`, so the user can watch it and stop it.";
  }
  export const TERMINAL_STEER_LINE = shellSteerLine(process.env.HV_AGENT_SHELL ?? "bash");
  ```
  In `TERMINAL_TOOL_DESCRIPTIONS`, replace the literal "backgrounding a bash command" and "sleeping in bash" with `` `${SHELL}` `` where `const SHELL = process.env.HV_AGENT_SHELL ?? "bash";` (the settings page shows the same constants through main — main has no `HV_AGENT_SHELL`, so it reads "bash", which is right for the page's purpose; note this in a one-line comment).

Renderer:
- `toolLabel.ts` — add after the `"bash"` case:
  ```ts
  case "powershell": {
    // Windows round: no PowerShell grammar in V1 — the headline IS the command, honest and safe.
    const cmd = str("command");
    return { icon: "terminal", label: cmd ? `Run a PowerShell command: ${cmd.slice(0, 60)}` : "Running a PowerShell command" };
  }
  ```
- `ToolCard.tsx:369` — add `"powershell",` after `"bash",` in `OUTPUT_TOOLS`.

- [ ] **Step 4: Run the tests, the typecheck and the full non-live suite**

Run: `npx vitest run tests/agent-shell.test.ts tests/tool-label.test.ts tests/agent-terminals.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `npm run gate > /tmp/gate.log 2>&1; echo EXIT=$?; tail -8 /tmp/gate.log` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/main/pi/spawn.ts src/main/ipc.ts pi-runtime/extensions/hv-rules.ts pi-runtime/extensions/happyvibe-bridge.ts pi-runtime/extensions/hv-subagent-boundary.ts pi-runtime/extensions/hv-plan.ts pi-runtime/extensions/hv-readonly.ts pi-runtime/extensions/hv-terminal.ts src/renderer/src/toolLabel.ts src/renderer/src/components/ToolCard.tsx tests/agent-shell.test.ts
git commit -m "feat(windows): Git Bash if present, Pi's powershell tool otherwise — one SHELL_TOOLS set everywhere"
```

### Task 12: The onboarding line

**Files:**
- Modify: `src/renderer/src/onboarding.ts` (copy record), `components/OnboardingDialog.tsx` (prop + render), `App.tsx:3851` (pass the probe)
- Test: `tests/onboarding.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/onboarding.test.ts`:
```ts
it("carries the Windows Git line, and the dialog renders it from the record", () => {
  expect(ONBOARDING_COPY.gitForWindows).toMatch(/Install Git for Windows/);
  expect(ONBOARDING_COPY.gitForWindows).toMatch(/sub-agents/);
  const src = fs.readFileSync(path.join(__dirname, "..", "src/renderer/src/components/OnboardingDialog.tsx"), "utf8");
  expect(src).toContain("C.gitForWindows");
  expect(src).toContain('agentShell === "powershell"');
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/onboarding.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1`.

- [ ] **Step 3: Implement**

`onboarding.ts` — add to `ONBOARDING_COPY`:
```ts
  /** Windows round: shown ONLY when the shell probe answers powershell. One line, no
   *  persistence, no nag, never a Banner (§34's pulse decision). */
  gitForWindows:
    "Install Git for Windows for the best experience — HappyVibe will use its shell automatically, and sub-agents need it.",
```
`OnboardingDialog.tsx` — add a prop `agentShell: "bash" | "powershell" | null;` and, in the step-2 block directly under `<p …>{C.step2FreshWhere}</p>`'s parent section (so it is visible on the project step, before "You're in"), render:
```tsx
{agentShell === "powershell" && (
  <p className="text-xs text-ink-soft mt-2">{C.gitForWindows}</p>
)}
```
`App.tsx` — hold `const [agentShell, setAgentShell] = useState<"bash" | "powershell" | null>(null);`, load it once where other `window.hv.*` boot reads happen (`useEffect(() => { void window.hv.agentShell().then((r) => setAgentShell(r.shell)); }, []);`), and pass `agentShell={agentShell}` at line 3851.

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run tests/onboarding.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`; `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/onboarding.ts src/renderer/src/components/OnboardingDialog.tsx src/renderer/src/App.tsx tests/onboarding.test.ts
git commit -m "feat(windows): onboarding says once that Git for Windows is the good path"
```

### Task 13: Terminals — default shell, ConPTY, platform-aware hint

**Files:**
- Modify: `src/main/terminalSettings.ts:157-164`, `src/main/terminals.ts:159`, `src/main/ipc.ts:4110`
- Modify: `src/renderer/src/components/TerminalView.tsx:225-231`
- Test: `tests/terminal-settings.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/terminal-settings.test.ts`:
```ts
import { makePlatform } from "../src/main/platform";

describe("resolveSpawn default shell comes from the platform", () => {
  const win = makePlatform({ platform: "win32", execPath: "x", env: { COMSPEC: "C:\\Windows\\System32\\cmd.exe", PATH: "" }, existsSync: () => false, exec: () => ({ status: 0, stdout: "" }) });
  it("falls back to COMSPEC on a bare win32 box", () => {
    const r = resolveSpawn({ ...DEFAULTS, shellPath: null }, { PATH: "" }, win);
    expect(r.file).toBe("C:\\Windows\\System32\\cmd.exe");
  });
  it("an explicit shellPath still wins", () => {
    const r = resolveSpawn({ ...DEFAULTS, shellPath: "C:\\Git\\bin\\bash.exe" }, {}, win);
    expect(r.file).toBe("C:\\Git\\bin\\bash.exe");
  });
});
```
(`DEFAULTS`/`resolveSpawn` names: match what the file already imports — `grep -n "^import" tests/terminal-settings.test.ts`.)

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/terminal-settings.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1` (`/bin/zsh`).

- [ ] **Step 3: Implement**

`terminalSettings.ts`:
```ts
import { platform, type Platform } from "./platform";
export function resolveSpawn(s: TerminalSettings, env: NodeJS.ProcessEnv, plat: Platform = platform) {
  // …
  file: s.shellPath ?? plat.terminalShell(),
```
(`plat.terminalShell()` reads `$SHELL`/`/bin/zsh`/`/bin/bash`/`pwsh→powershell→COMSPEC` itself; delete the inline `env.SHELL` ternary. Update the doc comment above it: "/bin/zsh is the last resort ON macOS; the platform seam answers the others".)

`terminals.ts:159`: `child = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env, useConpty: true });` and add `useConpty?: boolean` to the local `opts` type at line 123-129. Comment: `// Windows round: ConPTY is the default on Win ≥ 1809; stated because it is load-bearing (winpty renders TUIs wrong).`

`ipc.ts:4110`: `shell: settings.shellPath ?? platform.terminalShell()`.

`TerminalView.tsx:225-231`: load the probe once (`const [shells, setShells] = useState<{ default: string; found: Array<{ label: string; path: string }> } | null>(null); useEffect(() => { void window.hv.terminalShells().then(setShells); }, []);`) and make the row platform-aware:
```tsx
<Row
  label="Shell path"
  hint={
    window.hv.platform === "win32"
      ? `Blank uses ${shells ? path.basename(shells.default) : "PowerShell"}.${shells && shells.found.length ? ` Found: ${shells.found.map((f) => f.label).join(", ")}.` : ""}`
      : `Blank uses $SHELL. ${s.shellPath ? "" : "Currently: your login shell."}`
  }
  field="shellPath"
>
  <input
    value={s.shellPath ?? ""}
    placeholder={window.hv.platform === "win32" ? (shells?.default ?? "PowerShell") : "$SHELL"}
```
(`path.basename` is not available in the renderer — use `shells.default.split(/[\\/]/).pop()`.) The "Shell arguments" hint mentions `-l`; on win32 change it to "Space-separated. Passed to the shell as-is." with the same ternary.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/terminal-settings.test.ts tests/terminals.test.ts tests/feedback-audit.test.ts tests/workspace-model.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`; `npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/main/terminalSettings.ts src/main/terminals.ts src/main/ipc.ts src/renderer/src/components/TerminalView.tsx tests/terminal-settings.test.ts
git commit -m "feat(windows): terminals default to PowerShell on ConPTY, and the shell hint names what was found"
```

### Task 14: `⌘` becomes `modKey()` in every user-visible string

**Files:**
- Create: `src/renderer/src/platformCopy.ts`
- Modify: the `.tsx` files that print `⌘` — `App.tsx`, `ChatView.tsx`, `EditorPane.tsx`, `FeedbackDialog.tsx`, `FileTab.tsx`, `GoTo.tsx`, `Sidebar.tsx`, `TabStrip.tsx`, `TerminalTab.tsx` — and the copy records `feedbackCopy.ts`, `tabs.ts`, `layoutPersist.ts` where the `⌘` is user-visible (comments may stay)
- Test: `tests/mod-key-copy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mod-key-copy.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { modKey } from "../src/renderer/src/platformCopy";

/**
 * Windows round: shortcuts already collapse ⌘/Ctrl to `Mod` (shortcuts.ts), but 16
 * files printed a literal ⌘ in copy. Every user-visible modifier now goes through
 * modKey(); a literal ⌘ in a component or copy record is the drift this test ends.
 * shortcuts.ts (formatBinding's mac branch) and voice/useDictation.ts (already
 * platform-branched) are the two places the glyph legitimately lives.
 */
const SRC = path.join(__dirname, "..", "src", "renderer", "src");
const ALLOW = new Set(["shortcuts.ts", "voice/useDictation.ts", "platformCopy.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("modKey", () => {
  it("is ⌘ on darwin and Ctrl elsewhere", () => {
    expect(modKey("darwin")).toBe("⌘");
    expect(modKey("win32")).toBe("Ctrl");
    expect(modKey("linux")).toBe("Ctrl");
  });
});

describe("no literal ⌘ outside the allowlist", () => {
  it("scans every renderer source file", () => {
    const offenders = walk(SRC)
      .filter((f) => !ALLOW.has(path.relative(SRC, f).replace(/\\/g, "/")))
      .filter((f) => {
        // Strip comments before scanning: an explanatory ⌘ in a comment is fine.
        const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        return code.includes("⌘");
      })
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/mod-key-copy.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; grep -A20 "offenders\|Expected" /tmp/vitest.log | head -30` → the list of files still carrying the glyph.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/platformCopy.ts
/** Windows round: the modifier glyph for copy. Shortcut MATCHING already collapses
 *  ⌘/Ctrl to `Mod` (shortcuts.ts); this is the DISPLAY half. */
export function modKey(platform: string): string {
  return platform === "darwin" ? "⌘" : "Ctrl";
}
/** The running platform's glyph. Guarded so pure tests importing a component never touch window. */
export const MOD: string = modKey(typeof window !== "undefined" && window.hv ? window.hv.platform : "darwin");
export const IS_WINDOWS: boolean = typeof window !== "undefined" && !!window.hv && window.hv.platform === "win32";
```
Then, file by file from the offenders list: replace each user-visible `⌘X` with `` {`${MOD}X`} `` (JSX) or `` `${MOD}X` `` (string), importing `MOD` from `../platformCopy` (or `./platformCopy`). Where a shortcut is shown through `formatBinding(binding, mac)`, pass `mac={window.hv.platform === "darwin"}` instead of the literal `true`. Leave comments alone. Re-run the test after each file until `offenders` is `[]`.

- [ ] **Step 4: Run the test, the renderer typecheck and the copy tests**

Run: `npx vitest run tests/mod-key-copy.test.ts tests/empty-state.test.ts tests/how-it-works.test.ts tests/tabstrip-menu.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`; `npm run typecheck:web > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/platformCopy.ts src/renderer/src tests/mod-key-copy.test.ts
git commit -m "feat(windows): every visible ⌘ becomes modKey(), pinned by a no-literal scan"
```

### Task 15: Microphone status on Windows

**Files:**
- Modify: `src/main/ipc.ts:4176-4192`

- [ ] **Step 1: Widen the three handlers**

```ts
  // §27 + Windows round: Electron answers getMediaAccessStatus on darwin AND win32;
  // the "granted" shortcut stays only for linux, which has no such API.
  const hasMicApi = process.platform === "darwin" || process.platform === "win32";
  ipcMain.handle("hv:voice-mic-status", () =>
    hasMicApi ? systemPreferences.getMediaAccessStatus("microphone") : "granted",
  );
  ipcMain.handle("hv:voice-ask-mic", async () => {
    if (!hasMicApi) return true;
    if (systemPreferences.getMediaAccessStatus("microphone") !== "not-determined") {
      return systemPreferences.getMediaAccessStatus("microphone") === "granted";
    }
    // askForMediaAccess is darwin-only; Windows prompts through its own Settings toggle.
    return process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : false;
  });
  ipcMain.handle("hv:voice-open-mic-settings", () => {
    if (process.platform === "win32") { void shell.openExternal("ms-settings:privacy-microphone"); return; }
    if (process.platform !== "darwin") return;
    // (existing darwin body unchanged)
```
(`shell` is Electron's; check it is already imported in ipc.ts — `grep -n "shell" src/main/ipc.ts | head -3`.)

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck:node > /tmp/tc.log 2>&1; echo EXIT=$?` → `EXIT=0`
```bash
git add src/main/ipc.ts
git commit -m "feat(windows): a privacy-blocked microphone gets the same guidance as on macOS"
```
GUI assertion (Windows, Task 22): Settings → Privacy → Microphone → toggle HappyVibe off → the composer's mic control reads the blocked state and its link opens the Windows Microphone privacy page.

### Task 16: `afterPack` goes per-platform and refuses to succeed silently

**Files:**
- Create: `build/afterPackLayout.mjs`
- Modify: `build/afterPack.mjs`
- Test: `tests/afterpack-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/afterpack-layout.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain ESM, no types
import { longestRelativePath, runtimeDest } from "../build/afterPackLayout.mjs";

/**
 * Windows round: afterPack hardcoded `${productName}.app`, so on win32/linux the
 * pi-runtime/node_modules copy landed in a `.app` folder nobody loads — build green,
 * app cannot spawn Pi. The destination is now derived per platform and pinned here
 * against where process.resourcesPath will point.
 */
const ctx = (electronPlatformName: string) => ({
  appOutDir: electronPlatformName === "darwin" ? "/out/mac-arm64" : "C:\\out\\win-unpacked",
  electronPlatformName,
  packager: { appInfo: { productName: "HappyVibe" } },
});

describe("runtimeDest", () => {
  it("darwin: inside the bundle's Contents/Resources", () => {
    expect(runtimeDest(ctx("darwin"))).toBe("/out/mac-arm64/HappyVibe.app/Contents/Resources/pi-runtime/node_modules");
  });
  it("win32/linux: <appOutDir>/resources", () => {
    expect(runtimeDest(ctx("win32")).replace(/\\/g, "/")).toBe("C:/out/win-unpacked/resources/pi-runtime/node_modules");
    expect(runtimeDest({ ...ctx("linux"), appOutDir: "/out/linux-unpacked" })).toBe("/out/linux-unpacked/resources/pi-runtime/node_modules");
  });
});

describe("longestRelativePath", () => {
  it("returns the deepest file's relative path and length", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lp-"));
    fs.mkdirSync(path.join(dir, "a", "bb", "ccc"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a", "bb", "ccc", "dddd.js"), "");
    fs.writeFileSync(path.join(dir, "x.js"), "");
    const r = longestRelativePath(dir);
    expect(r.rel.replace(/\\/g, "/")).toBe("a/bb/ccc/dddd.js");
    expect(r.length).toBe("a/bb/ccc/dddd.js".length);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/afterpack-layout.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1`.

- [ ] **Step 3: Implement**

```js
// build/afterPackLayout.mjs
// Pure helpers for afterPack.mjs — importable by tests/afterpack-layout.test.ts.
import { readdirSync } from "node:fs";
import path from "node:path";

/** Where pi-runtime/node_modules must land so process.resourcesPath finds it. */
export function runtimeDest(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName === "darwin") {
    const productName = packager.appInfo.productName;
    return path.join(appOutDir, `${productName}.app`, "Contents", "Resources", "pi-runtime", "node_modules");
  }
  // win32 / linux: electron-builder lays resources flat beside the executable.
  return path.join(appOutDir, "resources", "pi-runtime", "node_modules");
}

/** The deepest relative path under `dir` (NSIS long-path budget, spec §2d). */
export function longestRelativePath(dir) {
  let best = { rel: "", length: 0 };
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}${path.sep}${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (r.length > best.length) best = { rel: r, length: r.length };
    }
  };
  walk(dir, "");
  return best;
}

/** Worst-case per-user install prefix on Windows: %LOCALAPPDATA%\Programs\HappyVibe\ for a long username. */
export const WIN_INSTALL_PREFIX_BUDGET = 60;
/** MAX_PATH is 260; keep 20 for the drive, separators and a temp rename. */
export const WIN_PATH_LIMIT = 240;
```

Rewrite `build/afterPack.mjs`'s body (keep the header comment and the darwin re-sign block verbatim):
```js
import { cpSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { longestRelativePath, runtimeDest, WIN_INSTALL_PREFIX_BUDGET, WIN_PATH_LIMIT } from "./afterPackLayout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const src = path.join(__dirname, "..", "pi-runtime", "node_modules");
  const dest = runtimeDest(context);

  console.log(`[afterPack] Copying pi-runtime/node_modules → ${dest}`);
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  // A wrong destination used to succeed silently (Windows round). Prove the copy landed
  // where the app will look, by the ONE file every session needs.
  const probe = path.join(dest, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  if (!existsSync(probe) || !statSync(probe).isFile()) {
    throw new Error(`[afterPack] pi-runtime copy did not land: ${probe} is missing`);
  }

  if (electronPlatformName === "win32") {
    // Spec §2d: measure the long-path risk instead of assuming it.
    const resources = path.join(appOutDir, "resources");
    const longest = longestRelativePath(resources);
    const worst = WIN_INSTALL_PREFIX_BUDGET + "resources\\".length + longest.length;
    console.log(`[afterPack] longest path under resources/: ${longest.length} chars (${longest.rel}); worst-case install ${worst}`);
    if (worst > WIN_PATH_LIMIT) {
      throw new Error(`[afterPack] ${worst} > ${WIN_PATH_LIMIT}: flatten the nested scoped deps (pi-runtime overrides) before shipping`);
    }
  }

  if (electronPlatformName === "darwin") {
    const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
    // (existing re-sign block, unchanged — keep its comment about --entitlements)
  }
  console.log("[afterPack] Done.");
}
```

- [ ] **Step 4: Run the test, then a macOS unpack to prove the darwin path is unchanged**

Run: `npx vitest run tests/afterpack-layout.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run (macOS only): `npm run build:unpack > /tmp/unpack.log 2>&1; echo EXIT=$?; grep afterPack /tmp/unpack.log` → `EXIT=0`, the copy line names `…/HappyVibe.app/Contents/Resources/pi-runtime/node_modules`.

- [ ] **Step 5: Commit**

```bash
git add build/afterPackLayout.mjs build/afterPack.mjs tests/afterpack-layout.test.ts
git commit -m "fix(windows): afterPack lands pi-runtime where each platform looks, and throws when it does not"
```

### Task 17: Portable tests and the pinned skip list

**Files:**
- Modify: the 12 `/tmp` files (`agents-renderer, extension-order-contract, identity-prompt, mcp-spawn, pi-subagents-contract, plugin-screen, session-index, session-manager, skills-spawn, subagent-adversarial, tool-label, workspace-model`), 3 `chmod` files (`describe-command, model-exclusions, session-delete-children`), 2 shebang fixtures (`plugin-scan, skills-discovery`), 6 `/bin/` files (`agent-terminals, plugin-scan, shell-path, skills-discovery, terminals, terminal-settings`), `tests/terminals.test.ts:19`
- Create: `tests/windows-skips.test.ts`

- [ ] **Step 1: Write the pin**

```ts
// tests/windows-skips.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Windows round: a skip is a DECISION with a reason, and this list is the decision.
 * Rule — make the test portable when the code under test is portable; skip only
 * behaviour that is genuinely POSIX (Dock helper, .sh launcher, spawn-helper,
 * chmod bits, login-shell PATH). A new skipIf(win32) anywhere else fails here, the
 * same way live:why pins its own list.
 */
const EXPECTED = new Set([
  "terminals.test.ts",        // spawn-helper is a POSIX prebuild artefact
  "shell-path.test.ts",       // login-shell PATH via `$SHELL -ilc`
  "describe-command.test.ts", // chmod-bit fixtures
  "model-exclusions.test.ts", // chmod-bit unreadable-file fixture
  "session-delete-children.test.ts", // chmod-bit unreadable-dir fixture
  "mcp-spawn.test.ts",        // pi-node.sh exec lines (the .mjs launcher has its own test)
  "files.test.ts",            // the case-insensitive arm runs ONLY on win32 (inverse skip)
]);

describe("win32 skips are pinned", () => {
  it("every file that skips on platform is in the list, and vice versa", () => {
    const dir = __dirname;
    const found = new Set(
      fs.readdirSync(dir)
        .filter((f) => f.endsWith(".test.ts"))
        .filter((f) => /skipIf\(process\.platform [!=]== "win32"\)/.test(fs.readFileSync(path.join(dir, f), "utf8"))),
    );
    expect([...found].sort()).toEqual([...EXPECTED].sort());
  });
  it("each skip carries a reason on the same line", () => {
    for (const f of EXPECTED) {
      const lines = fs.readFileSync(path.join(__dirname, f), "utf8").split("\n");
      for (const l of lines) {
        if (/skipIf\(process\.platform [!=]== "win32"\)/.test(l)) expect(l, `${f}: ${l.trim()}`).toMatch(/\/\/ .{8,}/);
      }
    }
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/windows-skips.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=1` (nothing skips yet except `files.test.ts` from Task 9).

- [ ] **Step 3: Make the tests portable, then add the pinned skips**

For each `/tmp` file: replace `"/tmp/…"` literals with `path.join(os.tmpdir(), "…")` (import `os` if absent). Where the literal is a FIXTURE string that never touches the disk (e.g. a workspace path inside an expected label), keep it but prefer a POSIX-and-Windows-neutral one such as `"/ws/proj"` — do not add `os` for a string that is only compared.

For the 3 `chmod` files and `shell-path.test.ts`: wrap the chmod-dependent `it(...)`s in `it.skipIf(process.platform === "win32")("…", …) // chmod bits do not exist on NTFS` (the comment must sit on the SAME line as `skipIf`, that is what the pin reads).

For `tests/terminals.test.ts:19`: `it.skipIf(process.platform === "win32")("ships an executable spawn-helper for every prebuilt platform", …) // conpty has no spawn-helper`.

For `mcp-spawn.test.ts:78,97`: the two `pi-node.sh` tests stay readable on Windows (they only read the file) — do NOT skip them; instead remove `mcp-spawn.test.ts` from `EXPECTED` above if no other test in that file needs the skip after you read it. Adjust `EXPECTED` to the truth you end with; the point is that the list is written down.

For the shebang fixtures (`plugin-scan`, `skills-discovery`): a `#!/bin/bash` INSIDE a fixture file's contents is data — leave it. Only a fixture that is EXECUTED needs a skip.

For `/bin/` shell paths in `agent-terminals`, `terminals`, `terminal-settings`: spawn `process.platform === "win32" ? process.env.COMSPEC ?? "cmd.exe" : "/bin/sh"` with the matching flag (`/c` vs `-c`); where the test asserts a `/bin/zsh` default, assert against `platform.terminalShell()` instead.

- [ ] **Step 4: Run the pin and the full suite on BOTH platforms**

macOS/WSL: `npm test > /tmp/npmtest.log 2>&1; echo EXIT=$?; tail -6 /tmp/npmtest.log` → `EXIT=0`.
Windows (interop): `cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm test" > /tmp/wintest.log 2>&1; echo EXIT=$?; tail -12 /tmp/wintest.log` → read the red list; every remaining red is either a Windows bug in the code (fix it in a `fix(windows):` commit, with its own test) or a POSIX-only behaviour (add it to `EXPECTED` with its reason). Record the before/after counts in `docs/validation/win1.md` `## M1 — npm test on Windows`.

- [ ] **Step 5: Commit**

```bash
git add tests
git commit -m "test(windows): the suite is portable, and every win32 skip is a listed decision"
```

### Task 18: M1 exit — the app runs on Windows (measured)

**Files:**
- Create/extend: `docs/validation/win1.md`

- [ ] **Step 1: Install and boot natively (interop)**

```bash
cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm ci && cd pi-runtime && npm ci" > /tmp/wininstall.log 2>&1; echo EXIT=$?
cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm run build" > /tmp/winbuild.log 2>&1; echo EXIT=$?
```
Then start the app in the background: `cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm run dev" > /tmp/windev.log 2>&1` with `run_in_background: true`. Use `/uicheck` for screenshots where it works on Windows; otherwise the user drives and reports.

- [ ] **Step 2: Perform the M1 exit test and record each line in `docs/validation/win1.md`**

1. Open a session in a workspace under `C:\Users\…`; send "list the files in this folder". Assert: a `bash` (Git Bash installed) tool card appears, the permission modal shows the raw command, the audit log has the row.
2. Temporarily rename `C:\Program Files\Git\bin\bash.exe` → `bash.exe.off`, start a NEW session, send the same prompt. Assert: a `powershell` card with the headline "Run a PowerShell command: …", `HV_AGENT_SHELL=powershell` visible in `docs`-style probe (`[pi:stderr]` or the tool list on the Tools page shows `powershell` and NOT `bash`). Restore the file.
3. Delegate: "use the worker sub-agent to count the .ts files". Assert: the delegation card appears, the child's tool calls show in the audit log with `source:"child"` (the child guard loaded through `pi-child.mjs`), and `status.json` under the session dir names `pid` = the session's Pi.
4. Hibernate/reload: trigger an MCP live-reload (toggle a server) while a `sleep 60` bash command runs. Assert with `tasklist /FI "IMAGENAME eq bash.exe"` (via `cmd.exe /c`) that no `bash.exe` from that session survives the respawn.
5. Open a terminal tab. Assert: PowerShell prompt, title polls to `powershell`/`pwsh`, `sleep 5` in it is rendered by ConPTY (no garbled escape codes).
6. Write a `src/**` deny rule in Permissions; ask the agent to create `src\probe.txt`. Assert: denied by RULE (audit `source:"rule"`), not by default ask.

Record every assertion with what was actually observed. A failed line is a `fix(windows):` commit before M1 is called done.

- [ ] **Step 3: Commit the measurements**

```bash
git add docs/validation/win1.md
git commit -m "docs(windows): M1 exit — what a Windows session actually did"
```

---

## Phase M3 — installer

### Task 19: The `win` block, x64 NSIS

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add the block**

Append after the `mac:` block:
```yaml
# Windows round (2026-09-13). x64 ONLY: sherpa-onnx has no win-arm64 build and anydoc
# has none; arm64 machines run this installer under emulation (PRD §4/§31).
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  artifactName: HappyVibe-${version}-Setup.${ext}
nsis:
  oneClick: false
  perMachine: false                 # per-user, no UAC — keeps the unsigned path bearable
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false   # sessions/audit/memory are the user's data
```

- [ ] **Step 2: Build on Windows and install on a clean box**

`cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm run build:win" > /tmp/winpack.log 2>&1; echo EXIT=$?; grep -E "afterPack|Setup" /tmp/winpack.log` → `EXIT=0`, the `[afterPack] longest path …` line (record the number in `win1.md` §2d), `release/HappyVibe-<version>-Setup.exe` exists.
Install it on a clean Windows VM (or a fresh local user) with **no Git and no Node**; run M1 exit lines 1 (expect the `powershell` card), 3 (expect the delegation to FAIL with the child's "No bash shell found" surfaced, and the onboarding Git line having been shown), 5 and 6. Record in `win1.md` `## M3 — clean install`.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml docs/validation/win1.md
git commit -m "build(windows): NSIS x64 installer, per-user, keeps the user's data"
```

### Task 20: Signing — one env var away

**Files:**
- Create: `build/win-build.mjs`
- Modify: `package.json` (`build:win`)
- Test: `tests/win-build-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/win-build-config.test.ts
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM
import { winBuildConfig } from "../build/win-build.mjs";

/** Spec §2c: the yml carries no identity; HV_WIN_SIGN=azure injects Azure Trusted
 *  Signing from env, absent ⇒ unsigned and SAID so. Decision on signing is taken
 *  before the first public Windows download (PRD §4). */
describe("winBuildConfig", () => {
  it("is unsigned with no env, and says so", () => {
    const r = winBuildConfig({});
    expect(r.config.win?.azureSignOptions).toBeUndefined();
    expect(r.note).toMatch(/unsigned/i);
  });
  it("adds azureSignOptions from the four AZURE_* vars when HV_WIN_SIGN=azure", () => {
    const r = winBuildConfig({
      HV_WIN_SIGN: "azure",
      AZURE_SIGN_ENDPOINT: "https://weu.codesigning.azure.net",
      AZURE_SIGN_ACCOUNT: "hv-account",
      AZURE_SIGN_PROFILE: "hv-profile",
      AZURE_SIGN_PUBLISHER: "CN=HappyVibe",
    });
    expect(r.config.win?.azureSignOptions).toEqual({
      endpoint: "https://weu.codesigning.azure.net",
      codeSigningAccountName: "hv-account",
      certificateProfileName: "hv-profile",
      publisherName: "CN=HappyVibe",
    });
  });
  it("refuses a half-configured signing request rather than shipping unsigned by accident", () => {
    expect(() => winBuildConfig({ HV_WIN_SIGN: "azure" })).toThrow(/AZURE_SIGN_ENDPOINT/);
  });
});
```

- [ ] **Step 2: Run it, expect failure** → `EXIT=1` (module missing).

- [ ] **Step 3: Implement**

```js
// build/win-build.mjs
// `npm run build:win`. Reads electron-builder.yml, adds Azure Trusted Signing ONLY
// when HV_WIN_SIGN=azure (electron-builder 26 supports it natively as
// win.azureSignOptions), otherwise builds unsigned and prints one line saying so.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function winBuildConfig(env) {
  const config = parse(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));
  if (env.HV_WIN_SIGN !== "azure") {
    return { config, note: "[build:win] UNSIGNED build — set HV_WIN_SIGN=azure (+ AZURE_SIGN_*) to sign. SmartScreen will warn." };
  }
  const need = ["AZURE_SIGN_ENDPOINT", "AZURE_SIGN_ACCOUNT", "AZURE_SIGN_PROFILE", "AZURE_SIGN_PUBLISHER"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`[build:win] HV_WIN_SIGN=azure but missing ${missing.join(", ")}`);
  config.win = {
    ...(config.win ?? {}),
    azureSignOptions: {
      endpoint: env.AZURE_SIGN_ENDPOINT,
      codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
      certificateProfileName: env.AZURE_SIGN_PROFILE,
      publisherName: env.AZURE_SIGN_PUBLISHER,
    },
  };
  return { config, note: "[build:win] signing with Azure Trusted Signing" };
}

async function main() {
  const { config, note } = winBuildConfig(process.env);
  console.log(note);
  const { build, Platform } = await import("electron-builder");
  await build({ targets: Platform.WINDOWS.createTarget(), config });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```
`package.json`: `"build:win": "npm run build && node build/win-build.mjs"`. (`yaml` is already a root dependency, pinned to Pi's version — reuse it, add nothing.)

- [ ] **Step 4: Run the test; rebuild once on Windows to prove the programmatic path produces the same Setup.exe**

`npx vitest run tests/win-build-config.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?` → `EXIT=0`
`cmd.exe /c "cd /d C:\Users\Guiguito\Documents\GitHub\HappyVibe && npm run build:win" > /tmp/winpack2.log 2>&1; echo EXIT=$?; grep -E "UNSIGNED|Setup" /tmp/winpack2.log` → `EXIT=0`, the UNSIGNED line, the artefact.

- [ ] **Step 5: Add the SmartScreen paragraph to `README.md`** under a new `## Windows` heading:

> HappyVibe for Windows is x64 and installs per-user (no admin prompt). Until the build is code-signed, SmartScreen shows "Windows protected your PC" on first run: click **More info → Run anyway**. Git for Windows is optional but recommended — the agent uses its shell when present, and sub-agents need it.

- [ ] **Step 6: Commit**

```bash
git add build/win-build.mjs package.json tests/win-build-config.test.ts README.md
git commit -m "build(windows): signing is one env var away; unsigned builds say so"
```

---

## Phase M2 — parity walk (GUI pass, findings folded as they arrive)

### Task 21: Walk §7–§35 on Windows

**Files:** whatever each finding touches; `docs/validation/win1.md` `## M2 — parity walk` (one line per §, observed).

- [ ] For each PRD section with a screen, perform the observable claims in **Verification** below on the Windows build. Every finding becomes a `fix(windows):` commit with its own test where a key-free test can express it; a finding that needs a Windows box to reproduce is recorded in `win1.md` with the repro.
- [ ] When the walk is clean, flip CI: remove `continue-on-error: true` from `test-windows` in `.github/workflows/ci.yml`; commit `ci(windows): the Windows job is required`.

### Task 22: CLAUDE.md — the Windows section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add, under `## Commands`, a `### Windows` block** carrying (in this file's voice): the dev-topology rule and the interop one-liners from Global Constraints; "never install from WSL" with the `ls node_modules/electron/dist` tell; `platform.ts` is the ONE seam and `process.platform` in `src/main` outside it is a review red; `hv-paths.ts` is import-free and shared; `SHELL_TOOLS` is the one list; `pi-child.mjs` and the upstream `.mjs` rule with its contract pin; `taskkill /T /F` with the measured no-grace reasoning; `windows-skips.test.ts` pins skips; the long-path number from `win1.md`; the Notion page id and `docs/validation/win1.md` as the record.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(windows): the Windows section — topology, seam, and the traps already paid for"
```

---

## Verification

### Gates
- `npm run gate` green on macOS after every task; `npm run live:why` prints ⇒ `npm run test:live` (backgrounded, ~6 min, wall time read) once at the end of M1 and once at the end of M3.
- `cmd.exe /c "… && npm test"` and `… npm run build` green on Windows from Task 17 on; the `test-windows` CI job green from Task 21.
- `npm run typecheck` is run BY `build`; never separately before `gate`.

### Observable GUI assertions (Windows build, `npm run dev` and the installed Setup.exe)

| Surface | Claim | Absence assertion |
|---|---|---|
| Onboarding (fresh profile, no Git) | Step 2 shows the line "Install Git for Windows for the best experience … sub-agents need it." | With Git installed, the line is **absent**. It is never a `Banner` and never re-shown after onboarding. |
| Chat, a session with Git Bash | The first shell call is a `bash` card; the permission modal shows the raw command. | No `powershell` tool on the Tools page for this session. |
| Chat, a session without Git Bash | The card headline reads "Run a PowerShell command: <cmd>". | `bash` is **absent** from the Tools page for this session; no card ever reads "Running a command" with an error body "No bash shell found". |
| Permissions page | A `src/**` deny rule blocks a write to `src\probe.txt`; the audit row reads `source: rule`. | No row with `source: default` for that call. |
| Terminal tab | Opens on PowerShell (or pwsh), title polls to the shell name; Settings → Terminal → Shell path placeholder names it and the hint lists "Found: …". | The hint never says `$SHELL`; the `-l` sentence is **absent** on Windows. |
| Delegation card | A `worker` delegation runs; its child calls appear in the audit log with `source: child`. | Without Git: the run fails and the child's "No bash shell found" reaches the card as text — never a silent empty result. |
| Audit log after an MCP live-reload during `sleep 60` | The session respawned; `tasklist` shows no orphaned `bash.exe`. | No `pi-coding-agent` process older than the app in `tasklist` after a relaunch (sweepOrphans works). |
| Shortcuts page + every `⌘` copy site | Every shortcut reads `Ctrl-…`. | The glyph `⌘` is **absent** from every rendered string (spot-check Sidebar tooltips, TabStrip, GoTo, FeedbackDialog). |
| Voice (composer mic control) | With the Windows mic privacy toggle OFF, the control reads blocked and its link opens `ms-settings:privacy-microphone`. | It never reports "granted" while the OS denies. |
| Documents (§31) | Dropping a `.docx` converts (x64 anydoc prebuilt). | No "not available on this platform" row on x64. |
| Installer | `HappyVibe-<v>-Setup.exe` installs per-user under `%LOCALAPPDATA%\Programs\HappyVibe`; uninstall keeps `%APPDATA%\HappyVibe`. | No UAC prompt; no `HappyVibe.app` folder anywhere under `resources`. |

### The regression this design risks (perform as a sequence)
1. Start a session with Git Bash installed → a `bash` card appears.
2. Rename `bash.exe` away; start a SECOND session in the same workspace → a `powershell` card appears **and the first session keeps using `bash`** (the probe is per spawn, not global).
3. Trigger an MCP live-reload → the first session respawns and now shows `powershell` (re-probed), with its transcript intact.
4. Restore `bash.exe`; reload again → back to `bash`. No session shows both tools at once; no card is stuck on "running".

### Live-Pi
- `tests/child-guard-bridge.test.ts`, `rules-bridge.test.ts`, `agents-bridge.test.ts`, `mcp-spawn`-adjacent live files run in the macOS live batch; nothing in this plan changes their macOS behaviour, so a red there is a regression, not a Windows finding — re-run in isolation after `pgrep -fl "npm run dev"`.
