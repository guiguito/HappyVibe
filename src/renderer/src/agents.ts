/**
 * B6 renderer-side pure helpers — agent/tool notify parsing, subagent-trace
 * extraction, and the tool→permission join. Pure functions only (unit-tested
 * in tests/agents-renderer.test.ts). Same "try JSON, guard on kind, null on
 * fail" discipline as context.ts / permission.ts.
 */
import { displayableTask } from "../../../pi-runtime/extensions/hv-rules";
import { fmtNum } from "./analytics-format";

// ── hv.agents / hv.tools notifies ────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  /**
   * §12 (2026-08-29): five sources, because there are five. `bundled` is ours
   * (the app-owned agent dir, editable); `builtin` is UPSTREAM's packaged
   * roster, which this page did not show at all until this round. Only
   * `bundled` and `project` are writable — `hv:write-agent` is path-confined.
   */
  source: "builtin" | "bundled" | "user" | "project" | "package";
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
// toolName "subagent" (s0.3).
//   tool_execution_update.partialResult.details.results[]  → LIVE view
//   tool_execution_end.result.details.results[]            → FINAL outcome
//        (finalOutput, model via modelAttempts[], usage, exitCode, artifactPaths)
//
// `messages` (re-verified against pi-subagents 0.40.0): GONE from both paths.
// The terminal result has stripped it since 0.34 (`compactForegroundResult` sets
// `messages: undefined` and substitutes `toolCalls`), and 0.40 does the same to
// the streamed update — `snapshotStreamResult` sets `messages = undefined` +
// `toolCalls = boundStreamedToolCalls(...)`, so one update line stays under the
// child-stdout protocol cap that could otherwise kill the child.
//
// So `toolCalls` ({text, expandedText}) is the transcript source on BOTH paths,
// and we map it into the same SubagentMessage rows the view already renders. We
// still prefer real `messages` when a payload carries them — they include the
// child's prose, which toolCalls does not; the child's ANSWER survives as
// `finalOutput`, which SubagentTraceView renders. mergeTrace keeps the update's
// rows while adopting the end's outcome.

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

/**
 * The per-child line on a delegation's trace: tokens and turns, never money.
 *
 * The card used to render `usage.cost` straight through `fmtCost`, which was
 * wrong twice over (PRD §19 ruling 3). pi-subagents prices from its OWN
 * registry, which has no concept of a flat-subscription provider, so a Claude
 * Max or Copilot user was shown API-rate dollars they never owed; and an
 * unpriced model reports 0, which `fmtCost` renders "$0.00" — free, rather than
 * unknown. Neither can be fixed here: `usage` carries no provider. The
 * classified figure is a RUN-level total parsed from the child's own session
 * file, where the provider is real (src/main/sessionLedger.ts).
 */
