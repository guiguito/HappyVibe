import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { anyProviderConfigured } from "../src/main/providers";

/**
 * §22 onboarding round (2026-09-01). The first-run gate's decision, pulled out
 * of the IPC handler so it can be asserted at all.
 *
 * It used to count BYOK keys, auth.json credentials and OLLAMA ONLY — while
 * `syncModelsJson` already writes LM Studio and llama.cpp into models.json
 * before every spawn and `listCustomEndpoints()` holds hand-added ones. So a
 * user with a working model was pinned to the forced-Models page forever, and
 * the onboarding wizard's step-1 checkmark derives from exactly this predicate.
 */

const none = {
  keyStatus: {} as Record<string, unknown>,
  authProviders: [] as string[],
  customEndpoints: [] as { id: string; auth: { kind: string } }[],
  customKeyStatus: {} as Record<string, boolean>,
  localRunning: false,
};

describe("anyProviderConfigured", () => {
  it("is false when nothing is configured", () => {
    expect(anyProviderConfigured(none)).toBe(false);
  });

  it("counts a BYOK key", () => {
    expect(anyProviderConfigured({ ...none, keyStatus: { deepseek: "stored" } })).toBe(true);
  });

  it("ignores a provider row whose key is absent", () => {
    // providerKeyStatus() returns a row PER known provider; null means no key.
    expect(anyProviderConfigured({ ...none, keyStatus: { deepseek: null, openai: null } })).toBe(false);
  });

  it("counts an auth.json credential", () => {
    expect(anyProviderConfigured({ ...none, authProviders: ["anthropic"] })).toBe(true);
  });

  it("counts a running local runner — the LM Studio-only user is not locked out", () => {
    expect(anyProviderConfigured({ ...none, localRunning: true })).toBe(true);
  });

  it("counts a keyless custom endpoint (placeholder auth = a local server)", () => {
    const customEndpoints = [{ id: "vllm", auth: { kind: "placeholder" } }];
    expect(anyProviderConfigured({ ...none, customEndpoints })).toBe(true);
  });

  it("does NOT count a custom endpoint whose key is missing", () => {
    const customEndpoints = [{ id: "acme", auth: { kind: "env" } }];
    expect(anyProviderConfigured({ ...none, customEndpoints })).toBe(false);
    expect(
      anyProviderConfigured({ ...none, customEndpoints, customKeyStatus: { acme: true } }),
    ).toBe(true);
  });
});

describe("the hv:has-any-provider handler", () => {
  const IPC = fs.readFileSync(path.resolve(__dirname, "../src/main/ipc.ts"), "utf8");
  const handler = IPC.slice(
    IPC.indexOf('ipcMain.handle("hv:has-any-provider"'),
    IPC.indexOf('ipcMain.handle("hv:open-external"'),
  );

  it("exists and delegates its decision rather than re-deciding inline", () => {
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toContain("anyProviderConfigured");
  });

  it("feeds it all four fact sources", () => {
    // Each of these was a way to own a working model that the gate could not see.
    expect(handler).toContain("providerKeyStatus()");
    expect(handler).toContain("authJsonProviders(");
    expect(handler).toContain("listCustomEndpoints()");
    expect(handler).toContain("LOCAL_RUNNERS");
  });
});
