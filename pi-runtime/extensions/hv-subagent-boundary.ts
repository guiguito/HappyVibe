/**
 * The sub-agent BOUNDARY — what a child may reach, named so a human can approve it.
 *
 * PURE and import-free, exactly like hv-rules.ts, because three places have to
 * agree on it and must never drift: the bridge (which builds the approval prompt
 * and registers the ceiling), src/main (which renders and audits), and vitest.
 * If the prompt's idea of "read-only" ever diverged from the ceiling's, the user
 * would be approving one thing while we enforced another — which is worse than
 * having no boundary at all, because it reads as safety.
 *
 * PRD §12 (2026-08-21). Requirements: the "Subagents permission gap" doc.
 */

/**
 * The read-only child default (FR3).
 *
 * Spelled from PI'S OWN registrations, not from our parent-side SAFE_TOOLS: Pi
 * 0.83+ builtins are exactly bash, edit, find, grep, ls, read, write — there is
 * NO `glob` and NO `list`. That matters more than it looks, because from
 * pi-subagents >=0.40 a child asking for a tool that does not exist fails the
 * WHOLE run ("requested unavailable child tools"), and both bundled agents
 * shipped asking for `glob, list` before anyone noticed.
 */
export const READ_ONLY_CHILD_TOOLS: ReadonlySet<string> = new Set(["find", "grep", "ls", "read"]);

/**
 * Tools whose presence in a boundary must be called out BY NAME at approval.
 *
 * `subagent` is deliberately absent: fan-out widens a child's reach but is not
 * itself a write, and the prompt reports it on its own line. Collapsing the two
 * would make "this agent can edit files" and "this agent can delegate" read the
 * same, and only one of them is a write.
 */
export const WRITE_CAPABLE_TOOLS: ReadonlySet<string> = new Set(["bash", "edit", "write", "multi_edit"]);

/**
 * The virtual rule name a delegation gates under — the same trick as
 * `mcp:<server>_<tool>` and `browser:<host>`, so it needs no new rule machinery
 * and Settings can already display and edit it.
 *
 * Without this a delegation gated as the bare string `subagent`, so one "Allow
 * for session" on a read-only explorer silently covered every other agent —
 * including a bash-wielding one — for the rest of the session.
 */
export function boundaryRuleName(agent: string): string {
  return `subagent:${agent}`;
}

/**
 * True when nothing in the boundary can change anything.
 *
 * An UNKNOWN tool is not read-only. That is the whole point of testing membership
 * of the read-only set rather than absence from the write-capable one: an
 * extension tool, an MCP tool or a future builtin must not read as safe merely
 * because we have not heard of it. Plan mode (§23) rests on this.
 */
export function isReadOnlyBoundary(tools: readonly string[]): boolean {
  return tools.every((t) => READ_ONLY_CHILD_TOOLS.has(t));
}

/** The write-capable tools in a boundary, sorted and deduped, for the prompt. */
export function writeCapableIn(tools: readonly string[]): string[] {
  return [...new Set(tools.filter((t) => WRITE_CAPABLE_TOOLS.has(t)))].sort();
}

/**
 * The ceiling to register once a human has approved `approved`.
 *
 * Always a UNION with the read-only floor, never a replacement: a child that can
 * run bash but cannot read is useless, and an agent declaring only `bash` should
 * not lose the ability to look at what it is doing.
 *
 * Widening is MONOTONIC within a turn, and that is forced rather than chosen.
 * Pi's agent loop awaits every `tool_call` gate in sequence and then runs the
 * executions under one `Promise.all` (`agent-loop.js:331-365`, with
 * `toolExecution` defaulting to "parallel" and `subagent` not declaring
 * `executionMode: "sequential"`), so gates serialize but child SPAWNS overlap. A
 * ceiling opened for one delegation and closed at its `tool_execution_end` would
 * therefore still be open while a sibling spawned. The registry is keyed by
 * session id with no per-call key, so nothing public can scope it tighter.
 * Measurements: docs/validation/d1.md §Subagent delegation concurrency.
 *
 * What keeps that sound is not the ceiling but the PROMPT: it shows the
 * preflight-resolved toolset, computed against the live ceiling, so it can never
 * understate what a child will get. Plus `isWiderThanReadOnly` below, which is
 * how FR3 survives someone else's approval.
 */
export function widenBoundary(approved: readonly string[]): string[] {
  return [...new Set([...READ_ONLY_CHILD_TOOLS, ...approved])].sort();
}

/**
 * True when the ceiling currently grants more than the read-only floor.
 *
 * The gate uses this to REFUSE a delegation to an agent that declares no `tools:`
 * while a widened ceiling is open. Upstream treats a present ceiling as the
 * declared tool set for such an agent (`pi-args.ts:396-399`), so without this
 * check an undeclared agent's reach would depend on what some *other* agent was
 * approved for earlier in the same turn — FR3 holding or not by accident of
 * ordering.
 */
export function isWiderThanReadOnly(tools: readonly string[]): boolean {
  return tools.some((t) => !READ_ONLY_CHILD_TOOLS.has(t));
}
