/**
 * §34 — when the session pulse may appear.
 *
 * Pure and seeded, so both timing arms are one test and the decision can be
 * re-derived on any beat without side effects. App evaluates it on `agent_end`,
 * the same beat that refreshes the cost ledger — never mid-stream, because a
 * row appearing under a streaming answer is an interruption, not an invitation.
 */
export interface PulseTiming {
  earliestMs: number;
  offsetMaxMs: number;
  minTurns: number;
}

export const PULSE_TIMING = {
  normal: { earliestMs: 10 * 60_000, offsetMaxMs: 20 * 60_000, minTurns: 3 },
  /**
   * The GUI-pass arm, reached only by `HV_FEEDBACK_FAST_PULSE=1` at launch.
   * Never `import.meta.env.DEV`: under dev mode every development session would
   * pulse after its first turn, and every tap is a real row in the Dev database.
   */
  fast: { earliestMs: 20_000, offsetMaxMs: 0, minTurns: 1 },
} as const satisfies Record<"normal" | "fast", PulseTiming>;

/**
 * Drawn ONCE at session open.
 *
 * A fixed ten minutes would land the row at the same moment for everyone and
 * correlate it with whatever the app does at minute ten, which would bias the
 * rating. The 30-minute upper bound means a long session still gets asked.
 */
export function drawOffset(timing: PulseTiming, rand: () => number): number {
  return Math.floor(Math.min(Math.max(rand(), 0), 0.999999) * timing.offsetMaxMs);
}

export interface PulseState {
  /** SessionMeta.pulseAskedAt is present — this session has had its one ask. */
  asked: boolean;
  /** When the session was opened IN THIS APP RUN: "how is this session going" is about this sitting. */
  openedAt: number;
  offsetMs: number;
  now: number;
  turns: number;
  busy: boolean;
  /** A permission prompt is up for this session. */
  promptOpen: boolean;
  /** The crash or red-zone banner is showing — one attention request at a time. */
  bannerShowing: boolean;
  /** This pane is the focused slot of its window. */
  focused: boolean;
  /** The channel has a publishable key. */
  available: boolean;
}

export function pulseDecision(s: PulseState, t: PulseTiming): boolean {
  if (s.asked || !s.available) return false;
  if (s.now - s.openedAt < t.earliestMs + s.offsetMs) return false;
  if (s.turns < t.minTurns) return false;
  return !s.busy && !s.promptOpen && !s.bannerShowing && s.focused;
}

/**
 * §20's copy record. The disclosure line is not decoration — the payload builder
 * it describes is `pulseContext`, and its allowlist is tested.
 */
export const PULSE_COPY = {
  question: "How is this session going?",
  disclosure: "Sends your rating with the app version, OS and this session's size — never what was said.",
  thanks: "Thanks!",
  /** The ✕'s label. Never "Dismiss": that is Banner's word, and this is not a banner. */
  dismiss: "Not now",
  /** The degraded row, when the published form outgrew one emoji question. */
  invite: "How is this session going? Tell us",
} as const;
