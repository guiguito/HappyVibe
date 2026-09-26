/**
 * The live status a run card shows (docs/validation/d1.md §hv:subagent-status). On the
 * tintinweb stack main derives it from the child's own session file (twChildren.ts
 * `twChildStatus`) or a workflow's progress events (`foldWorkflowProgress`).
 */
/** What main pushes to the renderer on `hv:subagent-status`. */
export interface SubagentStatus {
  /** tintinweb (§12 decision 8): the child's next move is the model's (see stuckRun.ts). */
  awaitingModel?: boolean;
  /** Why a run needs attention, when the app raised it: "no-activity" (stuck, decision 8). */
  attentionReason?: string;
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

