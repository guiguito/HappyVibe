import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { syncModelsJson } from "../src/main/providers";
import {
  customEndpointEnv, envVarFor, escapePiValue, endpointEntry, mergeModelsJson,
  parseOpenAiModelList, PRESET_COMPAT,
  type CustomEndpoint,
} from "../src/main/modelsJson";

const vllm: CustomEndpoint = {
  id: "my-vllm", label: "My vLLM", baseUrl: "http://gpu.lan:8000/v1",
  preset: "vllm", auth: { kind: "env" },
  models: [{ id: "qwen2.5-coder-32b", contextWindow: 32768 }],
};

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
});

describe("mergeModelsJson", () => {
  test("writes one provider entry per endpoint and records what it manages", () => {
    const out = JSON.parse(mergeModelsJson(null, [vllm]));
    expect(Object.keys(out.providers)).toEqual(["my-vllm"]);
    expect(out.hvManaged).toEqual(["my-vllm"]);
  });

  test("preserves foreign providers it did not write", () => {
    const existing = JSON.stringify({ providers: { handwritten: { baseUrl: "http://x/v1" } } });
    const out = JSON.parse(mergeModelsJson(existing, [vllm]));
    expect(out.providers.handwritten).toEqual({ baseUrl: "http://x/v1" });
    expect(out.providers["my-vllm"]).toBeDefined();
  });

  test("removes endpoints it previously managed but no longer has", () => {
    const first = mergeModelsJson(null, [vllm]);
    const out = JSON.parse(mergeModelsJson(first, []));
    expect(out.providers["my-vllm"]).toBeUndefined();
    expect(out.hvManaged).toEqual([]);
  });

  test("migrates a legacy pre-hvManaged ollama entry instead of orphaning it", () => {
    const legacy = JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1" } } });
    const out = JSON.parse(mergeModelsJson(legacy, []));
    expect(out.providers.ollama).toBeUndefined();
  });

  test("a corrupt file is rebuilt, not thrown on", () => {
    const out = JSON.parse(mergeModelsJson("{not json", [vllm]));
    expect(out.providers["my-vllm"]).toBeDefined();
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
    expect(out.providers["my-vllm"].baseUrl).toBe("http://gpu.lan:8000/v1");
    expect(out.hvManaged).toContain("my-vllm");
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
      id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1",
      preset: "ollama", auth: { kind: "placeholder", value: "ollama" }, models: [{ id: "m" }],
    };
    expect(customEndpointEnv([ollama], { ollama: "ignored" })).toEqual({});
  });
});
