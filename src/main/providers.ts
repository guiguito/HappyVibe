import fs from "node:fs";
import path from "node:path";
import { mergeModelsJson, parseOpenAiModelList, providerKeyFor, type CustomEndpoint } from "./modelsJson";
import { OAUTH_CATALOG, PROVIDER_CATALOG } from "./providerCatalog.generated";

/**
 * The BYOK provider list. Round 1 curated five by hand (PRD B3); the 2026-08-29
 * providers round replaced that with `providerCatalog.generated.ts`, derived
 * from Pi's own registry so a pin bump adds providers instead of drifting past
 * them. Regenerate with `npm run catalog:providers`; the shape is pinned by
 * tests/provider-catalog.test.ts.
 *
 * A row is keyed by ONE env var and may unlock several Pi provider ids
 * (`providerIds` — moonshotai and moonshotai-cn share MOONSHOT_API_KEY).
 * NO electron imports — vitest-importable.
 */
export const BYOK_PROVIDERS: Record<string, { label: string; envVar: string }> = Object.fromEntries(
  PROVIDER_CATALOG.map((p) => [p.id, { label: p.label, envVar: p.envVar }]),
);
/** A catalog provider id. Widened from a literal union when the list was generated. */
export type ByokProvider = string;
export const BYOK_PROVIDER_IDS: string[] = PROVIDER_CATALOG.map((p) => p.id);

export function isByokProvider(p: string): boolean {
  return p in BYOK_PROVIDERS;
}

/**
 * OAuth ladder rung 1 (Pi built-in OAuth provider ids, s0.2 §2). Derived from
 * the generated catalog so the sign-in list cannot disagree with what Pi can
 * actually drive — but the LABELS are ours: upstream calls them "Anthropic" and
 * "OpenAI Codex", and the app has always said "Claude" and "ChatGPT (Codex)"
 * because that is the name on the subscription the user is signing in with.
 * A provider with no override keeps upstream's name.
 */
const OAUTH_LABELS: Record<string, string> = {
  anthropic: "Claude",
  "openai-codex": "ChatGPT (Codex)",
};
export const OAUTH_PROVIDERS: { id: string; label: string; caveat?: string }[] = OAUTH_CATALOG.map((p) => ({
  id: p.id,
  label: OAUTH_LABELS[p.id] ?? p.label,
  // Honest billing caveat — locked product decision.
  ...(p.id === "anthropic"
    ? { caveat: "Heads up: on Claude Pro/Max this uses your plan's extra usage." }
    : {}),
}));

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
  // A key stored under a provider the catalog no longer lists (a pin bump
  // dropped it) has no env var to report — it is simply not configured.
  const entry = BYOK_PROVIDERS[id];
  if (!entry) return null;
  const fromEnv = env[entry.envVar];
  if (fromEnv && !fromEnv.startsWith("sk-REPLACE")) return "env";
  return stored[id] ? "stored" : null;
}

/**
 * The first-run gate's decision, separated from its facts so it is testable —
 * §22 onboarding round (2026-09-01).
 *
 * Four ways a model can already exist. The last two were missing: `syncModelsJson`
 * injects LM Studio / llama.cpp into models.json before EVERY spawn, and a
 * hand-added endpoint is a provider too — so a user with a working model was
 * pinned to the forced-Models page forever, with nothing on screen saying why.
 * The onboarding wizard's step-1 checkmark derives from this predicate, and a
 * derived checkmark is only as honest as what it derives from.
 *
 * A custom endpoint counts only if it can actually authenticate: `placeholder`
 * auth IS the keyless-local-server case (see CustomEndpoint.auth — Pi needs SOME
 * auth present before a provider's models are listed), anything else needs its
 * stored key.
 */
