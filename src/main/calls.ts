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
 * SCOPE: main-agent calls only. Sub-agents are separate Pi processes with their
 * own session files; their spend is reported per delegation on the tool card
 * (ToolCard.tsx r.usage.cost), not here.
 */

export interface ApiCall {
  /** ISO 8601, from Pi's epoch-ms `timestamp`. */
  ts: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD estimate — Pi's `usage.cost.total`. */
  cost: number;
  /**
   * false when the call burned tokens but cost $0 — the provider had no price
   * table entry, so $0.00 means UNKNOWN, not free. The real case: a custom
   * OpenAI-compatible endpoint saved without prices gets every rate defaulted
   * to 0 (provider-composer.js:68), and 60k tokens report as free. Presenting
   * that as $0.00 unlabelled is the lie this flag exists to prevent.
   */
  priced: boolean;
}

export interface LedgerTotal {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** How many calls carry an unknown price — shown, never silently summed as 0. */
  unpriced: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Parse a Pi session file's JSONL into the call ledger. Tolerant by design: the
 * file is appended live, so the last line can be torn mid-write — a bad line is
 * skipped, never thrown (same contract as EventLog.read).
 */
export function parseCalls(jsonl: string | null | undefined): ApiCall[] {
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
    calls.push({
      ts: new Date(num(m.timestamp)).toISOString(),
      provider: typeof m.provider === "string" ? m.provider : "?",
      model: typeof m.model === "string" ? m.model : "?",
      input,
      output,
      cacheRead,
      cacheWrite,
      cost,
      // A call with no tokens really did cost nothing (an aborted or empty
      // turn) — only tokens-without-cost means the price was unknown.
      priced: cost > 0 || tokens === 0,
    });
  }
  return calls;
}

export function ledgerTotal(calls: ApiCall[]): LedgerTotal {
  const t: LedgerTotal = { calls: calls.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 };
  for (const c of calls) {
    t.input += c.input;
    t.output += c.output;
    t.cacheRead += c.cacheRead;
    t.cacheWrite += c.cacheWrite;
    t.cost += c.cost;
    if (!c.priced) t.unpriced += 1;
  }
  return t;
}
