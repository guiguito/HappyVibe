# win1 — Windows, measured

PRD §4 (Windows round, 2026-09-13/14). Machine: Windows 11, Node 24.21.0, npm 11.19.0,
Git for Windows 2.51 with Git Bash at `C:\Program Files\Git\bin\bash.exe`. Repo on the
C: drive, edited from WSL, installed and run natively.

Everything below is a number that was taken, not one that was expected.

## The dev topology, and one trap in it

One checkout, installed only from Windows. A single `node_modules` cannot serve both
OSes (the Electron binary, `sherpa-onnx-*`, `@typescript/native` and rollup are
per-platform), so nothing is ever installed from WSL.

**The trap that cost the most:** `cmd.exe /c "a && b" | tail` reports **tail's** exit
code, so a failed install read as success. That is CLAUDE.md's own "never pipe a test
run to tail" rule, in a place it had not been written down. Redirect, then read `$?`.

A second one, cheaper but constant: nested quotes through WSL → `cmd.exe` are mangled.
`if exist "C:\Program Files\..."` answered NO for a directory that exists. Anything
with inner quotes goes in a `.bat` or a `.mjs` file, never inline.

## What was already true, and what was not

The checkout itself was a **CRLF working tree** — 759 of 780 tracked files — because a
Windows git had checked it out. Invisible on macOS, because `text=auto` strips the CR
again on commit; it would have made every source-scanning test fail for a reason that
is not the code. Three binary fixtures had additionally been round-tripped through
that normalisation (`sample.rtf` differed from HEAD by its 176 CRs).

`npm ci` failed outright: `electron-builder install-app-deps` asked @electron/rebuild
to prepare node-pty and hit **"Could not find any Visual Studio installation to use"**.
It was insuring nothing — node-pty 1.1.0 is N-API and sherpa resolves a prebuilt
sibling package — and both load with the rebuild gone.

## The suite

| run | files | tests | failed | wall |
|---|---|---|---|---|
| first (after the install was fixed) | 315 | 3840 | **59** | 31 s |
| after the seam, launcher, lifecycle | 320 | 3921 | 58 | 30 s |
| after terminals | 320 | 3924 | 39 | 29 s |
| after documents + git + fixtures | 320 | 3930 | 6 | 31 s |
| green | 324 | 3964 | **0** | 31 s |

`npm run build` green. 61 skipped, of which 11 are the platform/capability gates listed
in `tests/windows-skips.test.ts`.

**One root cause cleared 16 of those failures.** Node's ESM loader refuses an absolute
Windows path — *"absolute paths must be valid file:// URLs. Received protocol 'c:'"* —
so every `await import(<abs>)` in a sidecar failed. The anydoc sidecar's catch reported
that as `unavailable`, whose comment says "Windows arm64 has no prebuilt", so Documents
was diagnosed as a missing platform build on an x64 machine with the prebuilt package
installed.

## pty.process cannot name a foreground command on Windows

Measured in a real Electron process, not inferred:

```
idle  process = "xterm-256color"
busy  process = "xterm-256color"     (after `sleep 5`)
```

`WindowsTerminal.process` is literally `return this._name` — the `name` option we pass
at spawn. Believed, it titles every tab "xterm-256color" AND makes `foreground()` never
return null, so the close confirm always warns and the agent can never reuse a
terminal, filling its cap of 3 permanently.

There is no second source. Walking the Win32 process tree:

```
pty.pid = 30632          (the ConPTY host)
IDLE  descendants: ["bash.exe"]        972 ms
BUSY  descendants: ["bash.exe"]        898 ms   ← `sleep 5` is running
```

The process count rose by one while busy, so the command exists — it just never
appears as a descendant, because MSYS re-parents. At ~900 ms a query it could not have
been polled anyway. So the tab follows the SHELL name there and "is something running"
is unanswerable; both degrade to a quieter UI rather than a wrong one, and
`tests/agent-terminals.test.ts` asserts BOTH arms rather than skipping.

## A dying pty could take main down

`write EAGAIN`, thrown asynchronously from the socket's completion callback when a
write races a closing ConPTY. node-pty guards its OUTPUT socket and rethrows everything
else; writes go to `_agent.inSocket`, a **different socket object** (measured:
`inSocket === _socket` is false) with no handler at all. Uncaught in MAIN, that is the
whole app going down because a terminal nobody was watching went away.

## The installer

```
[afterPack] longest path under resources/: 190 chars
  pi-runtime\node_modules\@earendil-works\pi-coding-agent\node_modules\@aws-sdk\core\
  dist-types\ts3.4\submodules\client\middleware-recursion-detection\
  recursionDetectionMiddleware.browser.d.ts
```

63 of 32,199 files were over budget; **49 were `dist-types`** — TypeScript declarations,
reached only through a package's `types` field and never by `main` or `module`.
Dropping them removes 3,056 files and 4.3 MB and takes the longest path to **180**,
which is what brings a real install inside MAX_PATH. The remaining 14 deep files are
AWS SDK ESM modules — real runtime code, left alone.

Result: `release/HappyVibe-0.1.0-Setup.exe`, 309 MB, 342 s, unsigned.

Residual, recorded rather than fixed: the budget is `63 + 10 + 180 = 253` against a
255 limit. The next dependency that adds a deep file trips the check — which is what
it is for. The real fix at that point is flattening the nested `@aws-sdk`/`@smithy`
(pi-coding-agent pins 3.974.11 nested while the top level has 3.977.9), and that is a
decision about what Pi ships with, not a packaging tweak.

## M1 exit test — driven in the running app

Over CDP (`HV_DEBUG_PORT=9222`), against the real window:

| step | observed |
|---|---|
| Session opens, model answers | DeepSeek V4 Flash, cost chip `$0.0023`, context `2%` |
| Shell call is gated | permission modal, DETAILS reads `bash pwd` |
| Git Bash chosen | `/c/Users/Guiguito/Documents/HappyVibe/winprobe` |
| Title one-shot | session renamed "Print current directory via shell" |
| Delegation | §12 boundary modal: "worker may use: bash, edit, find, grep, ls, read, write" |
| **Child guard loaded** | audit rows `source: "subagent"` — `bash` deny ×2, `ls` allow ×2, `find` deny |
| Terminal | PowerShell starts in the workspace, `echo` runs, stays running |

The child-guard rows are the important line: they only exist if `pi-child.mjs` ran and
injected `hv-child-guard.ts`, which is the whole reason that file exists.

## What the GUI pass found that the suite could not

Three, all of which photograph perfectly:

1. **"A folder on your Mac"** in onboarding, plus nine more strings naming macOS,
   Finder or "this Mac".
2. **The sidebar showed `C:\Users\Guiguito\Documents\HappyVibe\winprobe`** where it
   meant `winprobe` — fifteen renderer sites derived a basename with `split("/")`.
3. **The terminal died at spawn**: default shell arguments were `["-l"]`, and
   PowerShell answers *"The term '-l' is not recognized as the name of a cmdlet"*,
   exit 1.

## Not verified here

macOS CI on this branch. The repo is private and this machine has no API token for it,
so the macOS half of the gate — in particular removing `install-app-deps` from
`postinstall` and the `npmRebuild: false` flag — is checked by the existing
`runs-on: macos-latest` job and has not been read back.
