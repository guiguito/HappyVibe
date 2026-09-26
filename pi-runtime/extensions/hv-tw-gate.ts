/**
 * Gating tintinweb's four tools (PRD §12, 2026-09-26) — PURE, so vitest reaches it and
 * the bridge only wires it. The rule vocabulary is unchanged: an `Agent` call gates
 * under `subagent:<agent>` (boundaryRuleName), so every existing rule and grant keeps
 * matching, and the boundary modal is today's.
 *
 * The one trap: tintinweb gives an agent with NO `tools:` line ALL of Pi's builtins
 * (`csvList(undefined, BUILTIN_TOOL_NAMES)`, custom-agents.ts:257). §12's rule is the
 * opposite — undeclared means the read-only floor — and the in-process guard enforces
 * it. So `declared` must come from the agent FILE (did it write `tools:`?), never from
 * tintinweb's resolved list, which cannot tell "declared all" from "said nothing".
 */
import { summarizeBoundary, type BoundarySummary } from "./hv-subagent-boundary";

export const AGENT_TOOL = "Agent";
export const WORKFLOW_TOOL = "SubagentWorkflow";
export const STEER_TOOL = "steer_subagent";
export const RESULT_TOOL = "get_subagent_result";

/** The agent an `Agent` call delegates to, or null for anything that is not a delegation. */
export function twAgentOf(tool: string, input: Record<string, unknown>): string | null {
  if (tool !== AGENT_TOOL) return null;
  return typeof input.subagent_type === "string" && input.subagent_type ? input.subagent_type : null;
}

/** What the bridge knows about one tintinweb agent: its resolved tools, and whether the FILE declared them. */
export interface TwAgentInfo {
  builtinToolNames: readonly string[];
  declared: boolean;
  allowedSubagents?: "all" | readonly string[];
}

/**
 * The boundary a human approves for an `Agent` call, or undefined when the agent does
 * not exist (tintinweb would refuse it too — `fallbackSubagent: "none"`).
 */
export function twBoundary(agent: string, info: TwAgentInfo | undefined, input: Record<string, unknown>): BoundarySummary | undefined {
  if (!info) return undefined;
  const declarations: string[] = [];
  const nested = info.allowedSubagents === "all" ? "any agent" : info.allowedSubagents?.join(", ");
  if (nested) declarations.push(`can delegate to: ${nested}`);
  if (typeof input.resume === "string" && input.resume) declarations.push(`resumes run ${input.resume}`);
  if (input.isolated === true) declarations.push("isolated (no extension tools)");
  const b = summarizeBoundary({
    agent,
    explicitAllowlist: info.declared,
    effectiveAllowlist: info.builtinToolNames,
    // Shown, not clamped — the 2026-08-29 precedent for a `fork` (§12).
    context: input.inherit_context === true ? "fork" : "fresh",
    declarations,
  });
  return { ...b, fanout: b.fanout || !!nested };
}

/** Did an agent file's frontmatter write a `tools:` key at all? */
export function declaresTools(frontmatter: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, "tools");
}
