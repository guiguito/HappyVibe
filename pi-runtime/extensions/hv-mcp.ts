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
/** Most tools one tool_search may load. Pi keeps loaded tools declared for the rest of the
    branch, and an MCP tool schema can weigh ~2k tokens (Notion's do), so Pi's default of 8 per
    search filled the context fast (GUI pass, 2026-10-05). The model can always search again —
    a search only ranks tools that are not loaded yet. */
export const TOOL_SEARCH_LIMIT = 4;
export const TOOL_SEARCH_SOURCE = "builtin:tool-search";

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

const KEY_ARG_FIELDS = ["url", "uri", "query", "q", "path", "file", "name", "id", "title"];
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
