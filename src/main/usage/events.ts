/**
 * §39 — the usage event catalog, and the ONLY list of events (D20).
 *
 * Imports NOTHING: the renderer imports it (its analytics client and the
 * Privacy page's "What is sent", which is generated from each `plain` line),
 * and a runtime import here would put node:* in the browser bundle.
 *
 * Every value is from a closed set the app ships (D9): enums, numbers,
 * booleans, and `id` — a shipped catalog id or the literal `custom`. The guard
 * enforces the shape; the mappers choose the value. Nothing user-typed ever
 * reaches a param.
 */
export const CATEGORIES = ["activation", "core", "trust", "understanding", "feature", "cost", "quality", "growth"] as const;
export type Category = (typeof CATEGORIES)[number];
export type ParamSpec = { type: "bool" } | { type: "number" } | { type: "enum"; values: readonly string[] } | { type: "id" };
export interface EventSpec {
  category: Category;
  plain: string;
  params: Readonly<Record<string, ParamSpec>>;
}
export type UsageParams = Record<string, string | number | boolean>;

const bool = { type: "bool" } as const;
const num = { type: "number" } as const;
const id = { type: "id" } as const;
const oneOf = <const V extends readonly string[]>(...values: V) => ({ type: "enum", values }) as const;

export const USAGE_EVENTS = {
  onboarding_started: { category: "activation", plain: "The first-run guide opened", params: { providerPrechecked: bool } },
  onboarding_dismissed: { category: "activation", plain: "The first-run guide was closed early, and at which step", params: { atStep: oneOf("welcome", "setup_model", "setup_workspace", "handover") } },
  onboarding_completed: { category: "activation", plain: "The first-run guide finished, and how long it took", params: { durationSec: num, skippedAnimation: bool } },
  provider_connected: { category: "activation", plain: "A model provider was connected, and how (key, sign-in, local runner or custom endpoint)", params: { provider: id, method: oneOf("api_key", "oauth", "local_runner", "custom_endpoint"), providerCount: num } },
  workspace_added: { category: "activation", plain: "A project folder was added, and whether it uses git", params: { isGitRepo: bool, workspaceCount: num } },
  session_opened: { category: "core", plain: "A chat session was created, or a schedule started one", params: { kind: oneOf("new", "scheduled"), inWorktree: bool } },
  prompt_sent: { category: "core", plain: "You sent a message: counts of attachments and mentioned files, never the text", params: { planMode: bool, attachments: num, fileMentions: num, usedTemplate: bool, viaVoice: bool, queued: bool } },
  agent_turn_completed: { category: "core", plain: "The agent finished a turn: how it ended, how long it took, how many tools and files it touched, which model", params: { outcome: oneOf("completed", "aborted", "error"), errorKind: oneOf("auth", "balance", "rate_limit", "overloaded", "server", "network", "context_overflow", "model_not_found", "pi_exit", "other"), durationSec: num, toolCalls: num, filesEdited: num, subagentRuns: num, provider: id, model: id, billing: oneOf("metered", "plan", "unknown"), scheduled: bool } },
  permission_answered: { category: "trust", plain: "You answered a permission prompt: allow or deny, the kind of tool, how long it took", params: { decision: oneOf("allow", "allow_session", "deny"), toolKind: oneOf("bash", "edit", "write", "read", "mcp", "browser", "web", "subagent", "workflow", "terminal", "memory", "schedule", "other"), waitSec: num } },
  bypass_changed: { category: "trust", plain: "Bypass permissions was turned on or off", params: { on: bool, scope: oneOf("session", "workspace", "global") } },
  plan_mode_changed: { category: "trust", plain: "Plan mode was entered, produced a plan, was implemented, reverted or left", params: { action: oneOf("entered", "plan_ready", "implemented", "reverted", "exited") } },
  panel_opened: { category: "understanding", plain: "You opened the context, cost, changes or files panel, or a sub-agent's card", params: { panel: oneOf("context", "cost", "git", "files", "run_card"), contextPct: num } },
  context_changed: { category: "understanding", plain: "The conversation was trimmed: a turn removed, a rewind, or a compaction", params: { action: oneOf("turn_removed", "compacted", "rewound"), rewindMode: oneOf("conversation", "files", "both"), trigger: oneOf("suggested", "manual", "auto"), tokensFreed: num } },
  feature_used: { category: "feature", plain: "A feature was used for the first time in a session", params: { feature: oneOf("terminal", "agent_terminal", "browser", "voice", "document", "web_search", "web_read", "memory", "skill", "prompt_template", "subagent", "workflow", "mcp_tool", "ask_user", "file_editor", "git_panel"), trigger: oneOf("user", "agent") } },
  builtin_toggled: { category: "feature", plain: "A built-in tool or a bundled skill, prompt or agent was switched on or off (never one you made)", params: { item: id, kind: oneOf("builtin_tool", "bundled_skill", "bundled_prompt", "bundled_agent"), on: bool } },
  model_changed: { category: "feature", plain: "A model was chosen, and for what", params: { provider: id, model: id, scope: oneOf("global", "workspace", "session", "agent", "autofill") } },
  mcp_server_added: { category: "feature", plain: "A tool server was added: from the catalog, a plugin or by hand (a name you typed is never sent)", params: { source: oneOf("catalog", "plugin", "manual"), server: id, transport: oneOf("stdio", "http"), auth: oneOf("oauth", "key", "none") } },
  plugin_installed: { category: "feature", plain: "A plugin was installed", params: { plugin: id, marketplace: oneOf("store", "custom") } },
  schedule_created: { category: "feature", plain: "A schedule was created: how often, and with what access", params: { recurrence: oneOf("daily", "weekdays", "weekly", "hours", "minutes", "once"), access: oneOf("readonly", "full"), source: oneOf("page", "agent") } },
  git_action: { category: "feature", plain: "A git action succeeded from the changes panel (never a branch name or a message)", params: { action: oneOf("commit", "amend", "switch", "delete_branch", "merge", "worktree_add", "worktree_remove", "sync", "publish", "stash", "undo_hunk", "undo_file", "discard_untracked", "init", "pull_request"), aiMessage: bool } },
  web_tool_called: { category: "cost", plain: "A web tool ran: which one, which service, whether it worked, how long and how much text", params: { tool: oneOf("search", "fetch", "map", "crawl"), service: oneOf("default", "custom"), ok: bool, errorCode: oneOf("UNAVAILABLE", "DEFAULT_PAUSED", "DEFAULT_OFF", "CUSTOM_URL_INVALID", "DEADLINE", "CANCELLED", "TOO_LARGE", "BAD_RESPONSE", "CRAWL_FAILED", "HTTP_4XX", "other"), ms: num, chars: num, pages: num } },
  session_start_failed: { category: "quality", plain: "A session could not start, and why", params: { reason: oneOf("no_model", "session_cap", "folder_unavailable", "other") } },
  star_nudge_answered: { category: "growth", plain: "The GitHub star card was answered: star or later", params: { action: oneOf("starred", "later") } },
} as const satisfies Record<string, EventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;