export function anyProviderConfigured(facts: {
  keyStatus: Record<string, unknown>;
  authProviders: string[];
  customEndpoints: { id: string; auth: { kind: string } }[];
  customKeyStatus: Record<string, boolean>;
  localRunning: boolean;
}): boolean {
  if (Object.values(facts.keyStatus).some(Boolean)) return true;
  if (facts.authProviders.length > 0) return true;
  if (facts.localRunning) return true;
  return facts.customEndpoints.some(
    (e) => e.auth?.kind === "placeholder" || facts.customKeyStatus[e.id] === true,
  );
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
 * Ollama's documented default runtime window (`OLLAMA_CONTEXT_LENGTH`).
 *
 * Used ONLY when nothing is loaded and the server has therefore told us
 * nothing. It is a floor, not a guess dressed as a fact — see the resolver.
 */
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

/**
 * The window Ollama will ACTUALLY allocate per model — not the window the model
 * was trained for.
 *
 * WHY this exists, measured 2026-09-19 against a real server: `gemma4:12b`
 * reports `gemma4.context_length: 262144` from `/api/show` (the trained maximum)
 * while `/api/ps` reports `context_length: 4096` for the same model loaded —
 * because the runtime window is `num_ctx`, not the architecture's ceiling. And
 * HappyVibe wrote NEITHER: `ollamaEndpoint` omitted `contextWindow`, so Pi fell
 * back to its own 128,000 default, which `contextUsage` then reports and
 * `context.ts` labels `source: "measured"`. The gauge read **3% of 128,000**
 * where the truth was **96% of 4,096** — a 32x overstatement, in the app's most
 * confident state, immediately before silent front-truncation. This is Cline
 * issue #10375, which this project cites as a competitor failure.
 *
 * ONE request, not one per model: `/api/ps` answers for everything loaded, and
 * a loaded model also REVEALS the server's effective default for the unloaded
 * ones (a user who raised `OLLAMA_CONTEXT_LENGTH` shows up here). So the
 * resolution is: what the server says for this model → what the server says for
 * any other model → Ollama's documented default.
 *
 * ponytail: an unloaded model on a fresh server resolves to the 4,096 floor, so
 * a raised `OLLAMA_CONTEXT_LENGTH` UNDER-states until something has been loaded
 * once — deliberately the safe direction (an early warning is visible and
 * self-corrects at the next spawn; a calm gauge over a truncating context is
 * neither). Upgrade path if that is ever not good enough: `/api/show` per model
 * for a Modelfile-pinned `num_ctx`, N requests instead of 1.
 */
export async function resolveOllamaWindows(
  models: string[],
  baseUrl = OLLAMA_BASE_URL,
): Promise<Record<string, number>> {
  let loaded: { name?: string; context_length?: number }[] = [];
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(1200) });
    if (res.ok) loaded = ((await res.json()) as { models?: typeof loaded }).models ?? [];
  } catch {
    // Nothing loaded, or an Ollama too old for /api/ps. The floor below still
    // beats Pi's 128,000, which is the failure this function exists to end.
  }
  const byName = new Map(
    loaded.flatMap((m) => (m.name && (m.context_length ?? 0) > 0 ? [[m.name, m.context_length!] as const] : [])),
  );
  const observedDefault = byName.size ? Math.min(...byName.values()) : undefined;
  const out: Record<string, number> = {};
  for (const id of models) out[id] = byName.get(id) ?? observedDefault ?? OLLAMA_DEFAULT_NUM_CTX;
  return out;
}

/**
 * The same question for LM Studio and llama.cpp, each through its OWN native
 * endpoint — the OpenAI-compatible `/v1/models` both expose carries no window.
 *
 * Unlike the Ollama resolver above this one is NOT measured against a running
 * server (neither is installed here), which is exactly why it is written to
 * fail into today's behaviour: any shape it does not recognise yields `{}`, the
 * `contextWindow` field is then omitted, and the endpoint is built precisely as
 * it is built now. It can improve the gauge; it cannot regress it. Remove the
 * hedge in this comment once someone has run it against both.
 */
export async function resolveRunnerWindows(
  runner: LocalRunner,
  models: string[],
): Promise<Record<string, number>> {
  const root = runner.baseUrl.replace(/\/v1\/?$/, "");
  const get = async (path: string): Promise<unknown> => {
    try {
      const res = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(1200) });
      return res.ok ? await res.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const pos = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const out: Record<string, number> = {};

  if (runner.id === "lmstudio") {
    // /api/v0/models is per-model: prefer what is LOADED over what the model
    // could take, the same preference the Ollama resolver makes.
    const rows = (dataRows(await get("/api/v0/models")) ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      const id = typeof r.id === "string" ? r.id : undefined;
      const n = pos(r.loaded_context_length) ?? pos(r.max_context_length);
      if (id && n) out[id] = n;
    }
    return out;
  }

  // llama.cpp serves ONE model, so /props answers for every id in the list.
  const props = (await get("/props")) as { default_generation_settings?: Record<string, unknown> } | undefined;
  const n = pos(props?.default_generation_settings?.n_ctx) ?? pos((props as Record<string, unknown> | undefined)?.n_ctx);
  if (n) for (const id of models) out[id] = n;
  return out;
}

/** `{data:[…]}` or a bare array — LM Studio has shipped both. */
function dataRows(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  const d = (v as { data?: unknown } | undefined)?.data;
  return Array.isArray(d) ? d : undefined;
}

