/**
 * Generates src/main/providerCatalog.generated.ts from Pi's OWN provider
 * registry (`@earendil-works/pi-ai`), so widening the BYOK list stops being a
 * hand-curated constant and a pin bump adds providers instead of drifting past
 * them. Run: npm run catalog:providers
 *
 * The registry is reached at the path pi-ai actually installs at — a NESTED
 * scoped dep of pi-coding-agent, not a top-level `pi-ai`. Same class of reach
 * as the two pi-subagents internals (see CLAUDE.md): a relative path into the
 * vendored tree, pinned by a contract test so the day it moves is loud.
 *
 * Nothing here is hand-listed except ONE id (github-copilot, see below).
 * Every other exclusion is DERIVED from what upstream declares, because a
 * hand-list is the thing that drifts:
 *
 *   1. no `auth.apiKey`            → nothing to ask the user for (openai-codex)
 *   2. zero models                 → a provider with no catalog (radius)
 *   3. more than one env var       → multi-field cloud, PRD-deferred
 *                                    (amazon-bedrock, cloudflare x2, google-vertex)
 *      ...except `anthropic`, which declares three env vars because it also
 *      accepts OAuth/auth tokens; it is one of the featured five and its key
 *      input has always meant ANTHROPIC_API_KEY.
 *   4. no resolvable base URL      → needs a resource/deployment URL we do not
 *                                    collect (azure-openai-responses)
 *
 * Providers that SHARE an env var collapse into one row (moonshotai +
 * moonshotai-cn both read MOONSHOT_API_KEY). This is not cosmetic: the row is
 * what `buildProviderEnv` writes and what `keySource` reads, so two rows over
 * one variable would make one key look like two and report a key for a
 * provider the user never configured. The row keeps every id it unlocks, so
 * Pi still offers both catalogs once the key is set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Where pi-ai really lives: nested under pi-coding-agent, scoped. */
const PI_AI_PROVIDERS = path.join(
  ROOT,
  "pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/all.js",
);

/**
 * The one hand-written exclusion, and it is a PRODUCT decision rather than a
 * shape: GitHub Copilot is an OAuth provider in HappyVibe (§ providers ladder,
 * `PLAN_PROVIDERS`). It does declare a `COPILOT_GITHUB_TOKEN` env var, but
 * asking a beginner for a GitHub token is exactly the rung the sign-in flow
 * exists to replace.
 */
const KEY_ROW_EXCLUDED = new Set(["github-copilot"]);

/**
 * OAuth flows upstream ships that HappyVibe deliberately does NOT surface.
 * Same discipline as the external-CLI sub-agents: derived set, explicit
 * refusal, pinned by the contract test — so a pin bump that adds a seventh
 * flow fails the test instead of quietly appearing in the sign-in list.
 */
const OAUTH_NOT_ENABLED: Record<string, string> = {
  // Empty by design: every OAuth flow upstream ships is currently offered.
  // Adding an entry here is how a flow gets withheld — with its reason — and
  // the contract test fails on any flow that is neither offered nor listed.
};

/** anthropic declares three env vars; its key input has always meant this one. */
const ENV_VAR_PIN: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY" };

interface Row {
  id: string;
  label: string;
  envVar: string;
  baseUrl: string | null;
  modelCount: number;
  /** Every provider id this one key unlocks, canonical id first. */
  providerIds: string[];
}

interface OAuthRow {
  id: string;
  label: string;
  /** Upstream's own button copy, e.g. "Sign in with SuperGrok or X Premium". */
  loginLabel?: string;
  isSubscription?: boolean;
}

/**
 * The env vars a provider reads, in upstream's own order. `resolve()` calls
 * `ctx.env(name)` once per candidate, so a recording ctx reads the list off
 * the real implementation rather than re-parsing a source file.
 */
