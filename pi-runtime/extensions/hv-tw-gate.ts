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

// ── Workflows (decision 7: a workflow is code, and is approved as code) ────────

/** A workflow prompt offers exactly these — never a session grant. */
export const WORKFLOW_CHOICES = ["Allow", "Deny"] as const;

/**
 * The script a `SubagentWorkflow` call would run, whatever its source, so the human
 * approves the CODE. Upstream's precedence: `scriptPath` wins over `script`, which wins
 * over a saved `name`. A saved name resolves ONLY in the app's own agent dir (P5b): a
 * repository's `.pi/workflows/` is never read under HappyVibe.
 */
export function workflowSource(
  input: Record<string, unknown>,
  deps: { cwd: string; agentDir: string; read(p: string): string | null; join(...p: string[]): string; resolve(...p: string[]): string },
): { script: string; origin: "path" | "inline" | "saved" } | { error: string } {
  if (typeof input.scriptPath === "string" && input.scriptPath) {
    const script = deps.read(deps.resolve(deps.cwd, input.scriptPath));
    return script !== null ? { script, origin: "path" } : { error: `HappyVibe could not read the workflow script at ${input.scriptPath}.` };
  }
  if (typeof input.script === "string" && input.script.trim()) return { script: input.script, origin: "inline" };
  if (typeof input.name === "string" && /^[\w.-]+$/.test(input.name) && deps.agentDir) {
    const script = deps.read(deps.join(deps.agentDir, "workflows", `${input.name}.js`));
    if (script !== null) return { script, origin: "saved" };
  }
  return {
    error:
      "HappyVibe runs a workflow from an inline script, a script path, or a saved workflow in its own agent folder — " +
      "this call named none it could read. A project's own .pi/workflows/ is never used.",
  };
}

/** The agent types a script names as `agentType:` literals, and whether any call escapes that scan. */
export function workflowAgents(script: string): { types: string[]; unparsed: boolean } {
  const types = [...new Set([...script.matchAll(/agentType\s*:\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1]))];
  const calls = (script.match(/\bagent\s*\(/g) ?? []).length;
  const literal = (script.match(/agentType\s*:\s*["'`][\w.-]+["'`]/g) ?? []).length;
  // A call with no literal type (a variable, a computed name, or none at all — which
  // upstream treats as general-purpose, refused here by fallbackSubagent "none").
  return { types, unparsed: calls > literal };
}

/** The `meta` name a script declares, for the audit row and the prompt's headline. */
export function workflowName(script: string): string {
  return /name\s*:\s*["'`]([^"'`]+)["'`]/.exec(script)?.[1] ?? "workflow";
}
