# Support More Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-curated 5-provider BYOK list with a catalog generated from Pi's own registry (featured five + search), add OpenRouter/xAI OAuth and LM Studio/llama.cpp auto-detect, probe keys at save, and kill the silent `deepseek/deepseek-v4-flash` spawn fallback.

**Architecture:** A build-time generator (the `catalog:plugins` pattern) derives `src/main/providerCatalog.generated.ts` from `pi-ai`'s `envMap` + `models.generated.js`; `providers.ts` constants become views over it. OAuth rides the existing `/hv-login` utility path; local detect generalises `detectOllama`; the no-model case is refused in `ipc.ts`/`composer.ts` (the two mirrors) instead of defaulted in `spawn.ts`.

**Tech Stack:** Existing — TypeScript, Electron main + React renderer, vitest (renderer suite has NO DOM: exported data + source scans only).

**Spec:** Notion "🔌 Support more provider" (3cbd33dfffca80839b41f9f7764db2ab, rewritten 2026-08-29) + PRD Decision (2026-08-29) in `docs/prd.md` (after the 2026-07-30 custom-endpoints decision) and the §19 billing addendum.

## Global Constraints

- The non-live-suite guarantee survives: `npm test` neutralises `sk-REPLACE` keys for EVERY provider env var, not just the original five (`tests/providers.test.ts`).
- Renderer suite has no DOM — pin UI contracts as exported data plus source scans (the `tests/modal-layer.test.ts` pattern).
- `resolveModel` is mirrored in `ipc.ts` `spawnOpts` and renderer `composer.ts` — change both or neither.
- Never run `npm run lint`/`format`. Gate = `npm run gate`; live batch only when `npm run live:why` prints something, checked AFTER the commit that carries the change (it diffs `main...HEAD`).
- `happyvibe-bridge.ts` is outside both typecheck lists — this plan does not touch it, keep it that way.
- The five featured providers stay byte-identical in behavior: deepseek, anthropic, openai, google (env `GEMINI_API_KEY`), openrouter.
- Excluded from the catalog, by name: OAuth-only ids, `radius`, `amazon-bedrock`, `google-vertex`, `azure-openai`, `cloudflare` (multi-field, PRD-deferred), and local/`ollama`-class ids.

---

### Task 0: Prerequisites + registry shape verification

The worktree is fresh: `pi-runtime/node_modules` is not installed, and every fact the generator needs lives there. Nothing else in this plan starts until the shapes below are confirmed.

**Files:**
- None created — this task produces verified facts recorded in the plan-executor's notes.

**Interfaces:**
- Produces: confirmed paths + export names for `envMap` and the models registry; the exact Pi `/login` provider ids for OpenRouter and xAI; whether pi-ai's registry carries a `baseUrl` per provider.

- [ ] **Step 1: Install both trees**

```bash
npm install && (cd pi-runtime && npm ci)
```

- [ ] **Step 2: Verify the pi-ai registry shapes**

```bash
node -e "
const em = require('./pi-runtime/node_modules/pi-ai/dist/env-api-keys.js');
console.log('envMap keys:', Object.keys(em.envMap ?? em.default ?? em).length);
const mg = require('./pi-runtime/node_modules/pi-ai/dist/models.generated.js');
const k = Object.keys(mg).slice(0, 3);
console.log('models.generated top-level:', k);
"
```

Expected: ~30+ envMap entries; models registry keyed by provider id. If the actual export names differ, record the real ones — Task 1's generator uses them.
Check specifically: does each provider record carry a `baseUrl` (needed for Task 4's probe)? If not, find where pi-ai stores per-provider base URLs (grep `dist/` for `api.groq.com`) and record the source. If no base URL is derivable for a provider, the catalog stores `baseUrl: null` and Task 4 falls back to "couldn't verify".

- [ ] **Step 3: Verify Pi's OAuth login ids for OpenRouter and xAI**

```bash
grep -rn "openrouter\|xai" pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/ --include="*.js" -l | head
```

Find the auth-provider registry Pi's `/login` consults; record the EXACT ids (e.g. `openrouter`, `xai`) — Task 3 passes them to `/hv-login <id>` verbatim. If either id does not exist in the vendored 0.83, STOP and report — the spec assumed both (audit listed them under Pi's `/login` six).

- [ ] **Step 4: Baseline gate**

```bash
npm test
```

Expected: green (~25–40 s, 15 skipped).

