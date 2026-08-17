/**
 * Remembering what a delegation was FOR, because pi-subagents >=0.50 stops saying.
 *
 * 0.50 redacts `task`/`goal` to `REDACTED_PROMPT` on every observer surface — the
 * lifecycle events, `status.json`, run metadata, the child's input artifact — while
 * still handing the real task to the child. That is upstream's call and we do not
 * fight it; but the run card's whole job is to tell the user which piece of work is
 * running, and "[prompt redacted]" is not that.
 *
 * The bridge sees the real task exactly once, in its own `tool_call` handler, and
 * has to hold it until the run it belongs to announces itself. The two facts that
 * shape this module:
 *
 *   - `subagent:async-started` carries `{id, agent, asyncDir, …}` and NO tool-call
 *     id, so the pairing cannot be looked up — it has to be tracked.
 *   - `status.json` carries no tool-call id either, so nothing on disk can rebuild
 *     the pairing after a restart. Hence persistence (via pi.appendEntry, which
 *     rides the session file and so survives both respawn and app restart).
 *
 * Pairing is therefore a one-slot-per-agent handoff, last write wins, and that
 * shape is chosen over a queue for a specific reason: a delegation the user DENIES
 * still passes through tool_call, so a queue would keep its task forever and hand
 * that stale caption to the next delegation to the same agent. A slot cannot — the
 * retry overwrites it before dispatch, because every dispatch writes its own
 * caption first. Pi runs tool calls one at a time, so the slot is claimed before
 * the next call writes it.
 *
 * The residual failure, accepted and bounded: two runs for the SAME agent whose
 * started events arrive in the opposite order to their tool calls could swap
 * captions. Different agents cannot swap, and an ambiguous claim yields NO caption
 * rather than a guessed one — a blank caption is a smaller lie than a wrong one.
 *
 * Pure and dependency-free (no pi handle, no fs) so the whole thing is unit-testable.
 */
import { displayableTask } from "./hv-rules.ts";

/** Session entry type for the persisted map (mirrors the plan-state pattern). */
export const SUBAGENT_TASKS_TYPE = "hv-subagent-tasks";

/** Cap: a card caption, not a transcript. Keeps the session entry small. */
const TASK_MAX = 300;

/** Slot key for a dispatch whose agent name we could not read. */
const UNKNOWN_AGENT = "";

export interface TaskMapState {
  /** agent → the task of its most recent dispatch, until a run claims it. */
  pending: Record<string, string>;
  /** runId → task, for cards raised now and rebuilt after a restart. */
  runs: Record<string, string>;
}

export function emptyTaskMap(): TaskMapState {
  return { pending: {}, runs: {} };
}

const agentKey = (agent: unknown): string =>
  typeof agent === "string" && agent.trim() ? agent.trim() : UNKNOWN_AGENT;

/**
 * Record the real task from a `subagent` tool_call, before dispatch.
 *
 * Refuses a redacted or empty string outright: if upstream ever redacts the tool
 * INPUT too, this must degrade to "no caption", never launder the redaction back
 * into the UI through our own store.
 */
export function stashPendingTask(state: TaskMapState, task: unknown, agent?: unknown): void {
  const clean = displayableTask(task);
  if (!clean) return;
  // Last write wins, deliberately: see the header note on denied delegations.
  state.pending[agentKey(agent)] = clean.length > TASK_MAX ? `${clean.slice(0, TASK_MAX - 1)}…` : clean;
}

/**
 * Pair a just-announced run with the task that dispatched it.
 *
 * Idempotent: a second call for a known runId returns what it already holds. An
 * ambiguous claim (no agent on the event, several dispatches outstanding) returns
 * undefined — a blank caption beats a guessed one.
 */
export function claimTask(state: TaskMapState, runId: string, agent?: unknown): string | undefined {
  if (!runId) return undefined;
  if (state.runs[runId]) return state.runs[runId];

  const wanted = agentKey(agent);
  let key: string | undefined;
  if (wanted !== UNKNOWN_AGENT && state.pending[wanted] !== undefined) key = wanted;
  else {
    // No agent on the event (or no dispatch recorded under its name): fall back to
    // the outstanding dispatch ONLY when there is exactly one, so the fallback
    // cannot invent a pairing.
    const keys = Object.keys(state.pending);
    if (keys.length === 1) key = keys[0];
  }
  if (key === undefined) return undefined;

  const claimed = state.pending[key];
  delete state.pending[key];
  state.runs[runId] = claimed;
  return claimed;
}

/** The remembered task for a run, or undefined. */
export function taskFor(state: TaskMapState, runId: unknown): string | undefined {
  return typeof runId === "string" ? state.runs[runId] : undefined;
}

/** Forget a finished run. Keeps the persisted entry from growing without bound. */
export function releaseTask(state: TaskMapState, runId: unknown): void {
  if (typeof runId === "string") delete state.runs[runId];
}

/** Snapshot for pi.appendEntry. `pending` is deliberately NOT persisted: an
 *  unclaimed task belongs to a dispatch that never announced a run, and replaying
 *  it after a restart would caption somebody else's card. */
export function serializeTaskMap(state: TaskMapState): { runs: Record<string, string> } {
  return { runs: { ...state.runs } };
}

/** Rebuild from the newest persisted entry. Tolerant by design — this runs on the
 *  session_start path, where throwing would cost the whole session. */
export function restoreTaskMap(raw: unknown): TaskMapState {
  const runs = (raw as { runs?: unknown } | undefined)?.runs;
  const out = emptyTaskMap();
  if (typeof raw !== "object" || raw === null) return out;
  if (runs && typeof runs === "object" && !Array.isArray(runs)) {
    for (const [runId, task] of Object.entries(runs as Record<string, unknown>)) {
      const clean = displayableTask(task);
      if (runId && clean) out.runs[runId] = clean;
    }
  }
  return out;
}