export function subagentUsageLine(usage?: { input?: number; output?: number; turns?: number }): string | null {
  if (!usage) return null;
  const parts = [`${fmtNum((usage.input ?? 0) + (usage.output ?? 0))} tok`];
  if (usage.turns != null) parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  return parts.join(" · ");
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
  /** 0.40 shape: compact tool-call summaries, standing in for `messages`. */
  toolCalls?: Array<{ text?: string; expandedText?: string }>;
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

/**
 * Transcript rows for one result. Real `messages` win (they carry the child's
 * prose); otherwise derive rows from `toolCalls`, which is all pi-subagents >=0.40
 * projects. Empty when neither is present — the view then shows its waiting copy.
 */
function toMessages(r: RawResult): SubagentMessage[] {
  if (r.messages?.length) {
    return r.messages.map((m) => ({ role: m.role ?? "assistant", text: flattenContent(m.content) }));
  }
  return (r.toolCalls ?? [])
    .map((c) => ({ role: "tool", text: c.expandedText ?? c.text ?? "" }))
    .filter((m) => m.text !== "");
}

function toResults(raw: unknown): SubagentResult[] {
  const results = (raw as { details?: { results?: RawResult[] } })?.details?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const attempt = r.modelAttempts?.[r.modelAttempts.length - 1];
    return {
      agent: r.agent ?? "agent",
      messages: toMessages(r),
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

/**
 * True for a `subagent` call that INSPECTS the machinery instead of delegating —
 * `{action:"status", id}` and friends, which the model fires to poll a run it
 * already started.
 *
 * These are not delegations and must not be drawn as one: the delegation card is
 * "→ asked <agent>: <task>", and a status poll has neither, so it rendered as
 * `→ asked ?` with an empty task — a card that says nothing about work nobody
 * asked for. Same class as the wait tool, which is hidden for the same reason.
 *
 * Deliberately conservative: it hides only a call KNOWN to be a query — an
 * `action` string AND no agent. A real delegation whose args we never saw is not
 * hidden, which matters because pi-subagents 0.50 sends no `args` at all on
 * `tool_execution_end`, so "no agent" alone would suppress genuine work.
 *
 * (Polls got common at 0.50: the completion payload is truncated at 1,000 chars
 * upstream, so the model often re-checks status and reads the output artifact
 * rather than receiving a whole result. Hiding the poll does not hide the
 * delegation, its result, or the artifact read.)
 */
export function isSubagentQuery(args: unknown): boolean {
  const a = args as { action?: unknown; agent?: unknown } | undefined;
  return typeof a?.action === "string" && a.action.trim() !== "" && typeof a?.agent !== "string";
}

// ── W1.2/V2.C1 delegation-run helpers ────────────────────────────────────────
// A delegation run lives OUTSIDE the chat flow while running: App tracks every
// in-flight subagent call keyed by toolCallId; ChatView renders them as a
// sticky in-flow section at the top of the transcript scroll area. Completed
// runs show a brief done/failed state, slide away, then App removes them
// (~2.5s after tool_execution_end).

/** One child of a fan-out delegation, as the run card renders it. */
export interface DelegationChild {
  /** Upstream's stable child identity — the id its `stop` RPC accepts. */
  childId?: string;
  agent?: string;
  status?: string;
  context?: { window: number; limit: number };
  /** The child's own transcript JSONL — where its thinking blocks live. */
  transcriptPath?: string;
}

export interface DelegationRun {
  /** Map key: the runId for async runs, the toolCallId for foreground runs. */
  id: string;
  /**
   * "fg" = a blocking (`async:false`) delegation — one tool call, transcript
   * streamed live onto the in-flow tool card (traceFor). "async" = a detached
   * run (the default) tracked by runId across its whole life via hv.subagent
   * events; its live progress comes from the status poller, not a tool card.
   */
  kind: "fg" | "async";
  /** Foreground only — the tool card to read the live transcript from. */
  toolCallId?: string;
  agent: string;
  /** headline: args.intent when present (W1.1 registered-tool param), else task. */
  label: string;
  startedAt: number;
  status: "running" | "done" | "error" | "interrupted";
  /** Async only — latest status-poll snapshot (currentTool, activityState, …). */
  live?: {
    currentTool?: string;
    activityState?: string;
    turnCount?: number;
    recentTools?: Array<{ tool: string; args?: string }>;
    /**
     * Spend so far, parsed from the child's own session file on the same tick.
     * Absent until the child's first turn is billed — the card then shows just
     * its elapsed time, never a $0.00 standing in for "not measured yet".
     */
    cost?: HvLedgerTotal;
    /**
     * The child's live context occupancy (§12, 2026-08-29). Like `cost`, the
     * last reading is KEPT when a tick arrives without one — a finishing or
     * stopped run must freeze on the gauge it reached, never blank back to no
     * gauge after having shown one.
     */
    context?: { window: number; limit: number };
    /**
     * Per-child rows for a fan-out (§12, 2026-08-29) — one per step, each with
     * its own gauge and its own stop. Only rendered above one child: a single
     * delegation has exactly one step, where a per-child stop would be the
     * run's own STOP wearing a second name.
     */
    children?: DelegationChild[];
  };
}

/** A fan-out child is stoppable exactly while upstream says it is (0.58: pending|running). */
export function isStoppableChild(status: string | undefined): boolean {
  return status === "pending" || status === "running";
}

// ── async subagent lifecycle (hv.subagent notify) ────────────────────────────

export interface SubagentEvent {
  stage: "started" | "control" | "complete" | "active" | "interrupt-sent" | "interrupt-error";
  runId?: string;
  agent?: string;
  task?: string;
  asyncDir?: string;
  status?: "success" | "error" | "interrupted";
  activityState?: "long-running" | "needs_attention";
  runs?: Array<{ runId: string; agent?: string; task?: string; asyncDir?: string }>;
}

/** The hv.subagent payload when this notify is a subagent lifecycle relay, else null. */
/** §26 part 2: an agent terminal opened or was stopped. Fire-and-forget. */
export interface TerminalEvent {
  stage: "started" | "killed";
  terminalId?: string;
  title?: string;
  intent?: string;
  workspaceId?: string;
}

export function parseTerminalEvent(r: { method?: string; message?: string }): TerminalEvent | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; stage?: string };
    if (p.kind !== "hv.terminal" || (p.stage !== "started" && p.stage !== "killed")) return null;
    return p as unknown as TerminalEvent;
  } catch {
    return null;
  }
}

/** §28: the agent opened, navigated, acted in or closed its browser pane. */
export interface BrowserEvent {
  stage: "opened" | "navigated" | "acted" | "screenshot" | "closed";
  browserId?: string;
  url?: string;
  intent?: string;
  workspaceId?: string;
  /** stage "acted": which of click/type/evaluate, and on what. */
  action?: "click" | "type" | "evaluate";
  detail?: string;
}

