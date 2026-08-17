/**
 * The live-test model resolver (tests/liveModel.ts).
 *
 * This module decides whether the entire live-Pi batch runs and against which
 * provider, so it gets its own coverage: a bug here either skips the whole gate
 * silently (a green run that tested nothing) or runs it during `npm test` (a
 * six-minute non-live suite that spends money).
 *
 * The resolver reads process.env at import time, so each case re-imports it under
 * a set env rather than calling a function — which is also exactly how the live
 * files consume it.
 *
 * Key-free. Stays in the non-live suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = { ...process.env };

async function resolveWith(env: Record<string, string | undefined>): Promise<typeof import("./liveModel")> {
  for (const k of ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"]) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import("./liveModel");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const k of ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"]) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("provider resolution", () => {
  it("prefers OpenRouter, with the floating v4-flash alias", async () => {
    // The alias, not the dated -0731 snapshot: "latest" is the point, and the
    // snapshot would silently pin the batch to an ageing build.
    const m = await resolveWith({ OPENROUTER_API_KEY: "sk-or-real", DEEPSEEK_API_KEY: "sk-ds-real" });
    expect(m.KEY).toBe("sk-or-real");
    expect(m.MODEL).toEqual({ provider: "openrouter", modelId: "deepseek/deepseek-v4-flash" });
    // Only the chosen provider's var is injected — a spawn must not carry a second
    // provider's credential it has no reason to see.
    expect(m.PROVIDER_ENV).toEqual({ OPENROUTER_API_KEY: "sk-or-real" });
  });

  it("falls back to first-party DeepSeek when only that key is present", async () => {
    const m = await resolveWith({ DEEPSEEK_API_KEY: "sk-ds-real" });
    expect(m.KEY).toBe("sk-ds-real");
    expect(m.MODEL).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    expect(m.PROVIDER_ENV).toEqual({ DEEPSEEK_API_KEY: "sk-ds-real" });
  });
});

describe("the skip gate", () => {
  it("treats an sk-REPLACE sentinel as absent for EITHER provider", async () => {
    // This is how `npm test` forces the live batch to skip. Both vars must be
    // neutralised — the package.json `test` script sets both, and if this ever
    // stops holding the non-live suite starts making real model calls.
    const m = await resolveWith({ OPENROUTER_API_KEY: "sk-REPLACE", DEEPSEEK_API_KEY: "sk-REPLACE" });
    expect(m.KEY).toBeUndefined();
    expect(m.LIVE).toBeUndefined();
    expect(m.PROVIDER_ENV).toEqual({});
  });

  it("does not let a neutralised OpenRouter key mask a real DeepSeek one", async () => {
    // Ordering trap: OpenRouter is preferred, but "preferred" must mean "preferred
    // among USABLE keys", or `npm test` (which sets both sentinels) plus a real
    // DeepSeek key in .env would resolve to nothing and skip a batch that could run.
    const m = await resolveWith({ OPENROUTER_API_KEY: "sk-REPLACE", DEEPSEEK_API_KEY: "sk-ds-real" });
    expect(m.MODEL.provider).toBe("deepseek");
    expect(m.KEY).toBe("sk-ds-real");
  });

  it("skips on a whitespace key without reaching for .env", async () => {
    // Deliberately NOT testing undefined/"" here: the module's .env loader fills
    // any var that is UNSET or empty, so on a developer machine with a real key in
    // .env those cases resolve to that key — which is the intended behaviour and
    // makes them useless as "absent" cases. A whitespace value is truthy, so the
    // loader leaves it alone and only `usable()` decides. The sentinel above is the
    // path that actually gates `npm test`.
    const m = await resolveWith({ OPENROUTER_API_KEY: "   ", DEEPSEEK_API_KEY: "   " });
    expect(m.KEY).toBeUndefined();
  });

  it("fills an unset var from .env — the mechanism the sentinel overrides", async () => {
    // Pins the precedence rather than a value, so it holds with or without a local
    // .env: whatever a shell sets WINS, because the loader only fills what is unset.
    const m = await resolveWith({ OPENROUTER_API_KEY: "sk-or-from-shell" });
    expect(m.KEY).toBe("sk-or-from-shell");
    expect(m.MODEL.provider).toBe("openrouter");
  });

  it("still yields a constructible MODEL while skipping", async () => {
    // Live tests build their spawn spec before the skipIf is evaluated, so MODEL
    // must never be undefined — otherwise a skipped file throws at collection.
    const m = await resolveWith({});
    expect(m.MODEL.provider).toBeTruthy();
    expect(m.MODEL.modelId).toBeTruthy();
  });
});
