# HappyVibe

**Good vibes, real code.**

Everything set up. Nothing happens behind your back.

---

A desktop app for coding with AI, where everything is already set up and you can see everything it does.

Terminals, a browser, documents, git, schedules, sub-agents, MCP and skills are wired and ready — no
plugins to hunt down, no config to write, no restart. Bring any model, including a local one. And
nothing loads itself until you say yes to that specific thing.

> **Status:** pre-1.0 and moving fast. macOS and Windows ship today; Linux is coming.

## What it does

**Everything is already here.** A chat that streams, with tool cards and real diffs. A file tree and
editor. Terminals you drive and terminals the agent drives. An embedded browser the agent can read
and click. PDFs and Office documents converted on-device. A git panel that speaks human on top and
real git underneath. Scheduled runs. Sub-agents. Memory.

**Any model, including your own.** 29 providers covering over a thousand models, six one-click
sign-ins, and Ollama / LM Studio / llama.cpp detected automatically. Keys live in your OS keychain.
Nothing leaves your machine that you did not send.

**Nothing happens behind your back.** Every command is shown before it runs, in plain language.
Nothing auto-loads — no skill, extension, prompt template or theme enters a session until you
approve that specific resource. You can read the system prompt on a settings page. Every model call
the app makes on your behalf is itemised.

**And the description you approve is written by the app, never by the model.** Model-authored
narration goes in the activity feed; the approval dialog shows an app-derived description of what
is actually about to happen. That split is the one thing here no other tool ships as a stated rule.

## Install

Download the latest release for macOS or Windows.

**macOS:** the app is ad-hoc signed and not yet notarized, so Gatekeeper blocks the first launch.
Either right-click → **Open** → **Open**, or clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/HappyVibe.app
```

Without it you will see *"HappyVibe is damaged and can't be opened"* — that is Gatekeeper on an
un-notarized app, not a broken download.

**Windows:** a per-user NSIS installer, also unsigned for now, so SmartScreen shows a warning on
first run.

## Run from source

```bash
npm install
cd pi-runtime && npm ci && cd ..   # BOTH installs are required
npm run dev
```

`pi-runtime/` is a separate vendored tree; a fresh clone without its install will fail in
confusing ways. No system Node is needed at runtime — the app routes child processes through its
own bundled Electron helper.

```bash
npm test      # the non-live suite — 327 files, ~3,900 tests, ~40 s. Never makes a model call.
npm run gate  # typecheck + build + the non-live suite, one command
npm run build:mac / build:win
```

Set a key from the app's own Models page, or drop one in `.env` for development.

## How it is built

An Electron app driving a **pinned, vendored** [Pi coding agent](https://pi.dev) as a subprocess
over its JSON-lines RPC protocol. Pi is never imported as a library — process isolation is
load-bearing for crash isolation and session hibernation, and the RPC protocol is the only coupling
surface.

```
Electron renderer (React + TS + Vite)     src/renderer/
   ↕ typed IPC (contextBridge, window.hv)  src/preload/
Electron main                              src/main/
   pi/{spawn,codec,PiClient}.ts            electron-free, so tests can import them
   ↕ stdio, Pi RPC
Pi subprocess (vendored, pinned)           pi-runtime/
   extensions/happyvibe-bridge.ts          the permission gate + 30 registered tools
```

The five runtime pins move deliberately, together with their contract tests:

| | |
|---|---|
| `@earendil-works/pi-coding-agent` | `0.85.0` |
| `pi-subagents` | `0.64.0` |
| `pi-mcp-adapter` | `2.32.1` |
| `@firecrawl/anydoc` | `0.2.4` |
| `@earendil-works/pi-server` | `0.85.0` |

**The bridge owns all permission UI.** Pi's own permission package is TUI-only — every prompt path
gates on `ctx.hasUI`, which is false in RPC mode — so the gate, the audit log and every approval
dialog are HappyVibe's. Evidence is in [`docs/validation/`](docs/validation/), which is also where
wire shapes get recorded before anything depends on them.

**Resources are deny-by-default.** The Pi subprocess is spawned with `--no-skills --no-extensions
--no-prompt-templates --no-themes`; approved resources are then passed back in explicitly. `bash` is
the one filesystem writer that is not path-confined, which is exactly why an unapproved extension
must never be able to load.

## Honest limitations

- **Nothing is signed yet.** One extra click on first launch, on both platforms.
- **Linux is not configured yet**, though it is committed.
- **The Windows build is x64 only.** `sherpa-onnx` (voice) and `@firecrawl/anydoc` (documents)
  publish no win-arm64 binary, so arm64 machines run the x64 installer under emulation.
- **The cost meter is an estimate**, computed from a price table pinned at the vendored Pi version.
  It says `unknown` rather than `$0.00` when it cannot price a call — but a provider that prices
  only part of a call is reported as a floor, marked `+`.
- **It is not a sandbox** and does not claim to be. The gate is an in-process extension. It asks
  before it acts; it is not a security boundary.

## Docs

- [`docs/prd.md`](docs/prd.md) — the product spec, decisions folded in place
- [`docs/validation/`](docs/validation/) — measurements and wire shapes, including the negative results
- [`CHANGELOG.md`](CHANGELOG.md) — what changed, in user terms
- [`CLAUDE.md`](CLAUDE.md) — the working notes an agent needs to change this repo safely
