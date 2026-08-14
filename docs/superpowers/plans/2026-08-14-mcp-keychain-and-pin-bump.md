# MCP keychain + runtime pin bump — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop HappyVibe main from keeping its own plaintext copy of MCP OAuth credentials, and make it read and write the store the adapter actually uses — fixing the status badge, re-authentication and logout in one pass.

**Architecture:** `pi-mcp-adapter` 2.17.0 moved MCP credentials into the OS keychain and now treats `<agentDir>/mcp-oauth/…/tokens.json` as a legacy artefact to import and delete. Main stops mirroring that store and calls the adapter's own code instead, through a one-shot Node **sidecar** on the existing `nodeExecPath()` / `pi-node.sh` route (the adapter ships TypeScript source and a native `@napi-rs/keyring` dependency, so the Electron main bundle cannot import it directly). Main keeps ownership of the interactive OAuth handshake — the adapter's own flow is still `ctx.hasUI`-gated — so only *storage* moves. The supported `pi-mcp-adapter/oauth` subpath arrived in 2.22.0, which forces the adapter to 2.25.0 and drags the whole runtime pin set with it.

**Tech Stack:** Electron 43 main process (TypeScript, electron-vite), `@modelcontextprotocol/sdk@1.29.0` (main's own, unchanged), vendored `pi-runtime` (`@earendil-works/pi-coding-agent`, `pi-subagents`, `pi-mcp-adapter`), vitest.

**Spec:** Notion "☔ MCP issue" (`3bcd33dfffca80629d31d51c9325ad89`), folded into `docs/prd.md` §13 as **Decision (2026-08-14)** and mirrored in the Notion PRD (`391d33dfffca80a0a383e50792d51c0a`).

## Global Constraints

- **Pin set moves together.** `pi-mcp-adapter` **2.25.0**, `@earendil-works/pi-coding-agent` **0.84.2**, `pi-subagents` **0.49.0**, `typebox` = whatever pi-coding-agent 0.84.2 declares, root `yaml` = whatever Pi depends on. Adapter 2.21.2+ declares `peerDependencies: { "@earendil-works/pi-ai": "^0.84.1" }`, so npm refuses the adapter bump without the Pi bump. All exact-pinned, no ranges.
- **Main never re-implements the keychain payload format.** No `@napi-rs/keyring` as a root dependency, no re-derivation of the service name, account hash, or the 1000-character chunk manifest. Every read and write goes through adapter code.
- **The division of labour in PRD §13 is unchanged.** Main still runs the interactive OAuth handshake (loopback callback, `state` CSRF check, `transport.finishAuth`). Only token *storage* moves behind the adapter's API.
- **No test may touch a real keychain.** Every test that reaches adapter auth code sets `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` before importing it. This is already the rule in `tests/mcp-adapter-authformat.test.ts` (`045b499`).
- **`--no-extensions --no-prompt-templates --no-themes --no-skills` stay on the spawn line**, and the three `-e` extension paths must still load after the bump (`tests/resource-gate-contract.test.ts`).
- **Live-Pi batch is required for this branch.** `npm run live:why` will print (the bump touches `pi-runtime/`), so `npm run test:live` is not optional. Run it backgrounded, and only alongside work that does not touch the tree.
- **Caveats from the bump go to a NEW Notion page**, not into the "☔ MCP issue" doc and not into `docs/prd.md`. Sub-agent consequences are collected there and addressed in a single later pass.

---

## Execution log (2026-08-14)

**Task 0 — measured, and it corrected the diagnosis.** `<agentDir>/mcp-oauth` is **not** absent: it holds `miro` (rewritten by main today) and `canva` (an orphan whose server is no longer configured; client info only, no token). `notion`'s directory *is* gone. Crucially, **`notion` holds no tokens in either store**, so its `needs-auth` badge is honest — the reported "page says signed-out about a server the session can use" is not what is happening here. The defect shows on **`miro`**, present in both stores with different access *and* refresh tokens: keychain `29730e78…` expiring **2026-08-04T07:41Z (expired)**, file `393d8a19…` expiring 2026-08-14T16:50Z. Main re-authenticated today; the agent still holds the ten-day-old expired copy. That is the round-8 split running **forwards** — the page optimistic about a server the session may be unable to use. Task 0's GUI steps are therefore folded into Task 8: the measurement is a sharper instrument than a badge screenshot, and the only thing left to observe (does the agent's expired `miro` token fail or silently refresh?) is an *after* question.

**Task 1 — answered: `SIDECAR_MODE = "bundled"`.** A plain `.mjs` cannot `import("pi-mcp-adapter/oauth")`: Node refuses to strip types for files under `node_modules` — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on Node 22.21.1. A deliberate restriction, not a missing flag; Pi loads `.ts` extensions through its own loader, which a bare Node child does not have. esbuild bundling works (1.0 MB, ~46 ms, `--external:@napi-rs/keyring`), and two further properties were verified against a real 2.25.0 install rather than assumed:

- the bundle exports all three subpath functions, and a token written at one URL reads back `present` there and `absent` at another — the URL binding main's status answer rests on;
- **esbuild dedupes the two import routes into one module instance.** The entry imports `mcp-auth.ts` twice — once transitively via the bare `pi-mcp-adapter/oauth` specifier, once by relative path for `updateClientInfo` / `removeAuthEntry`. Proven shared: a write through the subpath is visible to the relative import's store accessor, and a `removeAuthEntry` through the relative import makes the subpath's `inspect` report `absent`. Had they split, the memory store would have split with them and every sidecar test would have lied.

**Worktree state.** Neither `node_modules` existed here; both trees installed at the pre-bump pins so Task 0 could be measured on today's build. `.env` copied from the primary checkout (gitignored) — without it all 14 live tests skip silently.

**Task 2 — done, with one pin dropped from the bump.** Shipped: `pi-coding-agent` **0.84.2**, `pi-mcp-adapter` **2.25.0**, root `yaml` **2.9.0**; `typebox` stays 1.3.7 (what Pi 0.84.2 declares). **`pi-subagents` is HELD at 0.40.0**: 0.49.0 replaces delegation with a supervisor/"mission" model and took four live tests red in 4–8 s — the child's answer stops reaching main context (`Run fan-out: 0/64 used, 64 remaining…`), `partialResult.details.results[]` is empty, the foreground stops streaming the child transcript, and the bridge's relayed lifecycle events lose their `runId`. Its peer is `pi-ai >=0.80.0`, so holding it costs nothing and keeps the subagent rework as its own pass. Re-running the four files with only that pin reverted: **all green**. Caveats page: "Pi runtime bump 0.83 → 0.84.2 — caveats" (`3bcd33dfffca818a8c82f69d74700910`).

Two further findings from Task 2, both fixed here: the contract test pinned the *spelling* of pi-subagents' `agent_end` drain guard and went red on a pure rewrite (it now asserts the semantics, so it survives both pins); and **`npm run live:why` never fired for the pin bump at all** — it watched `pi-runtime/extensions/` but not the manifest, so the one change that swaps the Pi binary under every live test claimed no live run was needed. It watches `pi-runtime/package(-lock)?.json` now.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `pi-runtime/bin/mcp-oauth-bridge.src.mjs` | Sidecar **source**. Reads one JSON request on stdin, calls adapter auth code, writes one JSON response on stdout. Lives in `pi-runtime/` because that is where the adapter's `node_modules` is. |
| `scripts/build-mcp-oauth-bridge.mjs` | esbuild step, run from `postinstall`, that bundles the source into `pi-runtime/bin/mcp-oauth-bridge.mjs`. Required, not an optimisation — Node will not type-strip files under `node_modules` (Task 1). |
| `pi-runtime/bin/mcp-oauth-bridge.mjs` | The **built** bundle, gitignored and regenerated by `postinstall`, same as any other generated artefact. ~1 MB, `@napi-rs/keyring` left external. |
| `src/main/mcpAdapterStore.ts` | Main-side async wrapper over the sidecar. Electron-free, vitest-importable, sidecar path + spawn injected. The only place in `src/` that knows the sidecar exists. |
| `tests/mcp-adapter-store.test.ts` | Unit tests for the wrapper against a real sidecar spawn with the memory store. |

**Modified**

| File | Change |
|---|---|
| `src/main/mcpAuthStore.ts` | Becomes flow-state only: `codeVerifier` + `oauthState`. `tokens` / `clientInfo` / `serverUrl` and `authState()` are removed. |
| `src/main/mcpOAuth.ts` | `HvOAuthProvider` takes an injected store; `tokens()` / `clientInformation()` / `saveTokens()` / `saveClientInformation()` go through it. `logout()` becomes async. |
| `src/main/mcpClient.ts` | `probe()` accepts a pre-read entry instead of building a file-backed provider itself. |
| `src/main/ipc.ts` | `checkServer` / the startup sweep prefetch entries in one sidecar call; `hv:mcp-logout` awaits the async logout. |
| `pi-runtime/package.json` | The three pins + `typebox`. |
| `package.json` | Root `yaml` pin, if Pi 0.84.2 moved it. |
| `tests/mcp-adapter-authformat.test.ts` | Extended to pin the `/oauth` subpath, the URL binding, migrate-and-delete, and the reverse drift. |
| `tests/mcp-authstore.test.ts`, `tests/mcp-oauth.test.ts` | Follow the store split. |
| `CLAUDE.md` | The §MCP "share only the on-disk token store" sentence is false — replace it. |
| `docs/validation/m1.md` | New section recording the measured keychain facts and the sidecar contract. |

---

## Task 0: Capture the "before" evidence

This is manual, runs on Guilhem's machine (his login keychain holds the migrated `notion` credential), and produces the baseline the final GUI pass is compared against. It does not gate the design — the root cause is already established from the vendored sources — but the same three checks after the fix are what prove it.

**Files:**
- Create: `docs/validation/m1.md` section stub (filled in Task 8)

- [ ] **Step 1: Record the store state**

```bash
ls -la "$HOME/Library/Application Support/HappyVibe/pi-agent/mcp-oauth" 2>&1 || echo "ABSENT (expected)"
security find-generic-password -s 'pi-mcp-adapter.oauth' 2>&1 | grep -E '"acct"|"svce"' || echo "no keychain entries"
```

Expected: the directory is **absent**, and the keychain reports service `pi-mcp-adapter.oauth` with at least one `sha256-…` account.

- [ ] **Step 2: Record what the MCP page says**

Launch the app (`npm run dev`), open **Settings → MCP**, let the startup sweep finish, and write down each server's badge and tool count verbatim. Expect `notion → needs-auth (0 tools)` while other servers are `connected`.

- [ ] **Step 3: Ask a session to use the server the page calls signed-out**

In a chat session, prompt: `Use the notion MCP tool to fetch <any page URL you have access to>.` Approve the permission prompt.

Expected (the prediction under test): **the call succeeds** while the MCP page still shows `needs-auth`. Record the tool card's outcome.

- [ ] **Step 4: Confirm logout does not log out**

On the MCP page click **Log out** for `notion`. Then, in the same session, ask for the same MCP call again.

Expected (the defect): **it still succeeds**. Record it.

- [ ] **Step 5: Write the three outcomes into a scratch note**

No commit. Paste the three results into the task thread — they are the "before" column of Task 8's table.

---

## Task 1: Spike — can a plain Node child import `pi-mcp-adapter/oauth`?

Throwaway. The adapter's `exports` map sends `./oauth` to **`./oauth.ts`** — TypeScript source. Pi loads `.ts` extensions with its own loader; a bare Node child has no such loader. Node ≥22.18 strips types by default, but only *erasable* syntax, and `oauth.ts` transitively pulls `mcp-auth-flow.ts` and `mcp-auth.ts`. This decides whether the sidecar is a plain `.mjs` or a build-time esbuild bundle. **Do this before the pin bump** — it runs against an unpacked tarball and touches no repo file.

**Files:**
- Create: nothing in the repo. Work in the scratchpad.

**Interfaces:**
- Produces: a decision — `SIDECAR_MODE = "direct"` (plain `.mjs` importing the subpath) or `SIDECAR_MODE = "bundled"` (esbuild-prebuilt `.mjs`). Task 3 branches on it.

- [ ] **Step 1: Stage a real install of 2.25.0**

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i pi-mcp-adapter@2.25.0 --omit=dev 2>&1 | tail -3
pwd  # note this path, call it $STAGE
```

- [ ] **Step 2: Write the probe**

```js
// $STAGE/probe.mjs
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";
const oauth = await import("pi-mcp-adapter/oauth");
const auth = await import("pi-mcp-adapter/mcp-auth.ts");
console.log(JSON.stringify({
  subpath: Object.keys(oauth).sort(),
  relative: ["updateClientInfo", "removeAuthEntry"].filter((k) => typeof auth[k] === "function"),
}));
```

- [ ] **Step 3: Run it under the SAME runtime the app uses**

Electron-as-node is the runtime the sidecar will actually get, so test that, not the system `node`:

```bash
cd $STAGE
ELECTRON_RUN_AS_NODE=1 \
  "$(node -p 'require("electron")')" probe.mjs; echo "EXIT=$?"
```

(Run it from the HappyVibe worktree so `require("electron")` resolves; `cd` back to `$STAGE` for the script path.)

Expected on success: a JSON line listing `getMcpOAuthTokensForUrl`, `inspectMcpOAuthTokensForUrl`, `updateMcpOAuthTokensForUrl` and both relative-path functions.

- [ ] **Step 4: Decide**

- Exit 0 and the JSON prints → `SIDECAR_MODE = "direct"`.
- Any `ERR_UNKNOWN_FILE_EXTENSION`, `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, or a parse error → `SIDECAR_MODE = "bundled"`. Confirm the fallback works before moving on:

```bash
cd $STAGE
npx esbuild --bundle --platform=node --format=esm \
  --external:@napi-rs/keyring --outfile=bundled.mjs \
  node_modules/pi-mcp-adapter/oauth.ts 2>&1 | tail -5
```

`@napi-rs/keyring` stays external so the native binding is required at runtime rather than inlined.

- [ ] **Step 5: Report the decision in the task thread**

No commit — this task produces an answer, not code. State `SIDECAR_MODE` and paste the probe output.

---

## Task 2: The runtime pin bump

**Files:**
- Modify: `pi-runtime/package.json`, `pi-runtime/package-lock.json`
- Modify: `package.json`, `package-lock.json` (only if Pi 0.84.2 moved `yaml`)

**Interfaces:**
- Produces: `pi-runtime/node_modules/pi-mcp-adapter@2.25.0` with the `./oauth` export, which every later task depends on.

- [ ] **Step 1: Read the current pins and Pi's own declarations**

```bash
grep -E '"(@earendil-works/pi-coding-agent|pi-subagents|pi-mcp-adapter|typebox)"' pi-runtime/package.json
grep '"yaml"' package.json
npm view @earendil-works/pi-coding-agent@0.84.2 dependencies.typebox dependencies.yaml
```

Record the answers — `typebox` in `pi-runtime/package.json` and `yaml` in the root `package.json` must equal exactly what Pi 0.84.2 declares. `tests/pi-subagents-contract.test.ts` asserts that relationship and will fail until they follow.

- [ ] **Step 2: Bump the pins**

Edit `pi-runtime/package.json` to exactly:

```json
"@earendil-works/pi-coding-agent": "0.84.2",
"pi-mcp-adapter": "2.25.0",
"pi-subagents": "0.49.0",
"typebox": "<whatever step 1 printed>"
```

Then update the root `yaml` pin if step 1 showed it moved. No `^`, no `~`.

- [ ] **Step 3: Install and prove the subpath is there**

```bash
(cd pi-runtime && rm -rf node_modules && npm install && npm ci)
node -p 'JSON.stringify(require("./pi-runtime/node_modules/pi-mcp-adapter/package.json").exports)'
```

Expected: an `exports` map containing `"./oauth"`. If npm reports `ERESOLVE`, the Pi pin did not move — go back to step 2.

- [ ] **Step 4: Run the full gate**

```bash
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -40 $L
```

Never pipe this to `tail` directly — the exit code would come from `tail`. Redirect, then grep `$L` for free.

- [ ] **Step 5: Run the live-Pi batch**

```bash
npm run live:why          # will print — the bump touches pi-runtime/
L=/tmp/live.log
npm run test:live > $L 2>&1; echo "EXIT=$?"
tail -60 $L
```

Run this **backgrounded** (`run_in_background: true`) and do not edit `pi-runtime/` or `src/` while it runs — vitest collects files as it goes and the live files spawn real Pi children. ~6 minutes, serial by design.

- [ ] **Step 6: Triage failures against the four known upstream tripwires**

Before assuming a bug, check these — CLAUDE.md documents all four as things that broke silently before:

1. `tests/pi-subagents-contract.test.ts` — the two relative-path imports (`src/runs/background/async-status.ts`, `src/shared/types.ts`) must still resolve; an `exports`-map change makes them throw at extension LOAD and takes ~18 tests red at once.
2. `WAIT_TOOLS` / `isWaitTool` (`hv-rules.ts`) — a renamed wait tool silently unblocks the "never block on a delegation" guard.
3. The subagent child transcript shape (`toolCalls` vs `results[].messages`) in `agents-renderer.test.ts`.
4. `ctx.hasUI` under `--mode rpc` — pi-subagents' `drainOutstandingWork` is dormant only because it is true. If that group fails, re-measure with a probe extension before believing anything else.
5. Every subagent `tools:` name must be in Pi 0.84.2's builtin set (`bash, edit, find, grep, ls, read, write` at 0.83 — re-derive, do not assume).

- [ ] **Step 7: Write the caveats to a NEW Notion page**

Create a page under "Happyibe" titled `Pi runtime bump 0.83 → 0.84.2 — caveats`. One section per surprise, with the failing test name and the measured cause. Sub-agent consequences go here and are **not** fixed in this branch. If nothing surprising happened, say so on the page — an empty caveat list is a finding.

- [ ] **Step 8: Commit**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json package.json package-lock.json
git commit -m "chore(runtime): pi 0.84.2, pi-subagents 0.49.0, pi-mcp-adapter 2.25.0

The adapter bump is the point: 2.22.0 added the pi-mcp-adapter/oauth
subpath main needs to stop mirroring a token store the adapter no
longer reads. 2.21.2+ declares a pi-ai ^0.84.1 peer, so the adapter
cannot move without Pi moving, and pi-subagents follows rather than
carrying nine minors of drift behind it. typebox and yaml track Pi's
own declarations, as tests/pi-subagents-contract.test.ts asserts."
```

---

## Task 3: The sidecar and its main-side wrapper

**Files:**
- Create: `pi-runtime/bin/mcp-oauth-bridge.mjs`
- Create: `src/main/mcpAdapterStore.ts`
- Test: `tests/mcp-adapter-store.test.ts`

**Interfaces:**
- Consumes: `pi-mcp-adapter/oauth` (`inspectMcpOAuthTokensForUrl`, `updateMcpOAuthTokensForUrl`) and, by **relative path**, `pi-mcp-adapter/mcp-auth.ts` (`updateClientInfo`, `removeAuthEntry`). The subpath does not cover client-info writes or removal; the relative form is the documented escape from an `exports` map, same as the two `pi-subagents` internals CLAUDE.md pins. Both routes are pinned in Task 6.
- Produces:

```ts
export interface AdapterStoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix seconds
  scope?: string;
}
export interface AdapterStoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
}
export type AdapterEntry =
  | { status: "present"; tokens: AdapterStoredTokens }
  | { status: "absent" }
  | { status: "unavailable"; message: string };

