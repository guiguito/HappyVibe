---
paths:
  - "src/main/{terminals,agentTerminals,terminalSettings,shellPath}.ts"
  - "pi-runtime/extensions/hv-terminal.ts"
  - "src/renderer/src/{monospaceFonts,terminalTheme}.ts"
  - "src/renderer/src/components/Terminal*.tsx"
  - "scripts/fix-pty-helper.mjs"
  - "tests/{terminal,agent-terminal}*.test.ts"
  - "tests/shellFixture.ts"
---
# Terminals (§26)

## PTYs
- PTYs are owned by MAIN, so they outlive a renderer reload. Scrollback is an `@xterm/headless`
  mirror — one buffer, three readers: the live renderer (raw bytes), a re-attaching renderer
  (`addon-serialize`, correct even mid-TUI), and the agent (`readText`, the rendered grid as text).
- `node-pty`'s `spawn-helper` arrives from npm without its exec bit, and every `pty.spawn` then fails
  with `posix_spawnp failed.` `scripts/fix-pty-helper.mjs` chmods it at postinstall; the first test
  in `tests/terminals.test.ts` pins it. node-pty ships N-API prebuilds (darwin/win32), so there is
  no electron-rebuild step and tests CAN spawn a real PTY.
- The tab title is POLLED (`TITLE_POLL_MS`): `pty.process` changes with no data event (`sleep 30`
  prints nothing).
- Never compare `pty.process` raw — `processName()` normalizes at the one point `titleOf` and
  `foreground` both pass through. macOS reports a name (`bash`), Linux a PATH for the shell
  (`/bin/bash`) but a bare name for a typed command, and a login shell has a leading `-`.
- Windows: `pty.process` is the constant `"xterm-256color"`, so `FOREGROUND_SUPPORTED` is off there
  (no second source exists — MSYS re-parents Git Bash commands). Attach an error listener to
  `_agent.inSocket`: node-pty rethrows socket errors, and a write racing a dying ConPTY is an
  uncaught `write EAGAIN` that kills MAIN.
- A bad shell path does NOT throw from `pty.spawn` — the helper spawns and the exec fails inside,
  arriving as an immediate non-zero exit; both routes land in `fail()`. On Linux the helper also
  writes `execvp(3) failed.: …` INTO the pty, so `onExit` matches `EXEC_FAILED`, not just `!sawData`.
- If the whole terminal suite goes red on a new platform, check the SHELL first:
  `tests/shellFixture.ts` picks zsh on macOS and bash elsewhere, and derives the rc-skip flag
  (`-f` / `--norc`) from the shell, never the platform.

## Agent terminals
- `terminal_run`/`terminal_read`/`terminal_kill` are thin shells over ONE blocking envelope
  (`hv.terminal-*`, payload in `title`). `agentTerminals.ts` owns the rules: session→terminal claims,
  the soft cap of 3, busy-reuse refusal, interleave hold. `TerminalManager` stays session-ignorant —
  ending a session releases a claim, never kills a PTY.
- The card notify carries its payload in `message` (in `title` the card silently never appears).
- `tool_execution_start` fires BEFORE tool_call handlers, so it can never prove a call was blocked —
  assert on the `hv.audit` `source:"terminal"` envelope.
- All three tools are named in `SAFE_TOOLS`/`gatePlanCall`, with `terminal_read` in `PLAN_PASS_TOOLS`.
- The rail's `TerminalTail` reads `window.hv.termText` (main's rendered grid), never raw PTY bytes.

## Font picker (`monospaceFonts.ts`)
- `queryLocalFonts()` needs no permission but throws `SecurityError: Page needs to be visible` on a
  backgrounded window — hence the `PROBE_FAMILIES` fallback and enumeration from the settings page,
  not at boot.
- Monospace-ness (`i`/`l`/`W` widths) and presence (vs two fallbacks) are MEASURED. `SF Mono` never
  resolves from a web context. `SYMBOL_FAMILIES` excludes fixed-width pictogram fonts (Wingdings).
- Keep the per-row preview — never simplify to a plain list. `fontFamily` stores a family NAME;
  `normalizeFamily` is the migration from the old CSS stack; `fontStack` appends
  `ui-monospace, monospace` so a missing font degrades to a monospace.
