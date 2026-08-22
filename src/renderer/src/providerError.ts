/**
 * Human-readable provider errors (§16 follow-up, 2026-07-30).
 *
 * Pi surfaces provider failures as raw wire text — "529 status code (no body)"
 * — which tells a user nothing about whether to wait, fix a key, or fix a
 * setting. This maps the classes that a user can actually act on.
 *
 * PURE module (no react, no window) so it is unit-testable.
 *
 * `retriable` marks the TRANSIENT classes only. Note Pi's own auto-retry list
 * (pi-ai/dist/utils/retry.js) covers 429/500/502/503/504/524 but NOT 529, so a
 * 529 reaches the transcript un-retried and the button is the only way out.
 * Quota/billing is deliberately NOT retriable — retrying spends nothing and
 * fixes nothing.
 */

/** What failed, when the message itself does not say. */
export interface ProviderErrorContext {
  provider?: string;
  model?: string;
}

export interface ProviderErrorInfo {
  /** One line, plain language. Falls back to the raw text when unrecognised. */
  headline: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
  /** Transient → offer a retry. */
  retriable: boolean;
  /** The original message, ALWAYS preserved so a bug report stays actionable. */
  raw: string;
}

const has = (s: string, re: RegExp): boolean => re.test(s);

export function describeProviderError(raw: string, ctx: ProviderErrorContext = {}): ProviderErrorInfo {
  const t = raw.trim();
  const what = [ctx.provider, ctx.model].filter(Boolean).join(" · ");
  if (!t) {
    return { headline: what ? `${what} returned an error.` : "The model provider returned an error.", retriable: false, raw };
  }

  // Quota/billing before rate-limit: "quota exceeded" can read as a throttle but
  // retrying never clears it (mirrors Pi's NON_RETRYABLE_PROVIDER_LIMIT list).
  if (has(t, /insufficient_quota|quota exceeded|out of budget|billing|usage limit|available balance/i)) {
    return {
      headline: "The provider says this account is out of quota or credit.",
      hint: "Check the account's billing or usage limits — retrying will not clear it.",
      retriable: false,
      raw,
    };
  }

  // Context overflow arrives as a 400 too, so it must be tested before the
  // generic 400. For a custom endpoint this usually means the context window
  // entered in Settings is larger than the server really allows.
  if (has(t, /context length|context window|too many tokens|maximum context|token limit/i)) {
    return {
      headline: "The conversation is longer than this model's context window.",
      hint: "If this is a custom endpoint, the context window set for the model may be larger than the server actually allows.",
      retriable: false,
      raw,
    };
  }

  if (has(t, /\b529\b|overloaded/i)) {
    return {
      headline: "The model provider is overloaded right now.",
      hint: "This is temporary and not a problem with your setup — retry in a moment.",
      retriable: true,
      raw,
    };
  }

  if (has(t, /\b429\b|rate.?limit|too many requests/i)) {
    return {
      headline: "The provider is rate-limiting this API key.",
      hint: "Wait a few seconds, then retry. Frequent rate limits usually mean a per-minute cap on the key.",
      retriable: true,
      raw,
    };
  }

  if (has(t, /\b(500|502|503|504|520|521|522|523|524)\b|service.?unavailable|server.?error|internal.?error|bad gateway/i)) {
    return {
      headline: "The provider had a server error.",
      hint: "Nothing is wrong on your side — retry in a moment.",
      retriable: true,
      raw,
    };
  }

  if (has(t, /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network.?error|socket hang up|aborted/i)) {
    return {
      headline: "Could not reach the model endpoint.",
      hint: "Check the server is running and the base URL is reachable from this machine.",
      retriable: true,
      raw,
    };
  }

  if (has(t, /\b40[13]\b|unauthorized|forbidden|invalid.?api.?key|authentication/i)) {
    return {
      headline: "The provider rejected the API key.",
      hint: "Re-enter the key in Settings → LLM Setup. A custom endpoint with no key needs one only if its server requires it.",
      retriable: false,
      raw,
    };
  }

  if (has(t, /\b404\b|model not found|no such model|unknown model/i)) {
    return {
      headline: "The provider does not have that model.",
      hint: "Check the model id — for a custom endpoint, re-fetch its model list in Settings.",
      retriable: false,
      raw,
    };
  }

  // Timeouts and truncated streams: transient, and neither carries an HTTP code
  // or an errno, so both used to reach the raw fallback and read as permanent.
  // Both observed in real logs ("Upstream idle timeout exceeded" x3,
  // "Stream ended without finish_reason").
  if (has(t, /idle timeout|timed? ?out|timeout exceeded|stream ended|without finish_reason|incomplete (response|stream)/i)) {
    return {
      headline: "The provider stopped responding mid-request.",
      hint: "The connection went idle or the stream ended early — retry; this is not a problem with your setup.",
      retriable: true,
      raw,
    };
  }

  // Generic 400: the request shape was refused. For a custom endpoint this is
  // almost always the compat preset (an unknown host gets OpenAI-only fields —
  // see PRESET_COMPAT in src/main/modelsJson.ts).
  if (has(t, /\b400\b|bad request|invalid.?request/i)) {
    return {
      headline: "The provider rejected the request.",
      hint: "For a custom endpoint this usually means the wrong compatibility preset — try \"Other\" in Settings → LLM Setup.",
      retriable: false,
      raw,
    };
  }

  // A message that carries no information at all. Measured, not imagined:
  // OpenRouter's stealth `ox-alpha` answered a failed call with the literal
  // string "ERROR", and DeepSeek has answered with "terminated" — both rendered
  // as a red box containing one word, with no model, no provider and no hint
  // that retrying was reasonable. It was: the same model answered normally two
  // minutes later.
  //
  // Checked LAST on purpose, so every class above keeps its specific reading,
  // and matched on the WHOLE string so anything with real content ("ERROR: disk
  // quota exceeded") falls through to that content instead of being flattened.
  //
  // Treated as retriable because a provider that cannot say what went wrong has
  // not told us it is permanent, and the alternative leaves the user with a dead
  // end. A pointless retry costs one request; a missing one costs the turn.
  if (CONTENT_FREE.test(t)) {
    return {
      headline: what ? `${what} failed without saying why.` : "The model provider returned an error with no details.",
      hint: "The provider sent no details. This is usually transient — retry, and if it repeats, try another model.",
      retriable: true,
      raw,
    };
  }

  return { headline: t, retriable: false, raw };
}

/**
 * The whole message is a content-free failure word. Anchored, so it can only ever
 * match a string that says nothing — never one that happens to start with it.
 */
const CONTENT_FREE =
  /^(error|errored|unknown|unknown error|failure|failed|terminated|aborted|cancelled|canceled|null|undefined|\?+|-+|n\/a)[.!]?$/i;