---

### Task 1: Generated provider catalog + contract test

**Files:**
- Create: `tools/provider-catalog/build.ts`
- Create: `src/main/providerCatalog.generated.ts` (generated output, committed)
- Modify: `package.json` (add `"catalog:providers"` script beside `catalog:plugins`)
- Test: `tests/provider-catalog.test.ts` (key-free — joins the pin-bump gate)

**Interfaces:**
- Produces:
```ts
// src/main/providerCatalog.generated.ts
export interface CatalogProvider {
  id: string;        // pi-ai provider id, e.g. "groq", "zai-coding-cn"
  label: string;     // prettified, e.g. "Groq", "Z.AI (China)"
  envVar: string;    // e.g. "GROQ_API_KEY"
  baseUrl: string | null; // for the save-time key probe; null ⇒ probe skipped
  modelCount: number;
}
export const PROVIDER_CATALOG: readonly CatalogProvider[];
export const FEATURED_PROVIDER_IDS: readonly ["deepseek", "anthropic", "openai", "google", "openrouter"];
```

- [ ] **Step 1: Write the failing contract test**

```ts
// tests/provider-catalog.test.ts
import { describe, expect, test } from "vitest";
import { PROVIDER_CATALOG, FEATURED_PROVIDER_IDS } from "../src/main/providerCatalog.generated";

// Re-derive from the vendored registry — same discipline as tests/plugin-catalog.test.ts.
const { envMap } = require("../pi-runtime/node_modules/pi-ai/dist/env-api-keys.js");

const EXCLUDED = ["radius", "amazon-bedrock", "google-vertex", "azure-openai", "cloudflare", "ollama"];

describe("generated provider catalog (pin-bump gate)", () => {
  test("every catalog entry's env var matches pi-ai's envMap", () => {
    for (const p of PROVIDER_CATALOG) expect(envMap[p.id]).toBe(p.envVar);
  });
  test("every single-env-var pi-ai provider is in the catalog or named excluded", () => {
    const ids = new Set(PROVIDER_CATALOG.map((p) => p.id));
    for (const id of Object.keys(envMap)) {
      if (EXCLUDED.some((e) => id.includes(e))) continue;
      expect(ids.has(id), `pi-ai provider "${id}" is neither cataloged nor excluded — pin bump drift`).toBe(true);
    }
  });
  test("the featured five exist and keep their env vars", () => {
    const by = Object.fromEntries(PROVIDER_CATALOG.map((p) => [p.id, p]));
    expect(FEATURED_PROVIDER_IDS).toEqual(["deepseek", "anthropic", "openai", "google", "openrouter"]);
    expect(by.google.envVar).toBe("GEMINI_API_KEY");
    for (const id of FEATURED_PROVIDER_IDS) expect(by[id]).toBeDefined();
  });
  test("excluded providers are absent", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    for (const e of EXCLUDED) expect(ids.filter((i) => i.includes(e))).toEqual([]);
  });
});
```

Adjust the `envMap` access to the export shape Task 0 recorded. If envMap keys are provider ids → env var names in a different structure, mirror the real one.

- [ ] **Step 2: Run it — expected FAIL** (`providerCatalog.generated` does not exist)

