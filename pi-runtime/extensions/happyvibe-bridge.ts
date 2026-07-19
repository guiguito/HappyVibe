import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { answersMarkdown, DISMISSED_RESULT, normalizeQuestions, parseAnswers, HEADER_MAX, MAX_OPTIONS, MAX_QUESTIONS } from "./hv-ask-user";
import { EMPTY_RULES, evaluate, parseRulesFile, type RulesFile, type Verdict } from "./hv-rules";
import { unwrapMcpCall } from "./hv-mcp";
import {
  acceptableMarks, filterMessages, serializeEntries,
  type AgentMessage, type MarkKey, type SessionEntry,
} from "./hv-context";
import { parseAgentFile, renderSubagentSection, toAgentDef, type AgentDef, type AgentSource } from "./hv-agents";
import { FILE_TOOLS, nearestAgentsMd, nestedFileList, renderNestedSection, toolFilePath } from "./hv-agents-md";
import {
  buildPlanPrompt, gatePlanCall, PLAN_STATE_TYPE, restorePlanState, type PlanState, type PlanSessionEntry,
} from "./hv-plan";
// Async subagents (PRD §12): pi-subagents is co-resident on the SAME pi.events
// bus, so the bridge subscribes to its in-process lifecycle events and relays
// them as hv.subagent notifies (they never reach RPC stdout on their own). The
// active-run list + run dir root come straight from pi-subagents so a respawn
// can resync cards. Deep imports (no exports map) — pin-coupled like the rest of
// the bridge; contract tests gate pin bumps.
import { listAsyncRuns } from "pi-subagents/src/runs/background/async-status.ts";
import { ASYNC_DIR } from "pi-subagents/src/shared/types.ts";

const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string") return input.command.slice(0, 300);
  return JSON.stringify(input).slice(0, 300);
}

// ── W1.1 intent (PRD "Chat experience") ─────────────────────────────────────
// STANDING RULE: every registered (extension) tool HappyVibe bundles carries a
// REQUIRED `intent` string param — one short customer-facing sentence the UI
// leads with (renderer: toolLabel.ts). Built-in tool schemas are hard-coded in
// Pi (unknown params are stripped/rejected BEFORE tool_call), so built-ins get
// derived labels instead — do NOT try to add intent to them.
//
// Mechanism: a registered tool's TypeBox parameters object is shared by
// reference across Pi's definition registry, the wrapped AgentTool, and the
// per-request LLM tool spec (getAllTools() returns `definition.parameters`
// unchanged — verified against dist/core/agent-session.js getAllTools /
// dist/core/tools/tool-definition-wrapper.js). Mutating it once at
// session_start (after every extension has registered) both advertises the
// param to the model and makes validation require it; the value then rides
// tool_call.input and tool_execution_*.args untouched. New bundled tools:
// add their name to INTENT_TOOLS.
// "mcp" is the pi-mcp-adapter proxy tool: injecting intent gives every MCP call
// a customer-facing headline. The adapter's execute ignores the top-level intent
// (it forwards only the `args` JSON to the server), so this is safe in proxy mode.
const INTENT_TOOLS = ["ask_user", "mcp"]; // ask_user declares intent in its own schema — requireIntent's guard makes this a no-op for it
// `subagent` advertises intent but does NOT require it: the delegation `task` is
// already a fine customer-facing headline (the UI uses intent ?? task), and a
// hard requirement made looser models (e.g. Kimi) fail their first delegation
// with "intent: must have required properties intent" and retry. Optional keeps
// the nice model-authored headline when provided, without the failure.
const OPTIONAL_INTENT_TOOLS = ["subagent"];
// Direct-mode MCP tools (adapter's "expose tools directly") get the same
// required `intent`, BUT the direct executor forwards params VERBATIM to the
// MCP server (pi-mcp-adapter direct-tools.ts `arguments: params`) — a strict
// server would reject the unknown param. So the bridge strips `intent` from
// these tools in its tool_call handler (event.input is Pi's documented mutable
// pre-execution hook). Safe for the UI: tool_execution_start is emitted with
// the ORIGINAL model args (agent-loop.js emits before beforeToolCall runs),
// so tool cards see the intent while the server never does.
const strippedIntentTools = new Set<string>();
const INTENT_PARAM = {
  type: "string",
  description:
    "REQUIRED on every call. One short customer-facing sentence: what you are doing and why (shown to the user as the headline for this call).",
};
const OPTIONAL_INTENT_PARAM = {
  type: "string",
  description:
    "Optional but recommended. One short customer-facing sentence describing this delegation (shown as the headline; falls back to the task text if omitted).",
};
type MutableParams = { properties?: Record<string, unknown>; required?: string[] };
function requireIntent(pi: ExtensionAPI): void {
  for (const name of INTENT_TOOLS) {
    const params = pi.getAllTools().find((t) => t.name === name)?.parameters as MutableParams | undefined;
    if (!params?.properties || params.properties.intent) continue; // tool absent or already wired
    params.properties.intent = INTENT_PARAM;
    params.required = [...(params.required ?? []), "intent"];
  }
  // Optional-intent tools: advertise the param but never add it to `required`.
  for (const name of OPTIONAL_INTENT_TOOLS) {
    const params = pi.getAllTools().find((t) => t.name === name)?.parameters as MutableParams | undefined;
    if (!params?.properties || params.properties.intent) continue;
    params.properties.intent = OPTIONAL_INTENT_PARAM;
  }
  // Direct MCP tools = everything else pi-mcp-adapter registered.
  for (const t of pi.getAllTools()) {
    if (INTENT_TOOLS.includes(t.name) || !t.sourceInfo?.path?.includes("pi-mcp-adapter")) continue;
    if (strippedIntentTools.has(t.name)) continue; // already wired on an earlier session_start
    const params = t.parameters as MutableParams | undefined;
    if (!params?.properties) continue;
    if (params.properties.intent) continue; // server tool has its OWN intent param — hands off (no strip)
    params.properties.intent = INTENT_PARAM;
    params.required = [...(params.required ?? []), "intent"];
    strippedIntentTools.add(t.name);
  }
}

