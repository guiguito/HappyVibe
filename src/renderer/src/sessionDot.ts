import type { SessionStatus } from "./App";

/**
 * A8 (Animations round, 2026-09-10) — what the dot at the head of a session row
 * means.
 *
 * It used to be the PROCESS status alone: `running` meant the Pi child was up,
 * so every open session pulsed green whether its agent was mid-turn or idle,
 * and the turn-in-flight state never reached the sidebar at all. PRD §17's
 * round-15 sentence — "a session that is working shows the pulse" — was true
 * only in the *alive* sense.
 *
 * So working is a ROTATION now, precisely because the pulse already meant
 * alive. Two live states cannot share one signal and still say two things.
 *
 * The mapping is exported as DATA rather than built inline, for the reason
 * every visual contract in this app is: the renderer suite has no DOM, so a
 * record plus a source scan is the only way to pin it (the `RUN_STATE_RING` /
 * `STATUS_MARK` pattern).
 */
export type DotState = "working" | "alive" | "waking" | "crashed" | "idle";

/**
 * Order matters here, and each rung is a decision:
 *
 * - **crashed first**, so a stale busy flag can never hide a dead process.
 * - **busy next**, ahead of `running`: the renderer marks a session busy the
 *   moment it sends, and waiting for main's status to agree would leave the row
 *   idle through the first second of every turn — the exact moment the user is
 *   looking at it.
 * - then the process states, and finally nothing running at all.
 */
export function sessionDotState(status: SessionStatus | undefined, busy: boolean): DotState {
  if (status === "crashed") return "crashed";
  if (busy) return "working";
  if (status === "running") return "alive";
  if (status === "waking") return "waking";
  return "idle";
}

/**
 * The dot itself. `working` is not a filled dot but a RING WITH A GAP — that is
 * what makes a rotation legible at 10px, where a spinning disc is just a disc.
 *
 * `motion-reduce:border-t-tangerine` closes the gap: stopping a spinner mid-turn
 * would otherwise leave a lopsided arc on screen forever, and the rule is the
 * settled frame, never a frozen one.
 */
export const SESSION_DOT: Record<DotState, string> = {
  working:
    "size-2.5 rounded-full border-[1.5px] border-tangerine border-t-transparent motion-safe:animate-spin [animation-duration:1.2s] motion-reduce:border-t-tangerine",
  alive: "size-1.5 rounded-full bg-leaf",
  waking: "size-1.5 rounded-full bg-honey animate-pulse",
  crashed: "size-1.5 rounded-full bg-berry",
  idle: "size-1.5 rounded-full bg-line-strong",
};

/** Hover text, so the dot is never the whole explanation. */
export const DOT_TITLE: Record<DotState, string> = {
  working: "working…",
  alive: "running — waiting for you",
  waking: "waking up…",
  crashed: "crashed",
  idle: "idle",
};
