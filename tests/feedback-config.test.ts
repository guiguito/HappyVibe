import { describe, expect, it } from "vitest";
import { FEEDBACK_CHANNELS, fastPulse, resolveFeedbackConfig } from "../src/main/feedback/config";

describe("resolveFeedbackConfig", () => {
  it("dev channel resolves with the committed key and dev databases", () => {
    const c = resolveFeedbackConfig({}, true);
    expect(c?.channel).toBe("dev");
    expect(c?.publishableKey).toMatch(/^ipk_/);
    expect(c?.databases).toEqual({ general: "fdb_h2ntrck1mywr", session: "fdb_384szrcgeb7n" });
    expect(c?.baseUrl).toBe("https://feedback.bzapps.eu");
  });

  /**
   * §34: prod's publishable key can only be minted by a signed-in admin in
   * Inlet's web UI (an API key gets `insufficient_scope`, measured 2026-09-10).
   * Until it lands, prod resolves to NULL and the app shows no feedback surface
   * at all. When the key lands this test INVERTS — that is the intended signal.
   */
  it("prod channel is UNAVAILABLE until its key lands (null, not a throw)", () => {
    expect(FEEDBACK_CHANNELS.prod.publishableKey).toBeNull();
    expect(resolveFeedbackConfig({}, false)).toBeNull();
  });

  it("prod databases are the prod project's, never the dev ones", () => {
    expect(FEEDBACK_CHANNELS.prod.databases).toEqual({ general: "fdb_yfre0219xr82", session: "fdb_hnbkxr94p5cd" });
  });

  it("HV_FEEDBACK_* env overrides win, and a key override makes prod available", () => {
    const c = resolveFeedbackConfig(
      {
        HV_FEEDBACK_PUBLISHABLE_KEY: "ipk_x",
        HV_FEEDBACK_BASE_URL: "http://localhost:3000",
        HV_FEEDBACK_DB_GENERAL: "fdb_a",
        HV_FEEDBACK_DB_SESSION: "fdb_b",
      },
      false,
    );
    expect(c).toEqual({
      channel: "prod",
      baseUrl: "http://localhost:3000",
      publishableKey: "ipk_x",
      databases: { general: "fdb_a", session: "fdb_b" },
    });
  });

  it("HV_FEEDBACK_CHANNEL forces the channel", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_CHANNEL: "dev" }, false)?.channel).toBe("dev");
  });

  /**
   * The whole point of the key split: a SERVER key can read every response, so
   * one reaching the app would turn a client into an admin. Refused by shape,
   * not by trust, and tests/feedback-secrets.test.ts scans src/ for the literal.
   */
  it("a non-ipk_ key is refused (a server key must never be wired in)", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_PUBLISHABLE_KEY: "isk_nope" }, true)).toBeNull();
  });

  it("fastPulse is exactly the '1' flag", () => {
    expect(fastPulse({})).toBe(false);
    expect(fastPulse({ HV_FEEDBACK_FAST_PULSE: "1" })).toBe(true);
    expect(fastPulse({ HV_FEEDBACK_FAST_PULSE: "true" })).toBe(false);
  });
});
