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

/**
 * Three classes taken from the user's OWN error history (every errored assistant
 * turn across ~40 session files), each of which fell through to the raw-passthrough
 * fallback and therefore rendered as an un-actionable red box.
 *
 * The one that prompted this: OpenRouter's stealth `ox-alpha` endpoint answered a
 * failed call with the literal string "ERROR" — no code, no detail. The transcript
 * showed a red bubble containing the word ERROR and nothing else: no model, no
 * provider, no hint that retrying was reasonable (it was — the model answered
 * normally two minutes later).
 */
describe("content-free provider messages", () => {
  test("a message that is literally ERROR names what failed instead of shouting", () => {
    const d = describeProviderError("ERROR", { provider: "openrouter", model: "stealth/ox-alpha" });
    expect(d.headline).toContain("openrouter");
    expect(d.headline).toContain("stealth/ox-alpha");
    // The point of the change: the word ERROR alone must not be the whole message.
    expect(d.headline).not.toBe("ERROR");
    expect(d.hint).toMatch(/no details|retry/i);
    expect(d.retriable).toBe(true);
    expect(d.raw, "the original is still preserved for a bug report").toBe("ERROR");
  });

  test("other content-free variants are treated the same", () => {
    for (const raw of ["error", "Error", "unknown error", "Unknown", "terminated", "failed", "?"]) {
      const d = describeProviderError(raw, { provider: "p", model: "m" });
      expect(d.retriable, raw).toBe(true);
      expect(d.headline, raw).toContain("p");
    }
  });

  test("degrades without context rather than printing undefined", () => {
    const d = describeProviderError("ERROR");
    expect(d.headline).toMatch(/provider/i);
    expect(d.headline).not.toMatch(/undefined/);
    expect(d.retriable).toBe(true);
  });

  test("a message with real content is NOT swallowed by this rule", () => {
    // The guard against over-reach: anything carrying information keeps it.
    const d = describeProviderError("ERROR: disk quota exceeded on node 4");
    expect(d.headline).not.toMatch(/returned no details/i);
  });
});

describe("transient classes seen in real logs but previously not retriable", () => {
  test("an upstream idle timeout is transient", () => {
    // Observed 3x on openrouter/z-ai/glm-5.2. It has no HTTP code and does not
    // say ETIMEDOUT, so it used to fall through as non-retriable.
    const d = describeProviderError("Upstream idle timeout exceeded");
    expect(d.retriable).toBe(true);
    expect(d.hint).toMatch(/retry/i);
  });

  test("a stream that ended without a finish reason is transient", () => {
    const d = describeProviderError("Stream ended without finish_reason");
    expect(d.retriable).toBe(true);
  });

  test("quota still wins over the timeout rule", () => {
    // Ordering guard: "usage limit ... timeout" must stay non-retriable.
    const d = describeProviderError("402 usage limit exceeded after idle timeout");
    expect(d.retriable).toBe(false);
  });
});
