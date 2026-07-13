# MCP Management Client — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** HappyVibe's main process becomes the MCP management client (connect / list-tools / status), so MCP servers get a per-server connection status, a reconnect action, and a startup connectivity check. Phase 2 (OAuth + add-time confirm) is a separate wave.

**Architecture:** New electron-free main modules use `@modelcontextprotocol/sdk` (the same lib the vendored `pi-mcp-adapter` uses) to connect on-demand to configured servers and list their tools. The adapter stays the in-session runtime path. Shared state with the adapter is on-disk only. Full context + root cause: `/Users/guilhemduche/.claude/plans/1-i-d-rather-do-ethereal-globe.md`.

**Tech Stack:** TypeScript, Electron (electron-vite), vitest, `@modelcontextprotocol/sdk@1.29.0`.

## Global Constraints

- `@modelcontextprotocol/sdk` pinned EXACT `1.29.0` in the **app** root `package.json` (matches the version the adapter already resolves in `pi-runtime/`).
- SDK import paths (ESM `.js` specifiers, as the adapter uses): `@modelcontextprotocol/sdk/client/index.js` (`Client`), `/client/streamableHttp.js` (`StreamableHTTPClientTransport`), `/client/stdio.js` (`StdioClientTransport`), `/client/auth.js` (`auth`, `OAuthClientProvider`).
- New `src/main/mcp*.ts` modules are **electron-free** (take explicit paths like `agentDir`; vitest-importable — same discipline as `src/main/pi/spawn.ts`). Only node builtins + the SDK.
- On-disk contract with the adapter (read-only in Phase 1): tokens at `<agentDir>/mcp-oauth/sha256-<sha256hex(serverName)>/tokens.json` as `AuthEntry` JSON. Field names verbatim from `pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts:16-40`. `agentDir()` (`src/main/config.ts`) === adapter `getAgentDir()`.
- Reference implementation for SDK usage (READ, mirror — do not import from the adapter at runtime): `pi-mcp-adapter/mcp-oauth-provider.ts`, `mcp-auth-flow.ts`, `mcp-auth.ts`.
- Connections are **on-demand** (connect → list → close); main holds NO persistent connections. Never double-run the adapter's runtime servers.
- Reuse existing patterns: `readMcpFile`/`McpServerConfig` (`src/main/mcp.ts`), `workspaces.list()` (`src/main/store.ts`), the `providersChanged()`→`webContents.send` broadcast (`src/main/ipc.ts` ~200), the `onProvidersChanged` preload listener (~preload 120-150), `PERM_TONE` palette (`AgentsView.tsx`).
- Full gate = both typechecks + non-live suite + live files batched + build.

---

### Task 1: SDK dependency + `mcpAuthStore.ts`

**Files:**
- Modify: root `package.json`
- Create: `src/main/mcpAuthStore.ts`
- Test: `tests/mcp-authstore.test.ts`

**Interfaces produced:**
```ts
interface StoredTokens { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
interface StoredClientInfo { clientId: string; clientSecret?: string; clientIdIssuedAt?: number; clientSecretExpiresAt?: number; redirectUris?: string[] }
interface AuthEntry { tokens?: StoredTokens; clientInfo?: StoredClientInfo; codeVerifier?: string; oauthState?: string; serverUrl?: string }
function serverDir(agentDir: string, name: string): string          // <agentDir>/mcp-oauth/sha256-<sha256hex(name)>
function authEntryPath(agentDir: string, name: string): string      // serverDir + /tokens.json
function readAuthEntry(agentDir: string, name: string): AuthEntry | undefined
function writeAuthEntry(agentDir: string, name: string, entry: AuthEntry): void   // dir 0o700, file 0o600
function deleteAuthEntry(agentDir: string, name: string): void
function authState(agentDir: string, name: string, url: string): "authenticated" | "needs-auth"
```