export interface AdapterStore {
  read(servers: readonly { name: string; url: string }[]): Promise<Record<string, AdapterEntry>>;
  writeTokens(name: string, url: string, tokens: AdapterStoredTokens): Promise<void>;
  writeClientInfo(name: string, url: string, info: AdapterStoredClientInfo): Promise<void>;
  remove(name: string): Promise<void>;
}
export function createAdapterStore(opts: {
  agentDir: string;
  runtimeDir: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}): AdapterStore;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-adapter-store.test.ts
/**
 * The sidecar is the ONLY route main has to MCP credentials. It runs the
 * adapter's own code in a child process, so this test spawns it for real —
 * against PI_MCP_ADAPTER_TEST_AUTH_STORE=memory, so it can never read or
 * write a developer's login keychain.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createAdapterStore } from "../src/main/mcpAdapterStore";

const RUNTIME = resolve(__dirname, "..", "pi-runtime");
const URL_A = "https://mcp.example.com/mcp";
const URL_B = "https://other.example.com/mcp";

let tmp: string;
const store = (): ReturnType<typeof createAdapterStore> =>
  createAdapterStore({
    agentDir: tmp,
    runtimeDir: RUNTIME,
    env: { PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory" },
  });

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-adapter-store-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("mcpAdapterStore", () => {
  it("reports absent for a server it has never seen", async () => {
    const out = await store().read([{ name: "hv-fixture", url: URL_A }]);
    expect(out["hv-fixture"]).toEqual({ status: "absent" });
  });

  it("reads many servers in ONE spawn", async () => {
    const out = await store().read([
      { name: "a", url: URL_A }, { name: "b", url: URL_A }, { name: "c", url: URL_A },
    ]);
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
    for (const k of ["a", "b", "c"]) expect(out[k].status).toBe("absent");
  });

  it("says unavailable, never absent, when the sidecar cannot answer", async () => {
    // "absent" is a claim that the user is signed out. Making that claim on no
    // evidence is the bug this whole branch replaces, so a broken sidecar must
    // never produce it.
    const broken = createAdapterStore({ agentDir: tmp, runtimeDir: "/nonexistent-runtime" });
    await expect(broken.read([{ name: "a", url: URL_A }])).rejects.toThrow();
  });
});

describe("mcp-oauth-bridge protocol", () => {
  // The memory store lives in the sidecar PROCESS, so a write in one spawn is
  // invisible to a read in the next. Round-trips are therefore asserted as one
  // batched request — which is also the shape the startup sweep uses, so this
  // pins the protocol that matters rather than a testing convenience.
  it("round-trips a credential and honours the URL binding within one request", async () => {
    const res = await runBridge(tmp, [
      { op: "writeTokens", name: "hv-fixture", url: URL_A, tokens: { accessToken: "tok-xyz" } },
      { op: "inspect", name: "hv-fixture", url: URL_A },
      { op: "inspect", name: "hv-fixture", url: URL_B },
      { op: "remove", name: "hv-fixture" },
      { op: "inspect", name: "hv-fixture", url: URL_A },
    ]);
    expect(res[1]).toMatchObject({ status: "present", tokens: { accessToken: "tok-xyz" } });
    expect(res[2].status).toBe("absent"); // different URL is not this credential
    expect(res[4].status).toBe("absent"); // remove actually removed it
  });
});
```

`runBridge(agentDir, ops)` is a six-line local helper that spawns `pi-runtime/bin/mcp-oauth-bridge.mjs` with `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` and returns the parsed `results` array. Keep it in the test file: it deliberately does **not** go through `createAdapterStore`, so a wrapper bug cannot mask a protocol bug.

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-adapter-store.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: FAIL — `Failed to resolve import "../src/main/mcpAdapterStore"`.

- [ ] **Step 3: Write the sidecar source and its build step**

Task 1 settled this: `SIDECAR_MODE = "bundled"`. Write the source as `pi-runtime/bin/mcp-oauth-bridge.src.mjs` — **top-level `import` statements, not dynamic `await import()`**, because esbuild must be able to follow them statically:

```js
import { inspectMcpOAuthTokensForUrl, updateMcpOAuthTokensForUrl } from "pi-mcp-adapter/oauth";
import { updateClientInfo, removeAuthEntry } from "../node_modules/pi-mcp-adapter/mcp-auth.ts";
```

Verified in Task 1: esbuild resolves both and **dedupes them to one module instance**, so the adapter's store state is shared across the two routes. Then add the build step and wire it into `postinstall` beside the existing `fix-pty-helper.mjs`:

```js
// scripts/build-mcp-oauth-bridge.mjs
// The sidecar CANNOT be a plain script: Node refuses to strip types for files
// under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and the
// adapter ships TypeScript source. Pi loads .ts through its own loader; a bare
// Node child has none. So we bundle. @napi-rs/keyring stays EXTERNAL — it is a
// native binding and must be required at runtime, not inlined.
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, "pi-runtime", "bin", "mcp-oauth-bridge.mjs");

await build({
  entryPoints: [path.join(root, "pi-runtime", "bin", "mcp-oauth-bridge.src.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@napi-rs/keyring"],
  outfile,
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync(outfile, 0o755);
```

Add `pi-runtime/bin/mcp-oauth-bridge.mjs` to `.gitignore` (generated), and confirm `electron-builder.yml` still ships `pi-runtime/bin/` in the packaged app — the sidecar is useless if it is not there. The source body is below; keep the two `import` lines above in place of its two `await import(...)` calls:

```js
// HappyVibe: the ONLY route main has to MCP OAuth credentials.
//
// pi-mcp-adapter >=2.17.0 keeps credentials in the OS keychain and treats
// <agentDir>/mcp-oauth/.../tokens.json as a legacy artefact to import and
// delete. Main must therefore never mirror that store — it runs the adapter's
// own code here, in a child process, because the adapter ships TypeScript
// source and a native @napi-rs/keyring binding that do not belong in the
// Electron main bundle.
//
// Protocol: ONE JSON request on stdin, ONE JSON response line on stdout.
// A batch of ops per invocation is load-bearing: the startup sweep reads every
// configured server in a single spawn rather than one spawn per server.
import { readFileSync } from "node:fs";

// The `/oauth` subpath (adapter >=2.22.0) is the supported surface, but it
// covers only token read/write. Client-info writes and removal live in
// mcp-auth.ts, reached by RELATIVE path — an exports map gates bare specifiers
// only, the same escape CLAUDE.md documents for two pi-subagents internals.
// Both routes are pinned by tests/mcp-adapter-authformat.test.ts.
const { inspectMcpOAuthTokensForUrl, updateMcpOAuthTokensForUrl } = await import(
  "pi-mcp-adapter/oauth"
);
const { updateClientInfo, removeAuthEntry } = await import(
  "../node_modules/pi-mcp-adapter/mcp-auth.ts"
);

const req = JSON.parse(readFileSync(0, "utf-8"));

// getAuthBaseDir() reads PI_CODING_AGENT_DIR on every call, so setting it here
// is in time (verified: agent-dir.ts does not cache).
if (req.agentDir) process.env.PI_CODING_AGENT_DIR = req.agentDir;

const results = [];
try {
  for (const op of req.ops ?? []) {
    switch (op.op) {
      case "inspect":
        results.push({ name: op.name, ...inspectMcpOAuthTokensForUrl(op.name, op.url) });
        break;
      case "writeTokens":
        updateMcpOAuthTokensForUrl(op.name, op.url, op.tokens);
        results.push({ name: op.name, status: "ok" });
        break;
      case "writeClientInfo":
        updateClientInfo(op.name, op.clientInfo, op.url);
        results.push({ name: op.name, status: "ok" });
        break;
      case "remove":
        removeAuthEntry(op.name);
        results.push({ name: op.name, status: "ok" });
        break;
      default:
        results.push({ name: op.name, status: "unavailable", message: `unknown op ${op.op}` });
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
} catch (err) {
  // Fail CLOSED with a message, never silently: an unreadable credential store
  // must surface as "unavailable", not as "absent" — "absent" would make the
  // MCP page claim signed-out, which is the exact bug this replaces.
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: err?.message ?? String(err), results })}\n`,
  );
}
```

Make it executable and confirm it survives the postinstall chmod pass the way `spawn-helper` does:

```bash
chmod +x pi-runtime/bin/mcp-oauth-bridge.mjs
```

- [ ] **Step 4: Write the main-side wrapper**

```ts
// src/main/mcpAdapterStore.ts
/**
 * mcpAdapterStore — main's only route to MCP OAuth credentials.
 *
 * pi-mcp-adapter >=2.17.0 keeps credentials in the OS keychain, so main cannot
 * read or write them from a file any more, and must not re-implement the
 * payload format (service name, sha256 account, 1000-char chunk manifest) —
 * mirroring an undocumented internal is what broke last time. Instead we spawn
 * a one-shot sidecar that runs the adapter's own code.
 *
 * Electron-free (node builtins only) and vitest-importable: execPath and env
 * are injected, exactly like spawn.ts.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { nodeExecPath } from "./pi/spawn.js";

export const MCP_OAUTH_BRIDGE_RELPATH = "bin/mcp-oauth-bridge.mjs";

export interface AdapterStoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix seconds
  scope?: string;
}

export interface AdapterStoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
}

export type AdapterEntry =
  | { status: "present"; tokens: AdapterStoredTokens }
  | { status: "absent" }
  | { status: "unavailable"; message: string };

type Op =
  | { op: "inspect"; name: string; url: string }
  | { op: "writeTokens"; name: string; url: string; tokens: AdapterStoredTokens }
  | { op: "writeClientInfo"; name: string; url: string; clientInfo: AdapterStoredClientInfo }
  | { op: "remove"; name: string };

export interface AdapterStore {
  read(servers: readonly { name: string; url: string }[]): Promise<Record<string, AdapterEntry>>;
  writeTokens(name: string, url: string, tokens: AdapterStoredTokens): Promise<void>;
  writeClientInfo(name: string, url: string, info: AdapterStoredClientInfo): Promise<void>;
  remove(name: string): Promise<void>;
}

const SIDECAR_TIMEOUT_MS = 10_000;

export function createAdapterStore(opts: {
  agentDir: string;
  runtimeDir: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}): AdapterStore {
  const script = path.join(opts.runtimeDir, MCP_OAUTH_BRIDGE_RELPATH);

  const run = (ops: Op[]): Promise<{ name: string; status: string; message?: string; tokens?: AdapterStoredTokens }[]> =>
    new Promise((resolve, reject) => {
      const child = spawn(opts.execPath ?? nodeExecPath(), [script], {
        cwd: opts.runtimeDir,
        stdio: ["pipe", "pipe", "ignore"], // ponytail: adapter chatter on stderr is not ours to relay
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env ?? {}) },
      });
      let out = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("mcp-oauth-bridge timed out")); }, SIDECAR_TIMEOUT_MS);
      child.stdout.on("data", (d) => { out += d; });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out) return reject(new Error(`mcp-oauth-bridge exited ${code}`));
        try {
          const parsed = JSON.parse(out.trim().split("\n").pop() ?? "{}");
          if (!parsed.ok && !parsed.results?.length) return reject(new Error(parsed.error ?? "mcp-oauth-bridge failed"));
          resolve(parsed.results ?? []);
        } catch (e) {
          reject(new Error(`mcp-oauth-bridge returned invalid JSON: ${String(e)}`));
        }
      });
      child.stdin.end(JSON.stringify({ agentDir: opts.agentDir, ops }));
    });

  return {
    async read(servers) {
      if (!servers.length) return {};
      const results = await run(servers.map((s) => ({ op: "inspect", name: s.name, url: s.url })));
      const out: Record<string, AdapterEntry> = {};
      for (const s of servers) {
        const r = results.find((x) => x.name === s.name);
        // A missing result is NOT "absent" — we don't know, so say so.
        out[s.name] = !r
          ? { status: "unavailable", message: "no result from credential sidecar" }
          : r.status === "present" && r.tokens
            ? { status: "present", tokens: r.tokens }
            : r.status === "unavailable"
              ? { status: "unavailable", message: r.message ?? "credential store unavailable" }
              : { status: "absent" };
      }
      return out;
    },
    async writeTokens(name, url, tokens) { await run([{ op: "writeTokens", name, url, tokens }]); },
    async writeClientInfo(name, url, clientInfo) { await run([{ op: "writeClientInfo", name, url, clientInfo }]); },
    async remove(name) { await run([{ op: "remove", name }]); },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-adapter-store.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS, 4 tests. If `read` after `writeTokens` returns `absent`, the memory store did not survive the spawn boundary — merge the write and the read into one `run([...])` batch in the test rather than weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add pi-runtime/bin/mcp-oauth-bridge.mjs src/main/mcpAdapterStore.ts tests/mcp-adapter-store.test.ts
git commit -m "feat(mcp): main reaches OAuth credentials through the adapter, not a file

The adapter keeps credentials in the OS keychain from 2.17.0 and deletes
our plaintext copy on sight. Rather than re-implement its payload format
— service name, sha256 account, 1000-char chunk manifest, Linux keyring
recovery — main runs the adapter's own code in a one-shot sidecar on the
route every Pi child already takes. Ops batch per invocation so the
startup sweep costs one spawn, not one per server."
```

---

## Task 4: `mcpOAuth.ts` persists through the adapter; `mcpAuthStore.ts` keeps only flow state

**Files:**
- Modify: `src/main/mcpAuthStore.ts`
- Modify: `src/main/mcpOAuth.ts`
- Test: `tests/mcp-authstore.test.ts`, `tests/mcp-oauth.test.ts`

**Interfaces:**
- Consumes: `createAdapterStore` / `AdapterStore` / `AdapterStoredTokens` / `AdapterStoredClientInfo` from Task 3.
- Produces:
  - `mcpAuthStore.ts` exports shrink to `serverDir`, `authEntryPath`, `readFlowState`, `writeFlowState`, `clearFlowState`, and `interface FlowState { codeVerifier?: string; oauthState?: string }`. `AuthEntry`, `StoredTokens`, `StoredClientInfo`, `readAuthEntry`, `writeAuthEntry`, `deleteAuthEntry` and `authState` are **gone**.
  - `authenticate(name, cfg, agentDir, deps)` keeps its signature; `deps` gains a required `store: AdapterStore`.
  - `logout(name, agentDir, store)` becomes `Promise<void>`.
  - `probeAuthProvider(name, serverUrl, agentDir, entry)` takes a pre-read `AdapterEntry` and no longer touches disk for tokens.

Why the split rather than deleting the file: `codeVerifier` and `oauthState` are per-flow PKCE/CSRF state that only main uses, live for seconds, and are not credentials the adapter ever reads. Keeping them out of the keychain is strictly better, and keeping **nothing credential-shaped** in `<agentDir>/mcp-oauth` means there is no longer any file for the adapter to migrate.

- [ ] **Step 1: Write the failing tests**

Replace the token-shaped cases in `tests/mcp-authstore.test.ts` with flow-state cases, and add the guard that matters:

```ts
// tests/mcp-authstore.test.ts (replacing the AuthEntry cases)
import { readFileSync, existsSync } from "node:fs";
import { serverDir, authEntryPath, readFlowState, writeFlowState, clearFlowState } from "../src/main/mcpAuthStore";

it("round-trips flow state", () => {
  writeFlowState(tmp, "notion", { codeVerifier: "v-1", oauthState: "s-1" });
  expect(readFlowState(tmp, "notion")).toEqual({ codeVerifier: "v-1", oauthState: "s-1" });
});

it("clearFlowState leaves no readable file", () => {
  writeFlowState(tmp, "notion", { codeVerifier: "v-1" });
  clearFlowState(tmp, "notion");
  expect(readFlowState(tmp, "notion")).toBeUndefined();
  expect(existsSync(serverDir(tmp, "notion"))).toBe(false);
});

// The whole point of the split: nothing credential-shaped stays on disk, so
// there is nothing left for the adapter to import-and-delete.
it("never writes a token or client secret to disk", () => {
  writeFlowState(tmp, "notion", { codeVerifier: "v-1", oauthState: "s-1" });
  const raw = readFileSync(authEntryPath(tmp, "notion"), "utf-8");
  expect(raw).not.toMatch(/accessToken|refreshToken|clientSecret/);
});
```

In `tests/mcp-oauth.test.ts`, replace every `readAuthEntry(tmp, …)?.tokens` assertion with an assertion against an injected fake store:

```ts
const writes: { name: string; url: string; tokens: unknown }[] = [];
const fakeStore = {
  read: async () => ({}),
  writeTokens: async (name: string, url: string, tokens: unknown) => { writes.push({ name, url, tokens }); },
  writeClientInfo: async () => {},
  remove: async () => {},
};

it("persists the minted token through the adapter store, never to a file", async () => {
  await authenticate("seeded", cfg, tmp, { openExternal, store: fakeStore });
  expect(writes.at(-1)).toMatchObject({
    name: "seeded",
    url: cfg.url,
    tokens: { accessToken: "mock-access-token" },
  });
  expect(readFileSync(authEntryPath(tmp, "seeded"), "utf-8")).not.toMatch(/mock-access-token/);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-authstore.test.ts tests/mcp-oauth.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: FAIL on the missing `readFlowState` / `writeFlowState` / `clearFlowState` exports and on `deps.store` not being accepted.

- [ ] **Step 3: Shrink `mcpAuthStore.ts`**

Keep `serverDir` and `authEntryPath` as they are (the path shape is still ours), rename the payload, and delete the rest:

```ts
/**
 * mcpAuthStore — per-flow OAuth state ONLY (PKCE verifier + CSRF state).
 *
 * Credentials do NOT live here any more. pi-mcp-adapter >=2.17.0 keeps them in
 * the OS keychain and deletes any plaintext file it finds, so main persists
 * tokens and client info through mcpAdapterStore instead. What is left is
 * transient state that only main reads, lives for the duration of one browser
 * round-trip, and is deliberately not credential-shaped — which is what makes
 * this directory uninteresting to the adapter's legacy-import path.
 */
