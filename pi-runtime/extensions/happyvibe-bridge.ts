import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { answersMarkdown, DISMISSED_RESULT, normalizeQuestions, parseAnswers, HEADER_MAX, MAX_OPTIONS, MAX_QUESTIONS } from "./hv-ask-user";
import { EMPTY_RULES, evaluate, isResultWait, isShellTool, parseRulesFile, type RuleAction, type RulesFile, type Verdict } from "./hv-rules";
import {
  createChildOutputStore, rememberTwResult, substituteDeliveries,
} from "./hv-subagent-delivery";
import { checkCommand, hasBackgroundAmpersand, TERMINAL_STEER_LINE, TERMINAL_TOOL_DESCRIPTIONS } from "./hv-terminal";
import { BROWSER_TOOL_DESCRIPTIONS, browserRuleName, hostOf, isLocalHost, schemeRefusal, wrapUntrusted } from "./hv-browser";
import { WEB_CAPS, WEB_STEER_LINE, WEB_TOOL_DESCRIPTIONS, WEB_URL_TOOLS, webRefusal } from "./hv-web";
import { DOCUMENT_TOOL, DOCUMENT_TOOL_DESCRIPTIONS, documentFactsLine, documentReadRefusal, type DocumentFacts } from "./hv-document";
import { isPiMcpTool, mcpCallInfo, mcpNamespace, PI_MCP_SOURCE, READ_RESOURCE_TOOL, TOOL_SEARCH_LIMIT, TOOL_SEARCH_SOURCE } from "./hv-mcp";
import { workspaceRegistrations } from "./hv-mcp-config";
import {
  acceptableMarks, filterMessages, serializeEntries, buildToolDefs,
  type MarkKey, type SessionEntry, type ToolSpecLike,
} from "./hv-context";
import { isSlashCommandPath, parseAgentFile, renderSubagentSection, type AgentDef } from "./hv-agents";
import { CHILD_CHOICES, WORKFLOW_CHOICES, WORKFLOW_TOOL, declaresTools, twAgentOf, twBoundary, workflowAgents, workflowName, workflowSource, type TwAgentInfo } from "./hv-tw-gate";
import { setChildPolicy } from "./hv-child-policy";
import { registerTwRelay } from "./hv-tw-relay";
import { FILE_TOOLS, nearestAgentsMd, nestedFileList, renderNestedSection, toolFilePath } from "./hv-agents-md";
import {
  buildPlanPrompt, forcedPlanOffState, gatePlanCall, PLAN_STATE_TYPE, resolvePlanVerdict, restorePlanState, shouldForcePlanOff,
  type PlanState, type PlanSessionEntry,
} from "./hv-plan";
import { buildReadonlyPrompt, gateReadonlyCall, readonlyFromEnv } from "./hv-readonly";
import { parseBuiltins } from "./hv-builtins";
import { memoryTokenLines, readIndex, renderMemorySection } from "./hv-memory";
import { boundaryRuleName, READ_ONLY_CHILD_TOOLS } from "./hv-subagent-boundary";
import {
  findByName, loadManifest, matchReadPath, replaceSkillsSentence, skillTokenLines, type SkillManifest,
} from "./hv-skills";
import { commandName, pairExpanded, rememberTyped, type TemplatePairState } from "./hv-prompt-templates";

/**
 * PRD §4 (Windows round): the filesystem is case-insensitive on win32, so every path
 * a rule inspects folds case and separators first. Read here rather than inside the
 * engine, which stays import-free because the renderer loads it too.
 */
const CI_PATHS = process.platform === "win32";

const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  // §35: the only schedule tool that reaches a permission prompt is delete (the
  // other two confirm in the drawer), and what you are approving is a NAMED
  // schedule. The bridge has only the id, so it says so here and ships the id
  // on the envelope as `scheduleId`; MAIN rewrites this to the schedule's title
  // and recurrence in `stampPrompt` (permissionSummary, scheduleEnvelopes.ts).
  // Either way it is FACTUAL, never the model's `intent` — the §7 round-1 split.
  if (toolName === "schedule_delete" && typeof input.id === "string") {
    return `schedule ${input.id}`;
  }
  // §26 + §13's MCP rule: the permission prompt shows what will RUN. `intent` is
  // the model's own words and must never be what a user approves against — so
  // terminal_run summarises as its command, exactly like bash.
  if ((isShellTool(toolName) || toolName === "terminal_run") && typeof input.command === "string") {
    return input.command.slice(0, 300);
  }
  // §28: a navigation's factual action IS its URL — same rule, same shape.
  if ((toolName === "browser_navigate" || toolName === "browser_open") && typeof input.url === "string") {
    return input.url.slice(0, 300);
  }
  // §32: same rule a third time. A fetch/map/crawl's factual action is its URL,
  // and a search's is the query that leaves the machine — which is the thing a
  // deny rule on web_search would be protecting.
  if (WEB_URL_TOOLS.has(toolName) && typeof input.url === "string") {
    return input.url.slice(0, 300);
  }
  if (toolName === "web_search" && typeof input.query === "string") {
    return input.query.slice(0, 300);
  }
  // §33: a memory call's summary is the WHOLE QUESTION being asked — the prompt renders it as
  // the fact it is (scope, kind, name, summary, body) and diffs it against what is already
  // stored. So it must stay PARSEABLE, and the generic arm below cannot deliver that: it slices
  // the SERIALIZED JSON at 300 chars, which for a memory cuts mid-string and leaves the modal
  // with nothing to parse. Found only in the GUI — the prompt said "Saving a memory" and showed
  // no memory at all, while every unit test fed it well-formed args and passed.
  //
  // Cap the FIELD, never the serialized string, and cap it at the store's own body limit so a
  // memory that is legal to save is always legal to show in full.
  if (toolName.startsWith("memory_")) {
    const { intent: _words, ...factual } = input;
    if (typeof factual.content === "string") factual.content = factual.content.slice(0, 4096);
    return JSON.stringify(factual);
  }
  // …and for EVERYTHING else, strip `intent` rather than special-casing the
  // tools that happen to carry one.
  //
  // The two arms above are the readable cases; this line is the invariant. A
  // per-tool allowlist leaked twice: `terminal_kill` and `subagent` declare
  // `intent` in their own schemas, so their summary was JSON containing it, the
  // modal re-parsed that JSON (PermissionModal argsFromSummary) and toolLabel
  // preferred `intent` — meaning the headline a user approved against was the
  // model's own sentence. §13's rule is stated absolutely, so it is enforced
  // absolutely, in one place, for every tool that exists now or later.
  const { intent: _modelWords, ...factual } = input;
  return JSON.stringify(factual).slice(0, 300);
}

/** The tool's own `url` argument when it has one — web_search and browser_close do not. */
const asUrl = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * §28: the same contract as terminalReply, plus two things only the browser has.
 *
 * `untrusted` marks a payload as PAGE-DERIVED and the bytes are WRAPPED in an
 * element naming their source (X5) — prompt injection has no mechanical fix, so
 * the least we do is never hand the model page bytes that look like our own
 * words, and never leave it guessing where they stop. `source` is the caller's,
 * not the payload's: this one helper serves both the browser tools and the web
 * tools, and only the caller knows which it is. `imageBase64` becomes
 * a real image content block: AgentToolResult.content is (TextContent |
 * ImageContent)[], verified in pi-agent-core's types.d.ts, so a vision model
 * gets the screenshot itself rather than a description of one.
 */
function browserReply(raw: unknown, source: "web" | "browser", url?: string): {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  details: Record<string, unknown>;
} {
  if (typeof raw !== "string" || !raw) {
    return {
      content: [{ type: "text", text: "The browser request failed. Try browser_open again." }],
      details: {},
    };
  }
  try {
    const p = JSON.parse(raw) as {
      ok?: boolean; reason?: string; text?: string; untrusted?: boolean; imageBase64?: string;
    } & Record<string, unknown>;
    if (p.ok === false) {
      return { content: [{ type: "text", text: p.reason ?? "The browser request was refused." }], details: p };
    }
    const text = p.text ?? JSON.stringify(p);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
      { type: "text", text: p.untrusted ? wrapUntrusted(text, source, url) : text },
    ];
    if (typeof p.imageBase64 === "string" && p.imageBase64) {
      content.push({ type: "image", data: p.imageBase64, mimeType: "image/png" });
    }
    const { imageBase64: _dropped, ...details } = p;
    return { content, details };
  } catch {
    return { content: [{ type: "text", text: raw }], details: {} };
  }
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

/**
 * §31: main ALWAYS answers a hv.document-read input — same never-hang contract
 * as terminalReply and browserReply.
 *
 * `text` arrives ready for the model either way: the Markdown slice on success,
 * the SENTENCE on failure (hv-document's documentErrorSentence), so a scanned
 * PDF reads as an instruction to ask the user rather than as an error code.
 * `facts` becomes the card's facts line, on `details` where the renderer reads
 * structured fields.
 */
