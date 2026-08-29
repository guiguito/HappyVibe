/**
 * HappyVibe agent-file support (B6) — PURE module, zero runtime imports.
 *
 * Lives next to the bridge so Pi's extension loader resolves it at runtime,
 * and is imported directly by src/main (path-confined read/write) and by
 * vitest. One parser, logic never forks — same discipline as hv-rules.ts.
 *
 * Its frontmatter parser is flat `key: value` (no YAML lib); we match it: parse
 * and serialize the same flat shape so a round-trip (read → edit body/model →
 * write) never corrupts a file pi-subagents reads. See
 * package/src/agents/frontmatter.ts in pi-subagents 0.33.1.
 *
 * DISCOVERY does not live here and never did well: from 2026-08-29 the bridge
 * calls pi-subagents' own `discoverAgentsAll`, because the two-directory scan
 * this module's comment used to describe was missing four of the six places
 * upstream actually looks. This module still owns PARSING and SERIALIZING —
 * the app edits agent files, so it needs a writer that round-trips.
 */

/**
 * Where an agent came from.
 *
 * Widened 2026-08-29 (the fleet round) from `builtin | project`: pi-subagents
 * discovers from SIX directories plus agents contributed by installed packages,
 * and the app listed two of them. `builtin` is now UPSTREAM's packaged roster;
 * `bundled` is ours (the app-owned agent dir). Both were "builtin" before,
 * which is exactly why nobody noticed upstream's seven were missing.
 *
 * Only `bundled` and `project` are writable by the app (`hv:write-agent` is
 * path-confined to those dirs) — the Agents page gates Edit on that.
 */
export type AgentSource = "builtin" | "bundled" | "user" | "project" | "package";

export interface AgentDef {
  name: string;
  description: string;
  /** Comma-separated tool allowlist from frontmatter, normalized to an array. */
  tools?: string[];
  /** `provider/modelId` or a bare model id — the agent-tier model override. */
  model?: string;
  source: AgentSource;
  /** Absolute path to the .md file. */
  path: string;
}

/**
 * Parse flat `key: value` frontmatter + markdown body. Mirrors pi-subagents'
 * parseFrontmatter for the flat case (the only case our agents use): no `---`
 * front block → whole file is the body.
 */
export function parseAgentFile(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const frontmatter: Record<string, string> = {};
  if (!normalized.startsWith("---")) return { frontmatter, body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { frontmatter, body: normalized };
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).trim();
  for (const line of block.split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[m[1]] = value;
  }
  return { frontmatter, body };
}

/** Serialize frontmatter + body back to the flat `.md` shape pi-subagents reads. */
export function serializeAgentFile(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(frontmatter)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** Build an AgentDef from a parsed file. Returns null when name/description are absent (pi-subagents skips those too). */
export function toAgentDef(
  frontmatter: Record<string, string>,
  source: AgentSource,
  filePath: string,
): AgentDef | null {
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name || !description) return null;
  const tools = frontmatter.tools
    ? frontmatter.tools.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;
  return { name, description, tools, model: frontmatter.model || undefined, source, path: filePath };
}

/**
 * Apply an edit to a raw agent file: replace the system-prompt body and/or set
 * the agent-tier model (frontmatter `model:`; empty string clears it). Unknown
 * frontmatter keys are preserved. Returns the new file content.
 */
export function editAgentFile(
  content: string,
  edit: { body?: string; model?: string | null },
): string {
  const { frontmatter, body } = parseAgentFile(content);
  if (edit.model === null || edit.model === "") delete frontmatter.model;
  else if (edit.model !== undefined) frontmatter.model = edit.model;
  return serializeAgentFile(frontmatter, edit.body ?? body);
}

/**
 * System-prompt suffix listing the subagents the model can delegate to. The
 * `subagent` tool's own description is static and tells the model to call
 * `{action:"list"}` to discover agents — which it rarely does — so we inject the
 * roster directly (same per-turn injection mechanism as renderNestedSection in
 * hv-agents-md.ts). Returns "" when there are no agents (inject nothing).
 */
