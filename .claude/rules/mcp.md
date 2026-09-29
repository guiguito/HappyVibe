---
paths:
  - "src/main/mcp*.ts"
  - "pi-runtime/extensions/hv-mcp.ts"
  - "pi-runtime/bin/mcp-oauth-bridge*.mjs"
  - "scripts/build-mcp-oauth-bridge.mjs"
  - "src/renderer/src/mcpChip.ts"
  - "src/renderer/src/components/Mcp*.tsx"
  - "tests/mcp*.test.ts"
---
# MCP — adapter is the runtime, main is the management

- `pi-mcp-adapter` runs the servers inside Pi. Main (`src/main/mcp*.ts`, `@modelcontextprotocol/sdk`)
  does connect / list tools / status / OAuth, because the adapter's OAuth only runs in TUI mode and
  its structured actions are tool-only (Pi RPC has no tool-exec verb). A non-blocking startup sweep
  probes configured servers. `docs/validation/m1.md`.
- The proxy tool is `mcp`; the bridge unwraps it (`hv-mcp.ts`) to the virtual rule name
  `mcp:<serverKey>_<toolName>` for rules/grants/prompts/audit. Discovery calls
  (search/describe/connect/instructions, `action:"ui-messages"`) are safe-default-allowed.
  `install`, `auth-start`/`auth-complete` and a lone unknown action are the `manage` kind
  (`mcp-manage:install:<url>`, `mcp-manage:auth:<server>`, and `mcp-manage:<action>` for a lone
  unknown action — outside `mcp:` so no MCP tool rule covers them): asked by default, blocked in
  plan mode and read-only runs. The install URL is shown canonicalised (`new URL(…).toString()`,
  as the adapter writes it), or "(not a valid URL)" — model text never reaches the headline. An
  action added to `MCP_MANAGE_ACTIONS` is asked with no other edit. `unwrapMcpCall` reads
  keys in the ADAPTER's dispatch order (action → tool → connect → describe → instructions →
  search), pinned with its action list by `tests/mcp-adapter-actions.test.ts`. It is the ONE
  source of the factual display (gate + renderer), enriched with a key arg (url/query).
- stdio servers configured with `node`/`npx` need a runtime in the packaged app.

## Intent
- `mcp` is in `INTENT_TOOLS`: `requireIntent` injects a required `intent` into the proxy schema; the
  proxy's `execute` ignores it. DIRECT mode forwards params verbatim, so `requireIntent` also injects
  into every adapter-registered direct tool (`sourceInfo.path` contains `pi-mcp-adapter`) and the
  `tool_call` handler STRIPS `input.intent` for those (`strippedIntentTools`) before anything reads
  it. The UI still sees intent (`tool_execution_start` fires with the original args first). A server
  tool with its own `intent` param gets no injection and no strip.
- The card headline is the model's `intent`, falling back to the factual display (`toolLabel.ts`);
  the permission prompt shows the FACTUAL display, never the model's intent (safety).
- `requireIntent` also runs on `turn_start`: the adapter re-registers the proxy whenever its
  description changes, with a fresh schema that drops the injected field. Regression symptom:
  `args.intent === undefined` and `mcp-bridge.test.ts` failing fast (~4 s).
  `tests/intent-direct-tools.test.ts`.

## Credentials live in the OS keychain — main goes through a sidecar
- The adapter's store is the keychain (service `pi-mcp-adapter.oauth`, chunked payloads);
  `<agentDir>/mcp-oauth/…/tokens.json` is a legacy file it imports and DELETES. Never mirror the
  format — main runs the adapter's own code in a one-shot sidecar
  (`pi-runtime/bin/mcp-oauth-bridge.mjs`, spawned via `nodeExecPath()`, ops batched so the startup
  sweep is ONE spawn). A mirror silently breaks the badge, re-auth and Log out.
- The sidecar is an esbuild bundle built at postinstall: Node refuses to type-strip `.ts` under
  `node_modules`, and the adapter ships `.ts`.
- Reads use `inspectAuthForUrl` (relative import), not the `pi-mcp-adapter/oauth` subpath's
  `inspectMcpOAuthTokensForUrl`, which drops `clientInfo` (needed for refresh and the stale-DCR
  client guard).
- `src/main/mcpAuthStore.ts` keeps PKCE + CSRF state only, in `flow.json` — in `tokens.json` the
  adapter would import and delete the code verifier mid-authorization.
- `tests/mcp-adapter-authformat.test.ts` gates pin bumps and MUST set
  `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` — the keychain is global to the OS user, so an unforced
  test reads and writes the developer's real login keychain.
- Keychain access PROMPTS, and "Always Allow" only sticks for a properly signed binary (the
  ad-hoc-signed dev Electron helper re-prompts on every access). So nothing reads a credential at
  boot: the startup sweep probes stdio servers only; remote servers sweep when the MCP page mounts
  (`hv:mcp-sweep-remote`, once per app run). The agent also prompts on its first MCP call per grant.

## OAuth (host-driven in `src/main/mcpOAuth.ts`)
- `OAuthClientProvider` + loopback callback + `shell.openExternal` + `state` CSRF check +
  `transport.finishAuth` + reconnect on a fresh transport. IPC `hv:mcp-authenticate` /
  `hv:mcp-logout`; add-time confirm-with-tools modal.

## Live reload
- Pi and the adapter read MCP config only at spawn. `hv:mcp-set-server` / `-authenticate` /
  `-logout` call `scheduleMcpReload` (debounced, coalesces add+auth) → affected live sessions respawn
  RESUMED (`startClient(meta,true)`). Scope: global change → every live session; workspace change →
  that workspace's (`affectedSessionIds`, `mcpReloadScope.ts`).
- Only IDLE sessions (`activity.isIdle`) reload immediately; busy ones defer via `pendingMcpReload`,
  drained on `agent_end` / permission-prompt close. The renderer gets `hv:session-reloading`
  (grants reset); main then fires `/hv-tools`.

## Secrets can execute
- The adapter resolves env/header values through `resolveCommandSecret`: a leading `!` runs a shell
  command and uses its stdout (`!!` escapes). Per-server `requestHeadersCommand` spawns a command on
  every outbound HTTP/SSE call. Both are reachable from a WORKSPACE `.mcp.json` — a cloned repo.
  HappyVibe never authors either key (`tests/mcp-adapter-interpolation.test.ts`).