export interface FlowState {
  codeVerifier?: string;
  oauthState?: string;
}

export function readFlowState(agentDir: string, name: string): FlowState | undefined { /* JSON.parse of authEntryPath, undefined on miss or parse failure */ }
export function writeFlowState(agentDir: string, name: string, state: FlowState): void { /* mkdir 0o700, write 0o600 */ }
export function clearFlowState(agentDir: string, name: string): void { /* blank the file 0o600, then rm the dir — same order as before */ }
```

Carry the existing bodies over verbatim; only the type and the exported names change. Keep the blank-then-remove order in `clearFlowState` — a partial failure must never leave a readable file.

- [ ] **Step 4: Rewire `mcpOAuth.ts`**

- `AuthDeps` gains `store: AdapterStore`.
- `HvOAuthProvider` takes the store plus, for probe mode, a pre-read `AdapterEntry`.
- `tokens()` returns from the pre-read entry (probe) or `await`s `store.read` (interactive); the SDK accepts a Promise here.
- `saveTokens()` → `await store.writeTokens(name, serverUrl, {…})`, mapping `expires_in` → `expiresAt` seconds exactly as today.
- `saveClientInformation()` → `await store.writeClientInfo(name, serverUrl, {…})`; still a no-op in probe mode.
- `clientInformation()` reads back through the store; keep the redirect-URI port check verbatim — it is why re-auth on a fresh loopback port works.
- `state()` / `saveCodeVerifier()` / `codeVerifier()` use `writeFlowState` / `readFlowState`.
- The stale-refresh-token guard near line 296 (`prior?.tokens && !prior.clientInfo?.redirectUris?.includes(...)`) now reads both halves from the store; keep its logic unchanged — it is what stops Notion's "Client ID mismatch".
- `logout(name, agentDir, store)` → `await store.remove(name)` **and** `clearFlowState(agentDir, name)`.

- [ ] **Step 4b: Sweep the credentials main already wrote**

Found while measuring Task 0, and not in the original plan: `<agentDir>/mcp-oauth` holds a `canva` entry from a server that is **no longer configured**. For a configured server the adapter eventually migrates the file and deletes it, but for an orphan nobody ever will — so a plaintext OAuth entry sits on disk indefinitely, for a server the user believes they removed. Once main stops writing tokens there, nothing else will ever clean it up either.

Add a one-time sweep, called once at startup next to the existing MCP wiring:

```ts
/**
 * One-time migration of everything main wrote before it stopped owning this
 * store. A CONFIGURED server's file is handed to the adapter first (a migrating
 * read imports it into the keychain), so no live credential is lost. An ORPHAN
 * — a server no longer in any mcp.json — is simply deleted: we cannot know its
 * URL, nothing reads it, and leaving a plaintext credential on disk for a
 * server the user thinks they removed is the worse of the two outcomes.
 */