export function parseBrowserEvent(r: { method?: string; message?: string }): BrowserEvent | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; stage?: string };
    if (p.kind !== "hv.browser" || typeof p.stage !== "string") return null;
    return p as unknown as BrowserEvent;
  } catch {
    return null;
  }
}

export function parseSubagentEvent(r: { method?: string; message?: string }): SubagentEvent | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; stage?: string };
    if (p.kind !== "hv.subagent" || typeof p.stage !== "string") return null;
    return p as unknown as SubagentEvent;
  } catch {
    return null;
  }
}

/**
 * When a `subagent` tool_execution_end carries `details.asyncId`, the delegation
 * was dispatched async (returned immediately, detached runner owns the rest).
 * The foreground card raised on tool_execution_start is then discarded — the
 * async card (keyed by runId, raised by the `started` notify) owns the life.
 */
export function asyncResultInfo(result: unknown): { asyncId: string } | null {
  const id = (result as { details?: { asyncId?: unknown } } | undefined)?.details?.asyncId;
  return typeof id === "string" && id ? { asyncId: id } : null;
}

const LABEL_MAX = 90;

/**
 * Human headline for a delegation: intent ("why") wins over the raw task.
 *
 * Every caption in the delegation UI goes through here, which is what makes it the
 * one place to screen out pi-subagents 0.50's `REDACTED_PROMPT`. The bridge already
 * substitutes a remembered task before the notify (hv-subagent-tasks.ts), so this
 * is the backstop for any path that reads a task straight off upstream — and the
 * empty string it returns is the intended degradation: a card with no caption, not
 * a card captioned "[prompt redacted]".
 */
export function delegationLabel(args: unknown): string {
  const a = args as { intent?: unknown; task?: unknown } | undefined;
  const s = displayableTask(a?.intent) ?? displayableTask(a?.task) ?? "";
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > LABEL_MAX ? t.slice(0, LABEL_MAX - 1) + "…" : t;
}

/** Caption for a card raised from an hv.subagent notify (started / active resync),
 *  where the payload carries a bare task string rather than tool args. */
export function runLabel(task: unknown): string {
  return delegationLabel({ task });
}

/** "42s" / "3m 07s" elapsed formatting for run timers. */
export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

/**
 * Composer copy while a delegation runs. Async delegations (the default) don't
 * block the main agent — the turn ends at spawn and the user chats normally, so
 * the copy just reassures that results will arrive. A foreground (`async:false`)
 * delegation still blocks the one turn, so it keeps the "queues until it
 * finishes" copy. Null when nothing is running.
 */
export function delegationHint(runs: DelegationRun[]): string | null {
  const active = runs.filter((r) => r.status === "running");
  if (active.length === 0) return null;
  if (active.some((r) => r.kind === "async")) {
    return "Subagents are working in the background — keep chatting; results drop in when they finish";
  }
  const tail = active.length === 1 ? `${active[0].agent} finishes` : `${active.length} agents finish`;
  return `Type away — messages will be answered when ${tail}`;
}

/**
 * V2.C1: the live child transcript for a run — the in-flow subagent tool card
 * already carries it (tool_execution_update merges the trace there), so the
 * sticky section reads it from the transcript instead of duplicating state.
 */
export function traceFor(
  items: ReadonlyArray<{ kind: string; card?: unknown }>,
  toolCallId: string,
): SubagentTrace | undefined {
  for (const it of items) {
    if (it.kind !== "tool") continue;
    const card = it.card as { toolCallId?: string; trace?: SubagentTrace } | undefined;
    if (card?.toolCallId === toolCallId) return card.trace;
  }
  return undefined;
}

/**
 * WS5: parse the agents-md-maker subagent's structured output into a
 * {relPath → content} map (root + nested AGENTS.md). Pure — the app writes the
 * files (path-confined in main); the agent stays read-only (§15).
 *
 * Contract: exactly one fenced block tagged `json agents-md` whose body is
 * {"files": {"AGENTS.md": "...", "pkg/AGENTS.md": "..."}}. Malformed → null,
 * and the caller falls back to treating the whole output as a single root draft.
 */
const AGENTS_MD_FENCE = /```json\s+agents-md\s*\n([\s\S]*?)\n?```/;

export function parseAgentsMdOutput(finalOutput: string): Record<string, string> | null {
  const m = AGENTS_MD_FENCE.exec(finalOutput ?? "");
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const files = (parsed as { files?: unknown })?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  const out: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files as Record<string, unknown>)) {
    if (typeof content !== "string") continue;
    const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (norm.startsWith("/") || norm.split("/").includes("..")) continue;
    if (norm.split("/").pop() !== "AGENTS.md") continue;
    out[norm] = content;
  }
  return Object.keys(out).length > 0 ? out : null;
}
