/**
 * B6 renderer-side pure helpers — agent/tool notify parsing, subagent-trace
 * extraction, and the tool→permission join. Pure functions only (unit-tested
 * in tests/agents-renderer.test.ts). Same "try JSON, guard on kind, null on
 * fail" discipline as context.ts / permission.ts.
 */

// ── hv.agents / hv.tools notifies ────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  source: "builtin" | "project";
  path: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  source: string;
}

export function parseAgents(r: { method?: string; message?: string }): AgentInfo[] | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; agents?: AgentInfo[] };
    if (p.kind !== "hv.agents") return null;
    return Array.isArray(p.agents) ? p.agents : [];
  } catch {
    return null;
  }
}

export function parseTools(r: { method?: string; message?: string }): ToolInfo[] | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; tools?: ToolInfo[] };
    if (p.kind !== "hv.tools") return null;
    return Array.isArray(p.tools) ? p.tools : [];
  } catch {
    return null;
  }
}

// ── tool → permission join ───────────────────────────────────────────────────
// Permission comes from evaluating each tool against the current rules (the
// SAME hv:eval-rules main call the bridge's gate uses — logic never forks).

export type PermState = "allow" | "ask" | "deny";

export interface ToolRow extends ToolInfo {
  permission: PermState;
}

/** Join a tool list against per-tool verdicts. A tool with no verdict → "ask". */
export function joinToolPermissions(tools: ToolInfo[], verdicts: Record<string, PermState>): ToolRow[] {
  return tools.map((t) => ({ ...t, permission: verdicts[t.name] ?? "ask" }));
}

// ── subagent trace extraction ────────────────────────────────────────────────
// Subagent delegation streams through ordinary tool_execution_* events with
// toolName "subagent" (s0.3). Observed empirically on pi-subagents 0.33.1:
//   tool_execution_update.partialResult.details.results[]  → LIVE child transcript
//        (results[].messages present)
//   tool_execution_end.result.details.results[]            → FINAL outcome
//        (NO messages; carries finalOutput, model via modelAttempts[], usage,
//         exitCode, artifactPaths)
// So the transcript lives in the UPDATE; the END finalizes model/usage/output.
// mergeTrace keeps the update's messages while adopting the end's outcome.

export interface SubagentMessage {
  role: string;
  /** flattened text of the message (content blocks joined). */
  text: string;
}

export interface SubagentResult {
  agent: string;
  messages: SubagentMessage[];
  usage?: { input?: number; output?: number; cost?: number; turns?: number };
  model?: string;
  exitCode?: number;
  finalOutput?: string;
}

export interface SubagentTrace {
  results: SubagentResult[];
}

interface RawResult {
  agent?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  usage?: { input?: number; output?: number; cost?: number; turns?: number };
  model?: string;
  exitCode?: number;
  finalOutput?: string;
  /** end shape: model/usage live under modelAttempts[] instead of top-level. */
  modelAttempts?: Array<{ model?: string; usage?: { input?: number; output?: number; cost?: number; turns?: number }; exitCode?: number }>;
}

/** Flatten a Pi message's content (string | block[]) to plain text. */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      const block = b as { type?: string; text?: string; name?: string; arguments?: unknown };
      if (block.type === "text") return block.text ?? "";
      if (block.type === "toolCall") return `${block.name}(${JSON.stringify(block.arguments ?? {})})`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toResults(raw: unknown): SubagentResult[] {
  const results = (raw as { details?: { results?: RawResult[] } })?.details?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const attempt = r.modelAttempts?.[r.modelAttempts.length - 1];
    return {
      agent: r.agent ?? "agent",
      messages: (r.messages ?? []).map((m) => ({ role: m.role ?? "assistant", text: flattenContent(m.content) })),
      usage: r.usage ?? attempt?.usage,
      model: r.model ?? attempt?.model,
      exitCode: r.exitCode ?? attempt?.exitCode,
      finalOutput: r.finalOutput,
    };
  });
}

/** Live trace from a tool_execution_update.partialResult (subagent tool only). */
export function traceFromUpdate(partialResult: unknown): SubagentTrace {
  return { results: toResults(partialResult) };
}

/** Final trace from a tool_execution_end.result (subagent tool only). */
export function traceFromEnd(result: unknown): SubagentTrace {
  return { results: toResults(result) };
}

/**
 * Merge a final (end) trace onto the live (update) trace: the end carries the
 * outcome (model/usage/finalOutput) but NOT the transcript, so keep the update's
 * messages per agent and adopt the end's outcome fields. Matched by index (the
 * results array is stable per delegation).
 */
export function mergeTrace(live: SubagentTrace | undefined, final: SubagentTrace): SubagentTrace {
  if (!live) return final;
  return {
    results: final.results.map((f, i) => {
      const l = live.results[i];
      return {
        ...f,
        messages: f.messages?.length ? f.messages : l?.messages ?? [],
        usage: f.usage ?? l?.usage,
        model: f.model ?? l?.model,
      };
    }),
  };
}

/** True when a tool event is a subagent delegation (nested-trace rendering). */
export function isSubagentTool(toolName: unknown): boolean {
  return toolName === "subagent";
}
