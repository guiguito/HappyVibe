import { describe, expect, test } from "vitest";
import {
  BYOK_PROVIDERS, buildProviderEnv, isByokProvider, keySource, mergeOllamaModelsJson,
} from "../src/main/providers";
import { PROVIDER_CATALOG } from "../src/main/providerCatalog.generated";

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
