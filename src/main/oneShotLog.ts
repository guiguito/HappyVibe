/**
 * Round 15 — the app's OWN model calls stop being invisible.
 *
 * HappyVibe makes THREE model calls no session ever sees: the session title
 * (titles.ts), the commit message and the pull-request draft (gitMessage.ts).
 * All three run `pi -p --no-session`, which is the point — nothing enters a transcript or a context window — and also the
 * problem: with no session there is no usage record anywhere, so until now
 * these calls existed in no log, no ledger and no total. The user asked which
 * model use is untracked; this is the answer, made visible.
 *
 * TOKENS, NEVER DOLLARS. §19's ledger reads Pi's own per-call `usage.cost` out
 * of a session file. There is no session file here, so a dollar figure would
 * have to be invented from a price table main does not have and must not grow a
 * second copy of. A token estimate is honest about being an estimate; a dollar
 * figure computed from a table nobody maintains is the "unknown price rendered
 * as $0.00" failure §19 ruling 3 exists to forbid, one surface over.
 *
 * The estimate itself is the standard ~4-chars-per-token rule of thumb. It is
 * wrong by a few percent per call and right about the order of magnitude, which
 * is all the Stats line claims.
 */

/**
 * Which of the three ran. Used verbatim as the audit row's label.
 *
 * There was a fourth, `agents-md`, added 2026-08-16. It was wired into a
 * handler that had been dead since 2026-07-12, so no row of that kind was ever
 * written — the AGENTS.md draft is a delegation (PRD §15) and is audited as
 * one. Removed rather than kept for a history that does not exist.
 */
export type OneShotKind = "title" | "commit-message" | "pr-draft";

export interface OneShotEvent {
  kind: OneShotKind;
  /** `provider/modelId`, as resolved at call time. */
  model: string;
  /** ~4 chars per token, prompt + output. Labelled estimated everywhere. */
  estTokens: number;
  /** False when the child errored, exited non-zero, or produced nothing. */
  ok: boolean;
}

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(promptChars: number, outputChars: number): number {
  const total = Math.max(0, promptChars) + Math.max(0, outputChars);
  return Math.ceil(total / CHARS_PER_TOKEN);
}

/** The EventLog surface this needs — narrowed so the module stays electron-free. */
export interface OneShotSink {
  append(e: { type: string; workspaceId?: string; sessionId?: string; data?: Record<string, unknown> }): unknown;
}

/**
 * Record one call. Never throws and never blocks the caller: a draft that
 * worked must not fail because logging did.
 */
export function logOneShot(
  log: OneShotSink | null | undefined,
  o: {
    kind: OneShotKind;
    model: { provider: string; modelId: string };
    promptChars: number;
    outputChars: number;
    ok: boolean;
    workspaceId?: string;
    sessionId?: string;
  },
): OneShotEvent {
  const ev: OneShotEvent = {
    kind: o.kind,
    model: `${o.model.provider}/${o.model.modelId}`,
    estTokens: estimateTokens(o.promptChars, o.outputChars),
    ok: o.ok,
  };
  try {
    void log?.append({
      type: "assistant.oneshot",
      workspaceId: o.workspaceId,
      sessionId: o.sessionId,
      data: { ...ev },
    });
  } catch {
    /* logging is never worth failing a draft over */
  }
  return ev;
}
