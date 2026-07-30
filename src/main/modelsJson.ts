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
  /**
   * USD per MILLION tokens — the unit every provider's price page uses, and the
   * unit Pi's models.json wants, so no conversion anywhere.
   *
   * Without these, a custom endpoint reports $0.00 for every call forever: Pi's
   * provider-composer.js:68 defaults an unpriced model to all-zero rates, so a
   * real session burned 60k tokens and showed as free. Optional because a user
   * genuinely may not know the rates — unpriced is then LABELLED as unknown in
   * the cost ledger (calls.ts `priced`) rather than silently summed as zero.
   *
   * priceIn and priceOut come as a pair (validateEndpoint enforces it): one
   * alone would produce a plausible-looking total that is quietly half right.
   */
  priceIn?: number;
  priceOut?: number;
  /**
   * Cache-hit rate. Defaults to priceIn when unset, because a server that
   * reports `cached_tokens` bills for them and Pi subtracts cache reads out of
   * `input` — so a 0 here re-creates the very under-reporting this fixes (cache
   * reads are ~90% of a coding agent's prompt tokens). Set it explicitly for a
   * server that genuinely discounts cache hits.
   * ponytail: no cacheWrite knob — openai-completions servers rarely bill one
   * separately, and absent `cache_write_tokens` means 0 tokens anyway. Add a
   * field if a real endpoint turns out to charge for it.
   */
  priceCacheRead?: number;
}

export interface CustomEndpoint {
  /** Slug: the env-var stem, and the key the stored secret is filed under. */
  id: string;
  /**
   * The models.json provider key. NEVER equal to `id` for user-created
   * endpoints — it is `hv-<id>` (see providerKeyFor). Pi ships ~30 built-in
   * provider ids (groq, together, mistral, github-copilot, …) and a user may
   * hand-write their own entries; an unprefixed key would silently rewrite a
   * built-in provider's baseUrl and apiKey, or clobber a hand-written entry
   * and then delete it on removal. Ollama keeps the historical key "ollama".
   */
  providerKey: string;
  label: string;
  baseUrl: string;
  preset: EndpointPreset;
  /** env = secret injected at spawn; placeholder = fixed literal. Pi needs SOME
   *  auth present before a provider's models are listed at all, so a keyless
   *  server (vLLM/LM Studio/llama.cpp with no auth) MUST use a placeholder —
   *  an env reference to a var that does not exist makes Pi treat the whole
   *  provider as unconfigured and hide every one of its models. */
  auth: { kind: "env" } | { kind: "placeholder"; value: string };
  models: CustomModel[];
}

/** Namespace for user-created endpoints, so they can never collide with a Pi
 *  built-in provider id or a user's hand-written models.json entry. */
export function providerKeyFor(id: string): string {
  return `hv-${id}`;
}

/**
 * Per-preset compat flags (models.md §OpenAI Compatibility). A wrong flag fails
 * at REQUEST time, not at save time — hence presets, not free text.
 *
 * Every preset must pin `supportsDeveloperRole: false`. Pi's `detectCompat`
 * (pi-ai/dist/providers/openai-completions.js:861) matches an ALLOWLIST of hosts
 * it knows are non-standard; anything unrecognised is assumed to be genuine
 * OpenAI and gets `store`, the `developer` role, `reasoning_effort` and
 * `max_completion_tokens`. Pi's own bundled non-OpenAI providers all override
 * these (models.generated.js), and so must we — an empty compat is not a
 * neutral default, it is "pretend this is api.openai.com".
 */
export const PRESET_COMPAT: Record<EndpointPreset, Record<string, unknown>> = {
  ollama: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  vllm: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
  lmstudio: { supportsDeveloperRole: false, supportsUsageInStreaming: false },
  llamacpp: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
  // "I don't know what this server is" → the most widely accepted request shape.
  // An NVIDIA Cloud endpoint saved as "other" returned 400 on every turn until
  // these were pinned (2026-07-30).
  other: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
};

/** Providers HappyVibe wrote before `hvManaged` existed. */
const LEGACY_MANAGED = ["ollama"];

export function envVarFor(id: string): string {
  return `HV_CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY`;
}

/**
 * Endpoint ids are lowercase alphanumeric groups joined by SINGLE hyphens, ≤32
 * chars. Consecutive hyphens are refused on purpose: `envVarFor` collapses runs
 * of non-alphanumerics, so "a-b" and "a--b" would map to the same env var and
 * one endpoint would be handed the other endpoint's API key. This regex makes
 * id → env var injective.
 */
