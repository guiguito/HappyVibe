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
  for (const id of [...(parsed.hvManaged ?? []), ...LEGACY_MANAGED]) delete providers[id];
  for (const e of endpoints) providers[e.id] = endpointEntry(e);
  return JSON.stringify({ ...parsed, providers, hvManaged: endpoints.map((e) => e.id) }, null, 2);
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
