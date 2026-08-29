/**
 * HappyVibe permission rule engine (B4) — PURE module, zero imports.
 *
 * Lives next to the bridge so Pi's extension loader can resolve it at
 * runtime, and is imported directly by src/main (settings "test a call"
 * evaluate) and by vitest — one engine, logic never forks.
 *
 * Scope model (locked): one global ruleset + per-workspace overrides layered
 * on top. Most-restrictive-wins across ALL matching rules in BOTH scopes:
 * deny > ask > allow. No match → spike default (SAFE_TOOLS allow, else ask).
 */

export type RuleLayer = "tool" | "path" | "command";
export type RuleAction = "allow" | "ask" | "deny";

export interface Rule {
  layer: RuleLayer;
  pattern: string;
  action: RuleAction;
}

/** On-disk shape of permission-rules.json (userData). */
export interface RulesFile {
  global: Rule[];
  /** Keyed by absolute workspace path — the path IS the workspace id. */
  workspaces: Record<string, Rule[]>;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  /** Absolute workspace cwd the Pi session runs in. */
  workspace: string;
}

export interface Verdict {
  action: RuleAction;
  /** "rule" when a rule decided; defaults mirror the pre-B4 bridge.
   *  "outside-workspace" (v5): a file tool reached outside the workspace root. */
  source: "rule" | "safe-default" | "default" | "outside-workspace";
  /** The most-restrictive matching rule when source is "rule". */
  rule?: Rule & { scope: "global" | "workspace" };
  /** The offending path when source is "outside-workspace" (for the prompt). */
  outsidePath?: string;
}

/** Tools that never need approval by default (pre-B4 spike behavior).
 * ask_user is UI-only (V2.B): prompting for permission to ask a question
 * would stack two blocking modals for a harmless call. */
// §23: plan_* are app-internal control tools (mode transitions / plan submission),
// not model-driven side effects — they must never raise a permission prompt.
// §14: use_skill returns SKILL.md content (read-only, app-internal) — a permission
// prompt for loading an already-approved skill would be pure friction.
// §26: terminal_read is a POLL. The agent's only way to know a dev server came up
// is to read the buffer repeatedly, so a prompt here would fire on every poll,
// forever — friction that would push the model back to `npm run dev &> /tmp/log &`,
// the thing the feature exists to replace. terminal_run/terminal_kill are NOT here.
// §28: reading a page the user can see costs them nothing, and get_text is the
// primitive the model is supposed to prefer over a screenshot — prompting for it
// would push the model towards `bash curl`, which no egress gate can see.
// browser_close removes power. The ACTING tools (open/navigate/click/type/
// evaluate) are deliberately NOT here: navigation gates per host as
// `browser:<host>`, and evaluate is the one call that turns "the page can reach
// X" into "the agent can exfiltrate through X".
export const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls", "ask_user", "plan_complete", "plan_start", "plan_status_update", "use_skill", "terminal_read", "browser_get_text", "browser_read_console", "browser_read_network", "browser_screenshot", "browser_close"]);

/**
 * pi-subagents' parent-blocking wait tool, under EVERY name it has shipped under.
 *
 * Not a permission concept — it lives here because this is the shared, pure
 * tool-name module both the bridge and the renderer already import, and the two
 * must agree (the bridge BLOCKS the call, the renderer HIDES the card).
 *
 * PRD §12 ("never block on the result") is enforced by matching this name: async
 * results auto-deliver as their own turn, but pi-subagents still steers the model
 * to wait, which would re-block the turn. 0.35.0 renamed `wait` → `subagent_wait`
 * with NO alias, silently disarming a guard that matched the literal string — so
 * both names stay listed, and tests/pi-subagents-contract.test.ts asserts the name
 * upstream actually registers is in this set.
 */
export const WAIT_TOOLS = new Set(["wait", "subagent_wait"]);

export function isWaitTool(tool: unknown): boolean {
  return typeof tool === "string" && WAIT_TOOLS.has(tool);
}

