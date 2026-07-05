import fs from "node:fs";
import path from "node:path";

/**
 * Curated provider list (PRD B3 — locked). Env var names verified against
 * Pi 0.80.3: pi-ai/dist/env-api-keys.js `envMap` ("google" → GEMINI_API_KEY).
 * NO electron imports — vitest-importable.
 */
export const BYOK_PROVIDERS = {
  deepseek: { label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
  anthropic: { label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  openai: { label: "OpenAI", envVar: "OPENAI_API_KEY" },
  google: { label: "Google", envVar: "GEMINI_API_KEY" },
  openrouter: { label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
} as const;
export type ByokProvider = keyof typeof BYOK_PROVIDERS;
export const BYOK_PROVIDER_IDS = Object.keys(BYOK_PROVIDERS) as ByokProvider[];

export function isByokProvider(p: string): p is ByokProvider {
  return p in BYOK_PROVIDERS;
}

/** OAuth ladder rung 1 (Pi built-in OAuth provider ids, s0.2 §2). */
export const OAUTH_PROVIDERS = [
  { id: "anthropic", label: "Claude" },
  { id: "github-copilot", label: "GitHub Copilot" },
  { id: "openai-codex", label: "ChatGPT (Codex)" },
] as const;

/**
 * Env vars to inject on Pi spawn. Real env vars (.env dev convenience) win
 * over stored keys, matching the original single-key behavior.
 */
export function buildProviderEnv(
  stored: Partial<Record<ByokProvider, string>>,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of BYOK_PROVIDER_IDS) {
    const { envVar } = BYOK_PROVIDERS[id];
    const fromEnv = env[envVar];
    const val = fromEnv && !fromEnv.startsWith("sk-REPLACE") ? fromEnv : stored[id];
    if (val) out[envVar] = val;
  }
  return out;
}

export type KeySource = "env" | "stored" | null;

export function keySource(
  id: ByokProvider,
  stored: Partial<Record<ByokProvider, string>>,
  env: Record<string, string | undefined> = process.env,
): KeySource {
  const fromEnv = env[BYOK_PROVIDERS[id].envVar];
  if (fromEnv && !fromEnv.startsWith("sk-REPLACE")) return "env";
  return stored[id] ? "stored" : null;
}

// ── Ollama (rung 2 — local, zero keys) ─────────────────────────────────────

export const OLLAMA_BASE_URL = "http://localhost:11434";

export async function detectOllama(baseUrl = OLLAMA_BASE_URL): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return { running: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}

/**
 * Merge an "ollama" provider entry into a models.json payload (Pi 0.80.3
 * docs/models.md schema). Empty model list removes the entry. Other providers
 * in the file are preserved.
 */
export function mergeOllamaModelsJson(existingRaw: string | null, models: string[]): string {
  let parsed: { providers?: Record<string, unknown> } = {};
  try {
    parsed = JSON.parse(existingRaw ?? "{}");
  } catch {
    /* corrupt file in our app-owned dir — rebuild it */
  }
  const providers = { ...(parsed.providers ?? {}) };
  if (models.length === 0) {
    delete providers.ollama;
  } else {
    providers.ollama = {
      name: "Ollama",
      baseUrl: `${OLLAMA_BASE_URL}/v1`,
      api: "openai-completions",
      // Placeholder — Ollama ignores it, but Pi requires auth before models
      // appear in get_available_models (docs/models.md).
      apiKey: "ollama",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: models.map((id) => ({ id })),
    };
  }
  return JSON.stringify({ ...parsed, providers }, null, 2);
}

/** Detect Ollama and sync agentDir/models.json before a Pi spawn. */
export async function syncOllamaModels(agentDir: string): Promise<{ running: boolean; models: string[] }> {
  const detected = await detectOllama();
  const file = path.join(agentDir, "models.json");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const next = mergeOllamaModelsJson(existing, detected.models);
  if (next !== existing) {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(file, next);
  }
  return detected;
}

/** Providers present in Pi's auth.json (app-owned agent dir). Names only. */
export function authJsonProviders(agentDir: string): string[] {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8")));
  } catch {
    return [];
  }
}
