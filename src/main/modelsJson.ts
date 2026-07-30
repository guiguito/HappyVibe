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