/**
 * The other two local runners the "free local" rung should cover (2026-08-29).
 * Ollama keeps its own detector because it speaks its own `/api/tags`; these
 * two are OpenAI-compatible, so detection IS the custom-endpoint probe and the
 * presets already pin their compat flags (PRD 2026-07-30 — a wrong flag fails
 * at request time, not at save time, which is why presets exist).
 */
export const LOCAL_RUNNERS = [
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", preset: "lmstudio" },
  { id: "llamacpp", label: "llama.cpp", baseUrl: "http://localhost:8080/v1", preset: "llamacpp" },
] as const;
export type LocalRunner = (typeof LOCAL_RUNNERS)[number];

/** Probe one local runner. Never throws — nothing listening is a normal answer. */
export async function detectLocalRunner(
  runner: LocalRunner,
  fetchImpl: typeof fetch = fetch,
): Promise<{ running: boolean; models: string[] }> {
  const res = await fetchEndpointModels(runner.baseUrl, undefined, fetchImpl);
  return res.ok ? { running: true, models: res.models } : { running: false, models: [] };
}

/** A detected runner as a CustomEndpoint, on the shared models.json path. */
export function localRunnerEndpoint(
  runner: LocalRunner,
  models: string[],
  windows?: Record<string, number>,
): CustomEndpoint {
  return {
    id: runner.id,
    // Namespaced `hv-<id>` like every other custom endpoint. Ollama's bare
    // "ollama" key is a HISTORICAL exception (sessions are pinned to it), not
    // a pattern to copy.
    providerKey: providerKeyFor(runner.id),
    label: runner.label,
    baseUrl: runner.baseUrl,
    preset: runner.preset,
    // Placeholder — these servers ignore it, but Pi requires auth before models
    // appear in get_available_models (docs/models.md).
    auth: { kind: "placeholder", value: runner.id },
    // A window when the runner told us one, omitted when it did not. NEVER a
    // guess: an omitted field lets Pi fall back to 128,000, which is wrong but
    // is today's behaviour; a wrong number here would be reported back through
    // `contextUsage` and labelled `source: "measured"`. See resolveOllamaWindows.
    models: models.map((id) => ({ id, ...(windows?.[id] ? { contextWindow: windows[id] } : {}) })),
  };
}

/**
 * Merge an "ollama" provider entry into a models.json payload (Pi 0.80.3
 * docs/models.md schema). Empty model list removes the entry. Other providers
 * in the file are preserved.
 *
 * Ollama is now just one preset on the shared custom-endpoint path (PRD §16,
 * 2026-07-30) — the emitted JSON is unchanged.
 */
export function mergeOllamaModelsJson(
  existingRaw: string | null,
  models: string[],
  windows?: Record<string, number>,
): string {
  return mergeModelsJson(existingRaw, models.length === 0 ? [] : [ollamaEndpoint(models, windows)]);
}

/** The Ollama entry as a CustomEndpoint. */
function ollamaEndpoint(models: string[], windows?: Record<string, number>): CustomEndpoint {
  return {
    id: "ollama",
    // Historical key — Ollama predates the hv- namespace and users' sessions
    // are already pinned to provider "ollama".
    providerKey: "ollama",
    label: "Ollama",
    baseUrl: `${OLLAMA_BASE_URL}/v1`,
    preset: "ollama",
    // Placeholder — Ollama ignores it, but Pi requires auth before models
    // appear in get_available_models (docs/models.md).
    auth: { kind: "placeholder", value: "ollama" },
    // Resolved from the SERVER (resolveOllamaWindows), not from the model's
    // trained maximum — the two differ by 64x on a stock gemma4:12b.
    models: models.map((id) => ({ id, ...(windows?.[id] ? { contextWindow: windows[id] } : {}) })),
  };
}

/**
 * Detect Ollama, then write the whole HappyVibe-managed slice of models.json
 * (Ollama + every custom endpoint) before a Pi spawn. Pi reads models.json at
 * startup only, so this must run before each spawn.
 */
