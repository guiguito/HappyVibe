import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { syncModelsJson } from "../src/main/providers";
import {
  customEndpointEnv, envVarFor, escapePiValue, endpointEntry, isValidEndpointId, mergeModelsJson,
  parseOpenAiModelList, PRESET_COMPAT, providerKeyFor, validateEndpoint,
  type CustomEndpoint,
} from "../src/main/modelsJson";

const vllm: CustomEndpoint = {
  id: "my-vllm", providerKey: "hv-my-vllm", label: "My vLLM", baseUrl: "http://gpu.lan:8000/v1",
  preset: "vllm", auth: { kind: "env" },
  models: [{ id: "qwen2.5-coder-32b", contextWindow: 32768 }],
};

describe("PRESET_COMPAT.other — an UNKNOWN endpoint must not be treated as real OpenAI", () => {
  /**
   * Live failure (2026-07-30): an NVIDIA Cloud endpoint
   * (https://integrate.api.nvidia.com/v1) saved with preset "other" returned
   * "400 status code (no body)" on every turn.
   *
   * Pi's detectCompat (pi-ai/dist/providers/openai-completions.js:861) matches an
   * ALLOWLIST of known hosts; anything unrecognised is assumed to be genuine
   * OpenAI, so it sends `store`, the `developer` role, `reasoning_effort` and
   * `max_completion_tokens`. An empty compat opts into all of it.
   */
  test("disables the OpenAI-only request fields", () => {
    expect(PRESET_COMPAT.other).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    });
  });

  test("every preset pins the two flags Pi's own non-OpenAI providers override", () => {
    // models.generated.js sets supportsDeveloperRole:false on every non-OpenAI
    // provider it ships — a preset that leaves it unset inherits `true`.
    for (const [name, compat] of Object.entries(PRESET_COMPAT)) {
      expect(compat.supportsDeveloperRole, `${name} must pin supportsDeveloperRole`).toBe(false);
    }
  });
});

describe("providerKeyFor — custom keys are namespaced away from Pi's built-ins", () => {
  test("prefixes with hv-", () => {
    expect(providerKeyFor("my-vllm")).toBe("hv-my-vllm");
  });

  test("an endpoint labelled after a Pi built-in cannot hijack it", () => {
    // Unprefixed, id "groq" would rewrite every built-in Groq model's baseUrl
    // and apiKey via models.json provider overrides.
    for (const builtin of ["groq", "together", "mistral", "github-copilot", "openai", "ollama"]) {
      expect(providerKeyFor(builtin)).not.toBe(builtin);
    }
  });

  test("a hand-written provider of the same name is left alone on write AND on remove", () => {
    const existing = JSON.stringify({ providers: { together: { baseUrl: "http://mine/v1" } } });
    const hijacker: CustomEndpoint = { ...vllm, id: "together", providerKey: providerKeyFor("together") };
    const saved = mergeModelsJson(existing, [hijacker]);
    expect(JSON.parse(saved).providers.together).toEqual({ baseUrl: "http://mine/v1" });
    // ...and removing ours must not take theirs with it
    const removed = JSON.parse(mergeModelsJson(saved, []));
    expect(removed.providers.together).toEqual({ baseUrl: "http://mine/v1" });
    expect(removed.providers["hv-together"]).toBeUndefined();
  });
});

