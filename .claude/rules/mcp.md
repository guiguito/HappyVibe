---
paths:
  - "src/main/mcp*.ts"
  - "pi-runtime/extensions/hv-mcp*.ts"
  - "src/renderer/src/mcpChip.ts"
  - "src/renderer/src/components/Mcp*.tsx"
  - "tests/mcp*.test.ts"
  - "tests/hv-mcp*.test.ts"
---
# MCP — Pi runs the servers, the bridge gates them, main asks Pi

PRD §13 Decision (2026-10-05); evidence `docs/validation/mcp2.md`.

- Pi's built-in MCP (`-e builtin:mcp -e builtin:tool-search`) loads in CHAT SESSIONS ONLY
  (`resolvePiSpawn({ mcp: true })`, which also sets `HV_MCP=1`). Never the utility client or a
  one-shot: Pi has NO lazy start, so any Pi with MCP starts every enabled server.
- Config: global `<agentDir>/mcp.json` is read by Pi directly. Workspace `<ws>/.mcp.json` is
  registered by the bridge (`pi.registerMcpServer()`, only when `HV_MCP=1`) — Pi itself reads
  project servers only from a TRUSTED project's `.pi/mcp.json`, and we never trust one. A global
  server of the same name wins (the workspace row shows "overridden").
- Exposure defaults to `deferred` (the model finds tools with `tool_search`). Pi has no global
  default (unset = `codemode`, which we don't load), so `hv-mcp-config.ts` `toPiEntry` writes it:
  main on every launch (`mcpMigrate.ts`) and every write (`writeMcpServer`), the bridge at
  registration. `toPiEntry` also translates adapter-era keys Pi ignores or REJECTS (`disabled`,
  `directTools`, `excludeTools`, `bearerToken*`, non-object `auth`, `oauth:false`) — a rejected
  entry is skipped whole, which is how plugin servers (`auth:"oauth"`) would have vanished.
- Off = `enabled: false` (`isMcpServerOff` also reads the old `disabled: true`). An off server
  spawns nothing; Connect (`hv:mcp-connect-flow`) switches it on, and back off if the connect fails.

## Gate
- Pi MCP tools are `mcp__<ns>__<tool>`, `sourceInfo.path === "builtin:mcp"`. The bridge maps a call
  to `mcp:<server>_<tool>` (`hv-mcp.ts` `mcpCallInfo`) — the adapter-era spelling, so stored rules
  keep matching: server = the CONFIGURED name recovered from `ToolInfo.namespace` (never a parse of
  the tool name), no double prefix. Identified by SOURCE: another extension can name a tool `mcp__x`.
- `tool_search`, `list_mcp_resources`, `list_mcp_resource_templates` are `SAFE_TOOLS` and plan-pass.
  The bridge caps every `tool_search` at `TOOL_SEARCH_LIMIT` (4): Pi keeps loaded tools declared for
  the rest of the branch, and one search at Pi's default 8 loaded ~17k tokens of Notion schemas
  (GUI pass 2026-10-05). A later search only ranks tools not yet loaded, so the model can re-search.
  `read_mcp_resource` gates as `mcp:<server>_read_mcp_resource` (unknown server → `(unknown server)`).
- Server hints (`readOnlyHint` / `destructiveHint`) ride the prompt as `serverHint` ("Server says: …")
  and a read-only hint turns Plan mode's (and read-only runs') floor-ask into `pass` — checked AFTER
  every block, and it never allows on its own: the server can lie.
- `intent`: Pi forwards params VERBATIM to the server, so `requireIntent` injects a required `intent`
  into every `builtin:mcp` tool and the `tool_call` handler STRIPS it before anything reads input.
  Pi 1.0 HARD-VALIDATES MCP args: a call without the required `intent` is refused before the gate.
  Servers connect after `session_start`, so `requireIntent` re-runs on `turn_start`.
- `/hv-tools` sends each Pi MCP tool's `checkedAs` rule name (All Tools shows one row per tool);
  `/hv-mcp-tools` lists the workspace-registered servers' tool names for the MCP page.

## Management (main never speaks MCP)
- Global servers: `mcpPi.ts` runs `pi mcp list --json | login | logout` (stdin ignored, cwd home,
  `PI_CODING_AGENT_DIR`, `providerEnv()`, `windowsHide`). `list` exits 1 when any server isn't
  connected — parse stdout regardless. Tools are NAMES only (no descriptions upstream).
- Workspace servers: `mcpWorkspaceProbe.ts` spawns a short-lived model-less Pi in the workspace:
  `/mcp` (plain-text status), `/hv-mcp-tools`, `/mcp login|logout <server>`. Probes run on MCP-page
  mount, never at boot (each probe starts every server).
- Sign-in: `pi mcp login` prints `Sign in to MCP server "<n>" in your browser:\n<url>` and opens the
  browser itself. Over RPC, `/mcp login` raises a paste-back `input` that must stay PENDING (an
  empty answer fails the sign-in) and that Pi aborts locally WITHOUT telling us when the browser
  wins — main forgets it on the `Signed in to MCP server` notify; Cancel answers it `{cancelled}`.
  The wording is copy, not an API: `tests/mcp-pi.test.ts` source-scans the vendored Pi.
- `hv:mcp-authenticate` checks status FIRST and signs in only on `needs-auth`: the page
  auto-authenticates every new HTTP server, and `pi mcp login` refuses a key-header server.
- Tokens live in `<agentDir>/mcp-auth.json` (0600), keyed `mcp__<ns>|<url>` — no keychain. A running
  session picks up a new sign-in on its next call; the resumed respawn stays anyway (decision 12).
- Removing a server: Pi finds servers BY NAME, so logout runs before the entry leaves the file
  (`removeServerInOrder`), or the token is orphaned.

## Live reload
- Pi reads MCP config at spawn. `hv:mcp-set-server` / `-authenticate` / `-logout` / connect-flow
  call `scheduleMcpReload` (debounced) → affected live sessions respawn RESUMED. Scope: global →
  every live session; workspace → that workspace's (`mcpReloadScope.ts`). Busy sessions defer via
  `pendingMcpReload`, drained on `agent_end` / prompt close; `/hv-tools` follows.

## Secrets can execute
- Pi resolves `${VAR}`/`$VAR` in `headers`, stdio `env` and `oauth.clientSecret`; a leading `!` runs
  a shell command. A missing variable FAILS the connection. All of it is reachable from a workspace
  `.mcp.json` (a cloned repo); HappyVibe never authors a `!` value. The bridge strips `auth`
  (`{provider}` — a /login token) from workspace entries: Pi only refuses it in project FILES,
  not in `registerMcpServer()`.
- stdio servers configured with `node`/`npx` need the user's runtime in the packaged app.
