/**
 * §39 — handler facts → params, as shipped ids or the literal `custom` (D9).
 * Pure; `ipc.ts` calls these at the handlers where each fact lives.
 */
import { OAUTH_CATALOG, PROVIDER_CATALOG } from "../providerCatalog.generated";
import type { UsageParams } from "./events";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

let known: ReadonlySet<string> | null = null;
/** Every provider id Pi's own registry ships: the one-key catalog (and each regional twin) plus the OAuth sign-ins. */
export function knownProviders(): ReadonlySet<string> {
  known ??= new Set([...PROVIDER_CATALOG.flatMap((p) => [p.id, ...p.providerIds]), ...OAUTH_CATALOG.map((p) => p.id)]);
  return known;
}

/**
 * ponytail: a provider in the generated catalog only offers Pi-registry models,
 * so its model id is sent (shape-checked, `/` → `:`); anything HappyVibe wrote
 * into models.json — custom endpoints, local runners, Ollama — is `custom`.
 * Ceiling: a registry provider given a hand-typed model id sends that id if
 * it is id-shaped. Upgrade path: check against Pi's model list.
 */
export function modelParams(provider: string, modelId: string, k: ReadonlySet<string> = knownProviders()): { provider: string; model: string } {
  if (!k.has(provider)) return { provider: "custom", model: "custom" };
  const m = modelId.replace(/\//g, ":");
  return { provider, model: ID.test(m) ? m : "custom" };
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
