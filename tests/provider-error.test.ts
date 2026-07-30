import { describe, expect, test } from "vitest";
import { describeProviderError } from "../src/renderer/src/providerError";

/**
 * Provider errors reach the transcript as raw wire text ("529 status code (no
 * body)") with no retry affordance. This maps the classes a user can actually
 * act on, and marks the transient ones retriable.
 *
 * The raw text is ALWAYS preserved in `raw` — a friendlier headline must never
 * be the only thing shown, or a report becomes unactionable.
 */

describe("transient — retriable", () => {
  test("529 overloaded (the live NVIDIA case; Pi's own retry list omits 529)", () => {
    const d = describeProviderError("529 status code (no body)");
    expect(d.retriable).toBe(true);
    expect(d.headline).toMatch(/overloaded/i);
    expect(d.raw).toBe("529 status code (no body)");
  });

  test("other 5xx and the word overloaded", () => {
    for (const raw of ["503 status code (no body)", "500 Internal Server Error", "Overloaded"]) {
      expect(describeProviderError(raw).retriable, raw).toBe(true);
    }
  });

  test("429 rate limit mentions waiting", () => {
    const d = describeProviderError("429 Too Many Requests");
    expect(d.retriable).toBe(true);
    expect(`${d.headline} ${d.hint}`).toMatch(/rate.?limit/i);
  });

  test("network failures are retriable and point at the endpoint", () => {
    for (const raw of ["fetch failed", "connect ECONNREFUSED 127.0.0.1:8000", "network error"]) {
      const d = describeProviderError(raw);
      expect(d.retriable, raw).toBe(true);
      expect(d.hint, raw).toMatch(/reachable|running|base URL/i);
    }
  });
});

describe("not transient — no retry button, actionable hint instead", () => {
  test("401/403 points at the key", () => {
    const d = describeProviderError("401 status code (no body)");
    expect(d.retriable).toBe(false);
    expect(d.hint).toMatch(/key/i);
  });

  test("400 points at the compatibility preset — the NVIDIA 400 class", () => {
    const d = describeProviderError("400 status code (no body)");
    expect(d.retriable).toBe(false);
    expect(d.hint).toMatch(/compatib|preset/i);
  });

  test("404 points at the model id", () => {
    expect(describeProviderError("404 model not found").hint).toMatch(/model/i);
  });

  test("quota/billing is not a throttle and must not offer retry", () => {
    for (const raw of ["insufficient_quota", "quota exceeded", "billing hard limit reached"]) {
      const d = describeProviderError(raw);
      expect(d.retriable, raw).toBe(false);
      expect(d.headline, raw).toMatch(/quota|credit|billing/i);
    }
  });

  test("context overflow blames the configured window, not the user", () => {
    const d = describeProviderError("400 maximum context length is 128000 tokens");
    expect(d.retriable).toBe(false);
    expect(d.hint).toMatch(/context window/i);
  });
});

describe("unknown text is passed through, never swallowed", () => {
  test("keeps the raw message as the headline", () => {
    const d = describeProviderError("something nobody predicted");
    expect(d.headline).toBe("something nobody predicted");
    expect(d.hint).toBeUndefined();
    expect(d.retriable).toBe(false);
  });

  test("empty input degrades to a generic line", () => {
    expect(describeProviderError("").headline).toMatch(/provider/i);
  });
});
