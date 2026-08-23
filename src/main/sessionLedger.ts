/**
 * Every API call billed to a session: the session's own, plus every sub-agent
 * child it delegated to.
 *
 * ONE function, deliberately, because two of them is exactly how the cost pill
 * and the Stats dashboard came to disagree before (PRD §19, Feedback round 11):
 * the pill applied the billing policy and the dashboard summed a raw figure, so
 * a subscription session read "plan" in one place and several real-looking
 * dollars in the other. Both callers now compute the same arithmetic by
 * construction rather than by remembering to.
 *
 * A sub-agent child is an ordinary Pi process writing an ordinary Pi session
 * file, so the same parser and the same three-state billing apply, and nothing
 * here prices anything (PRD §19 ruling 1 — one price table, owned by Pi).
 */
import { ledgerTotal, parseCalls, type ApiCall, type LedgerTotal } from "./calls";
import { childSessionFiles, readSessionFile } from "./store";

/**
 * Shown when no delegation event named the run. The agent name is not in the
 * child's path, so an unnamed row is possible (a run whose events were pruned);
 * "sub-agent" is still truer than an empty column.
 */
export const UNNAMED_AGENT = "sub-agent";

/**
 * Returns null when the session's OWN file cannot be read — that session's cost
 * is UNKNOWN, not zero, and the two must not collapse (PRD §19 ruling 3a). An
 * empty array is a different answer: the file is there and nothing was billed.
 */
export function sessionCalls(
  sessionDirPath: string,
  piSessionFile: string | undefined,
  plans: ReadonlySet<string>,
  agentByFile?: ReadonlyMap<string, string>,
): ApiCall[] | null {
  const text = readSessionFile(sessionDirPath, piSessionFile);
  if (text == null) return null;
  const own = parseCalls(text, plans);
  // The whole-session view GLOBS, rather than reading recorded paths, because it
  // must also cover delegations from before those paths were recorded — every
  // child a session ever wrote is still on disk beside its parent. The recorded
  // paths are only what supplies the agent NAME, which no path contains.
  const children = childSessionFiles(sessionDirPath, piSessionFile).flatMap(({ file }) =>
    parseCalls(readSessionFile(sessionDirPath, file), plans, agentByFile?.get(file) ?? UNNAMED_AGENT),
  );
  // The panel is a chronological ledger, so the two streams interleave by time
  // rather than one being appended after the other.
  return [...own, ...children].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * child session file → agent name, from the delegation rows main writes.
 *
 * Keyed by FILE, not by run id: the whole-session ledger finds child files by
 * globbing (it must cover history), and a path is the only thing those two
 * routes share — the directory carries the run's inner id, while the rows are
 * keyed by the workflow async id. This is also the only durable record of the
 * name at all; ipc's `delegatedAgentByRun` is in memory and dies with the
 * process, so a reopened session would otherwise show every row as "sub-agent".
 */
export function agentByFileFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, string> {
  const byFile = new Map<string, string>();
  for (const kids of childSessionsByRunFrom(events).values()) {
    for (const k of kids) if (k.agent) byFile.set(k.sessionFile, k.agent);
  }
  return byFile;
}

/**
 * toolCallId → runId, so a restored tool card can find its run's spend.
 *
 * A restored transcript has tool cards keyed by call id and no memory of run
 * ids, and a child's own path carries the run id but not the call. This joins
 * them. Read from either delegation row so a future producer on the completion
 * side needs no change here; rows written before the field existed simply
 * contribute nothing, and their cards render exactly as they did.
 */
export function runByCallFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, string> {
  const byCall = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "subagent.async_started" && e.type !== "subagent.async_complete") continue;
    const callId = e.data?.toolCallId;
    const runId = e.data?.runId;
    if (typeof callId === "string" && typeof runId === "string") byCall.set(callId, runId);
  }
  return byCall;
}

/** A run's child sessions as main records them (from status.json's steps). */
export interface ChildSession {
  sessionFile: string;
  agent?: string;
}

/**
 * The calls a run's own child sessions made.
 *
 * Takes PATHS rather than a run id on purpose. The directory pi-subagents
 * writes a child session into is named after the run's INNER id, while every id
 * the app holds for a run — the poller key, the audit rows, `details.asyncId` —
 * is the WORKFLOW async id. Measured 2026-08-22: async id `72e6fd2e-…` wrote
 * into `…/8a2f9f62-…/run-0/session.jsonl`. A lookup by async id therefore finds
 * nothing, and finds it silently, which is how the first cut of this shipped a
 * card that never showed a number. The path comes from `steps[].sessionFile`.
 */
export function callsFromChildSessions(
  sessionDirPath: string,
  children: readonly ChildSession[],
  plans: ReadonlySet<string>,
): ApiCall[] {
  return children.flatMap((c) =>
    parseCalls(readSessionFile(sessionDirPath, c.sessionFile), plans, c.agent ?? UNNAMED_AGENT),
  );
}

/**
 * toolCallId → that delegation's total, for a reopened transcript.
 *
 * Keyed by call id because that is what a restored tool card has. Deliberately
 * returns totals rather than touching RestoreItem: this module knows about
 * money, not about transcript shapes.
 *
 * A run with no recorded child sessions yields NO entry, so its card renders
 * exactly as it did before this existed — which is also what every delegation
 * logged before `children` was recorded will do.
 */
export function runTotalsByCall(
  sessionDirPath: string,
  events: Array<{ type: string; data?: Record<string, unknown> }>,
  plans: ReadonlySet<string>,
): Map<string, LedgerTotal> {
  const children = childSessionsByRunFrom(events);
  const totals = new Map<string, LedgerTotal>();
  for (const [callId, runId] of runByCallFrom(events)) {
    const kids = children.get(runId);
    if (!kids?.length) continue;
    const calls = callsFromChildSessions(sessionDirPath, kids, plans);
    if (calls.length) totals.set(callId, ledgerTotal(calls));
  }
  return totals;
}

/** runId → the child sessions recorded on its completion row. */
export function childSessionsByRunFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, ChildSession[]> {
  const byRun = new Map<string, ChildSession[]>();
  for (const e of events) {
    if (e.type !== "subagent.async_complete") continue;
    const runId = e.data?.runId;
    const kids = e.data?.children;
    if (typeof runId !== "string" || !Array.isArray(kids)) continue;
    const clean = kids
      .filter((k): k is ChildSession => typeof (k as ChildSession)?.sessionFile === "string")
      .map((k) => ({ sessionFile: k.sessionFile, ...(k.agent ? { agent: k.agent } : {}) }));
    if (clean.length) byRun.set(runId, clean);
  }
  return byRun;
}
