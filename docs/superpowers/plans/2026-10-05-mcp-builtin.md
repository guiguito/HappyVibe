# MCP on Pi's built-in MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vendored `pi-mcp-adapter` with Pi 1.0's built-in MCP (`builtin:mcp` + `builtin:tool-search`), with the same servers, the same permission rules and no keychain — gated by a one-day Phase 0 spike.

**Architecture:** Pi runs MCP inside each chat session; the bridge maps every `mcp__<ns>__<tool>` call to the existing `mcp:<server>_<tool>` rule name and registers workspace `.mcp.json` servers with `pi.registerMcpServer()`. Main stops being an MCP client: global servers are managed through `pi mcp list --json | login | logout`, workspace servers through `/mcp` over RPC to a short-lived Pi in that workspace. A pure module translates adapter-era config keys in both places.

**Tech Stack:** TypeScript 7, Electron main + React renderer, Pi 1.0.2 (`--mode rpc`, NDJSON), vitest (no DOM).

**Spec:** Notion "🔌 MCP: move from pi-mcp-adapter to Pi's built-in MCP" (`3f0d33dfffca8156a6e3d34bb32e6ec4`, locked 2026-10-05, decisions 1–17) and `docs/prd.md` §13 **Decision (2026-10-05)**. Pi's own docs: `pi-runtime/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md`.

## Global Constraints

- **Phase 0 is a gate.** Nothing after Task 0.4 starts without Guilhem's GO. NO-GO = stay on adapter 2.35.0, stop the plan.
- Pass line (decision 2): 4 sessions × 3 servers (1 `npx` stdio, 2 remote) adds **≤ ~1 GB memory over the adapter on the same setup**; session start not visibly slower.
- Default exposure is `"deferred"` (decision 3). Codemode is **not** loaded. "Expose tools directly" writes `"exposure": "direct"`.
- Rule names stay `mcp:<server>_<tool>` with the adapter's spelling (decision 9) — never parse `mcp__a__b` for gating; use `ToolInfo.namespace`.
- Only chat sessions load MCP (decision 11): utility client and one-shots never get `builtin:mcp`.
- Bridge stays the LAST `-e` (spawn.ts comment, `tests/mcp-spawn.test.ts`).
- A server hint never allows on its own (decision 7): it only turns Plan mode's floor-ask into `pass`.
- Every `.ts` the renderer imports stays Node-free; `hv-*.ts` shared modules import nothing (CLAUDE.md "Import hygiene").
- Generated files: adding/removing `throw new Error("…")` → `npm run catalog:crash-messages`; Phase 3 pi-ai move → `npm run catalog:providers`.
- Commits: `git commit -s`. Never pipe a test run to `tail`/`grep` — redirect to `$L` then read.
- Test command form: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- Copy: no `⌘`, no "your Mac" (`platformCopy.ts`). User-guide pages change in the same commit as the screen.

## Review Focus

1. **A cloned repo's `.mcp.json` carrying `"auth": {"provider": "openai"}`** — Pi refuses `auth` in project files (`config.js:94`) but not through `registerMcpServer()`, so without a strip the user's provider token goes to a URL the repo chose. Expected: the bridge drops `auth` before registering. Test: Task 1 (`workspaceRegistrations`) + Task 5 gate test arm.
2. **A hand-written global entry Pi rejects** (`"type": "sse"`, `"auth": "bearer"` left by a third-party tool, bad URL) — Pi skips it and lists it only in `errors[]`. Expected: the row stays on the MCP page with Pi's message, never silently vanishes. Test: Task 8 (`statusFromList` + `configErrorFor`).
3. **A catalog server whose secret was deleted** — `${HV_MCP_X_KEY}` unset makes Pi throw "Failed to resolve…" at connect (the adapter sent an empty string). Expected: the row says failed with that message, not "needs sign-in". Test: Task 8.
4. **Removing a signed-in global server** — `pi mcp logout <name>` finds servers by name in `mcp.json`, so logging out after the entry is gone fails and orphans the token in `mcp-auth.json`. Expected: logout runs first, then the write. Test: Task 10 (`removeServerInOrder`).
5. **Server name with a dash** (`chrome-devtools`, a catalog entry) with a stored rule `mcp:chrome-devtools_*` — Pi's tool is `mcp__chrome_devtools__take_screenshot`. Expected: the existing rule still matches, no new prompt. Test: Task 4 (`mcpCallInfo`) + Task 2 (`migrateMcpRules`).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `pi-runtime/extensions/hv-mcp-config.ts` | **new**, pure | adapter-shape → Pi-shape entry translation; workspace registrations (auth strip) |
| `pi-runtime/extensions/hv-mcp.ts` | **rewrite**, pure | Pi MCP tool → rule name, factual display, server hint |
| `pi-runtime/extensions/happyvibe-bridge.ts` | modify | register workspace servers, gate Pi MCP calls, envelope `serverHint`, intent re-key, `/hv-tools` `checkedAs`, `/hv-mcp-tools` |
| `pi-runtime/extensions/hv-rules.ts` | modify | `tool_search` + resource list tools in `SAFE_TOOLS` |
| `pi-runtime/extensions/hv-plan.ts`, `hv-readonly.ts` | modify | `mcpReadOnly` pass; manage block removed |
| `src/main/pi/spawn.ts` | modify | `mcp` option → `-e builtin:mcp -e builtin:tool-search`, `HV_MCP=1` |
| `src/main/mcp.ts` | modify | Pi-shape config type; off = `enabled: false`; writes translate |
| `src/main/mcpMigrate.ts` | **new** | launch migration of global `mcp.json` + stored rules |
| `src/main/mcpPi.ts` | **new**, electron-free | `pi mcp list/login/logout` runner + parsers + status mapping |
| `src/main/mcpWorkspaceProbe.ts` | **new**, electron-free | short-lived Pi per workspace: `/mcp`, `/hv-mcp-tools`, `/mcp login|logout` |
| `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts` | modify | status map + handlers rewired; sign-in events |
| `src/main/index.ts`, `src/main/config.ts` | modify | run migration before `registerIpc`; `mcpRulesMigrated` flag |
| `src/main/plugins/install.ts` | modify | plugin servers written `enabled: false`, no `auth` |
| `src/main/usage/features.ts` | modify | `mcp__*` counted as MCP |
| `src/main/mcpCatalog.ts` | modify | install writes `description: entry.tagline` |
| renderer: `toolLabel.ts`, `agents.ts`, `AllToolsView.tsx`, `permission.ts`, `PermissionModal.tsx`, `McpServersSection.tsx`, `McpCatalogSection.tsx` | modify | cards, All Tools, prompt hint, MCP page |
| **deleted** | — | `mcpOAuth.ts`, `mcpAuthStore.ts`, `mcpAdapterStore.ts`, `mcpClient.ts`, `mcpResolve.ts`, `plugins/mcpImport.ts`, `pi-runtime/bin/mcp-oauth-bridge.src.mjs`, `scripts/build-mcp-oauth-bridge.mjs`, adapter-pinning tests |

---

# Phase 0 — spike (1 day, ends in GO / NO-GO)

Nothing in Phase 0 changes `src/`. Spike scripts live in `scripts/spike/` and are labelled throwaway; results go to a new `docs/validation/mcp2.md`.

### Task 0.1: Key-free permission test on Pi's MCP (kept)

**Files:**
- Create: `tests/fixtures/faux-model.ts` (a scripted model, loaded with `-e` before the bridge)
- Modify: `tests/fixtures/mcp-echo-server.mjs` (append a line to `$ECHO_CALL_LOG` per `tools/call`)
- Create: `tests/mcp-builtin-gate.test.ts`

**Interfaces:**
- Produces: `tests/fixtures/faux-model.ts` reading `HV_TEST_RUNTIME` (abs `pi-runtime` path) and `HV_FAUX_STEPS` (JSON `Array<{tool?: string; args?: object; text?: string}>`); registers provider `faux`, model `script`. Reused by Tasks 5 and 9.

- [ ] **Step 1: Echo fixture logs calls**

In `tests/fixtures/mcp-echo-server.mjs`, add `import fs from "node:fs";` and, in the `tools/call` branch before `send(...)`:

```js
if (process.env.ECHO_CALL_LOG) fs.appendFileSync(process.env.ECHO_CALL_LOG, `${text}\n`);
```

- [ ] **Step 2: Faux model fixture**

```ts
// tests/fixtures/faux-model.ts — a scripted model so a turn runs with NO key.
// Loaded with -e BEFORE the bridge. pi-ai is nested under pi-coding-agent while
// pi-mcp-adapter pins a stale top-level copy (.claude/rules/providers.md); after
// Phase 3 removes the adapter the nested copy is hoisted — so try both.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function (pi: { registerProvider(p: unknown): void }): Promise<void> {
  const rt = process.env.HV_TEST_RUNTIME!;
  const nested = path.join(rt, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js");
  const top = path.join(rt, "node_modules/@earendil-works/pi-ai/dist/index.js");
  const ai = await import(pathToFileURL(fs.existsSync(nested) ? nested : top).href);
  const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "script" }] });
  const steps = JSON.parse(process.env.HV_FAUX_STEPS ?? "[]") as Array<{ tool?: string; args?: object; text?: string }>;
  faux.setResponses(steps.map((s) => ai.fauxAssistantMessage(s.tool ? ai.fauxToolCall(s.tool, s.args ?? {}) : (s.text ?? "done"))));
  pi.registerProvider(faux.provider);
}
```

(If `fauxAssistantMessage` does not infer `stopReason: "toolUse"` from a tool-call block, pass `{ stopReason: "toolUse" }` — read `pi-ai/dist/providers/faux.js` once and match it.)

- [ ] **Step 3: Write the test (phase-0 assertions: raw tool name)**

```ts
// tests/mcp-builtin-gate.test.ts — key-free: Pi's built-in MCP + the real bridge.
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");
const echo = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
let client: PiClient | undefined;
afterEach(() => client?.stop());

function boot(tmp: string, steps: object[]): PiClient {
  return new PiClient({
    execPath: process.execPath,
    args: [path.join(runtime, PI_CLI_RELPATH), "--mode", "rpc", "--no-session",
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"),
      "-e", "builtin:mcp", "-e", "builtin:tool-search",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "faux", "--model", "script"],
    env: { ...process.env, HOME: tmp, PI_CODING_AGENT_DIR: path.join(tmp, "agent"),
      HV_TEST_RUNTIME: runtime, HV_FAUX_STEPS: JSON.stringify(steps),
      ECHO_CALL_LOG: path.join(tmp, "calls.log") } as Record<string, string>,
    cwd: tmp,
  });
}

test("a deferred MCP call raises hv.permission; Deny never reaches the server", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcpb-"));
  fs.mkdirSync(path.join(tmp, "agent"));
  fs.writeFileSync(path.join(tmp, "agent/mcp.json"), JSON.stringify({ mcpServers: {
    echo: { command: process.execPath, args: [echo], exposure: "deferred" } } }));
  client = boot(tmp, [
    { tool: "tool_search", args: { query: "echo" } },
    { tool: "mcp__echo__echo", args: { text: "hi" } },
    { text: "done" },
  ]);
  const prompts: Array<{ tool: string; summary: string }> = [];
  client.on("ui-request", (m: { id: string; method?: string; title?: string }) => {
    if (m.method !== "select") return;
    const t = JSON.parse(m.title ?? "{}");
    if (t.kind !== "hv.permission") return;
    prompts.push(t);
    client!.respondUi(m.id, { value: "Deny" });
  });
  await client.start();
  await client.send({ type: "prompt", message: "go" });
  await new Promise<void>((r) => client!.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
  // Phase 0: the bridge does not know Pi's MCP yet, so it gates the raw name. Task 5 tightens this.
  expect(prompts.map((p) => p.tool)).toEqual(["mcp__echo__echo"]); // tool_search raised none? see Step 4
  expect(fs.existsSync(path.join(tmp, "calls.log"))).toBe(false);
}, 60_000);
```

Check the Deny answer shape against an existing permission test (`tests/permission-*.test.ts`) and match it exactly.

- [ ] **Step 4: Run it, record what really happens**

Run: `L=/tmp/vitest.log; npx vitest run tests/mcp-builtin-gate.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected at Phase 0: `tool_search` ALSO prompts (it is not in `SAFE_TOOLS` yet), so the first assertion fails with `["tool_search", …]` or the turn stops at the denied search. Change the steps' Deny policy to Allow for `tool_search` (answer `{ value: "Allow" }` when `t.tool === "tool_search"`), rerun, and confirm: one prompt for `mcp__echo__echo`, no `calls.log`. Record the raw envelopes in `docs/validation/mcp2.md` §"Gate".

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/faux-model.ts tests/fixtures/mcp-echo-server.mjs tests/mcp-builtin-gate.test.ts docs/validation/mcp2.md
git commit -s -m "test(mcp): key-free gate test on Pi's built-in MCP (phase 0)"
```

