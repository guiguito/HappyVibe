/**
 * §24 Commands (prompt templates) — the typed↔expanded correlation. PURE,
 * node-only, vitest-importable (same shape as hv-skills.ts).
 *
 * WHY THIS EXISTS. Pi expands a prompt template into the user message and keeps
 * ONLY the expansion: `prompt()` builds the message from `expandedText`
 * (agent-session.js:867-875) and the original `/review src/foo.ts` survives
 * nowhere — not in the message history, not in the session file, not on any RPC
 * event. So the transcript disagrees with itself: the renderer optimistically
 * shows the typed text when the agent is idle, `queue_update` carries the
 * EXPANDED text when the user steers a busy agent, and a reload restores the
 * EXPANDED text from the session file. Same keystrokes, three transcripts — and
 * after a reload the short bubble has silently become a wall of text the user
 * never wrote (which `rewind` then loads back into the composer).
 *
 * No single Pi event carries both forms. But two adjacent ones do, in the SAME
 * call stack inside `prompt()`:
 *   - `input`              (agent-session.js:810) → the ORIGINAL typed text
 *   - `before_agent_start` (agent-session.js:882) → the EXPANDED text
 * so pairing them is exact rather than heuristic. That is all this module does:
 * remember the one, hand back the pair when the other arrives.
 *
 * ponytail: a single slot, not a queue. `prompt()` awaits its handlers serially
 * between those two points, so at most one prompt is ever mid-flight here; a
 * queue would model a concurrency that cannot happen.
 */

export interface TemplatePairState {
  /** The last `/`-prefixed text seen on `input`, awaiting its expansion. */
  typed?: string;
}

/** A resolved invocation: what the user typed, and what Pi actually sent. */
export interface TemplatePair {
  typed: string;
  expanded: string;
}

/**
 * Record a candidate on the `input` hook. Only `/`-prefixed text can expand, so
 * anything else clears the slot rather than filling it — an ordinary prompt
 * arriving between a command and its expansion must not inherit the pairing.
 */
export function rememberTyped(state: TemplatePairState, text: string): void {
  state.typed = typeof text === "string" && text.startsWith("/") ? text : undefined;
}

/**
 * Resolve the pair on `before_agent_start`, consuming the slot either way (so a
 * turn can never pair twice). Returns null when there was no candidate, or when
 * the text came through unchanged — an unexpanded `/hv-tools` or a bare `/typo`
 * is not a command invocation and must render as the plain bubble it is today.
 */
export function pairExpanded(state: TemplatePairState, expanded: string): TemplatePair | null {
  const typed = state.typed;
  state.typed = undefined;
  if (!typed || typeof expanded !== "string" || expanded === typed) return null;
  return { typed, expanded };
}

/** The command name in `/name args…`, or null. Used for the notify's `name` field. */
export function commandName(typed: string): string | null {
  const m = /^\/([^\s]+)/.exec(typed);
  return m ? m[1] : null;
}