function documentReply(raw: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  if (typeof raw !== "string" || !raw) {
    return { content: [{ type: "text", text: "The document could not be read." }], details: {} };
  }
  try {
    const p = JSON.parse(raw) as {
      ok?: boolean; text?: string; name?: string; path?: string; facts?: DocumentFacts;
    } & Record<string, unknown>;
    const factsLine = p.ok === true && p.facts ? documentFactsLine(p.facts) : "";
    const body = p.text ?? "The document could not be read.";
    return {
      content: [{ type: "text", text: factsLine ? `${p.name ?? "document"} — ${factsLine}\n\n${body}` : body }],
      details: { ...p, ...(factsLine ? { factsLine } : {}) },
    };
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
// "use_skill" (§14): loading a skill goes through requireIntent like MCP, so a
// skill load surfaces as a transcript card with a model-authored "why". Built-in
// `read` can't carry intent (params stripped), which is exactly why a raw read of
// a SKILL.md only gets the derived-label fallback card.
// §26: terminal_run/terminal_kill take the REQUIRED intent, per the standing rule
// above. `subagent`'s demotion to optional (below) is deliberately NOT copied — a
// terminal that starts is a card in someone's transcript and must say why.
const INTENT_TOOLS = ["ask_user", "use_skill", "terminal_run", "terminal_kill", "schedule_create", "schedule_update", "schedule_delete"]; // ask_user declares intent in its own schema — requireIntent's guard makes this a no-op for it
// MCP tools (§13, Pi's built-in MCP: source "builtin:mcp") get the same required
// `intent`, BUT Pi forwards params VERBATIM to the MCP server
// (extensions/mcp/tools.js `client.callTool(tool.name, params)`) — a strict
// server would reject the unknown param. So the bridge strips `intent` from
// these tools in its tool_call handler (event.input is Pi's documented mutable
// pre-execution hook). Safe for the UI: tool_execution_start is emitted with
// the ORIGINAL model args (agent-loop.js emits before beforeToolCall runs),
// so tool cards see the intent while the server never does.
const strippedIntentTools = new Set<string>();
/**
 * X1 (Improve-prompts round, 2026-09-10) — ONE description, on every tool.
 *
 * Each tool used to carry its own 100-250-char explanation of what an intent
 * IS; thirty copies rode every turn, ~600-900 tokens, the largest
 * HappyVibe-authored slice of the context window. The convention and its one
 * example now live in the identity paragraph (src/main/appendSystem.ts
 * buildIdentity), which the model reads once — and which follows the same §13
 * round-12 switch, so neither can describe a parameter that is not there.
 *
 * "REQUIRED" is deliberately NOT restated: the schema's own `required` array
 * says it, and current models honour the schema. No per-tool tail either — the
 * tool's own name already carries the verb.
 *
 * Pinned by tests/intent-description.test.ts, which also scans this file for a
 * per-tool copy growing back.
 */
export const INTENT_DESCRIPTION =
  "One customer-facing sentence, goal first — shown to the user as this call's headline.";
const INTENT_PARAM = { type: "string", description: INTENT_DESCRIPTION };
/** The same description as a typebox schema, for the tools this file registers itself. */
const intentParam = (): ReturnType<typeof Type.String> => Type.String({ description: INTENT_DESCRIPTION });
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
  // MCP tools = everything Pi's built-in MCP registered (server tools and the resource tools).
  for (const t of pi.getAllTools()) {
    if (INTENT_TOOLS.includes(t.name) || t.sourceInfo?.path !== PI_MCP_SOURCE) continue;
    if (strippedIntentTools.has(t.name)) continue; // already wired on an earlier session_start
    const params = t.parameters as MutableParams | undefined;
    if (!params?.properties) continue;
    if (params.properties.intent) continue; // server tool has its OWN intent param — hands off (no strip)
    params.properties.intent = INTENT_PARAM;
    params.required = [...(params.required ?? []), "intent"];
    strippedIntentTools.add(t.name);
  }
}

/**
 * X7 (Improve-prompts round, 2026-09-10) — what a refused model should do next.
 *
 * Appended to the two refusals that used to say only that something was
 * blocked. Every other refusal in the app (plan mode, the child guard, the
 * bash-`&` redirect, the web refusals) already carries a cause and an
 * alternative; these two did not, and a model handed a bare "blocked" retries.
 */
const NEXT_STEP = "Do not retry the same call. Take a different approach, or tell the user what you needed and why.";

// ── B4 permissions (docs/validation/d1.md §hv.audit) ───────────────────────
// Rules file path rides the spawn env; main rewrites the file on UI edits
// and broadcasts /hv-rules-reload to every live session.
let rules: RulesFile = EMPTY_RULES;
let rulesError: string | null = null;
// Per-session toggle (/hv-dangerous). Round 3 #14: the persistent "bypass all
// permissions" setting is delivered via HV_BYPASS at spawn and re-applied on
// every respawn, so unlike the manual toggle it survives a respawn.
let dangerous = process.env.HV_BYPASS === "1";
/**
 * §35: a scheduled read-only run. `const`, and that is the feature — there is
 * no command, no tool and no toggle that can flip it, so nothing inside the
 * session can widen its own permissions. Only main sets the env var, and only
 * for a schedule whose mode is "readonly".
 */
const readonly = readonlyFromEnv(process.env);

// ── §12 tintinweb (2026-09-26) ─────────────────────────────────────────────────
/**
 * tintinweb: the tools the user approved per agent type, i.e. what the in-process
 * guard holds a child of that type to (hv-child-policy `boundaryFor`). Keyed by TYPE
 * because every child of one type is built from the same agent file, so the approved
 * set is the same. Never reset per turn: a background child outlives the turn that
 * approved it. A type nobody approved gets the read-only floor.
 */
const approvedBoundaries = new Map<string, string[]>();

/** What tintinweb would give one agent, plus whether its FILE declared `tools:` (see hv-tw-gate.ts). */
async function twAgentInfo(name: string): Promise<TwAgentInfo | undefined> {
  // Relative path, never a bare specifier: the package has no exports map and the
  // bridge must read the SAME discovery tintinweb uses (pinned by the contract test).
  const { loadCustomAgents } = await import("../node_modules/@tintinweb/pi-subagents/src/custom-agents.ts");
  const cfg = loadCustomAgents(process.cwd()).get(name);
  if (!cfg) return undefined;
  let declared = false;
  try {
    declared = !!cfg.sourcePath && declaresTools(parseAgentFile(fs.readFileSync(cfg.sourcePath, "utf8")).frontmatter);
  } catch {
    /* unreadable ⇒ undeclared ⇒ the read-only floor: the safe direction */
  }
  return { builtinToolNames: cfg.builtinToolNames ?? [], declared, allowedSubagents: cfg.allowedSubagents };
}

/**
 * The agent inventory on the tintinweb path — tintinweb's OWN discovery (`.pi/agents/`,
 * `.agents/agents/`, `<agentDir>/agents/`), so the Agents page and the injected roster
 * list exactly what `Agent` will accept. Upstream's defaults are off (disableDefaultAgents),
 * so none appear. A user-switched-off agent stays LISTED, dimmed, so it can come back on.
 */
async function twEnumerateAgents(): Promise<AgentDef[]> {
  let all: Map<string, { description?: string; enabled?: boolean; model?: string; systemPrompt?: string; sourcePath?: string; source?: string; builtinToolNames?: string[] }>;
  try {
    const { loadCustomAgents } = await import("../node_modules/@tintinweb/pi-subagents/src/custom-agents.ts");
    all = loadCustomAgents(process.cwd());
  } catch {
    return []; // discovery must never take the session down
  }
  const ourDir = process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "agents") : null;
  const off = twDisabledAgents();
  const out: AgentDef[] = [];
  for (const [name, cfg] of all) {
    const filePath = cfg.sourcePath ?? "";
    if (!cfg.description || isSlashCommandPath(filePath)) continue;
    let declared = false;
    try { declared = declaresTools(parseAgentFile(fs.readFileSync(filePath, "utf8")).frontmatter); } catch { /* undeclared */ }
    out.push({
      name,
      description: cfg.description,
      enabled: cfg.enabled !== false && !off.has(name),
      // What the boundary will actually allow: an undeclared agent is read-only (hv-tw-gate.ts).
      tools: declared ? [...(cfg.builtinToolNames ?? [])] : [...READ_ONLY_CHILD_TOOLS].sort(),
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.systemPrompt ? { systemPrompt: cfg.systemPrompt } : {}),
      source: ourDir && filePath.startsWith(ourDir) ? "bundled" : cfg.source === "project" ? "project" : "user",
      path: filePath,
    });
  }
  return out;
}

/**
 * Agents the user switched off on the Agents page. Read LIVE from the file main
 * already writes for that switch (`<agentDir>/settings.json`, disabledAgentOverrides),
 * so a toggle applies to the next call without a respawn — the same file, one reader more.
 */
function twDisabledAgents(): Set<string> {
  try {
    const dir = process.env.PI_CODING_AGENT_DIR;
    if (!dir) return new Set();
    const s = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")) as { subagents?: { agentOverrides?: Record<string, { disabled?: unknown }> } };
    return new Set(Object.entries(s.subagents?.agentOverrides ?? {}).filter(([, o]) => o?.disabled === true).map(([n]) => n));
  } catch {
    return new Set();
  }
}

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

// What each completed child actually said, so the delivery can carry it instead of
// upstream's truncated notification (hv-subagent-delivery.ts). Deliberately NOT
// persisted: a completion and its delivery turn happen together, and writing multi-KB
// outputs through appendEntry would bloat every session file to save a round-trip
// that only a respawn-in-between could ever need.
const childOutputs = createChildOutputStore();
// `restored` marks the one emit that replays persisted state on session_start
// (respawn/hibernation) — main uses it to reconcile a stale enabled:true against
// the plan file, without reverting a live re-entry into plan mode.
function emitPlan(ui: { notify(m: string, t?: "info" | "warning" | "error"): void }, restored = false): void {
  ui.notify(JSON.stringify({ kind: "hv.plan", enabled: plan.enabled, planPath: plan.planPath ?? null, restored }), "info");
}
// NOTE — there used to be an applyPlanTools() here that hid edit/write/
// multi_edit/subagent from the model while planning ("best-effort hygiene",
// believed inert). It was neither. `setActiveTools` is real
// (pi-coding-agent agent-session.js:1880-1882), so the model's edit call died in
// pi-agent-core agent-loop.js:398 as the bare string `Tool edit not found` —
// no reason, no mention of Plan Mode. Measured on a live session (2026-08-16,
// Test3DGames): on re-entering plan mode for a SECOND plan the model read that
// error as a whitespace mismatch, spent a minute retrying, and only learned it
// was planning when a `bash` call came back with gatePlanCall's explanatory
// refusal. Hiding a tool replaces a reason with a lie — the gate IS the UX here,
// so there is nothing to re-add: let every blocked call carry its reason.
//
// F4 (2026-09-10): the same reasoning is why the DISABLED `bg_wait` tool is
// still sent to the model, at ~650 tokens a turn. pi-subagents registers it
// whatever waitTool.enabled says, and dropping it with setActiveTools would be
// free — except that upstream's own async receipt still tells the model the
// name, so a hidden tool would come back as a bare "not found" exactly as
// `edit` did above. The gate for reversing this is the F4 group in
// tests/pi-subagents-contract.test.ts: when upstream stops naming it, hide it.

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
// Round 15 renames "dangerous" → "bypass". With a bypass active EVERY call
// logged the old value, in red, so the column stopped distinguishing anything —
// it named the mode, once per row, forever. Old logs keep the old string and
// the renderer maps both; red is now reserved for what a command DOES.
type AuditSource = "rule" | "user" | "bypass" | "safe-default" | "plan" | "readonly" | "terminal" | "web" | "document" | "subagent";

