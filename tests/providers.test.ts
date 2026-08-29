import { describe, expect, test } from "vitest";
import {
  BYOK_PROVIDERS, buildProviderEnv, isByokProvider, keySource, detectLocalRunner, localRunnerEndpoint, LOCAL_RUNNERS, mergeOllamaModelsJson, OAUTH_PROVIDERS, probeProviderKey, syncModelsJson,
} from "../src/main/providers";
import { PROVIDER_CATALOG } from "../src/main/providerCatalog.generated";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CustomEndpoint as HvEndpointLike } from "../src/main/modelsJson";

describe("provider env map (generated from Pi's registry, 2026-08-29)", () => {
  test("exact env var names for the featured five", () => {
    expect(BYOK_PROVIDERS.deepseek.envVar).toBe("DEEPSEEK_API_KEY");
    expect(BYOK_PROVIDERS.anthropic.envVar).toBe("ANTHROPIC_API_KEY");
    expect(BYOK_PROVIDERS.openai.envVar).toBe("OPENAI_API_KEY");
    expect(BYOK_PROVIDERS.google.envVar).toBe("GEMINI_API_KEY");
    expect(BYOK_PROVIDERS.openrouter.envVar).toBe("OPENROUTER_API_KEY");
  });

  test("the list is the generated catalog, not a hand-curated five", () => {
    expect(Object.keys(BYOK_PROVIDERS).sort()).toEqual(PROVIDER_CATALOG.map((p) => p.id).sort());
    // The round-1 fence is relaxed: a provider Pi supports with one key is offered.
    expect(isByokProvider("mistral")).toBe(true);
    expect(isByokProvider("groq")).toBe(true);
    // A custom endpoint id is still NOT a BYOK provider (PRD §16, 2026-07-30) —
    // custom endpoints remain a separate axis.
    expect(isByokProvider("my-vllm")).toBe(false);
    // PRD-deferred multi-field cloud stays off this axis too.
    expect(isByokProvider("amazon-bedrock")).toBe(false);
    expect(isByokProvider("azure-openai-responses")).toBe(false);
  });
});

describe("catalog-wide keys (the widened axis)", () => {
  test("a non-featured provider's stored key becomes its env var", () => {
    const groq = PROVIDER_CATALOG.find((p) => p.id === "groq")!;
    expect(buildProviderEnv({ groq: "gsk_real" }, {})[groq.envVar]).toBe("gsk_real");
  });

  test("sk-REPLACE neutralisation covers EVERY catalog env var", () => {
    // The non-live-suite guarantee (CLAUDE.md): npm test sets sk-REPLACE for the
    // live providers, and the resolver must treat that as ABSENT. Widening the
    // catalog must not leave a provider where the placeholder leaks through as
    // a real key — that is how npm test would silently stop being key-free.
    for (const p of PROVIDER_CATALOG) {
      expect(buildProviderEnv({}, { [p.envVar]: "sk-REPLACE-me" })[p.envVar], p.id).toBeUndefined();
      expect(keySource(p.id, {}, { [p.envVar]: "sk-REPLACE-me" }), p.id).toBe(null);
    }
  });

  test("keySource reads env over stored for any catalog provider", () => {
    const groq = PROVIDER_CATALOG.find((p) => p.id === "groq")!;
    expect(keySource("groq", { groq: "stored" }, { [groq.envVar]: "gsk_env" })).toBe("env");
    expect(keySource("groq", { groq: "stored" }, {})).toBe("stored");
    expect(keySource("groq", {}, {})).toBe(null);
  });

  test("one key can unlock several Pi provider ids", () => {
    // moonshotai + moonshotai-cn share MOONSHOT_API_KEY. One row, one write.
    const row = PROVIDER_CATALOG.find((p) => p.id === "moonshotai")!;
    expect(row.providerIds.length).toBeGreaterThan(1);
    expect(Object.keys(buildProviderEnv({ moonshotai: "k" }, {}))).toEqual([row.envVar]);
  });
});

describe("buildProviderEnv", () => {
  test("stored keys become the right env vars", () => {
    expect(buildProviderEnv({ deepseek: "sk-d", google: "g-key" }, {})).toEqual({
      DEEPSEEK_API_KEY: "sk-d",
      GEMINI_API_KEY: "g-key",
    });
  });

  test(".env dev convenience wins over stored key", () => {
    const env = { DEEPSEEK_API_KEY: "sk-env" };
    expect(buildProviderEnv({ deepseek: "sk-stored" }, env).DEEPSEEK_API_KEY).toBe("sk-env");
    expect(keySource("deepseek", { deepseek: "sk-stored" }, env)).toBe("env");
  });

  test("sk-REPLACE placeholder env values are ignored", () => {
    const env = { DEEPSEEK_API_KEY: "sk-REPLACE_ME" };
    expect(buildProviderEnv({ deepseek: "sk-stored" }, env).DEEPSEEK_API_KEY).toBe("sk-stored");
    expect(keySource("deepseek", {}, env)).toBe(null);
  });

  test("unconfigured providers are absent (no empty env vars)", () => {
    expect(buildProviderEnv({}, {})).toEqual({});
  });
});

