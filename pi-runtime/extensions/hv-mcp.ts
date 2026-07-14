/**
 * HappyVibe MCP proxy-call unwrapping — PURE module, zero imports.
 *
 * pi-mcp-adapter registers ONE proxy tool named `mcp`; the real MCP tool a
 * call targets is buried in its params ({tool, args}). This module maps a
 * proxy call to (a) a virtual tool name the hv-rules engine evaluates —
 * "mcp:<tool>" — so rules can target individual MCP tools (pattern
 * `mcp:github_*` etc.), and (b) a human display string, so the permission
 * prompt and tool cards never show a bare "mcp". Same discipline as
 * hv-rules.ts: imported by the bridge, src/renderer, and vitest.
 */

export interface McpCallInfo {
  kind: "invoke" | "discovery";
  mcpTool?: string;
  ruleTool: string;
  display: string;
}

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
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    const detail = keyArg(input.args);
    return {
      kind: "invoke",
      mcpTool: tool,
      ruleTool: `mcp:${tool}`,
      display: detail ? `MCP → ${tool}: ${detail}` : `MCP → ${tool}`,
    };
  }
  const str = (k: string): string | null =>
    typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : null;
  const search = str("search") ?? str("regex");
  if (search) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: search "${search}"` };
  const describe = str("describe");
  if (describe) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: describe ${describe}` };
  const connect = str("connect");
  if (connect) return { kind: "discovery", ruleTool: "mcp", display: `MCP: connect to ${connect}` };
  const action = str("action");
  if (action) return { kind: "discovery", ruleTool: "mcp", display: `MCP: ${action}` };
  return { kind: "discovery", ruleTool: "mcp", display: "MCP discovery" };
}