- [ ] **Step 1: Add the dependency.** `npm install @modelcontextprotocol/sdk@1.29.0 --save-exact` (app root). Confirm `package.json` shows `"1.29.0"` (no caret).
- [ ] **Step 2: Write failing tests** in `tests/mcp-authstore.test.ts`: (a) `authEntryPath(tmp,"notion")` equals the adapter's own path — `import { getAuthEntryFilePath } from "../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts"` and assert equal after setting `PI_CODING_AGENT_DIR=tmp` (the adapter derives its base from `getAgentDir()`); (b) write→read round-trip preserves all `AuthEntry` fields; (c) `authState` = `authenticated` when tokens present + `serverUrl` matches + unexpired; `needs-auth` when missing / url-mismatch / `expiresAt` in the past; (d) `deleteAuthEntry` removes it.
- [ ] **Step 3: Run tests, verify fail.** `npx vitest run tests/mcp-authstore.test.ts`.
- [ ] **Step 4: Implement `src/main/mcpAuthStore.ts`** mirroring `mcp-auth.ts:42-130` (hash = `createHash("sha256").update(name,"utf8").digest("hex")`; base = `join(agentDir,"mcp-oauth")`; 0o700/0o600). `authState` mirrors the adapter's `getAuthForUrl` validity (present + `serverUrl===url`) plus expiry (`!expiresAt || expiresAt*1000 > Date.now()`).
- [ ] **Step 5: Run tests, verify pass.**
- [ ] **Step 6: Typecheck + commit.** `npx tsc --noEmit -p tsconfig.node.json`; commit `feat(mcp): @modelcontextprotocol/sdk dep + mcpAuthStore (adapter on-disk token format)`.

---

### Task 2: `mcpClient.ts` — on-demand probe

**Files:**
- Create: `src/main/mcpClient.ts`
- Test: `tests/mcp-client.test.ts`

**Interfaces produced:**
```ts
type ProbeResult = { state: "connected" | "needs-auth" | "failed"; tools?: { name: string; description?: string }[]; error?: string }
function probe(name: string, cfg: McpServerConfig, agentDir: string, opts?: { timeoutMs?: number }): Promise<ProbeResult>
```
(`McpServerConfig` from `src/main/mcp.ts`.)

- [ ] **Step 1: Write failing test** in `tests/mcp-client.test.ts`: `probe("echo", { command: process.execPath, args: [<abs path to tests/fixtures/mcp-echo-server.mjs>] }, tmpAgentDir)` → `state:"connected"`, `tools` contains `{ name: "echo" }`. Hermetic, no API key.
- [ ] **Step 2: Run test, verify fail.**
- [ ] **Step 3: Implement `src/main/mcpClient.ts`.** Read the SDK client API from `pi-runtime/node_modules/@modelcontextprotocol/sdk/dist/**/*.d.ts` and mirror the adapter's usage in `mcp-oauth-provider.ts`/`mcp-auth-flow.ts`/`server-manager.ts`. Build a `Client` with either `StdioClientTransport({command,args,env})` (when `cfg.command`) or `StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })` (when `cfg.url`). For http servers, attach a **read-only** `OAuthClientProvider` (Task 3+ wiring; in Phase 1 just detect: if connect throws an auth/401 error and `authState(agentDir,name,url)!=="authenticated"` → `state:"needs-auth"`). `await client.connect(transport)`, `await client.listTools()`, map to `{name,description}`, `await client.close()`. Timeout-guard the connect+list (default ~5s) → `state:"failed"` with `error` on timeout/throw. Never leave a transport open.
- [ ] **Step 4: Run test, verify pass.**
- [ ] **Step 5: Typecheck + commit.** `feat(mcp): mcpClient.probe — on-demand connect + listTools (stdio + http)`.

---

### Task 3: status model + IPC + startup sweep

**Files:**
- Modify: `src/main/ipc.ts`
- Test: `tests/mcp-status.test.ts` (pure helper only — see below)

**Interfaces produced:**
```ts
type McpState = "connected" | "needs-auth" | "failed" | "checking"
interface McpServerStatus { name: string; scope: "global" | "workspace"; workspaceId: string | null; state: McpState; toolCount: number; tools?: {name:string;description?:string}[]; error?: string; lastChecked: number }
// statusKey(scope, workspaceId, name) -> `${scope}:${workspaceId ?? ""}:${name}`  (extract as a tiny pure fn, unit-tested)
```

