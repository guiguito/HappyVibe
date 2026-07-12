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
  /** "rule" when a rule decided; defaults mirror the pre-B4 bridge. */
  source: "rule" | "safe-default" | "default";
  /** The most-restrictive matching rule when source is "rule". */
  rule?: Rule & { scope: "global" | "workspace" };
}

/** Tools that never need approval by default (pre-B4 spike behavior).
 * ask_user is UI-only (V2.B): prompting for permission to ask a question
 * would stack two blocking modals for a harmless call. */
export const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls", "ask_user"]);

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
  if (SAFE_TOOLS.has(call.tool)) return { action: "allow", source: "safe-default" };
  return { action: "ask", source: "default" };
}