describe("validateEndpoint", () => {
  test("accepts a well-formed endpoint", () => {
    expect(validateEndpoint(vllm, [])).toBeNull();
  });

  test("rejects a duplicate id — it would inherit the existing endpoint's key", () => {
    expect(validateEndpoint(vllm, ["my-vllm"])).toMatch(/already exists/);
  });

  test("rejects contextWindow 0 — Pi deletes the whole provider, not just the model", () => {
    // Reachable from the UI: clear the number field, then Save. Number("") === 0.
    const zero: CustomEndpoint = { ...vllm, models: [{ id: "m", contextWindow: 0 }] };
    expect(validateEndpoint(zero, [])).toMatch(/at least 1/);
    const nan: CustomEndpoint = { ...vllm, models: [{ id: "m", contextWindow: Number.NaN }] };
    expect(validateEndpoint(nan, [])).toMatch(/at least 1/);
  });

  test("rejects a non-http base URL, a bad id, and an empty model list", () => {
    expect(validateEndpoint({ ...vllm, baseUrl: "file:///etc/passwd" }, [])).toMatch(/http/);
    expect(validateEndpoint({ ...vllm, id: "a--b" }, [])).toMatch(/Invalid name/);
    expect(validateEndpoint({ ...vllm, models: [] }, [])).toMatch(/at least one model/);
  });
});

describe("escapePiValue — Pi executes '!' values and interpolates '$'", () => {
  test("a leading ! is neutralised with the $! escape", () => {
    expect(escapePiValue("!rm -rf ~")).toBe("$!rm -rf ~");
  });
  test("every $ is doubled so no env interpolation happens", () => {
    expect(escapePiValue("sk-a$B")).toBe("sk-a$$B");
  });
  test("both at once", () => {
    expect(escapePiValue("!a$b")).toBe("$!a$$b");
  });
  test("an ordinary key is untouched", () => {
    expect(escapePiValue("sk-abc123")).toBe("sk-abc123");
  });
});

describe("envVarFor", () => {
  test("slug becomes an upper-snake env var stem", () => {
    expect(envVarFor("my-vllm")).toBe("HV_CUSTOM_MY_VLLM_KEY");
    expect(envVarFor("lm.studio 1")).toBe("HV_CUSTOM_LM_STUDIO_1_KEY");
  });
});

describe("isValidEndpointId — the id→env-var mapping must be injective", () => {
  test("accepts single-hyphen slugs", () => {
    expect(isValidEndpointId("my-vllm")).toBe(true);
    expect(isValidEndpointId("vllm2")).toBe(true);
    expect(isValidEndpointId("a")).toBe(true);
  });

  test("rejects consecutive hyphens — they would COLLIDE on one env var", () => {
    // envVarFor collapses runs of non-alphanumerics, so both of these become
    // HV_CUSTOM_A_B_KEY. Two endpoints sharing an env var means one gets sent
    // the other's API key.
    expect(envVarFor("a-b")).toBe(envVarFor("a--b")); // the hazard, pinned
    expect(isValidEndpointId("a-b")).toBe(true);
    expect(isValidEndpointId("a--b")).toBe(false); // ...so this must be refused
  });

  test("rejects leading/trailing hyphens, empties, uppercase, and over-long ids", () => {
    expect(isValidEndpointId("-a")).toBe(false);
    expect(isValidEndpointId("a-")).toBe(false);
    expect(isValidEndpointId("")).toBe(false);
    expect(isValidEndpointId("My-VLLM")).toBe(false);
    expect(isValidEndpointId("a".repeat(33))).toBe(false);
    expect(isValidEndpointId("a b")).toBe(false);
    expect(isValidEndpointId("a_b")).toBe(false);
  });
});