// ── B4 permissions (docs/validation/d1.md §hv.audit) ───────────────────────
// Rules file path rides the spawn env; main rewrites the file on UI edits
// and broadcasts /hv-rules-reload to every live session.
let rules: RulesFile = EMPTY_RULES;
let rulesError: string | null = null;
// Per-session toggle (/hv-dangerous). Round 3 #14: the persistent "bypass all
// permissions" setting is delivered via HV_BYPASS at spawn and re-applied on
// every respawn, so unlike the manual toggle it survives a respawn.
let dangerous = process.env.HV_BYPASS === "1";

// ── §23 Plan Mode ───────────────────────────────────────────────────────────
// Per-session read-only mode. State is {enabled, planPath?}; plan TEXT + STATUS
// live only in the workspace file (main writes it). Persisted via pi.appendEntry
// (like context marks) and — unlike dangerous mode — RESTORED on respawn, so a
// hibernation/MCP-reload respawn keeps the session in plan mode. The tool_call
// clamp (gatePlanCall) runs BEFORE the dangerous/bypass check: plan mode wins
// over bypass ("read-only" must mean read-only). setActiveTools is best-effort
// hygiene only; the clamp is the real enforcement.
let plan: PlanState = { enabled: false };
// Tool-call id of the last plan_complete, so /hv-plan off can mark its call/
// result out of future model context (reuse the context-marks mechanism).
let lastPlanCompleteCallId: string | undefined;
let toolsBeforePlan: string[] | undefined;
// ── B5 context visibility (docs/validation/d1.md §hv.context) ───────────────
// The kill-set of context marks. Persisted as `hv-context-marks` custom entries
// (pi.appendEntry — do NOT enter LLM context), restored on session_start, and
// re-appended after compaction so they survive. filterMessages applies them in
// the `context` handler (proven non-destructive in s0.3).
const CONTEXT_MARKS_TYPE = "hv-context-marks";
let contextMarks = new Set<MarkKey>();

/** JSON envelope for the fire-and-forget bridge→main channel (B4 hv.audit precedent). */
const ctxPayload = (o: Record<string, unknown>): string => JSON.stringify({ kind: "hv.context", ...o });

/** Newest hv-context-marks custom entry wins — it's a full snapshot of the set. */
function restoreMarks(entries: SessionEntry[]): void {
  contextMarks = new Set();
  for (const e of entries) {
    if ((e.type === "custom" || e.type === "custom_message") && e.customType === CONTEXT_MARKS_TYPE) {
      const marks = (e.data as { marks?: MarkKey[] } | undefined)?.marks;
      if (Array.isArray(marks)) contextMarks = new Set(marks); // last one seen = newest
    }
  }
}

function persistMarks(pi: ExtensionAPI): void {
  pi.appendEntry(CONTEXT_MARKS_TYPE, { marks: [...contextMarks] });
}

// §23 plan-state persistence — full snapshot, newest wins (mirrors marks).
function persistPlan(pi: ExtensionAPI): void {
  pi.appendEntry(PLAN_STATE_TYPE, { ...plan });
}
function emitPlan(ui: { notify(m: string, t?: "info" | "warning" | "error"): void }): void {
  ui.notify(JSON.stringify({ kind: "hv.plan", enabled: plan.enabled, planPath: plan.planPath ?? null }), "info");
}
// Best-effort model-facing hygiene: hide mutating tools from the model while
// planning. The tool_call clamp is the real enforcement; these APIs are unused
// elsewhere in the app, so failures are swallowed.
// ponytail: gate is enforcement; setActiveTools is cosmetic, unproven in this repo.
function applyPlanTools(pi: ExtensionAPI): void {
  try {
    const get = (pi as unknown as { getActiveTools?: () => string[] }).getActiveTools;
    const set = (pi as unknown as { setActiveTools?: (t: string[]) => void }).setActiveTools;
    if (!get || !set) return;
    if (plan.enabled) {
      if (!toolsBeforePlan) toolsBeforePlan = get.call(pi);
      set.call(pi, toolsBeforePlan.filter((t) => !["edit", "write", "multi_edit", "subagent"].includes(t)));
    } else if (toolsBeforePlan) {
      set.call(pi, toolsBeforePlan);
      toolsBeforePlan = undefined;
    }
  } catch {
    /* best-effort */
  }
}

function loadRules(): void {
  rulesError = null;
  const file = process.env.HV_RULES_FILE;
  if (!file) { rules = EMPTY_RULES; return; }
  try {
    rules = parseRulesFile(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") { rules = EMPTY_RULES; return; } // no rules yet
    // Torn/corrupt file: keep the previous ruleset — NEVER fail open.
    rulesError = e instanceof Error ? e.message : String(e);
  }
}

type AuditDecision = "allow" | "allow-session" | "deny";
type AuditSource = "rule" | "user" | "dangerous" | "safe-default" | "plan";

/** Every permission decision emits one hv.audit notify — main's audit channel. */
function audit(
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void },
  o: { tool: string; summary: string; decision: AuditDecision; source: AuditSource; rule?: Verdict["rule"]; grant?: "session" },
): void {
  ui.notify(JSON.stringify({ kind: "hv.audit", ts: new Date().toISOString(), ...o }), "info");
}

