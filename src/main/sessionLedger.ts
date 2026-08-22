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
import { parseCalls, type ApiCall } from "./calls";
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
  agentByRun?: ReadonlyMap<string, string>,
): ApiCall[] | null {
  const text = readSessionFile(sessionDirPath, piSessionFile);
  if (text == null) return null;
  const own = parseCalls(text, plans);
  const children = childSessionFiles(sessionDirPath, piSessionFile).flatMap(({ runId, file }) =>
    parseCalls(readSessionFile(sessionDirPath, file), plans, agentByRun?.get(runId) ?? UNNAMED_AGENT),
  );
  // The panel is a chronological ledger, so the two streams interleave by time
  // rather than one being appended after the other.
  return [...own, ...children].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * runId → agent name, from the delegation rows main already writes.
 *
 * The agent name is not recoverable from a child's path, and this is the only
 * DURABLE record of it: ipc's `delegatedAgentByRun` is in memory and dies with
 * the process, so a reopened session would otherwise have unnamed rows.
 */
export function agentByRunFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, string> {
  const byRun = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "subagent.async_started" && e.type !== "subagent.async_complete") continue;
    const runId = e.data?.runId;
    const agent = e.data?.agent;
    if (typeof runId === "string" && typeof agent === "string") byRun.set(runId, agent);
  }
  return byRun;
}

/** toolCallId → runId, so a restored tool card can find the run's spend. */
export function runByCallFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, string> {
  const byCall = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "subagent.async_complete") continue;
    const callId = e.data?.toolCallId;
    const runId = e.data?.runId;
    if (typeof callId === "string" && typeof runId === "string") byCall.set(callId, runId);
  }
  return byCall;
}

/** One run's calls — the live card's readout and the restored card's footer. */
export function runCalls(
  sessionDirPath: string,
  piSessionFile: string | undefined,
  runId: string,
  plans: ReadonlySet<string>,
  agent?: string,
): ApiCall[] {
  return childSessionFiles(sessionDirPath, piSessionFile, runId).flatMap(({ file }) =>
    parseCalls(readSessionFile(sessionDirPath, file), plans, agent ?? UNNAMED_AGENT),
  );
}
