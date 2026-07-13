# MCP Management Client — Implementation Plan (Phase 2: OAuth + add-time confirm)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. Phase 1 (docs/superpowers/plans/2026-07-13-mcp-management-client.md) is landed + reviewed PHASE-1-READY.

**Goal:** Deterministic, host-driven OAuth for MCP servers: authenticate right when a server is added, confirm the connection + show discovered tools, and offer per-server Authenticate / Log out. Main runs the OAuth handshake with `@modelcontextprotocol/sdk` (a main-hosted loopback callback + system browser via `openExternal`) and persists tokens to the adapter's on-disk store, so the vendored adapter connects at runtime with no re-auth.

**Architecture:** `src/main/mcpOAuth.ts` implements the SDK `OAuthClientProvider` interface backed by `src/main/mcpAuthStore.ts` (Phase 1). The provider's storage IS the adapter's `AuthEntry` on disk → the adapter reads main's tokens. Reference implementation to mirror: `pi-runtime/node_modules/pi-mcp-adapter/mcp-oauth-provider.ts` + `mcp-auth-flow.ts` (a working `OAuthClientProvider` + `transport.finishAuth` flow). Full context: `/Users/guilhemduche/.claude/plans/1-i-d-rather-do-ethereal-globe.md`.

## Global Constraints

- SDK `@modelcontextprotocol/sdk@1.29.0` (already added, exact). Imports: `Client` (`/client/index.js`), `StreamableHTTPClientTransport` (`/client/streamableHttp.js`), `auth`/`OAuthClientProvider`/`UnauthorizedError` (`/client/auth.js`), token/metadata types (`/shared/auth.js`).
- `src/main/mcpOAuth.ts` may import electron ONLY for the browser-open (prefer taking an injected `openExternal(url)` callback so the core stays vitest-testable, like `spawn.ts` takes explicit deps). The OAuth provider + store logic must be unit-testable without electron.
- Persisted on-disk `AuthEntry` MUST stay byte-compatible with the adapter (Phase 1 `mcpAuthStore`): `tokens`, `clientInfo`, `codeVerifier`, `oauthState`, `serverUrl`. `serverUrl` MUST equal the `.mcp.json` `url`.
- Permission/security: workspace-tier operations reuse the existing registry-confinement guard (Phase 1 / `workspaceMcpFile`). The loopback callback server binds `127.0.0.1` only, validates the `state` param, and shuts down after the flow (or idles out). Never auto-open or pre-fetch anything but the single authorize URL via `openExternal`.
- No changes to the adapter or the runtime permission gate.
- Full gate = both typechecks + non-live suite + live files batched + build.
- **Phase-1 carry-forward (address in Task 6):** when `deleteAuthEntry` goes live, match the adapter's blank-then-rm (write `"{}"` to tokens.json before removing) — `pi-mcp-adapter/mcp-auth.ts:142-155`.

---

### Task 6: `mcpOAuth.ts` — provider + callback + authenticate; contract + mock-OAuth tests

**Files:**
- Create: `src/main/mcpOAuth.ts`
- Test: `tests/mcp-oauth.test.ts` (hermetic mock OAuth+MCP HTTP server), `tests/mcp-adapter-authformat.test.ts` (contract)
- Modify: `src/main/mcpAuthStore.ts` (make `deleteAuthEntry` blank-then-rm)

**Interfaces produced:**
```ts
// electron-free core; browser-open injected
function authenticate(name: string, cfg: McpServerConfig, agentDir: string, deps: { openExternal: (url: string) => void; signal?: AbortSignal }): Promise<{ ok: true; tools: {name:string;description?:string}[] } | { ok: false; error: string }>
function logout(name: string, agentDir: string): void   // deleteAuthEntry (blank-then-rm)
```

