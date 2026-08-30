/**
 * §12 / §26 (2026-08-30): the resting state of a background run is a circle,
 * not a card — and this module owns every decision about it, so the renderer
 * suite (which has no DOM) can pin the whole policy.
 *
 * Two run families arrive here: sub-agent delegations and agent terminals. They
 * were two stacks of cards with two different caps; they are one row now, and
 * the merge is the reason this is a module rather than inline JSX.
 */
import type { DelegationRun } from "./agents";
import type { TerminalRun } from "./components/TerminalRunCard";

export type RunState = "working" | "attention" | "done" | "failed" | "stopped";

export interface RunAvatar {
  /** Map key: the delegation's run id, or the terminal's id. Unique across both. */
  key: string;
  kind: "agent" | "terminal";
  /** The agent's name, or the terminal's foreground command. */
  name: string;
  /** The delegation's task/intent, or the terminal's intent. May be empty. */
  caption: string;
  state: RunState;
  /** 0-359, derived from `name`. */
  hue: number;
}

/**
 * A hue from a name, so two concurrent robots are told apart at a glance.
 *
 * ponytail: FNV-1a, the same six lines `workspaceEmoji` uses for the collapsed
 * workspace rail and for the same reason — the only requirements are "stable"
 * and "spread out", and neither is worth a dependency. Copied rather than
 * shared because that module returns an emoji from a curated palette and this
 * one returns a number; folding them together would mean a generic hash helper
 * with two callers, which is the abstraction the ladder says to skip.
 */
export function avatarHue(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 360;
}

/**
 * The ring around a circle, as DATA rather than JSX: the suite has no DOM, so a
 * visual contract is pinned by exporting the mapping (the `GAUGE_TONE` /
 * `STATUS_MARK` pattern). `animate-pulse` is the "still going" signal the
 * feedback asked for and must appear on exactly the two live states — a
 * finished run that keeps pulsing is the whole bug this replaces, one surface
 * over.
 */
export const RUN_STATE_RING: Record<RunState, string> = {
  working: "border-sky animate-pulse",
  attention: "border-tangerine animate-pulse",
  done: "border-leaf",
  failed: "border-berry",
  stopped: "border-berry",
};

/** A delegation's state. `needs_attention` only counts while the run is live. */
function delegationState(run: DelegationRun): RunState {
  if (run.status === "running") {
    return run.live?.activityState === "needs_attention" ? "attention" : "working";
  }
  return run.status === "done" ? "done" : run.status === "interrupted" ? "stopped" : "failed";
}

/**
 * Both families, one row. Agents first: a delegation is the shorter-lived of
 * the two, which is the same ordering argument the two stacked sections already
 * used (delegations above terminals).
 */
export function toRunAvatars(delegations: DelegationRun[], terminals: TerminalRun[]): RunAvatar[] {
  return [
    ...delegations.map((r): RunAvatar => ({
      key: r.id,
      kind: "agent",
      name: r.agent,
      caption: r.label,
      state: delegationState(r),
      hue: avatarHue(r.agent),
    })),
    ...terminals.map((t): RunAvatar => ({
      key: t.terminalId,
      kind: "terminal",
      name: t.title,
      caption: t.intent,
      // A terminal does not end on its own, so "not running" means it exited or
      // was killed — never "succeeded".
      state: t.running ? "working" : "stopped",
      hue: avatarHue(t.title),
    })),
  ];
}

/**
 * Which runs must render as a full card rather than a circle.
 *
 * Attention is the one state that must not be reachable only by a click: the
 * amber pulse announces it, the card is what answers it (PRD §12, 2026-08-30).
 */
export function promotedKeys(avatars: RunAvatar[]): string[] {
  return avatars.filter((a) => a.state === "attention").map((a) => a.key);
}
