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
import { parseAgentFile, toAgentDef, type AgentDef, type AgentSource } from "./hv-agents";
import { FILE_TOOLS, nearestAgentsMd, nestedFileList, renderNestedSection, toolFilePath } from "./hv-agents-md";

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
const INTENT_TOOLS = ["subagent", "ask_user", "mcp"]; // ask_user declares intent in its own schema — requireIntent's guard makes this a no-op for it
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
type MutableParams = { properties?: Record<string, unknown>; required?: string[] };
function requireIntent(pi: ExtensionAPI): void {
  for (const name of INTENT_TOOLS) {
    const params = pi.getAllTools().find((t) => t.name === name)?.parameters as MutableParams | undefined;
    if (!params?.properties || params.properties.intent) continue; // tool absent or already wired
    params.properties.intent = INTENT_PARAM;
    params.required = [...(params.required ?? []), "intent"];
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
type AuditSource = "rule" | "user" | "dangerous" | "safe-default";

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

  pi.on("session_start", async (_event, ctx) => {
    requireIntent(pi); // all extensions have registered by now (idempotent across reloads)
    restoreMarks(ctx.sessionManager.getEntries() as unknown as SessionEntry[]);
  });

  pi.on("before_agent_start", async (event) => {
    const sp = (event.systemPrompt ?? "") as string;
    // W2.3: nested AGENTS.md injection — content re-read at injection time so
    // it's always current. Returning systemPrompt replaces it for THIS TURN
    // ONLY (agent-session.js resets to the base prompt when we return nothing).
    const section = renderNestedSection(nestedAgentsMd, process.cwd(), readFileOrNull);
    const injected = sp + section;
    systemText = injected;
    const opts = (event.systemPromptOptions ?? {}) as {
      selectedTools?: unknown[];
      contextFiles?: Array<{ path?: string; content?: string }>;
    };
    systemBlock = {
      chars: injected.length,
      estTokens: Math.ceil(injected.length / 4),
      toolCount: Array.isArray(opts.selectedTools) ? opts.selectedTools.length : 0,
      contextFiles: (opts.contextFiles ?? []).map((f) => {
        const chars = (f.content ?? "").length;
        return { path: f.path ?? "", chars, estTokens: Math.ceil(chars / 4) };
      }),
    };
    if (section) return { systemPrompt: injected };
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

    // Dangerous mode: everything runs without prompting, but NEVER silently —
    // each call is audit-flagged and the renderer shows a permanent banner.
    if (dangerous) {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "dangerous" });
      return;
    }

    const v = evaluate(rules, { tool: permTool, input, workspace: process.cwd() });

    if (v.action === "deny") {
      audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule", rule: v.rule });
      return { block: true, reason: `Blocked by HappyVibe permission rule (${v.rule?.layer}: ${v.rule?.pattern})` };
    }
    if (v.action === "allow") {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: v.source === "rule" ? "rule" : "safe-default", rule: v.rule });
      return;
    }

    // MCP discovery (search/describe/connect) is read-only against servers the
    // user configured — allow by default; an explicit ask/deny rule still wins
    // (handled above), matching the SAFE_TOOLS safe-default semantics.
    if (mcp?.kind === "discovery" && v.source === "default") {
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
      const auth = ctx.modelRegistry.authStorage;
      const ids = new Set([...STATUS_PROVIDERS, ...auth.list()]);
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
      const auth = ctx.modelRegistry.authStorage;
      if (!auth.getOAuthProviders().some((p) => p.id === provider)) {
        ctx.ui.notify(authPayload({ stage: "error", provider, message: `Unknown OAuth provider: ${provider}` }), "error");
        return;
      }
      const ac = new AbortController();
      loginAborts.set(provider, ac);
      try {
        // AuthStorage.login persists to auth.json AND updates the in-memory
        // credential map — no respawn needed afterwards (s0.2 §2).
        await auth.login(provider, {
          signal: ac.signal,
          onAuth: (info) =>
            ctx.ui.notify(authPayload({ stage: "auth_url", provider, url: info.url, instructions: info.instructions }), "info"),
          onDeviceCode: (i) =>
            ctx.ui.notify(authPayload({
              stage: "device_code", provider,
              userCode: i.userCode, verificationUri: i.verificationUri,
              intervalSeconds: i.intervalSeconds, expiresInSeconds: i.expiresInSeconds,
            }), "info"),
          onProgress: (message) => ctx.ui.notify(authPayload({ stage: "progress", provider, message }), "info"),
          onPrompt: async (p) => {
            const v = await ctx.ui.input(
              authPayload({ stage: "prompt", provider, message: p.message, placeholder: p.placeholder }),
              p.placeholder,
            );
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
          onManualCodeInput: async () => {
            const v = await ctx.ui.input(authPayload({ stage: "manual_code", provider, message: "Paste the authorization code" }));
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
          onSelect: async (p) => {
            const label = await ctx.ui.select(
              authPayload({ stage: "select", provider, message: p.message }),
              p.options.map((o) => o.label),
            );
            return p.options.find((o) => o.label === label)?.id;
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
      ctx.modelRegistry.authStorage.logout(provider);
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