/** Every permission decision emits one hv.audit notify — main's audit channel. */
function audit(
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void },
  o: {
    tool: string;
    summary: string;
    decision: AuditDecision;
    source: AuditSource;
    rule?: Verdict["rule"];
    grant?: "session";
    /**
     * Round 15 — what the rule engine WOULD have decided, recorded on rows the
     * bypass decided instead. This is the teachable half and the reason the
     * source column exists at all: "bypass · rules would have asked" tells the
     * user what turning the bypass off would cost them, where a wall of
     * identical "bypass" rows tells them nothing.
     */
    wouldHave?: RuleAction;
    /** §12 (2026-09-26): a tintinweb child's call — which agent, which run (AuditView names both). */
    agent?: string;
    runId?: string;
    /** docs-round #7: on a child's row, the bypass let it through (AuditView lists it under Bypass too). */
    bypass?: boolean;
  },
): void {
  // §33: the audit row's summary is CAPPED here, at the one choke point every caller routes
  // through, rather than at each call site.
  //
  // `summarize` used to cap every tool at 300 chars, so this was implicit. §33 lifted that cap
  // for memory calls — the permission PROMPT has to show the whole memory and diff it — and
  // that silently made the audit row unbounded too: a 4 KB body in every JSONL row, on a log
  // that is long-lived and exportable. The prompt and the record want different things, so they
  // get different lengths, and the record's is bounded by construction.
  const row = { ...o, summary: o.summary.length > 300 ? `${o.summary.slice(0, 300)}…` : o.summary };
  ui.notify(JSON.stringify({ kind: "hv.audit", ts: new Date().toISOString(), ...row }), "info");
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
  // §13 (2026-10-05): workspace .mcp.json servers. Pi reads project servers only from a
  // TRUSTED project's .pi/mcp.json and HappyVibe never trusts one, so the bridge registers
  // them. Registered during load → they connect on session_start beside <agentDir>/mcp.json
  // (Pi's file wins on a name clash). Only when main loaded Pi's MCP (HV_MCP=1): with no MCP
  // extension a registration is an extension error.
  const mcpRegistered: string[] = [];
  const mcpRegisterErrors: string[] = [];
  if (process.env.HV_MCP === "1") {
    try {
      const file = path.join(process.cwd(), ".mcp.json");
      if (fs.existsSync(file)) {
        const { servers, errors } = workspaceRegistrations(JSON.parse(fs.readFileSync(file, "utf8")));
        mcpRegisterErrors.push(...errors);
        for (const [name, entry] of servers) {
          try { pi.registerMcpServer(name, entry as never); mcpRegistered.push(name); }
          catch (e) { mcpRegisterErrors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
        }
      }
    } catch (e) {
      mcpRegisterErrors.push(`.mcp.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const piAgentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  /** Configured names, for namespace → server. Read per call: a few hundred bytes, and a
      config change respawns the session anyway. */
  const mcpServerNames = (): string[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(piAgentDir, "mcp.json"), "utf8")) as { mcpServers?: object };
      return [...Object.keys(raw.mcpServers ?? {}), ...mcpRegistered];
    } catch {
      return [...mcpRegistered];
    }
  };
  // §13 round 6: global on/off for plan mode + ask_user, resolved by main at
  // spawn (same pattern as HV_BYPASS). Fail-open on a corrupt value.
  const builtins = parseBuiltins(process.env.HV_BUILTINS);
  // §33: the two memory scopes main resolved at spawn. Read HERE, beside builtins, rather than
  // beside the tool registrations 1,400 lines down: `before_agent_start` is registered above
  // that point and reads them, and this file already has one scar from a const that sat after
  // its own readers (the §12 refusal paths' `summary`).
  //
  // An ABSENT global dir is how "memory is off" arrives; an absent WORKSPACE dir is how "off
  // for this workspace" does — never an empty string, which would read as a value.
  const memoryGlobalDir = process.env.HV_MEMORY_GLOBAL_DIR;
  const memoryWorkspaceDir = process.env.HV_MEMORY_WORKSPACE_DIR;
  const memoryOn = Boolean(builtins.memory && memoryGlobalDir);

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
    /** §33: the two memory scopes and the policy's own weight, so the context panel can price
     *  memory as three named rows instead of hiding it inside "System prompt". */
    memory?: { global: { count: number; tokens: number; items: { name: string; tokens: number }[] }; workspace: { count: number; tokens: number; items: { name: string; tokens: number }[] }; policy: number };
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
  let busUi: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    select(title: string, options: string[]): Promise<string | undefined>;
  } | null = null;

  // §12 (2026-09-26): tintinweb builds children IN this process, and the owned patch
  // asks this policy what every child may load and do (hv-child-policy.ts). Published
  // at load, before any child can exist; under HV_HOST=1 a child built without it fails.
  {
    setChildPolicy({
      // Fails CLOSED: an empty list here would build a child with no guard at all.
      extensionPaths: () => {
        const guard = process.env.HV_CHILD_GUARD;
        if (!guard) throw new Error("HappyVibe: HV_CHILD_GUARD is not set — refusing to build a sub-agent without its guard");
        return [guard];
      },
      // §14's trust gate reaches children too: exactly the skills main approved for this session.
      skillPaths: () => loadManifest().skills.map((s) => s.dir),
      refuseSpawn: (type: string) =>
        twDisabledAgents().has(type) ? `'${type}' is switched off on the Agents page.` : undefined,
      boundaryFor: (type: string | undefined) => (type && approvedBoundaries.get(type)) || [...READ_ONLY_CHILD_TOOLS].sort(),
      audit: (row) => {
        if (!busUi) return;
        audit(busUi, {
          tool: row.tool, decision: row.decision, summary: row.summary, source: "subagent",
          wouldHave: row.wouldHave, ...(row.type ? { agent: row.type } : {}), ...(row.agentId ? { runId: row.agentId } : {}),
          ...(row.bypass ? { bypass: true } : {}),
        });
      },
      // §10 (2026-09-26, Phase 4, decision 10): a child inherits the parent's session grants…
      hasSessionGrant: (permTool: string) => sessionGrants.has(permTool),
      // …and its own ask is put to the human on the PARENT's channel, so main stamps it with
      // this session (pendingPrompts retains it, dialogHost scopes it). Never times out. While
      // it is open the run reads as needing attention, so its circle is amber and promoted.
      ask: async (req) => {
        const ui = busUi;
        if (!ui) return "deny";
        const control = (activityState?: string) =>
          req.agentId && ui.notify(JSON.stringify({ kind: "hv.subagent", stage: "control", runId: req.agentId, ...(activityState ? { activityState } : {}) }), "info");
        // docs round #1: the app names the child, by its agent type and run id. Never the
        // run's task text: that is the model's own `Agent` argument, and a prompt never
        // shows the model's words (§13). The run's card turns amber while this waits,
        // which is how the user tells two runs of one agent apart.
        const title = JSON.stringify({
          kind: "hv.permission", tool: req.permTool, summary: summarize(req.tool, req.input),
          child: { agent: req.type ?? "unknown", runId: req.agentId ?? "" },
        });
        control("needs_attention");
        try {
          const choice = await ui.select(title, [...CHILD_CHOICES]);
          return choice === "Allow" ? "allow" : choice === "Allow for this run" ? "allow-run" : "deny";
        } finally {
          control();
        }
      },
    });
  }

  // session_start is NOT enough on its own: Pi connects MCP servers in the background
  // AFTER session_start (extensions/mcp/index.js), and a server's tools are registered
  // only once it connects — so they don't exist yet when session_start runs.
  // Re-applying per turn costs nothing — requireIntent early-continues on every
  // already-wired tool — and wires whatever connected since the last turn.
  // Regression-tested by tests/mcp-bridge.test.ts (live).
  // §13 round 12: the headline is bought with tokens, so it has a switch. In
  // MCP that is every tool a server publishes, which is where the cost scales.
  pi.on("turn_start", (_e, ctx) => {
    requireIntent(pi, builtins.intent); stripIntent(pi, builtins.intent);
  });

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
      // longer clamped.
      emitPlan(ctx.ui, true);
      // …and MUST persist: leaving enabled:true in the session file meant that
      // re-enabling Plan mode later restored a clamped session with no user
      // action (and main's reconcile skips it when planPath is null).
      persistPlan(pi);
    } else if (plan.enabled || plan.planPath) {
      emitPlan(ctx.ui, true);
    }
    // §35: tell the renderer to raise the "Read-only run" pill. A notify rather
    // than persisted state — the mode comes from the environment on every
    // spawn, so a respawn re-announces it without anything to restore.
    if (readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.readonly", enabled: true }), "info");
    // docs round #2: the red banner's only signal. The persistent setting arrives as
    // HV_BYPASS at every spawn, so `dangerous` is already true here, and nothing else
    // would say so; `/hv-dangerous` announces its own toggles. Only when ON: a notify
    // on every fresh session would be the first ui-request other bridge tests wait on.
    // Never in a read-only run: bypass doesn't reach it (the tool_call gate), and a
    // banner saying every call runs without asking would be false.
    if (dangerous && !readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.dangerous", on: true }), "warning");
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
    const base = (event.systemPrompt ?? "") as string;
    // A4: swap Pi's "use the read tool to load a skill's file" for ours, in the
    // one hook that already owns this prompt. No-op when no skills are loaded.
    const sp = replaceSkillsSentence(base);
    // W2.3: nested AGENTS.md injection — content re-read at injection time so
    // it's always current. Returning systemPrompt replaces it for THIS TURN
    // ONLY (agent-session.js resets to the base prompt when we return nothing).
    const section = renderNestedSection(nestedAgentsMd, process.cwd(), readFileOrNull);
    // Discoverability: inject the delegable-subagent roster (same per-turn
    // replacement mechanism as the nested section). enumerateAgents is a hoisted
    // function declaration below in this closure.
    const agents = await enumerateAgents();
    const agentsSection = renderSubagentSection(agents, { tool: "Agent" });
    // §23: while planning, prepend the read-only planning directive (single-turn
    // replacement, same mechanism as the nested/agents sections).
    // A3: the prompt names the blocked tools this session actually HAS.
    const planSection =
      builtins.plan && plan.enabled
        ? "\n\n" + buildPlanPrompt(builtins.planAppend, pi.getAllTools().map((t) => t.name))
        : "";
    // §26: steer long-running commands to terminal_run rather than a
    // backgrounded bash call. Only while the group is registered — otherwise
    // the prompt would name a tool the model does not have.
    // §35: a scheduled read-only run gets its own directive instead of the
    // planning one — it reports in chat and writes no plan file.
    const readonlySection = readonly ? "\n\n" + buildReadonlyPrompt(pi.getAllTools().map((t) => t.name)) : "";
    const terminalSection = builtins.terminal ? "\n\n" + TERMINAL_STEER_LINE : "";
    // §32: steer web reading to the web tools rather than `bash curl`, which
    // returns raw HTML, runs through the terminal gate as an arbitrary command
    // and never tells the user which page was read. Only while the group is
    // registered — §26's rule: a prompt must never name a tool the model
    // does not have.
    const webSection = builtins.web ? "\n\n" + WEB_STEER_LINE : "";
    // §33: the policy plus both scope indexes, RE-READ FROM DISK every turn. That is what makes
    // a save or a Memory-page edit live on the very next turn with no respawn — the whole
    // reason the index is a generated file rather than in-bridge state.
    const memorySection = memoryOn
      ? renderMemorySection({
          append: builtins.memoryAppend,
          global: readIndex(memoryGlobalDir),
          // null (not "") when the workspace toggle is off — no block at all, rather than an
          // empty one that would tell the model a scope exists which it cannot write to.
          workspace: memoryWorkspaceDir ? readIndex(memoryWorkspaceDir) : null,
        })
      : "";
    // X6 (2026-09-10): STATIC-BEFORE-DYNAMIC, for the provider's prefix cache.
    // The roster, plan, steer lines and memory policy do not change within a
    // session; the memory INDEX changes on every save and the nested section
    // whenever a new subdirectory is touched. Those two used to sit first and
    // last-but-inside, so either one invalidated the whole HappyVibe tail.
    const injected = sp + agentsSection + readonlySection + planSection + terminalSection + webSection + memorySection + section;
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
      // Absent when memory is off, so the panel shows no Memory category at all — the 0-cost claim.
      memory: memoryOn ? memoryTokenLines(memoryGlobalDir, memoryWorkspaceDir) : undefined,
    };
    // F1 (2026-09-10): this used to hand-list the sections, and it OMITTED
    // terminalSection and webSection — with every agent off and memory, skills
    // and plan off, both steer lines were computed and then never sent.
    // Comparing against Pi's own prompt cannot forget a section, and it also
    // covers A4's skills-sentence swap, which changes `sp` itself.
    if (injected !== base) return { systemPrompt: injected };
    return undefined; // no injection this turn — resets Pi to the base prompt
  });

  // The only place removal takes effect. Non-destructive: session file untouched.
  pi.on("context", async (event) => {
    // Two independent rewrites of what the model is about to see. Order matters
    // only in that both must be able to run: §9's removal marks, and the
    // sub-agent delivery repair (hv-subagent-delivery.ts) — which would be
    // skipped entirely when no marks exist if this handler still early-returned.
    let messages = event.messages;
    if (contextMarks.size > 0) messages = filterMessages(messages, contextMarks);
    const repaired = substituteDeliveries(messages, childOutputs);
    if (repaired) messages = repaired;
    return contextMarks.size > 0 || repaired ? { messages } : undefined;
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

  pi.on("tool_result", async (event) => {
    // §12 (2026-09-26): a workflow runs in the background; its id first appears here. Announced
    // as a `started` run so the busy gate, the run rail and STOP cover it like any delegation;
    // P6-settled ends it (hv-tw-relay.ts).
    if (event.toolName === WORKFLOW_TOOL) {
      const taskId = (event as { details?: { taskId?: unknown } }).details?.taskId;
      if (typeof taskId === "string" && taskId) {
        const input = ((event as { input?: Record<string, unknown> }).input ?? {});
        twRunning.add(taskId);
        relay({ stage: "started", runId: taskId, agent: "workflow", task: workflowName(typeof input.script === "string" ? input.script : "") });
      }
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName as string;
    const input = (event.input ?? {}) as Record<string, unknown>;
    // Async subagents (PRD §12): HappyVibe is always interactive and delivers a
    // subagent's result to the main agent AUTOMATICALLY as a new turn. A blocking
    // `get_subagent_result({wait: true})` would stall the turn and defeat the whole
    // "keep chatting while subagents run" promise, so it gets guidance instead.
    // (No audit — this is a behavioral guard, not a permission decision.)
    if (isResultWait(tool, input)) {
      return {
        block: true,
        // X3: the reason IS the instruction here — a shouted "Do NOT" made
        // models hesitate over legitimate blocking calls elsewhere.
        reason:
          "This is an interactive HappyVibe session: the sub-agent's result is delivered to you " +
          "as a new turn when it finishes, so there is nothing to wait for — do not call " +
          `${tool}() or poll for its status. End your turn with one line saying the work ` +
          "is running in the background.",
      };
    }
    // Direct MCP tools: drop the injected intent BEFORE anything reads input
    // (permission summaries stay factual, per the PRD) — the adapter would
    // forward it verbatim to the MCP server otherwise. The UI already has it:
    // tool_execution_start fired with the original args.
    if (strippedIntentTools.has(tool)) delete input.intent;
    // §13 (2026-10-05): cap every tool_search (TOOL_SEARCH_LIMIT) — event.input is Pi's documented
    // mutable pre-execution hook and the bridge is the last handler, so this is what runs.
    if (tool === "tool_search" && pi.getAllTools().find((t) => t.name === tool)?.sourceInfo?.path === TOOL_SEARCH_SOURCE) {
      const asked = typeof input.limit === "number" && input.limit > 0 ? input.limit : TOOL_SEARCH_LIMIT;
      input.limit = Math.min(asked, TOOL_SEARCH_LIMIT);
    }
    // §13 (2026-10-05): Pi's MCP tools gate as mcp:<server>_<tool> — the adapter-era name, so
    // stored rules keep matching. Identified by SOURCE, never by name (hv-mcp.ts).
    const mcp = mcpCallInfo(pi.getAllTools().find((t) => t.name === tool) as never, input, mcpServerNames());
    // §28: a navigation gates per DESTINATION, not per tool — one `browser_navigate`
    // rule would be the difference between localhost and a stranger's server
    // being the same decision. Same virtual-name trick as mcp:<server>_<tool>,
    // so "Allow for session" on one host says nothing about the next.
    const browserNav =
      (tool === "browser_open" || tool === "browser_navigate") && typeof input.url === "string"
        ? browserRuleName(input.url)
        : null;
    // §12: a delegation gates per AGENT, not per tool — the same reasoning as the
    // two lines above. `subagent` as a rule name made "Allow for session" on a
    // read-only explorer cover a bash-wielding agent for the rest of the session.
    const subagentName = twAgentOf(tool, input);
    // §32: the three URL web tools gate under the SAME virtual rule as the
    // browser. One fact — "the agent may reach docs.foo.com" — one allow-list,
    // so "Allow for session", a pattern rule and the Permissions page all cover
    // both surfaces. A separate web:<host> list was rejected precisely because
    // two lists can disagree about the same host.
    const webHost = WEB_URL_TOOLS.has(tool) && typeof input.url === "string" ? browserRuleName(input.url) : null;
    const permTool = mcp?.ruleTool ?? browserNav ?? webHost ?? (subagentName ? boundaryRuleName(subagentName) : tool);

    // Declared HERE, not further down, because the §12 refusals below audit with
    // it. It used to sit after `grantBoundary`, i.e. AFTER three call sites that
    // read it — a temporal-dead-zone ReferenceError on every one of those refusal
    // paths. It failed closed (Pi's beforeToolCall re-throws as "Extension
    // failed, blocking execution"), so the boundary held, but the refusal
    // surfaced as an extension crash with NO hv.audit row instead of a clean
    // denial naming the reason. Nothing caught it: this file is in neither
    // typecheck include list (tsconfig.node.json lists only the pure hv-*.ts
    // modules), and no test invokes the handler on those three paths.
    const summary = mcp?.display ?? summarize(tool, input);

    // §12 FR1: resolve the child's reach BEFORE the prompt, so the human approves
    // a boundary rather than a verb. Side-effect-free.
    // The boundary comes from tintinweb's discovery + the agent file (hv-tw-gate.ts).
    const boundary = subagentName
      ? twBoundary(subagentName, await twAgentInfo(subagentName), input)
      : undefined;
    if (subagentName) {
      if (twDisabledAgents().has(subagentName)) {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule" });
        return { block: true, reason: `'${subagentName}' is switched off on the Agents page. Delegate to another agent, or do the work in this session.` };
      }
      if (!boundary) {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule" });
        return { block: true, reason: `HappyVibe could not find an agent named '${subagentName}', so it will not launch it. Use one of the agents listed in <happyvibe_subagents>.` };
      }
    }

    /**
     * Record what the in-process guard holds this agent type to (hv-child-policy
     * `boundaryFor`). Called at every point that PERMITS a delegation. The failure
     * direction is deliberate: a missed call site leaves the child on the read-only
     * floor — visible and harmless — never the reverse.
     */
    const grantBoundary = (): void => {
      if (boundary) approvedBoundaries.set(boundary.agent, [...boundary.tools]);
    };

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

    // §32: a private, local or non-http destination is refused BEFORE the gate,
    // and before the envelope. Ordering matters twice over: the web service
    // refuses these itself (measured), so asking it would only turn a clear
    // sentence into a remote error; and prompting the user to approve
    // `browser:localhost` for a call that cannot work either way is worse than
    // useless. The refusal NAMES browser_open, which runs on the user's own
    // machine and is the tool that can actually reach a dev server.
    if (WEB_URL_TOOLS.has(tool)) {
      const why = webRefusal(input.url);
      if (why) {
        audit(ctx.ui, { tool, summary, decision: "deny", source: "web" });
        return { block: true, reason: why };
      }
    }

    // §26: once terminals exist, `npm run dev &` is the model reaching for the
    // broken thing with the working thing beside it. Gated on builtins.terminal
    // because with the group OFF there is nowhere to redirect to, and blocking
    // `&` would turn a context-saving setting into a capability removal it never
    // advertised.
    if (builtins.terminal && isShellTool(tool) && typeof input.command === "string" && hasBackgroundAmpersand(input.command)) {
      audit(ctx.ui, { tool, summary, decision: "deny", source: "terminal" });
      return {
        block: true,
        reason:
          "Backgrounding with `&` hides the process from the user and leaves them unable to stop it. " +
          "Use terminal_run instead — the same long-running command becomes a card they can watch, " +
          "type into and kill, and you can poll it with terminal_read.",
      };
    }

    // §31: `read` on a .docx hands the model zip bytes and it burns a turn
    // discovering that. Point it at the right tool instead. NOT gated on
    // builtins.document — with the group off the refusal still saves the wasted
    // turn, it just names a different reason. .csv and .txt are not documents,
    // so read keeps working on them untouched.
    {
      const hint = documentReadRefusal(tool, input, builtins.document);
      if (hint) {
        audit(ctx.ui, { tool, summary, decision: "deny", source: "document" });
        return { block: true, reason: hint };
      }
    }

    let planFloorAsk = false;

    // §35 read-only RUN clamp — first of all the gates, so it wins over plan
    // mode, over bypass and over every rule. Not gated on any builtins toggle:
    // the whole promise of a read-only schedule is that nothing in the session
    // can turn it off (hv-readonly.ts explains why this is not plan mode).
    //
    // The verdict shape is Plan mode's, resolved through the same typechecked
    // resolvePlanVerdict and reported through the same hv.plan.blocked notify,
    // so the renderer draws one "Skipped" card for both entrances.
    if (readonly) {
      const g = resolvePlanVerdict(gateReadonlyCall(tool, input, { mcpReadOnly: mcp?.hint === "read-only" }), boundary);
      if (g.kind === "block") {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "readonly" });
        ctx.ui.notify(JSON.stringify({ kind: "hv.plan.blocked", toolName: tool, toolCallId: event.toolCallId, reason: g.reason }), "info");
        return { block: true, reason: g.reason };
      }
      if (g.kind === "floor-ask") planFloorAsk = true;
    }

    // §23 Plan Mode clamp — runs BEFORE dangerous/bypass and the rule engine, so
    // plan mode wins over bypass (read-only must mean read-only). Applies to NEW
    // calls only; an in-flight async delegation is untouched.
    if (builtins.plan && plan.enabled) {
      // §23: the verdict — including the read-only-delegation decision — is
      // resolved in hv-plan.ts, which is typechecked. See resolvePlanVerdict.
      const g = resolvePlanVerdict(gatePlanCall(tool, input, { mcpReadOnly: mcp?.hint === "read-only" }), boundary);
      if (g.kind === "block") {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "plan" });
        ctx.ui.notify(JSON.stringify({ kind: "hv.plan.blocked", toolName: tool, toolCallId: event.toolCallId, reason: g.reason }), "info");
        return { block: true, reason: g.reason };
      }
      if (g.kind === "floor-ask") planFloorAsk = true; // clamp allow→ask below; deny still denies
    }

    // §12 (2026-09-26, decision 7): a workflow is a SCRIPT that runs inside this Pi process,
    // so approving one is approving code. Every call prompts — no allow rule and no session
    // grant skips it — showing the full script whatever its source, with Allow · Deny only.
    // A deny RULE still refuses and bypass still runs it. Plan mode and read-only runs never
    // reach this point (BLOCKED_PLAN_TOOLS, above). On Allow, the agent types the script
    // names get their approved boundaries; any other child is held to the read-only floor.
    if (tool === WORKFLOW_TOOL) {
      const src = workflowSource(input, {
        cwd: process.cwd(),
        agentDir: process.env.PI_CODING_AGENT_DIR ?? "",
        read: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
        join: path.join,
        resolve: path.resolve,
      });
      if ("error" in src) {
        audit(ctx.ui, { tool: "workflow", summary, decision: "deny", source: "rule" });
        return { block: true, reason: `${src.error} ${NEXT_STEP}` };
      }
      const parsed = workflowAgents(src.script);
      const agents = await Promise.all(parsed.types.map(async (type) => {
        const b = twBoundary(type, await twAgentInfo(type), {});
        return { type, known: !!b, tools: b?.tools ?? [], writeCapable: b?.writeCapable ?? [] };
      }));
      const approve = (): void => { for (const a of agents) if (a.known) approvedBoundaries.set(a.type, [...a.tools]); };
      const name = workflowName(src.script);
      const wv = evaluate(rules, { tool: "workflow", input, workspace: process.cwd(), caseInsensitivePaths: CI_PATHS });
      if (wv.action === "deny" && wv.source === "rule") {
        audit(ctx.ui, { tool: "workflow", summary: name, decision: "deny", source: "rule", rule: wv.rule });
        return { block: true, reason: `Blocked by HappyVibe permission rule (workflow). ${NEXT_STEP}` };
      }
      if (dangerous) {
        approve();
        audit(ctx.ui, { tool: "workflow", summary: name, decision: "allow", source: "bypass", wouldHave: wv.action });
        return;
      }
      const title = JSON.stringify({
        kind: "hv.permission", tool: "workflow", summary: name,
        workflow: { script: src.script, origin: src.origin, agents, unparsed: parsed.unparsed },
      });
      const choice = await ctx.ui.select(title, [...WORKFLOW_CHOICES]);
      if (choice === "Allow") {
        approve();
        audit(ctx.ui, { tool: "workflow", summary: name, decision: "allow", source: "user" });
        return;
      }
      audit(ctx.ui, { tool: "workflow", summary: name, decision: "deny", source: "user" });
      return { block: true, reason: `User denied running this workflow in HappyVibe. ${NEXT_STEP}` };
    }

    // Dangerous mode: everything runs without prompting, but NEVER silently —
    // each call is audit-flagged and the renderer shows a permanent banner.
    // (Skipped while planning: plan mode ignores bypass entirely.)
    if (dangerous && !plan.enabled && !readonly) {
      // Round 15: evaluate the rules ANYWAY and record the verdict the bypass
      // overrode. It costs one pure call on an object already in hand (evaluate
      // is the same pure engine the branch below uses), and it is what turns
      // the audit log back into a record of decisions rather than a record of
      // one setting being on.
      const shadow = evaluate(rules, {
        tool: permTool, input, workspace: process.cwd(), caseInsensitivePaths: CI_PATHS,
      });
      audit(ctx.ui, {
        tool: permTool,
        summary,
        decision: "allow",
        source: "bypass",
        // The ENGINE's verdict verbatim (allow | ask | deny) — not an
        // AuditDecision, which has no "ask" because a prompt is not an outcome.
        // Mapping "ask" onto anything in that set is exactly the lie this row
        // exists to avoid.
        wouldHave: shadow.action,
        rule: shadow.rule,
      });
      // FR6: bypass means bypass, for children too — grant the boundary the agent
      // asked for rather than leaving it narrower than the un-bypassed path.
      grantBoundary();
      return;
    }

    const v = evaluate(rules, {
      tool: permTool, input, workspace: process.cwd(), caseInsensitivePaths: CI_PATHS,
    });

    if (v.action === "deny") {
      audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule", rule: v.rule });
      // X7 (2026-09-10): a bare "blocked" makes a current model retry the same
      // call with small variations — which is what the audit log then fills up
      // with. Every other refusal in the app already names an alternative.
      return {
        block: true,
        reason: `Blocked by HappyVibe permission rule (${v.rule?.layer}: ${v.rule?.pattern}). ${NEXT_STEP}`,
      };
    }
    // §23 floor-of-ask: while planning, "everything else" (MCP/unknown tools)
    // never auto-allows — an allow becomes an ask; deny already returned above,
    // explicit rules are honored by falling through to the prompt.
    if (v.action === "allow" && !planFloorAsk) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: v.source === "rule" ? "rule" : "safe-default", rule: v.rule });
      grantBoundary();
      return;
    }

    // §28: localhost is the dev-preview case, which is ~all of the value, and a
    // prompt per page load would make the feature unusable — so it is a
    // safe-DEFAULT, exactly like SAFE_TOOLS: an explicit ask/deny rule on
    // `browser:localhost` still wins, because those are handled above. Not while
    // planning: the floor-of-ask covers navigation too (§28's plan clamp lets
    // open/navigate through as floor-ask precisely so it still prompts).
    if (browserNav && v.source === "default" && !planFloorAsk) {
      const host = hostOf(input.url as string);
      if (host && isLocalHost(host)) {
        audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "safe-default" });
        return;
      }
    }

    // ask — an earlier "Allow for session" grant covers default asks only;
    // an explicit ask RULE always re-prompts (that's what the rule is for).
    // v5: a session grant also covers the outside-workspace confinement ask.
    if ((v.source === "default" || v.source === "outside-workspace") && sessionGrants.has(permTool)) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "user", grant: "session" });
      grantBoundary();
      return;
    }

    // v5: outside-workspace asks show the FACTUAL reason + path (never masked).
    const title = JSON.stringify(
      v.source === "outside-workspace"
        ? { kind: "hv.permission", tool: permTool, summary, reason: "outside-workspace", path: v.outsidePath }
        : {
            kind: "hv.permission",
            tool: permTool,
            summary,
            // §35: the id travels as its OWN field so main can name the
            // schedule. Parsing it back out of `summary` would be reading our
            // own prose, and the prompt must show a NAME, not a uuid.
            ...(tool === "schedule_delete" && typeof input.id === "string" ? { scheduleId: input.id } : {}),
            ...(boundary ? { boundary } : {}),
            // §13 (2026-10-05): the server's own claim about the tool, shown as a claim.
            ...(mcp?.hint ? { serverHint: mcp.hint } : {}),
          },
    );
    // Surfaces as extension_ui_request over RPC (verified by D1 probe).
    // NO timeout, NO auto-allow: permission prompts wait indefinitely by design.
    const choice = await ctx.ui.select(title, ["Allow", "Allow for session", "Deny"]);

    if (choice === "Allow for session") {
      sessionGrants.add(permTool);
      audit(ctx.ui, { tool: permTool, summary, decision: "allow-session", source: "user" });
      grantBoundary();
      return;
    }
    if (choice === "Allow") {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "user" });
      grantBoundary();
      return;
    }
    audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "user" });
    return { block: true, reason: `User denied this action in HappyVibe. ${NEXT_STEP}` };
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
      // A read-only run never honours bypass, so it must not show the red banner either.
      const on = dangerous && !readonly;
      ctx.ui.notify(JSON.stringify({ kind: "hv.dangerous", on }), on ? "warning" : "info");
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
        // Pi 0.99's "Sign in with ChatGPT" refuses to start without a stable per-install UUID.
        // Pi's own /login takes it from global settings.json (`deviceId`); use that same one.
        // Imported lazily: tests import this module and must not load Pi to do it.
        const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
        const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: false });
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
            // The flow's own signal fires when it no longer needs the answer (the browser callback won
            // the race with the paste-back box); ours fires on /hv-login-cancel. Either one must close
            // the request — otherwise only an answer from the renderer can, and a renderer that lost the
            // dialog leaves the flow holding its callback port until restart.
            const opts = { signal: p.signal ?? ac.signal };
            if (p.type === "select") {
              const label = await ctx.ui.select(
                authPayload({ stage: "select", provider, message: p.message }),
                p.options.map((o: { label: string }) => o.label),
                opts,
              );
              const id = p.options.find((o: { label: string }) => o.label === label)?.id;
              if (id === undefined) throw new Error("Login cancelled");
              return id;
            }
            const v = p.type === "manual_code"
              ? await ctx.ui.input(authPayload({ stage: "manual_code", provider, message: p.message ?? "Paste the authorization code" }), undefined, opts)
              : await ctx.ui.input(
                  authPayload({ stage: "prompt", provider, message: p.message, placeholder: p.placeholder }),
                  p.placeholder,
                  opts,
                );
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
        }, { getDeviceId: () => settings.getOrCreateDeviceId() });
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

  /** The agent inventory — tintinweb's own discovery (twEnumerateAgents, above). */
  const enumerateAgents = (): Promise<AgentDef[]> => twEnumerateAgents();

  pi.registerCommand("hv-agents", {
    description: "HappyVibe: emit the agent inventory (hv.agents notify)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify({ kind: "hv.agents", agents: await enumerateAgents() }), "info");
    },
  });

  // ── Async subagents (docs/validation/d1.md §hv.subagent) ────────────────────
  // tintinweb emits lifecycle events on the shared pi.events bus (never on RPC
  // stdout). We relay each as a fire-and-forget hv.subagent notify (hv-tw-relay.ts).
  const subEnvelope = (o: Record<string, unknown>): string => JSON.stringify({ kind: "hv.subagent", ...o });
  const relay = (o: Record<string, unknown>, type: "info" | "warning" = "info"): void => busUi?.notify(subEnvelope(o), type);

  // §12 (2026-09-26): tintinweb's live runs, for the resync and the busy gate.
  let twRunning: Set<string> = new Set();
  /** tintinweb's versioned bus RPC (docs/rpc.md): `<channel>:reply:<requestId>` carries `{success}`. */
  let twSeq = 0;
  const twRpc = (channel: string, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    new Promise((resolve) => {
      const requestId = `hv-${++twSeq}-${Date.now()}`;
      const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 10_000);
      const off = pi.events.on(`${channel}:reply:${requestId}`, (reply) => {
        clearTimeout(t);
        (off as unknown as (() => void) | undefined)?.();
        const r = reply as { success?: boolean; error?: string };
        resolve({ ok: r?.success === true, error: r?.error });
      });
      pi.events.emit(channel, { requestId, ...params });
    });

  // pi.events is absent in the module-level test mocks (real pi always has it).
  if (pi.events) {
    twRunning = registerTwRelay({
      on: (ev, h) => pi.events.on(ev, h),
      relay: (n) => relay({ ...n }),
      // Decision 4: the FULL answer, for the context hook's substitution (hv-subagent-delivery.ts).
      onResult: (runId, agent, result) => rememberTwResult(childOutputs, runId, agent, result),
      // The registry is tintinweb's documented second surface (docs/rpc.md § manager registry).
      sessionFileOf: (runId) =>
        (globalThis as Record<symbol, { getRecord?(id: string): { session?: { sessionManager?: { getSessionFile?(): string | undefined } } } | undefined } | undefined>)[
          Symbol.for("pi-subagents:manager")
        ]?.getRecord?.(runId)?.session?.sessionManager?.getSessionFile?.(),
    });
  }

  // main→bridge is RPC-prompt only, so run control rides slash commands.
  pi.registerCommand("hv-subagent-interrupt", {
    description: "HappyVibe: interrupt a running async subagent. Usage: /hv-subagent-interrupt <runId>",
    handler: async (args, ctx) => {
      const runId = args.trim();
      if (!runId) return;
      // tintinweb: one run is one child, so the run's STOP is its own `subagents:rpc:stop` — and a
      // workflow run (`wf_…`) stops WHOLE through the patched `workflow-stop` verb (P6).
      const { ok } = runId.startsWith("wf_")
          ? await twRpc("subagents:rpc:workflow-stop", { runId })
          : await twRpc("subagents:rpc:stop", { agentId: runId });
      ctx.ui.notify(subEnvelope({ stage: ok ? "interrupt-sent" : "interrupt-error", runId }), ok ? "info" : "warning");
    },
  });

  /**
   * §12 (2026-09-26): message a running tintinweb run mid-run — the run card's box and the
   * composer's picked run both land here. The message is base64 so a sentence with spaces,
   * quotes or newlines survives the one-line slash command intact. Drives the patched
   * `subagents:rpc:steer` verb (P6), which refuses anything but a running top-level agent.
   */
  pi.registerCommand("hv-subagent-steer", {
    description: "HappyVibe: send a message to a running sub-agent. Usage: /hv-subagent-steer <runId> <base64 message>",
    handler: async (args, ctx) => {
      const [runId, b64] = args.trim().split(/\s+/);
      if (!runId || !b64) return;
      let message = "";
      try { message = Buffer.from(b64, "base64").toString("utf8"); } catch { /* malformed */ }
      if (!message.trim()) return;
      const { ok, error } = await twRpc("subagents:rpc:steer", { agentId: runId, message });
      ctx.ui.notify(subEnvelope({ stage: ok ? "steer-sent" : "steer-error", runId, ...(error ? { error } : {}) }), ok ? "info" : "warning");
    },
  });

  pi.registerCommand("hv-subagent-list", {
    description: "HappyVibe: emit the active async subagent runs (hv.subagent active notify)",
    handler: async (_args, ctx) => {
      // tintinweb: children live in THIS process, so what is running is what the relay tracked —
      // and after a respawn that is nothing, which is the truth the renderer must be told.
      ctx.ui.notify(subEnvelope({ stage: "active", runs: [...twRunning].map((runId) => ({ runId })) }), "info");
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
      // B2 (2026-09-10): the label rules live on the `label` param and the
      // dismissal sentence in DISMISSED_RESULT — each said once (X2).
      "Ask the user only for a decision that changes what you build and that the code, docs or a " +
      "tool cannot answer. Blocks until they answer. At most 4 questions; options exhaustive and " +
      "mutually exclusive; your recommended option first. The UI adds a free-text 'Other' itself.",
    parameters: Type.Object({
      intent: intentParam(),
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
  // skills sentence (replaceSkillsSentence); a raw read is caught by the fallback above.
  pi.registerTool({
    name: "use_skill",
    label: "Use skill",
    description:
      // A4: the WHEN now lives in Pi's own skills block (one sentence, swapped
      // by replaceSkillsSentence). This says only what the call does.
      "Load a skill's instructions by name. Prefer this over reading a SKILL.md file.",
    parameters: Type.Object({
      intent: intentParam(),
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
      intent: intentParam(),
      command: Type.String({ description: "One command line. No embedded newlines." }),
      terminalId: Type.Optional(Type.String({ description: "Reuse this terminal instead of opening a new one. It must be idle." })),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const { command, terminalId, intent } = params as { command?: unknown; terminalId?: string; intent?: string };
      // Belt and braces: the tool_call handler already refused a multi-line
      // command before the permission prompt (that ordering is the point), so
      // this arm only catches a call that reached execute some other way.
      const checked = checkCommand(command);
      if (!checked.ok) return { content: [{ type: "text", text: checked.reason }], details: {} };
      // `intent` rides along so main can echo it on the hv.terminal notify: the
      // CARD leads with the model's headline (§7). The permission prompt does
      // not see this — it was built from the factual summary long before.
      // A1 (2026-09-10): `toolCallId` rides along so main can echo it on the
      // hv.terminal started notify. It is the ONLY join between the transcript
      // card for this call (which knows the tool call id) and the run rail's
      // circle (which knows the terminal id) — the two describe one run and
      // nothing connected them, so the card→circle flight had no destination
      // to aim at. Pi hands it to `execute`; we used to discard it.
      const raw = await ctx.ui.input(
        JSON.stringify({ kind: "hv.terminal-run", command: checked.command, terminalId, intent, toolCallId }),
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
      intent: intentParam(),
      terminalId: Type.String({ description: "The terminal to stop." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { terminalId } = params as { terminalId?: string };
      const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.terminal-kill", terminalId }), "");
      return terminalReply(raw);
    },
  });
  } // builtins.terminal

  // ── §28: the embedded browser's ten tools ────────────────────────────────
  // ONE group, like the terminal trio and for the same reason: an agent that can
  // navigate but not read is a agent that opens pages nobody asked for, and one
  // that can read but not close cannot tidy up. Every tool is a thin shell over
  // a BLOCKING hv.browser-* input — main owns the pane, the egress gate and the
  // cap, and browserReply guarantees the turn never hangs.
  //
  // Ten separate tools rather than one with an action enum: §10's rules must be
  // able to say "deny browser_evaluate, allow browser_get_text" without the gate
  // growing a branch that reads arguments.
  if (builtins.browser) {
  const browserInput = async (
    ctx: { ui: { input(title: string, initial: string): Promise<unknown> } },
    payload: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof browserReply>>> => {
    // ONE choke point for every browser tool that takes a url, so open and
    // navigate cannot disagree and a future url-taking tool inherits it.
    // Before ctx.ui.input on purpose: a scheme we will never load must not
    // spend a permission prompt (see schemeRefusal for what that cost).
    const refusal = typeof payload.url === "string" ? schemeRefusal(payload.url) : null;
    if (refusal) return { content: [{ type: "text", text: refusal }], details: {} };
    return browserReply(await ctx.ui.input(JSON.stringify(payload), ""), "browser", asUrl(payload.url));
  };

  pi.registerTool({
    name: "browser_open",
    label: "Open browser",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_open,
    parameters: Type.Object({
      intent: intentParam(),
      url: Type.String({ description: "The URL to open. localhost needs no approval; anything else asks the user." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { url, intent } = params as { url?: string; intent?: string };
      if (!url) return { content: [{ type: "text", text: "browser_open needs a url." }], details: {} };
      return browserInput(ctx, { kind: "hv.browser-open", url, intent });
    },
  });

  pi.registerTool({
    name: "browser_navigate",
    label: "Navigate browser",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_navigate,
    parameters: Type.Object({
      intent: intentParam(),
      url: Type.String({ description: "The URL to navigate to." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { url, intent } = params as { url?: string; intent?: string };
      if (!url) return { content: [{ type: "text", text: "browser_navigate needs a url." }], details: {} };
      return browserInput(ctx, { kind: "hv.browser-navigate", url, intent });
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Screenshot page",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_screenshot,
    parameters: Type.Object({
      intent: intentParam(),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { intent } = params as { intent?: string };
      return browserInput(ctx, { kind: "hv.browser-screenshot", intent });
    },
  });

  pi.registerTool({
    name: "browser_get_text",
    label: "Read page",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_get_text,
    parameters: Type.Object({
      intent: intentParam(),
    }),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return browserInput(ctx, { kind: "hv.browser-get-text" });
    },
  });

  pi.registerTool({
    name: "browser_read_console",
    label: "Read page console",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_read_console,
    parameters: Type.Object({
      intent: intentParam(),
      lines: Type.Optional(Type.Number({ description: "How many trailing messages. Default 100, capped at 200." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { lines } = params as { lines?: number };
      return browserInput(ctx, { kind: "hv.browser-read-console", lines });
    },
  });

  pi.registerTool({
    name: "browser_read_network",
    label: "Read page network",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_read_network,
    parameters: Type.Object({
      intent: intentParam(),
      limit: Type.Optional(Type.Number({ description: "How many trailing requests. Default 50, capped at 200." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { limit } = params as { limit?: number };
      return browserInput(ctx, { kind: "hv.browser-read-network", limit });
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Click in page",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_click,
    parameters: Type.Object({
      intent: intentParam(),
      selector: Type.String({ description: "A CSS selector for the element to click." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { selector, intent } = params as { selector?: string; intent?: string };
      if (!selector) return { content: [{ type: "text", text: "browser_click needs a selector." }], details: {} };
      return browserInput(ctx, { kind: "hv.browser-click", selector, intent });
    },
  });

  pi.registerTool({
    name: "browser_type",
    label: "Type in page",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_type,
    parameters: Type.Object({
      intent: intentParam(),
      selector: Type.String({ description: "A CSS selector for the field to type into." }),
      text: Type.String({ description: "The text to type." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { selector, text, intent } = params as { selector?: string; text?: string; intent?: string };
      if (!selector || text === undefined) {
        return { content: [{ type: "text", text: "browser_type needs a selector and text." }], details: {} };
      }
      return browserInput(ctx, { kind: "hv.browser-type", selector, text, intent });
    },
  });

  pi.registerTool({
    name: "browser_evaluate",
    label: "Run JS in page",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_evaluate,
    parameters: Type.Object({
      intent: intentParam(),
      code: Type.String({ description: "JavaScript to evaluate in the page. The final expression is the result." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { code, intent } = params as { code?: string; intent?: string };
      if (!code) return { content: [{ type: "text", text: "browser_evaluate needs code." }], details: {} };
      return browserInput(ctx, { kind: "hv.browser-evaluate", code, intent });
    },
  });

  pi.registerTool({
    name: "browser_close",
    label: "Close browser",
    description: BROWSER_TOOL_DESCRIPTIONS.browser_close,
    parameters: Type.Object({
      intent: intentParam(),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { intent } = params as { intent?: string };
      return browserInput(ctx, { kind: "hv.browser-close", intent });
    },
  });
  } // builtins.browser

  // ── §32 web tools ────────────────────────────────────────────────────────
  // ONE group, four thin shells over blocking hv.web-* inputs. Main calls the
  // web service, so main owns the URL, the encrypted key, the caps, the
  // deadline and the audit row; the bridge carries the request and turns the
  // reply into a tool result. browserReply is the mapper — it already wraps
  // the payload in <untrusted source="web"> on `untrusted:true`, and a page
  // fetched headlessly is exactly as untrusted as one rendered in the pane.
  //
  // Four separate tools rather than one with an action enum: §10's rules must
  // be able to allow web_search by default while asking per host for the other
  // three, without the gate growing a branch that reads arguments.
  if (builtins.web) {
  /**
   * The abort path. Pi hands `execute` an AbortSignal; when a turn is
   * interrupted we tell main by NOTIFY (fire-and-forget — there is no reply to
   * wait for, and the blocking input is about to be answered anyway) so it can
   * abort the HTTP request and DELETE a crawl job. Without it an abandoned
   * crawl holds one of the service's two worker slots for its full two minutes,
   * and those two are shared by every HappyVibe install.
   */
  const webInput = async (
    ctx: {
      ui: {
        input(title: string, initial: string): Promise<unknown>;
        notify(message: string, type?: "info" | "warning" | "error"): void;
      };
    },
    toolCallId: string,
    signal: AbortSignal | undefined,
    payload: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof browserReply>>> => {
    const onAbort = (): void => ctx.ui.notify(JSON.stringify({ kind: "hv.web-cancel", toolCallId }), "info");
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return browserReply(await ctx.ui.input(JSON.stringify({ ...payload, toolCallId }), ""), "web", asUrl(payload.url));
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  pi.registerTool({
    name: "web_search",
    label: "Search the web",
    description: WEB_TOOL_DESCRIPTIONS.web_search,
    parameters: Type.Object({
      intent: intentParam(),
      query: Type.String({ description: "The search query. `site:example.com` works." }),
      limit: Type.Optional(
        Type.Integer({ description: `Results to return (default ${WEB_CAPS.search.defaultLimit}, max ${WEB_CAPS.search.maxLimit}).` }),
      ),
      includeContent: Type.Optional(
        Type.Boolean({
          description:
            `Also return up to ${WEB_CAPS.search.contentChars} chars of each result as markdown. Slower and much ` +
            "larger — prefer a plain search, then web_fetch the one page you want.",
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const { query, limit, includeContent } = params as { query?: string; limit?: number; includeContent?: boolean };
      if (!query) return { content: [{ type: "text", text: "web_search needs a query." }], details: {} };
      return webInput(ctx, toolCallId, signal, { kind: "hv.web-search", query, limit, includeContent });
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Read a web page",
    description: WEB_TOOL_DESCRIPTIONS.web_fetch,
    parameters: Type.Object({
      intent: intentParam(),
      url: Type.String({ description: "The http(s) URL to read. Not localhost or a private address — use browser_open for those." }),
      maxChars: Type.Optional(
        Type.Integer({ description: `Chars to return (default ${WEB_CAPS.fetch.defaultChars}, max ${WEB_CAPS.fetch.maxChars}).` }),
      ),
      startIndex: Type.Optional(
        Type.Integer({ description: "Character offset to start from (default 0). The result header tells you the next one." }),
      ),
      fresh: Type.Optional(
        Type.Boolean({ description: "Skip the service's cache. Only when you specifically need a page that changed just now." }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const { url, maxChars, startIndex, fresh } = params as {
        url?: string; maxChars?: number; startIndex?: number; fresh?: boolean;
      };
      if (!url) return { content: [{ type: "text", text: "web_fetch needs a url." }], details: {} };
      return webInput(ctx, toolCallId, signal, { kind: "hv.web-fetch", url, maxChars, startIndex, fresh });
    },
  });

  pi.registerTool({
    name: "web_map",
    label: "List a site's pages",
    description: WEB_TOOL_DESCRIPTIONS.web_map,
    parameters: Type.Object({
      intent: intentParam(),
      url: Type.String({ description: "The site's http(s) URL." }),
      search: Type.Optional(Type.String({ description: "Only return URLs matching this text." })),
      limit: Type.Optional(
        Type.Integer({ description: `URLs to return (default ${WEB_CAPS.map.defaultLimit}, max ${WEB_CAPS.map.maxLimit}).` }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const { url, search, limit } = params as { url?: string; search?: string; limit?: number };
      if (!url) return { content: [{ type: "text", text: "web_map needs a url." }], details: {} };
      return webInput(ctx, toolCallId, signal, { kind: "hv.web-map", url, search, limit });
    },
  });

  pi.registerTool({
    name: "web_crawl",
    label: "Read a site",
    description: WEB_TOOL_DESCRIPTIONS.web_crawl,
    parameters: Type.Object({
      intent: intentParam(),
      url: Type.String({ description: "The http(s) URL to start from." }),
      limit: Type.Optional(
        Type.Integer({ description: `Pages to read (default ${WEB_CAPS.crawl.defaultLimit}, max ${WEB_CAPS.crawl.maxLimit}).` }),
      ),
      maxDepth: Type.Optional(
        Type.Integer({ description: `How many links deep (default ${WEB_CAPS.crawl.defaultDepth}, max ${WEB_CAPS.crawl.maxDepth}).` }),
      ),
      includePaths: Type.Optional(Type.Array(Type.String(), { description: "Regexes a page's path must match, e.g. \"^/docs\"." })),
      excludePaths: Type.Optional(Type.Array(Type.String(), { description: "Regexes a page's path must NOT match." })),
      maxCharsPerPage: Type.Optional(
        Type.Integer({
          description: `Chars per page (default ${WEB_CAPS.crawl.defaultCharsPerPage}, max ${WEB_CAPS.crawl.maxCharsPerPage}).`,
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const p = params as {
        url?: string; limit?: number; maxDepth?: number; includePaths?: string[]; excludePaths?: string[]; maxCharsPerPage?: number;
      };
      if (!p.url) return { content: [{ type: "text", text: "web_crawl needs a url." }], details: {} };
      return webInput(ctx, toolCallId, signal, {
        kind: "hv.web-crawl",
        url: p.url,
        limit: p.limit,
        maxDepth: p.maxDepth,
        includePaths: p.includePaths,
        excludePaths: p.excludePaths,
        maxCharsPerPage: p.maxCharsPerPage,
      });
    },
  });
  } // builtins.web

  // §31 Documents: ONE tool over ONE blocking envelope, the browser_get_text
  // shape exactly. Main owns conversion (a one-shot sidecar), path resolution
  // and the audit row; this is a thin shell. The payload rides `title` because
  // this is a blocking INPUT — a notify carries its payload in `message`, and
  // getting that backwards is how a card silently never appears.
  if (builtins.document) {
    pi.registerTool({
      name: DOCUMENT_TOOL,
      label: "Read document",
      description: DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL],
      parameters: Type.Object({
        path: Type.String({ description: "Path to the document (workspace-relative or absolute, like read)." }),
        offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed), like read." })),
        limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read, like read." })),
        intent: intentParam(),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
        const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.document-read", path, offset, limit }), "");
        return documentReply(raw);
      },
    });
  } // builtins.document

  // ── §33 Memory: three thin shells over blocking envelopes ────────────────
  //
  // MAIN IS THE ONE WRITER. The bridge validates nothing beyond "is this scope even available"
  // — main owns the slug, the caps, the secret scan, the atomic write, the index regeneration
  // and the audit row, so a human edit from the Memory page and an agent save cannot diverge.
  //
  // A registered tool rather than letting the model `write` into the folder (Claude Code's way):
  // a write there is indistinguishable from any other file edit, escapes the workspace, and
  // gives no card, no scope badge, no secret scan, no index regeneration and no audit type.
  //
  // The whole block is gated on the global dir being present, which is how "memory is off"
  // reaches here — main simply does not name the scope. Off costs 0.
  if (memoryOn) {
    const MemoryScope = Type.Union([Type.Literal("global"), Type.Literal("workspace")], {
      description: "global = about the user, in every project; workspace = about this project only.",
    });
    const memoryError = (text: string): { content: [{ type: "text"; text: string }]; details: Record<string, unknown> } => ({
      content: [{ type: "text", text }],
      details: {},
    });
    /** Every envelope is answered by main — a non-string here means the round trip broke, and
     *  the model must be told rather than left with an empty result it reads as success. */
    const memoryAsk = async (
      ctx: { ui: { input: (title: string, value: string) => Promise<unknown> } },
      payload: Record<string, unknown>,
    ): Promise<string | null> => {
      const raw = await ctx.ui.input(JSON.stringify(payload), "");
      return typeof raw === "string" && raw ? raw : null;
    };

    pi.registerTool({
      name: "memory_save",
      label: "Remember",
      description:
        // B8/X2: what to save, and what not to, is the policy's job — it is in
        // the system prompt every turn. This says what the call does.
        "Save one durable memory for future sessions; the same name replaces the existing one.",
      parameters: Type.Object({
        intent: intentParam(),
        scope: MemoryScope,
        type: Type.Union([Type.Literal("user"), Type.Literal("feedback"), Type.Literal("project"), Type.Literal("reference")], {
          description: "See the Types line in your memory instructions.",
        }),
        name: Type.String({ description: "Short stable name, e.g. 'talk like a young engineer'. The same name replaces the existing memory." }),
        description: Type.String({ description: "One line, at most 150 characters — this is what you see in the index every turn." }),
        content: Type.String({ description: "The fact itself, at most 4 KB of markdown." }),
      }),
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { scope: string; type: string; name: string; description: string; content: string };
        if (p.scope === "workspace" && !memoryWorkspaceDir) {
          return memoryError("Memory is turned off for this workspace. Save it as a global memory, or leave it unsaved.");
        }
        const raw = await memoryAsk(ctx, {
          kind: "hv.memory-save",
          scope: p.scope,
          type: p.type,
          name: p.name,
          description: p.description,
          content: p.content,
          toolCallId,
        });
        if (raw === null) return memoryError("ERROR: the memory could not be saved.");
        if (raw.startsWith("ERROR:")) return memoryError(raw);
        // "ok:<slug>" or "replaced:<slug>" — main owns the slug, so the model learns the real
        // name it must use to recall or forget this later.
        const sep = raw.indexOf(":");
        const verb = sep < 0 ? "ok" : raw.slice(0, sep);
        const slug = sep < 0 ? p.name : raw.slice(sep + 1);
        return {
          content: [{ type: "text", text: `${verb === "replaced" ? "Updated memory" : "Remembered"} "${slug}" (${p.scope}).` }],
          details: { scope: p.scope, type: p.type, name: slug, description: p.description, replaced: verb === "replaced" },
        };
      },
    });

    pi.registerTool({
      name: "memory_recall",
      label: "Recall",
      description:
        "Open one memory in full, by its name in the index.",
      parameters: Type.Object({
        intent: intentParam(),
        scope: MemoryScope,
        name: Type.String({ description: "The memory's name, exactly as it appears in the index." }),
      }),
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { scope: string; name: string };
        if (p.scope === "workspace" && !memoryWorkspaceDir) {
          return memoryError("Memory is turned off for this workspace, so there are no workspace memories to recall.");
        }
        const raw = await memoryAsk(ctx, { kind: "hv.memory-recall", scope: p.scope, name: p.name, toolCallId });
        if (raw === null) return memoryError("ERROR: the memory could not be read.");
        return { content: [{ type: "text", text: raw }], details: { scope: p.scope, name: p.name } };
      },
    });

    pi.registerTool({
      name: "memory_forget",
      label: "Forget",
      description:
        "Delete one memory by name. To correct one, save it again under the same name instead.",
      parameters: Type.Object({
        intent: intentParam(),
        scope: MemoryScope,
        name: Type.String({ description: "The memory's name, exactly as it appears in the index." }),
      }),
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { scope: string; name: string };
        if (p.scope === "workspace" && !memoryWorkspaceDir) {
          return memoryError("Memory is turned off for this workspace, so there is nothing to forget there.");
        }
        const raw = await memoryAsk(ctx, { kind: "hv.memory-forget", scope: p.scope, name: p.name, toolCallId });
        if (raw === null) return memoryError("ERROR: the memory could not be forgotten.");
        if (raw.startsWith("ERROR:")) return memoryError(raw);
        return {
          content: [{ type: "text", text: `Forgot "${p.name}" (${p.scope}).` }],
          details: { scope: p.scope, name: p.name },
        };
      },
    });
  } // builtins.memory

  // ── §35 Schedules: four tools, and main owns every decision ───────────────
  //
  // The model PROPOSES and the user CONFIRMS: create and update open the
  // drawer prefilled and the tool's result is whatever the user did. Nothing
  // here writes a schedule, even under a workspace bypass — a schedule is
  // future unattended spend, and the drawer is where the mode card and the
  // cost line are visible.
  //
  // Scoping is main's job, not this file's: there is no workspaceId parameter
  // on any of the four, so the model cannot name another workspace to begin
  // with, and main answers `not found` for an id outside the calling session's.
  if (builtins.schedules) {
    const scheduleAsk = async (
      ctx: { ui: { input: (title: string, value: string) => Promise<unknown> } },
      payload: Record<string, unknown>,
    ): Promise<string> => {
      const raw = await ctx.ui.input(JSON.stringify(payload), "");
      // Main ALWAYS answers (the hv.plan-write rule) — but if it ever did not,
      // say so rather than returning an empty string the model reads as success.
      return typeof raw === "string" && raw ? raw : "ERROR: HappyVibe did not answer.";
    };

    const RepeatSchema = Type.Union([
      Type.Object({ kind: Type.Literal("daily") }),
      Type.Object({ kind: Type.Literal("weekdays") }),
      Type.Object({ kind: Type.Literal("weekly"), days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, description: "0 = Sunday … 6 = Saturday" }) }),
      Type.Object({ kind: Type.Literal("hours"), every: Type.Integer({ minimum: 1, maximum: 23 }) }),
      // Sub-hourly runs are real sessions with real bills, so the description
      // says so — the user still confirms in the drawer, but the model should
      // not reach for "every minute" as a neutral default.
      Type.Object({ kind: Type.Literal("minutes"), every: Type.Integer({ minimum: 1, maximum: 59, description: "Minutes between runs. Each run is a full session — prefer 15 or more unless the user asked for something faster." }) }),
      Type.Object({ kind: Type.Literal("once"), date: Type.String({ description: "YYYY-MM-DD" }) }),
    ], { description: "How often it repeats." });
    const AtSchema = Type.String({ description: "The time of day, as HH:MM in the user's local time." });
    const UntilSchema = Type.String({
      description: "Optional end, as YYYY-MM-DD (the end of that day) or YYYY-MM-DDTHH:MM. The schedule stops on its own then. Omit it for a schedule with no end, which is the default.",
    });
    const ModeSchema = Type.Union([Type.Literal("readonly"), Type.Literal("full")], {
      description: "readonly = it can read, search and report but change nothing; full = this workspace's usual permission rules, and an `ask` waits for the user. Prefer readonly for reviews and reports.",
    });

    pi.registerTool({
      name: "schedule_list",
      label: "List schedules",
      description: "List this workspace's schedules: what each one runs, when, in which mode, and how its last run went.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const raw = await scheduleAsk(ctx, { kind: "hv.schedule-list" });
        return { content: [{ type: "text", text: raw }], details: { count: raw.startsWith("•") ? raw.split("\n").length : 0 } };
      },
    });

    pi.registerTool({
      name: "schedule_create",
      label: "Propose a schedule",
      description:
        "Propose a recurring run of a prompt in this workspace. The user sees your proposal in a form and confirms or declines it — nothing is created until they do.",
      parameters: Type.Object({
        intent: intentParam(),
        title: Type.String({ description: "A short name for the schedule, e.g. 'Daily change review'." }),
        prompt: Type.String({ description: "The prompt to send each time it runs. Write it to stand alone — nobody is watching the run." }),
        repeat: RepeatSchema,
        at: AtSchema,
        mode: Type.Optional(ModeSchema),
        until: Type.Optional(UntilSchema),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { title: string; prompt: string; repeat: unknown; at: string; mode?: string; until?: string };
        const raw = await scheduleAsk(ctx, {
          kind: "hv.schedule-create",
          draft: {
            title: p.title, prompt: p.prompt, repeat: p.repeat, at: p.at,
            ...(p.mode ? { mode: p.mode } : {}), ...(p.until ? { until: p.until } : {}),
          },
        });
        const text = raw.startsWith("created ")
          ? `Created. It is on the Schedules page now.`
          : raw === "declined" ? "The user declined the schedule, so nothing was created."
          : raw;
        return { content: [{ type: "text", text }], details: { result: raw } };
      },
    });

    pi.registerTool({
      name: "schedule_update",
      label: "Propose a change",
      description:
        "Propose a change to one of this workspace's schedules (use schedule_list for its id). The user sees the change in a form and confirms or declines it. Set enabled through the form, not here.",
      parameters: Type.Object({
        intent: intentParam(),
        id: Type.String({ description: "The schedule's id, from schedule_list." }),
        title: Type.Optional(Type.String()),
        prompt: Type.Optional(Type.String()),
        repeat: Type.Optional(RepeatSchema),
        at: Type.Optional(AtSchema),
        mode: Type.Optional(ModeSchema),
        until: Type.Optional(UntilSchema),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { id: string; title?: string; prompt?: string; repeat?: unknown; at?: string; mode?: string; until?: string };
        const patch: Record<string, unknown> = {};
        for (const k of ["title", "prompt", "repeat", "at", "mode", "until"] as const) if (p[k] !== undefined) patch[k] = p[k];
        const raw = await scheduleAsk(ctx, { kind: "hv.schedule-update", id: p.id, patch });
        const text = raw.startsWith("updated ")
          ? "Updated."
          : raw === "declined" ? "The user declined the change, so nothing was altered."
          : raw === "not found" ? "There is no schedule with that id in this workspace."
          : raw;
        return { content: [{ type: "text", text }], details: { result: raw } };
      },
    });

    pi.registerTool({
      name: "schedule_delete",
      label: "Delete a schedule",
      description: "Delete one of this workspace's schedules (use schedule_list for its id). To pause one instead, propose a change.",
      parameters: Type.Object({
        intent: intentParam(),
        id: Type.String({ description: "The schedule's id, from schedule_list." }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as { id: string };
        const raw = await scheduleAsk(ctx, { kind: "hv.schedule-delete", id: p.id });
        const text = raw === "deleted" ? "Deleted."
          : raw === "not found" ? "There is no schedule with that id in this workspace."
          : raw;
        return { content: [{ type: "text", text }], details: { result: raw } };
      },
    });
  } // builtins.schedules

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
      // A3: the structure is stated once, in the Plan Mode instructions. This
      // says what the call does and when, not what the plan must contain.
      "Submit the finished plan for the user to review, as the final action of your turn. " +
      "Markdown, in the structure your Plan Mode instructions give.",
    parameters: Type.Object({
      intent: intentParam(),
      plan: Type.String({ description: "The complete plan as Markdown (see the required structure in your instructions)." }),
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
      "Enter Plan Mode for this session when the user asks you to plan before acting: read-only " +
      "exploration ending in an implementation plan. Only the user can leave it.",
    parameters: Type.Object({
      intent: intentParam(),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!plan.enabled) {
        plan = { enabled: true, planPath: undefined };
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
      intent: intentParam(),
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
      // §13 (2026-10-05): each Pi MCP tool carries the rule name it is checked under.
      const servers = mcpServerNames();
      const tools = pi.getAllTools().map((t) => {
        const info = isPiMcpTool(t as never) && t.name !== READ_RESOURCE_TOOL ? mcpCallInfo(t as never, {}, servers) : null;
        return {
          name: t.name,
          description: t.description ?? "",
          source: t.sourceInfo?.source ?? t.sourceInfo?.scope ?? "builtin",
          ...(info ? { checkedAs: info.ruleTool } : {}),
        };
      });
      ctx.ui.notify(JSON.stringify({ kind: "hv.tools", tools }), "info");
    },
  });

  // §13 (2026-10-05): tool names of this workspace's .mcp.json servers, for the MCP page —
  // Pi's shell commands never see servers an extension registered (mcpWorkspaceProbe.ts).
  pi.registerCommand("hv-mcp-tools", {
    description: "HappyVibe: tool names of this workspace's .mcp.json servers (hv.mcp-tools notify)",
    handler: async (_args, ctx) => {
      const servers: Record<string, string[]> = Object.fromEntries(mcpRegistered.map((s) => [s, [] as string[]]));
      for (const t of pi.getAllTools()) {
        const ns = (t as { namespace?: { name: string } }).namespace?.name;
        if (!isPiMcpTool(t as never) || !ns) continue;
        const s = mcpRegistered.find((n) => mcpNamespace(n) === ns);
        if (s) servers[s].push(t.name.slice(ns.length + 2));
      }
      ctx.ui.notify(JSON.stringify({ kind: "hv.mcp-tools", servers, errors: mcpRegisterErrors }), "info");
    },
  });
}