### Task 0.2: Processes, memory and start time — adapter vs Pi

**Files:**
- Create: `scripts/spike/mcp-footprint.mjs` (throwaway)
- Modify: `docs/validation/mcp2.md` §"Footprint"

- [ ] **Step 1: Write the measurement script.** It takes `--arm adapter|builtin`, a temp agent dir whose `mcp.json` holds 3 servers — `chrome-devtools` (`npx -y chrome-devtools-mcp@latest`, stdio), `context7` (remote, key header) and `deepwiki` or any no-auth remote — and opens **4** RPC Pis with the faux model (`-e tests/fixtures/faux-model.ts`, no turn), each in its own temp workspace. Arm `adapter`: `-e <runtime>/node_modules/pi-mcp-adapter/index.ts`; arm `builtin`: `-e builtin:mcp -e builtin:tool-search` with `exposure: "deferred"`. For each Pi it records the ms from spawn to the first `get_state` response, waits 20 s, then sums RSS over each Pi's process tree (`ps -A -o pid=,ppid=,rss=` walked from the Pi pid) and counts processes. Print one JSON line per arm.

- [ ] **Step 2: Run both arms 3× interleaved** (adapter, builtin, adapter, …) — `node scripts/spike/mcp-footprint.mjs --arm adapter > /tmp/fp-a1.json` etc. Before running: `pgrep -fl electron-vite` must print nothing (a running app skews RSS).

- [ ] **Step 3: Record** median RSS per arm, delta, process counts and start times in `docs/validation/mcp2.md` §"Footprint", with the verdict against the pass line (≤ ~1 GB delta, start time not visibly slower — state the ms).

- [ ] **Step 4: Commit** `git commit -s -m "docs(validation): phase-0 MCP footprint, adapter vs built-in"`.

### Task 0.3: Tokens per request — adapter proxy vs `deferred` + `tool_search`

**Files:** Modify `docs/validation/mcp2.md` §"Tokens"; reuse `scripts/spike/mcp-footprint.mjs` with `--context`.

- [ ] **Step 1:** In each arm, after boot send `/hv-context` and read `system.toolDefs` and the system-prompt size from the bridge's `hv.context` notify (same method as the 2026-10-05 tool-weight measurement: chars/4). Adapter arm: `mcp` + `mcpScript` rows. Built-in arm: `tool_search` + the `<mcp_servers>` section.
- [ ] **Step 2:** Record both numbers. This is the **static per-request** cost only; a per-task claim (search round trips) needs interleaved live arms and a p-value (CLAUDE.md) and is out of Phase 0.
- [ ] **Step 3: Commit** with Task 0.2's file if same day.

### Task 0.4: Sign-in end to end + GO / NO-GO

**Files:** Modify `docs/validation/mcp2.md` §"Sign-in", §"Verdict"; Notion page callout.

