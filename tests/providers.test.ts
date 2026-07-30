import { describe, expect, test } from "vitest";
import {
  BYOK_PROVIDERS, buildProviderEnv, isByokProvider, keySource, mergeOllamaModelsJson,
} from "../src/main/providers";

describe("curated provider env map (verified against pi-ai env-api-keys.js)", () => {
  test("exact env var names per provider", () => {
    expect(BYOK_PROVIDERS.deepseek.envVar).toBe("DEEPSEEK_API_KEY");
    expect(BYOK_PROVIDERS.anthropic.envVar).toBe("ANTHROPIC_API_KEY");
    expect(BYOK_PROVIDERS.openai.envVar).toBe("OPENAI_API_KEY");
    expect(BYOK_PROVIDERS.google.envVar).toBe("GEMINI_API_KEY");
    expect(BYOK_PROVIDERS.openrouter.envVar).toBe("OPENROUTER_API_KEY");
  });

  test("curated BYOK list stays curated — custom endpoints are a separate axis", () => {
    expect(Object.keys(BYOK_PROVIDERS).sort()).toEqual(
      ["anthropic", "deepseek", "google", "openai", "openrouter"],
    );
    // A custom endpoint id is NOT a BYOK provider (PRD §16, 2026-07-30).
    expect(isByokProvider("my-vllm")).toBe(false);
    expect(isByokProvider("mistral")).toBe(false);
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
