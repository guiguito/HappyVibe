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
   * §34: prod's key landed 2026-09-10 (minted by a signed-in admin — an API key
   * gets `insufficient_scope`). This assertion is the INVERSE of the one it
   * replaces, which is exactly the signal that was designed in.
   */
  it("prod channel resolves with its own key and its own databases", () => {
    const c = resolveFeedbackConfig({}, false);
    expect(c?.channel).toBe("prod");
    expect(c?.publishableKey).toMatch(/^ipk_/);
    expect(c?.databases).toEqual({ general: "fdb_yfre0219xr82", session: "fdb_hnbkxr94p5cd" });
  });

  /** The two channels must never share a key or a database — that is what keeps dev noise out. */
  it("dev and prod share nothing", () => {
    const dev = resolveFeedbackConfig({}, true)!;
    const prod = resolveFeedbackConfig({}, false)!;
    expect(dev.publishableKey).not.toBe(prod.publishableKey);
    expect(dev.databases.general).not.toBe(prod.databases.general);
    expect(dev.databases.session).not.toBe(prod.databases.session);
  });

  /** A channel with no key still degrades to "no surface" rather than throwing. */
  it("a keyless channel resolves to null, which is what hides both surfaces", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_PUBLISHABLE_KEY: "" }, false)).toBeNull();
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