describe("endpointEntry", () => {
  test("env-auth endpoints reference the env var, never the secret", () => {
    const e = endpointEntry(vllm);
    expect(e.apiKey).toBe("$HV_CUSTOM_MY_VLLM_KEY");
    expect(e.api).toBe("openai-completions");
    expect(e.baseUrl).toBe("http://gpu.lan:8000/v1");
    expect(e.compat).toEqual(PRESET_COMPAT.vllm);
    expect(e.models).toEqual([{ id: "qwen2.5-coder-32b", contextWindow: 32768 }]);
  });

  test("placeholder auth is escaped, not interpolated", () => {
    const e = endpointEntry({ ...vllm, auth: { kind: "placeholder", value: "!oops" } });
    expect(e.apiKey).toBe("$!oops");
  });

  test("contextWindow is omitted when unset (Ollama's shape must not change)", () => {
    const e = endpointEntry({ ...vllm, models: [{ id: "m" }] });
    expect(e.models).toEqual([{ id: "m" }]);
  });

  /**
   * Cost defect (2026-07-30): a custom endpoint reported $0.00 for every call,
   * always. endpointEntry wrote only {id, contextWindow}, so Pi's
   * provider-composer.js:68 defaulted `cost` to all-zero rates. Observed live:
   * hv-nvidia-cloud burned 60,023 input tokens for a reported $0.0000.
   */
  describe("per-Mtok prices", () => {
    const priced = (over: Record<string, unknown>): Record<string, unknown> =>
      endpointEntry({ ...vllm, models: [{ id: "m", contextWindow: 1000, ...over }] });

    test("emits all four rates Pi requires, deriving cacheRead from the input rate", () => {
      // ModelCostSchema (model-config.js:111) requires input/output/cacheRead/
      // cacheWrite — a partial object fails validation and Pi drops the whole
      // provider. cacheRead defaults to the input rate because a server that
      // reports cached_tokens bills for them; pricing them 0 IS the defect.
      expect(priced({ priceIn: 0.6, priceOut: 2.2 }).models).toEqual([
        { id: "m", contextWindow: 1000, cost: { input: 0.6, output: 2.2, cacheRead: 0.6, cacheWrite: 0 } },
      ]);
    });

    test("an explicit cacheRead rate wins over the derived default", () => {
      expect(priced({ priceIn: 0.6, priceOut: 2.2, priceCacheRead: 0.11 }).models).toEqual([
        { id: "m", contextWindow: 1000, cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 } },
      ]);
    });

    test("a free model prices at zero — that is a real rate, not a missing one", () => {
      expect(priced({ priceIn: 0, priceOut: 0 }).models).toEqual([
        { id: "m", contextWindow: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ]);
    });

    test("cost is OMITTED when either rate is unset — never a partial object", () => {
      expect(priced({}).models).toEqual([{ id: "m", contextWindow: 1000 }]);
      expect(priced({ priceIn: 0.6 }).models).toEqual([{ id: "m", contextWindow: 1000 }]);
      expect(priced({ priceOut: 2.2 }).models).toEqual([{ id: "m", contextWindow: 1000 }]);
    });
  });
});

describe("validateEndpoint — prices", () => {
  const withModel = (m: Record<string, unknown>): CustomEndpoint =>
    ({ ...vllm, models: [{ id: "m", contextWindow: 1000, ...m }] }) as CustomEndpoint;

  test("accepts a fully priced model and an unpriced one", () => {
    expect(validateEndpoint(withModel({ priceIn: 0.6, priceOut: 2.2 }), [])).toBeNull();
    expect(validateEndpoint(withModel({}), [])).toBeNull();
  });

  test("refuses a negative or non-finite rate", () => {
    expect(validateEndpoint(withModel({ priceIn: -1, priceOut: 2 }), [])).toMatch(/Price/);
    expect(validateEndpoint(withModel({ priceIn: 1, priceOut: Number.NaN }), [])).toMatch(/Price/);
    expect(validateEndpoint(withModel({ priceIn: 1, priceOut: 2, priceCacheRead: -0.5 }), [])).toMatch(/Price/);
  });

  test("refuses one rate without the other — a half-priced model would read as free", () => {
    expect(validateEndpoint(withModel({ priceIn: 0.6 }), [])).toMatch(/both/);
    expect(validateEndpoint(withModel({ priceOut: 2.2 }), [])).toMatch(/both/);
  });
});