- [ ] **Step 1: Read the reference + SDK types.** Read `pi-mcp-adapter/mcp-oauth-provider.ts` (its `OAuthClientProvider` impl), `mcp-auth-flow.ts` (how it drives connect → `UnauthorizedError` → authorize → `transport.finishAuth(code)` → reconnect), and the SDK `.d.ts` for `OAuthClientProvider`, `StreamableHTTPClientTransport` (constructor `authProvider` option + `finishAuth`), and `UnauthorizedError`.
- [ ] **Step 2: Write the failing contract test** `tests/mcp-adapter-authformat.test.ts`: construct the `HvOAuthProvider` (or call the store directly) to persist an `AuthEntry` with tokens + clientInfo + `serverUrl`; read it back via the adapter's `getAuthForUrl(name, url)` (import from `../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts`, `PI_CODING_AGENT_DIR=tmp`) → returns the entry with tokens. This is the adapter-pin-bump gate.
- [ ] **Step 3: Write the failing mock-OAuth test** `tests/mcp-oauth.test.ts`: a hermetic Node `http` server exposing minimal OAuth: `/.well-known/oauth-authorization-server` (+ protected-resource metadata as the SDK expects), dynamic client registration (`/register`), `/authorize` (immediately 302s to the provider's `redirect_uri` with `?code=TESTCODE&state=<state>`), `/token` (returns a fake access token), and a Streamable-HTTP MCP endpoint that requires `Authorization: Bearer` and serves `initialize`/`tools/list` (one tool). `authenticate("mock", { url }, tmpAgentDir, { openExternal: (url) => { /* GET the authorize url to drive the 302 back to our callback */ } })` → `{ ok:true, tools:[...] }`, AND a valid `AuthEntry` with `serverUrl` was written at the adapter's path. (The injected `openExternal` fetches the authorize URL to simulate the user approving — hermetic, no real browser.)
- [ ] **Step 4: Run tests, verify fail.**
- [ ] **Step 5: Implement `src/main/mcpOAuth.ts`:**
  - `class HvOAuthProvider implements OAuthClientProvider`: `redirectUrl` = the main callback URL (`http://127.0.0.1:<port>/callback`); `clientMetadata` = `{ client_name: "HappyVibe", redirect_uris: [redirectUrl], grant_types: ["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none" }` (verify against the SDK `OAuthClientMetadata` type); `clientInformation`/`saveClientInformation` ↔ `AuthEntry.clientInfo`; `tokens`/`saveTokens` ↔ `AuthEntry.tokens`; `codeVerifier`/`saveCodeVerifier` ↔ `AuthEntry.codeVerifier`; `state()` generates + stores `AuthEntry.oauthState`; `redirectToAuthorization(url)` → `deps.openExternal(url.toString())`. Every persist writes `serverUrl = cfg.url`.
  - A per-authenticate loopback callback server (Node `http`) on `127.0.0.1`, port captured into `redirectUrl` BEFORE the flow; a promise that resolves with `{code, state}` on `GET /callback`, validated against the provider's stored `state`; closed in `finally`.
  - `authenticate(...)`: build `StreamableHTTPClientTransport(new URL(cfg.url), { authProvider })`; `try client.connect(transport)`; on `UnauthorizedError`, wait for the callback `{code}`, `await transport.finishAuth(code)`, then reconnect (`client.connect`) — mirror the adapter's sequence exactly. Then `listTools()` → map → close. Return `{ok:true,tools}` / `{ok:false,error}`. Timeout-guard the wait (5 min like the adapter's `MANUAL_AUTH_TIMEOUT_MS`, but allow a short test override).
  - `logout(name, agentDir)` → `deleteAuthEntry`.
- [ ] **Step 6: Update `deleteAuthEntry`** in `mcpAuthStore.ts` to blank-then-rm (write `"{}"` mode 0o600 to tokens.json, then `rmSync` the dir) — match `mcp-auth.ts:142-155`. Keep its existing test green (add an assertion the dir is gone).
- [ ] **Step 7: Run tests, verify pass. Step 8: typecheck (node) + commit** `feat(mcp): main-side OAuth (SDK OAuthClientProvider + loopback callback) + contract test`.

