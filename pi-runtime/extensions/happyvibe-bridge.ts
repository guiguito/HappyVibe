import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { answersMarkdown, DISMISSED_RESULT, normalizeQuestions, parseAnswers, HEADER_MAX, MAX_OPTIONS, MAX_QUESTIONS } from "./hv-ask-user";
import { EMPTY_RULES, evaluate, isWaitTool, parseRulesFile, type RulesFile, type Verdict } from "./hv-rules";
import { checkCommand, hasBackgroundAmpersand, TERMINAL_STEER_LINE, TERMINAL_TOOL_DESCRIPTIONS } from "./hv-terminal";
import { unwrapMcpCall } from "./hv-mcp";
import {
  acceptableMarks, filterMessages, serializeEntries, buildToolDefs,
  type AgentMessage, type MarkKey, type SessionEntry, type ToolSpecLike,
} from "./hv-context";
import { parseAgentFile, renderSubagentSection, toAgentDef, type AgentDef, type AgentSource } from "./hv-agents";
import { FILE_TOOLS, nearestAgentsMd, nestedFileList, renderNestedSection, toolFilePath } from "./hv-agents-md";
import {
  buildPlanPrompt, forcedPlanOffState, gatePlanCall, PLAN_STATE_TYPE, restorePlanState, shouldForcePlanOff,
  type PlanState, type PlanSessionEntry,
} from "./hv-plan";
import { parseBuiltins } from "./hv-builtins";
import {
  buildUseSkillGuidance, findByName, loadManifest, matchReadPath, skillTokenLines, type SkillManifest,
} from "./hv-skills";
import { commandName, pairExpanded, rememberTyped, type TemplatePairState } from "./hv-prompt-templates";
// Async subagents (PRD §12): pi-subagents is co-resident on the SAME pi.events
// bus, so the bridge subscribes to its in-process lifecycle events and relays
// them as hv.subagent notifies (they never reach RPC stdout on their own). The
// active-run list + run dir root come straight from pi-subagents so a respawn
// can resync cards — no public surface returns the {runId, agent, asyncDir} triple
// that needs (snapshotBackgroundWork() is the inverse API and comes back empty;
// the status RPC's structured `fleet` deliberately withholds run identifiers,
// rpc.ts:76). Imported by RELATIVE PATH, not the bare `pi-subagents/...`
// specifier: from 0.35.0 the package ships an `exports` map listing five entries,
// neither of these among them, and an exports map only gates BARE specifiers.
// Both forms are equally pin-coupled and both fail loudly at extension load;
// tests/subagent-runs-contract.test.ts is the pin-bump gate.
import { listAsyncRuns } from "../node_modules/pi-subagents/src/runs/background/async-status.ts";
import { ASYNC_DIR } from "../node_modules/pi-subagents/src/shared/types.ts";

const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  // §26 + §13's MCP rule: the permission prompt shows what will RUN. `intent` is
  // the model's own words and must never be what a user approves against — so
  // terminal_run summarises as its command, exactly like bash.
  if ((toolName === "bash" || toolName === "terminal_run") && typeof input.command === "string") {
    return input.command.slice(0, 300);
  }
  return JSON.stringify(input).slice(0, 300);
}

/**
 * §26: main ALWAYS answers a hv.terminal-* input, with an error string on
 * failure — same contract as hv.plan-write, and for the same reason: a bridge
 * left waiting on ctx.ui.input hangs the turn with no way out.
 */
