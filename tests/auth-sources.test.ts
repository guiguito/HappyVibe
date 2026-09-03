import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isSignedIn, UNMANAGED_AUTH_SOURCES } from "../src/renderer/src/auth";

/**
 * "Sign out does nothing" (2026-09-03).
 *
 * `isSignedIn` decides whether the Models page offers **Sign out** for a
 * provider. It excluded the literal `"env"`; Pi reports **`"environment"`**. So
 * a provider that is both an OAuth provider AND configured by an environment
 * variable — OpenRouter with `OPENROUTER_API_KEY` in a `.env` is the everyday
 * case — showed a Sign out button for a credential HappyVibe never stored.
 * `/hv-logout` had nothing to remove, so the click did nothing, forever.
 *
 * Measured on a live app before the fix:
 *   openrouter: { configured: true, source: "environment", label: "OPENROUTER_API_KEY" }
 *
 * The guard is a PIN against Pi's own source, not a second hand-written list:
 * guessing one of these strings is what broke it, and a pin bump that adds a
 * credential kind must fail here rather than ship another dead button.
 */

const PI = path.resolve(
  __dirname,
  "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist",
);

/** The one source that means "HappyVibe stored this and can remove it". */
const MANAGED = "stored";

/** Every `source: "..."` literal inside a function body, by slicing to its end. */
function sourcesIn(file: string, marker: string): string[] {
  const src = fs.readFileSync(path.join(PI, file), "utf8");
  const start = src.indexOf(marker);
  expect(start, `${marker} in ${file}`).toBeGreaterThan(-1);
  // Function bodies here are short; 1200 chars covers them with room to spare.
  const body = src.slice(start, start + 1200);
  return [...body.matchAll(/source: "([a-zA-Z_.]+)"/g)].map((m) => m[1]);
}

describe("Pi's auth-status vocabulary is fully accounted for", () => {
  it("every source getProviderAuthStatus can return is classified", () => {
    const found = new Set([
      ...sourcesIn("core/model-runtime.js", "getProviderAuthStatus(providerId) {"),
      ...sourcesIn("core/provider-composer.js", "export function configuredRequestAuthStatus("),
    ]);
    expect(found.size, "found some").toBeGreaterThan(3);
    for (const s of found) {
      const classified = s === MANAGED || UNMANAGED_AUTH_SOURCES.has(s);
      expect(classified, `unclassified auth source from Pi: "${s}"`).toBe(true);
    }
  });

  it("the environment spelling Pi actually uses is excluded", () => {
    // The whole bug in one line.
    expect(UNMANAGED_AUTH_SOURCES.has("environment")).toBe(true);
  });

  it("`stored` is never in the unmanaged set — it is the only one we can remove", () => {
    expect(UNMANAGED_AUTH_SOURCES.has(MANAGED)).toBe(false);
  });
});

describe("isSignedIn", () => {
  it("offers Sign out only for a credential HappyVibe stored", () => {
    expect(isSignedIn({ configured: true, source: "stored" })).toBe(true);
  });

  it("does NOT offer Sign out for an env-var credential", () => {
    // The measured shape, verbatim.
    expect(
      isSignedIn({ configured: true, source: "environment", label: "OPENROUTER_API_KEY" }),
    ).toBe(false);
  });

  it("does not offer Sign out for any other source we cannot remove", () => {
    for (const s of UNMANAGED_AUTH_SOURCES) {
      expect(isSignedIn({ configured: true, source: s }), s).toBe(false);
    }
  });

  it("keeps round 11's rule: an UNKNOWN source still counts as signed in", () => {
    // The deny-list shape exists so a credential kind Pi adds later does not
    // silently revert the card to "Sign in" after a real browser round-trip.
    expect(isSignedIn({ configured: true, source: "some-future-oauth-kind" })).toBe(true);
    expect(isSignedIn({ configured: true })).toBe(true);
  });

  it("is false when nothing is configured", () => {
    expect(isSignedIn({ configured: false })).toBe(false);
    expect(isSignedIn(undefined)).toBe(false);
  });
});
