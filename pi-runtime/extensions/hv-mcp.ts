/**
 * HappyVibe MCP proxy-call unwrapping — PURE module, zero imports.
 *
 * pi-mcp-adapter registers ONE proxy tool named `mcp`; the real MCP tool a
 * call targets is buried in its params ({tool, args}). This module maps a
 * proxy call to (a) a virtual tool name the hv-rules engine evaluates —
 * "mcp:<tool>" for an invoke, so rules can target individual MCP tools (pattern
 * `mcp:github_*` etc.), or "mcp-manage:<…>" for a call that adds a server or signs
 * in to one (kind "manage", deliberately outside `mcp:`) — and (b) a human display
 * string, so the permission prompt and tool cards never show a bare "mcp". Same
 * discipline as hv-rules.ts: imported by the bridge, src/renderer, and vitest.
 */

export interface McpCallInfo {
  /** invoke = a server's tool; discovery = a read the bridge safe-defaults;
      manage = changes MCP config or sign-in state (docs-round #34), asked by default. */
  kind: "invoke" | "discovery" | "manage";
  mcpTool?: string;
  ruleTool: string;
  display: string;
  /** Round 4 #4: server key for brand-icon lookup — the explicit `server`
      param when present, else the prefix before the first "_" of the tool. */
  server?: string;
}

/** Every `action` pi-mcp-adapter's proxy dispatches (index.ts `execute`), by what it does.
    Pinned against the adapter source by tests/mcp-adapter-actions.test.ts. */
export const MCP_READ_ACTIONS: ReadonlySet<string> = new Set(["ui-messages"]);
export const MCP_MANAGE_ACTIONS: ReadonlySet<string> = new Set(["install", "auth-start", "auth-complete"]);

/** Rule names of manage calls. Outside `mcp:` on purpose, so no `mcp:*` rule and no
    MCP tool grant ever covers an install or a sign-in. */
export const MCP_MANAGE_PREFIX = "mcp-manage:";
export const isMcpManageRule = (tool: string): boolean => tool.startsWith(MCP_MANAGE_PREFIX);

/** Arg keys worth surfacing in the factual label, in priority order. */
const KEY_ARG_FIELDS = ["url", "uri", "query", "q", "path", "file", "name", "id", "title"];

/**
 * Parse the proxy `args` JSON string and return one short human-useful detail —
 * the first present non-empty string among KEY_ARG_FIELDS, whitespace-collapsed
 * and truncated. Never throws (malformed/non-object args → null).
 */
function keyArg(argsJson: unknown): string | null {
  if (typeof argsJson !== "string" || !argsJson.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of KEY_ARG_FIELDS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) {
      const one = v.replace(/\s+/g, " ").trim();
      return one.length > 60 ? `${one.slice(0, 60)}…` : one;
    }
  }
  return null;
}