export function isValidEndpointId(id: string): boolean {
  return id.length <= 32 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

/**
 * Neutralise Pi's value-resolution syntax for a literal string: "!cmd" at the
 * start EXECUTES a shell command at request time and "$VAR" interpolates env
 * (docs/models.md §Value Resolution). Escapes are "$!" and "$$".
 */
export function escapePiValue(v: string): string {
  const dollars = v.replace(/\$/g, "$$$$"); // one "$" → "$$"
  return dollars.startsWith("!") ? `$!${dollars.slice(1)}` : dollars;
}

/**
 * Pi's `cost` block, or undefined when the model is unpriced. ModelCostSchema
 * (model-config.js:111) requires ALL FOUR rates — a partial object fails
 * validation and Pi discards the entire provider, not just the model — so this
 * is all-or-nothing on purpose.
 */
function modelCost(m: CustomModel): Record<string, number> | undefined {
  if (m.priceIn === undefined || m.priceOut === undefined) return undefined;
  return {
    input: m.priceIn,
    output: m.priceOut,
    cacheRead: m.priceCacheRead ?? m.priceIn,
    cacheWrite: 0,
  };
}

export function endpointEntry(e: CustomEndpoint): Record<string, unknown> {
  return {
    name: e.label,
    baseUrl: e.baseUrl,
    api: "openai-completions",
    apiKey: e.auth.kind === "env" ? `$${envVarFor(e.id)}` : escapePiValue(e.auth.value),
    compat: PRESET_COMPAT[e.preset],
    models: e.models.map((m) => {
      const cost = modelCost(m);
      return {
        id: m.id,
        ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
        ...(cost === undefined ? {} : { cost }),
      };
    }),
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
  for (const key of [...(parsed.hvManaged ?? []), ...LEGACY_MANAGED]) delete providers[key];
  for (const e of endpoints) providers[e.providerKey] = endpointEntry(e);
  return JSON.stringify(
    { ...parsed, providers, hvManaged: endpoints.map((e) => e.providerKey) },
    null,
    2,
  );
}

/**
 * Save-time validation, pure so it can be tested. Returns an error message or
 * null. Every rule here exists because of a concrete failure mode:
 *  - id shape        → keeps id → env var injective (see isValidEndpointId)
 *  - duplicate id    → `saveCustomEndpoint` upserts and KEEPS the previous key,
 *                      so a second endpoint reusing an id would be handed the
 *                      first one's secret and send it to a different host
 *  - http(s) only    → the probe and Pi both only speak HTTP
 *  - contextWindow≥1 → Pi throws on compose for <= 0 and DELETES the whole
 *                      provider, not just the offending model
 *  - at least 1 model → an endpoint with none is inert
 *  - prices        → a negative/non-finite rate makes every total nonsense, and
 *                    ONE rate without the other yields a plausible-looking cost
 *                    that is quietly half right. Unpriced is honest (the ledger
 *                    labels it unknown); half-priced is a lie.
 */
export function validateEndpoint(e: CustomEndpoint, existingIds: string[]): string | null {
  if (!isValidEndpointId(e.id)) {
    return `Invalid name — use letters, digits and single hyphens (got id "${e.id}")`;
  }
  if (existingIds.includes(e.id)) {
    return `An endpoint named "${e.label}" already exists — remove it first`;
  }
  if (!/^https?:\/\//.test(e.baseUrl)) return `Base URL must start with http:// or https:// (got "${e.baseUrl}")`;
  if (e.models.length === 0) return "Pick at least one model";
  for (const m of e.models) {
    if (m.contextWindow !== undefined && (!Number.isFinite(m.contextWindow) || m.contextWindow < 1)) {
      return `Context window for "${m.id}" must be at least 1`;
    }
    for (const [label, v] of [["input", m.priceIn], ["output", m.priceOut], ["cache-read", m.priceCacheRead]] as const) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
        return `Price (${label}) for "${m.id}" must be 0 or more`;
      }
    }
    if ((m.priceIn === undefined) !== (m.priceOut === undefined)) {
      return `Set both input and output prices for "${m.id}", or neither`;
    }
  }
  return null;
}

/** Model ids from an OpenAI-compatible `GET /v1/models` body. */
export function parseOpenAiModelList(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

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