// ── B3 auth (docs/validation/s0.2.md) ──────────────────────────────────────
// Every UI payload is structured JSON following the hv.permission title
// convention, so the renderer can render device codes / auth URLs properly.
// notify carries the JSON in `message`; input/select carry it in `title`.
const authPayload = (o: Record<string, unknown>): string => JSON.stringify({ kind: "hv.auth", ...o });

// Providers hv-auth-status always reports on (PRD curated list), even when
// nothing is configured. Extra providers found in auth.json ride along.
const STATUS_PROVIDERS = [
  "anthropic", "github-copilot", "openai-codex", // OAuth ladder rung 1
  "ollama", // rung 2 (configured via models.json)
  "deepseek", "openai", "google", "openrouter", // BYOK rung 3 (anthropic above)
];

const loginAborts = new Map<string, AbortController>();

export default function (pi: ExtensionAPI) {
  loadRules();

  // ── B5 context visibility ──────────────────────────────────────────────
  // System-prompt block captured once per turn (NOT a session entry — read via
  // before_agent_start). Feeds the /hv-context snapshot's "System prompt" +
  // "Context files" groups. Sizes are char-based estimates (labeled in UI).
  let systemBlock: {
    chars: number;
    estTokens: number;
    toolCount: number;
    contextFiles: Array<{ path: string; chars: number; estTokens: number }>;
    toolDefs: Array<{ name: string; chars: number }>;
    /** Discoverability: the injected "Available subagents" roster, per agent. */
    agents: Array<{ name: string; chars: number }>;
  } | null = null;
  // W1.4: full resolved system prompt text (read-only Settings display).
  // null until the first turn runs — before_agent_start is the capture point.
  let systemText: string | null = null;

  // ── W2.3 nested AGENTS.md (docs/validation/d1.md §hv.context-files) ──────
  // Absolute paths of nested AGENTS.md files discovered via file-tool calls
  // this session. In-bridge-memory only — a respawn rediscovers them as soon
  // as tools touch the same subtrees (injection is per-turn anyway).
  const nestedAgentsMd = new Set<string>();
  const readFileOrNull = (p: string): string | null => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  const nestedList = () => nestedFileList(nestedAgentsMd, process.cwd(), readFileOrNull);

  // Async subagent bus events fire outside any handler, so we relay them
  // through the latest session's ui (captured here). One session per pi process
  // in RPC, refreshed on resume.
  let busUi: { notify(message: string, type?: "info" | "warning" | "error"): void } | null = null;

  pi.on("session_start", async (_event, ctx) => {
    requireIntent(pi); // all extensions have registered by now (idempotent across reloads)
    const entries = ctx.sessionManager.getEntries() as unknown as SessionEntry[];
    restoreMarks(entries);
    // §23: plan state SURVIVES respawn (unlike dangerous mode). Restore + re-emit
    // so the renderer resyncs its banner/toggle after a hibernation/MCP respawn.
    plan = restorePlanState(entries as unknown as PlanSessionEntry[]);
    if (plan.enabled) applyPlanTools(pi);
    emitPlan(ctx.ui);
    busUi = ctx.ui;
  });

  pi.on("before_agent_start", async (event) => {
    const sp = (event.systemPrompt ?? "") as string;
    // W2.3: nested AGENTS.md injection — content re-read at injection time so
    // it's always current. Returning systemPrompt replaces it for THIS TURN
    // ONLY (agent-session.js resets to the base prompt when we return nothing).
    const section = renderNestedSection(nestedAgentsMd, process.cwd(), readFileOrNull);
    // Discoverability: inject the delegable-subagent roster (same per-turn
    // replacement mechanism as the nested section). enumerateAgents is a hoisted
    // function declaration below in this closure.
    const agents = enumerateAgents();
    const agentsSection = renderSubagentSection(agents);
    // §23: while planning, prepend the read-only planning directive (single-turn
    // replacement, same mechanism as the nested/agents sections).
    const planSection = plan.enabled ? "\n\n" + buildPlanPrompt() : "";
    const injected = sp + section + agentsSection + planSection;
    systemText = injected;
    const opts = (event.systemPromptOptions ?? {}) as {
      selectedTools?: unknown[];
      contextFiles?: Array<{ path?: string; content?: string }>;
    };
    // v5: per-tool schema size (estimated from the LLM tool spec) for the
    // context-panel drill-in. Pi doesn't expose real token weight, so ≈chars/4.
    const toolDefs = (Array.isArray(opts.selectedTools) ? opts.selectedTools : []).map((t) => {
      const o = t as { name?: string; description?: string; parameters?: unknown };
      return {
        name: typeof o?.name === "string" ? o.name : "(tool)",
        chars: JSON.stringify({ name: o?.name, description: o?.description, parameters: o?.parameters }).length,
      };
    });
    systemBlock = {
      chars: injected.length,
      estTokens: Math.ceil(injected.length / 4),
      toolCount: toolDefs.length,
      contextFiles: (opts.contextFiles ?? []).map((f) => {
        const chars = (f.content ?? "").length;
        return { path: f.path ?? "", chars, estTokens: Math.ceil(chars / 4) };
      }),
      toolDefs,
      // Per-agent weight of the injected roster (name line ≈ chars/4 tokens).
      agents: agents.map((a) => ({ name: a.name, chars: `- **${a.name}** — ${a.description.slice(0, 200)}`.length })),
    };
    if (section || agentsSection || planSection) return { systemPrompt: injected };
  });

  // The only place removal takes effect. Non-destructive: session file untouched.
  pi.on("context", async (event) => {
    if (contextMarks.size === 0) return;
    return { messages: filterMessages(event.messages as unknown as AgentMessage[], contextMarks) };
  });

  // Marks are persisted as custom entries; compaction rewrites history but keeps
  // custom entries, and restoreMarks re-reads the newest one. Re-appending here
  // GUARANTEES a fresh snapshot lands on the post-compaction branch.
  pi.on("session_before_compact", async () => {
    if (contextMarks.size > 0) persistMarks(pi);
  });

  pi.registerCommand("hv-context", {
    description: "HappyVibe: emit a context snapshot (hv.context notify)",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries() as unknown as SessionEntry[];
      ctx.ui.notify(
        ctxPayload({
          stage: "snapshot",
          // W2.3: nested list computed fresh — the set can grow mid-turn.
          system: systemBlock ? { ...systemBlock, nested: nestedList() } : null,
          items: serializeEntries(entries),
          marks: [...contextMarks],
        }),
        "info",
      );
    },
  });

  pi.registerCommand("hv-context-remove", {
    description: "HappyVibe: remove context items (completed turns only). Usage: /hv-context-remove <key,key,...>",
    handler: async (args, ctx) => {
      const requested = args.split(/[,\s]+/).filter(Boolean) as MarkKey[];
      const entries = ctx.sessionManager.getEntries() as unknown as SessionEntry[];
      const { accepted, refused } = acceptableMarks(requested, entries);
      for (const k of accepted) contextMarks.add(k);
      if (accepted.length) persistMarks(pi);
      ctx.ui.notify(ctxPayload({ stage: "removed", accepted, refused, marks: [...contextMarks] }), refused.length ? "warning" : "info");
    },
  });

  pi.registerCommand("hv-context-restore", {
    description: "HappyVibe: restore removed context items. Usage: /hv-context-restore <key,key,...>",
    handler: async (args, ctx) => {
      const keys = args.split(/[,\s]+/).filter(Boolean) as MarkKey[];
      let changed = false;
      for (const k of keys) changed = contextMarks.delete(k) || changed;
      if (changed) persistMarks(pi);
      ctx.ui.notify(ctxPayload({ stage: "restored", restored: keys, marks: [...contextMarks] }), "info");
    },
  });

  // W1.4: read-only resolved system prompt for Settings (docs/validation/d1.md
  // §hv.sysprompt). Fire-and-forget notify like hv.context — text is null
  // until a turn has run in this session.
  pi.registerCommand("hv-sysprompt", {
    description: "HappyVibe: emit the resolved system prompt (hv.sysprompt notify)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify({ kind: "hv.sysprompt", text: systemText }), "info");
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName as string;
    const input = (event.input ?? {}) as Record<string, unknown>;
    // Async subagents (PRD §12): HappyVibe is always interactive and delivers a
    // subagent's result to the main agent AUTOMATICALLY as a new turn. The
    // pi-subagents async-started tool result nonetheless tells the model to call
    // `wait()` when it has nothing else to do — which blocks the turn and defeats
    // the whole "keep chatting while subagents run" promise. So we intercept
    // `wait` and hand back guidance instead of letting it block. (No audit — this
    // is a behavioral guard, not a permission decision.)
    if (tool === "wait") {
      return {
        block: true,
        reason:
          "Do NOT wait. This is an interactive HappyVibe session: the subagent's result " +
          "will be delivered to you automatically as a new turn the moment it finishes. End " +
          "your turn now with a brief note that the work is running in the background — do not " +
          "call wait() or poll with subagent status. You will be prompted with the result.",
      };
    }
    // Direct MCP tools: drop the injected intent BEFORE anything reads input
    // (permission summaries stay factual, per the PRD) — the adapter would
    // forward it verbatim to the MCP server otherwise. The UI already has it:
    // tool_execution_start fired with the original args.
    if (strippedIntentTools.has(tool)) delete input.intent;
    // MCP proxy unwrapping: rules, grants, prompts and audit all operate on
    // the real MCP tool ("mcp:<tool>"), never the bare proxy.
    const mcp = tool === "mcp" ? unwrapMcpCall(input) : null;
    const permTool = mcp?.ruleTool ?? tool;
    const summary = mcp?.display ?? summarize(tool, input);

    // W2.3: nested AGENTS.md discovery — every file-tool call reveals which
    // subtree the session touches; the nearest AGENTS.md above the target
    // (below the session cwd, exclusive) is injected from the next turn on.
    // Runs before the permission gate: discovery is read-only and harmless.
    if (FILE_TOOLS.has(tool)) {
      const fp = toolFilePath(input);
      const found = fp ? nearestAgentsMd(fp, process.cwd(), fs.existsSync) : null;
      if (found && !nestedAgentsMd.has(found)) {
        nestedAgentsMd.add(found);
        ctx.ui.notify(JSON.stringify({ kind: "hv.context-files", nested: nestedList() }), "info");
      }
    }

    // §23 Plan Mode clamp — runs BEFORE dangerous/bypass and the rule engine, so
    // plan mode wins over bypass (read-only must mean read-only). Applies to NEW
    // calls only; an in-flight async delegation is untouched.
    let planFloorAsk = false;
    if (plan.enabled) {
      const g = gatePlanCall(tool, input);
      if (g.kind === "block") {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "plan" });
        ctx.ui.notify(JSON.stringify({ kind: "hv.plan.blocked", toolName: tool, toolCallId: event.toolCallId, reason: g.reason }), "info");
        return { block: true, reason: g.reason };
      }
      planFloorAsk = g.kind === "floor-ask"; // clamp allow→ask below; deny still denies
    }

    // Dangerous mode: everything runs without prompting, but NEVER silently —
    // each call is audit-flagged and the renderer shows a permanent banner.
    // (Skipped while planning: plan mode ignores bypass entirely.)
    if (dangerous && !plan.enabled) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "dangerous" });
      return;
    }

    const v = evaluate(rules, { tool: permTool, input, workspace: process.cwd() });

    if (v.action === "deny") {
      audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule", rule: v.rule });
      return { block: true, reason: `Blocked by HappyVibe permission rule (${v.rule?.layer}: ${v.rule?.pattern})` };
    }
    // §23 floor-of-ask: while planning, "everything else" (MCP/unknown tools)
    // never auto-allows — an allow becomes an ask; deny already returned above,
    // explicit rules are honored by falling through to the prompt.
    if (v.action === "allow" && !planFloorAsk) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: v.source === "rule" ? "rule" : "safe-default", rule: v.rule });
      return;
    }

    // MCP discovery (search/describe/connect) is read-only against servers the
    // user configured — allow by default; an explicit ask/deny rule still wins
    // (handled above), matching the SAFE_TOOLS safe-default semantics.
    // (Not while planning: the floor-of-ask covers discovery too.)
    if (mcp?.kind === "discovery" && v.source === "default" && !planFloorAsk) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "safe-default" });
      return;
    }

    // ask — an earlier "Allow for session" grant covers default asks only;
    // an explicit ask RULE always re-prompts (that's what the rule is for).
    // v5: a session grant also covers the outside-workspace confinement ask.
    if ((v.source === "default" || v.source === "outside-workspace") && sessionGrants.has(permTool)) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "user", grant: "session" });
      return;
    }

    // v5: outside-workspace asks show the FACTUAL reason + path (never masked).
    const title = JSON.stringify(
      v.source === "outside-workspace"
        ? { kind: "hv.permission", tool: permTool, summary, reason: "outside-workspace", path: v.outsidePath }
        : { kind: "hv.permission", tool: permTool, summary },
    );
    // Surfaces as extension_ui_request over RPC (verified by D1 probe).
    // NO timeout, NO auto-allow: permission prompts wait indefinitely by design.
    const choice = await ctx.ui.select(title, ["Allow", "Allow for session", "Deny"]);

    if (choice === "Allow for session") {
      sessionGrants.add(permTool);
      audit(ctx.ui, { tool: permTool, summary, decision: "allow-session", source: "user" });
      return;
    }
    if (choice === "Allow") {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "user" });
      return;
    }
    audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "user" });
    return { block: true, reason: "User denied this action in HappyVibe" };
  });

  pi.registerCommand("hv-rules-reload", {
    description: "HappyVibe: reload permission rules from HV_RULES_FILE",
    handler: async (_args, ctx) => {
      loadRules();
      ctx.ui.notify(
        JSON.stringify(
          rulesError
            ? { kind: "hv.rules", stage: "error", message: rulesError }
            : {
                kind: "hv.rules", stage: "loaded",
                global: rules.global.length,
                workspaces: Object.values(rules.workspaces).reduce((n, r) => n + r.length, 0),
              },
        ),
        rulesError ? "error" : "info",
      );
    },
  });

  pi.registerCommand("hv-dangerous", {
    description: "HappyVibe: per-session dangerous mode. Usage: /hv-dangerous on|off",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg !== "on" && arg !== "off") {
        ctx.ui.notify(JSON.stringify({ kind: "hv.dangerous", stage: "error", message: "Usage: /hv-dangerous on|off" }), "error");
        return;
      }
      dangerous = arg === "on";
      ctx.ui.notify(JSON.stringify({ kind: "hv.dangerous", on: dangerous }), dangerous ? "warning" : "info");
    },
  });

  pi.registerCommand("hv-auth-status", {
    description: "HappyVibe: report provider auth status (never leaks credential values)",
    handler: async (_args, ctx) => {
      // 0.80.8+: authStorage is gone; ModelRuntime is the facade's (private-in-TS,
      // plain-in-JS) `runtime` property — no public extension-facing auth API exists.
      const runtime = (ctx.modelRegistry as any).runtime;
      const stored = (await runtime.listCredentials()).map((c: { providerId: string }) => c.providerId);
      const ids = new Set([...STATUS_PROVIDERS, ...stored]);
      const providers: Record<string, unknown> = {};
      // getProviderAuthStatus also accounts for models.json apiKey (Ollama).
      for (const id of ids) providers[id] = ctx.modelRegistry.getProviderAuthStatus(id);
      ctx.ui.notify(authPayload({ stage: "status", providers }), "info");
    },
  });

  pi.registerCommand("hv-login", {
    description: "HappyVibe: OAuth login. Usage: /hv-login <provider>",
    handler: async (args, ctx) => {
      const provider = args.trim();
      // 0.80.8+: ModelRuntime owns login/logout (AuthStorage removed); see /hv-auth-status.
      const runtime = (ctx.modelRegistry as any).runtime;
      if (!runtime.getProviders().some((p: { id: string; auth?: { oauth?: unknown } }) => p.id === provider && p.auth?.oauth)) {
        ctx.ui.notify(authPayload({ stage: "error", provider, message: `Unknown OAuth provider: ${provider}` }), "error");
        return;
      }
      const ac = new AbortController();
      loginAborts.set(provider, ac);
      try {
        // ModelRuntime.login persists the credential AND updates the in-memory
        // store — no respawn needed afterwards (s0.2 §2).
        await runtime.login(provider, "oauth", {
          signal: ac.signal,
          notify: (event: Record<string, any>) => {
            if (event.type === "auth_url") {
              ctx.ui.notify(authPayload({ stage: "auth_url", provider, url: event.url, instructions: event.instructions }), "info");
            } else if (event.type === "device_code") {
              ctx.ui.notify(authPayload({
                stage: "device_code", provider,
                userCode: event.userCode, verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds, expiresInSeconds: event.expiresInSeconds,
              }), "info");
            } else {
              // "info" | "progress" both ride the progress stage the renderer knows.
              ctx.ui.notify(authPayload({ stage: "progress", provider, message: event.message }), "info");
            }
          },
          prompt: async (p: Record<string, any>) => {
            if (p.type === "select") {
              const label = await ctx.ui.select(
                authPayload({ stage: "select", provider, message: p.message }),
                p.options.map((o: { label: string }) => o.label),
              );
              const id = p.options.find((o: { label: string }) => o.label === label)?.id;
              if (id === undefined) throw new Error("Login cancelled");
              return id;
            }
            const v = p.type === "manual_code"
              ? await ctx.ui.input(authPayload({ stage: "manual_code", provider, message: p.message ?? "Paste the authorization code" }))
              : await ctx.ui.input(
                  authPayload({ stage: "prompt", provider, message: p.message, placeholder: p.placeholder }),
                  p.placeholder,
                );
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
        });
        ctx.ui.notify(authPayload({ stage: "success", provider }), "info");
      } catch (e) {
        ctx.ui.notify(authPayload({ stage: "error", provider, message: e instanceof Error ? e.message : String(e) }), "error");
      } finally {
        loginAborts.delete(provider);
      }
    },
  });

  pi.registerCommand("hv-login-cancel", {
    description: "HappyVibe: cancel an in-flight /hv-login. Usage: /hv-login-cancel <provider>",
    handler: async (args) => { loginAborts.get(args.trim())?.abort(); },
  });

  pi.registerCommand("hv-logout", {
    description: "HappyVibe: remove stored credentials. Usage: /hv-logout <provider>",
    handler: async (args, ctx) => {
      const provider = args.trim();
      await (ctx.modelRegistry as any).runtime.logout(provider);
      ctx.ui.notify(authPayload({ stage: "logged_out", provider }), "info");
    },
  });

  // ── B6 agents & tools (docs/validation/d1.md §hv.agents / §hv.tools) ───────
  // Both ride the fire-and-forget notify channel (JSON in `message`), like
  // hv.context. The renderer parses them and NEVER opens the modal.

  /** The two dirs pi-subagents discovers agents from (s0.3): app-owned + project. */
  function agentDirs(): Array<{ dir: string; source: AgentSource }> {
    const dirs: Array<{ dir: string; source: AgentSource }> = [];
    // App-owned agent dir (PI_CODING_AGENT_DIR/agents) → our built-ins live here.
    if (process.env.PI_CODING_AGENT_DIR) {
      dirs.push({ dir: path.join(process.env.PI_CODING_AGENT_DIR, "agents"), source: "builtin" });
    }
    // Project-local agents override/extend them.
    dirs.push({ dir: path.join(process.cwd(), ".pi", "agents"), source: "project" });
    return dirs;
  }

  function enumerateAgents(): AgentDef[] {
    const out: AgentDef[] = [];
    for (const { dir, source } of agentDirs()) {
      let names: string[];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.endsWith(".chain.md"));
      } catch {
        continue; // dir absent — nothing to list
      }
      for (const name of names) {
        const file = path.join(dir, name);
        try {
          const def = toAgentDef(parseAgentFile(fs.readFileSync(file, "utf8")).frontmatter, source, file);
          if (def) out.push(def);
        } catch {
          /* unreadable/malformed agent file — skip */
        }
      }
    }
    return out;
  }

  pi.registerCommand("hv-agents", {
    description: "HappyVibe: emit the agent inventory (hv.agents notify)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify({ kind: "hv.agents", agents: enumerateAgents() }), "info");
    },
  });

  // ── Async subagents (docs/validation/d1.md §hv.subagent) ────────────────────
  // pi-subagents emits lifecycle events on the shared pi.events bus (never on
  // RPC stdout). We relay each as a fire-and-forget hv.subagent notify. The run
  // dir is named by its id, so control events (which carry only asyncDir) map
  // back to a runId via basename.
  const subEnvelope = (o: Record<string, unknown>): string => JSON.stringify({ kind: "hv.subagent", ...o });
  const relay = (o: Record<string, unknown>, type: "info" | "warning" = "info"): void => busUi?.notify(subEnvelope(o), type);

  // pi.events is absent in the module-level test mocks (real pi always has it).
  if (pi.events) {
    pi.events.on("subagent:async-started", (raw) => {
      const d = raw as { id?: string; agent?: string; task?: string; asyncDir?: string };
      if (!d.id) return;
      relay({ stage: "started", runId: d.id, agent: d.agent, task: d.task, asyncDir: d.asyncDir });
    });
    pi.events.on("subagent:async-complete", (raw) => {
      const d = raw as { runId?: string; id?: string; agent?: string; success?: boolean; summary?: string; state?: string };
      const runId = d.runId ?? d.id;
      if (!runId) return;
      const status = d.success === true ? "success" : d.state === "paused" ? "interrupted" : "error";
      relay({ stage: "complete", runId, agent: d.agent, status, summary: d.summary?.slice(0, 500) });
    });
    pi.events.on("subagent:control-event", (raw) => {
      const d = raw as { event?: { type?: string }; asyncDir?: string };
      if (!d.asyncDir || !d.event?.type) return;
      const activityState = d.event.type === "needs_attention" ? "needs_attention" : "long-running";
      relay({ stage: "control", runId: path.basename(d.asyncDir), activityState });
    });
  }

  // main→bridge is RPC-prompt only, so run control rides slash commands.
  // /hv-subagent-interrupt drives pi-subagents' versioned event-bus RPC
  // (subagents:rpc:v1); /hv-subagent-list resyncs active runs after a respawn.
  let rpcSeq = 0;
  const rpcRequest = (method: string, params: Record<string, unknown>): Promise<{ ok: boolean }> =>
    new Promise((resolve) => {
      const requestId = `hv-${method}-${++rpcSeq}-${Date.now()}`;
      const replyChannel = `subagents:rpc:v1:reply:${requestId}`;
      const t = setTimeout(() => { off(); resolve({ ok: false }); }, 10_000);
      const off = pi.events.on(replyChannel, (reply) => {
        clearTimeout(t);
        off();
        resolve({ ok: (reply as { success?: boolean })?.success === true });
      });
      pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    });

  pi.registerCommand("hv-subagent-interrupt", {
    description: "HappyVibe: interrupt a running async subagent. Usage: /hv-subagent-interrupt <runId>",
    handler: async (args, ctx) => {
      const runId = args.trim();
      if (!runId) return;
      const { ok } = await rpcRequest("interrupt", { runId });
      ctx.ui.notify(subEnvelope({ stage: ok ? "interrupt-sent" : "interrupt-error", runId }), ok ? "info" : "warning");
    },
  });

  pi.registerCommand("hv-subagent-list", {
    description: "HappyVibe: emit the active async subagent runs (hv.subagent active notify)",
    handler: async (_args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId() ?? undefined;
      let runs: Array<{ runId: string; agent?: string; task?: string; asyncDir: string }> = [];
      try {
        runs = listAsyncRuns(ASYNC_DIR, { states: ["queued", "running"], sessionId }).map((r) => ({
          runId: r.id,
          agent: r.steps?.[0]?.agent,
          asyncDir: r.asyncDir,
        }));
      } catch {
        /* runs dir absent — no active runs */
      }
      ctx.ui.notify(subEnvelope({ stage: "active", runs }), "info");
    },
  });

  // ── V2.B AskUserQuestion tool (docs/validation/d1.md §hv.ask-user) ────────
  // The model surfaces a decision to the user in a blocking picker. Rides
  // ctx.ui.input with the JSON payload in `title` (hv.auth prompt precedent);
  // the renderer answers {value: JSON answers} or {cancelled: true} — NO
  // timeout, NO auto-answer (permission invariant). Input is clamped, never
  // rejected: adjustments ride back on the tool result as notes.
  pi.registerTool({
    name: "ask_user",
    label: "Ask the user",
    description:
      "Ask the user to decide something you genuinely cannot decide or verify yourself " +
      "(preferences, trade-offs, ambiguous requirements). Blocks until the user answers. " +
      "Rules: at most 4 questions per call; options must be mutually exclusive and exhaustive " +
      "for the decision; put your recommended option FIRST with its label suffixed ' (Recommended)'; " +
      "never ask about things you can check yourself (files, code, docs); keep labels 1-5 words " +
      "with the trade-offs in the description. The UI adds a free-text 'Other' option automatically — " +
      "do not add one. If the user dismisses the question, proceed with your best judgment.",
    parameters: Type.Object({
      intent: Type.String({
        description:
          "REQUIRED on every call. One short customer-facing sentence: what you are deciding and why (shown to the user as the headline).",
      }),
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The full question text shown to the user." }),
          header: Type.String({ maxLength: HEADER_MAX, description: `Chip label for this question, at most ${HEADER_MAX} characters.` }),
          multiSelect: Type.Boolean({ description: "true = the user may pick several options (checkboxes)." }),
          options: Type.Array(
            Type.Object({
              label: Type.String({ description: "1-5 words. Suffix the recommended option with ' (Recommended)' and list it first." }),
              description: Type.String({ description: "The trade-offs of this choice, one or two sentences." }),
              preview: Type.Optional(Type.String({ description: "Optional monospace markdown block shown beside the options. Single-select questions only." })),
            }),
            { minItems: 2, maxItems: MAX_OPTIONS },
          ),
        }),
        { minItems: 1, maxItems: MAX_QUESTIONS },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { intent, questions: rawQuestions } = params as { intent?: string; questions?: unknown };
      const { questions, notes } = normalizeQuestions(rawQuestions);
      if (questions.length === 0) {
        return { content: [{ type: "text", text: `ask_user received no valid questions — nothing was shown to the user (${notes.join("; ")}).` }], details: {} };
      }
      // Blocking, indefinitely: same invariant as permission prompts.
      const value = await ctx.ui.input(JSON.stringify({ kind: "hv.ask-user", intent: intent ?? "", questions }), "");
      if (value === undefined) {
        return { content: [{ type: "text", text: DISMISSED_RESULT }], details: {} };
      }
      const answers = parseAnswers(value);
      let text = answers ? answersMarkdown(answers) : `The user answered: ${value}`;
      if (notes.length) text += `\n\n(Your input was adjusted: ${notes.join("; ")}.)`;
      return { content: [{ type: "text", text }], details: { answers } };
    },
  });

  // ── §23 Plan Mode: registered tools ──────────────────────────────────────
  // plan_complete: model submits the finished plan. Blocking round-trip — main
  // writes the workspace file and answers with its path (becomes the tool result
  // AND planPath). Same blocking channel as ask_user (JSON in the input title).
  pi.registerTool({
    name: "plan_complete",
    label: "Complete plan",
    description:
      "Submit the finished, decision-complete implementation plan for the user to review. " +
      "Only available in Plan Mode, and only as your FINAL action of the turn (call it alone). " +
      "Pass the complete plan as Markdown with a '# title', a '## Tasks' GFM checklist (- [ ] …), " +
      "and a '## Verification' section. On revision, pass a complete replacement plan, not a delta.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence describing the plan." }),
      plan: Type.String({ description: "The complete implementation plan as Markdown (title + summary + ## Tasks checklist + ## Verification)." }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      if (!plan.enabled) return { content: [{ type: "text", text: "plan_complete is only available in Plan Mode." }], details: {} };
      const { plan: planMd } = params as { plan?: string };
      if (typeof planMd !== "string" || !planMd.trim()) {
        return { content: [{ type: "text", text: "plan_complete requires a non-empty plan." }], details: {} };
      }
      // Main writes .agents/plans/NNN-slug.md and returns the workspace-relative
      // path; on failure it returns an error string (never leaves us blocked).
      const relPath = await ctx.ui.input(JSON.stringify({ kind: "hv.plan-write", plan: planMd }), "");
      if (typeof relPath !== "string" || !relPath) {
        return { content: [{ type: "text", text: "The plan could not be saved. Stay in Plan Mode and try plan_complete again." }], details: {} };
      }
      plan.planPath = relPath;
      lastPlanCompleteCallId = toolCallId;
      persistPlan(pi);
      emitPlan(ctx.ui);
      return {
        content: [{ type: "text", text: `Plan saved to ${relPath}. It is ready for the user to review and implement — do not implement it yourself; wait for the user.` }],
        details: { planPath: relPath },
      };
    },
  });

  // plan_start: model enters Plan Mode from normal chat. Restrictive-only —
  // leaving Plan Mode is human-only (no plan_off tool exists), the §23 invariant.
  pi.registerTool({
    name: "plan_start",
    label: "Start plan mode",
    description:
      "Enter Plan Mode for this session when the user asks you to plan before acting. In Plan Mode " +
      "you explore read-only and draft an implementation plan; you cannot modify anything. Leaving " +
      "Plan Mode and starting implementation are the user's choice — you cannot exit it yourself.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you will plan." }),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!plan.enabled) {
        plan = { enabled: true, planPath: undefined };
        applyPlanTools(pi);
        persistPlan(pi);
        emitPlan(ctx.ui);
      }
      return { content: [{ type: "text", text: "Plan Mode is on. Explore read-only, ask any decisions via ask_user, then finish with plan_complete." }], details: {} };
    },
  });

  // plan_status_update: model records a TERMINAL fact (never grants power). Main
  // rewrites the plan file's front-matter and audits {who:"model"}.
  pi.registerTool({
    name: "plan_status_update",
    label: "Update plan status",
    description:
      "Record the terminal status of the current plan: 'implemented' once you have completed the plan " +
      "AND its Verification passes, or 'cancelled' if the user abandons it. Only these two values.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence." }),
      status: Type.Union([Type.Literal("implemented"), Type.Literal("cancelled")], { description: "'implemented' (verification passed) or 'cancelled'." }),
      note: Type.Optional(Type.String({ description: "Optional short note (e.g. what verification confirmed)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { status, note } = params as { status?: string; note?: string };
      if (!plan.planPath) return { content: [{ type: "text", text: "No plan is associated with this session." }], details: {} };
      if (status !== "implemented" && status !== "cancelled") {
        return { content: [{ type: "text", text: "status must be 'implemented' or 'cancelled'." }], details: {} };
      }
      ctx.ui.notify(JSON.stringify({ kind: "hv.plan-status", status, note: note ?? "" }), "info");
      return { content: [{ type: "text", text: `Plan marked ${status}.` }], details: { status } };
    },
  });

  // /hv-plan on|off — driven from main (the toggle, Implement, Discard). Enter is
  // also reachable via plan_start; exit/implement is human-only via this command.
  pi.registerCommand("hv-plan", {
    description: "HappyVibe: plan mode. Usage: /hv-plan on|off",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg !== "on" && arg !== "off") {
        ctx.ui.notify(JSON.stringify({ kind: "hv.plan", stage: "error", message: "Usage: /hv-plan on|off" }), "error");
        return;
      }
      if (arg === "on") {
        if (!plan.enabled) plan = { enabled: true, planPath: undefined };
      } else {
        plan.enabled = false;
        // Context hygiene: drop the plan_complete call/result from future model
        // context (it's a completed turn by now) — reuse the marks mechanism.
        if (lastPlanCompleteCallId) {
          contextMarks.add(`tool:${lastPlanCompleteCallId}` as MarkKey);
          persistMarks(pi);
          lastPlanCompleteCallId = undefined;
        }
      }
      applyPlanTools(pi);
      persistPlan(pi);
      emitPlan(ctx.ui);
    },
  });

  pi.registerCommand("hv-tools", {
    description: "HappyVibe: emit the tool inventory (hv.tools notify)",
    handler: async (_args, ctx) => {
      // Built-in LLM tools come from the extension side — get_commands over RPC
      // does NOT list them (s0.3). Permission state is joined renderer-side via
      // hv:eval-rules (the SAME evaluate() this bridge's gate runs), so the
      // rules logic is never forked into two implementations.
      const tools = pi.getAllTools().map((t) => ({
        name: t.name,
        description: t.description ?? "",
        source: t.sourceInfo?.source ?? t.sourceInfo?.scope ?? "builtin",
      }));
      ctx.ui.notify(JSON.stringify({ kind: "hv.tools", tools }), "info");
    },
  });
}
