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

import { containsPath, foldCase, isAbsolutePath, stripTrailingSep, toPosix } from "./hv-paths";

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  /** Absolute workspace cwd the Pi session runs in. */
  workspace: string;
  /**
   * win32: the filesystem is case-insensitive, so paths fold case before matching.
   *
   * Set by the CALLER — the bridge from process.platform, main from the platform
   * seam — because this module is import-free by contract (the renderer loads it).
   */
  caseInsensitivePaths?: boolean;
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
// §32: web_search is the only WEB tool here, and the split is the point — a
// search query has no target host a user could meaningfully approve, while
// web_fetch/web_map/web_crawl each name one and gate under browser:<host>.
// Recorded honestly: the query still leaves the machine, to the web service,
// so a deny rule on web_search must still bite (it does — a safe default is a
// DEFAULT, not a bypass).
//
// §31: reading a document exercises no power — it is Pi's own `read`, one
// format further on. Spelled, not imported: this module is zero-import.
// §33: `memory_recall` is here and memory_save/memory_forget deliberately are NOT. Recall
// returns text the user has already reviewed on the Memory page and can read there any time —
// the use_skill doctrine. Saving and forgetting CHANGE what every future session is told, so
// they default to ask like any other write.
/**
 * Pi's arbitrary-shell tools. `bash` everywhere; `powershell` on a Windows box with
 * no Git Bash, where spawn passes `--tools` naming it instead (PRD §4, Windows round).
 *
 * Any gate that treats `bash` as "the shell" must treat both the same, so this is the
 * ONE list and `=== "bash"` is a bug wherever it means the shell. The terminal tools
 * are deliberately NOT here — they are a different thing, with their own rules.
 */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);
export const isShellTool = (tool: string): boolean => SHELL_TOOLS.has(tool);

// `find` is Pi's own read-only search (its builtins are bash/edit/find/grep/ls/read/write);
// `glob`/`list` are kept for older Pi names. Added 2026-09-27: without it every sub-agent
// `find` prompted — and before child prompts existed, was silently refused.
export const SAFE_TOOLS = new Set(["read", "grep", "find", "glob", "list", "ls", "ask_user", "plan_complete", "plan_start", "plan_status_update", "use_skill", "terminal_read", "browser_get_text", "browser_read_console", "browser_read_network", "browser_screenshot", "browser_close", "web_search", "document_read", "memory_recall",
  // §35: schedule_list is a read. schedule_create and schedule_update are here
  // for the ask_user reason rather than that one — their ONLY effect is to open
  // the drawer for the human to fill in, and main refuses to write without it
  // (even under a bypass). A permission modal in front of a confirmation dialog
  // asks the same question twice and teaches people to click through both.
  // schedule_delete is deliberately NOT here: it deletes with no second dialog.
  "schedule_list", "schedule_create", "schedule_update",
  // §12 (2026-09-26, tintinweb): a steer is a message to a run ALREADY inside the boundary the
  // user approved, so it cannot widen what the child may do; a result read is a read. Both are
  // audited like any other call. `get_subagent_result` with `wait: true` is refused earlier, by
  // the never-block rule (isResultWait), before this set is ever consulted.
  "steer_subagent", "get_subagent_result"]);

/**
 * pi-subagents' parent-blocking wait tool, under EVERY name it has shipped under.
 *
 * Not a permission concept — it lives here because this is the shared, pure
 * tool-name module both the bridge and the renderer already import, and the two
 * must agree (the bridge BLOCKS the call, the renderer HIDES the card).
 *
 * PRD §12 ("never block on the result") is enforced by matching this name: async
 * results auto-deliver as their own turn, but pi-subagents still steers the model
 * to wait, which would re-block the turn. Upstream has renamed it TWICE with no
 * alias either time, silently disarming a guard that matched the literal string:
 * 0.35.0 did `wait` → `subagent_wait`, and 0.61.0 did `subagent_wait` → `bg_wait`
 * ("Remove the deprecated compatibility wait alias", #1729). All three names stay
 * listed so the guard spans every pin we have shipped, and
 * tests/pi-subagents-contract.test.ts asserts the name upstream ACTUALLY
 * registers is in this set — that tripwire is the only thing that caught 0.61.
 */
export const WAIT_TOOLS = new Set(["wait", "subagent_wait", "bg_wait"]);

export function isWaitTool(tool: unknown): boolean {
  return typeof tool === "string" && WAIT_TOOLS.has(tool);
}