function terminalReply(raw: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  if (typeof raw !== "string" || !raw) {
    return {
      content: [{ type: "text", text: "The terminal request failed. Try again, or start a new terminal." }],
      details: {},
    };
  }
  try {
    const p = JSON.parse(raw) as { ok?: boolean; reason?: string; text?: string } & Record<string, unknown>;
    if (p.ok === false) {
      return { content: [{ type: "text", text: p.reason ?? "The terminal request was refused." }], details: p };
    }
    return { content: [{ type: "text", text: p.text ?? JSON.stringify(p) }], details: p };
  } catch {
    return { content: [{ type: "text", text: raw }], details: {} };
  }
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
// "use_skill" (§14): loading a skill goes through requireIntent like MCP, so a
// skill load surfaces as a transcript card with a model-authored "why". Built-in
// `read` can't carry intent (params stripped), which is exactly why a raw read of
// a SKILL.md only gets the derived-label fallback card.
// §26: terminal_run/terminal_kill take the REQUIRED intent, per the standing rule
// above. `subagent`'s demotion to optional (below) is deliberately NOT copied — a
// terminal that starts is a card in someone's transcript and must say why.
const INTENT_TOOLS = ["ask_user", "mcp", "use_skill", "terminal_run", "terminal_kill"]; // ask_user declares intent in its own schema — requireIntent's guard makes this a no-op for it
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
/**
 * §13 round 12 — `enabled` gates the whole injection.
 *
 * The switch lives HERE rather than at the two call sites so there is one
 * place to be wrong about, and so a test can cover exactly what ships. Off
 * changes LABELS only: tool cards already fall back to a factual derived label
 * when the model omits an intent, and the permission prompt has always shown
 * the factual action rather than the model's sentence.
 */
/**
 * §13 round 12 — the switch has to reach the bridge's OWN tools too.
 *
 * requireIntent skips any tool whose schema ALREADY has `intent` ("already
 * wired"), and every tool this file registers declares it directly in its
 * Type.Object. So gating requireIntent alone removed intent from the MCP proxy,
 * the adapter's direct tools and subagent — and left it on ask_user, use_skill,
 * terminal_run/terminal_kill and the three plan tools. Reported as "intent is
 * turned off and it is still being injected", and correctly: off has to mean off.
 *
 * Selected by OWNER rather than by a name list. A hardcoded list drifts the
 * moment a tool is added, and matching this file's own path cannot touch an MCP
 * server tool that legitimately declares its own `intent` parameter — which the
 * direct-mode rule above deliberately leaves alone.
 *
 * Schema only: a tool's prose description may still mention intent. Pi does not
 * hard-validate registered-tool args (W1.1), so a model that passes one anyway
 * is harmless, and the saving that matters — the sentence it would compose per
 * call — comes from the parameter being absent.
 */
export function stripIntent(pi: ExtensionAPI, enabled = true): void {
  if (enabled) return;
  for (const t of pi.getAllTools()) {
    if (!t.sourceInfo?.path?.includes("happyvibe-bridge")) continue;
    const params = t.parameters as MutableParams | undefined;
    if (!params?.properties?.intent) continue;
    delete params.properties.intent;
    params.required = (params.required ?? []).filter((r) => r !== "intent");
  }
}

export function requireIntent(pi: ExtensionAPI, enabled = true): void {
  if (!enabled) return;
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

// ── §14 Skills ───────────────────────────────────────────────────────────────
// The session's loaded-skills manifest (HV_SKILLS_FILE), written by main to the
// exact set of skills this session spawned with (approved ∩ enabled ∩ active).
// Re-read on session_start so a respawn (hibernation/reload) reflects new config.
let skillManifest: SkillManifest = { skills: [] };

// ── §24 Commands ─────────────────────────────────────────────────────────────
// One slot holding the typed text between the `input` and `before_agent_start`
// hooks of a single prompt() call. Pi awaits handlers serially between those two
// points, so at most one prompt is ever mid-flight — see hv-commands.ts.
const commandPair: TemplatePairState = {};

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
// `restored` marks the one emit that replays persisted state on session_start
// (respawn/hibernation) — main uses it to reconcile a stale enabled:true against
// the plan file, without reverting a live re-entry into plan mode.
function emitPlan(ui: { notify(m: string, t?: "info" | "warning" | "error"): void }, restored = false): void {
  ui.notify(JSON.stringify({ kind: "hv.plan", enabled: plan.enabled, planPath: plan.planPath ?? null, restored }), "info");
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
      // Drop mutating tools; ALWAYS keep the plan tools + ask_user offered, even
      // if they weren't in the captured baseline (else the model can't finish).
      const kept = toolsBeforePlan.filter((t) => !["edit", "write", "multi_edit", "subagent"].includes(t));
      const required = ["plan_complete", "plan_status_update", "ask_user"];
      set.call(pi, [...new Set([...kept, ...required])]);
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
// §26 adds "terminal": a refusal the terminal feature itself makes (a multi-line
// command, or a bash call backgrounded with `&`). Distinct from "rule" because
// no rule fired, and from "plan" because it applies outside Plan Mode too.
type AuditSource = "rule" | "user" | "dangerous" | "safe-default" | "plan" | "terminal";

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
  // §13 round 6: global on/off for plan mode + ask_user, resolved by main at
  // spawn (same pattern as HV_BYPASS). Fail-open on a corrupt value.
  const builtins = parseBuiltins(process.env.HV_BUILTINS);

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

  // session_start is NOT enough on its own: pi-mcp-adapter >=2.17.0 re-registers
  // its "mcp" proxy tool whenever the proxy DESCRIPTION changes (syncProxyTool →
  // registerProxyTool), and each registration builds a FRESH Type.Object schema.
  // That silently discards the `intent` property requireIntent injected at
  // session_start, so the model stops being asked for a headline and
  // tool_execution_start arrives with intent === undefined. Re-applying per turn
  // costs nothing — requireIntent early-continues on every already-wired tool —
  // and re-wires whatever the adapter replaced since the last turn.
  // Regression-tested by tests/mcp-bridge.test.ts (live).
  // §13 round 12: the headline is bought with tokens, so it has a switch. In
  // proxy mode that is five tools; with a server exposing tools DIRECTLY it is
  // every tool that server publishes, which is where the cost actually scales.
  pi.on("turn_start", () => { requireIntent(pi, builtins.intent); stripIntent(pi, builtins.intent); });

  pi.on("session_start", async (_event, ctx) => {
    requireIntent(pi, builtins.intent); // all extensions have registered by now (idempotent across reloads)
    stripIntent(pi, builtins.intent); // …and take it off the bridge's own tools, which declare it themselves
    skillManifest = loadManifest(); // §14: reflect this session's loaded skills
    const entries = ctx.sessionManager.getEntries() as unknown as SessionEntry[];
    restoreMarks(entries);
    // §23: plan state SURVIVES respawn (unlike dangerous mode). Restore + re-emit
    // so the renderer resyncs its banner/toggle after a hibernation/MCP respawn.
    plan = restorePlanState(entries as unknown as PlanSessionEntry[]);
    // §13 round 6: Plan Mode disabled globally ⇒ a session that was mid-plan comes
    // back with plan mode OFF (see shouldForcePlanOff — without it the clamp would
    // keep running with every exit path unregistered). planPath is PRESERVED: the
    // plan file is the user's artifact and re-enabling the feature should find it.
    const forcedPlanOff = shouldForcePlanOff(builtins.plan, plan);
    if (forcedPlanOff) plan = forcedPlanOffState(plan);
    // Only re-emit when there's real state to resync after a respawn — a spurious
    // "disabled" notify on every fresh session would be the first ui-request other
    // bridge tests wait on, and it's redundant (the renderer defaults to off).
    if (forcedPlanOff) {
      // MUST still notify: without it the renderer keeps its pre-respawn
      // enabled:true and shows a read-only banner over a session that is no
      // longer clamped. Deliberately NOT applyPlanTools — the feature is off, so
      // nothing should be hidden from the model.
      emitPlan(ctx.ui, true);
      // …and MUST persist: leaving enabled:true in the session file meant that
      // re-enabling Plan mode later restored a clamped session with no user
      // action (and main's reconcile skips it when planPath is null).
      persistPlan(pi);
    } else if (plan.enabled || plan.planPath) {
      applyPlanTools(pi);
      emitPlan(ctx.ui, true);
    }
    busUi = ctx.ui;
  });

  // §24 Commands: capture the ORIGINAL typed text before Pi expands a prompt
  // template over it. This handler sits in front of EVERY user prompt, so it is
  // written to be incapable of affecting one: it returns undefined (→
  // {action:"continue"}, runner.js:958-960) and swallows its own throw. Pi
  // already wraps each input handler in try/catch and only reports an
  // extension_error (runner.js:933-955), so this is belt-and-braces — but the
  // failure mode here would be "no prompt reaches the model", and a transcript
  // nicety must never be able to cause that. Same rule as
  // before_provider_request (docs/validation/tc1.md): the hook fails OPEN.
  pi.on("input", async (event) => {
    try {
      rememberTyped(commandPair, (event as { text?: string }).text ?? "");
    } catch {
      /* never block a prompt for a card */
    }
    return undefined;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // §24: the expansion landed — pair it with what the user actually typed and
    // tell main, which persists {typed, sha256(expanded)} so the card survives a
    // reload. Wrapped because this handler also owns the system prompt: a throw
    // here would cost the turn its AGENTS.md/agents/plan/skills injection.
    try {
      const pair = pairExpanded(commandPair, (event as { prompt?: string }).prompt ?? "");
      if (pair) {
        ctx.ui.notify(
          JSON.stringify({ kind: "hv.prompt-template", name: commandName(pair.typed), ...pair }),
          "info",
        );
      }
    } catch {
      /* fail open */
    }
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
    const planSection = builtins.plan && plan.enabled ? "\n\n" + buildPlanPrompt(builtins.planAppend) : "";
    // §14: steer the model to use_skill (intent card) over a raw SKILL.md read.
    const skillSection = buildUseSkillGuidance(skillManifest);
    // §26: steer long-running commands to terminal_run rather than a
    // backgrounded bash call. Only while the group is registered — otherwise
    // the prompt would name a tool the model does not have.
    const terminalSection = builtins.terminal ? "\n\n" + TERMINAL_STEER_LINE : "";
    const injected = sp + section + agentsSection + planSection + skillSection + terminalSection;
    systemText = injected;
    const opts = (event.systemPromptOptions ?? {}) as {
      selectedTools?: unknown[];
      contextFiles?: Array<{ path?: string; content?: string }>;
    };
    // v5: per-tool schema size (estimated from the LLM tool spec) for the
    // context-panel drill-in. Pi doesn't expose real token weight, so ≈chars/4.
    const toolDefs = buildToolDefs(opts.selectedTools, pi.getAllTools() as ToolSpecLike[]);
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
    if (section || agentsSection || planSection || skillSection) return { systemPrompt: injected };
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
          // §14: skills carries the two system-prompt weight lines (global/workspace).
          system: systemBlock ? { ...systemBlock, nested: nestedList(), skills: skillTokenLines(skillManifest) } : null,
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
    if (isWaitTool(tool)) {
      return {
        block: true,
        reason:
          "Do NOT wait. This is an interactive HappyVibe session: the subagent's result " +
          "will be delivered to you automatically as a new turn the moment it finishes. End " +
          "your turn now with a brief note that the work is running in the background — do not " +
          `call ${tool}() or poll with subagent status. You will be prompted with the result.`,
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

    // §14: raw-read fallback — the model loaded a skill by reading its SKILL.md
    // instead of calling use_skill (built-ins can't carry intent). Surface it as
    // a skill card with a derived label (no intent) + flag it heuristic for audit.
    // The read still proceeds through the normal gate below (SKILL.md is inside
    // the workspace or an approved dir); this is a transparency signal, not a gate.
    if (tool === "read") {
      const hit = matchReadPath(skillManifest, input, process.cwd());
      if (hit) {
        ctx.ui.notify(JSON.stringify({ kind: "hv.skill", stage: "invoked", name: hit.name, scope: hit.scope, detected: true }), "info");
      }
    }

    // §26: refuse a multi-line command BEFORE the permission prompt. This
    // ordering IS the mechanism — describeCommand builds the modal's label from
    // the first segment only, so prompting here would ask the user to approve a
    // string they are being shown just part of.
    if (tool === "terminal_run") {
      const checked = checkCommand(input.command);
      if (!checked.ok) {
        audit(ctx.ui, { tool, summary, decision: "deny", source: "terminal" });
        return { block: true, reason: checked.reason };
      }
    }

    // §26: once terminals exist, `npm run dev &` is the model reaching for the
    // broken thing with the working thing beside it. Gated on builtins.terminal
    // because with the group OFF there is nowhere to redirect to, and blocking
    // `&` would turn a context-saving setting into a capability removal it never
    // advertised.
    if (builtins.terminal && tool === "bash" && typeof input.command === "string" && hasBackgroundAmpersand(input.command)) {
      audit(ctx.ui, { tool, summary, decision: "deny", source: "terminal" });
      return {
        block: true,
        reason:
          "Backgrounding with `&` hides the process from the user and leaves them unable to stop it. " +
          "Use terminal_run instead — the same long-running command becomes a card they can watch, " +
          "type into and kill, and you can poll it with terminal_read.",
      };
    }

    // §23 Plan Mode clamp — runs BEFORE dangerous/bypass and the rule engine, so
    // plan mode wins over bypass (read-only must mean read-only). Applies to NEW
    // calls only; an in-flight async delegation is untouched.
    let planFloorAsk = false;
    if (builtins.plan && plan.enabled) {
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
  if (builtins.askUser) pi.registerTool({
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

  // ── §14 Skills: use_skill tool (docs/validation/sk1.md §hv.skill) ─────────
  // Loading a skill = calling use_skill(name), which returns the SKILL.md body.
  // It declares `intent` in its own schema below (so requireIntent's "already
  // wired" guard skips it, and stripIntent is what removes it when the §13
  // round-12 switch is off), so a skill
  // load surfaces as a transcript card with a model-authored "why", and each
  // invocation is auditable (hv.skill notify). Prompting is steered here via the
  // <happyvibe-skills> system block; a raw read is caught by the fallback above.
  pi.registerTool({
    name: "use_skill",
    label: "Use skill",
    description:
      "Load a HappyVibe skill's full instructions when a task matches it. Pass the skill `name` " +
      "(as shown in the available skills) and a short `intent`. Returns the skill's SKILL.md so " +
      "you can follow its workflow. Prefer this over reading a SKILL.md file directly.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: why you are loading this skill." }),
      name: Type.String({ description: "The skill name to load (from the available skills list)." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { name } = params as { name?: string };
      const entry = name ? findByName(skillManifest, name) : undefined;
      if (!entry) {
        const available = skillManifest.skills.map((s) => s.name).join(", ") || "(none loaded)";
        return { content: [{ type: "text", text: `No loaded skill named "${name ?? ""}". Available skills: ${available}.` }], details: {} };
      }
      let body: string;
      try {
        body = fs.readFileSync(entry.skillMdPath, "utf8");
      } catch (e) {
        return { content: [{ type: "text", text: `Could not read skill "${entry.name}": ${e instanceof Error ? e.message : String(e)}` }], details: {} };
      }
      // Audit + (renderer) invocation card. Not a raw-read (detected:false).
      ctx.ui.notify(JSON.stringify({ kind: "hv.skill", stage: "invoked", name: entry.name, scope: entry.scope, detected: false }), "info");
      return {
        content: [{ type: "text", text: `<skill name="${entry.name}" location="${entry.skillMdPath}">\nReferences are relative to ${entry.dir}.\n\n${body}\n</skill>` }],
        details: { skill: entry.name },
      };
    },
  });

  // ── §26 part 2: agent terminals ──────────────────────────────────────────
  // Gated as ONE group, following Plan mode's precedent: an agent that can run
  // but not read starts processes it cannot observe, and one that can run and
  // read but not kill cannot clean up after itself. Those are not configurations
  // anyone wants, so they are not reachable.
  //
  // Every tool is a thin shell over a BLOCKING hv.terminal-* input: main owns the
  // PTYs (§26 part 1), so it owns the cap, the busy-reuse refusal and the
  // interleave hold too. terminalReply guarantees the turn never hangs.
  if (builtins.terminal) {
  pi.registerTool({
    name: "terminal_run",
    label: "Run in terminal",
    // The descriptions live in hv-terminal.ts because the All Tools page shows
    // them read-only (§13 round 6), and "read-only" means nothing if the page
    // renders a second copy that can drift from what the model is told.
    description: TERMINAL_TOOL_DESCRIPTIONS.terminal_run,
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you are running and why." }),
      command: Type.String({ description: "One command line. No embedded newlines." }),
      terminalId: Type.Optional(Type.String({ description: "Reuse this terminal instead of opening a new one. It must be idle." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { command, terminalId, intent } = params as { command?: unknown; terminalId?: string; intent?: string };
      // Belt and braces: the tool_call handler already refused a multi-line
      // command before the permission prompt (that ordering is the point), so
      // this arm only catches a call that reached execute some other way.
      const checked = checkCommand(command);
      if (!checked.ok) return { content: [{ type: "text", text: checked.reason }], details: {} };
      // `intent` rides along so main can echo it on the hv.terminal notify: the
      // CARD leads with the model's headline (§7). The permission prompt does
      // not see this — it was built from the factual summary long before.
      const raw = await ctx.ui.input(
        JSON.stringify({ kind: "hv.terminal-run", command: checked.command, terminalId, intent }),
        "",
      );
      return terminalReply(raw);
    },
  });

  pi.registerTool({
    name: "terminal_read",
    label: "Read terminal",
    description: TERMINAL_TOOL_DESCRIPTIONS.terminal_read,
    parameters: Type.Object({
      terminalId: Type.String({ description: "The terminal to read." }),
      lines: Type.Optional(Type.Number({ description: "How many trailing lines. Default 200, capped at 200." })),
      waitMs: Type.Optional(Type.Number({ description: "Wait up to this many ms for output to go quiet first. Capped at 15000." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { terminalId, lines, waitMs } = params as { terminalId?: string; lines?: number; waitMs?: number };
      const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.terminal-read", terminalId, lines, waitMs }), "");
      return terminalReply(raw);
    },
  });

  pi.registerTool({
    name: "terminal_kill",
    label: "Stop terminal",
    description: TERMINAL_TOOL_DESCRIPTIONS.terminal_kill,
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you are stopping and why." }),
      terminalId: Type.String({ description: "The terminal to stop." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { terminalId } = params as { terminalId?: string };
      const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.terminal-kill", terminalId }), "");
      return terminalReply(raw);
    },
  });
  } // builtins.terminal

  // ── §23 Plan Mode: registered tools ──────────────────────────────────────
  // Gated as a whole block: plan_start is the model's own entry point into Plan
  // Mode, and leaving is deliberately human-only (no plan_off tool — the §23
  // invariant). If the toggle only hid the UI while plan_start still existed,
  // the model could still put the session into read-only mode with no way for
  // the user to exit it — so disabling must remove the tools too.
  if (builtins.plan) {
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
      // §23 human-only exit: both statuses are TERMINAL facts about an
      // already-left plan (implemented / cancelled), so recording one while still
      // planning is meaningless — and it was an escape hatch. Writing "cancelled"
      // to the file made main's next restore-reconcile (shouldReconcilePlanOff)
      // fire `/hv-plan off` on the following respawn, letting the MODEL lift a
      // clamp only a human may lift. Refuse it while plan mode is on.
      if (plan.enabled) {
        return {
          content: [{ type: "text", text: "Plan status can only be recorded after leaving Plan Mode. Submit the plan with plan_complete instead." }],
          details: {},
        };
      }
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
  } // builtins.plan

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
