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
 * description starts with MCP_NAMESPACE_DESCRIPTION (namespace-tools.ts). Prompt commands
 * (`mcp__<server>__<prompt>`) are told apart by the `__`, which a namespace only carries in
 * its `_mcpns_` encoded form (types.ts `formatServerNamespace`).
 */
export const MCP_NAMESPACE_DESCRIPTION = 'Namespace-proxy for MCP server "';
export function isMcpNamespaceTool(name: string): boolean {
  if (!name.startsWith("mcp__")) return false;
  const ns = name.slice(5);
  return ns.length > 0 && (!ns.includes("__") || ns.startsWith("_mcpns_"));
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
