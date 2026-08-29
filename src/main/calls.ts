/**
 * Per-API-call ledger, parsed from Pi's own session file. PURE + electron-free
 * so vitest can drive it (tests/calls.test.ts).
 *
 * WHY the session file and not the RPC: `get_messages` returns
 * `agent.state.messages` (rpc-mode.js:515) — the LIVE context, so everything
 * compaction dropped is gone from it. Pi's own `get_session_stats` instead
 * iterates the whole session file (agent-session.js getSessionStats), which is
 * why a ledger built from the file totals to exactly the number Pi reports,
 * before and after a compaction. Two sources would drift; there is one.
 *
 * Entry shape (verified against real session files, 2026-07-30):
 *   {type:"message", message:{role:"assistant", timestamp, provider, model,
 *     usage:{input,output,cacheRead,cacheWrite,cost:{input,output,cacheRead,
 *     cacheWrite,total}}}}
 * Non-message entries (session, model_change, thinking_level_change) and
 * user/toolResult messages are not billed calls and are skipped.
 *
 * The `cost` numbers are Pi's, computed from a price table pinned at the
 * vendored pi-ai version (models.js calculateCost × models.generated.js). They
 * are an ESTIMATE and can diverge from a provider's invoice — most sharply when
 * that table prices cacheRead at 0 while the provider bills for cache hits, and
 * cache reads are the bulk of a coding agent's prompt tokens. That is why the
 * ledger keeps cacheRead/cacheWrite as their own columns instead of folding
 * them into one "input" figure: the divergence has to be visible to be
 * diagnosable.
 *
 * SCOPE: this function parses ONE session file. A sub-agent child is a separate
 * Pi process with its own session file — which, since 2026-08-22, is exactly
 * why its spend belongs in the same ledger rather than outside it: the one
 * source is "a Pi session file", and a child writes an ordinary one. See
 * sessionLedger.ts, which composes the parent's file with its children's, and
 * PRD §19.
 */

/**
 * How a call was paid for. Three states, not a boolean — a boolean forced
 * subscription calls into "priced: true" and rendered API-rate dollars the user
 * does not owe (see PLAN_PROVIDERS).
 *
 *  metered — billed per token; `cost` is the (estimated) amount owed.
 *  plan    — covered by a flat subscription; tokens are real, `cost` is NOT owed
 *            and is excluded from the total.
 *  unknown — burned tokens at a $0 rate because no price exists; $0.00 here
 *            means UNKNOWN, not free.
 */
export type Billing = "metered" | "plan" | "unknown";

/**
 * Providers that are ALWAYS a flat subscription, so per-token dollars are
 * meaningless. These are the OAuth-ONLY ids in providers.ts OAUTH_PROVIDERS —
 * they never appear in BYOK_PROVIDERS, so the provider id alone classifies them
 * with certainty.
 *
 * `anthropic` is deliberately ABSENT: it is in BOTH lists (API key → metered,
 * "Claude" Pro/Max sign-in → plan) and the session file records only
 * provider:"anthropic". It is resolved by the caller — see planProvidersFor.
 *
 * Pi prices openai-codex models at full API rates ($1.25/$10 per Mtok for
 * gpt-5.1), which is why this list has to exist at all: without it a ChatGPT
 * subscription session reports several dollars of spend that was never charged.
 */
export const PLAN_PROVIDERS: ReadonlySet<string> = new Set(["openai-codex", "github-copilot"]);

/**
 * Providers that are a subscription sign-in AND accept an API key, so which one
 * paid can only be told from key presence. Upstream marks each of these
 * `isSubscription` while also offering them as a one-key catalog row — the
 * combination IS the rule, and `tests/provider-catalog.test.ts` re-derives it
 * from Pi's registry so a pin that adds a fourth fails there rather than
 * quietly billing a subscription as metered.
 *
 * `openai-codex` and `github-copilot` are absent because neither is resolvable:
 * codex offers no key at all, and Copilot's token is one HappyVibe never asks
 * for — both are unconditional above.
 */
export const KEY_RESOLVED_PLAN_PROVIDERS: readonly string[] = ["anthropic", "xai", "kimi-coding"];