- [ ] **Step 1: Write failing test** for a pure `statusKey(scope, workspaceId, name)` helper (extract into `src/main/mcpStatusKey.ts` so it's electron-free/testable): distinct keys per scope+workspace+name; stable. `tests/mcp-status.test.ts`.
- [ ] **Step 2: Run, verify fail. Step 3: Implement the helper. Step 4: verify pass.**
- [ ] **Step 5: Wire IPC + status map in `src/main/ipc.ts`:**
  - In-memory `Map<string, McpServerStatus>` (module-scope within `registerIpc`).
  - `async function checkServer(scope, workspaceId, name)`: read cfg (global = `readMcpFile(path.join(agentDir(),"mcp.json"))`; workspace = `readMcpFile(path.join(workspaceId,".mcp.json"))` — guard workspaceId via the same registry check the existing `hv:mcp-set-server`/workspace-append handlers use), set state `checking` + broadcast, `probe(...)`, update entry, broadcast.
  - `mcpStatusChanged()` mirroring `providersChanged()` → `win.webContents.send("hv:mcp-status-changed", Array.from(map.values()))`.
  - Handlers next to `hv:mcp-get` (~ipc.ts:741): `ipcMain.handle("hv:mcp-status", () => Array.from(map.values()))`; `ipcMain.handle("hv:mcp-check", (_e, scope, workspaceId, name?) => …)` (name omitted → check all configured servers in that scope).
- [ ] **Step 6: Startup sweep.** After `installBuiltinAgents(...)` in `registerIpc` (~ipc.ts:84-89), fire a non-blocking async sweep of global + every `workspaces.list()` workspace's servers → `checkServer` each; `log.append({ type:"mcp.startup_check", data:{ counts } })`. `// ponytail:` comment noting stdio probes briefly spawn each server; upgrade path = persistent handles if it bites.
- [ ] **Step 7: Typecheck (node) + commit.** `feat(mcp): main status map + hv:mcp-status/check + startup connectivity sweep`.

---

### Task 4: preload + renderer status UI + reconnect

**Files:**
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/components/McpServersSection.tsx`
- Test: none new (UI); gate is typecheck + build + existing tests.

**Interfaces produced (preload/renderer):**
```ts
mcpStatus(): Promise<McpServerStatusLike[]>
mcpCheck(scope: "global" | "workspace", workspaceId: string | null, name?: string): Promise<void>
onMcpStatusChanged(cb: (s: McpServerStatusLike[]) => void): () => void
```
(`McpServerStatusLike` declared locally in `hv.d.ts` — no import from `src/main`.)

- [ ] **Step 1: Preload + types.** Add the three methods to `src/preload/index.ts` (mirror `onProvidersChanged` for the listener) and mirror signatures in `src/renderer/src/hv.d.ts` with a local `McpServerStatusLike`.
- [ ] **Step 2: UI.** In `McpServersSection.tsx`: on mount call `mcpStatus()` + subscribe `onMcpStatusChanged`; key statuses by `${scope}:${workspaceId ?? ""}:${name}`. Per row (after the scope badge ~line 68) render a **status badge** — connected (leaf), needs-auth (honey), failed (berry), checking (muted) — with tool count (`connected` → "N tools"). Add a **Reconnect** button calling `mcpCheck(scope, scope==="workspace"?workspaceId:null, name)`. Reuse the `PERM_TONE`-style palette from `AgentsView.tsx`.
- [ ] **Step 3: Gate + commit.** `npx tsc --noEmit -p tsconfig.web.json`; `npm run build`; commit `feat(mcp): Agents & Tools — per-server MCP status badges + reconnect`.

---

### Task 5: Phase 1 verification + docs

**Files:** `docs/validation/m1.md`, `CLAUDE.md`

- [ ] **Step 1:** Append to `docs/validation/m1.md` the headless-auth finding: adapter gates interactive OAuth on `ctx.hasUI` (`commands.ts:139`), its structured actions are tool-only, Pi RPC has no tool-exec verb → HappyVibe main owns MCP management (connect/list/status via `@modelcontextprotocol/sdk`); adapter stays runtime path; shared state is the on-disk `AuthEntry`.
- [ ] **Step 2:** CLAUDE.md — extend the MCP gotcha: "MCP management (connect/list/status/auth) lives in main (`src/main/mcp*.ts`, `@modelcontextprotocol/sdk`), not the adapter (its OAuth is TUI-gated in RPC). Main and adapter share only the on-disk token store `<agentDir>/mcp-oauth/…`."
- [ ] **Step 3: Full gate.** Both typechecks; non-live suite excluding the 8 live files; live files batched (incl. `mcp-bridge`); `npm run build`. Report actual counts.
- [ ] **Step 4: Commit** `docs(mcp): m1.md + CLAUDE.md — main-side management client (phase 1)`.

---

## Phase 2 (separate wave — not in this file yet)
OAuth (`src/main/mcpOAuth.ts`: SDK `OAuthClientProvider` backed by `mcpAuthStore`, main-hosted callback + `openExternal`), `hv:mcp-authenticate`/`hv:mcp-logout`, add-time confirm-with-tools modal, mock-OAuth fixture test, and the `tests/mcp-adapter-authformat.test.ts` contract test (adapter pin-bump gate). Authored after Phase 1 lands + verifies.
