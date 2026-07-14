import { expect, test } from "vitest";
import { unwrapMcpCall } from "../pi-runtime/extensions/hv-mcp";

test("invoke: params.tool present → per-tool ruleTool and enriched display", () => {
  const r = unwrapMcpCall({ tool: "github_create_issue", args: '{"title":"x"}' });
  expect(r.kind).toBe("invoke");
  expect(r.mcpTool).toBe("github_create_issue");
  expect(r.ruleTool).toBe("mcp:github_create_issue");
  expect(r.display).toBe("MCP → github_create_issue: x"); // key arg surfaced
});

test("invoke: display surfaces a key arg (url), highest-priority key wins", () => {
  const r = unwrapMcpCall({ tool: "notion_fetch", args: '{"id":"abc","url":"https://notion.so/p/1"}' });
  expect(r.display).toBe("MCP → notion_fetch: https://notion.so/p/1"); // url beats id
});

test("invoke: no interesting arg → plain display", () => {
  expect(unwrapMcpCall({ tool: "srv_do", args: '{"flag":true,"count":3}' }).display).toBe("MCP → srv_do");
});

test("invoke: missing / malformed / non-object args → plain display, never throws", () => {
  expect(unwrapMcpCall({ tool: "srv_do" }).display).toBe("MCP → srv_do");
  expect(unwrapMcpCall({ tool: "srv_do", args: "not json" }).display).toBe("MCP → srv_do");
  expect(unwrapMcpCall({ tool: "srv_do", args: "[1,2]" }).display).toBe("MCP → srv_do");
});

test("invoke: long key arg is truncated with an ellipsis", () => {
  const long = "x".repeat(100);
  const r = unwrapMcpCall({ tool: "srv_do", args: JSON.stringify({ query: long }) });
  expect(r.display).toBe(`MCP → srv_do: ${"x".repeat(60)}…`);
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
