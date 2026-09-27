/**
 * The sub-agent BOUNDARY — what a child may reach, named so a human can approve it.
 *
 * PURE and import-free, exactly like hv-rules.ts, because three places have to
 * agree on it and must never drift: the bridge (which builds the approval prompt
 * and hands the approved set to the child guard), src/main (which renders and
 * audits), and vitest. If the prompt's idea of "read-only" ever diverged from the
 * guard's, the user
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
export const WRITE_CAPABLE_TOOLS: ReadonlySet<string> = new Set([
  // `powershell` is the Windows shell tool (PRD §4) — as write-capable as bash, and a
  // ceiling that missed it would read a PowerShell child as read-only.
  "bash", "powershell", "edit", "write", "multi_edit",
]);

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

/** What the approval prompt shows, and what the in-process guard holds the child to. */
export interface BoundarySummary {
  agent: string;
  /** The child's tools: the agent's own declaration, or our read-only default. */
  tools: string[];
  /** False when the agent declares no `tools:` and is therefore held to the read-only floor. */
  declared: boolean;
  writeCapable: string[];
  /** `subagent` in the toolset — reported on its own line, never as a write. */
  fanout: boolean;
  skills: string[];
  context: string;
  /** Declared resources that change child behaviour (inheritSkills, outputMode, …). */
  declarations: string[];
}

/**
 * Turn an agent's resolved tool set into the boundary a human approves.
 *
 * The trap this exists for: an agent declaring no `tools:` gets EVERY builtin from
 * the library, so rendering its resolved set verbatim would describe the most
 * dangerous case as a normal one. An undeclared agent is summarised as the
 * read-only default instead — which is exactly what the child guard holds it to.
 */
export function summarizeBoundary(input: {
  agent: string;
  explicitAllowlist: boolean;
  effectiveAllowlist: readonly string[];
  skills?: readonly string[];
  context?: string;
  declarations?: readonly string[];
}): BoundarySummary {
  const tools = input.explicitAllowlist
    ? [...new Set(input.effectiveAllowlist)].sort()
    : [...READ_ONLY_CHILD_TOOLS].sort();
  return {
    agent: input.agent,
    tools,
    declared: input.explicitAllowlist,
    writeCapable: writeCapableIn(tools),
    fanout: tools.includes("subagent"),
    skills: [...(input.skills ?? [])],
    // A child that forks the parent session is an isolation change and must never be implied.
    context: input.context ?? "fresh",
    declarations: [...(input.declarations ?? [])],
  };
}