describe("mergeModelsJson", () => {
  test("writes one provider entry per endpoint and records what it manages", () => {
    const out = JSON.parse(mergeModelsJson(null, [vllm]));
    expect(Object.keys(out.providers)).toEqual(["hv-my-vllm"]);
    expect(out.hvManaged).toEqual(["hv-my-vllm"]);
  });

  test("preserves foreign providers it did not write", () => {
    const existing = JSON.stringify({ providers: { handwritten: { baseUrl: "http://x/v1" } } });
    const out = JSON.parse(mergeModelsJson(existing, [vllm]));
    expect(out.providers.handwritten).toEqual({ baseUrl: "http://x/v1" });
    expect(out.providers["hv-my-vllm"]).toBeDefined();
  });

  test("removes endpoints it previously managed but no longer has", () => {
    const first = mergeModelsJson(null, [vllm]);
    const out = JSON.parse(mergeModelsJson(first, []));
    expect(out.providers["hv-my-vllm"]).toBeUndefined();
    expect(out.hvManaged).toEqual([]);
  });

  test("migrates a legacy pre-hvManaged ollama entry instead of orphaning it", () => {
    const legacy = JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1" } } });
    const out = JSON.parse(mergeModelsJson(legacy, []));
    expect(out.providers.ollama).toBeUndefined();
  });

  test("a corrupt file is rebuilt, not thrown on", () => {
    const out = JSON.parse(mergeModelsJson("{not json", [vllm]));
    expect(out.providers["hv-my-vllm"]).toBeDefined();
  });
});

describe("parseOpenAiModelList", () => {
  test("reads the OpenAI /v1/models shape", () => {
    expect(parseOpenAiModelList({ data: [{ id: "gpt-4o" }, { id: "llama-3.1-70b" }] }))
      .toEqual(["gpt-4o", "llama-3.1-70b"]);
  });
  test("ignores entries without a string id and tolerates junk", () => {
    expect(parseOpenAiModelList({ data: [{ id: 1 }, {}, { id: "ok" }] })).toEqual(["ok"]);
    expect(parseOpenAiModelList(null)).toEqual([]);
    expect(parseOpenAiModelList({ data: "nope" })).toEqual([]);
  });
});

describe("syncModelsJson", () => {
  test("writes custom endpoints alongside whatever Ollama reports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-models-"));
    await syncModelsJson(dir, [vllm]); // Ollama absent here → detect returns no models
    const out = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf8"));
    expect(out.providers["hv-my-vllm"].baseUrl).toBe("http://gpu.lan:8000/v1");
    expect(out.hvManaged).toContain("hv-my-vllm");
  });

  test("writes atomically and leaves no temp file behind", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-models-atomic-"));
    await syncModelsJson(dir, [vllm]);
    // A crash mid-write must not be able to leave a truncated models.json that
    // mergeModelsJson would then rebuild from {}, discarding hand-written entries.
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(["models.json"]);
  });

  test("concurrent syncs keep the file valid and preserve foreign providers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-models-conc-"));
    const file = path.join(dir, "models.json");
    fs.writeFileSync(file, JSON.stringify({ providers: { handwritten: { baseUrl: "http://mine/v1" } } }));
    const other: CustomEndpoint = { ...vllm, id: "second", providerKey: providerKeyFor("second") };
    await Promise.all([syncModelsJson(dir, [vllm]), syncModelsJson(dir, [vllm, other])]);
    const out = JSON.parse(fs.readFileSync(file, "utf8")); // must parse
    expect(out.providers.handwritten).toEqual({ baseUrl: "http://mine/v1" });
  });
});

describe("customEndpointEnv", () => {
  test("maps stored keys onto the env vars models.json references", () => {
    expect(customEndpointEnv([vllm], { "my-vllm": "sk-secret" })).toEqual({
      HV_CUSTOM_MY_VLLM_KEY: "sk-secret",
    });
  });

  test("an endpoint with no stored key contributes no empty env var", () => {
    expect(customEndpointEnv([vllm], {})).toEqual({});
  });

  test("placeholder-auth endpoints never take an env var", () => {
    const ollama: CustomEndpoint = {
      id: "ollama", providerKey: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1",
      preset: "ollama", auth: { kind: "placeholder", value: "ollama" }, models: [{ id: "m" }],
    };
    expect(customEndpointEnv([ollama], { ollama: "ignored" })).toEqual({});
  });
});
