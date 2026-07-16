# HappyVibe Spike — Walking Skeleton

A minimal Electron app embedding the [Pi coding agent](https://pi.dev), built to validate the HappyVibe stack end-to-end. **Feasibility confirmed 2026-07-03** — see [`docs/validation/RESULTS.md`](docs/validation/RESULTS.md) for the full V1–V7 gate results.

> Product context: HappyVibe PRD + Spike PRD live in Notion (HappyVibe workspace). This repo is the walking skeleton HappyVibe V1 grows from: the **UI is disposable**, the **architecture underneath is built to keep**.

## What was proven

- **A desktop UI can drive an embedded, pinned Pi over its RPC protocol** (spawn, stream, tool events, session stats) — Gates V1/V2/V3.
- **A bundled bridge extension can gate tool calls with UI approval** over Pi's native `extension_ui_request`/`extension_ui_response` sub-protocol ("Path A" — no custom IPC sidecar needed) — Gates V4/V5. Deny blocks the tool call with a real model (`deepseek-v4-flash`); the agent continues gracefully.
- **True embedding**: a packaged unsigned `.app` runs its bundled Pi runtime — Gate V7.
- **Key negative finding (V6)**: `@gotgenes/pi-permission-system` is TUI-only (all prompt paths gate on `ctx.hasUI`, which is `false` in `--mode rpc`). **The HappyVibe bridge owns all permission UI in RPC mode.** See [`docs/validation/v6.md`](docs/validation/v6.md).

## Architecture

```
┌─ Electron renderer (React + TS + Vite)      src/renderer/   ← disposable
│      ↕ typed IPC (contextBridge, window.hv)  src/preload/
├─ Electron main                                src/main/
│    config.ts     API key (.env in dev, safeStorage otherwise)
│    ipc.ts        session lifecycle + event forwarding
│    pi/PiClient   ← KEEP: JSON-lines RPC client (spawn, correlate, events)
│    pi/spawn.ts   ← KEEP: electron-free spawn spec (vitest-importable)
│    pi/codec.ts   ← KEEP: NDJSON decoder (buffers partials, skips garbage)
│    pi/runtimeDir electron-only dev/packaged path resolution
│      ↕ stdio (Pi RPC protocol)
└─ Pi subprocess (vendored, pinned)             pi-runtime/
     @earendil-works/pi-coding-agent@0.80.3 (exact pin)
     extensions/happyvibe-bridge.ts ← KEEP: tool_call gate → ctx.ui.select
```

Rules that keep this sound:

- Pi is **always a subprocess** (spawned via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`), never imported as a library. The RPC protocol is the coupling surface.
- `src/main/pi/{codec,spawn,PiClient,types}.ts` are **electron-free** so Vitest can import them.
- Permission wire shapes (empirically proven, see [`docs/validation/d1.md`](docs/validation/d1.md)): `confirm` responses use `confirmed: boolean`; `select` responses use `value: string`. The renderer only routes `method === "select"` requests to the permission modal (fire-and-forget `setStatus` etc. would crash it otherwise).
- Permission prompts never auto-allow and never time out.

## Run it

```bash
npm install
cd pi-runtime && npm ci && cd ..       # restores the pinned Pi runtime
echo 'DEEPSEEK_API_KEY=sk-...' > .env  # gitignored; BYOK (DeepSeek)
npm run dev
```

Flow: setup screen is auto-skipped when `.env` has a key → pick a project folder → chat. Ask for a change; tool calls show as cards; shell commands raise the Allow / Allow for session / Deny modal.

```bash
npm test           # 11 unit/integration tests; bridge + coexistence tests
                   # make real DeepSeek calls when DEEPSEEK_API_KEY is set,
                   # and skip cleanly otherwise
npm run package    # unsigned .app in release/mac-arm64/ (bundles pi-runtime
                   # via build/afterPack.mjs — electron-builder drops
                   # node_modules on its own)
npm run build:mac  # installable .dmg in release/ (ad-hoc re-signed)
```

## Installing the .dmg (macOS)

The app is **ad-hoc signed, not notarized** by Apple. After dragging it to
Applications, macOS Gatekeeper blocks it. Clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/HappyVibe.app
```

(Or right-click the app → **Open** → **Open**.) Without this you'll see
"HappyVibe is damaged and can't be opened" — that's Gatekeeper on an
un-notarized app, not a broken download. Notarizing (needs a $99/yr Apple
Developer ID) would remove this step.

## Gotchas discovered during the spike

- **One-shot Pi CLI calls hang if stdin stays open** (TTY read). Always close stdin for `--version`/`--list-models` (`stdio: ["ignore", ...]`). RPC mode is unaffected.
- `pi --list-models` lists only *configured* providers — it is not a catalog; native provider support was confirmed from Pi's model registry.
- Extensions calling `ctx.ui.*` inside `session_start` must fire **async-detached** (Pi's JSONL stdin reader attaches after the handler returns).
- The Pi npm package moved to the `@earendil-works` scope (`@mariozechner` is stale).
- Upgrading Pi = a deliberate change: bump the pin in `pi-runtime/package.json`, re-run the whole test suite, re-check the wire shapes in `docs/validation/d1.md`.
- **`pi-subagents` is a second pinned-exact runtime dep** (`pi-runtime/package.json`, `0.33.1`) with the SAME upgrade-gate treatment as Pi: bump deliberately, re-run `tests/agents-bridge.test.ts` (it asserts the observed subagent `tool_execution_*` trace shapes — they moved between the S0.3 spike and 0.33.1) and re-check `docs/validation/d1.md §B6`. It loads as a second `-e` extension; its child Pi spawn is pinned to the embedded bin via `PI_SUBAGENT_PI_BINARY` (spawn env). The two built-in agents ship as `pi-runtime/agents/*.md` and install idempotently into the app-owned agent dir at startup.

## Known limitations

- **Queued messages can't be removed.** Pi 0.80.3's `queue_update` is read-only state — there is no dequeue RPC, so the chat bar can show queued steering/follow-up messages but never unqueue them. An upstream Pi feature request is the path; the chips say so honestly in their tooltip.

## Where to build next (per the HappyVibe PRD)

Sessions list & parallel sessions · MCP via `pi-mcp-adapter` · sub-agents via `pi-subagents` (Code Explorer + Summarizer) · context inspection/editing · audit log · pretty diffs · real design. The PiClient event stream and the bridge pattern generalize to all of these.