async function envVarsOf(provider: {
  auth?: { apiKey?: { resolve?: (a: unknown) => Promise<unknown> } };
}): Promise<string[]> {
  const asked: string[] = [];
  const resolve = provider.auth?.apiKey?.resolve;
  if (!resolve) return asked;
  try {
    await resolve({
      ctx: {
        env: async (name: string) => {
          asked.push(name);
          return undefined;
        },
      },
      credential: undefined,
      signal: { throwIfAborted() {}, aborted: false },
    });
  } catch {
    // google-vertex reaches for ctx.fileExists (ambient ADC) — it is a
    // multi-var provider either way, so whatever it recorded is enough to
    // classify it. Never let one provider's probe abort the build.
  }
  return asked;
}

async function main(): Promise<void> {
  if (!fs.existsSync(PI_AI_PROVIDERS)) {
    console.error(
      `pi-ai registry not found at:\n  ${PI_AI_PROVIDERS}\n` +
        `Run \`(cd pi-runtime && npm ci)\` first — a fresh worktree has no pi-runtime/node_modules.`,
    );
    process.exit(1);
  }

  const { builtinProviders } = (await import(PI_AI_PROVIDERS)) as {
    builtinProviders: () => Array<Record<string, never>>;
  };
  const providers = builtinProviders() as unknown as Array<{
    id: string;
    name?: string;
    baseUrl?: string;
    auth?: { apiKey?: { resolve?: (a: unknown) => Promise<unknown> }; oauth?: { name?: string; loginLabel?: string; isSubscription?: boolean } };
    getModels?: () => unknown;
  }>;

  const rejected: Record<string, string[]> = {};
  const reject = (id: string, why: string): void => {
    (rejected[why] ??= []).push(id);
  };

  const candidates: Row[] = [];
  const oauth: OAuthRow[] = [];
  const refusedOAuth: string[] = [];

  for (const p of providers) {
    const modelsRaw = (await p.getModels?.()) as unknown;
    const models = (Array.isArray(modelsRaw) ? modelsRaw : Object.values(modelsRaw ?? {})) as Array<{
      baseUrl?: string;
    }>;
    const modelCount = models.length;

    // ── the sign-in list ────────────────────────────────────────────────
    if (p.auth?.oauth && modelCount > 0) {
      if (OAUTH_NOT_ENABLED[p.id]) refusedOAuth.push(p.id);
      else
        oauth.push({
          id: p.id,
          label: p.name ?? p.id,
          loginLabel: p.auth.oauth.loginLabel,
          isSubscription: p.auth.oauth.isSubscription,
        });
    }

    // ── the key list ───────────────────────────────────────────────────
    if (KEY_ROW_EXCLUDED.has(p.id)) {
      reject(p.id, "OAuth-only in HappyVibe (never ask for its token)");
      continue;
    }
    if (!p.auth?.apiKey) {
      reject(p.id, "declares no API-key auth");
      continue;
    }
    if (modelCount === 0) {
      reject(p.id, "ships no model catalog");
      continue;
    }

    const envVars = await envVarsOf(p);
    const pinned = ENV_VAR_PIN[p.id];
    if (!pinned && envVars.length !== 1) {
      reject(p.id, `needs ${envVars.length} env vars (multi-field cloud — PRD-deferred)`);
      continue;
    }
    const envVar = pinned ?? envVars[0];
    if (!envVar) {
      reject(p.id, "declares no env var");
      continue;
    }

    // Provider-level URL, else whatever its models agree on. Used only for the
    // save-time key probe; null just means "couldn't verify", never a blocker.
    const modelUrls = models.map((m) => m.baseUrl).filter((u): u is string => !!u);
    const baseUrl = p.baseUrl ?? modelUrls[0] ?? null;
    if (!baseUrl) {
      reject(p.id, "has no base URL (needs a resource/deployment URL we do not collect)");
      continue;
    }
    // A URL still carrying {placeholders} is not a URL we can call.
    if (/\{[^}]+\}/.test(baseUrl)) {
      reject(p.id, "base URL needs account/region substitution (multi-field — PRD-deferred)");
      continue;
    }

    candidates.push({ id: p.id, label: p.name ?? p.id, envVar, baseUrl, modelCount, providerIds: [p.id] });
  }

  // ── collapse rows sharing one env var ────────────────────────────────
  const byEnvVar = new Map<string, Row[]>();
  for (const r of candidates) {
    const g = byEnvVar.get(r.envVar);
    if (g) g.push(r);
    else byEnvVar.set(r.envVar, [r]);
  }
  const rows: Row[] = [];
  for (const group of byEnvVar.values()) {
    // Canonical = shortest id, then alphabetical — deterministic, and it picks
    // the plain brand ("moonshotai") over its variant ("moonshotai-cn").
    const sorted = [...group].sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    const head = sorted[0]!;
    rows.push({
      ...head,
      modelCount: sorted.reduce((n, r) => n + r.modelCount, 0),
      providerIds: sorted.map((r) => r.id),
    });
    if (sorted.length > 1) {
      console.log(`  collapsed ${sorted.map((r) => r.id).join(" + ")} → ${head.id} (one ${head.envVar})`);
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  oauth.sort((a, b) => a.id.localeCompare(b.id));

  const out = `/**
 * GENERATED by tools/provider-catalog/build.ts — do not edit by hand.
 *   npm run catalog:providers
 *
 * Pi's provider registry, reduced to what HappyVibe can actually offer as a
 * one-key setup. Every exclusion is derived from what upstream declares (see
 * the generator header); tests/provider-catalog.test.ts re-derives this file
 * from the vendored pi-ai and fails when a pin bump changes it, so a new
 * provider arrives as a red test rather than as silent drift.
 *
 * \`providerIds\` is every Pi provider id one key unlocks — several brands ship
 * a regional twin behind the same variable.
 */

export interface CatalogProvider {
  /** Canonical Pi provider id — also the config key a stored key is filed under. */
  id: string;
  /** Upstream's own display name. */
  label: string;
  envVar: string;
  /** For the save-time key probe. null ⇒ probe skipped ("couldn't verify"). */
  baseUrl: string | null;
  modelCount: number;
  providerIds: readonly string[];
}

export interface CatalogOAuthProvider {
  id: string;
  label: string;
  /** Upstream's own button copy. */
  loginLabel?: string;
  isSubscription?: boolean;
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = ${JSON.stringify(rows, null, 2)};

/**
 * OAuth flows upstream ships. HappyVibe surfaces these; anything upstream adds
 * beyond them fails the contract test rather than appearing unreviewed.
 */
export const OAUTH_CATALOG: readonly CatalogOAuthProvider[] = ${JSON.stringify(oauth, null, 2)};

/** Upstream OAuth flows deliberately NOT surfaced, with the reason. */
export const OAUTH_NOT_ENABLED: Readonly<Record<string, string>> = ${JSON.stringify(OAUTH_NOT_ENABLED, null, 2)};

/** The cards that stay above the "More providers…" search. */
export const FEATURED_PROVIDER_IDS = ["deepseek", "anthropic", "openai", "google", "openrouter"] as const;
`;

  const dest = path.join(ROOT, "src/main/providerCatalog.generated.ts");
  fs.writeFileSync(dest, out);

  console.log(`\n${rows.length} key providers, ${oauth.length} OAuth providers → ${path.relative(ROOT, dest)}`);
  console.log(`total models offered: ${rows.reduce((n, r) => n + r.modelCount, 0)}`);
  if (refusedOAuth.length) console.log(`OAuth refused (product decision): ${refusedOAuth.join(", ")}`);
  console.log(`\nrejected (${Object.values(rejected).flat().length}):`);
  for (const [why, ids] of Object.entries(rejected)) console.log(`  ${ids.join(", ")} — ${why}`);
}

await main();