---

### Task 7: IPC + preload for authenticate / logout

**Files:** `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`

**Interfaces produced (renderer):**
```ts
mcpAuthenticate(scope, workspaceId, name): Promise<{ ok: true; tools: {name:string;description?:string}[] } | { ok: false; error: string }>
mcpLogout(name): Promise<void>
```

- [ ] **Step 1:** `hv:mcp-authenticate` handler: resolve cfg (guarded, as `checkServer` does), call `authenticate(name, cfg, agentDir(), { openExternal: (url) => shell.openExternal(url) })` (reuse the existing `hv:open-external`/`shell.openExternal` path), then update the status map (`connected` + tools on success; `needs-auth`/`failed` otherwise) + `mcpStatusChanged()` broadcast; return the result. `hv:mcp-logout` handler: `logout(name, agentDir())`, best-effort fire `/mcp logout <name>` on the utility client to drop any live runtime connection, update status → `needs-auth`, broadcast.
- [ ] **Step 2:** Preload `mcpAuthenticate`/`mcpLogout` + `hv.d.ts` signatures (mirror the existing `mcpCheck`/`mcpStatus` entries).
- [ ] **Step 3:** Typecheck (node) + commit `feat(mcp): hv:mcp-authenticate / hv:mcp-logout IPC + preload`.

---

### Task 8: renderer — add-time confirm-with-tools + Authenticate / Log out

**Files:** `src/renderer/src/components/McpServersSection.tsx` (+ a small `McpConnectResult` modal component)

- [ ] **Step 1:** After `McpServerEditor.save()` writes config: call `mcpCheck`; if the resulting state is `needs-auth`, call `mcpAuthenticate`. Show an "Opening your browser — approve access, then return to HappyVibe" transient state while it runs (main auto-completes on the redirect; no code paste). On `{ok:true}` show a **confirm modal** listing the discovered tools (reuse `toolLabel`-style names / house "warm workshop" style); on `{ok:false}` show the error with a Retry.
- [ ] **Step 2:** Per-row actions driven by status: an **Authenticate** button when `state==="needs-auth"` (calls `mcpAuthenticate`), a **Log out** button when authenticated/connected on an OAuth server (calls `mcpLogout`). Wire into the existing row action group next to Edit/Remove/Reconnect.
- [ ] **Step 3:** Gate: `npx tsc --noEmit -p tsconfig.web.json`; `npm run build`. Commit `feat(mcp): add-time OAuth confirm-with-tools flow + Authenticate/Log out actions`.

---

### Task 9: docs + full gate + final whole-branch review

**Files:** `docs/validation/m1.md`, `docs/prd.md` (+ Notion), `CLAUDE.md`

- [ ] **Step 1:** m1.md — document the working OAuth architecture (main-hosted provider + loopback callback + `finishAuth`; adapter reads tokens at runtime). CLAUDE.md — extend the MCP gotcha with the auth flow.
- [ ] **Step 2:** PRD fold (both `docs/prd.md` and Notion, per the standing instruction): MCP OAuth ships host-driven in main; add-time auth + confirm + status + reconnect.
- [ ] **Step 3: Full gate** — both typechecks + non-live suite + live files batched (incl. `mcp-bridge`) + `npm run build`. Report actual counts.
- [ ] **Step 4: Manual real-Notion checklist** (documented, run by the user or in `npm run dev`): add Notion → browser → approve → confirm modal shows Notion tools → in a chat, model calls a Notion tool → permission prompt `mcp:<server>_<tool>` → succeeds. Log out → `needs-auth`.
- [ ] **Step 5:** Commit `docs(mcp): m1.md + PRD + CLAUDE.md — host-driven MCP OAuth (phase 2)`.
- [ ] **Step 6:** Final whole-branch review (opus) over the full Phase-1+2 range; triage accumulated Minors.
