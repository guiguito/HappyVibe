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

export function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo {
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    return { kind: "invoke", mcpTool: tool, ruleTool: `mcp:${tool}`, display: `MCP → ${tool}` };
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