export async function sweepLegacyCredentials(
  agentDir: string,
  configured: readonly { name: string; url: string }[],
  store: AdapterStore,
): Promise<{ migrated: number; deleted: number }>;
```

Implementation: `store.read(configured)` once (a migrating read is what imports them), then for every remaining `mcp-oauth/sha256-*/tokens.json` whose hash is not in `configured`, blank the file `0o600` and remove its directory — the same blank-then-remove order `clearFlowState` uses. Log the counts through `log.append({ type: "mcp.legacy_sweep", … })`; a silent cleanup of credential files is not something to do quietly.

Add a test that an orphan directory is removed while a configured server's is left to the adapter:

```ts
it("deletes an orphan's plaintext credential and leaves configured servers to the adapter", async () => {
  writeLegacyEntry(tmp, "gone-server", { tokens: { accessToken: "orphan-tok" } });
  const res = await sweepLegacyCredentials(tmp, [], fakeStore);
  expect(res.deleted).toBe(1);
  expect(existsSync(serverDir(tmp, "gone-server"))).toBe(false);
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-authstore.test.ts tests/mcp-oauth.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcpAuthStore.ts src/main/mcpOAuth.ts tests/mcp-authstore.test.ts tests/mcp-oauth.test.ts
git commit -m "fix(mcp): tokens persist where the adapter reads them, and Log out reaches it

Signing in again used to write a file the adapter deletes unread, so the
agent kept the old credential; Log out removed that file and left the
keychain entry alive, so the session stayed signed in. Both now go
through the adapter's own store. What stays on disk is PKCE and CSRF
state only — nothing credential-shaped, so there is no longer a file for
the adapter's legacy-import path to consume."
```

---

## Task 5: The probe, the sweep and the logout IPC

**Files:**
- Modify: `src/main/mcpClient.ts:85-120` (`probe` / `probeOnce` signature and the http branch)
- Modify: `src/main/ipc.ts:660-720` (`checkServer` + the startup sweep), `src/main/ipc.ts:2621+` (`hv:mcp-logout`), `src/main/ipc.ts:2603` (`authenticate` call site), `src/main/ipc.ts:2545`
- Test: `tests/mcp-client.test.ts`

**Interfaces:**
- Consumes: `AdapterStore` / `AdapterEntry` (Task 3), `probeAuthProvider(name, url, agentDir, entry)` (Task 4).
- Produces: `probe(name, cfg, agentDir, opts?)` gains `opts.authEntry?: AdapterEntry`. When the config is `http(s)` and no entry is supplied, `probe` reads one itself via `opts.store` — so a single-server reconnect still works without the caller prefetching.

The sweep prefetches **once**: one `store.read([...all http servers])` call, one spawn, then each `checkServer` is handed its entry.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-client.test.ts (add)
it("passes a pre-read credential to the auth provider instead of reading disk", async () => {
  const seen: string[] = [];
  const entry = { status: "present" as const, tokens: { accessToken: "prefetched" } };
  // A stdio-free http config; connect will fail (no server), which is fine —
  // what this pins is that probe consulted the entry, not the filesystem.
  await probe("srv", { url: "https://127.0.0.1:9/mcp" }, "/nonexistent-agent-dir", {
    connectMs: 200, listMs: 200, retries: 0,
    authEntry: entry,
    onProviderToken: (t: string) => seen.push(t), // test-only hook, see step 3
  } as never);
  expect(seen).toContain("prefetched");
});

it("never reports needs-auth when the credential store is unavailable", async () => {
  const r = await probe("srv", { url: "https://127.0.0.1:9/mcp" }, "/nonexistent-agent-dir", {
    connectMs: 200, listMs: 200, retries: 0,
    authEntry: { status: "unavailable", message: "keyring locked" },
  } as never);
  // "unavailable" means we do not know. Saying needs-auth would be the old bug
  // in a new costume: a confident signed-out claim about a working server.
  expect(r.state).toBe("failed");
  expect(r.error).toMatch(/keyring locked/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-client.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: FAIL — `authEntry` is not a `ProbeOpts` field.

- [ ] **Step 3: Implement**

In `mcpClient.ts`:
- Add `authEntry?: AdapterEntry` and `store?: AdapterStore` to `ProbeOpts`.
- In `probeOnce`, the http branch resolves the entry as `opts.authEntry ?? (opts.store ? (await opts.store.read([{name, url: cfg.url!}]))[name] : { status: "absent" })`.
- If the resolved entry is `{status:"unavailable"}`, return `{ state: "failed", error: message }` **before** connecting. Do not map it to `needs-auth`.
- Pass the entry into `probeAuthProvider(name, cfg.url!, agentDir, entry)`.
- Add the `onProviderToken` test hook only if the assertion in step 1 cannot be made otherwise; prefer asserting through a fake store and dropping the hook.

In `ipc.ts`:
- Build the store once near the other MCP wiring: `const adapterStore = createAdapterStore({ agentDir: agentDir(), runtimeDir: runtimeDir() })`.
- `checkServer` gains an optional `entry` parameter and passes it as `opts.authEntry`; when absent it passes `opts.store = adapterStore`.
- The startup sweep, before `mapLimit`, collects every `http(s)` server across global + workspace tiers and does **one** `await adapterStore.read(...)`, then hands each `checkServer` its entry. Keep `SWEEP_CONCURRENCY = 4` for the connections themselves.
- `hv:mcp-authenticate` passes `store: adapterStore` in `deps`.
- `hv:mcp-logout` becomes `await logout(name, agentDir(), adapterStore)`. Keep the best-effort `/mcp logout` utility prompt and the status-map update exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-client.test.ts tests/mcp-adapter-store.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS.

- [ ] **Step 5: Run the whole non-live suite**

```bash
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -40 $L
```

Expected: PASS. `npm run gate` runs both typechecks first and fast-fails on them — do not run `npm run typecheck` separately.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcpClient.ts src/main/ipc.ts tests/mcp-client.test.ts
git commit -m "fix(mcp): the status badge asks the store the agent actually uses

The probe read a plaintext file the adapter had already consumed, so a
server the session was using perfectly well showed needs-auth — the
round-8 sign-in/session split running in reverse. It now consults the
adapter's own store, and the sweep prefetches every server in one
sidecar spawn rather than one per server. An unreadable store reports
failed with its reason, never needs-auth: a confident signed-out claim
about a working server is the bug, not the fix."
```

---

## Task 6: The contract test becomes the pin-bump gate for the new arrangement

**Files:**
- Modify: `tests/mcp-adapter-authformat.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this test talks to the vendored adapter directly, which is the point.

The existing file already sets `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` and pins that escape hatch (`045b499`). Keep both cases. What changes is that the *contract* is no longer "the adapter reads our file" — it is "the adapter offers a supported credential API, and still consumes a legacy file when it finds one".

- [ ] **Step 1: Write the failing cases**

```ts
// tests/mcp-adapter-authformat.test.ts (add)
const ADAPTER = join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter");

it("exposes the pi-mcp-adapter/oauth subpath main depends on", () => {
  const pkg = JSON.parse(readFileSync(join(ADAPTER, "package.json"), "utf-8"));
  // An exports map gates BARE specifiers. Losing "./oauth" would break main's
  // sidecar at import; losing it silently is what this case exists to prevent.
  expect(pkg.exports?.["./oauth"]).toBeDefined();
});

it("the subpath exports the three functions the sidecar calls", async () => {
  const oauth = await import(join(ADAPTER, "oauth.ts"));
  for (const fn of ["inspectMcpOAuthTokensForUrl", "updateMcpOAuthTokensForUrl", "getMcpOAuthTokensForUrl"]) {
    expect(typeof oauth[fn]).toBe("function");
  }
});

it("mcp-auth.ts still offers the two functions the subpath does not cover", async () => {
  // Reached by RELATIVE path on purpose: the exports map lists neither, and an
  // exports map gates bare specifiers only. Same escape as the two pi-subagents
  // internals CLAUDE.md pins. If the subpath ever grows these, delete this case
  // and move the sidecar onto it.
  const auth = await import(join(ADAPTER, "mcp-auth.ts"));
  expect(typeof auth.updateClientInfo).toBe("function");
  expect(typeof auth.removeAuthEntry).toBe("function");
});

it("binds a stored credential to its server URL", async () => {
  const { updateMcpOAuthTokensForUrl, inspectMcpOAuthTokensForUrl } = await import(join(ADAPTER, "oauth.ts"));
  const url = "https://mcp.example.com/mcp";
  updateMcpOAuthTokensForUrl("hv-contract-fixture", url, { accessToken: "tok-xyz" });
  expect(inspectMcpOAuthTokensForUrl("hv-contract-fixture", url)).toMatchObject({
    status: "present", tokens: { accessToken: "tok-xyz" },
  });
  // The URL binding is what main's status answer rests on.
  expect(inspectMcpOAuthTokensForUrl("hv-contract-fixture", "https://other.example.com/mcp").status)
    .not.toBe("present");
});

it("consumes a legacy plaintext file on a migrating read", async () => {
  // THIS is now the actual contract with the adapter, and exactly what a future
  // pin bump could change again. It is also the reverse-drift canary: a version
  // that went back to files would leave main writing to a store nobody reads.
  const { getAuthEntry, getAuthEntryFilePath } = await import(join(ADAPTER, "mcp-auth.ts"));
  process.env.PI_CODING_AGENT_DIR = tmp;
  writeLegacyEntry(tmp, "hv-legacy-fixture", { tokens: { accessToken: "legacy-tok" }, serverUrl: "https://mcp.example.com/mcp" });
  expect(getAuthEntry("hv-legacy-fixture")?.tokens?.accessToken).toBe("legacy-tok");
  expect(existsSync(getAuthEntryFilePath("hv-legacy-fixture"))).toBe(false);
});
```

`writeLegacyEntry` is a three-line local helper (mkdir `mcp-oauth/sha256-<sha256hex(name)>`, write `tokens.json`) — `mcpAuthStore.writeAuthEntry` no longer exists after Task 4, and the test must not depend on main's code to describe the adapter's legacy format anyway.

- [ ] **Step 2: Run to verify they fail, then pass**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-adapter-authformat.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

The first run should fail only on cases whose helper is missing; once `writeLegacyEntry` exists and the adapter is at 2.25.0, all cases pass. If `exports?.["./oauth"]` is undefined, Task 2 did not land.

- [ ] **Step 3: Delete the case that no longer describes reality**

The original `getAuthForUrl reads back an AuthEntry written by the store` case imports `writeAuthEntry` from `mcpAuthStore`, which Task 4 removed. Replace its body with `writeLegacyEntry` — the assertion (adapter reads the on-disk shape) is still worth pinning, it just must not claim main writes that shape any more. Update the file header comment accordingly.

- [ ] **Step 4: Commit**

```bash
git add tests/mcp-adapter-authformat.test.ts
git commit -m "test(mcp): the gate pins the adapter's credential API, not our file

The contract moved: the adapter offers pi-mcp-adapter/oauth and still
consumes a legacy plaintext file when it finds one. Both are pinned, in
both directions — a version that dropped the subpath, or went back to
files, would leave main talking to a store nobody writes, which is this
bug with the arrows swapped."
```

---

## Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (§MCP management bullet)
- Modify: `docs/validation/m1.md`

`docs/prd.md` §13 and the Notion PRD are already folded (2026-08-14) — do not re-edit them.

- [ ] **Step 1: Fix the false sentence in CLAUDE.md**

The §MCP bullet currently reads:

> Main and adapter share only the on-disk token store `<agentDir>/mcp-oauth/sha256-<sha256hex(serverName)>/tokens.json` (AuthEntry).

Replace with a bullet that carries the trap, not just the correction — something a future session can act on:

```
- **MCP credentials live in the OS KEYCHAIN, not in our file — main reaches them through a
  sidecar, never by mirroring.** From pi-mcp-adapter 2.17.0 the store is the OS keychain
  (service `pi-mcp-adapter.oauth`, account `sha256-<hex>`, payload chunked at 1000 chars behind
  a private manifest key) and `<agentDir>/mcp-oauth/…/tokens.json` is a **legacy artefact the
  adapter imports and DELETES on first read**. There is no opt-out. Mirroring that format broke
  three ways at once and none of them were loud: the status badge claimed `needs-auth` about a
  server the session was using, re-authenticating wrote a file the adapter deleted unread, and
  **Log out left the keychain credential alive so the session stayed signed in**. Main now runs
  the adapter's own code in a one-shot sidecar (`pi-runtime/bin/mcp-oauth-bridge.mjs`, spawned
  via `nodeExecPath()`): `pi-mcp-adapter/oauth` for token read/write, and `mcp-auth.ts` by
  RELATIVE path for `updateClientInfo`/`removeAuthEntry` which that subpath does not cover —
  same exports-map escape as the two pi-subagents internals above. `src/main/mcpAuthStore.ts`
  keeps PKCE + CSRF state ONLY; nothing credential-shaped stays on disk, which is what leaves
  the adapter's legacy-import path nothing to consume. Ops batch per invocation so the startup
  sweep costs one spawn. `tests/mcp-adapter-authformat.test.ts` gates the pin bump in both
  directions and MUST set `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` — the keychain is global to
  the OS user and `PI_CODING_AGENT_DIR` does not scope it, so an unforced test reads whatever
  the developer last signed into and writes fixtures into their login keychain.
```

- [ ] **Step 2: Add the measured facts to `docs/validation/m1.md`**

New section `## Phase 3: credentials moved to the OS keychain (2026-08-14)`, recording: the measured keychain service/account, that `<agentDir>/mcp-oauth` is absent on a real install, the three broken directions with the code paths, the sidecar request/response shape (so `d1.md`-style wire documentation exists for it), Task 1's `SIDECAR_MODE` answer, and the peer-dependency chain that forced the Pi bump. Paste Task 0's "before" and Task 8's "after" tables.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/validation/m1.md
git commit -m "docs(mcp): the shared token file is gone, and Log out was the worst of it"
```

---

## Task 8 status (2026-08-14)

**Verified.** Gate green — 161 files, 1600 tests. Live-Pi batch green — 15 files, 27 tests, at the
shipped pin set. Boot raises **no** keychain access (measured: zero sidecar spawns at launch).
The agent path works: a real MCP call through a Pi child completes in ~1 s once granted.

**Three bugs the 1600-test suite could not have caught, all found by running the real app** — the
reason this task exists rather than trusting the suite: the sidecar hung forever under the Electron
helper (`readFileSync(0)`; tests spawned plain `node`, so they passed while the app timed out on
every spawn), a 10 s deadline killed the child mid-prompt so the next call re-prompted, and a failed
prefetch fanned out to four concurrent spawns and four stacked dialogs. A test now spawns the
sidecar through the real Electron binary so the first class cannot recur.

**Outstanding, and why.** The steps below that exercise **Log out → re-auth** go through main's
sidecar, which in dev runs as the ad-hoc-signed Electron helper and therefore raises a keychain
dialog on *every* access (see m1.md). Each assertion would cost a password prompt, which is not a
sensible way to verify and not representative of a signed build. They are deferred to the first
signed build, where the same run also answers the open question — whether one grant is enough.
Everything they cover is unit-tested (`mcp-authstore`, `mcp-oauth`, `mcp-adapter-store`,
`mcp-adapter-authformat`); what is missing is the end-to-end observation, not the logic.

---

## Task 8: Verification — what must be TRUE on screen

`npm run gate` and `npm run test:live` are necessary and not sufficient: every defect this branch fixes is invisible to the suite, because the suite has no keychain and no running agent. These are the observable claims. Each names the surface it is observed on, because **the surface that owns the credential (a chat session) is not the surface that changes it (the MCP page)** — that split is the entire bug.

- [ ] **Step 1: Automated gate**

```bash
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -40 $L
npm run live:why    # prints — pi-runtime/ changed
```

Then, backgrounded, and without editing the tree while it runs:

```bash
L=/tmp/live.log
npm run test:live > $L 2>&1; echo "EXIT=$?"
tail -60 $L
```

- [ ] **Step 2: Observable claims — MCP page (Settings → MCP)**

| # | Claim | Before (Task 0) |
|---|---|---|
| 1 | On a cold start, **`notion` shows `connected` with a non-zero tool count** — the same server whose credential exists only in the keychain. | `needs-auth (0 tools)` |
| 2 | Clicking the tool count on that row reveals the tool list (§13 round 11 behaviour is untouched). | n/a |
| 3 | With the keychain locked (`security lock-keychain`), the row shows **`failed` with the store's own message** — never `needs-auth`. | n/a |

- [ ] **Step 3: Absence assertions — the filesystem, named**

An absence cannot be screenshotted, so these are checked by command, after a successful **Authenticate** on `notion`:

```bash
D="$HOME/Library/Application Support/HappyVibe/pi-agent/mcp-oauth"
find "$D" -name tokens.json 2>/dev/null   # must print NOTHING
grep -rl 'accessToken\|refreshToken\|clientSecret' "$D" 2>/dev/null  # must print NOTHING
```

Named absences: **`tokens.json` is absent for every server**, and the strings **`accessToken`, `refreshToken` and `clientSecret` appear nowhere** under `mcp-oauth/`. A `flow.json`-shaped file containing only `codeVerifier` / `oauthState` may exist mid-flow and must be gone after the flow completes.

- [ ] **Step 4: Observable claims — a chat session, not the MCP page**

| # | Sequence | Claim |
|---|---|---|
| 4 | With `notion` `connected`, ask a session to call a Notion MCP tool. | The call **succeeds**. |
| 5 | Click **Log out** on the MCP page. The row goes `needs-auth`. Return to the **same session** and ask for the same call. | The call **fails with an auth error**. Before this branch it succeeded — that is the defect. |
| 6 | Click **Authenticate**, complete the browser flow. Return to the **same session** (no app restart) and ask again. | The call **succeeds**. `scheduleMcpReload` respawns the session resumed; the transcript shows the existing "session reloading" notice and the conversation is intact. |

- [ ] **Step 5: The regressions this design risks, as sequences someone can perform**

| # | Sequence | Must be true |
|---|---|---|
| 7 | Configure five http servers. Restart the app and watch the boot sweep (`ps` for `mcp-oauth-bridge`, or the `mcp.startup_check` log line). | **One** sidecar spawn for the whole sweep, not five. The badge for all five still resolves. |
| 8 | Open two workspaces, start a session in each, then **Log out** of a **global** server from the MCP page. | **Both** sessions reload and both fail that server's next call. A workspace-tier change must still reload only its own workspace's sessions (`mcpReloadScope.ts`). |
| 9 | Start a long turn in session A. While it is mid-turn, **Log out** of a server from the MCP page. | Session A is **not interrupted** — the reload defers via `pendingMcpReload` and drains on `agent_end`. Its next call *after* the turn fails. |
| 10 | Log out of a server, then **Authenticate** again on a fresh loopback port (the port is OS-assigned per flow). | Auth **succeeds** — the stale-DCR-client guard survived the move to the adapter store. A "Client ID mismatch" or "Invalid redirect_uri" here means the `redirectUris` check in `clientInformation()` was lost. |
| 11 | Kill the sidecar mid-sweep (or point `runtimeDir` at a missing script). | The badge reads `failed` with a message, the app does **not** hang, and no server reads `connected` or `needs-auth` on no evidence. |

- [ ] **Step 6: Fill in the "after" column and commit**

Paste both tables into `docs/validation/m1.md` §Phase 3 and commit. A claim that could not be checked is recorded as unchecked, not omitted.

---

## Self-Review

**Spec coverage.** Every element of the Notion doc's decision maps to a task: keychain finding → Tasks 0/7; three broken directions → Tasks 4 (write, logout) and 5 (read); `pi-mcp-adapter/oauth` → Task 3; sidecar route → Tasks 1/3; pin-bump chain and its caveat page → Task 2; contract test incl. reverse drift → Task 6; the `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` rule → Global Constraints and Task 6; verification incl. before/after → Tasks 0 and 8.

**Two gaps found and closed while writing.** (1) The `/oauth` subpath covers token read/write only — `updateClientInfo` and `removeAuthEntry` are not on it, so logout and refresh-capable persistence need the relative-path route; that is now stated in Task 3's interface block, implemented in the sidecar, and pinned in Task 6. (2) Task 1's spike exists because the adapter ships `.ts` and a bare Node child has no TypeScript loader — a plan that assumed `import "pi-mcp-adapter/oauth"` just works could fail at the first run with nothing to fall back to.

**Type consistency.** `AdapterEntry` / `AdapterStoredTokens` / `AdapterStoredClientInfo` / `AdapterStore` are defined once in Task 3 and used under those exact names in Tasks 4 and 5. `FlowState`, `readFlowState`, `writeFlowState`, `clearFlowState` are defined in Task 4 and used only there and in Task 8's absence check. `MCP_OAUTH_BRIDGE_RELPATH` matches the file created in Task 3.

**Ordering.** Task 1 (spike) needs only an npm-staged copy, so it runs before the repo changes. Task 2 must precede Tasks 3–6 — the `/oauth` subpath does not exist at 2.17.0. Task 0 must run **before** Task 2, on the current build, or the "before" column cannot be measured.
