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

/**
 * Resolve under an explicit environment. BOTH provider vars are always SET — never
 * deleted — because the module fills anything unset from the developer's real `.env`,
 * which would make these assertions depend on whose machine they run on. That is not
 * hypothetical: this helper used to delete them, and the DeepSeek-fallback case
 * started failing the moment a real OPENROUTER_API_KEY landed in `.env`.
 * `sk-REPLACE` is the sentinel meaning "absent" — the same one `npm test` uses.
 */
const ABSENT = "sk-REPLACE-absent";

async function resolveWith(env: { openrouter?: string; deepseek?: string }): Promise<typeof import("./liveModel")> {
  process.env.OPENROUTER_API_KEY = env.openrouter ?? ABSENT;
  process.env.DEEPSEEK_API_KEY = env.deepseek ?? ABSENT;
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
    const m = await resolveWith({ openrouter: "sk-or-real", deepseek: "sk-ds-real" });
    expect(m.KEY).toBe("sk-or-real");
    expect(m.MODEL).toEqual({ provider: "openrouter", modelId: "deepseek/deepseek-v4-flash" });
    // Only the chosen provider's var is injected — a spawn must not carry a second
    // provider's credential it has no reason to see.
    expect(m.PROVIDER_ENV).toEqual({ OPENROUTER_API_KEY: "sk-or-real" });
  });

  it("falls back to first-party DeepSeek when OpenRouter's key is not usable", async () => {
    // Covers both "no OpenRouter key at all" and "an sk-REPLACE'd one": preferring
    // OpenRouter must mean preferring it among USABLE keys, or `npm test` (which
    // sentinels both) plus a real DeepSeek key would skip a batch that could run.
    const m = await resolveWith({ deepseek: "sk-ds-real" });
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
    const m = await resolveWith({});
    expect(m.KEY).toBeUndefined();
    expect(m.LIVE).toBeUndefined();
    expect(m.PROVIDER_ENV).toEqual({});
  });

  it("skips on a whitespace key without reaching for .env", async () => {
    // Deliberately NOT testing undefined/"" here: the module's .env loader fills
    // any var that is UNSET or empty, so on a developer machine with a real key in
    // .env those cases resolve to that key — which is the intended behaviour and
    // makes them useless as "absent" cases. A whitespace value is truthy, so the
    // loader leaves it alone and only `usable()` decides. The sentinel above is the
    // path that actually gates `npm test`.
    const m = await resolveWith({ openrouter: "   ", deepseek: "   " });
    expect(m.KEY).toBeUndefined();
  });

  it("lets a shell value win over .env, which is what makes the sentinel work", async () => {
    // The loader only fills what is UNSET, so an explicitly-set value always wins.
    // That precedence is the entire mechanism behind `npm test`'s forced skip.
    const m = await resolveWith({ openrouter: "sk-or-from-shell" });
    expect(m.KEY).toBe("sk-or-from-shell");
    expect(m.MODEL.provider).toBe("openrouter");
  });

  it("still yields a constructible MODEL while skipping", async () => {
    // Live tests build their spawn spec before the skipIf is evaluated, so MODEL
    // must never be undefined — otherwise a skipped file throws at collection.
    const m = await resolveWith({});
    expect(m.KEY).toBeUndefined();
    expect(m.MODEL.provider).toBeTruthy();
    expect(m.MODEL.modelId).toBeTruthy();
  });
});