/**
 * pi-subagents >=0.50's prompt redaction, as a literal we must recognise.
 *
 * 0.50 replaces the delegation `task`/`goal` with this string on EVERY observer
 * surface — the `subagent:async-*` lifecycle events, `status.json`'s
 * `steps[].description`, run metadata, and the child's own input artifact. It is
 * unconditional (no config key, no env var; `statusStepDescription` ignores its
 * argument outright), and the child still receives the real task via its prompt,
 * so delegation works — only the surfaces we DISPLAY from lose the text.
 *
 * It lives beside WAIT_TOOLS for the same reason: an upstream literal that both
 * the bridge and the renderer must agree on. Neither can import it from
 * pi-subagents — the renderer has no path to a vendored runtime package — so the
 * value is duplicated here ON PURPOSE and
 * tests/pi-subagents-contract.test.ts asserts it still equals upstream's own
 * exported constant. If upstream changes the wording, that test fails loudly
 * rather than the UI quietly captioning a card "[prompt redacted]".
 */
export const REDACTED_PROMPT = "[prompt redacted]";

/** True for a task/goal string 0.50 redacted — i.e. one we must not display. */
export function isRedactedPrompt(text: unknown): boolean {
  return typeof text === "string" && text.trim() === REDACTED_PROMPT;
}

/** A task/goal safe to show, or undefined when absent or redacted. */
export function displayableTask(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.trim();
  return t && !isRedactedPrompt(t) ? t : undefined;
}

/**
 * pi-subagents >=0.58's external-CLI builtin agents, which HappyVibe refuses.
 *
 * 0.58 grew upstream's builtin roster from 7 agents to 13, and these six run a
 * third-party CLI in its own process (`runner: {type: "external-cli"}`). The
 * capability ceiling cannot bound one, the child guard cannot run inside one,
 * and its tool calls never reach the audit log — upstream refuses ask/deny
 * rules for external runners by design and withholds extension authority from
 * them. So PRD §12's three layers simply do not reach inside them, and they
 * arrive DELEGATABLE the moment the pin lands, `-writer` variants included.
 *
 * Refusing here rather than only through upstream's settings file is
 * deliberate, and measured: a PROJECT-scope `.pi/settings.json` override beats
 * the user scope outright (pi-subagents' agents.ts returns on the project
 * override before it ever reads the user one), so a cloned repo could re-enable
 * one with `{"subagents":{"agentOverrides":{"claude-code":{"disabled":false}}}}`.
 * Main owns the rules; upstream's roster is hygiene, not enforcement.
 *
 * Exact names only. A user's own agent called `claude-code-review-helper` is
 * theirs, and shadowing a builtin name is their business — their file is a
 * native Pi child the ceiling governs like any other.
 *
 * Running an external agent is a PRODUCT decision (an explicitly marked
 * boundary exception in the delegation modal), never a side effect of a pin
 * bump. tests/pi-subagents-contract.test.ts asserts this set still equals
 * exactly the external-runner builtins upstream ships, so a seventh adapter
 * fails there loudly instead of arriving ungoverned.
 *
 * It lives beside WAIT_TOOLS and REDACTED_PROMPT for the same reason: an
 * upstream name set the bridge and the renderer must agree on, and neither can
 * import it from the vendored package.
 */
export const EXTERNAL_CLI_AGENTS: ReadonlySet<string> = new Set([
  "claude-code",
  "claude-code-writer",
  "codex-exec",
  "codex-exec-writer",
  "cursor-agent",
  "cursor-agent-writer",
]);

/** True for an upstream external-CLI builtin agent — one we will not launch. */
export function isExternalCliAgent(agent: unknown): boolean {
  return typeof agent === "string" && EXTERNAL_CLI_AGENTS.has(agent);
}

