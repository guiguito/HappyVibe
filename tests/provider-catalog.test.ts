import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import {
  FEATURED_PROVIDER_IDS,
  OAUTH_CATALOG,
  OAUTH_NOT_ENABLED,
  PROVIDER_CATALOG,
} from "../src/main/providerCatalog.generated";

/**
 * Pin-bump gate for the generated provider catalog (key-free).
 *
 * This does NOT re-read the committed file and agree with itself — it re-derives
 * the answer from the vendored pi-ai registry and asserts the committed data
 * still matches. A Pi pin bump that adds, removes or re-shapes a provider
 * therefore fails HERE, loudly, instead of silently drifting past the app.
 *
 * Skips itself when pi-runtime/node_modules is absent (fresh clone, CI without
 * the runtime install) rather than failing for a reason that is not a defect.
 */
const PI_AI_PROVIDERS = path.resolve(
  __dirname,
  "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/all.js",
);
const HAVE_RUNTIME = fs.existsSync(PI_AI_PROVIDERS);

interface UpstreamProvider {
  id: string;
  name?: string;
  baseUrl?: string;
  auth?: {
    apiKey?: { resolve?: (a: unknown) => Promise<unknown> };
    oauth?: { loginLabel?: string; isSubscription?: boolean };
  };
  getModels?: () => unknown;
}

async function upstream(): Promise<UpstreamProvider[]> {
  const mod = (await import(PI_AI_PROVIDERS)) as { builtinProviders: () => UpstreamProvider[] };
  return mod.builtinProviders();
}

/** Upstream's own env-var list, read by recording the calls `resolve` makes. */
async function envVarsOf(p: UpstreamProvider): Promise<string[]> {
  const asked: string[] = [];
  if (!p.auth?.apiKey?.resolve) return asked;
  try {
    await p.auth.apiKey.resolve({
      ctx: { env: async (n: string) => void asked.push(n) },
      credential: undefined,
      signal: { throwIfAborted() {}, aborted: false },
    });
  } catch {
    /* google-vertex reaches for an ambient-credentials helper; what it recorded is enough. */
  }
  return asked;
}

function modelsOf(p: UpstreamProvider): unknown[] {
  const raw = p.getModels?.() as unknown;
  return Array.isArray(raw) ? raw : Object.values(raw ?? {});
}