/**
 * The plan-provider set for a given key configuration. `anthropic` and (since
 * the 2026-08-29 providers round) `xai` and `kimi-coding` count as plan-billed
 * exactly when no API key is configured for them — with no key Pi falls back to
 * the subscription OAuth in auth.json (Claude Pro/Max, Grok/X, Kimi Code), so
 * those calls cost nothing per token. The set is exactly the providers upstream
 * marks `isSubscription` that ALSO accept a key; a sign-in that mints a metered
 * key (OpenRouter) is not one of them.
 *
 * ponytail: this reads key presence at QUERY time, not at call time, because the
 * session file does not record which auth resolved. Ceiling: a session billed
 * against an API key, viewed after that key is removed, is relabelled "plan".
 * Upgrade path = have the bridge stamp the resolved auth mode per call.
 */
export function planProvidersFor(keyStatus: Record<string, string | null>): ReadonlySet<string> {
  const s = new Set(PLAN_PROVIDERS);
  // Providers that are BOTH a subscription sign-in and a plain API key: with no
  // key, Pi falls back to the OAuth credential in auth.json and the tokens cost
  // nothing per call. `openrouter` is deliberately NOT here — its PKCE flow
  // mints a user-controlled key billed from OpenRouter credits, so it is
  // metered however it arrived, and calling it "plan" would hide real spend.
  for (const id of KEY_RESOLVED_PLAN_PROVIDERS) if (!keyStatus?.[id]) s.add(id);
  return s;
}

export interface ApiCall {
  /** ISO 8601, from Pi's epoch-ms `timestamp`. */
  ts: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Pi's `usage.cost.total`. Owed only when `billing` is "metered". */
  cost: number;
  billing: Billing;
  /**
   * The sub-agent that made this call. Absent for the session's own calls —
   * which is how a reader tells a delegation's row from the session's.
   */
  agent?: string;
}

export interface LedgerTotal {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD estimate for METERED calls only — plan dollars are not owed. */
  cost: number;
  metered: number;
  /** Calls covered by a subscription — named, not silently priced. */
  plan: number;
  /** Calls whose price is unknown — surfaced, never silently summed as $0. */
  unknown: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Parse a Pi session file's JSONL into the call ledger. Tolerant by design: the
 * file is appended live, so the last line can be torn mid-write — a bad line is
 * skipped, never thrown (same contract as EventLog.read).
 */
export function parseCalls(
  jsonl: string | null | undefined,
  planProviders: ReadonlySet<string> = PLAN_PROVIDERS,
  agent?: string,
): ApiCall[] {
  if (!jsonl) return [];
  const calls: ApiCall[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let entry: { type?: string; message?: Record<string, unknown> };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue; // torn tail or a line Pi wrote in a shape we don't know
    }
    const m = entry.type === "message" ? entry.message : undefined;
    if (!m || m.role !== "assistant") continue;

    const usage = (m.usage ?? {}) as Record<string, unknown>;
    const input = num(usage.input);
    const output = num(usage.output);
    const cacheRead = num(usage.cacheRead);
    const cacheWrite = num(usage.cacheWrite);
    const cost = num((usage.cost as { total?: unknown } | undefined)?.total);
    const tokens = input + output + cacheRead + cacheWrite;
    const provider = typeof m.provider === "string" ? m.provider : "?";
    calls.push({
      ts: new Date(num(m.timestamp)).toISOString(),
      provider,
      model: typeof m.model === "string" ? m.model : "?",
      input,
      output,
      cacheRead,
      cacheWrite,
      cost,
      // Plan wins over everything: a subscription call's dollars are wrong
      // whether Pi computed them (openai-codex, API rates) or zeroed them
      // (github-copilot). Otherwise tokens-at-$0 means the price is unknown; no
      // tokens at all really was free (an aborted or empty turn).
      billing: planProviders.has(provider) ? "plan" : cost === 0 && tokens > 0 ? "unknown" : "metered",
      ...(agent ? { agent } : {}),
    });
  }
  return calls;
}

export function ledgerTotal(calls: ApiCall[]): LedgerTotal {
  const t: LedgerTotal = {
    calls: calls.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
    metered: 0, plan: 0, unknown: 0,
  };
  for (const c of calls) {
    // Tokens are real whoever pays for them.
    t.input += c.input;
    t.output += c.output;
    t.cacheRead += c.cacheRead;
    t.cacheWrite += c.cacheWrite;
    t[c.billing] += 1;
    // Only metered dollars are owed. A plan call's cost is Pi's API-rate
    // arithmetic on a flat subscription — adding it would invent spend.
    if (c.billing === "metered") t.cost += c.cost;
  }
  return t;
}