export function renderSubagentSection(agents: AgentDef[]): string {
  if (agents.length === 0) return "";
  const lines = agents.map((a) => `- **${a.name}** — ${a.description.slice(0, 200)}`);
  return (
    "\n\n## Available subagents\n\n" +
    "These subagents are ready to delegate to right now. Prefer delegating exploration, long " +
    "searches, and self-contained research to the most fitting one instead of doing it inline — " +
    "each runs in its own context and reports back a concise result.\n\n" +
    lines.join("\n") +
    "\n\n**How to delegate:** call the `subagent` tool directly with `{ agent: \"<name>\", task: \"<what to do>\" }`. " +
    // The countermand stays (the tool description steers the model to call
    // `list` first, which costs a turn). The superlative that used to follow it
    // — "the agents above are the full, current list" — was removed 2026-08-29:
    // it was false while the roster came from a two-directory scan, and even
    // now a project-local agent file can add one between two turns.
    "Delegate directly by name. Do NOT call `{ action: \"list\" }` first. " +
    "Delegations run in the background by default. After you delegate, **end your turn** with a brief " +
    "note that the work is running in the background — do NOT call the `wait` tool and do NOT poll with " +
    "`subagent` status. This is an interactive session: the subagent's result is delivered to you " +
    "automatically as a new turn the moment it finishes, and you answer the user then. Meanwhile the " +
    "user can keep chatting with you."
  );
}

/** Suggest a unique agent name for a duplicate (`x` → `x-copy`, `x-copy-2`, …). */
export function duplicateName(base: string, existing: Set<string>): string {
  const first = `${base}-copy`;
  if (!existing.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

// ── tool → permission join (B4 verdict shape, no logic fork) ────────────────
// The tools list UI shows each built-in tool's current permission state. We do
// NOT re-implement evaluation here — main runs the SAME hv-rules evaluate() and
// hands us the verdict action; this only maps it to a display state.

export type PermState = "allow" | "ask" | "deny";

export interface ToolRow {
  name: string;
  description: string;
  source: string;
  permission: PermState;
}

/**
 * Join a tool list against verdicts (one per tool, from hv-rules evaluate()).
 * `verdicts[name]` is the RuleAction; a tool with no verdict defaults to "ask"
 * (mirrors the bridge's no-match default for a non-safe tool).
 */
export function joinToolPermissions(
  tools: Array<{ name: string; description?: string; source?: string }>,
  verdicts: Record<string, PermState>,
): ToolRow[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    source: t.source ?? "",
    permission: verdicts[t.name] ?? "ask",
  }));
}

/**
 * True when a discovered `.md` is a SLASH COMMAND, not an agent definition.
 *
 * pi-subagents claims `~/.agents` as its user agent dir and scans it
 * recursively. That directory is shared: Claude Code and tools built on it keep
 * slash commands in `commands/` and skills in `skills/`. Upstream already
 * excludes `skills/` (`isLegacyAgentSkillPath`), but not `commands/` — so on a
 * real install every Superset slash command (`10x`, `doctor`, `feedback`,
 * `setup`, from `~/.agents/commands/superset/`) was read as a delegatable
 * sub-agent, listed on the Agents page, and injected into the model's roster
 * every turn. They are not agents: they carry Claude Code's `argument-hint` and
 * `allowed-tools` keys and reference `${CLAUDE_SKILL_DIR}`.
 *
 * Same shape as upstream's own skills exclusion, one segment name different.
 * Matches a whole path SEGMENT so an agent named `commands-expert` survives.
 *
 * This hides them; it does not refuse them. They are ordinary Pi children the
 * capability ceiling governs, so a user who explicitly names one still gets it —
 * unlike the external-CLI agents, which are refused because nothing can bound
 * them. The problem here is advertising another tool's commands as our agents.
 */
export function isSlashCommandPath(filePath: string): boolean {
  return filePath.split(/[\\/]/).includes("commands");
}