describe("mergeOllamaModelsJson", () => {
  test("creates a Pi models.json ollama provider entry", () => {
    const out = JSON.parse(mergeOllamaModelsJson(null, ["llama3.1:8b", "qwen2.5-coder:7b"]));
    const ollama = out.providers.ollama;
    expect(ollama.baseUrl).toBe("http://localhost:11434/v1");
    expect(ollama.api).toBe("openai-completions");
    expect(ollama.apiKey).toBe("ollama"); // placeholder so models pass Pi's auth gate
    expect(ollama.models).toEqual([{ id: "llama3.1:8b" }, { id: "qwen2.5-coder:7b" }]);
  });

  test("preserves other providers, replaces stale ollama models", () => {
    const existing = JSON.stringify({
      providers: {
        vllm: { baseUrl: "http://x:8000/v1", api: "openai-completions", models: [{ id: "m" }] },
        ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "old" }] },
      },
    });
    const out = JSON.parse(mergeOllamaModelsJson(existing, ["new-model"]));
    expect(out.providers.vllm.models).toEqual([{ id: "m" }]);
    expect(out.providers.ollama.models).toEqual([{ id: "new-model" }]);
  });

  test("removes the ollama entry when no models detected", () => {
    const existing = mergeOllamaModelsJson(null, ["m"]);
    const out = JSON.parse(mergeOllamaModelsJson(existing, []));
    expect(out.providers.ollama).toBeUndefined();
  });
});

describe("OAuth sign-in list (2026-08-29 round)", () => {
  test("one source of truth, five providers, our labels", () => {
    expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(
      ["anthropic", "github-copilot", "openai-codex", "openrouter", "xai"],
    );
    const by = new Map(OAUTH_PROVIDERS.map((p) => [p.id, p]));
    // The app names the SUBSCRIPTION, not the vendor — upstream says
    // "Anthropic" / "OpenAI Codex" and these overrides are deliberate.
    expect(by.get("anthropic")!.label).toBe("Claude");
    expect(by.get("openai-codex")!.label).toBe("ChatGPT (Codex)");
    // A provider with no override keeps upstream's own name.
    expect(by.get("openrouter")!.label).toBe("OpenRouter");
    expect(by.get("xai")!.label).toBe("xAI");
  });

  test("the Claude extra-usage caveat survives the move off the renderer", () => {
    const claude = OAUTH_PROVIDERS.find((p) => p.id === "anthropic")!;
    expect(claude.caveat).toMatch(/extra usage/);
    // It is Claude-specific: no other provider claims a billing caveat it lacks.
    for (const p of OAUTH_PROVIDERS.filter((p) => p.id !== "anthropic")) {
      expect(p.caveat, p.id).toBeUndefined();
    }
  });

  test("ModelsView renders the list main sends, never one of its own", () => {
    // The list lived in TWO places (providers.ts and ModelsView.tsx) and adding
    // a provider to one silently left the other behind. Renderer suite has no
    // DOM, so the absence is asserted as a source scan (modal-layer pattern).
    const src = readFileSync("src/renderer/src/components/ModelsView.tsx", "utf8");
    expect(src, "ModelsView must not declare its own OAuth list").not.toMatch(/const OAUTH_PROVIDERS/);
    // Nor may it name the providers itself — a hardcoded id list is the same
    // defect wearing a different variable name.
    expect(src).not.toMatch(/"github-copilot"/);
    expect(src).not.toMatch(/"openai-codex"/);
    // It renders what getProviders() sent.
    expect(src).toMatch(/setOauthProviders\(p\.oauth\)/);
  });
});

describe("probeProviderKey (save-time key check, 2026-08-29)", () => {
  const res = (status: number, body: unknown = { data: [] }): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  test("200 from /models ⇒ ok, and it asks the provider's own base URL", async () => {
    let seen: { url?: string; auth?: string } = {};
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: (init?.headers as Record<string, string>)?.Authorization };
      return res(200);
    }) as unknown as typeof fetch;
    expect(await probeProviderKey("groq", "gsk_good", fake)).toEqual({ status: "ok" });
    expect(seen.url).toBe("https://api.groq.com/openai/v1/models");
    expect(seen.auth).toBe("Bearer gsk_good");
  });

  test("401 and 403 ⇒ bad — the only verdicts that condemn a key", async () => {
    for (const code of [401, 403]) {
      const fake = (async () => res(code)) as unknown as typeof fetch;
      const out = await probeProviderKey("groq", "gsk_bad", fake);
      expect(out.status).toBe("bad");
      expect(out.status === "bad" && out.error).toMatch(String(code));
    }
  });

  test("a 500, a 404 or a dead host ⇒ unverified, never bad", async () => {
    // A provider that does not implement /models, or is simply down, must not
    // be reported as a rejected key — that would tell the user to re-enter a
    // key that is perfectly good.
    for (const code of [404, 429, 500]) {
      const fake = (async () => res(code)) as unknown as typeof fetch;
      expect((await probeProviderKey("groq", "k", fake)).status).toBe("unverified");
    }
    const boom = (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;
    expect((await probeProviderKey("groq", "k", boom)).status).toBe("unverified");
  });

  test("a provider with no base URL ⇒ unverified, and never calls out", async () => {
    let called = false;
    const fake = (async () => { called = true; return res(200); }) as unknown as typeof fetch;
    // Synthesised: every shipped row has a base URL, so assert the branch directly.
    expect((await probeProviderKey("not-a-provider", "k", fake)).status).toBe("unverified");
    expect(called).toBe(false);
  });

  test("every catalog row can be probed or is honestly unverifiable", () => {
    // The probe is only meaningful where a base URL exists; the UI says
    // "couldn't verify" for the rest rather than implying a check happened.
    for (const p of PROVIDER_CATALOG) {
      expect(p.baseUrl === null || p.baseUrl.startsWith("https://"), p.id).toBe(true);
    }
  });
});