```bash
L=/tmp/vitest.log; npx vitest run tests/provider-catalog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 3: Write the generator**

`tools/provider-catalog/build.ts`, mirroring `tools/plugin-catalog/build.ts`'s structure (header comment "GENERATED — run npm run catalog:providers", run summary to stdout). Logic:

```ts
// Reads pi-ai's envMap + models.generated.js from pi-runtime/node_modules.
// Excludes (with a printed histogram, the plugin-catalog pattern):
//   - ids with no envMap entry (OAuth-only / ambient providers)
//   - EXCLUDED list (radius, multi-field cloud, ollama-class) — keep in ONE
//     exported const the test can import if drift appears
// Label prettification: title-case the id; regional suffixes map to
//   " (China)" / " (Amsterdam)" / " (Singapore)" for -cn/-ams/-sgp.
// baseUrl: from the registry source Task 0 identified, else null.
// modelCount: Object.keys(models.generated[id].models ?? {}).length (adjust
//   to the real shape).
// Output: src/main/providerCatalog.generated.ts, deterministic order (sort by id).
```

Add to `package.json` scripts: `"catalog:providers": "node --experimental-strip-types --import jiti/register tools/provider-catalog/build.ts"` (copy `catalog:plugins`' invocation verbatim — same loader).

- [ ] **Step 4: Generate and run the test — expected PASS**

```bash
npm run catalog:providers
L=/tmp/vitest.log; npx vitest run tests/provider-catalog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -10 $L
```

Read the generator's run summary: the exclusion histogram is where surprises show (an id excluded for a reason you didn't intend).

- [ ] **Step 5: Commit**

```bash
git add tools/provider-catalog/ src/main/providerCatalog.generated.ts tests/provider-catalog.test.ts package.json
git commit -m "feat(providers): generate the BYOK catalog from pi-ai's own registry"
```

---

### Task 2: providers.ts widens to the catalog (env, keySource, config, IPC)

**Files:**
- Modify: `src/main/providers.ts:10-59` (`BYOK_PROVIDERS` derived from catalog; `buildProviderEnv`/`keySource` iterate it)
- Modify: `src/main/config.ts:19,116-136` (`keys` typing widens from `Partial<Record<ByokProvider,…>>` to `Record<string,string>`; `setProviderKey(provider: string, …)`)
- Modify: `src/main/ipc.ts:2646` (byok status maps the catalog; featured flag included)
- Test: `tests/providers.test.ts` (extend, keep every existing assertion)

**Interfaces:**
- Consumes: `PROVIDER_CATALOG`, `FEATURED_PROVIDER_IDS` (Task 1).
- Produces:
```ts
// providers.ts — same names, wider domain:
export const BYOK_PROVIDERS: Record<string, { label: string; envVar: string }>; // built from PROVIDER_CATALOG
export type ByokProvider = string; // was a literal union; callers keep compiling
export const BYOK_PROVIDER_IDS: string[];
// buildProviderEnv / keySource signatures unchanged (they already take Partial records)
```
- The IPC `hv:get-providers` byok payload gains `featured: boolean` and `modelCount: number` per entry (renderer Task 5 consumes both).

- [ ] **Step 1: Write the failing tests** (append to `tests/providers.test.ts`)

```ts
import { PROVIDER_CATALOG } from "../src/main/providerCatalog.generated";

describe("catalog-wide provider env", () => {
  test("a cataloged non-featured provider's key is injected", () => {
    const groq = PROVIDER_CATALOG.find((p) => p.id === "groq")!;
    const out = buildProviderEnv({ groq: "gsk_real" }, {});
    expect(out[groq.envVar]).toBe("gsk_real");
  });
  test("sk-REPLACE neutralisation applies to EVERY catalog env var", () => {
    // The non-live-suite guarantee: a neutralised env value is ABSENT, not passed through.
    for (const p of PROVIDER_CATALOG) {
      const out = buildProviderEnv({}, { [p.envVar]: "sk-REPLACE-me" });
      expect(out[p.envVar], p.id).toBeUndefined();
    }
  });
  test("keySource reads env over stored for any catalog id", () => {
    const groq = PROVIDER_CATALOG.find((p) => p.id === "groq")!;
    expect(keySource("groq", { groq: "stored" }, { [groq.envVar]: "gsk_env" })).toBe("env");
  });
});
```

- [ ] **Step 2: Run — expected FAIL** ("groq" not in `BYOK_PROVIDERS`)

- [ ] **Step 3: Implement**

`providers.ts`: build `BYOK_PROVIDERS` from `PROVIDER_CATALOG` (`Object.fromEntries(PROVIDER_CATALOG.map(p => [p.id, { label: p.label, envVar: p.envVar }]))`); `ByokProvider` becomes `string`; delete the hand-written five (the catalog carries them — the featured five test in Task 1 pins their env vars). Keep the `sk-REPLACE` prefix check in both `buildProviderEnv` and `keySource` exactly as-is. `config.ts`: widen the `keys` field type and `setProviderKey`'s parameter to `string`; the safeStorage encrypt/decrypt path is id-agnostic already. `ipc.ts:2646`: map `PROVIDER_CATALOG` instead of `BYOK_PROVIDERS`, adding `featured: FEATURED_PROVIDER_IDS.includes(p.id)` and `modelCount: p.modelCount` to each status row. Update the renderer preload/type (`HvByokProvider`) with the two new fields.

- [ ] **Step 4: Full non-live suite — expected PASS, still ~25–40 s**

```bash
L=/tmp/vitest.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -15 $L
```

The runtime staying ~25–40 s IS an assertion: if it balloons toward minutes, a live file stopped skipping — stop and find which env var leaked.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers.ts src/main/config.ts src/main/ipc.ts src/preload tests/providers.test.ts
git commit -m "feat(providers): BYOK constants become views over the generated catalog"
```