/**
 * Builtins HappyVibe starts DISABLED because they cannot do their job here — a
 * SEPARATE concern from EXTERNAL_CLI_AGENTS above, deliberately kept as its own
 * set because the two mean different things and only the first is a refusal.
 *
 * From 2026-08-30 this is a DEFAULT the user can override per agent on the
 * Agents page; the external set above stays forced. Only explicit user choices
 * are stored (config `agentsEnabled`), so changing what is in this set still
 * reaches everyone who never expressed an opinion.
 *
 * These are ordinary Pi children the ceiling governs perfectly well. The problem
 * is that each is inoperable or meaningless under our own constraints, and
 * offering an agent that cannot deliver what its description promises is worse
 * than not offering it (§20 product taste).
 *
 * `researcher` declares `web_search`, `fetch_content` and `get_search_content`.
 * Pi registers NONE of them — its builtins are exactly bash/edit/find/grep/ls/
 * read/write. Measured 2026-08-29 through `resolveSubagentLaunchContract`: under
 * our capability ceiling it resolves to `["read"]`, because upstream intersects
 * `declaredBuiltinTools` with the ceiling's `allowedTools` (pi-args.ts) — so it
 * does not fail loudly, it runs as a local-file reader while its prompt tells it
 * to search the web. Revisit when web search exists (an MCP server would do it).
 *
 * `oracle` exists to reason over inherited state ("protects inherited state and
 * prevents drift") and declares `defaultContext: fork`, but our
 * `defaultSubagentContext: "fresh"` wins — measured, every agent resolves
 * `ctx = fresh`. An oracle with nothing inherited has no premise.
 *
 * Enforcement is upstream's settings file ONLY (subagentSettings.ts), not a
 * bridge refusal. A project-scope `.pi/settings.json` can re-enable one, and
 * that is accepted: the consequence is a confused agent, not a boundary hole.
 * That is exactly why this is not merged into EXTERNAL_CLI_AGENTS, whose members
 * must keep failing at the bridge no matter what any settings file says.
 */
export const UNSUPPORTED_BUILTIN_AGENTS: ReadonlySet<string> = new Set([
  "researcher",
  "oracle",
]);

/**
 * Why each of the above starts off, in the user's words.
 *
 * The set is a DEFAULT, not a refusal (2026-08-30): the Agents page can switch
 * any of them back on. So the reason has to be shown — an unexplained agent that
 * starts disabled reads as a bug, and a user who turns one on deserves to know
 * what they are getting.
 */
export const UNSUPPORTED_BUILTIN_REASON: Record<string, string> = {
  researcher: "Needs web search, which this Pi runtime does not provide — it would only be able to read local files.",
  oracle: "Works by inheriting the parent conversation, which HappyVibe keeps separate so a sub-agent never sees your session.",
};

/** Every upstream builtin we write `disabled: true` for, for either reason. */
export const DISABLED_BUILTIN_AGENTS: ReadonlySet<string> = new Set([
  ...EXTERNAL_CLI_AGENTS,
  ...UNSUPPORTED_BUILTIN_AGENTS,
]);

/** v5: Pi's built-in FILE tools — the ones whose path args we confine to the
 * workspace by default. bash is deliberately NOT here (it stays under
 * command-pattern rules; path-inspecting arbitrary shell is out of scope). */
export const FILE_TOOLS = new Set([
  "read", "write", "edit", "multi_edit", "multiedit", "grep", "glob", "ls", "list",
]);

/**
 * v5: does a file path point OUTSIDE the workspace root? Pure, posix-only
 * (the app is mac/linux-first). Absolute paths must sit under the workspace;
 * relative paths must not climb above it with `..`; `~` is treated as outside.
 * ponytail: no realpath (this module is import-free) — a symlink inside the
 * workspace that points out won't be caught; upgrade to fs.realpath in main
 * if that ever matters.
 */
export function escapesWorkspace(p: string, workspace: string): boolean {
  const ws = workspace.replace(/\/+$/, "");
  if (p.startsWith("~")) return true;
  if (p.startsWith("/")) return p !== ws && !p.startsWith(ws + "/");
  let depth = 0;
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { depth--; if (depth < 0) return true; }
    else depth++;
  }
  return false;
}

export const EMPTY_RULES: RulesFile = { global: [], workspaces: {} };

const LAYERS: readonly string[] = ["tool", "path", "command"];
const ACTIONS: readonly string[] = ["allow", "ask", "deny"];