/**
 * Every tool name that STARTS a delegation, across both vendored stacks:
 * nicobailon's `subagent` and tintinweb's `Agent` (PRD §12, 2026-09-26). One set,
 * because the renderer card, the label, the activity gate and ipc's correlation
 * each carried their own literal and a rename would have missed one.
 */
export const DELEGATION_TOOLS: ReadonlySet<string> = new Set(["subagent", "Agent"]);

export const isDelegationTool = (tool: unknown): boolean =>
  typeof tool === "string" && DELEGATION_TOOLS.has(tool);

/** The agent a delegation names: `agent` on nicobailon's `subagent`, `subagent_type` on tintinweb's `Agent`. */
export function delegationAgent(args: unknown): string | undefined {
  const a = args as { agent?: unknown; subagent_type?: unknown } | null | undefined;
  const v = a?.agent ?? a?.subagent_type;
  return typeof v === "string" && v ? v : undefined;
}

/**
 * The detached run a delegation's tool result started, or undefined for a call that
 * returned its answer inline. nicobailon: `details.asyncId`. tintinweb: `details.agentId`
 * when `details.status === "background"` — a foreground Agent carries an agentId too,
 * but it is not a run anything must track (d1.md § tintinweb wire shapes).
 */
export function delegationRunId(details: unknown): string | undefined {
  const d = details as { asyncId?: unknown; agentId?: unknown; status?: unknown } | null | undefined;
  if (typeof d?.asyncId === "string" && d.asyncId) return d.asyncId;
  return d?.status === "background" && typeof d.agentId === "string" && d.agentId ? d.agentId : undefined;
}

/** tintinweb's blocking wait: `get_subagent_result` with `wait: true` (§12 never-block rule). */
export const isResultWait = (tool: unknown, input: unknown): boolean =>
  tool === "get_subagent_result" && (input as { wait?: unknown } | null)?.wait === true;

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

/** v5: Pi's built-in FILE tools — the ones whose path args we confine to the
 * workspace by default. bash is deliberately NOT here (it stays under
 * command-pattern rules; path-inspecting arbitrary shell is out of scope). */
export const FILE_TOOLS = new Set([
  "read", "write", "edit", "multi_edit", "multiedit", "grep", "find", "glob", "ls", "list",
]);

/**
 * v5: does a file path point OUTSIDE the workspace root? Pure and separator-agnostic
 * (Windows round): absolute paths — posix, drive-letter or UNC — must sit under the
 * workspace; relative paths must not climb above it with `..`; `~` is outside.
 * `caseInsensitive` comes from the caller, because this module stays import-free.
 * ponytail: no realpath (this module is import-free) — a symlink inside the
 * workspace that points out won't be caught; upgrade to fs.realpath in main
 * if that ever matters.
 */
export function escapesWorkspace(p: string, workspace: string, caseInsensitive = false): boolean {
  if (p.startsWith("~")) return true;
  // Absolute covers `/x`, `C:\x` and `\\server\share` — a drive-letter path used to
  // fall through to the relative branch, where its zero `..` count read as "inside".
  if (isAbsolutePath(p)) return !containsPath(workspace, p, caseInsensitive);
  let depth = 0;
  // Split on the NORMALISED form, or `..\..\secrets.txt` is one segment and climbs free.
  for (const seg of toPosix(p).split("/")) {
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
  // path layer — match any file-ish arg, relative to the workspace when inside it.
  //
  // Everything is POSIX-normalised FIRST: globToRegExp's path mode is built from
  // `[^/]`, so without this a `src/**` rule could never match `C:\ws\src\a.ts` —
  // the user writes a rule, the Permissions page shows it, and it applies to nothing.
  const ci = call.caseInsensitivePaths === true;
  const re = globToRegExp(foldCase(rule.pattern, ci), "path");
  const ws = foldCase(stripTrailingSep(toPosix(call.workspace)), ci) + "/";
  return pathArgs(call.input).some((raw) => {
    const p = foldCase(toPosix(raw), ci);
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
    const outside = pathArgs(call.input).find((p) =>
      escapesWorkspace(p, call.workspace, call.caseInsensitivePaths === true));
    if (outside) return { action: "ask", source: "outside-workspace", outsidePath: outside };
  }
  if (SAFE_TOOLS.has(call.tool)) return { action: "allow", source: "safe-default" };
  return { action: "ask", source: "default" };
}