export async function syncModelsJson(
  agentDir: string,
  custom: CustomEndpoint[],
  // Injected only by tests — probing three localhost ports is the real behaviour.
  detectors: {
    ollama: () => Promise<{ running: boolean; models: string[] }>;
    runner: (r: LocalRunner) => Promise<{ running: boolean; models: string[] }>;
    ollamaWindows?: (models: string[]) => Promise<Record<string, number>>;
    runnerWindows?: (r: LocalRunner, models: string[]) => Promise<Record<string, number>>;
  } = { ollama: detectOllama, runner: detectLocalRunner },
): Promise<{ running: boolean; models: string[] }> {
  // All three probes run together: they are independent localhost requests and
  // this sits in front of every spawn.
  const [detected, ...runners] = await Promise.all([
    detectors.ollama(),
    ...LOCAL_RUNNERS.map(async (r) => ({ runner: r, ...(await detectors.runner(r)) })),
  ]);
  // A hand-added endpoint on the same base URL WINS: it carries the user's own
  // context windows and prices, and an auto-detected twin would replace those
  // with bare model ids. Compared by URL, not by id, because the user names
  // their endpoint whatever they like.
  const claimed = new Set(custom.map((e) => e.baseUrl.replace(/\/$/, "")));
  const live = runners.filter((r) => r.models.length && !claimed.has(r.runner.baseUrl.replace(/\/$/, "")));
  // Windows are resolved only for servers that actually answered, and again all
  // together — this still sits in front of every spawn. A resolver that throws
  // or times out yields {}, which is exactly the pre-2026-09-19 behaviour.
  const windowsOf = detectors.ollamaWindows ?? ((m: string[]) => resolveOllamaWindows(m));
  const runnerWindowsOf = detectors.runnerWindows ?? resolveRunnerWindows;
  const [ollamaWindows, ...runnerWindows] = await Promise.all([
    detected.models.length ? windowsOf(detected.models) : Promise.resolve({}),
    ...live.map((r) => runnerWindowsOf(r.runner, r.models)),
  ]);
  const endpoints: CustomEndpoint[] = [
    ...(detected.models.length ? [ollamaEndpoint(detected.models, ollamaWindows)] : []),
    ...live.map((r, i) => localRunnerEndpoint(r.runner, r.models, runnerWindows[i])),
    ...custom,
  ];
  const file = path.join(agentDir, "models.json");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const next = mergeModelsJson(existing, endpoints);
  if (next !== existing) {
    fs.mkdirSync(agentDir, { recursive: true });
    // Atomic: write a sibling then rename. A crash during a plain writeFileSync
    // leaves a TRUNCATED models.json, and mergeModelsJson rebuilds an unparseable
    // file from {} — which would silently discard the user's hand-written
    // providers on the next spawn. rename(2) is atomic within a filesystem, so a
    // reader sees either the old file or the new one, never a partial one.
    //
    // No lock is needed around the read-modify-write above: every writer is in
    // the main process and there is no await between the read and the write, so
    // two concurrent spawns cannot interleave inside it.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, file);
  }
  return detected;
}

/** Back-compat wrapper: Ollama only, no custom endpoints. */
export async function syncOllamaModels(agentDir: string): Promise<{ running: boolean; models: string[] }> {
  return syncModelsJson(agentDir, []);
}

/**
 * Probe an OpenAI-compatible endpoint for its model list. Never throws — the
 * UI shows the error string instead, so a typo'd URL is a message, not a crash.
 */
export async function fetchEndpointModels(
  baseUrl: string,
  key?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; models: string[]; error?: string; status?: number }> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    // `status` is reported alongside the message so callers can tell an auth
    // rejection from a server that is merely down — probeProviderKey needs that
    // distinction and parsing it back out of "HTTP 401" would be silly.
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, models: parseOpenAiModelList(await res.json()) };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Verdict on a key the user just entered. Deliberately three-valued: a key is
 * only ever condemned by the provider SAYING NO (401/403). A 404, a 500 or a
 * dead host means we could not tell — reporting that as a bad key would send
 * the user off to re-enter a key that is perfectly good.
 */
export type KeyProbe = { status: "ok" } | { status: "unverified" } | { status: "bad"; error: string };

/**
 * Check a key at save time against the provider's own `/models`, so a dead key
 * is an inline error at entry rather than a failed first turn. Free — it proves
 * AUTH, not balance (an insufficient-balance 402 only shows on a completion;
 * see the 0.50 post-mortem in CLAUDE.md), which is why "ok" is not a promise
 * that the next call succeeds.
 *
 * ponytail: not every provider serves /models — the anthropic-messages ones
 * generally do not. Those land on "unverified", which the UI states plainly.
 */
export async function probeProviderKey(
  id: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyProbe> {
  const baseUrl = PROVIDER_CATALOG.find((p) => p.id === id)?.baseUrl;
  if (!baseUrl) return { status: "unverified" };
  const res = await fetchEndpointModels(baseUrl, key, fetchImpl);
  if (res.ok) return { status: "ok" };
  if (res.status === 401 || res.status === 403) return { status: "bad", error: res.error ?? `HTTP ${res.status}` };
  return { status: "unverified" };
}

/** Providers present in Pi's auth.json (app-owned agent dir). Names only. */
export function authJsonProviders(agentDir: string): string[] {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8")));
  } catch {
    return [];
  }
}
