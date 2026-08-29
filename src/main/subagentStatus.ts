/**
 * Live status poller for detached (async) subagent runs (docs/validation/d1.md
 * §hv:subagent-status). A detached run outlives the parent turn, so its progress
 * can't ride the parent's tool_execution_update stream; instead pi-subagents
 * atomically rewrites `<asyncDir>/status.json` on every change and we tail it.
 *
 * ponytail: 500 ms polling of one small JSON per active run. fs.watch on the OS
 * tmpdir is flaky cross-platform; a poll is the boring, correct option. Upgrade
 * to fs.watch only if active-run counts ever make this measurably costly.
 */
import * as fs from "node:fs";
import * as os from "node:os";

/** The subset of pi-subagents' AsyncStatus we forward to the renderer. */
export interface SubagentStatus {
  state?: string;
  activityState?: string;
  currentTool?: string;
  currentPath?: string;
  turnCount?: number;
  toolCount?: number;
  recentTools?: Array<{ tool: string; args?: string }>;
  /**
   * The child Pi session files this run is writing, with the agent that owns
   * each — `steps[].sessionFile` / `steps[].agent`, verbatim.
   *
   * This is the ONLY link between a run and its own spend, and it has to be
   * read rather than derived: the directory pi-subagents writes the child
   * session into is named after the run's INNER id, while every id the app
   * holds for a run (the poller key, the audit rows, `details.asyncId`) is the
   * WORKFLOW async id. Measured 2026-08-22 — async id
   * `72e6fd2e-…` wrote into `…/8a2f9f62-…/run-0/session.jsonl`. Resolving a path
   * from the async id therefore finds nothing, silently, which is exactly how
   * the first implementation shipped a card that never showed a number.
   */
  children?: Array<{ sessionFile: string; agent?: string }>;
  /**
   * The child's LIVE context occupancy — `steps[].tokens.window` (its latest
   * turn: input + cache-read) against `steps[].contextLimit` (that model's
   * window, resolved from Pi's own registry). pi-subagents 0.57 (#1444) added
   * this deliberately separate from cumulative spend, and rewrites both on
   * every child `message_end`, so it moves at the child's own turn cadence.
   *
   * Present only when BOTH numbers are. `contextLimit` is absent whenever the
   * resolved model is not in Pi's registry, and a window with nothing to divide
   * by is not a percentage — the card must then show no gauge at all rather
   * than a 0% (PRD §19 ruling 3, the same rule as an unknown price).
   *
   * First step only: a fan-out's children each have their own window and one
   * bar cannot honestly represent several.
   */
  context?: { window: number; limit: number };
  /**
   * One row per child of a fan-out (§12, 2026-08-29) — what the run card lists
   * when a run has more than one, each with its own gauge and its own STOP.
   *
   * Deliberately SEPARATE from `children` above. That field is the cost
   * readout's and requires a `sessionFile`; these rows exist from the moment a
   * child is `pending`, long before it has written one, because that is when it
   * first becomes stoppable. Same derivation, two shapes, because the two
   * consumers genuinely want different things.
   */
  steps?: Array<{
    /**
     * The id upstream's `stop` RPC resolves — see `childIdentity` above. NOT
     * taken from `steps[].childId`, which is declared upstream but null on the
     * wire; a real fan-out identifies its children by `workflowKey`.
     */
    childId?: string;
    agent?: string;
    status?: string;
    context?: { window: number; limit: number };
    /** The child's own transcript JSONL (0.58) — where its thinking blocks live. */
    transcriptPath?: string;
  }>;
}

/**
 * The identity upstream's `stop` RPC will actually resolve for a child.
 *
 * MEASURED 2026-08-29 on a live two-child `workflowScript` run: `steps[].childId`
 * is declared in upstream's type but is NULL on the wire — what a real fan-out
 * carries is `workflowKey` (the key the model passed to `runs.all`). Upstream's
 * own `asyncStatusChildIdentity` (runs/shared/child-identity.ts) is
 * `workflowKey ?? runId ?? "step:<index>"`, and `resolveAsyncStatusChild`
 * accepts any of the three — so we mirror that chain exactly rather than
 * trusting the declared field. Keying on `childId` alone meant the per-child
 * STOP never rendered on the only run shape that has more than one child.
 *
 * `childId` still wins when present: if upstream starts populating it, it is by
 * definition the caller-facing one.
 */
function childIdentity(st: Record<string, unknown>, index: number): string | undefined {
  for (const v of [st.childId, st.workflowKey, st.runId]) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return `step:${index}`;
}