---

### Task 3: OAuth — dedupe the list, add OpenRouter (PKCE) and xAI, teach billing

**Files:**
- Modify: `src/main/providers.ts:25-29` (single-source `OAUTH_PROVIDERS`, gains `caveat?`; add `openrouter`, `xai` with the ids Task 0 confirmed)
- Modify: `src/renderer/src/components/ModelsView.tsx:16-25` (DELETE the local copy; import from a shared module — `providers.ts` is main-side but electron-free, so the renderer imports the constant the way `composer.ts` shares types; if the bundler balks, move `OAUTH_PROVIDERS` to a tiny `src/shared/` module imported by both)
- Modify: `src/main/calls.ts:63-80` (`planProvidersFor` learns xai key-presence)
- Test: `tests/calls.test.ts` (extend `planProvidersFor` describe), `tests/providers.test.ts` (OAUTH list pinned once)

**Interfaces:**
- Consumes: exact Pi login ids from Task 0.
- Produces: `OAUTH_PROVIDERS` (5 entries) as the ONE list; `planProvidersFor(keyStatus)` adds `"xai"` when `!keyStatus?.xai`, never adds `"openrouter"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/calls.test.ts — inside describe("planProvidersFor")
test("xai is plan-billed exactly when no XAI key is configured", () => {
  expect(planProvidersFor({ anthropic: true }).has("xai")).toBe(true);
  expect(planProvidersFor({ anthropic: true, xai: true }).has("xai")).toBe(false);
});
test("openrouter OAuth mints a METERED key — never plan", () => {
  expect(planProvidersFor({}).has("openrouter")).toBe(false);
});
```

```ts
// tests/providers.test.ts
test("OAUTH_PROVIDERS is the single source and carries all five", () => {
  expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(
    ["anthropic", "github-copilot", "openai-codex", "openrouter", "xai"]); // ids from Task 0
});
```

Plus a source scan (the modal-layer pattern) asserting `ModelsView.tsx` no longer declares its own `OAUTH_PROVIDERS =` literal:

```ts
test("ModelsView imports OAUTH_PROVIDERS instead of redeclaring it", () => {
  const src = fs.readFileSync("src/renderer/src/components/ModelsView.tsx", "utf8");
  expect(src).not.toMatch(/const OAUTH_PROVIDERS\s*[:=]/);
});
```

- [ ] **Step 2: Run — expected FAIL** (xai not in set; ModelsView still declares the list)

- [ ] **Step 3: Implement**

