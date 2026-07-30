# OpenAI-Compatible Custom Endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add any OpenAI-compatible server (vLLM, LM Studio, llama.cpp, hosted proxy) as a model provider, by generalising the `models.json` path HappyVibe already uses for Ollama.

**Architecture:** Pi already supports custom providers natively — a `models.json` entry with `baseUrl` / `api` / `compat` / `models[]` (`pi-runtime/node_modules/@earendil-works/pi-coding-agent/docs/models.md`). `mergeOllamaModelsJson` is that mechanism with the URL hardcoded. This plan extracts a pure `src/main/modelsJson.ts` that writes N endpoints, re-implements Ollama as one **preset** on it, persists endpoint config + safeStorage-encrypted keys in `config.ts`, injects the secrets as **env vars at spawn** (so `models.json` never holds a secret), and adds a fourth "Custom endpoint" group to Settings' LLM Setup.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), vitest, Tailwind. No new dependencies. **No Pi pin bump** — this uses documented pinned-Pi config only.

**Spec:** `docs/prd.md` §16, `Decision (2026-07-30) — OpenAI-compatible custom endpoints`.

## Global Constraints

- `src/main/modelsJson.ts` is a **pure module: no electron imports**, vitest-importable (same rule as `providers.ts`, `spawn.ts`). Electron-touching wrappers live in `config.ts` / `ipc.ts`.
- **`api` is `"openai-completions"` only.** Not the other three Pi API types.
- **Secrets never enter `models.json`.** The file gets `apiKey: "$HV_CUSTOM_<ID>_KEY"`; the real value is safeStorage-encrypted in `config.json` and injected as an env var at spawn.
- **Every user-supplied string written into `models.json` goes through `escapePiValue`.** Pi executes an `apiKey`/`headers` value starting with `!` as a shell command at request time and interpolates `$VAR`.
- **`contextWindow` is explicit for custom models** (Pi defaults to 128000 and §9's gauge reads it) but **omitted for Ollama** — do not change Ollama's emitted JSON shape.
- `resolveModel` is mirrored in `src/main/ipc.ts` (`spawnOpts`) and `src/renderer/src/composer.ts` — change both or neither (CLAUDE.md).
- Existing `tests/providers.test.ts` `mergeOllamaModelsJson` assertions must pass **unchanged** — they are the proof that Task 2's refactor is behaviour-preserving.
- Every fs write stays inside the app-owned agent dir.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/modelsJson.ts` **(new)** | Pure: `CustomEndpoint` types, preset `compat` tables, `envVarFor`, `escapePiValue`, `endpointEntry`, `mergeModelsJson`, `customEndpointEnv`, `resolveKnownProvider` |
| `src/main/providers.ts` | Keeps curated BYOK list + Ollama detection; `mergeOllamaModelsJson` becomes a thin wrapper over `mergeModelsJson` |
| `src/main/config.ts` | Electron wrapper: persist `customEndpoints` + safeStorage keys; extend `providerEnv()` |
| `src/main/ipc.ts` | `syncModelsJson` on spawn; 4 new IPC handlers; orphan-provider fallback in `spawnOpts` |
| `src/preload/index.ts` · `src/renderer/src/hv.d.ts` | Expose the 4 handlers |
| `src/renderer/src/components/SettingsView.tsx` | Fourth "Custom endpoint" group + add/edit form + model checklist |
| `src/renderer/src/composer.ts` | Mirror of the orphan-provider fallback |
| `tests/custom-endpoints.test.ts` **(new)** | Unit tests for the pure module |

---

### Task 1: Pure `modelsJson.ts` core

**Files:**
- Create: `src/main/modelsJson.ts`
- Create: `tests/custom-endpoints.test.ts`
- Modify: `tests/providers.test.ts:18-24` (rename one misleading test — see Step 6)

**Interfaces:**
- Consumes: nothing.
- Produces: `type EndpointPreset`, `interface CustomModel { id: string; contextWindow?: number }`, `interface CustomEndpoint { id, label, baseUrl, preset, auth, models }`, `PRESET_COMPAT`, `envVarFor(id: string): string`, `escapePiValue(v: string): string`, `endpointEntry(e: CustomEndpoint): Record<string, unknown>`, `mergeModelsJson(existingRaw: string | null, endpoints: CustomEndpoint[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/custom-endpoints.test.ts
import { describe, expect, test } from "vitest";
import {
  envVarFor, escapePiValue, endpointEntry, mergeModelsJson, PRESET_COMPAT,
  type CustomEndpoint,
} from "../src/main/modelsJson";

const vllm: CustomEndpoint = {
  id: "my-vllm", label: "My vLLM", baseUrl: "http://gpu.lan:8000/v1",
  preset: "vllm", auth: { kind: "env" },
  models: [{ id: "qwen2.5-coder-32b", contextWindow: 32768 }],
};

describe("escapePiValue — Pi executes '!' values and interpolates '$'", () => {
  test("a leading ! is neutralised with the $! escape", () => {
    expect(escapePiValue("!rm -rf ~")).toBe("$!rm -rf ~");
  });
  test("every $ is doubled so no env interpolation happens", () => {
    expect(escapePiValue("sk-a$B")).toBe("sk-a$$B");
  });
  test("both at once", () => {
    expect(escapePiValue("!a$b")).toBe("$!a$$b");
  });
  test("an ordinary key is untouched", () => {
    expect(escapePiValue("sk-abc123")).toBe("sk-abc123");
  });
});

describe("envVarFor", () => {
  test("slug becomes an upper-snake env var stem", () => {
    expect(envVarFor("my-vllm")).toBe("HV_CUSTOM_MY_VLLM_KEY");
    expect(envVarFor("lm.studio 1")).toBe("HV_CUSTOM_LM_STUDIO_1_KEY");
  });
});

describe("endpointEntry", () => {
  test("env-auth endpoints reference the env var, never the secret", () => {
    const e = endpointEntry(vllm);
    expect(e.apiKey).toBe("$HV_CUSTOM_MY_VLLM_KEY");
    expect(e.api).toBe("openai-completions");
    expect(e.baseUrl).toBe("http://gpu.lan:8000/v1");
    expect(e.compat).toEqual(PRESET_COMPAT.vllm);
    expect(e.models).toEqual([{ id: "qwen2.5-coder-32b", contextWindow: 32768 }]);
  });

  test("placeholder auth is escaped, not interpolated", () => {
    const e = endpointEntry({ ...vllm, auth: { kind: "placeholder", value: "!oops" } });
    expect(e.apiKey).toBe("$!oops");
  });

  test("contextWindow is omitted when unset (Ollama's shape must not change)", () => {
    const e = endpointEntry({ ...vllm, models: [{ id: "m" }] });
    expect(e.models).toEqual([{ id: "m" }]);
  });
});

describe("mergeModelsJson", () => {
  test("writes one provider entry per endpoint and records what it manages", () => {
    const out = JSON.parse(mergeModelsJson(null, [vllm]));
    expect(Object.keys(out.providers)).toEqual(["my-vllm"]);
    expect(out.hvManaged).toEqual(["my-vllm"]);
  });

  test("preserves foreign providers it did not write", () => {
    const existing = JSON.stringify({ providers: { handwritten: { baseUrl: "http://x/v1" } } });
    const out = JSON.parse(mergeModelsJson(existing, [vllm]));
    expect(out.providers.handwritten).toEqual({ baseUrl: "http://x/v1" });
    expect(out.providers["my-vllm"]).toBeDefined();
  });

  test("removes endpoints it previously managed but no longer has", () => {
    const first = mergeModelsJson(null, [vllm]);
    const out = JSON.parse(mergeModelsJson(first, []));
    expect(out.providers["my-vllm"]).toBeUndefined();
    expect(out.hvManaged).toEqual([]);
  });

  test("migrates a legacy pre-hvManaged ollama entry instead of orphaning it", () => {
    const legacy = JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1" } } });
    const out = JSON.parse(mergeModelsJson(legacy, []));
    expect(out.providers.ollama).toBeUndefined();
  });

  test("a corrupt file is rebuilt, not thrown on", () => {
    const out = JSON.parse(mergeModelsJson("{not json", [vllm]));
    expect(out.providers["my-vllm"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/modelsJson"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/modelsJson.ts
/**
 * Custom OpenAI-compatible endpoints → Pi models.json (PRD §16, Decision
 * 2026-07-30). PURE module — no electron imports, vitest-importable.
 *
 * Ollama is one preset on this path; it was the hardcoded original
 * (providers.ts mergeOllamaModelsJson).
 */

export type EndpointPreset = "ollama" | "vllm" | "lmstudio" | "llamacpp" | "other";

export interface CustomModel {
  id: string;
  /** Pi defaults to 128000 and §9's context gauge reads it, so the UI always
   *  sets this for custom endpoints. Omitted for Ollama (shape must not change). */
  contextWindow?: number;
}

export interface CustomEndpoint {
  /** Slug: the models.json provider key AND the env-var stem. */
  id: string;
  label: string;
  baseUrl: string;
  preset: EndpointPreset;
  /** env = secret injected at spawn; placeholder = fixed literal (Ollama
   *  ignores its key, but Pi needs auth present before models are listed). */
  auth: { kind: "env" } | { kind: "placeholder"; value: string };
  models: CustomModel[];
}

/** Per-preset compat flags (models.md §OpenAI Compatibility). A wrong flag
 *  fails at request time, not at save time — hence presets, not free text. */
export const PRESET_COMPAT: Record<EndpointPreset, Record<string, unknown>> = {
  ollama: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  vllm: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
  lmstudio: { supportsDeveloperRole: false, supportsUsageInStreaming: false },
  llamacpp: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
  other: {},
};

/** Providers HappyVibe wrote before `hvManaged` existed. */
const LEGACY_MANAGED = ["ollama"];

export function envVarFor(id: string): string {
  return `HV_CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY`;
}

/**
 * Neutralise Pi's value-resolution syntax for a literal string: "!cmd" at the
 * start EXECUTES a shell command at request time and "$VAR" interpolates env
 * (models.md §Value Resolution). Escapes are "$!" and "$$".
 */
export function escapePiValue(v: string): string {
  const dollars = v.replace(/\$/g, "$$$$"); // one "$" → "$$"
  return dollars.startsWith("!") ? `$!${dollars.slice(1)}` : dollars;
}

export function endpointEntry(e: CustomEndpoint): Record<string, unknown> {
  return {
    name: e.label,
    baseUrl: e.baseUrl,
    api: "openai-completions",
    apiKey: e.auth.kind === "env" ? `$${envVarFor(e.id)}` : escapePiValue(e.auth.value),
    compat: PRESET_COMPAT[e.preset],
    models: e.models.map((m) =>
      m.contextWindow === undefined ? { id: m.id } : { id: m.id, contextWindow: m.contextWindow },
    ),
  };
}

/**
 * Rewrite the HappyVibe-managed slice of models.json, preserving anything a
 * user hand-added. `hvManaged` records what we wrote so a removed endpoint is
 * actually deleted next time.
 */
export function mergeModelsJson(existingRaw: string | null, endpoints: CustomEndpoint[]): string {
  let parsed: { providers?: Record<string, unknown>; hvManaged?: string[] } = {};
  try {
    parsed = JSON.parse(existingRaw ?? "{}");
  } catch {
    /* corrupt file in our app-owned dir — rebuild it */
  }
  const providers = { ...(parsed.providers ?? {}) };
  for (const id of [...(parsed.hvManaged ?? []), ...LEGACY_MANAGED]) delete providers[id];
  for (const e of endpoints) providers[e.id] = endpointEntry(e);
  return JSON.stringify({ ...parsed, providers, hvManaged: endpoints.map((e) => e.id) }, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output (success).

- [ ] **Step 6: Fix the one test whose NAME lied**

`tests/providers.test.ts:18` is named `"curated list only — no custom endpoints in V1"`. Its *assertion* stays true — `BYOK_PROVIDERS` really does stay those five, because custom endpoints are a separate axis, not new BYOK entries. Only the name now contradicts the PRD. Rename it and add the boundary it should have asserted:

```ts
  test("curated BYOK list stays curated — custom endpoints are a separate axis", () => {
    expect(Object.keys(BYOK_PROVIDERS).sort()).toEqual(
      ["anthropic", "deepseek", "google", "openai", "openrouter"],
    );
    // A custom endpoint id is NOT a BYOK provider (PRD §16, 2026-07-30).
    expect(isByokProvider("my-vllm")).toBe(false);
    expect(isByokProvider("mistral")).toBe(false);
  });
```

- [ ] **Step 7: Run the full non-live suite, then commit**

Run: `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
Expected: all pass.

```bash
git add src/main/modelsJson.ts tests/custom-endpoints.test.ts tests/providers.test.ts
git commit -m "feat(providers): pure models.json writer for custom OpenAI-compatible endpoints"
```

---

### Task 2: Re-implement Ollama as a preset (Decision 7)

**Files:**
- Modify: `src/main/providers.ts:78-105` (`mergeOllamaModelsJson`)
- Test: `tests/providers.test.ts` — its three `mergeOllamaModelsJson` tests must pass **unchanged**

**Interfaces:**
- Consumes: `mergeModelsJson`, `CustomEndpoint` from Task 1.
- Produces: `mergeOllamaModelsJson(existingRaw: string | null, models: string[]): string` — same signature as today.

- [ ] **Step 1: Run the existing tests to confirm the baseline is green**

Run: `npx vitest run tests/providers.test.ts`
Expected: PASS. These assertions are the spec for this refactor — they must not be edited.

- [ ] **Step 2: Replace the body with a wrapper**

```ts
// src/main/providers.ts — replace the whole mergeOllamaModelsJson body.
// Add to the existing imports at the top of the file:
//   import { mergeModelsJson, type CustomEndpoint } from "./modelsJson";

/**
 * Merge an "ollama" provider entry into models.json. Ollama is now just one
 * preset on the shared custom-endpoint path (PRD §16, 2026-07-30); the emitted
 * JSON is unchanged. Empty model list removes the entry.
 */
export function mergeOllamaModelsJson(existingRaw: string | null, models: string[]): string {
  const endpoints: CustomEndpoint[] =
    models.length === 0
      ? []
      : [{
          id: "ollama",
          label: "Ollama",
          baseUrl: `${OLLAMA_BASE_URL}/v1`,
          preset: "ollama",
          // Ollama ignores it, but Pi requires auth before models appear in
          // get_available_models (docs/models.md).
          auth: { kind: "placeholder", value: "ollama" },
          models: models.map((id) => ({ id })), // no contextWindow — unknown for local models
        }];
  return mergeModelsJson(existingRaw, endpoints);
}
```

- [ ] **Step 3: Run the tests — unchanged assertions must still pass**

Run: `npx vitest run tests/providers.test.ts tests/custom-endpoints.test.ts`
Expected: PASS. If the `apiKey === "ollama"` or `models === [{id}]` assertions fail, the refactor changed behaviour — fix the code, **not** the test.

- [ ] **Step 4: Commit**

```bash
git add src/main/providers.ts
git commit -m "refactor(providers): Ollama becomes a preset on the shared models.json path"
```

---

### Task 3: Persist endpoints + keys, build the spawn env

**Files:**
- Modify: `src/main/modelsJson.ts` (add `customEndpointEnv`)
- Modify: `src/main/config.ts:9-27` (`ConfigFile`), and after `providerEnv()` at `:86-89`
- Test: `tests/custom-endpoints.test.ts` (append)

**Interfaces:**
- Consumes: `CustomEndpoint`, `envVarFor` from Task 1.
- Produces: pure `customEndpointEnv(endpoints: CustomEndpoint[], keys: Record<string, string>): Record<string, string>`; electron-side `listCustomEndpoints(): CustomEndpoint[]`, `saveCustomEndpoint(e: CustomEndpoint, key?: string): void`, `removeCustomEndpoint(id: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/custom-endpoints.test.ts
import { customEndpointEnv } from "../src/main/modelsJson";

describe("customEndpointEnv", () => {
  test("maps stored keys onto the env vars models.json references", () => {
    expect(customEndpointEnv([vllm], { "my-vllm": "sk-secret" })).toEqual({
      HV_CUSTOM_MY_VLLM_KEY: "sk-secret",
    });
  });

  test("an endpoint with no stored key contributes no empty env var", () => {
    expect(customEndpointEnv([vllm], {})).toEqual({});
  });

  test("placeholder-auth endpoints never take an env var", () => {
    const ollama: CustomEndpoint = {
      id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1",
      preset: "ollama", auth: { kind: "placeholder", value: "ollama" }, models: [{ id: "m" }],
    };
    expect(customEndpointEnv([ollama], { ollama: "ignored" })).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: FAIL — `customEndpointEnv is not a function`.

- [ ] **Step 3: Implement the pure function**

```ts
// append to src/main/modelsJson.ts
/** Env vars for every env-auth endpoint that has a stored key. */
export function customEndpointEnv(
  endpoints: CustomEndpoint[],
  keys: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of endpoints) {
    if (e.auth.kind !== "env") continue;
    const key = keys[e.id];
    if (key) out[envVarFor(e.id)] = key;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the electron-side persistence**

```ts
// src/main/config.ts — add to ConfigFile (after linkedSkillDirs):
  /** §16 (2026-07-30): user-defined OpenAI-compatible endpoints. */
  customEndpoints?: CustomEndpoint[];
  /** safeStorage-encrypted keys for those endpoints, base64, by endpoint id. */
  customKeys?: Record<string, string>;

// add to the imports:
//   import { customEndpointEnv, type CustomEndpoint } from "./modelsJson";

// append after providerEnv():
export function listCustomEndpoints(): CustomEndpoint[] {
  return load().customEndpoints ?? [];
}

function storedCustomKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = load().customKeys ?? {};
  for (const id of Object.keys(keys)) {
    const k = decrypt(keys[id]);
    if (k) out[id] = k;
  }
  return out;
}

/** Upsert by id. `key` omitted leaves any existing key untouched. */
export function saveCustomEndpoint(e: CustomEndpoint, key?: string): void {
  const cfg = load();
  const rest = (cfg.customEndpoints ?? []).filter((x) => x.id !== e.id);
  cfg.customEndpoints = [...rest, e];
  if (key) cfg.customKeys = { ...cfg.customKeys, [e.id]: safeStorage.encryptString(key).toString("base64") };
  save(cfg);
}

export function removeCustomEndpoint(id: string): void {
  const cfg = load();
  cfg.customEndpoints = (cfg.customEndpoints ?? []).filter((x) => x.id !== id);
  if (cfg.customKeys) delete cfg.customKeys[id];
  save(cfg);
}

/** True once a key is stored — the UI shows "key saved" without reading it. */
export function customKeyStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of Object.keys(storedCustomKeys())) out[id] = true;
  return out;
}
```

Then extend `providerEnv()` (`config.ts:86-89`) so custom keys ride the same spawn env:

```ts
export function providerEnv(): Record<string, string> {
  return {
    ...buildProviderEnv(storedKeys()),
    ...customEndpointEnv(listCustomEndpoints(), storedCustomKeys()),
  };
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no output.

```bash
git add src/main/modelsJson.ts src/main/config.ts tests/custom-endpoints.test.ts
git commit -m "feat(providers): persist custom endpoints + inject their keys as spawn env"
```

---

### Task 4: Write all endpoints to models.json on spawn

**Files:**
- Modify: `src/main/providers.ts` (add `syncModelsJson`, keep `syncOllamaModels` as its caller)
- Modify: `src/main/ipc.ts:271` and `:591` (the two `syncOllamaModels(agentDir())` calls)

**Interfaces:**
- Consumes: `mergeModelsJson`, `detectOllama`, `listCustomEndpoints`.
- Produces: `syncModelsJson(agentDir: string, custom: CustomEndpoint[]): Promise<{ running: boolean; models: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/custom-endpoints.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncModelsJson } from "../src/main/providers";

test("syncModelsJson writes custom endpoints alongside whatever Ollama reports", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-models-"));
  await syncModelsJson(dir, [vllm]); // Ollama absent in CI → detect returns no models
  const out = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf8"));
  expect(out.providers["my-vllm"].baseUrl).toBe("http://gpu.lan:8000/v1");
  expect(out.hvManaged).toContain("my-vllm");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: FAIL — `syncModelsJson is not exported`.

- [ ] **Step 3: Implement**

```ts
// src/main/providers.ts — replace syncOllamaModels with this pair.
/**
 * Detect Ollama, then write the whole HappyVibe-managed slice of models.json
 * (Ollama + every custom endpoint) before a Pi spawn. Pi reads models.json at
 * startup only, so this must run before each spawn.
 */
export async function syncModelsJson(
  agentDir: string,
  custom: CustomEndpoint[],
): Promise<{ running: boolean; models: string[] }> {
  const detected = await detectOllama();
  const endpoints: CustomEndpoint[] = [
    ...(detected.models.length
      ? [{
          id: "ollama", label: "Ollama", baseUrl: `${OLLAMA_BASE_URL}/v1`,
          preset: "ollama" as const, auth: { kind: "placeholder" as const, value: "ollama" },
          models: detected.models.map((id) => ({ id })),
        }]
      : []),
    ...custom,
  ];
  const file = path.join(agentDir, "models.json");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const next = mergeModelsJson(existing, endpoints);
  if (next !== existing) {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(file, next);
  }
  return detected;
}

/** Back-compat wrapper: Ollama only, no custom endpoints. */
export async function syncOllamaModels(agentDir: string): Promise<{ running: boolean; models: string[] }> {
  return syncModelsJson(agentDir, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/custom-endpoints.test.ts tests/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Point both spawn paths at it**

In `src/main/ipc.ts`, replace `await syncOllamaModels(agentDir()).catch(() => {});` at **:271** (`startUtility`) and **:591** (session start) with:

```ts
    await syncModelsJson(agentDir(), listCustomEndpoints()).catch(() => {});
```

Update the two import blocks: add `syncModelsJson` to the `./providers` import (`ipc.ts:23-25`) and `listCustomEndpoints` to the `./config` import (`ipc.ts:11-13`).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/main/providers.ts src/main/ipc.ts tests/custom-endpoints.test.ts
git commit -m "feat(providers): sync custom endpoints into models.json on every spawn"
```

---

### Task 5: Fetch model ids from `GET /v1/models`

**Files:**
- Modify: `src/main/modelsJson.ts` (add `parseOpenAiModelList`)
- Modify: `src/main/providers.ts` (add `fetchEndpointModels`)
- Test: `tests/custom-endpoints.test.ts` (append)

**Interfaces:**
- Produces: `parseOpenAiModelList(json: unknown): string[]`; `fetchEndpointModels(baseUrl: string, key?: string): Promise<{ ok: boolean; models: string[]; error?: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/custom-endpoints.test.ts
import { parseOpenAiModelList } from "../src/main/modelsJson";

describe("parseOpenAiModelList", () => {
  test("reads the OpenAI /v1/models shape", () => {
    expect(parseOpenAiModelList({ data: [{ id: "gpt-4o" }, { id: "llama-3.1-70b" }] }))
      .toEqual(["gpt-4o", "llama-3.1-70b"]);
  });
  test("ignores entries without a string id and tolerates junk", () => {
    expect(parseOpenAiModelList({ data: [{ id: 1 }, {}, { id: "ok" }] })).toEqual(["ok"]);
    expect(parseOpenAiModelList(null)).toEqual([]);
    expect(parseOpenAiModelList({ data: "nope" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: FAIL — `parseOpenAiModelList is not a function`.

- [ ] **Step 3: Implement**

```ts
// append to src/main/modelsJson.ts
/** Model ids from an OpenAI-compatible `GET /v1/models` body. */
export function parseOpenAiModelList(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
```

```ts
// append to src/main/providers.ts (imports: add parseOpenAiModelList)
/**
 * Probe an OpenAI-compatible endpoint for its model list. Never throws — the
 * UI shows the error string instead, so a typo'd URL is a message, not a crash.
 */
export async function fetchEndpointModels(
  baseUrl: string,
  key?: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    return { ok: true, models: parseOpenAiModelList(await res.json()) };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/custom-endpoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/modelsJson.ts src/main/providers.ts tests/custom-endpoints.test.ts
git commit -m "feat(providers): probe /v1/models for a custom endpoint's model list"
```

---

### Task 6: Orphan-provider fallback (Decision 6) — both mirrors

**Files:**
- Modify: `src/renderer/src/composer.ts:42-48` (`resolveModel` area)
- Modify: `src/main/ipc.ts:196-206` (`spawnOpts`)
- Test: `tests/composer.test.ts` if it exists, else create `tests/model-fallback.test.ts`

**Interfaces:**
- Produces: `dropUnknownProvider(ref: ModelRef | null | undefined, known: string[]): ModelRef | null` — exported from `composer.ts` and imported by nothing in main (main re-implements the same 3 lines; see the note below).

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-fallback.test.ts
import { describe, expect, test } from "vitest";
import { dropUnknownProvider, resolveModel } from "../src/renderer/src/composer";

describe("dropUnknownProvider — a deleted custom endpoint must not strand a session", () => {
  test("a ref whose provider is gone is dropped", () => {
    expect(dropUnknownProvider({ provider: "my-vllm", modelId: "q" }, ["deepseek"])).toBeNull();
  });
  test("a known provider survives", () => {
    const ref = { provider: "deepseek", modelId: "deepseek-chat" };
    expect(dropUnknownProvider(ref, ["deepseek"])).toEqual(ref);
  });
  test("an empty known-list (models not loaded yet) is not treated as 'all gone'", () => {
    const ref = { provider: "my-vllm", modelId: "q" };
    expect(dropUnknownProvider(ref, [])).toEqual(ref);
  });
  test("resolution falls through to the next tier once the session ref is dropped", () => {
    const session = dropUnknownProvider({ provider: "my-vllm", modelId: "q" }, ["deepseek"]);
    const workspace = null;
    const global = { provider: "deepseek", modelId: "deepseek-chat" };
    expect(resolveModel(session, workspace, global)).toEqual(global);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-fallback.test.ts`
Expected: FAIL — `dropUnknownProvider is not exported`.

- [ ] **Step 3: Implement in the renderer mirror**

```ts
// append to src/renderer/src/composer.ts, next to resolveModel
/**
 * Drop a model ref whose provider no longer exists (a deleted custom endpoint,
 * PRD §16 2026-07-30) so tier resolution falls through to the default instead
 * of pinning a session to a provider Pi cannot load.
 *
 * An EMPTY `known` list means "model list not loaded yet", not "everything is
 * gone" — returning null there would silently reset every session at startup.
 */
export function dropUnknownProvider(
  ref: ModelRef | null | undefined,
  known: string[],
): ModelRef | null {
  if (!ref) return null;
  if (known.length === 0) return ref;
  return known.includes(ref.provider) ? ref : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-fallback.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror it in main (CLAUDE.md: both or neither)**

In `src/main/ipc.ts`, `spawnOpts` currently reads:

```ts
      model:
        (sessionId ? index.get(sessionId)?.model : null) ??
        (workspace ? workspaces.getModel(workspace) : null) ??
        getDefaultModel(),
```

Replace with a known-provider filter. `known` = curated BYOK ids + `"ollama"` + configured custom endpoint ids (do **not** call Pi for this — spawnOpts is synchronous and must not block a spawn):

```ts
      model: (() => {
        const known = [
          ...BYOK_PROVIDER_IDS as string[],
          "ollama",
          ...listCustomEndpoints().map((e) => e.id),
        ];
        // Mirrors dropUnknownProvider in renderer composer.ts — change both or neither.
        const live = (m: { provider: string; modelId: string } | null | undefined) =>
          m && known.includes(m.provider) ? m : null;
        return (
          live(sessionId ? index.get(sessionId)?.model : null) ??
          live(workspace ? workspaces.getModel(workspace) : null) ??
          live(getDefaultModel())
        );
      })(),
```

Add `BYOK_PROVIDER_IDS` to the `./providers` import.

- [ ] **Step 6: Notify the renderer when a session's pin was dropped**

In the `hv:remove-custom-endpoint` handler (Task 7), after removing, emit the existing session-notice channel so the user sees it rather than guessing:

```ts
    send("hv:session-reloading", { reason: "provider-removed" });
```

- [ ] **Step 7: Typecheck, full non-live suite, commit**

Run: `npm run typecheck` then the non-live suite command from Task 1 Step 7.

```bash
git add src/renderer/src/composer.ts src/main/ipc.ts tests/model-fallback.test.ts
git commit -m "feat(models): fall back to the default model when a provider is gone"
```

---

### Task 7: IPC + preload + the Settings "Custom endpoint" group

**Files:**
- Modify: `src/main/ipc.ts` (4 handlers, next to `hv:detect-ollama` at `:1052`)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts:277`
- Modify: `src/renderer/src/components/SettingsView.tsx` (state ~`:292`, summary ~`:385`, JSX after the `Cloud API keys` group ~`:560`)

**Interfaces:**
- Consumes: `listCustomEndpoints`, `saveCustomEndpoint`, `removeCustomEndpoint`, `customKeyStatus`, `fetchEndpointModels`, `syncModelsJson`.
- Produces on `window.hv`: `getCustomEndpoints()`, `saveCustomEndpoint(e, key?)`, `removeCustomEndpoint(id)`, `fetchEndpointModels(baseUrl, key?)`.

- [ ] **Step 1: Add the IPC handlers**

```ts
// src/main/ipc.ts — after ipcMain.handle("hv:detect-ollama", …)
  ipcMain.handle("hv:get-custom-endpoints", () => ({
    endpoints: listCustomEndpoints(),
    keyStatus: customKeyStatus(),
  }));

  ipcMain.handle("hv:save-custom-endpoint", async (_e, endpoint: CustomEndpoint, key?: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(endpoint.id)) throw new Error(`Bad endpoint id: ${endpoint.id}`);
    if (!/^https?:\/\//.test(endpoint.baseUrl)) throw new Error(`Bad base URL: ${endpoint.baseUrl}`);
    if (isByokProvider(endpoint.id) || endpoint.id === "ollama") throw new Error(`Reserved id: ${endpoint.id}`);
    saveCustomEndpoint(endpoint, key);
    await syncModelsJson(agentDir(), listCustomEndpoints()).catch(() => {});
    await restartUtility();
    providersChanged();
  });

  ipcMain.handle("hv:remove-custom-endpoint", async (_e, id: string) => {
    removeCustomEndpoint(id);
    await syncModelsJson(agentDir(), listCustomEndpoints()).catch(() => {});
    await restartUtility();
    providersChanged();
    send("hv:session-reloading", { reason: "provider-removed" });
  });

  ipcMain.handle("hv:fetch-endpoint-models", (_e, baseUrl: string, key?: string) =>
    fetchEndpointModels(baseUrl, key),
  );
```

Imports to extend: `./config` → `listCustomEndpoints, saveCustomEndpoint, removeCustomEndpoint, customKeyStatus`; `./providers` → `fetchEndpointModels, syncModelsJson`; `./modelsJson` → `type CustomEndpoint`.

- [ ] **Step 2: Expose them in preload + `hv.d.ts`**

```ts
// src/renderer/src/hv.d.ts — after detectOllama()
  /** §16 (2026-07-30): user-defined OpenAI-compatible endpoints. */
  getCustomEndpoints(): Promise<{ endpoints: HvCustomEndpoint[]; keyStatus: Record<string, boolean> }>;
  saveCustomEndpoint(endpoint: HvCustomEndpoint, key?: string): Promise<void>;
  removeCustomEndpoint(id: string): Promise<void>;
  fetchEndpointModels(baseUrl: string, key?: string): Promise<{ ok: boolean; models: string[]; error?: string }>;
```

```ts
// src/renderer/src/hv.d.ts — near the other exported shapes
export interface HvCustomEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  preset: "ollama" | "vllm" | "lmstudio" | "llamacpp" | "other";
  auth: { kind: "env" } | { kind: "placeholder"; value: string };
  models: { id: string; contextWindow?: number }[];
}
```

Mirror the four in `src/preload/index.ts` with `ipcRenderer.invoke`, following the exact pattern of the neighbouring `detectOllama` entry.

- [ ] **Step 3: Add the fourth group to Settings**

State, next to the existing `ollama` state at `SettingsView.tsx:294`:

```tsx
  const [custom, setCustom] = useState<{ endpoints: HvCustomEndpoint[]; keyStatus: Record<string, boolean> }>({ endpoints: [], keyStatus: {} });
  const [draft, setDraft] = useState<{ label: string; baseUrl: string; preset: HvCustomEndpoint["preset"]; key: string } | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({}); // model id → context window
```

Load it in the same effect that calls `getProviders()` (`:304`): `setCustom(await window.hv.getCustomEndpoints());`

Include custom endpoints in the configured-providers summary (`:385-388`), so a configured endpoint appears at the top of LLM Setup like the others:

```tsx
    ...custom.endpoints.map((e) => ({
      key: e.id,
      label: `${e.label} (${e.models.length} model${e.models.length === 1 ? "" : "s"})`,
      chip: custom.keyStatus[e.id] ? "key saved" : "no key",
    })),
```

Then the group itself, after the `Cloud API keys` block:

```tsx
              <GroupLabel>Custom endpoint</GroupLabel>
              <div className="flex flex-col gap-3">
                {custom.endpoints.map((e) => (
                  <div key={e.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-sm flex-1 min-w-0">{e.label}</div>
                      <Chip tone={custom.keyStatus[e.id] ? "leaf" : "muted"}>
                        {custom.keyStatus[e.id] ? "key saved" : "no key"}
                      </Chip>
                      <span className="text-xs text-ink-soft font-mono truncate max-w-[16rem]">{e.baseUrl}</span>
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                        onClick={() => {
                          void window.hv.removeCustomEndpoint(e.id)
                            .then(() => window.hv.getCustomEndpoints())
                            .then(setCustom);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                {draft === null ? (
                  <button
                    type="button"
                    className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep self-start`}
                    onClick={() => { setDraft({ label: "", baseUrl: "", preset: "other", key: "" }); setProbe(null); setPicked({}); }}
                  >
                    + OpenAI-compatible endpoint
                  </button>
                ) : (
                  <div className="rounded-xl border-2 border-line bg-paper px-4 py-3 flex flex-col gap-2">
                    <input
                      placeholder="Name (e.g. My vLLM)"
                      value={draft.label}
                      onChange={(ev) => setDraft({ ...draft, label: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 text-sm focus:outline-none focus:border-tangerine"
                    />
                    <input
                      placeholder="Base URL (e.g. http://localhost:8000/v1)"
                      value={draft.baseUrl}
                      onChange={(ev) => setDraft({ ...draft, baseUrl: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:border-tangerine"
                    />
                    <select
                      value={draft.preset}
                      onChange={(ev) => setDraft({ ...draft, preset: ev.target.value as HvCustomEndpoint["preset"] })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 text-sm"
                    >
                      <option value="vllm">vLLM</option>
                      <option value="lmstudio">LM Studio</option>
                      <option value="llamacpp">llama.cpp</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="password"
                      placeholder="API key (leave blank if the server needs none)"
                      value={draft.key}
                      onChange={(ev) => setDraft({ ...draft, key: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:border-tangerine"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                        onClick={() => {
                          void window.hv.fetchEndpointModels(draft.baseUrl, draft.key || undefined).then(setProbe);
                        }}
                      >
                        Fetch models
                      </button>
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                        onClick={() => setDraft(null)}
                      >
                        Cancel
                      </button>
                    </div>

                    {probe?.error && <p className="text-sm text-brick">Could not reach it: {probe.error}</p>}
                    {probe?.ok && probe.models.length === 0 && (
                      <p className="text-sm text-ink-soft">Reached it, but it listed no models.</p>
                    )}
                    {probe?.ok && probe.models.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-ink-soft">
                          Pick the models to expose, and set each context window — the token gauge reads it.
                        </p>
                        {probe.models.map((id) => (
                          <label key={id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={id in picked}
                              onChange={(ev) =>
                                setPicked((p) => {
                                  const next = { ...p };
                                  if (ev.target.checked) next[id] = 128000;
                                  else delete next[id];
                                  return next;
                                })
                              }
                            />
                            <span className="font-mono text-xs flex-1 min-w-0 truncate">{id}</span>
                            {id in picked && (
                              <input
                                type="number"
                                value={picked[id]}
                                onChange={(ev) => setPicked((p) => ({ ...p, [id]: Number(ev.target.value) }))}
                                className="w-24 rounded-lg border-2 border-line bg-card px-2 py-1 text-xs"
                              />
                            )}
                          </label>
                        ))}
                        <button
                          type="button"
                          disabled={Object.keys(picked).length === 0 || draft.label.trim() === ""}
                          className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep hover:brightness-105 disabled:opacity-40 self-start mt-1`}
                          onClick={() => {
                            const endpoint: HvCustomEndpoint = {
                              id: draft.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                              label: draft.label.trim(),
                              baseUrl: draft.baseUrl.trim(),
                              preset: draft.preset,
                              auth: { kind: "env" },
                              models: Object.entries(picked).map(([id, contextWindow]) => ({ id, contextWindow })),
                            };
                            void window.hv.saveCustomEndpoint(endpoint, draft.key || undefined)
                              .then(() => window.hv.getCustomEndpoints())
                              .then((c) => { setCustom(c); setDraft(null); setProbe(null); setPicked({}); });
                          }}
                        >
                          Save endpoint
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
```

- [ ] **Step 4: Typecheck both projects**

Run: `npm run typecheck`
Expected: no output. (`typecheck:web` is the one that covers this file.)

- [ ] **Step 5: Full non-live suite + build**

Run the non-live command from Task 1 Step 7, then `npm run build`.
Expected: all tests pass; build succeeds.

- [ ] **Step 6: UI pass — REQUIRES THE HUMAN**

The agent cannot launch the app (`electron-debug`'s `start_app` has hung for 30 minutes here). Ask the user to run:

```
HV_DEBUG_PORT=9222 npm run dev
```

Then `attach {debugPort: 9222}` and verify with screenshots, per `.claude/commands/uicheck.md`:
1. Settings → LLM Setup → **+ Add provider** shows a fourth group, **Custom endpoint**.
2. Adding `http://localhost:11434/v1` (Ollama's own OpenAI-compatible port, handy as a test server) + **Fetch models** lists models.
3. Saving shows the endpoint with a `key saved` / `no key` chip and it appears in the configured-providers summary.
4. The saved models appear in the global default-model dropdown.
5. `get_console_messages` with `level: error` is clean.
6. Confirm `<agentDir>/models.json` contains `"apiKey": "$HV_CUSTOM_…_KEY"` and **not** the typed key.
7. Remove the endpoint → it disappears from the model list and the session notice appears.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/components/SettingsView.tsx
git commit -m "feat(settings): add OpenAI-compatible custom endpoints to LLM Setup"
```

---

## Final gate (before `/land`)

1. `npm run typecheck`
2. The non-live suite (command in Task 1 Step 7)
3. **One live-Pi batch.** `src/main/pi/spawn.ts` should be untouched by this plan, so the live files are not strictly required — but `models.json` is read by Pi at startup and this plan changes what's in it, so run the batch once and paste the output:
   `grep -rl 'skipIf(!KEY' tests/ | xargs npx vitest run`
   Use `xargs`: zsh does not word-split `$(…)`, so `npx vitest run $files` passes all 14 paths as ONE argument and vitest reports "No test files found" while echoing the filter list — a false green if you only skim the tail. A skip is not a pass; one failure ⇒ rerun that file in isolation before calling it a regression (`intent-bridge` and `plan-bridge` both have known model-nondeterminism flakes).
4. `npm run build`
5. The UI pass in Task 7 Step 6, with screenshots.

## Notes for the implementer

- **The two security answers overlap, deliberately.** Because `apiKey` in `models.json` is always the literal string `$HV_CUSTOM_<ID>_KEY`, no user text reaches a Pi-resolved field, so `escapePiValue` is defence-in-depth today. It is still required and still tested: the `placeholder` auth path writes a literal, and any future `headers` support would write user text straight into a resolved field.
- **Do not add a `headers` UI in this plan.** It is the same code-execution surface with none of the env indirection. Out of scope.
- **`hvManaged` is why deletion works.** The old code could only ever delete the hardcoded `ollama` key; without the manifest a removed endpoint would linger in `models.json` forever and keep being offered.
- **Reserved ids.** `ollama` and the five curated BYOK ids are rejected at the IPC boundary — a custom endpoint that shadowed `deepseek` would silently reroute a curated provider.