/** `{window, limit}` for one status step, or undefined unless both are real. */
function stepContext(st: Record<string, unknown> | undefined): { window: number; limit: number } | undefined {
  const limit = st?.contextLimit;
  const window = (st?.tokens as { window?: unknown } | undefined)?.window;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return undefined;
  if (typeof window !== "number" || !Number.isFinite(window)) return undefined;
  return { window, limit };
}

/**
 * Read + normalize `<asyncDir>/status.json`. Returns null on a missing/torn read
 * (atomic writes mean a torn read just means "poll again next tick"). asyncDir
 * MUST be under os.tmpdir() (it comes from our own extension, but we confine fs
 * reads on principle — CLAUDE.md).
 */
export function readSubagentStatus(asyncDir: string): SubagentStatus | null {
  if (!asyncDir.startsWith(os.tmpdir())) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(`${asyncDir}/status.json`, "utf8");
  } catch {
    return null;
  }
  let s: Record<string, unknown>;
  try {
    s = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const steps = Array.isArray(s.steps) ? (s.steps as Array<Record<string, unknown>>) : [];
  const step = steps[0];
  // Every step, not just the first: a fan-out writes one child session per step,
  // and the run's spend is all of them.
  const children = steps
    .filter((st) => typeof st?.sessionFile === "string")
    .map((st) => ({
      sessionFile: st.sessionFile as string,
      ...(typeof st.agent === "string" ? { agent: st.agent } : {}),
    }));
  const context = stepContext(step);
  // Every step, including ones with no session file yet — a pending child is
  // stoppable, so it has to be listed before it is billable.
  const childRows = steps.map((st, i) => {
    const ctx = stepContext(st);
    return {
      ...(childIdentity(st, i) ? { childId: childIdentity(st, i) } : {}),
      ...(typeof st.agent === "string" ? { agent: st.agent } : {}),
      ...(typeof st.status === "string" ? { status: st.status } : {}),
      ...(ctx ? { context: ctx } : {}),
      ...(typeof st.transcriptPath === "string" ? { transcriptPath: st.transcriptPath } : {}),
    };
  });
  return {
    ...(children.length ? { children } : {}),
    ...(childRows.length ? { steps: childRows } : {}),
    ...(context ? { context } : {}),
    state: s.state as string | undefined,
    activityState: s.activityState as string | undefined,
    currentTool: (s.currentTool ?? step?.currentTool) as string | undefined,
    currentPath: (s.currentPath ?? step?.currentPath) as string | undefined,
    turnCount: (s.turnCount ?? step?.turnCount) as number | undefined,
    toolCount: (s.toolCount ?? step?.toolCount) as number | undefined,
    recentTools: (step?.recentTools ?? []) as Array<{ tool: string; args?: string }>,
  };
}

/** True when two consecutive reads carry the same live-progress fields (skip the push). */
export function statusUnchanged(a: SubagentStatus | null, b: SubagentStatus | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.state === b.state &&
    a.activityState === b.activityState &&
    a.currentTool === b.currentTool &&
    a.turnCount === b.turnCount &&
    a.toolCount === b.toolCount &&
    // The context gauge moves on its own schedule (once per child turn) and can
    // move on a tick where nothing else did — omit it here and the gauge freezes
    // at whatever the first pushed tick happened to carry.
    a.context?.window === b.context?.window &&
    a.context?.limit === b.context?.limit &&
    // The child session file arriving is itself news: it is what unlocks the
    // run's cost readout, and it can land on a tick where nothing else moved.
    (a.children ?? []).map((c) => c.sessionFile).join("|") ===
      (b.children ?? []).map((c) => c.sessionFile).join("|") &&
    // A child's own status/gauge moves independently of the run's. Omit this
    // and a finished child keeps its STOP button, and a per-child gauge freezes
    // at whatever the first pushed tick carried.
    stepKey(a) === stepKey(b)
  );
}

/** The per-child fields a push must not swallow: identity, status, occupancy. */
function stepKey(s: SubagentStatus): string {
  return (s.steps ?? [])
    .map((c) => `${c.childId ?? ""}:${c.status ?? ""}:${c.context?.window ?? ""}:${c.transcriptPath ?? ""}`)
    .join("|");
}

/**
 * Poll one run's status.json, invoking onChange only when the live fields move.
 * Returns a stop function. Pure timing wrapper (no Electron) so it's testable.
 */
export function pollSubagentStatus(
  asyncDir: string,
  onChange: (status: SubagentStatus) => void,
  intervalMs = 500,
): () => void {
  let last: SubagentStatus | null = null;
  const tick = (): void => {
    const s = readSubagentStatus(asyncDir);
    if (s && !statusUnchanged(last, s)) {
      last = s;
      onChange(s);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
