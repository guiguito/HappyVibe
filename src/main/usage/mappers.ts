/**
 * §39 — handler facts → params, as shipped ids or the literal `custom` (D9).
 * Pure; `ipc.ts` calls these at the handlers where each fact lives.
 */
import { OAUTH_CATALOG, PROVIDER_CATALOG, REGISTRY_MODELS } from "../providerCatalog.generated";
import type { UsageParams } from "./events";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

let known: ReadonlySet<string> | null = null;
/** Every provider id Pi's own registry ships: the one-key catalog (and each regional twin) plus the OAuth sign-ins. */
export function knownProviders(): ReadonlySet<string> {
  known ??= new Set([...PROVIDER_CATALOG.flatMap((p) => [p.id, ...p.providerIds]), ...OAUTH_CATALOG.map((p) => p.id)]);
  return known;
}

/**
 * A model id is sent only when Pi's own registry ships it for that provider
 * (`REGISTRY_MODELS`, generated and pinned by the catalog contract test), so a
 * hand-typed id never leaves; `/` → `:` for the guard's id shape. Anything
 * HappyVibe wrote into models.json — custom endpoints, local runners, Ollama — is `custom`.
 */
export function modelParams(provider: string, modelId: string, k: ReadonlySet<string> = knownProviders()): { provider: string; model: string } {
  if (!k.has(provider)) return { provider: "custom", model: "custom" };
  const shipped = Object.hasOwn(REGISTRY_MODELS, provider) && REGISTRY_MODELS[provider].includes(modelId);
  const m = modelId.replace(/\//g, ":");
  return { provider, model: shipped && ID.test(m) ? m : "custom" };
}

export function mcpParams(
  source: "catalog" | "plugin" | "manual",
  cfg: { command?: unknown; url?: unknown; headers?: unknown },
  catalog?: { id: string; auth: "oauth" | "key" | "none" },
): UsageParams {
  const transport = typeof cfg.url === "string" ? "http" : "stdio";
  const hasHeaders = !!cfg.headers && typeof cfg.headers === "object" && Object.keys(cfg.headers).length > 0;
  return { source, server: catalog?.id ?? "custom", transport, auth: catalog?.auth ?? (hasHeaders ? "key" : "none") };
}

export function scheduleParams(s: { repeat: { kind: string }; mode: string }, source: "page" | "agent"): UsageParams {
  return { recurrence: s.repeat.kind, access: s.mode === "readonly" ? "readonly" : "full", source };
}