`providers.ts`: move the Claude `caveat` string into the shared entry (ModelsView's copy carries it today). Add `{ id: "openrouter", label: "OpenRouter" }` and `{ id: "xai", label: "xAI (Grok)" }` with Task 0's ids. `calls.ts:77-79`: after the anthropic line, `if (!keyStatus?.xai) s.add("xai");`. `ModelsView.tsx`: delete the local const, import the shared one — everything downstream (`oauthCard`, `signedIn`) keys off `id` and keeps working.

- [ ] **Step 4: Run tests — expected PASS.** Also `npm run build` (this touched the renderer import graph; build runs both typechecks).

- [ ] **Step 5: Commit, then check the live trigger**

```bash
git add src/main/providers.ts src/main/calls.ts src/renderer/src/components/ModelsView.tsx tests/
git commit -m "feat(oauth): OpenRouter (PKCE) and xAI sign-in; xai joins the plan-billing resolution"
npm run live:why
```

If `live:why` prints anything, run the live batch backgrounded per CLAUDE.md and only alongside non-tree work.

---

### Task 4: Key probe at save

**Files:**
- Modify: `src/main/providers.ts` (new `probeProviderKey`)
- Modify: `src/main/ipc.ts:2654-2660` (`hv:set-provider-key` returns the probe verdict)
- Modify: `src/renderer/src/components/ModelsView.tsx:181` (render the verdict inline)
- Test: `tests/providers.test.ts`

**Interfaces:**
- Produces:
```ts
export type KeyProbe = { status: "ok" } | { status: "unverified" } | { status: "bad"; error: string };
export async function probeProviderKey(id: string, key: string): Promise<KeyProbe>;
```
- `hv:set-provider-key` return type changes from `void` to `KeyProbe` — the key is SAVED either way (probe informs, never blocks; "bad" renders as an inline warning with the key kept, so a provider whose /models rejects listing doesn't lock the user out).

- [ ] **Step 1: Write the failing tests** (inject fetch, the `detectOllama` test pattern)

```ts
describe("probeProviderKey", () => {
  test("200 from /models ⇒ ok", async () => { /* stub fetch → {ok:true, json:[]} */ });
  test("401 ⇒ bad with the status in the error", async () => { /* stub → 401 */ });
  test("catalog entry with baseUrl:null ⇒ unverified, no fetch", async () => {});
  test("network error ⇒ unverified (a down host is not a bad key)", async () => {});
});
```

- [ ] **Step 2: Run — expected FAIL**

- [ ] **Step 3: Implement**

`probeProviderKey` looks the id up in `PROVIDER_CATALOG`; `baseUrl === null` → `unverified`. Otherwise reuse the `fetchEndpointModels` shape: `GET {baseUrl}/models`, `Authorization: Bearer <key>`, 4 s timeout. HTTP 401/403 → `bad`; other non-OK or thrown → `unverified` (only an explicit auth rejection condemns a key). `ipc.ts`: `hv:set-provider-key` saves first, then probes, returns the verdict. `ModelsView.tsx`: render `bad` as the existing inline error style ("Key rejected by Groq (HTTP 401) — saved anyway"), `unverified` as a muted "couldn't verify" note, `ok` silently.

- [ ] **Step 4: Run tests — expected PASS**

- [ ] **Step 5: Commit**

```bash
git add src/main/providers.ts src/main/ipc.ts src/renderer/src/components/ModelsView.tsx src/preload tests/providers.test.ts
git commit -m "feat(providers): probe a key at save — auth errors surface at entry, not first turn"
```

---

### Task 5: ModelsView — featured five + "More providers…" search

**Files:**
- Modify: `src/renderer/src/components/ModelsView.tsx` (Cloud API keys section: featured cards from `featured: true` rows; below them a search input over the rest; picking a row expands the SAME key-input component the featured cards use)
- Test: `tests/models-view.test.ts` (new, data + source scan — NO DOM)

**Interfaces:**
- Consumes: `HvByokProvider` rows with `featured`/`modelCount` (Task 2), probe verdicts (Task 4).
- Produces: exported `filterCatalog(rows, query)` helper (pure, testable) — case-insensitive match over `label` + `id`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/models-view.test.ts
import { filterCatalog } from "../src/renderer/src/components/ModelsView";
const rows = [
  { id: "groq", label: "Groq", featured: false }, { id: "zai-coding-cn", label: "Z.AI (China)", featured: false },
  { id: "deepseek", label: "DeepSeek", featured: true },
] as never[];
test("search matches label and id, never lists featured rows", () => {
  expect(filterCatalog(rows, "gro").map((r) => r.id)).toEqual(["groq"]);
  expect(filterCatalog(rows, "china").map((r) => r.id)).toEqual(["zai-coding-cn"]);
  expect(filterCatalog(rows, "deep")).toEqual([]); // featured cards already render above
});
test("empty query lists nothing (the long tail stays behind the search)", () => {
  expect(filterCatalog(rows, "")).toEqual([]);
});
```

Source-scan absences: no `RegionPicker`/`region` control in `ModelsView.tsx`; no "Recommended" section in `ModelSelect.tsx`.

- [ ] **Step 2: Run — expected FAIL** (no export)

- [ ] **Step 3: Implement**

Featured rows render exactly the current `byok.map` card (line 344 area) filtered to `featured`. Below: an input ("More providers…"), `filterCatalog` results as compact rows (label + `N models` chip), clicking one expands the same key-input/save/remove block the featured cards use — extract that block into one local component if it isn't already, so it is literally one component, N providers. A non-featured provider with a stored/env key renders as a card above the search (it's now "configured", not long-tail).

- [ ] **Step 4: Run tests + `npm run build` — expected PASS**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ModelsView.tsx tests/models-view.test.ts
git commit -m "feat(models-page): featured five + searchable generated catalog"
```

---

### Task 6: Local auto-detect — LM Studio and llama.cpp

**Files:**
- Modify: `src/main/providers.ts:61-143` (generalise detection; `syncModelsJson` folds detected locals in)
- Test: `tests/providers.test.ts`

**Interfaces:**
- Produces:
```ts
export const LOCAL_RUNNERS = [
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", preset: "lmstudio" },
  { id: "llamacpp", label: "llama.cpp", baseUrl: "http://localhost:8080/v1", preset: "llamacpp" },
] as const;
export async function detectLocalRunner(r): Promise<{ running: boolean; models: string[] }>; // GET {baseUrl}/models, 1200 ms timeout — parseOpenAiModelList
```
- `syncModelsJson(agentDir, custom)` now: detect Ollama (unchanged, `/api/tags`) + both runners (`/v1/models`), then merge `[...detectedEndpoints, ...custom]` — **skipping any detected runner whose `baseUrl` already appears in `custom`** (a hand-added LM Studio endpoint wins; no duplicate provider rows).

- [ ] **Step 1: Write the failing tests**

```ts
describe("local runner auto-detect", () => {
  test("LM Studio on 1234 becomes a models.json endpoint with the lmstudio preset", async () => { /* stub fetch */ });
  test("a hand-added custom endpoint on the same baseUrl suppresses the auto-detected one", async () => {});
  test("nothing running ⇒ no lmstudio/llamacpp entries in the merged file", async () => {});
});
```

Build the endpoint via the same shape as `ollamaEndpoint` (placeholder auth, ids from `LOCAL_RUNNERS`, `providerKey` via `providerKeyFor(id)` from `modelsJson.ts` — do NOT copy Ollama's bare historical key, that exception is documented as historical).

- [ ] **Step 2: Run — expected FAIL**

- [ ] **Step 3: Implement.** Note `detectOllama` stays as-is (different protocol); `detectLocalRunner` reuses `fetchEndpointModels` with a 1200 ms timeout to keep spawn latency bounded — three probes run in `Promise.all`.

- [ ] **Step 4: Run tests — expected PASS**

- [ ] **Step 5: Commit, then `npm run live:why`** (providers.ts feeds spawn — check the trigger after the commit).

```bash
git add src/main/providers.ts tests/providers.test.ts
git commit -m "feat(local): auto-detect LM Studio and llama.cpp beside Ollama"
```

---

### Task 7: Kill the no-model spawn fallback (§16 finding 7)

**Files:**
- Modify: `src/main/pi/spawn.ts:95-110` (`opts.model` nullable; when null, OMIT `--provider`/`--model` — delete the hardcoded default and its comment block)
- Modify: `src/main/ipc.ts` (chat-session spawn paths: `resolveSpawnModel(...) === null` ⇒ refuse with a typed error instead of spawning; the UTILITY client at `ipc.ts:762` keeps spawning flagless — first-run OAuth needs it alive before any provider exists)
- Modify: `src/renderer/src/composer.ts` + the composer component (mirror: `resolveModel` null ⇒ composer disabled with "No model configured — add a provider in Models", linking the Models page)
- Test: `tests/spawn.test.ts` or the existing spawn-shape test file (find with `grep -rl resolvePiSpawn tests/`), `tests/composer.test.ts` equivalent

**Interfaces:**
- Produces: `resolvePiSpawn(..., { model: null })` yields args WITHOUT `--provider`/`--model`; `hv:new-session`-class IPC returns `{ ok: false, reason: "no-model" }` (exact channel names: whatever the current create/open handlers are — grep `resolveSpawnModel` call sites, cover EVERY one except the utility client).

- [ ] **Step 1: Write the failing tests**

```ts
test("no resolved model ⇒ no --provider/--model flags and NO deepseek pin", () => {
  const s = resolvePiSpawn("/ws", "/sess", "/rt", { model: null });
  expect(s.args).not.toContain("--provider");
  expect(s.args.join(" ")).not.toContain("deepseek-v4-flash");
});
test("a resolved model still pins both flags", () => { /* existing behavior, keep */ });
```

Renderer mirror (pure): `resolveModel(session, workspace, null)` returning null is already testable — add the composer-state assertion for the disabled reason string, plus a source scan that the literal `deepseek-v4-flash` no longer appears anywhere in `src/` outside tests (`grep`-based, the modal-layer pattern) — that absence IS the finding-7 fix.

- [ ] **Step 2: Run — expected FAIL** (fallback still pins deepseek)

- [ ] **Step 3: Implement.** In `ipc.ts`, the refusal happens BEFORE `new PiClient(...)` in the chat-session path; the renderer notice rides the same channel session errors already use. Do NOT touch the utility-client call — verify by eye it passes `spawnOpts()` and now spawns flagless when nothing is configured.

- [ ] **Step 4: Run tests + `npm run gate` — expected PASS**

- [ ] **Step 5: Commit, then `npm run live:why`** — this touched `src/main/pi/`, so it WILL print; run the live batch (backgrounded, `--no-file-parallelism`, only alongside non-tree work). The one live behavior to watch: the utility client's `/hv-login` still completes from a flagless spawn (auth-bridge live file covers the login path).

```bash
git add src/main/pi/spawn.ts src/main/ipc.ts src/renderer/src/composer.ts tests/
git commit -m "fix(spawn): no configured model means a visible error, never a silent deepseek pin"
```

---

### Task 8: Full gate + GUI pass

- [ ] **Step 1: `npm run gate`** (build → both typechecks → non-live suite). Green or stop.
- [ ] **Step 2: `npm run live:why`** — if it prints (it will: spawn.ts, providers), run `npm run test:live` backgrounded; all green or re-run a lone failure in isolation before calling it a regression. Check provider balance before believing any failure (the 0.50 lesson).
- [ ] **Step 3: GUI pass** — `npm run dev` (RESTART the dev server; main changed), then verify the named assertions below with `/uicheck`, screenshots per claim.
- [ ] **Step 4: Update `docs/validation/d1.md`** only if any wire shape changed (the no-model refusal payload qualifies — record the `{ok:false, reason:"no-model"}` shape).

## GUI verification — observable assertions (not "a GUI pass")

**Models page:**
1. The five featured cards (DeepSeek, Anthropic, OpenAI, Google, OpenRouter) render exactly as before, with a "More providers…" search box below them.
2. Typing `groq` shows one row "Groq · 6 models"; clicking it expands the same key input + Save the featured cards use.
3. Saving a garbage Groq key (`gsk_nope`) shows an inline "key rejected" warning AND the key stays saved; a provider with `baseUrl: null` saves with a "couldn't verify" note.
4. **Absences (named):** `radius`, `bedrock`, `vertex`, `azure`, `cloudflare` each match **nothing** in the search; there is **no region-picker control** — "Z.AI" and "Z.AI (China)" are two plain rows; an empty search box lists **no** long-tail rows.
5. The sign-in group shows **five** cards: Claude (with the extra-usage caveat), GitHub Copilot, ChatGPT (Codex), OpenRouter, xAI.

**ModelSelect (chat chip + Settings — the surfaces that OWN model choice, not the page that changed):**
6. With LM Studio serving on `localhost:1234`, its models appear in the dropdown with zero setup; with nothing local running, **no** `lmstudio`/`llamacpp` entries appear. There is **no "Recommended" section** — search-only.

**Chat surface (owns the no-model outcome):**
7. With zero providers configured, creating a session shows "No model configured — add a provider in Models" in the composer area, disabled send; **no session runs on deepseek** (verify via the session's model chip AND the audit log showing no spawn).
8. **Regression sequence:** configure one provider → set it as global default → create a session and send one message → remove the provider key and any custom endpoints → reopen the session → the visible notice appears and the composer blocks; the session must NOT silently spawn on deepseek (the old fallback) nor crash.

**Session cost ledger (owns billing labels — PRD §19):**
9. A ledger row for provider `xai` with no `XAI_API_KEY` configured shows `plan` and stays out of the total; after saving an xAI key, new rows show dollars. OpenRouter rows show dollars regardless of how the key arrived (OAuth-minted is metered).

**Cross-check after everything:** `grep -rn "deepseek-v4-flash" src/` returns nothing (tests/ and docs may still reference it).

---

## Self-review notes

- Spec coverage: P1.1→Task 1, P1.2→Tasks 2/5, P1.3→Task 1 (labels only), P1.4→Task 4, P1.5→explicitly skipped (decision), P2.1/2.2→Task 3, P2.3→Task 6, finding 7→Task 7. Deferred/out items have no tasks by design.
- The `ByokProvider = string` widening is the one type ripple to watch; `npm run build` in Tasks 2/3/5 is the check.
- Task 0 can invalidate two assumptions (baseUrl availability; xai/openrouter login ids) — both have named STOP conditions rather than silent workarounds.
