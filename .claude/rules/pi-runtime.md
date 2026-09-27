---
paths:
  - "src/main/pi/**"
  - "src/main/{appendSystem,titles,gitMessage,oneShotLog,SessionManager}.ts"
  - "pi-runtime/extensions/happyvibe-bridge.ts"
  - "pi-runtime/package.json"
  - "tests/{identity-prompt,pi-cli-entry,resource-gate-contract,builtins-contract}.test.ts"
---
# Pi runtime facts (RPC mode)

- **`ctx.hasUI` is TRUE in `--mode rpc`** — Pi's headless mode is PRINT mode. The RPC `uiContext` is
  real per method: `input`/`select`/`setTitle`/`setEditorText` emit `extension_ui_request` (the
  bridge's channel), but `custom()` returns `undefined` (`dist/modes/rpc/rpc-mode.js`), so an
  awaited `ctx.ui.custom()` panel never settles. Upstream code gated on `ctx.hasUI` runs for us;
  the correct discriminator is `ctx.hasUI && ctx.mode === "tui"` (what pi-mcp-adapter uses).
  tintinweb's widgets are dormant only because `widgetMode`/`fleetView` are off.
- **`--append-system-prompt` REPLACES Pi's discovery of `APPEND_SYSTEM.md`**, and a non-existent path
  is used VERBATIM as prompt text. So spawn.ts passes the flag twice: HappyVibe's identity first,
  then the global `APPEND_SYSTEM.md` only if `existsSync` (Pi joins sources with `\n\n` in argv
  order, so the user's words come last and win). Consequence, deliberate: a workspace
  `.pi/APPEND_SYSTEM.md` is never discovered, so a cloned repo can't rewrite the system prompt.
  `tests/identity-prompt.test.ts` pins both cases and the upstream behaviour.
- **Pi has a `clear_queue` RPC** (`session.clearQueue()`); abort preserves the queue. Nothing in
  `src/` calls it — exposing it is a product decision.
- **`toolChoice` can't be set from HappyVibe.** Pi's `buildBaseOptions` allowlist omits it, but the
  per-provider `streamSimple` implementations read `options.toolChoice` directly, and our
  OpenRouter/DeepSeek route (`openai-completions`) forwards it to the wire. There is no CLI flag and
  no RPC param; the known route in is a `before_provider_request` extension hook (it fails OPEN, must
  be armed per turn or `agent_end` hangs, and `askUntil` stays). `docs/validation/tc1.md` predates
  the provider change — re-measure whether a setter exists before re-opening this.
- `PiClient.send` has no timeout: a request to a child whose cwd was deleted never settles.
- Pi emits nothing on boot in RPC mode (no ready event) and `PiClient.start()` only spawns, so there
  is no handshake to await; an early stdin write is buffered until boot finishes.

## One-shot calls
- Three callers use `pi -p --no-session` (stdin closed): session titles (`titles.ts`), the commit
  message and the PR draft (`gitMessage.ts`). The AGENTS.md draft is NOT a one-shot — it's a
  delegation (`subagents.md`).
- They carry no usage record, so they log `assistant.oneshot` with estimated TOKENS, never dollars
  (main has no price table and must not grow one). They sit BESIDE the Stats cost, never inside it;
  a test asserts the payload has no cost key.
