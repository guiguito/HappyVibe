import { expect, test } from "vitest";
import { unwrapMcpCall } from "../pi-runtime/extensions/hv-mcp";

test("invoke: params.tool present → per-tool ruleTool and display", () => {
  const r = unwrapMcpCall({ tool: "github_create_issue", args: '{"title":"x"}' });
  expect(r.kind).toBe("invoke");
  expect(r.mcpTool).toBe("github_create_issue");
  expect(r.ruleTool).toBe("mcp:github_create_issue");
  expect(r.display).toBe("MCP → github_create_issue");
});

test("discovery: search", () => {
  const r = unwrapMcpCall({ search: "screenshot" });
  expect(r.kind).toBe("discovery");
  expect(r.ruleTool).toBe("mcp");
  expect(r.display).toBe('MCP discovery: search "screenshot"');
});

test("discovery: describe / connect / action", () => {
  expect(unwrapMcpCall({ describe: "t" }).kind).toBe("discovery");
  expect(unwrapMcpCall({ connect: "srv" }).kind).toBe("discovery");
  expect(unwrapMcpCall({ action: "ui-messages" }).kind).toBe("discovery");
});

test("empty / unknown params default to discovery on the bare mcp tool", () => {
  const r = unwrapMcpCall({});
  expect(r.kind).toBe("discovery");
  expect(r.ruleTool).toBe("mcp");
});

test("non-string tool param is not an invoke", () => {
  expect(unwrapMcpCall({ tool: 42 }).kind).toBe("discovery");
});