describe.skipIf(!HAVE_RUNTIME)("generated provider catalog (Pi pin-bump gate)", () => {
  test("the registry is reachable at the path the generator uses", async () => {
    // The reach itself is the contract: pi-ai is a NESTED scoped dep of
    // pi-coding-agent, not a top-level `pi-ai`. If a bump moves it, the
    // generator silently produces nothing — so assert the path, not just the data.
    expect(HAVE_RUNTIME).toBe(true);
    expect((await upstream()).length).toBeGreaterThan(30);
  });

  test("every catalog row's env var is the one upstream actually reads", async () => {
    const byId = new Map((await upstream()).map((p) => [p.id, p]));
    for (const row of PROVIDER_CATALOG) {
      const p = byId.get(row.id);
      expect(p, `catalog lists "${row.id}" but pi-ai no longer ships it`).toBeDefined();
      const vars = await envVarsOf(p!);
      expect(vars, `${row.id} env vars`).toContain(row.envVar);
      // Multi-var providers are excluded by the generator; anthropic is the one
      // pinned exception (it also accepts OAuth/auth tokens).
      if (row.id !== "anthropic") expect(vars, `${row.id} should be single-key`).toHaveLength(1);
    }
  });

  test("every row's provider ids share that one env var", async () => {
    const byId = new Map((await upstream()).map((p) => [p.id, p]));
    for (const row of PROVIDER_CATALOG) {
      for (const id of row.providerIds) {
        const p = byId.get(id);
        expect(p, `${row.id} claims to unlock "${id}"`).toBeDefined();
        if (id === "anthropic") continue;
        expect(await envVarsOf(p!), `${id} (unlocked by ${row.id})`).toEqual([row.envVar]);
      }
    }
  });

  test("no env var is claimed by two rows", () => {
    // Two rows over one variable would make one key look like two and report a
    // key for a provider the user never configured.
    const seen = new Set<string>();
    for (const row of PROVIDER_CATALOG) {
      expect(seen.has(row.envVar), `${row.envVar} claimed twice`).toBe(false);
      seen.add(row.envVar);
    }
  });

  test("every single-key provider upstream ships is cataloged, or excluded for a derived reason", async () => {
    const cataloged = new Set(PROVIDER_CATALOG.flatMap((r) => r.providerIds));
    for (const p of await upstream()) {
      if (cataloged.has(p.id)) continue;
      const vars = await envVarsOf(p);
      const models = modelsOf(p);
      const baseUrl = p.baseUrl ?? (models[0] as { baseUrl?: string } | undefined)?.baseUrl ?? null;
      const derivedReason =
        !p.auth?.apiKey ||
        models.length === 0 ||
        vars.length !== 1 ||
        !baseUrl ||
        /\{[^}]+\}/.test(baseUrl) ||
        p.id === "github-copilot"; // the one product exclusion (OAuth-only here)
      expect(
        derivedReason,
        `pi-ai provider "${p.id}" is single-key with a usable base URL but is not in the catalog — ` +
          `a pin bump added a provider the app is silently not offering. Re-run: npm run catalog:providers`,
      ).toBe(true);
    }
  });

  test("model counts and labels still match upstream", async () => {
    const byId = new Map((await upstream()).map((p) => [p.id, p]));
    for (const row of PROVIDER_CATALOG) {
      const total = row.providerIds.reduce((n, id) => n + modelsOf(byId.get(id)!).length, 0);
      expect(total, `${row.id} model count`).toBe(row.modelCount);
      expect(byId.get(row.id)!.name ?? row.id, `${row.id} label`).toBe(row.label);
    }
  });

  test("the OAuth catalog is exactly upstream's flows minus the ones we refuse", async () => {
    const shipped = (await upstream())
      .filter((p) => p.auth?.oauth && modelsOf(p).length > 0)
      .map((p) => p.id)
      .sort();
    const offered = OAUTH_CATALOG.map((p) => p.id).sort();
    const refused = Object.keys(OAUTH_NOT_ENABLED).sort();
    expect(
      [...offered, ...refused].sort(),
      "pi-ai ships an OAuth flow HappyVibe neither offers nor names as refused — " +
        "enabling one is a product decision, not a pin side effect",
    ).toEqual(shipped);
    expect(offered).toEqual(["anthropic", "github-copilot", "openai-codex", "openrouter", "xai"]);
  });

  test("the multi-field cloud providers stay out (PRD-deferred)", () => {
    const ids = PROVIDER_CATALOG.flatMap((r) => r.providerIds);
    for (const id of ["amazon-bedrock", "google-vertex", "azure-openai-responses", "cloudflare-ai-gateway", "cloudflare-workers-ai", "radius"]) {
      expect(ids, `${id} must not be offered as a one-key provider`).not.toContain(id);
    }
  });

  test("the featured five exist, keep their env vars, and lead the list", () => {
    const by = new Map(PROVIDER_CATALOG.map((r) => [r.id, r]));
    expect([...FEATURED_PROVIDER_IDS]).toEqual(["deepseek", "anthropic", "openai", "google", "openrouter"]);
    for (const id of FEATURED_PROVIDER_IDS) expect(by.get(id), `featured "${id}" missing`).toBeDefined();
    // The exact strings the app shipped before the catalog existed.
    expect(by.get("google")!.envVar).toBe("GEMINI_API_KEY");
    expect(by.get("deepseek")!.envVar).toBe("DEEPSEEK_API_KEY");
    expect(by.get("anthropic")!.envVar).toBe("ANTHROPIC_API_KEY");
    expect(by.get("openai")!.envVar).toBe("OPENAI_API_KEY");
    expect(by.get("openrouter")!.envVar).toBe("OPENROUTER_API_KEY");
  });

  test("a base URL is absolute and placeholder-free, or null", () => {
    for (const row of PROVIDER_CATALOG) {
      if (row.baseUrl === null) continue;
      expect(row.baseUrl, `${row.id}`).toMatch(/^https:\/\//);
      expect(row.baseUrl, `${row.id} carries an unsubstituted placeholder`).not.toMatch(/\{[^}]+\}/);
    }
  });
});
