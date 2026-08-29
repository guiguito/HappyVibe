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
 * Pairing is keyed by the TOOL CALL ID, because that is the only identifier that
 * is unique per delegation and present where the task is.
 *
 * It used to be one slot per AGENT, last-write-wins, on the reasoning that "Pi
 * runs tool calls one at a time, so the slot is claimed before the next call
 * writes it". **That reasoning was wrong and the bug was real** (2026-08-29): a
 * model can emit two `subagent` toolCall blocks in ONE assistant message, so both
 * stashes land before either run announces itself. Measured in a user's session —
 * two `code-explorer` delegations, Beat Saber and Minesweeper, dispatched
 * together: the second overwrote the first, the Beat Saber run claimed the slot
 * and was captioned "Minesweeper", and the Minesweeper run got no caption at all.
 * Same-agent fan-out is the normal shape, not a corner case.
 *
 * Two ids, two jobs, and the split is the point:
 *
 *   - `bindRun(toolCallId, runId)` is EXACT and is the authority. The bridge calls
 *     it from `tool_result`, the one event carrying both the tool call id and
 *     `details.asyncId`. Nothing can mispair here.
 *   - `claimTask(runId, agent)` serves the `subagent:async-started` notify, which
 *     carries no tool call id and therefore cannot be paired when several
 *     dispatches are outstanding. It now REFUSES in that case instead of guessing.
 *     Keying by tool call id is what lets it see the ambiguity at all — a
 *     per-agent slot had already thrown the evidence away.
 *
 * A blank caption is a smaller lie than a wrong one, and it is short-lived: the
 * renderer re-keys the card at `tool_execution_end` from the foreground card,
 * whose task came from the tool call's own args and is always right.
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

export interface PendingDispatch {
  task: string;
  /** The agent named in the tool call, used to disambiguate a claim. */
  agent: string;
}

export interface TaskMapState {
  /** toolCallId → the dispatch it carried, until a run is bound or claims it. */
  pending: Record<string, PendingDispatch>;
  /** runId → task, for cards raised now and rebuilt after a restart. */
  runs: Record<string, string>;
}

export function emptyTaskMap(): TaskMapState {
  return { pending: {}, runs: {} };
}

const agentKey = (agent: unknown): string =>
  typeof agent === "string" && agent.trim() ? agent.trim() : UNKNOWN_AGENT;

/**
 * Record the real task from a `subagent` tool_call, keyed by that call's id.
 *
 * Refuses a redacted or empty string outright: if upstream ever redacts the tool
 * INPUT too, this must degrade to "no caption", never launder the redaction back
 * into the UI through our own store.
 */
export function stashPendingTask(state: TaskMapState, toolCallId: unknown, task: unknown, agent?: unknown): void {
  const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
  if (!id) return;
  const clean = displayableTask(task);
  if (!clean) return;
  state.pending[id] = {
    task: clean.length > TASK_MAX ? `${clean.slice(0, TASK_MAX - 1)}…` : clean,
    agent: agentKey(agent),
  };
}

/**
 * Bind a dispatch to the run it produced — the EXACT pairing, and the authority.
 *
 * Called from the bridge's `tool_result` handler, which is the one event carrying
 * both the tool call id and `details.asyncId`. Because both ids come from the same
 * call, two same-agent delegations in one turn cannot cross.
 *
 * Idempotent, and it does not overwrite a caption a run already holds: a claim
 * that already happened was either this same dispatch or a refusal, and neither
 * benefits from being second-guessed here.
 */
export function bindRun(state: TaskMapState, toolCallId: unknown, runId: unknown): string | undefined {
  const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
  const run = typeof runId === "string" ? runId.trim() : "";
  if (!id || !run) return undefined;
  const dispatch = state.pending[id];
  if (dispatch) delete state.pending[id];
  if (state.runs[run]) return state.runs[run];
  if (!dispatch) return undefined;
  state.runs[run] = dispatch.task;
  return dispatch.task;
}

/** Forget a dispatch that never became a run (a denied or failed delegation). */
export function dropPendingTask(state: TaskMapState, toolCallId: unknown): void {
  const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
  if (id) delete state.pending[id];
}

/**
 * Best-effort pairing for `subagent:async-started`, which carries no tool call id.
 *
 * Exact when the run is already bound. Otherwise it will claim the ONE outstanding
 * dispatch that matches the event's agent — and refuse when more than one matches,
 * because with no tool call id there is nothing left to tell them apart. That
 * refusal is the whole fix: the previous per-agent slot could not even detect the
 * ambiguity, so it confidently returned the wrong caption.
 */
export function claimTask(state: TaskMapState, runId: string, agent?: unknown): string | undefined {
  if (!runId) return undefined;
  if (state.runs[runId]) return state.runs[runId];

  const wanted = agentKey(agent);
  const entries = Object.entries(state.pending);
  const matches = wanted === UNKNOWN_AGENT
    ? entries
    : entries.filter(([, d]) => d.agent === wanted);
  // Exactly one candidate, or nothing: never a guess between two.
  if (matches.length !== 1) return undefined;

  const [id, dispatch] = matches[0];
  delete state.pending[id];
  state.runs[runId] = dispatch.task;
  return dispatch.task;
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