describe("local runner auto-detect (2026-08-29 round)", () => {
  const withModels = (ids: string[]): typeof fetch =>
    (async () => ({ ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) })) as unknown as typeof fetch;
  const dead: typeof fetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

  test("the runners are the two ports beside Ollama's", () => {
    expect(LOCAL_RUNNERS.map((r) => r.id)).toEqual(["lmstudio", "llamacpp"]);
    const by = new Map(LOCAL_RUNNERS.map((r) => [r.id, r]));
    expect(by.get("lmstudio")!.baseUrl).toBe("http://localhost:1234/v1");
    expect(by.get("llamacpp")!.baseUrl).toBe("http://localhost:8080/v1");
    // Presets carry the compat flags — never re-derived here (PRD 2026-07-30).
    expect(by.get("lmstudio")!.preset).toBe("lmstudio");
    expect(by.get("llamacpp")!.preset).toBe("llamacpp");
  });

  test("a running LM Studio becomes an endpoint on the shared custom path", async () => {
    const out = await detectLocalRunner(LOCAL_RUNNERS[0]!, withModels(["qwen3-coder"]));
    expect(out.running).toBe(true);
    expect(out.models).toEqual(["qwen3-coder"]);
  });

  test("nothing listening ⇒ not running, and never throws", async () => {
    await expect(detectLocalRunner(LOCAL_RUNNERS[0]!, dead)).resolves.toEqual({ running: false, models: [] });
  });

  test("a runner serving zero models is not offered", async () => {
    // An LM Studio with no model loaded answers 200 with an empty list. Writing
    // an endpoint with no models would put an empty provider in the picker.
    expect((await detectLocalRunner(LOCAL_RUNNERS[0]!, withModels([]))).models).toEqual([]);
  });

  test("the endpoint is namespaced like every other custom endpoint", () => {
    // Ollama's bare "ollama" key is a documented HISTORICAL exception (users'
    // sessions are pinned to it); a NEW local runner must not copy it.
    const e = localRunnerEndpoint(LOCAL_RUNNERS[0]!, ["m"]);
    expect(e.providerKey).toBe("hv-lmstudio");
    expect(e.baseUrl).toBe("http://localhost:1234/v1");
    expect(e.models).toEqual([{ id: "m" }]);
  });
});

describe("syncModelsJson with local runners", () => {
  const tmp = (): string => mkdtempSync(path.join(tmpdir(), "hv-sync-"));

  test("a detected runner is written, and a hand-added endpoint on the same URL wins", async () => {
    // The user's own endpoint carries their context windows and prices; an
    // auto-detected twin would overwrite that with bare model ids.
    const dir = tmp();
    const mine: HvEndpointLike = {
      id: "my-lmstudio", providerKey: "hv-my-lmstudio", label: "My LM Studio",
      baseUrl: "http://localhost:1234/v1", preset: "lmstudio",
      auth: { kind: "placeholder", value: "x" }, models: [{ id: "kept", contextWindow: 40000 }],
    };
    await syncModelsJson(dir, [mine], {
      ollama: async () => ({ running: false, models: [] }),
      runner: async (r) => ({ running: true, models: [`${r.id}-model`] }),
    });
    const out = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8"));
    // llama.cpp had no hand-added twin, so it is offered.
    expect(out.providers["hv-llamacpp"].models).toEqual([{ id: "llamacpp-model" }]);
    // LM Studio did — the user's entry is the only one on that URL.
    expect(out.providers["hv-lmstudio"]).toBeUndefined();
    expect(out.providers["hv-my-lmstudio"].models[0].contextWindow).toBe(40000);
  });

  test("nothing running locally ⇒ no runner entries at all", async () => {
    const dir = tmp();
    await syncModelsJson(dir, [], {
      ollama: async () => ({ running: false, models: [] }),
      runner: async () => ({ running: false, models: [] }),
    });
    const out = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8"));
    expect(Object.keys(out.providers ?? {})).toEqual([]);
  });
});