export function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo {
  const str = (k: string): string | null =>
    typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : null;
  // docs-round #34: keys are read in the ADAPTER's dispatch order (index.ts `execute`):
  // action, tool, connect, describe, instructions, search. Any other order asks about one
  // call while the adapter runs another: `{tool:"x", action:"install"}` ran an install.
  const action = str("action");
  if (action === "install") {
    // The headline is the question the user answers, so it must be FACT, not model prose: the
    // URL is shown in the canonical form the adapter writes (`new URL(...).toString()`, as its
    // `normalizeMcpInstallRequest` does), and one it can't parse is never echoed.
    const raw = str("url");
    let url = "(no URL given)";
    if (raw) {
      try { url = new URL(raw.trim()).toString(); } catch { url = "(not a valid URL)"; }
    }
    const where = input.target === "project" ? "this project's MCP config" : "your global MCP config";
    return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}install:${url}`, display: `MCP: install ${url} into ${where}` };
  }
  if (action === "auth-start" || action === "auth-complete") {
    const server = str("server") ?? "(no server given)";
    return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}auth:${server}`, display: `MCP: sign in to ${server}`, server };
  }
  // An action a Pi bump adds to MCP_MANAGE_ACTIONS is asked by adding it to the set, nothing else.
  if (action && MCP_MANAGE_ACTIONS.has(action)) return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}${action}`, display: `MCP: ${action}` };
  if (action && MCP_READ_ACTIONS.has(action)) return { kind: "discovery", ruleTool: "mcp", display: `MCP: ${action}` };
  // Any other action is ignored by the adapter's dispatch, which moves on to the keys
  // below, so this does too.
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    const detail = keyArg(input.args);
    const explicitServer = typeof input.server === "string" && input.server.trim() ? input.server.trim() : undefined;
    const server = explicitServer ?? (tool.includes("_") ? tool.slice(0, tool.indexOf("_")) : undefined);
    return {
      kind: "invoke",
      mcpTool: tool,
      ruleTool: `mcp:${tool}`,
      display: detail ? `MCP → ${tool}: ${detail}` : `MCP → ${tool}`,
      server,
    };
  }
  const connect = str("connect");
  if (connect) return { kind: "discovery", ruleTool: "mcp", display: `MCP: connect to ${connect}` };
  const describe = str("describe");
  if (describe) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: describe ${describe}` };
  const instructions = str("instructions");
  if (instructions) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: instructions ${instructions}` };
  const search = str("search") ?? str("regex");
  if (search) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: search "${search}"` };
  // Alone, an unknown action asks: an action a future adapter adds must never ride in as discovery.
  if (action) return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}${action}`, display: `MCP: ${action}` };
  return { kind: "discovery", ruleTool: "mcp", display: "MCP discovery" };
}

/**
 * docs-round #35: pi-mcp-adapter also registers, per proxy-only server, ONE tool named
 * `mcp__<namespace>` that takes `{tool, args}` and runs the same MCP call as the `mcp` proxy.
 * Gated under its raw name, an `mcp:<tool>` rule could be sidestepped through it.
 *
 * The NAME alone can't prove a tool is one: a direct tool under toolPrefix "mcp" is
 * `mcp__<server>_<tool>` and takes its own params. So the bridge also checks the registered
 * description starts with MCP_NAMESPACE_DESCRIPTION AND its parameters are exactly {tool, args}
 * (isMcpNamespaceProxy). Prompt commands (`mcp__<server>__<prompt>`) are registerCommand slash
 * commands, never tools, so they never reach tool_call and need no exclusion here (a server named
 * `foo__bar` is left unencoded by types.ts `formatServerNamespace`: tool `mcp__foo__bar`).
 */
export const MCP_NAMESPACE_DESCRIPTION = 'Namespace-proxy for MCP server "';
export function isMcpNamespaceTool(name: string): boolean {
  return name.startsWith("mcp__") && name.length > 5;
}

/** The registered tool really is the adapter's namespace proxy: description AND {tool, args} params
 *  (+ the bridge-injected `intent`), so a hostile server's direct tool can't pass by copying the text. */
export function isMcpNamespaceProxy(info: { description?: string; parameters?: unknown } | undefined): boolean {
  if (!info?.description?.startsWith(MCP_NAMESPACE_DESCRIPTION)) return false;
  const props = (info.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props || typeof props !== "object") return false;
  const keys = Object.keys(props).filter((k) => k !== "intent");
  return keys.includes("tool") && keys.every((k) => k === "tool" || k === "args");
}

/**
 * Classify a namespace-proxy call. The adapter's namespace `execute` reads `params.tool` and
 * NOTHING else, so only `tool`/`args` are passed on: an `action` the `mcp` proxy would dispatch
 * first (say `ui-messages`, safe-allowed) must not reclassify a call that actually runs `tool`.
 * Null when there is no usable `tool` (the adapter errors and runs nothing).
 */
export function unwrapMcpNamespaceCall(name: string, input: Record<string, unknown>): McpCallInfo | null {
  if (typeof input.tool !== "string" || !input.tool.trim()) return null;
  return unwrapMcpCall({ tool: input.tool, args: input.args, server: name.slice(5) });
}

// ── Pi's built-in MCP (PRD §13, Decision 2026-10-05) ───────────────────────
/**
 * HappyVibe ⇄ Pi's built-in MCP — PURE module, zero imports (bridge, renderer, vitest).
 *
 * Pi registers each server tool as `mcp__<namespace>__<tool>` with sourceInfo.path
 * "builtin:mcp" (PRD §13, Decision 2026-10-05). This maps a call to (a) the rule name
 * hv-rules evaluates — "mcp:<server>_<tool>", the SAME string the adapter era used, so
 * every stored rule keeps matching — and (b) a factual display for the prompt and cards.
 * Gating reads the registered namespace, never a parse of the name: a tool from another
 * extension can be NAMED mcp__x__y, but only Pi's MCP has source "builtin:mcp".
 */
export const PI_MCP_SOURCE = "builtin:mcp";
export const READ_RESOURCE_TOOL = "read_mcp_resource";
/** Read-only discovery: safe-default allowed and passed through plan mode (hv-rules, hv-plan). */
export const MCP_SAFE_TOOLS = ["tool_search", "list_mcp_resources", "list_mcp_resource_templates"] as const;

export interface PiMcpToolInfo {
  name: string;
  namespace?: { name: string };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  sourceInfo?: { path?: string };
}
export type ServerHint = "read-only" | "may delete data";
export interface PiMcpCallInfo { ruleTool: string; display: string; server: string; hint?: ServerHint }

export const isPiMcpTool = (info: PiMcpToolInfo | undefined): boolean => info?.sourceInfo?.path === PI_MCP_SOURCE;

/** Pi's namespace for a configured server name (core/mcp-servers.js `mcpNamespace`). */
export const mcpNamespace = (server: string): string => `mcp__${server.replace(/-/g, "_")}`;

/** The configured name behind a namespace. Pi refuses two names that differ only in - and _,
    so at most one matches. */
export function serverOfNamespace(ns: string, servers: Iterable<string>): string {
  for (const s of servers) if (mcpNamespace(s) === ns) return s;
  return ns.replace(/^mcp__/, "");
}

/** The adapter's spelling (pi-mcp-adapter types.ts formatToolName, toolPrefix "server"). */
export function mcpRuleName(server: string, tool: string): string {
  return `mcp:${tool.startsWith(`${server}_`) && tool.length > server.length + 1 ? tool : `${server}_${tool}`}`;
}

/** The server's own claim about a tool. Declared values only; never a default. */
export function serverHint(a: PiMcpToolInfo["annotations"]): ServerHint | undefined {
  if (a?.readOnlyHint === true) return "read-only";
  if (a?.destructiveHint === true) return "may delete data";
  return undefined;
}

function keyArgOf(input: Record<string, unknown>): string | null {
  for (const k of KEY_ARG_FIELDS) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) {
      const one = v.replace(/\s+/g, " ").trim();
      return one.length > 60 ? `${one.slice(0, 60)}…` : one;
    }
  }
  return null;
}

export function mcpCallInfo(info: PiMcpToolInfo, input: Record<string, unknown>, servers: Iterable<string>): PiMcpCallInfo | null {
  if (!isPiMcpTool(info)) return null;
  const list = [...servers];
  if (info.name === READ_RESOURCE_TOOL) {
    const asked = typeof input.server === "string" ? input.server.trim() : "";
    const server = list.find((s) => s === asked || mcpNamespace(s) === mcpNamespace(asked)) ?? "(unknown server)";
    const uri = typeof input.uri === "string" && input.uri ? input.uri : "(no URI given)";
    return { ruleTool: mcpRuleName(server, READ_RESOURCE_TOOL), display: `MCP → ${server}: read ${uri}`, server, hint: "read-only" };
  }
  const ns = info.namespace?.name;
  if (!ns || !info.name.startsWith(`${ns}__`)) return null;
  const server = serverOfNamespace(ns, list);
  const tool = info.name.slice(ns.length + 2);
  const detail = keyArgOf(input);
  return { ruleTool: mcpRuleName(server, tool), display: detail ? `MCP → ${server}: ${tool}: ${detail}` : `MCP → ${server}: ${tool}`, server, hint: serverHint(info.annotations) };
}

/** Display only (renderer has no namespace): split at the first `__` after the prefix. */
export function parsePiMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}