/** The `View` union in `src/renderer/src/components/Sidebar.tsx`; tests/usage-catalog.test.ts pins equality. */
export const SCREENS = [
  "chat", "schedules", "workspace", "guide",
  "models", "builtinTools", "memory", "plugins", "skills", "promptTemplates", "mcp", "agents", "sysprompt",
  "permissions", "tools", "terminal", "voice", "onBehalf", "shortcuts", "privacy", "stats", "audit", "changelog",
] as const;
export type Screen = (typeof SCREENS)[number];

/** The SDK's own events; `usageBeforeSend` lets them through with only their standard params. */
export const STANDARD_EVENTS = {
  app_installed: [],
  app_updated: ["previousVersion", "previousBuild"],
  app_started: ["trigger", "crashReporting"],
  session_crashed: ["kind", "crashedAt"],
  screen_viewed: ["screen"],
} as const satisfies Record<string, readonly string[]>;

/** Param keys that would name content. No catalog event may declare one (the absence test). */
export const NEVER_SENT_KEYS = [
  "path", "file", "fileName", "url", "host", "query", "command", "args", "arguments", "message", "text", "prompt",
  "reply", "title", "name", "branch", "commit", "cost", "costUsd", "spend", "key", "apiKey", "error", "errorMessage", "stderr", "workspace",
] as const;