function isRule(r: unknown): r is Rule {
  const o = r as Rule;
  return (
    !!o && typeof o === "object" &&
    LAYERS.includes(o.layer) && ACTIONS.includes(o.action) &&
    typeof o.pattern === "string" && o.pattern.length > 0
  );
}

/**
 * Parse + sanitize a rules file. Throws on invalid JSON or a non-object
 * root; silently drops malformed individual rules (forward compat: newer
 * app versions may write layers this engine doesn't know).
 */
export function parseRulesFile(raw: string): RulesFile {
  const parsed = JSON.parse(raw) as Partial<RulesFile>;
  if (!parsed || typeof parsed !== "object") throw new Error("rules file: root must be an object");
  const global = Array.isArray(parsed.global) ? parsed.global.filter(isRule) : [];
  const workspaces: Record<string, Rule[]> = {};
  if (parsed.workspaces && typeof parsed.workspaces === "object") {
    for (const [ws, rules] of Object.entries(parsed.workspaces)) {
      if (Array.isArray(rules)) workspaces[ws] = rules.filter(isRule);
    }
  }
  return { global, workspaces };
}

/**
 * Glob-lite → anchored RegExp.
 *  - path mode:    `**` any depth, `*` within a segment, `?` one char (not `/`)
 *  - command mode: `*` matches anything incl. spaces, `?` one char
 */
export function globToRegExp(pattern: string, mode: "path" | "command"): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (mode === "path" && pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += mode === "path" ? "[^/]*" : ".*";
      }
    } else if (c === "?") {
      out += mode === "path" ? "[^/]" : ".";
    } else {
      out += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Input keys that carry file paths across Pi's built-in tools. */
const PATH_KEYS = /^(path|file_?path|file|dir|directory)$/i;

function pathArgs(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (PATH_KEYS.test(k) && typeof v === "string" && v) out.push(v);
  }
  return out;
}

function ruleMatches(rule: Rule, call: ToolCall): boolean {
  if (rule.layer === "tool") {
    return globToRegExp(rule.pattern, "command").test(call.tool);
  }
  if (rule.layer === "command") {
    const cmd = call.input.command;
    return typeof cmd === "string" && globToRegExp(rule.pattern, "command").test(cmd.trim());
  }
  // path layer — match any file-ish arg, relative to the workspace when inside it
  const re = globToRegExp(rule.pattern, "path");
  const ws = call.workspace.endsWith("/") ? call.workspace : call.workspace + "/";
  return pathArgs(call.input).some((p) => {
    const rel = p.startsWith(ws) ? p.slice(ws.length) : p;
    return re.test(rel) || re.test(p);
  });
}

const RESTRICTIVENESS: Record<RuleAction, number> = { deny: 2, ask: 1, allow: 0 };

/** Evaluate one tool call against global + workspace rules. */
export function evaluate(rules: RulesFile, call: ToolCall): Verdict {
  const scoped: Array<Rule & { scope: "global" | "workspace" }> = [
    ...rules.global.map((r) => ({ ...r, scope: "global" as const })),
    ...(rules.workspaces[call.workspace] ?? []).map((r) => ({ ...r, scope: "workspace" as const })),
  ];
  let winner: (Rule & { scope: "global" | "workspace" }) | undefined;
  for (const r of scoped) {
    if (!ruleMatches(r, call)) continue;
    if (!winner || RESTRICTIVENESS[r.action] > RESTRICTIVENESS[winner.action]) winner = r;
  }
  if (winner) return { action: winner.action, source: "rule", rule: winner };
  // v5: a file tool reaching outside the workspace asks — even reads that would
  // otherwise be safe-default-allowed. Explicit rules above still win.
  if (FILE_TOOLS.has(call.tool)) {
    const outside = pathArgs(call.input).find((p) => escapesWorkspace(p, call.workspace));
    if (outside) return { action: "ask", source: "outside-workspace", outsidePath: outside };
  }
  if (SAFE_TOOLS.has(call.tool)) return { action: "allow", source: "safe-default" };
  return { action: "ask", source: "default" };
}