- [ ] **Step 1:** With a temp `PI_CODING_AGENT_DIR` holding `{"mcpServers":{"linear":{"url":"https://mcp.linear.app/mcp","exposure":"direct"}}}`, run `node pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp login linear < /dev/null`. Record: the exact stdout line with the URL, that the browser opened, the exit code, `mcp-auth.json` mode (`stat -f %Lp`), and its key format.
- [ ] **Step 2:** Start an RPC Pi (faux model, `-e builtin:mcp`) **before** signing in, sign in from the shell, then send a turn whose faux step calls a Linear tool. Record whether the running session used the new credentials **without a respawn** (decision 12's open question).
- [ ] **Step 3:** `grep -rn "elicitation" src/ pi-runtime/extensions/` — record that no shipped flow depends on it.
- [ ] **Step 4: Verdict.** Write GO or NO-GO with the numbers in `docs/validation/mcp2.md` §"Verdict", update the Notion page callout, commit, and **STOP: ask Guilhem for GO.** On NO-GO, also write the upstream "lazy start" request text into §"Verdict" for Guilhem to file.

---

# Phase 1 — runtime swap

### Task 1: Pure config translation (`hv-mcp-config.ts`)

**Files:**
- Create: `pi-runtime/extensions/hv-mcp-config.ts`
- Modify: `tsconfig.node.json` (add the file to `include`, beside `hv-rules.ts`)
- Test: `tests/hv-mcp-config.test.ts`

**Interfaces:**
- Produces: `type McpEntry = Record<string, unknown>`; `DEFAULT_EXPOSURE = "deferred"`; `toPiEntry(entry): { entry: McpEntry; changed: boolean }`; `isOff(entry): boolean`; `workspaceRegistrations(raw: unknown): { servers: Array<[string, McpEntry]>; errors: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/hv-mcp-config.test.ts
import { describe, expect, test } from "vitest";
import { isOff, toPiEntry, workspaceRegistrations } from "../pi-runtime/extensions/hv-mcp-config";

describe("toPiEntry", () => {
  test("adds the deferred default and nothing else to a plain entry", () => {
    expect(toPiEntry({ command: "npx", args: ["x"] })).toEqual({ entry: { command: "npx", args: ["x"], exposure: "deferred" }, changed: true });
  });
  test("is idempotent", () => {
    const once = toPiEntry({ url: "https://a/mcp", directTools: true }).entry;
    expect(toPiEntry(once)).toEqual({ entry: once, changed: false });
  });
  test("disabled:true becomes enabled:false; disabled:false just goes", () => {
    expect(toPiEntry({ url: "https://a/mcp", disabled: true }).entry).toEqual({ url: "https://a/mcp", enabled: false, exposure: "deferred" });
    expect(toPiEntry({ url: "https://a/mcp", disabled: false }).entry).toEqual({ url: "https://a/mcp", exposure: "deferred" });
  });
  test("directTools true → direct; a list → per-tool direct", () => {
    expect(toPiEntry({ url: "u", directTools: true }).entry).toMatchObject({ exposure: "direct" });
    expect(toPiEntry({ url: "u", directTools: ["a", "b"] }).entry).toMatchObject({ exposure: "deferred", toolExposure: { a: "direct", b: "direct" } });
  });
  test("excludeTools → hidden; includeTools → hidden server + listed tools reachable", () => {
    expect(toPiEntry({ url: "u", excludeTools: ["rm"] }).entry).toMatchObject({ toolExposure: { rm: "hidden" } });
    expect(toPiEntry({ url: "u", includeTools: ["get"] }).entry).toMatchObject({ exposure: "hidden", toolExposure: { get: "deferred" } });
  });
  test("bearer keys become an Authorization header, unless one exists", () => {
    expect(toPiEntry({ url: "u", bearerTokenEnv: "TOK" }).entry).toMatchObject({ headers: { Authorization: "Bearer ${TOK}" } });
    expect(toPiEntry({ url: "u", bearerToken: "x", headers: { authorization: "Bearer y" } }).entry.headers).toEqual({ authorization: "Bearer y" });
  });
  test("adapter auth strings and oauth:false are dropped (Pi rejects the whole entry)", () => {
    const e = toPiEntry({ url: "u", auth: "oauth", oauth: false }).entry;
    expect(e).not.toHaveProperty("auth");
    expect(e).not.toHaveProperty("oauth");
  });
  test("unknown keys survive", () => {
    expect(toPiEntry({ url: "u", origin: { plugin: "p" }, lifecycle: "lazy" }).entry).toMatchObject({ origin: { plugin: "p" }, lifecycle: "lazy" });
  });
});

test("isOff reads both spellings", () => {
  expect(isOff({ enabled: false })).toBe(true);
  expect(isOff({ disabled: true })).toBe(true);
  expect(isOff({})).toBe(false);
});

describe("workspaceRegistrations", () => {
  test("strips auth — a repository must not pick where a provider token goes", () => {
    const { servers } = workspaceRegistrations({ mcpServers: { x: { url: "https://evil/mcp", auth: { provider: "openai" } } } });
    expect(servers).toEqual([["x", { url: "https://evil/mcp", exposure: "deferred" }]]);
  });
  test("bad names and non-objects are reported, not registered", () => {
    const r = workspaceRegistrations({ mcpServers: { "a b": { url: "u" }, ok: 3 } });
    expect(r.servers).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
  test("garbage file → nothing", () => {
    expect(workspaceRegistrations("nope")).toEqual({ servers: [], errors: [] });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `L=/tmp/vitest.log; npx vitest run tests/hv-mcp-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement**

```ts
/**
 * MCP server entries: the shape pi-mcp-adapter read → the shape Pi's built-in MCP reads
 * (PRD §13, Decision 2026-10-05). PURE, zero imports: main runs it on the global
 * <agentDir>/mcp.json at launch (persisted), the bridge on a workspace .mcp.json at
 * registration (in memory — a repo file is never rewritten).
 *
 * Pi ignores unknown keys (so `disabled`/`excludeTools` silently stop working) and
 * REJECTS a non-object `auth`, `oauth: false` and SSE, skipping the whole entry
 * (core/mcp-servers.js validateMcpServerConfig). Both failure modes are handled here.
 */
export type McpEntry = Record<string, unknown>;
export const DEFAULT_EXPOSURE = "deferred";
export const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

export function isOff(e: McpEntry | undefined): boolean {
  return e?.enabled === false || e?.disabled === true;
}

export function toPiEntry(input: McpEntry): { entry: McpEntry; changed: boolean } {
  const e: McpEntry = { ...input };
  const te: Record<string, string> = isRecord(e.toolExposure) ? { ...(e.toolExposure as Record<string, string>) } : {};
  let touchedTe = false;
  if ("disabled" in e) {
    if (e.disabled === true) e.enabled = false;
    delete e.disabled;
  }
  if ("directTools" in e) {
    if (e.directTools === true && e.exposure === undefined) e.exposure = "direct";
    for (const n of names(e.directTools)) { te[n] ??= "direct"; touchedTe = true; }
    delete e.directTools;
  }
  if ("includeTools" in e) {
    const inc = names(e.includeTools);
    if (inc.length) {
      const reach = typeof e.exposure === "string" && e.exposure !== "hidden" ? e.exposure : DEFAULT_EXPOSURE;
      for (const n of inc) { te[n] ??= reach; touchedTe = true; }
      e.exposure = "hidden";
    }
    delete e.includeTools;
  }
  if ("excludeTools" in e) {
    for (const n of names(e.excludeTools)) { te[n] = "hidden"; touchedTe = true; }
    delete e.excludeTools;
  }
  const headers = isRecord(e.headers) ? (e.headers as Record<string, string>) : undefined;
  const hasAuthHeader = !!headers && Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
  const bearer = typeof e.bearerToken === "string" && e.bearerToken ? e.bearerToken
    : typeof e.bearerTokenEnv === "string" && e.bearerTokenEnv ? `\${${e.bearerTokenEnv}}` : undefined;
  if (bearer && !hasAuthHeader) e.headers = { ...(headers ?? {}), Authorization: `Bearer ${bearer}` };
  delete e.bearerToken;
  delete e.bearerTokenEnv;
  delete e.bearerTokenStore; // keychain-held: Pi cannot read it; the server asks to sign in instead
  if ("auth" in e && !isRecord(e.auth)) delete e.auth;
  if (e.oauth === false) delete e.oauth;
  if (touchedTe) e.toolExposure = te;
  if (e.exposure === undefined) e.exposure = DEFAULT_EXPOSURE;
  return { entry: e, changed: JSON.stringify(e) !== JSON.stringify(input) };
}

export function workspaceRegistrations(raw: unknown): { servers: Array<[string, McpEntry]>; errors: string[] } {
  const servers: Array<[string, McpEntry]> = [];
  const errors: string[] = [];
  const all = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : {};
  for (const [name, cfg] of Object.entries(all)) {
    if (!SERVER_NAME.test(name) || !isRecord(cfg)) { errors.push(`${name}: not a valid server entry`); continue; }
    const { entry } = toPiEntry(cfg);
    // Pi refuses `auth` (a /login provider's token) in PROJECT files so a repository cannot
    // pick where the credential goes (extensions/mcp/config.js:94) — registerMcpServer()
    // has no such check, and a cloned repo's .mcp.json reaches Pi through it.
    delete entry.auth;
    servers.push([name, entry]);
  }
  return { servers, errors };
}
```

- [ ] **Step 4: Run, expect PASS.** Same command.
- [ ] **Step 5: Commit** `git add pi-runtime/extensions/hv-mcp-config.ts tests/hv-mcp-config.test.ts tsconfig.node.json && git commit -s -m "feat(mcp): translate adapter-era server entries to Pi's shape"`

### Task 2: Main config, launch migration, plugin import

**Files:**
- Modify: `src/main/mcp.ts` (type, `isMcpServerOff`, `withoutOffFlag`, `writeMcpServer` translates)
- Create: `src/main/mcpMigrate.ts`
- Modify: `src/main/config.ts` (`getMcpRulesMigrated`/`setMcpRulesMigrated`, mirror `getGitRulesSeeded` at :316)
- Modify: `src/main/index.ts:468` (after the git-rules seed, before `registerIpc`)
- Modify: `src/main/plugins/install.ts:34-36`; delete `src/main/plugins/mcpImport.ts`; `src/main/ipc.ts:7039` (analytics: pass `cfg` directly)
- Test: `tests/mcp-migrate.test.ts` (new), `tests/mcp-config.test.ts`, `tests/plugin-install.test.ts`; delete `tests/mcp-plugin-import-auth.test.ts`

**Interfaces:**
- Consumes: `toPiEntry`, `isOff` (Task 1).
- Produces: `migrateGlobalMcpFile(file: string): boolean` (true = rewrote); `migrateMcpRules(rules: RulesFile, servers: string[]): { rules: RulesFile; changed: boolean }`; `McpServerConfig` gains `enabled?`, `exposure?`, `toolExposure?`, `description?` and loses `directTools`/`disabled`.

- [ ] **Step 1: Failing tests**

```ts
// tests/mcp-migrate.test.ts
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateGlobalMcpFile, migrateMcpRules } from "../src/main/mcpMigrate";

test("global file: translated in place, top-level keys kept, second run is a no-op", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-mig-")), "mcp.json");
  fs.writeFileSync(f, JSON.stringify({ settings: { x: 1 }, mcpServers: { miro: { url: "https://mcp.miro.com/", auth: "oauth", disabled: true, origin: { plugin: "miro" } } } }));
  expect(migrateGlobalMcpFile(f)).toBe(true);
  expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({ settings: { x: 1 }, mcpServers: { miro: { url: "https://mcp.miro.com/", enabled: false, origin: { plugin: "miro" }, exposure: "deferred" } } });
  expect(migrateGlobalMcpFile(f)).toBe(false);
});

test("missing or unreadable file: no write, no throw", () => {
  expect(migrateGlobalMcpFile(path.join(os.tmpdir(), "nope-hv", "mcp.json"))).toBe(false);
});

test("rules: dash-server rules keep the configured name; tool part is spelled like Pi; manage rules go", () => {
  const rules = { global: [
    { layer: "tool", pattern: "mcp:chrome-devtools_*", action: "allow" },
    { layer: "tool", pattern: "mcp:linear_get-issue", action: "allow" },
    { layer: "tool", pattern: "mcp-manage:install:*", action: "deny" },
    { layer: "tool", pattern: "bash", action: "ask" },
  ], workspaces: {} };
  const { rules: out, changed } = migrateMcpRules(rules as never, ["chrome-devtools", "linear"]);
  expect(changed).toBe(true);
  expect(out.global.map((r: { pattern: string }) => r.pattern)).toEqual(["mcp:chrome-devtools_*", "mcp:linear_get_issue", "bash"]);
});
```

Add to `tests/mcp-config.test.ts`: `isMcpServerOff({ enabled: false })` is true; `withoutOffFlag({ url: "u", enabled: false, disabled: true })` returns `{ url: "u" }`; `writeMcpServer(f, "a", { command: "x" })` writes `exposure: "deferred"`. In `tests/plugin-install.test.ts`, the written entry has `enabled: false`, `origin`, and **no** `auth`.

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-migrate.test.ts tests/mcp-config.test.ts tests/plugin-install.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement**

`src/main/mcp.ts` — replace the interface fields and the two helpers; translate on write:

```ts
import { isOff, toPiEntry } from "../../pi-runtime/extensions/hv-mcp-config";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Pi's off switch: only literal false (core/mcp-servers.js). */
  enabled?: boolean;
  exposure?: "deferred" | "direct" | "codemode" | "hidden";
  toolExposure?: Record<string, string>;
  /** One line; Pi lists it for the model and ranks tool_search by it. */
  description?: string;
  [k: string]: unknown;
}

/** An off server (a plugin's, until Connect) is never probed and never started. */
export function isMcpServerOff(cfg: McpServerConfig | undefined): boolean {
  return isOff(cfg);
}

export function withoutOffFlag(cfg: McpServerConfig): McpServerConfig {
  const on = { ...cfg };
  delete on.enabled;
  delete on.disabled;
  return on;
}
```

In `writeMcpServer`, change `if (cfg) cur.mcpServers[name] = cfg;` to `if (cfg) cur.mcpServers[name] = toPiEntry(cfg).entry as McpServerConfig;`. Update the file's header comment: "the shape Pi's built-in MCP reads".

`src/main/mcpMigrate.ts`:

```ts
/**
 * §13 (2026-10-05): one launch-time pass over what the adapter era left behind.
 * The global mcp.json is translated EVERY launch (idempotent — a hand-added entry
 * without `exposure` gets "deferred", or Pi defaults it to codemode, which we don't
 * load). Stored permission rules are migrated once (config flag).
 */
import fs from "node:fs";
import { toPiEntry } from "../../pi-runtime/extensions/hv-mcp-config";
import type { RulesFile } from "../../pi-runtime/extensions/hv-rules";

export function migrateGlobalMcpFile(file: string): boolean {
  let raw: { mcpServers?: Record<string, Record<string, unknown>>; [k: string]: unknown };
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return false; }
  if (!raw || typeof raw.mcpServers !== "object" || raw.mcpServers === null) return false;
  let changed = false;
  for (const [name, cfg] of Object.entries(raw.mcpServers)) {
    if (!cfg || typeof cfg !== "object") continue;
    const r = toPiEntry(cfg);
    if (r.changed) { raw.mcpServers[name] = r.entry; changed = true; }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  return changed;
}

/** Pi spells every char outside [A-Za-z0-9_] as `_`; the adapter kept `-` in tool names.
    The server part stays the configured name (longest match wins). mcp-manage:* rules
    named a surface that no longer exists (the model cannot install or sign in). */
export function migrateMcpRules(rules: RulesFile, servers: string[]): { rules: RulesFile; changed: boolean } {
  const byLength = [...servers].sort((a, b) => b.length - a.length);
  let changed = false;
  const fix = (list: RulesFile["global"]): RulesFile["global"] =>
    list.flatMap((r) => {
      if (r.layer !== "tool") return [r];
      if (r.pattern.startsWith("mcp-manage:")) { changed = true; return []; }
      if (!r.pattern.startsWith("mcp:")) return [r];
      const rest = r.pattern.slice(4);
      const s = byLength.find((n) => rest.startsWith(`${n}_`));
      if (!s) return [r];
      const next = `mcp:${s}_${rest.slice(s.length + 1).replace(/[^A-Za-z0-9_*]/g, "_")}`;
      if (next === r.pattern) return [r];
      changed = true;
      return [{ ...r, pattern: next }];
    });
  const out: RulesFile = { global: fix(rules.global), workspaces: Object.fromEntries(Object.entries(rules.workspaces).map(([k, v]) => [k, fix(v)])) };
  return { rules: out, changed };
}
```

(Check `RulesFile`/`Rule` field names in `hv-rules.ts:15-27` and adjust `layer`/`pattern` if spelled differently.)

`src/main/index.ts`, right after the git-rules seed block:

```ts
  // §13 (2026-10-05): Pi's built-in MCP reads <agentDir>/mcp.json directly, so the
  // adapter-era keys are translated before the first spawn — every launch, idempotent.
  migrateGlobalMcpFile(path.join(agentDir(), "mcp.json"))
  if (!getMcpRulesMigrated()) {
    const servers = [agentDir() + "/mcp.json", ...listWorkspaces().map((w) => path.join(w, ".mcp.json"))]
      .flatMap((f) => Object.keys(readMcpFile(f).mcpServers))
    const cur = parseRulesFile(fs.existsSync(rulesFile()) ? fs.readFileSync(rulesFile(), "utf8") : "{}")
    const { rules, changed } = migrateMcpRules(cur, servers)
    if (changed) fs.writeFileSync(rulesFile(), JSON.stringify(rules, null, 2))
    setMcpRulesMigrated(true)
  }
```

(Use whatever `index.ts` already imports for the workspace list and `parseRulesFile`'s real signature; if the workspace registry isn't available before `registerIpc`, read the store the same way `registerIpc` does.)

`src/main/plugins/install.ts:34-36`:

```ts
  return { ...cfg, origin: pluginOrigin(plugin, marketplace), enabled: false };
```

Delete `src/main/plugins/mcpImport.ts` and `tests/mcp-plugin-import-auth.test.ts` (Pi starts OAuth on a 401 whenever there is no `Authorization` header — a vendor tag like Miro's `X-AI-Source` no longer blocks it, `docs/mcp.md` "OAuth applies to HTTP servers without an Authorization header"). At `ipc.ts:7039` pass the raw cfg to `mcpParams`.

- [ ] **Step 4: Run, expect PASS** (same command), then `npm run build` (typechecks catch every `cfg.disabled`/`directTools` reader — fix each: renderer readers move in Task 11, so for now change `McpServersSection.tsx:322` to `s.cfg.enabled === false` and `:549/566-568` to read/write `exposure: "direct"`/`enabled`).
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp): launch migration to Pi's config shape; plugin servers off via enabled:false"`

### Task 3: Spawn — built-ins for chat sessions only

**Files:**
- Modify: `src/main/pi/spawn.ts:37-38` (constant), `:170-205` (args), `:247-291` (env), `PiSpawnOptions` (`mcp?: boolean`)
- Modify: `src/main/ipc.ts:1103` (chat spawn passes `mcp: true`); utility spawn `:1262` unchanged
- Test: `tests/mcp-spawn.test.ts` (rewrite), `tests/tw-spawn.test.ts:19`, `tests/resource-gate-contract.test.ts` (new arm), `tests/mcp-bridge.test.ts:6,32` (imports only)

**Interfaces:**
- Produces: `PI_MCP_EXTENSIONS: readonly ["-e","builtin:mcp","-e","builtin:tool-search"]`; `PiSpawnOptions.mcp?: boolean`; env `HV_MCP=1` when set. `PI_MCP_ADAPTER_RELPATH` is deleted.

- [ ] **Step 1: Failing tests** — `tests/mcp-spawn.test.ts`:

```ts
import { expect, test } from "vitest";
import { PI_MCP_EXTENSIONS, resolvePiSpawn } from "../src/main/pi/spawn";

const args = (mcp?: boolean) => resolvePiSpawn("/w", "/s", "/rt", { mcp }).args;

test("chat sessions load Pi's MCP and tool search, before the bridge", () => {
  const a = args(true);
  const i = a.indexOf("builtin:mcp");
  expect(a.slice(i - 1, i + 3)).toEqual([...PI_MCP_EXTENSIONS]);
  expect(i).toBeLessThan(a.findIndex((x) => x.endsWith("happyvibe-bridge.ts")));
  expect(resolvePiSpawn("/w", "/s", "/rt", { mcp: true }).env.HV_MCP).toBe("1");
});

test("the utility client and anything without the flag load no MCP", () => {
  expect(args()).not.toContain("builtin:mcp");
  expect(args()).not.toContain("builtin:tool-search");
  expect(resolvePiSpawn("/w", "/s", "/rt", {}).env.HV_MCP).toBeUndefined();
  expect(args().some((x) => x.includes("pi-mcp-adapter"))).toBe(false);
});
```

`tests/resource-gate-contract.test.ts`: add an arm beside the GATED one — spawn with `resolvePiSpawn(…, { mcp: true, agentDir: tmp })`, `get_commands`, assert `loaded.builtin` equals `["builtin:mcp"]` (tool-search registers a tool, not a command). Update the `:144-145` comment (the adapter is gone; the additive half now keeps `-e builtin:*` working). `tests/tw-spawn.test.ts:19`: tintinweb before `builtin:mcp`. `tests/mcp-bridge.test.ts`: replace the adapter import/arg with `...PI_MCP_EXTENSIONS` (behaviour rewritten in Task 5).

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-spawn.test.ts tests/tw-spawn.test.ts tests/resource-gate-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- [ ] **Step 3: Implement** — in `spawn.ts` replace the adapter constant and its `-e` with:

```ts
/** §13 (2026-10-05): Pi's built-in MCP + tool search. --no-extensions keeps every built-in
    off; these load additively. Chat sessions only — the utility client and one-shots would
    otherwise start every configured server (Pi has no lazy start). */
export const PI_MCP_EXTENSIONS = ["-e", "builtin:mcp", "-e", "builtin:tool-search"] as const;
```

```ts
      ...(opts.mcp ? PI_MCP_EXTENSIONS : []),
```

and in env `...(opts.mcp ? { HV_MCP: "1" } : {})`. Update the "MCP:" comment block at `:171-173` and the collision note at `:198-202` (no `mcp` tool any more; `tool_search`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` and `mcp__*` come from Pi). In `ipc.ts:1103`: `resolvePiSpawn(workspace, sessionDir(), piRuntimeDir(), { ...spawnOpts(workspace, resumeFile, sessionId), mcp: true })`.
- [ ] **Step 4: Run, expect PASS**, then `npm run build`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(spawn): Pi's built-in MCP for chat sessions only"`

### Task 4: Rule names, display, hints (`hv-mcp.ts`), safe tools, plan pass

**Files:**
- Rewrite: `pi-runtime/extensions/hv-mcp.ts`
- Modify: `pi-runtime/extensions/hv-rules.ts:101` (`SAFE_TOOLS`), `pi-runtime/extensions/hv-plan.ts:177-220,224,305-329`, `pi-runtime/extensions/hv-readonly.ts:52-54`
- Test: `tests/hv-mcp.test.ts` (rewrite), `tests/hv-plan.test.ts`, `tests/hv-readonly.test.ts`; delete `tests/mcp-adapter-actions.test.ts`

**Interfaces:**
- Produces (all pure, zero imports): `PI_MCP_SOURCE = "builtin:mcp"`, `READ_RESOURCE_TOOL = "read_mcp_resource"`, `MCP_SAFE_TOOLS = ["tool_search","list_mcp_resources","list_mcp_resource_templates"]`, `interface PiMcpToolInfo { name; namespace?: {name}; annotations?: {readOnlyHint?; destructiveHint?}; sourceInfo?: {path?} }`, `type ServerHint = "read-only" | "may delete data"`, `interface McpCallInfo { ruleTool; display; server; hint? }`, `isPiMcpTool(info)`, `mcpNamespace(server)`, `serverOfNamespace(ns, servers)`, `mcpRuleName(server, tool)`, `serverHint(annotations)`, `mcpCallInfo(info, input, servers): McpCallInfo | null`, `parsePiMcpToolName(name): {server; tool} | null` (display only), `gatePlanCall(toolName, input, opts?: { mcpReadOnly?: boolean })`, `gateReadonlyCall(toolName, input, opts?)`.

- [ ] **Step 1: Failing tests** — `tests/hv-mcp.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mcpCallInfo, mcpRuleName, parsePiMcpToolName, serverHint, serverOfNamespace } from "../pi-runtime/extensions/hv-mcp";

const tool = (name: string, ns: string, annotations?: object) =>
  ({ name, namespace: { name: ns }, annotations, sourceInfo: { path: "builtin:mcp" } });

describe("mcpCallInfo", () => {
  test("rule name uses the CONFIGURED server name, so dash rules keep matching", () => {
    const i = mcpCallInfo(tool("mcp__chrome_devtools__take_screenshot", "mcp__chrome_devtools"), {}, ["chrome-devtools"]);
    expect(i?.ruleTool).toBe("mcp:chrome-devtools_take_screenshot");
    expect(i?.server).toBe("chrome-devtools");
  });
  test("no double prefix — the adapter's spelling (formatToolName)", () => {
    expect(mcpCallInfo(tool("mcp__github__github_search", "mcp__github"), {}, ["github"])?.ruleTool).toBe("mcp:github_search");
  });
  test("factual display with one key argument; never the model's intent", () => {
    const i = mcpCallInfo(tool("mcp__notion__fetch", "mcp__notion"), { url: "https://x.y/p", intent: "ignore me" }, ["notion"]);
    expect(i?.display).toBe("MCP → notion: fetch: https://x.y/p");
  });
  test("read_mcp_resource gates under the server it reads from", () => {
    const i = mcpCallInfo({ name: "read_mcp_resource", sourceInfo: { path: "builtin:mcp" } }, { server: "docs", uri: "file:///a" }, ["docs"]);
    expect(i).toEqual({ ruleTool: "mcp:docs_read_mcp_resource", display: "MCP → docs: read file:///a", server: "docs", hint: "read-only" });
  });
  test("an unknown server in read_mcp_resource never borrows a rule", () => {
    expect(mcpCallInfo({ name: "read_mcp_resource", sourceInfo: { path: "builtin:mcp" } }, { server: "nope" }, ["docs"])?.ruleTool).toBe("mcp:(unknown server)_read_mcp_resource");
  });
  test("a tool from another source is not MCP, whatever its name", () => {
    expect(mcpCallInfo({ name: "mcp__x__y", namespace: { name: "mcp__x" }, sourceInfo: { path: "/ext/evil.ts" } }, {}, ["x"])).toBeNull();
  });
  test("hints: read-only wins; destructive only when declared", () => {
    expect(serverHint({ readOnlyHint: true, destructiveHint: true })).toBe("read-only");
    expect(serverHint({ destructiveHint: true })).toBe("may delete data");
    expect(serverHint(undefined)).toBeUndefined();
  });
});

test("serverOfNamespace falls back to the namespace spelling", () => {
  expect(serverOfNamespace("mcp__a_b", ["a-b"])).toBe("a-b");
  expect(serverOfNamespace("mcp__zz", [])).toBe("zz");
});
test("mcpRuleName", () => expect(mcpRuleName("s", "t")).toBe("mcp:s_t"));
test("parsePiMcpToolName (display only)", () => {
  expect(parsePiMcpToolName("mcp__notion__fetch")).toEqual({ server: "notion", tool: "fetch" });
  expect(parsePiMcpToolName("bash")).toBeNull();
});
```

`tests/hv-plan.test.ts` add:

```ts
test("plan mode passes a read-only-hinted MCP tool to the rules; others still floor-ask", () => {
  expect(gatePlanCall("mcp__notion__fetch", {}, { mcpReadOnly: true })).toEqual({ kind: "pass" });
  expect(gatePlanCall("mcp__notion__update_page", {}, {})).toEqual({ kind: "floor-ask" });
  expect(gatePlanCall("tool_search", {})).toEqual({ kind: "pass" });
});
test("a read-only hint never lifts a block", () => {
  expect(gatePlanCall("edit", {}, { mcpReadOnly: true }).kind).toBe("block");
});
```

`tests/hv-readonly.test.ts`: `gateReadonlyCall("mcp__notion__fetch", {}, { mcpReadOnly: true })` is `pass`. Delete the `mcp-manage` cases in both files.

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/hv-mcp.test.ts tests/hv-plan.test.ts tests/hv-readonly.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement** — `pi-runtime/extensions/hv-mcp.ts` (whole file):

```ts
/**
 * HappyVibe ⇄ Pi's built-in MCP — PURE module, zero imports (bridge, renderer, vitest).
 *
 * Pi registers each server tool as `mcp__<namespace>__<tool>` with sourceInfo.path
 * "builtin:mcp" (PRD §13, Decision 2026-10-05). This maps a call to (a) the rule name
 * hv-rules evaluates — "mcp:<server>_<tool>", the SAME string the adapter era used, so
 * every stored rule keeps matching — and (b) a factual display for the prompt and cards.
 * Gating reads the registered namespace, never a parse of the name: a tool from another
 * extension can be NAMED mcp__x__y, but only Pi's MCP has source "builtin:mcp".
 */
export const PI_MCP_SOURCE = "builtin:mcp";
export const READ_RESOURCE_TOOL = "read_mcp_resource";
/** Read-only discovery: safe-default allowed and passed through plan mode (hv-rules, hv-plan). */
export const MCP_SAFE_TOOLS = ["tool_search", "list_mcp_resources", "list_mcp_resource_templates"] as const;

export interface PiMcpToolInfo {
  name: string;
  namespace?: { name: string };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  sourceInfo?: { path?: string };
}
export type ServerHint = "read-only" | "may delete data";
export interface McpCallInfo { ruleTool: string; display: string; server: string; hint?: ServerHint }

export const isPiMcpTool = (info: PiMcpToolInfo | undefined): boolean => info?.sourceInfo?.path === PI_MCP_SOURCE;

/** Pi's namespace for a configured server name (core/mcp-servers.js `mcpNamespace`). */
export const mcpNamespace = (server: string): string => `mcp__${server.replace(/-/g, "_")}`;

/** The configured name behind a namespace. Pi refuses two names that differ only in - and _,
    so at most one matches. */
export function serverOfNamespace(ns: string, servers: Iterable<string>): string {
  for (const s of servers) if (mcpNamespace(s) === ns) return s;
  return ns.replace(/^mcp__/, "");
}

/** The adapter's spelling (pi-mcp-adapter types.ts formatToolName, toolPrefix "server"). */
export function mcpRuleName(server: string, tool: string): string {
  return `mcp:${tool.startsWith(`${server}_`) && tool.length > server.length + 1 ? tool : `${server}_${tool}`}`;
}

/** The server's own claim about a tool. Declared values only; never a default. */
export function serverHint(a: PiMcpToolInfo["annotations"]): ServerHint | undefined {
  if (a?.readOnlyHint === true) return "read-only";
  if (a?.destructiveHint === true) return "may delete data";
  return undefined;
}

const KEY_ARG_FIELDS = ["url", "uri", "query", "q", "path", "file", "name", "id", "title"];
function keyArg(input: Record<string, unknown>): string | null {
  for (const k of KEY_ARG_FIELDS) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) {
      const one = v.replace(/\s+/g, " ").trim();
      return one.length > 60 ? `${one.slice(0, 60)}…` : one;
    }
  }
  return null;
}

export function mcpCallInfo(info: PiMcpToolInfo, input: Record<string, unknown>, servers: Iterable<string>): McpCallInfo | null {
  if (!isPiMcpTool(info)) return null;
  const list = [...servers];
  if (info.name === READ_RESOURCE_TOOL) {
    const asked = typeof input.server === "string" ? input.server.trim() : "";
    const server = list.find((s) => s === asked || mcpNamespace(s) === mcpNamespace(asked)) ?? "(unknown server)";
    const uri = typeof input.uri === "string" && input.uri ? input.uri : "(no URI given)";
    return { ruleTool: mcpRuleName(server, READ_RESOURCE_TOOL), display: `MCP → ${server}: read ${uri}`, server, hint: "read-only" };
  }
  const ns = info.namespace?.name;
  if (!ns || !info.name.startsWith(`${ns}__`)) return null;
  const server = serverOfNamespace(ns, list);
  const tool = info.name.slice(ns.length + 2);
  const detail = keyArg(input);
  return { ruleTool: mcpRuleName(server, tool), display: detail ? `MCP → ${server}: ${tool}: ${detail}` : `MCP → ${server}: ${tool}`, server, hint: serverHint(info.annotations) };
}

/** Display only (renderer has no namespace): split at the first `__` after the prefix. */
export function parsePiMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}
```

`hv-rules.ts:101` — append `"tool_search", "list_mcp_resources", "list_mcp_resource_templates"` to `SAFE_TOOLS` with a `// §13 (2026-10-05): read-only MCP discovery` comment (spell the names; hv-rules imports nothing). `hv-plan.ts` — add the same three names to `PLAN_PASS_TOOLS` with the same comment; delete the `unwrapMcpCall` import (`:224`) and the manage block (`:315-319`); change the signature and add the pass right after the `BLOCKED_PLAN_TOOLS` check:

```ts
export function gatePlanCall(toolName: string, input: unknown, opts?: { mcpReadOnly?: boolean }): PlanGate {
  ...
  // §13 (2026-10-05): a tool its MCP server marks read-only follows the RULES while planning
  // instead of being clamped to ask. The server can lie, so this only lifts the clamp — an
  // allow still has to come from a rule the user wrote.
  if (opts?.mcpReadOnly) return { kind: "pass" };
```

`hv-readonly.ts`: `gateReadonlyCall(toolName, input, opts?: { mcpReadOnly?: boolean })` → `gatePlanCall(toolName, input, opts)`.

- [ ] **Step 4: Run, expect PASS.** Same command, plus `tests/hv-rules*.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp): rule names, factual display and server hints for Pi's MCP tools"`

### Task 5: Bridge wiring

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` — imports `:14`; intent `:224-243`, `:307-326`, `:989-993`; MCP branch `:994-1000`; discovery auto-allow `:1291-1298`; plan gate calls `:1151`, `:1166`; envelope `:1310-1323`; `/hv-tools` `:2469-2483`; new registration block + `/hv-mcp-tools`
- Test: `tests/mcp-builtin-gate.test.ts` (tighten + arms), `tests/intent-direct-tools.test.ts`, `tests/intent-toggle.test.ts`, `tests/mcp-bridge.test.ts` (live rewrite)

**Interfaces:**
- Consumes: Task 1 `workspaceRegistrations`; Task 4 `mcpCallInfo`, `isPiMcpTool`, `mcpNamespace`, `READ_RESOURCE_TOOL`; `gatePlanCall`/`gateReadonlyCall` opts.
- Produces: `hv.permission` envelope gains optional `serverHint: "read-only" | "may delete data"`; `hv.tools` entries gain optional `checkedAs: string`; command `/hv-mcp-tools` → notify `{kind:"hv.mcp-tools", servers: Record<string, string[]>, errors: string[]}` (workspace-registered servers only; tool names without the `mcp__<ns>__` prefix).

- [ ] **Step 1: Failing tests.** In `tests/mcp-builtin-gate.test.ts` switch `boot()` to the production args — `resolvePiSpawn(tmp, sessionDir, runtime, { mcp: true, agentDir: path.join(tmp, "agent") })` with the faux fixture inserted before the bridge's `-e` — and replace the phase-0 assertions:

```ts
  expect(prompts).toHaveLength(1); // tool_search is safe-default now
  expect(prompts[0]).toMatchObject({ tool: "mcp:echo_echo", summary: "MCP → echo: echo: hi" });
  expect(fs.existsSync(path.join(tmp, "calls.log"))).toBe(false);
```

Add three tests in the same file:
1. **workspace server** — no global file; `<tmp>/.mcp.json` = `{mcpServers:{echo:{command:node, args:[echo]}}}`; same steps; same assertions (proves registration + deferred default).
2. **auth stripped** — `<tmp>/.mcp.json` = `{mcpServers:{evil:{url:"http://127.0.0.1:9/mcp", auth:{provider:"openai"}}}}`; send `/hv-mcp-tools`; the `hv.mcp-tools` notify lists `evil` and no registration error mentions `auth`; and `/mcp` status text contains `evil:` (registered) — Pi would have rejected it outright with `auth` present only if it were a project file, so this pins that we strip, not Pi.
3. **Allow runs once** — answer `Allow`; `calls.log` contains exactly `hi\n`.

`tests/intent-direct-tools.test.ts` / `intent-toggle.test.ts`: fake tools now carry `sourceInfo: { path: "builtin:mcp" }`; `mcp` leaves `INTENT_TOOLS`; assertions otherwise unchanged (inject on Pi MCP tools, strip in `tool_call`, hands off a tool with its own `intent`).

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-builtin-gate.test.ts tests/intent-direct-tools.test.ts tests/intent-toggle.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement.**

Registration + server names (inside the extension factory, before any `pi.on`):

```ts
  // §13 (2026-10-05): workspace .mcp.json servers. Pi reads project servers only from a
  // TRUSTED project's .pi/mcp.json and HappyVibe never trusts one, so the bridge registers
  // them. Registered during load → they connect on session_start beside <agentDir>/mcp.json
  // (Pi's file wins on a name clash). Only when main loaded Pi's MCP (HV_MCP=1): with no MCP
  // extension a registration is an extension error.
  const mcpRegistered: string[] = [];
  const mcpRegisterErrors: string[] = [];
  if (process.env.HV_MCP === "1") {
    try {
      const file = path.join(process.cwd(), ".mcp.json");
      if (fs.existsSync(file)) {
        const { servers, errors } = workspaceRegistrations(JSON.parse(fs.readFileSync(file, "utf8")));
        mcpRegisterErrors.push(...errors);
        for (const [name, entry] of servers) {
          try { pi.registerMcpServer(name, entry as never); mcpRegistered.push(name); }
          catch (e) { mcpRegisterErrors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
        }
      }
    } catch (e) {
      mcpRegisterErrors.push(`.mcp.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const piAgentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  /** Configured names, for namespace → server. Read per call: a few hundred bytes, and a
      config change respawns the session anyway. */
  const mcpServerNames = (): string[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(piAgentDir, "mcp.json"), "utf8")) as { mcpServers?: object };
      return [...Object.keys(raw.mcpServers ?? {}), ...mcpRegistered];
    } catch {
      return [...mcpRegistered];
    }
  };
```

`tool_call` — replace `:994-1000`:

```ts
    // §13 (2026-10-05): Pi's MCP tools gate as mcp:<server>_<tool> — the adapter-era name, so
    // stored rules keep matching. Identified by SOURCE, never by name (hv-mcp.ts).
    const toolInfo = pi.getAllTools().find((t) => t.name === tool);
    const mcp = mcpCallInfo(toolInfo as never, input, mcpServerNames());
```

Delete the discovery auto-allow block (`:1291-1298`) — discovery is `SAFE_TOOLS` now. Pass the hint to both plan gates: `gateReadonlyCall(tool, input, { mcpReadOnly: mcp?.hint === "read-only" })` (`:1151`) and `gatePlanCall(tool, input, { mcpReadOnly: mcp?.hint === "read-only" })` (`:1166`). Envelope `:1321` — beside `...boundary`:

```ts
          ...(mcp?.hint ? { serverHint: mcp.hint } : {}),
```

Intent: remove `"mcp"` from `INTENT_TOOLS`; in `requireIntent` change the loop guard to `if (INTENT_TOOLS.includes(t.name) || t.sourceInfo?.path !== PI_MCP_SOURCE) continue;` and rewrite the comments at `:224-243` (Pi forwards a tool's params to the server verbatim — check `extensions/mcp/tools.js` `execute` and cite the line). The `turn_start` re-run (`:720-722`) stays: Pi's servers connect in the background after `session_start`, so their tools appear later; rewrite its comment accordingly.

`/hv-tools` — add `checkedAs` for Pi MCP tools:

```ts
      const servers = mcpServerNames();
      const tools = pi.getAllTools().map((t) => {
        const info = isPiMcpTool(t as never) && t.name !== READ_RESOURCE_TOOL ? mcpCallInfo(t as never, {}, servers) : null;
        return {
          name: t.name,
          description: t.description ?? "",
          source: t.sourceInfo?.source ?? t.sourceInfo?.scope ?? "builtin",
          ...(info ? { checkedAs: info.ruleTool } : {}),
        };
      });
```

New command:

```ts
  pi.registerCommand("hv-mcp-tools", {
    description: "HappyVibe: tool names of this workspace's .mcp.json servers (hv.mcp-tools notify)",
    handler: async (_args, ctx) => {
      const servers: Record<string, string[]> = Object.fromEntries(mcpRegistered.map((s) => [s, [] as string[]]));
      for (const t of pi.getAllTools()) {
        if (!isPiMcpTool(t as never) || !t.namespace) continue;
        const s = mcpRegistered.find((n) => mcpNamespace(n) === t.namespace!.name);
        if (s) servers[s].push(t.name.slice(t.namespace.name.length + 2));
      }
      ctx.ui.notify(JSON.stringify({ kind: "hv.mcp-tools", servers, errors: mcpRegisterErrors }), "info");
    },
  });
```

Add `/hv-mcp-tools` to `RESERVED_SLASH_COMMANDS` (`src/main/promptTemplates/view.ts:36-53`; `tests/commands-reserved.test.ts` pins the list).

**Live test** `tests/mcp-bridge.test.ts`: keep the echo `.mcp.json` setup and `askUntil`; spawn via `resolvePiSpawn(tmp, …, { mcp: true, agentDir: path.join(tmp, "agent"), providerEnv: PROVIDER_ENV, model: MODEL })` so the test runs exactly the production args; the first `hv.permission` is `{ tool: "mcp:echo_echo" }` with summary starting `MCP → echo: echo`; Allow → the tool result contains `echo:`. Delete the install-deny test (the surface is gone). Re-ask with `askUntil` if the model ends its turn without `tool_search` — never raise a timeout.

- [ ] **Step 4: Run, expect PASS** (Step 2 command), then `npm run gate`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(bridge): gate Pi's MCP tools, register workspace servers, server hints"`. Then `npm run live:why`; it will list `mcp-bridge.test.ts` → `ln -s ~/Documents/Github/HappyVibe/.env .env` if missing, `pgrep -fl electron-vite` empty, then `npm run test:live` with `run_in_background` (~7–8 min; a few-second green means `.env` is missing).

### Task 6: Renderer — tool cards, All Tools, permission prompt hint

**Files:**
- Modify: `src/renderer/src/toolLabel.ts:14,242-246,393-399,426-430`; `src/renderer/src/agents.ts:8,61-70,85-122`; `src/renderer/src/components/AllToolsView.tsx:12,29-50,96`; `src/renderer/src/permission.ts:12-40,60-110`; `src/renderer/src/components/PermissionModal.tsx:7,112-115,162-172`
- Test: `tests/tool-label.test.ts`, `tests/agents-renderer.test.ts:1040`, `tests/permission-boundary-render.test.ts` (or a new `tests/permission-hint.test.ts`), `tests/mentions.test.ts`

**Interfaces:**
- Consumes: `parsePiMcpToolName`, `READ_RESOURCE_TOOL` (Task 4); `hv.tools.checkedAs`, `hv.permission.serverHint` (Task 5).
- Produces: `PermissionInfo.serverHint?: "read-only" | "may delete data"`; exported `SERVER_HINT_COPY: Record<ServerHint, string>` = `{ "read-only": "Server says: read-only", "may delete data": "Server says: may delete data" }` (in `permission.ts`, pinned as data); `ToolInfo.checkedAs?: string`.

- [ ] **Step 1: Failing tests.**
  - `tool-label.test.ts`: `toolLabel("mcp__notion__fetch", { url: "https://x" })` → label `MCP → notion: fetch: https://x`, brand `si-notion` (whatever `BRAND_ICONS.notion` is); with `{ intent: "Reading the page" }` → label is the intent; `toolLabel("tool_search", { query: "linear issues" })` → `Searching tools: linear issues`; `toolLabel("read_mcp_resource", { server: "docs", uri: "file:///a" })` → `MCP → docs: read file:///a`; `toolLabel("mcp", …)` no longer has an MCP branch (falls to default).
  - `agents-renderer.test.ts`: a row `{ name: "mcp__linear__get_issue", checkedAs: "mcp:linear_get_issue" }` joins to the verdict of `evalRules("mcp:linear_get_issue")` — no "per MCP tool" pill; `checkedAs("read_mcp_resource")` → `{ name: "mcp:<server>_read_mcp_resource", per: "per MCP tool" }`; `checkedAs("mcp")` → `null`.
  - permission: `parsePermission({kind:"hv.permission", tool:"mcp:a_b", summary:"MCP → a: b", serverHint:"read-only"}).serverHint === "read-only"`; an unknown value (`"trust me"`) is dropped; source scan — `PermissionModal.tsx` contains `SERVER_HINT_COPY[` and no longer imports `isMcpManageRule`.
  - `mentions.test.ts`: `composerCommands([{ name: "mcp", source: "extension" }])` is `[]` (decision 13 — already built at `mentions.ts:170`; this pins it).
- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/tool-label.test.ts tests/agents-renderer.test.ts tests/permission-hint.test.ts tests/mentions.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- [ ] **Step 3: Implement.**
  - `toolLabel.ts`: delete the `case "mcp"` (`:393-399`) and the namespace-proxy branch (`:242-246`), and change the `hv-mcp` import to `parsePiMcpToolName, READ_RESOURCE_TOOL`. In `toolLabel()` the locals `a`, `str(k)` and `intent` already exist (`:230-233`). Put this where the namespace branch was:

```ts
  // §13 (2026-10-05): Pi's MCP tools. Headline = the model's intent, else the factual call.
  const piMcp = parsePiMcpToolName(toolName);
  if (piMcp) {
    const detail = str("url") ?? str("uri") ?? str("query") ?? str("q") ?? str("path") ?? str("name") ?? str("id") ?? str("title");
    const fact = `MCP → ${piMcp.server}: ${piMcp.tool}${detail ? `: ${truncate(detail)}` : ""}`;
    return { icon: "wrench", label: intent ?? fact, brand: brandIconFor(piMcp.server) };
  }
  if (toolName === READ_RESOURCE_TOOL) {
    return { icon: "wrench", label: intent ?? `MCP → ${str("server") ?? "?"}: read ${truncate(str("uri") ?? "?")}`, brand: brandIconFor(str("server") ?? undefined) };
  }
  if (toolName === "tool_search") return { icon: "search", label: `Searching tools: ${truncate(str("query") ?? "")}` };
```
  - `agents.ts`: `ToolInfo` gets `checkedAs?: string`, `parseTools` keeps it; `checkedAs()` drops the `mcp` line, adds `if (tool === READ_RESOURCE_TOOL) return { name: "mcp:<server>_read_mcp_resource", per: "per MCP tool" };`; `joinToolPermissions` uses `row.checkedAs ? { name: row.checkedAs } : checkedAs(row.name)`.
  - `AllToolsView.tsx`: a row with `checkedAs` and no `per` evaluates rules on `checkedAs` (`:96`) and its expanded line reads "Checked as `<checkedAs>` on every call" (`:41-45`).
  - `permission.ts`: add `serverHint` to `PermissionInfo`, parse only the two literal values, export `SERVER_HINT_COPY`.
  - `PermissionModal.tsx`: remove the `isMcpManageRule` import/branch (`:7`, `:115`); under the headline (`:162-172`) render `{info.serverHint && <p className="…muted…">{SERVER_HINT_COPY[info.serverHint]}</p>}` using the same muted text class the `boundary` block uses.
- [ ] **Step 4: Run, expect PASS**, then `npm run build`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(renderer): Pi MCP tool cards, per-tool All Tools rows, server hint on the prompt"`

### Task 7: Analytics names

**Files:** Modify `src/main/usage/features.ts:18-44`; Test `tests/usage-features.test.ts`.

- [ ] **Step 1: Failing test:** `featureOfTool("mcp__linear__get_issue")` → `"mcp_tool"`; `toolKind("mcp__x__y")` → `"mcp"`; `featureOfTool("read_mcp_resource")` → `"mcp_tool"`; `featureOfTool("tool_search")` → `null` (discovery is not a use).
- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/usage-features.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- [ ] **Step 3: Implement:** replace the `mcp` / `mcp:` checks with `tool.startsWith("mcp__") || tool === "read_mcp_resource"` in both functions (keep `mcp:` for old event logs read by `fromLog.ts`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -s -m "feat(usage): count Pi's MCP tool calls"`

---

# Phase 2 — management

### Task 8: `pi mcp` runner and parsers (`mcpPi.ts`)

**Files:**
- Create: `src/main/mcpPi.ts` (electron-free)
- Create: `tests/fixtures/fake-pi-mcp.mjs` (prints canned `mcp list --json` / `login` output by argv)
- Test: `tests/mcp-pi.test.ts` (unit + one real key-free run + source-scan contract)

**Interfaces:**
- Produces:
  - `interface PiCliOpts { runtimeDir: string; agentDir: string; env: Record<string, string>; execPath?: string; cliPath?: string }` (`cliPath` defaults to `path.join(runtimeDir, PI_CLI_RELPATH)`; tests point it at the fake)
  - `interface PiMcpServer { name: string; scope: string; enabled: boolean; exposure: string; state: string; tools: string[]; error?: string }`
  - `piMcpList(o): Promise<{ servers: PiMcpServer[]; errors: string[] }>` (parses stdout whatever the exit code; Pi exits 1 when any server isn't connected)
  - `piMcpLogin(o, name): { url: Promise<string | null>; done: Promise<{ ok: boolean; message: string }>; cancel(): void }` (`--timeout 300`; `cancel` kills the child)
  - `piMcpLogout(o, name): Promise<{ ok: boolean; message: string }>`
  - `LOGIN_URL_RE = /Sign in to MCP server "([^"]+)" in your browser:\s*\n(\S+)/`
  - `type McpState = "connected" | "needs-auth" | "failed" | "checking"`
  - `statusFromList(s: PiMcpServer): { state: McpState; toolCount: number; tools: { name: string }[]; error?: string } | null` (null = disabled)
  - `configErrorFor(name: string, errors: string[]): string | undefined` (matches `server "<name>"`)
  - `parseMcpStatus(text: string): Array<{ name: string; state: McpState | "off" | "overridden"; toolCount?: number; error?: string }>`

- [ ] **Step 1: Failing tests**

```ts
// tests/mcp-pi.test.ts
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOGIN_URL_RE, configErrorFor, parseMcpStatus, piMcpList, statusFromList } from "../src/main/mcpPi";

const runtime = path.join(process.cwd(), "pi-runtime");
const MCP_DIST = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp");

test("contract: the sign-in and status wording we parse is still Pi's", () => {
  const cli = fs.readFileSync(path.join(MCP_DIST, "cli.js"), "utf8");
  const idx = fs.readFileSync(path.join(MCP_DIST, "index.js"), "utf8");
  for (const src of [cli, idx]) expect(src).toContain('Sign in to MCP server "${name}" in your browser:\\n${');
  expect(idx).toContain(": needs sign-in, run /mcp login ${name} (${exposure})");
  expect(idx).toContain("return `${name}: ${state}${tools} (${exposure})${error}`;");
  expect(idx).toContain('lines.push(`overridden: ${line}`)');
  expect(idx).toContain('lines.push(`config error: ${error}`)');
});

test("LOGIN_URL_RE reads Pi's line", () => {
  const m = LOGIN_URL_RE.exec('Sign in to MCP server "linear" in your browser:\nhttps://auth.x/authorize?a=1\n');
  expect(m?.[1]).toBe("linear");
  expect(m?.[2]).toBe("https://auth.x/authorize?a=1");
});

test("statusFromList maps Pi's states", () => {
  const base = { name: "a", scope: "global", enabled: true, exposure: "deferred", tools: ["x", "y"] };
  expect(statusFromList({ ...base, state: "connected" })).toEqual({ state: "connected", toolCount: 2, tools: [{ name: "x" }, { name: "y" }] });
  expect(statusFromList({ ...base, state: "needs-auth", tools: [] })?.state).toBe("needs-auth");
  expect(statusFromList({ ...base, state: "failed", tools: [], error: "Failed to resolve HV_MCP_CTX_KEY from environment variable: HV_MCP_CTX_KEY" })).toMatchObject({ state: "failed", error: expect.stringContaining("Failed to resolve") });
  expect(statusFromList({ ...base, enabled: false, state: "disabled", tools: [] })).toBeNull();
});

test("configErrorFor finds a rejected entry so its row keeps Pi's reason", () => {
  expect(configErrorFor("old", ['/a/mcp.json: server "old": legacy SSE transport is not supported; use the streamable HTTP URL'])).toContain("SSE");
  expect(configErrorFor("old", ['/a/mcp.json: server "older": x'])).toBeUndefined();
});

test("parseMcpStatus reads /mcp's text", () => {
  const text = [
    "echo: connected, 1 tools (deferred)",
    "linear: needs sign-in, run /mcp login linear (deferred)",
    "bad: failed (deferred)\n    spawn ENOENT\n    more",
    "off: disabled (deferred)",
    "overridden: dup (registered by happyvibe-bridge.ts, overridden by /a/mcp.json)",
    "config error: x",
  ].join("\n");
  expect(parseMcpStatus(text)).toEqual([
    { name: "echo", state: "connected", toolCount: 1 },
    { name: "linear", state: "needs-auth" },
    { name: "bad", state: "failed", error: "spawn ENOENT\nmore" },
    { name: "off", state: "off" },
    { name: "dup", state: "overridden" },
  ]);
});

test("real key-free run: pi mcp list --json on the echo fixture", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-pimcp-"));
  fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    echo: { command: process.execPath, args: [path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs")], exposure: "deferred" } } }));
  const r = await piMcpList({ runtimeDir: runtime, agentDir, env: {}, execPath: process.execPath });
  expect(r.servers.find((s) => s.name === "echo")).toMatchObject({ state: "connected", tools: ["echo"] });
}, 30_000);
```

(Check the exact `overridden` line content in `index.js` `overridden` builder and adjust the fixture string to Pi's real format before asserting.)

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-pi.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement** `src/main/mcpPi.ts`:

```ts
/**
 * §13 (2026-10-05): main manages GLOBAL MCP servers through Pi's own shell commands —
 * `pi mcp list --json | login | logout` — instead of being an MCP client itself.
 * Electron-free (vitest imports it). Workspace servers are invisible to these commands
 * (they're registered by the bridge): see mcpWorkspaceProbe.ts.
 *
 * The login URL line and /mcp's status text are COPY, not an API; tests/mcp-pi.test.ts
 * source-scans the vendored Pi so a wording change is a red test, not a dead button.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { nodeExecPath, PI_CLI_RELPATH } from "./pi/spawn";

export interface PiCliOpts { runtimeDir: string; agentDir: string; env: Record<string, string>; execPath?: string; cliPath?: string }
export interface PiMcpServer { name: string; scope: string; enabled: boolean; exposure: string; state: string; tools: string[]; error?: string }
export type McpState = "connected" | "needs-auth" | "failed" | "checking";

export const LOGIN_URL_RE = /Sign in to MCP server "([^"]+)" in your browser:\s*\n(\S+)/;

function run(o: PiCliOpts, args: string[]) {
  // One-shot Pi calls hang unless stdin is closed (CLAUDE.md). cwd = home so no project
  // .pi/mcp.json is ever consulted; nodeExecPath() so macOS shows no extra Dock icon.
  return spawn(o.execPath ?? nodeExecPath(), [o.cliPath ?? path.join(o.runtimeDir, PI_CLI_RELPATH), "mcp", ...args], {
    cwd: os.homedir(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...o.env, PI_CODING_AGENT_DIR: o.agentDir },
  });
}

function collect(o: PiCliOpts, args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const c = run(o, args);
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => resolve({ code, out, err }));
  });
}

export async function piMcpList(o: PiCliOpts): Promise<{ servers: PiMcpServer[]; errors: string[] }> {
  const { out, err } = await collect(o, ["list", "--json"]);
  try {
    const j = JSON.parse(out) as { servers?: PiMcpServer[]; errors?: string[] };
    return { servers: j.servers ?? [], errors: j.errors ?? [] };
  } catch {
    throw new Error(`Pi's MCP list returned no JSON: ${(err || out).trim().slice(0, 300)}`);
  }
}

export function piMcpLogin(o: PiCliOpts, name: string): { url: Promise<string | null>; done: Promise<{ ok: boolean; message: string }>; cancel(): void } {
  const c = run(o, ["login", name, "--timeout", "300"]);
  let out = "";
  let err = "";
  let gotUrl: (u: string | null) => void = () => {};
  const url = new Promise<string | null>((r) => (gotUrl = r));
  c.stdout.on("data", (d) => {
    out += d;
    const m = LOGIN_URL_RE.exec(out);
    if (m) gotUrl(m[2]);
  });
  c.stderr.on("data", (d) => (err += d));
  const done = new Promise<{ ok: boolean; message: string }>((resolve) => {
    c.on("error", (e) => { gotUrl(null); resolve({ ok: false, message: e.message }); });
    c.on("close", (code) => {
      gotUrl(null);
      const last = out.trim().split("\n").pop() ?? "";
      resolve(code === 0 ? { ok: true, message: last } : { ok: false, message: err.trim() || last || `exit ${code}` });
    });
  });
  return { url, done, cancel: () => c.kill() };
}

export async function piMcpLogout(o: PiCliOpts, name: string): Promise<{ ok: boolean; message: string }> {
  const { code, out, err } = await collect(o, ["logout", name]);
  return { ok: code === 0, message: (code === 0 ? out : err || out).trim() };
}

export function statusFromList(s: PiMcpServer): { state: McpState; toolCount: number; tools: { name: string }[]; error?: string } | null {
  if (!s.enabled || s.state === "disabled") return null;
  const state: McpState = s.state === "connected" ? "connected" : s.state === "needs-auth" ? "needs-auth" : s.state === "connecting" ? "checking" : "failed";
  return { state, toolCount: s.tools.length, tools: s.tools.map((name) => ({ name })), ...(s.error ? { error: s.error } : {}) };
}

export function configErrorFor(name: string, errors: string[]): string | undefined {
  return errors.find((e) => e.includes(`server "${name}"`));
}

export function parseMcpStatus(text: string): Array<{ name: string; state: McpState | "off" | "overridden"; toolCount?: number; error?: string }> {
  const rows: Array<{ name: string; state: McpState | "off" | "overridden"; toolCount?: number; error?: string }> = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("    ")) {
      const last = rows[rows.length - 1];
      if (last) last.error = last.error ? `${last.error}\n${line.trim()}` : line.trim();
      continue;
    }
    if (line.startsWith("config error: ")) continue;
    const ov = /^overridden: ([A-Za-z0-9_-]+)\b/.exec(line);
    if (ov) { rows.push({ name: ov[1], state: "overridden" }); continue; }
    const m = /^([A-Za-z0-9_-]+): (.*) \(([a-z-]+)\)$/.exec(line);
    if (!m) continue;
    const [, name, body] = m;
    if (body.startsWith("needs sign-in")) rows.push({ name, state: "needs-auth" });
    else if (body.startsWith("connected")) rows.push({ name, state: "connected", toolCount: Number(/, (\d+) tools/.exec(body)?.[1] ?? 0) });
    else if (body === "disabled") rows.push({ name, state: "off" });
    else if (body === "starting" || body === "connecting") rows.push({ name, state: "checking" });
    else rows.push({ name, state: "failed" });
  }
  return rows;
}
```

- [ ] **Step 4: Run, expect PASS.** Then `npm run catalog:crash-messages` (new `throw new Error`), rerun `tests/crash-safe-messages.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp): manage global servers through pi mcp list/login/logout"`

### Task 9: Workspace probe (`mcpWorkspaceProbe.ts`)

**Files:**
- Create: `src/main/mcpWorkspaceProbe.ts` (electron-free)
- Test: `tests/mcp-workspace-probe.test.ts` (key-free real run)

**Interfaces:**
- Consumes: `resolvePiSpawn`, `PiClient`, `parseMcpStatus` (Task 8), bridge `/hv-mcp-tools` (Task 5).
- Produces:
  - `probeWorkspace(spec: SpawnSpec, names: string[]): Promise<Array<{ name: string; state: McpState | "off" | "overridden"; toolCount: number; tools: { name: string }[]; error?: string }>>` — one short-lived Pi: `/mcp`, then `/hv-mcp-tools`, rows filtered to `names`, then `stop()`.
  - `signInWorkspace(spec: SpawnSpec, name: string): { url: Promise<string | null>; done: Promise<{ ok: boolean; message: string }>; cancel(): void }` — sends `/mcp login <name>`, keeps Pi's paste-back `input` request PENDING while the browser flow runs (answering it empty fails the sign-in, `oauth.js:305`), resolves on the `Signed in to MCP server` notify or a failure notify, then stops the Pi. `cancel()` answers the pending input `{ cancelled: true }` and stops the Pi. A 300 s timer calls `cancel()`.
  - `signOutWorkspace(spec, name): Promise<{ ok: boolean; message: string }>` — `/mcp logout <name>`.

- [ ] **Step 1: Failing test** (key-free — Pi runs model-less like the utility client):

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { probeWorkspace } from "../src/main/mcpWorkspaceProbe";

test("a workspace server's state and tool names come from a Pi in that workspace", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsprobe-"));
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsagent-"));
  fs.writeFileSync(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: {
    echo: { command: process.execPath, args: [path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs")] } } }));
  const spec = resolvePiSpawn(ws, path.join(agentDir, "sessions"), path.join(process.cwd(), "pi-runtime"), { mcp: true, agentDir });
  expect(await probeWorkspace(spec, ["echo"])).toEqual([{ name: "echo", state: "connected", toolCount: 1, tools: [{ name: "echo" }] }]);
}, 40_000);
```

Unit-test `signInWorkspace` with a fake `PiClient`-shaped emitter (inject a factory parameter defaulting to `new PiClient(spec)`): emits the URL notify → `url` resolves; emits an `input` ui-request → nothing answered; emits `Signed in to MCP server "x" (3 tools).` → `done` is `{ ok: true }`, the fake's `stop` called, no `respondUi` for the input. Second case: `cancel()` → `respondUi(inputId, { cancelled: true })` then `stop`.

- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-workspace-probe.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- [ ] **Step 3: Implement.** Pattern for one command (collect notifies between `send` and its response — an extension command's response arrives after its handler finished):

```ts
async function command(c: PiClient, message: string): Promise<string[]> {
  const notes: string[] = [];
  const onUi = (r: { method?: string; message?: string }) => { if (r.method === "notify" && r.message) notes.push(r.message); };
  c.on("ui-request", onUi);
  try { await c.send({ type: "prompt", message }); } finally { c.off("ui-request", onUi); }
  return notes;
}
```

`probeWorkspace`: `start()`, `const status = (await command(c, "/mcp")).find((n) => /\((deferred|direct|codemode|hidden)\)/.test(n)) ?? ""`, `const tools = JSON.parse((await command(c, "/hv-mcp-tools")).find((n) => n.includes('"hv.mcp-tools"')) ?? "{}")`, join by name, `stop()` in `finally`. Pi's startup notifies ("needs sign-in" once after startup) arrive before the first `send` and are ignored by construction.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp): workspace server status and sign-in through a short-lived Pi"`

### Task 10: `ipc.ts` rewire

**Files:**
- Modify: `src/main/ipc.ts` — imports `:132-148`; status model `:1395-1587` (replace `adapterStore`, `checkServer`, both sweeps, `hv:mcp-sweep-remote`); handlers `:5815-6056`; `hv:plugins-remove` `:7138-7161` (logout before removal)
- Modify: `src/preload/index.ts:630-662`, `src/renderer/src/hv.d.ts:766-775,1360-1370`
- Modify: `src/main/mcpPi.ts` (add `removeServerInOrder`)
- Test: `tests/mcp-pi.test.ts` (order test), `tests/mcp-reload-scope.test.ts` (unchanged, rerun), `tests/mcp-status.test.ts` (adjust to names-only tools)

**Interfaces:**
- Consumes: Tasks 8–9.
- Produces (renderer API): `mcpRefresh(): Promise<McpServerStatusLike[]>` (replaces `mcpSweepRemote`); `mcpAuthenticate(scope, workspaceId, name)` now resolves when the sign-in finishes and emits `hv:mcp-signin` `{ name, scope, workspaceId, url }` as soon as the URL is known; `mcpSigninCancel(): Promise<void>`; `onMcpSignin(cb): () => void`. `McpServerStatusLike` gains `state: … | "overridden"`; `tools?: { name: string; description?: string }[]` unchanged (description now always absent).
- `removeServerInOrder(opts: { stillUsed: boolean; logout: () => Promise<unknown>; write: () => void }): Promise<void>` — logout (when not still used) strictly before write; a failing logout does not block the removal.

- [ ] **Step 1: Failing test** (append to `tests/mcp-pi.test.ts`):

```ts
test("removing a server logs out BEFORE the entry leaves mcp.json (pi mcp logout looks it up by name)", async () => {
  const calls: string[] = [];
  await removeServerInOrder({ stillUsed: false, logout: async () => { calls.push("logout"); }, write: () => calls.push("write") });
  expect(calls).toEqual(["logout", "write"]);
  calls.length = 0;
  await removeServerInOrder({ stillUsed: true, logout: async () => { calls.push("logout"); }, write: () => calls.push("write") });
  expect(calls).toEqual(["write"]);
  calls.length = 0;
  await removeServerInOrder({ stillUsed: false, logout: async () => { throw new Error("x"); }, write: () => calls.push("write") });
  expect(calls).toEqual(["write"]);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `removeServerInOrder` in `mcpPi.ts` (5 lines, `try { await logout() } catch {}` then `write()`).
  - `ipc.ts` status model: keep `mcpStatusMap`/`statusKey`/`mcpStatusChanged`; add `const piCli = (): PiCliOpts => ({ runtimeDir: piRuntimeDir(), agentDir: agentDir(), env: providerEnv() })`.
    - `refreshGlobal()`: `piMcpList(piCli())` → for each name in `readMcpFile(globalMcpFile()).mcpServers`: off → delete row; listed → `statusFromList`; not listed → `configErrorFor` → `failed` with Pi's reason. Emits once.
    - `refreshWorkspace(ws)`: names from `<ws>/.mcp.json` minus off ones; none → return; `probeWorkspace(resolvePiSpawn(ws, sessionDir(), piRuntimeDir(), { ...spawnOpts(ws), mcp: true }), names)`; `overridden` rows show `state: "overridden"`.
    - Boot: `void refreshGlobal()` only. Workspace rows are refreshed when the MCP page mounts (`hv:mcp-refresh` → `refreshGlobal()` + each workspace with servers, sequentially) — the precedent is today's remote sweep on page mount (§13 2026-08-14), now for the cost reason: every probe Pi starts all servers.
    - Delete `adapterStore`, `sweepRemote`, `remoteSweepDone`, `sweepLegacyCredentials`, `checkServer`, the boot stdio sweep and `SWEEP_CONCURRENCY`.
  - Handlers:
    - `hv:mcp-check` → `refreshGlobal()` or `refreshWorkspace(ws)` by scope (Pi's list has no per-server filter — `// ponytail: probes every server; ask upstream for pi mcp list <name>`).
    - `hv:mcp-authenticate` → global: `piMcpLogin(piCli(), name)`; workspace: `signInWorkspace(spec, name)`. Hold the controller in `let signin: { cancel(): void } | null`; on `url` → `send("hv:mcp-signin", { name, scope, workspaceId, url })`; on `done.ok` → refresh that tier + `scheduleMcpReload(scope, workspaceId)`; return `{ ok, message }`. A second authenticate cancels the first.
    - `hv:mcp-signin-cancel` → `signin?.cancel()`.
    - `hv:mcp-logout` → global `piMcpLogout`, workspace `signOutWorkspace`; delete the utility-client `/mcp logout` send (`:6035`); refresh + `scheduleMcpReload`.
    - `hv:mcp-set-server` removal → `removeServerInOrder({ stillUsed: serverNameInFiles(...), logout: () => scope === "global" ? piMcpLogout(piCli(), name) : signOutWorkspace(spec, name), write: () => writeMcpServer(file, name, null) })`, keep `removeMcpSecrets`.
    - `hv:mcp-connect-flow` (plugin's off server) → `writeMcpServer(file, name, withoutOffFlag(cfg))`, refresh; `needs-auth` → authenticate path; `connected` → `scheduleMcpReload`; anything else → write the cfg back with `enabled: false` and return the error (today's "a failed connect leaves it off").
    - `hv:mcp-install-catalog` unchanged except `description` (Task 12).
    - `hv:plugins-remove` (`:7138`) → each server through `removeServerInOrder`.
  - preload + `hv.d.ts`: rename `mcpSweepRemote` → `mcpRefresh` (channel `hv:mcp-refresh`), add `mcpSigninCancel`, `onMcpSignin`.
- [ ] **Step 4: Run** `L=/tmp/vitest.log; npx vitest run tests/mcp-pi.test.ts tests/mcp-status.test.ts tests/mcp-reload-scope.test.ts tests/mcp-reload-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`, then `npm run build` and grep the built main: `grep -c "hv:mcp-refresh" out/main/index.js` ≥ 1, `grep -c "mcp-oauth-bridge" out/main/index.js` = 0.
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp): MCP page status and sign-in through Pi"`

### Task 11: MCP page and catalog UI

**Files:**
- Modify: `src/renderer/src/components/McpServersSection.tsx` (`:40-62` tool list, `:202-227` statuses + `mcpRefresh` on mount, `:245-277` authenticate, `:322` off, `:355-359` direct pill, `:367-393` buttons, `:453-527` badge, `:549-568`/`:638-642` editor)
- Modify: `src/renderer/src/components/McpCatalogSection.tsx` (`:46-63`, `:114-133` via `McpConnectResult`)
- Test: `tests/mcp-status.test.ts` (exported badge data), a source-scan in `tests/mcp-chip.test.ts` or new `tests/mcp-page-copy.test.ts`

**Interfaces:**
- Consumes: Task 10 API. Produces: exported `MCP_SIGNIN_COPY = { waiting: "Waiting for sign-in in your browser…", reopen: "Open the sign-in page again", cancel: "Cancel" }` and `MCP_OVERRIDDEN_PILL = "Overridden by your global server"` (pinned data).

- [ ] **Step 1: Failing tests:** `MCP_SIGNIN_COPY`/`MCP_OVERRIDDEN_PILL` exported with those strings; source scan of `McpServersSection.tsx`: no `cfg.disabled`, no `directTools`, contains `exposure: "direct"` and `enabled === false`; `McpToolList` renders `t.description` only when present (scan for `t.description &&`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Mount: `window.hv.mcpRefresh()` instead of `mcpSweepRemote()`.
  - Off: `const off = s.cfg.enabled === false;`. Editor: checkbox "Expose tools directly" ⇄ `exposure: direct ? "direct" : "deferred"`; keep `enabled: false` when the server is off (mirrors `:567-568`).
  - Sign-in: while `mcpAuthenticate` is pending, the row shows `MCP_SIGNIN_COPY.waiting`, a link `MCP_SIGNIN_COPY.reopen` (opens the URL from `onMcpSignin` through the existing external-link helper) and a `Cancel` button → `mcpSigninCancel()`.
  - `overridden` state → muted pill `MCP_OVERRIDDEN_PILL`, no buttons.
  - Tool list: name, and the description line only if present (it never is today — decision 5).
  - `McpConnectResult` ("N tools discovered"): names only, same component.
- [ ] **Step 4: Run, expect PASS**; `npm run build`.
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp-page): Pi sign-in flow, names-only tools, overridden workspace servers"`

### Task 12: Catalog writes `description`

**Files:** Modify `src/main/mcpCatalog.ts:349-362`; Test `tests/mcp-catalog.test.ts`.

- [ ] **Step 1: Failing test:** for every entry, `buildCatalogInstall(entry, sampleValues).cfg.description === entry.tagline`.
- [ ] **Step 2: Run, expect FAIL.** `L=/tmp/vitest.log; npx vitest run tests/mcp-catalog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- [ ] **Step 3: Implement:** `const cfg = { ...entry.build(values, …), description: entry.tagline };` and update the `build` doc comment (`:62-69`): placeholders may appear in `headers` and stdio `env` (Pi resolves `${VAR}` there and in `oauth.clientSecret`; a missing variable fails the connection).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -s -m "feat(mcp-catalog): installs carry a one-line description for the model"`

### Task 13: Delete the main-side MCP client, OAuth, keychain sidecar

**Files:**
- Delete: `src/main/mcpOAuth.ts`, `src/main/mcpAuthStore.ts`, `src/main/mcpAdapterStore.ts`, `src/main/mcpClient.ts`, `src/main/mcpResolve.ts`, `pi-runtime/bin/mcp-oauth-bridge.src.mjs`, `scripts/build-mcp-oauth-bridge.mjs`
- Delete tests: `mcp-oauth`, `mcp-authstore`, `mcp-adapter-store`, `mcp-adapter-authformat`, `mcp-client`, `mcp-probe`, `mcp-resolve`, `mcp-adapter-disabled`, `mcp-adapter-interpolation` (`.test.ts` each)
- Modify: root `package.json:22` (postinstall) and `:56` (drop `@modelcontextprotocol/sdk`), `pi-runtime/package.json` postinstall (`node ../scripts/patch-tintinweb.mjs` only), `.gitignore:16-17`, `tests/native-modules.test.ts:91-93`, `tests/crash-wiring.test.ts:69-71`, `tests/windows-process.test.ts:42-49`, `tests/crash-safe-messages.test.ts:65`, `src/main/mcpPreregistered.ts` header comment (Pi does DCR, CIMD and pre-registered clients; Figma/Slack stay blocked because a plugin cannot ship a client secret and HappyVibe does not send another product's `clientName` — decision 15)

- [ ] **Step 1:** `grep -rn "mcpOAuth\|mcpAuthStore\|mcpAdapterStore\|mcpClient\|mcpResolve\|modelcontextprotocol\|mcp-oauth-bridge" src/ scripts/ tests/ package.json pi-runtime/package.json` — every hit is on the list above; anything else is a missed caller (stop and fix).
- [ ] **Step 2:** Delete and edit as listed; `npm install` (lockfile drops the SDK); `npm run catalog:crash-messages`.
- [ ] **Step 3:** `npm run gate` → EXIT 0. Then `grep -c "mcp-oauth-bridge\|pi-mcp-adapter.oauth" out/main/index.js` = 0.
- [ ] **Step 4: Commit** `git commit -s -m "chore(mcp): remove main's MCP client, OAuth flow and keychain sidecar"`

---

# Phase 3 — cleanup

### Task 14: Remove `pi-mcp-adapter` from the runtime

**Files:**
- Modify: `pi-runtime/package.json`, `pi-runtime/package-lock.json` (`cd pi-runtime && npm uninstall pi-mcp-adapter`)
- Modify: `tools/provider-catalog/build.ts:39-43,118-124`, `tests/provider-catalog.test.ts:26`, `tests/cache-retention.test.ts:29` (resolve pi-ai nested-or-top-level, nested first — same helper in one place, e.g. export `piAiDir(runtime)` from `build.ts` and import it in both tests)
- Modify: `tests/changelog.test.ts:80` (the `Runtime:` pins line no longer names the adapter), `CLAUDE.md:12,79`, `.claude/rules/providers.md:18-20`

- [ ] **Step 1:** Uninstall; `ls pi-runtime/node_modules/@earendil-works/pi-ai/package.json && node -p "require('./pi-runtime/node_modules/@earendil-works/pi-ai/package.json').version"` → `1.0.2` (hoisted — the adapter's peer range was what pinned 0.86.1). Record the result in `docs/validation/mcp2.md`.
- [ ] **Step 2:** Make `build.ts` and the two tests find pi-ai either place; `npm run catalog:providers`; `git diff --stat src/main/providerCatalog.generated.ts` → no change expected (same 1.0.2 data). If it changes, read the diff before committing.
- [ ] **Step 3:** `npm run gate` → EXIT 0; `npm run live:why` → run `npm run test:live` in the background as in Task 5.
- [ ] **Step 4: Commit** `git commit -s -m "chore(pi-runtime): drop pi-mcp-adapter; pi-ai dedupes to 1.0.2"`

### Task 15: Docs, rules, guide, changelog

**Files:**
- Rewrite: `.claude/rules/mcp.md` (current state: Pi runs servers; bridge maps names/registers workspace servers; main manages via `pi mcp` + workspace probe; secrets can still execute via `!command` in `headers`/`env`/`oauth.clientSecret` from a workspace file; `auth` stripped; live reload unchanged). Update its `paths:` frontmatter (drop deleted files, add `hv-mcp-config.ts`, `mcpPi.ts`, `mcpWorkspaceProbe.ts`, `mcpMigrate.ts`).
- Modify: `.claude/rules/pi-runtime.md:15`, `.claude/rules/plugins.md:21-28` (the `supportsOAuth` workaround is gone), `CLAUDE.md:96` (built-ins: `builtin:mcp` + `builtin:tool-search` now load in chat sessions)
- Modify: `docs/validation/d1.md` — new section "Pi 1.0.2 built-in MCP — RPC shapes": `/mcp` status notify text, `/mcp login` notify + `input` (aborted locally, no cancel), `pi mcp list --json` shape, `hv.mcp-tools`, `hv.permission.serverHint`
- Modify: `docs/guide/src/content/docs/mcp.md` ("Sign in to a server": browser, no keychain, Cancel, re-sign-in once, how to delete old `pi-mcp-adapter.oauth` keychain entries; "Your servers": names-only tool list, overridden workspace servers; "During a session": `tool_search` then the call, "Server says" line), `permissions.md:48-49,64` (no `mcp-manage:` rules; "Expose tools directly" = `exposure: direct`; read-only hint in plan mode), `agent-tools.md:25,31,51` (per-tool MCP rows), `plugins.md:58`
- Modify: `CHANGELOG.md` `[Unreleased]` — use the `changelog` skill: a **Heads up** (sign in to MCP servers once more; old keychain entries can be deleted) and the user-visible changes (no keychain prompts, "Server says" on the prompt, read-only tools follow your rules in plan mode)
- Modify: `docs/validation/mcp2.md` §"Upstream asks" — draft text for Pi: tool descriptions in `pi mcp list --json`; `pi mcp list <server>`; lazy start. **Guilhem files them** (outward-facing).

- [ ] **Step 1:** Write the docs. Run the `docs-reviewer` agent on the four guide pages; fix its findings.
- [ ] **Step 2:** `cd docs/guide && npm run build` (per `.claude/rules/docs.md`), then `npm run gate` at the root (`tests/how-it-works.test.ts`, `tests/docs-links.test.ts`, `tests/docs-doors.test.ts`, `tests/changelog.test.ts`).
- [ ] **Step 3: Commit** `git commit -s -m "docs(mcp): Pi's built-in MCP — rules, wire shapes, guide, changelog"`

---

## Verification

### Automated
- `npm run gate` green after every task from Task 3 on (build = three typechecks + non-live suite).
- Key-free Pi runs in the non-live suite: `tests/mcp-builtin-gate.test.ts`, `tests/mcp-pi.test.ts` (real `pi mcp list --json`), `tests/mcp-workspace-probe.test.ts`, `tests/resource-gate-contract.test.ts`.
- Live: `npm run test:live` after Tasks 5 and 14 (`live:why` will name `mcp-bridge.test.ts`); ~7–8 min wall time — a few seconds means `.env` is missing.
- Built-output checks: `grep -c "builtin:mcp" out/main/index.js` ≥ 1; `grep -c "mcp-oauth-bridge" out/main/index.js` = 0.

### GUI pass — what must be TRUE on screen

Setup: the worktree app on `:9333` (`.claude/rules` GUI recipes), fixture workspace `~/hv-gui-fixture` with a `.mcp.json` holding the echo server, global servers `context7` (key), `chrome-devtools` (stdio, catalog) and one OAuth remote (`linear` from the catalog); a pre-existing user rule `mcp:chrome-devtools_*` = allow, created **before** the build switch.

| # | Page | Observable claim |
|---|---|---|
| G1 | MCP page | `context7` and `chrome-devtools` rows read "connected · N tools" within ~10 s of opening the page; clicking the count lists tool **names** and no description lines. |
| G2 | MCP page | Signing in to `linear`: the browser opens, the row shows "Waiting for sign-in in your browser…" with "Open the sign-in page again" and Cancel; after approving, the row turns connected. **Absent: any macOS "wants to use your confidential information" keychain dialog** — at app launch, on opening the MCP page, during sign-in, and on the agent's first `linear` call. |
| G3 | MCP page | Cancel during sign-in returns the row to "needs sign-in" within 2 s; starting sign-in again opens the browser again (port freed — the `60f118f` class). |
| G4 | MCP page, workspace section | The fixture's `echo` row shows "connected · 1 tool"; giving the global file an `echo` server too makes the workspace row read "Overridden by your global server". |
| G5 | Plugins page → MCP page | Installing the Miro plugin adds `miro` switched off ("Connect"). **Absent: `miro` tools in a session before Connect** — in chat, asking for Miro gets a `tool_search` card with no Miro result. After Connect + sign-in, the same ask finds and calls a `mcp__miro__…` tool. |
| G6 | Chat | Asking "use context7 to look up React's useEffect docs": the transcript shows a `Searching tools: …` card **with no permission prompt**, then a card "MCP → context7: …" with the context7 brand icon. |
| G7 | Chat, permission prompt | A tool the server marks read-only shows "Server says: read-only" under the factual headline; a destructive one (e.g. a `linear` create/update tool, if it declares `destructiveHint`) shows "Server says: may delete data". The headline is factual (`MCP → linear: …`), never the model's intent. |
| G8 | Chat in Plan mode | With an allow rule `mcp:context7_*`, a read-only-hinted context7 call runs **without** a prompt; a `linear` tool without a read-only hint still prompts (floor-ask). |
| G9 | Chat | A `chrome-devtools` tool call runs **without** a prompt — the pre-migration `mcp:chrome-devtools_*` rule still matches. |
| G10 | Permissions page | The `mcp:chrome-devtools_*` rule is listed unchanged; **absent: any `mcp-manage:` rule** that existed before. |
| G11 | All Tools page | Each MCP tool appears as its own row (`mcp__context7__…`) with a live verdict; expanding one says "Checked as `mcp:context7_…` on every call". **Absent: the old single `mcp` row and `mcpScript`.** |
| G12 | Composer | Typing `/` lists skills and prompts only. **Absent: `/mcp`.** |
| G13 | Context panel | Tool definitions no longer list `mcp` or `mcpScript`; `tool_search` is listed; the total tool-definition tokens are lower than before the switch on the same session settings (note both numbers). |
| G14 | Activity Monitor / `ps` | With 2 sessions open, `chrome-devtools-mcp` runs 2 times; after closing one session, 1. The utility client adds none (0 copies with no session open). |

**Regression sequence (the risk this design carries — respawn + sign-in + workspace registration):**
1. Open sessions A and B in `~/hv-gui-fixture`. In A, start a long turn ("read every file under src and summarise").
2. While A is mid-turn, sign out of `linear` on the MCP page, then sign in again.
3. Expect: B (idle) shows the reload notice and respawns resumed at once; A finishes its turn first, then respawns. Neither transcript shows a stuck "Waiting for sign-in" dialog or an unanswered prompt.
4. In B, ask for a `linear` call → it runs (the new credential reached the session). The MCP page row is connected.
5. Close A. Open a third session C in the same workspace → the echo server's tools are reachable in C (registration runs on every spawn), and the process count from G14 matches the live sessions.
