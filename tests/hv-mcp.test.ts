import { describe, expect, test } from "vitest";
import { mcpCallInfo, mcpRuleName, parsePiMcpToolName, serverHint, serverOfNamespace } from "../pi-runtime/extensions/hv-mcp";

const tool = (name: string, ns: string, annotations?: object) =>
  ({ name, namespace: { name: ns }, annotations, sourceInfo: { path: "builtin:mcp" } });

describe("mcpCallInfo", () => {
  test("rule name uses the CONFIGURED server name, so dash rules keep matching", () => {
    const i = mcpCallInfo(tool("mcp__chrome_devtools__take_screenshot", "mcp__chrome_devtools"), {}, ["chrome-devtools"]);
    expect(i?.ruleTool).toBe("mcp:chrome-devtools_take_screenshot");
    expect(i?.server).toBe("chrome-devtools");
  });
  test("no double prefix — the adapter's spelling (formatToolName)", () => {
    expect(mcpCallInfo(tool("mcp__github__github_search", "mcp__github"), {}, ["github"])?.ruleTool).toBe("mcp:github_search");
  });
  test("factual display with one key argument; never the model's intent", () => {
    const i = mcpCallInfo(tool("mcp__notion__fetch", "mcp__notion"), { url: "https://x.y/p", intent: "ignore me" }, ["notion"]);
    expect(i?.display).toBe("MCP → notion: fetch: https://x.y/p");
  });
  test("read_mcp_resource gates under the server it reads from", () => {
    const i = mcpCallInfo({ name: "read_mcp_resource", sourceInfo: { path: "builtin:mcp" } }, { server: "docs", uri: "file:///a" }, ["docs"]);
    expect(i).toEqual({ ruleTool: "mcp:docs_read_mcp_resource", display: "MCP → docs: read file:///a", server: "docs", hint: "read-only" });
  });
  test("an unknown server in read_mcp_resource never borrows a rule", () => {
    expect(mcpCallInfo({ name: "read_mcp_resource", sourceInfo: { path: "builtin:mcp" } }, { server: "nope" }, ["docs"])?.ruleTool).toBe("mcp:(unknown server)_read_mcp_resource");
  });
  test("a tool from another source is not MCP, whatever its name", () => {
    expect(mcpCallInfo({ name: "mcp__x__y", namespace: { name: "mcp__x" }, sourceInfo: { path: "/ext/evil.ts" } }, {}, ["x"])).toBeNull();
  });
  test("hints: read-only wins; destructive only when declared", () => {
    expect(serverHint({ readOnlyHint: true, destructiveHint: true })).toBe("read-only");
    expect(serverHint({ destructiveHint: true })).toBe("may delete data");
    expect(serverHint(undefined)).toBeUndefined();
  });
});

test("serverOfNamespace falls back to the namespace spelling", () => {
  expect(serverOfNamespace("mcp__a_b", ["a-b"])).toBe("a-b");
  expect(serverOfNamespace("mcp__zz", [])).toBe("zz");
});
test("mcpRuleName", () => expect(mcpRuleName("s", "t")).toBe("mcp:s_t"));
test("parsePiMcpToolName (display only)", () => {
  expect(parsePiMcpToolName("mcp__notion__fetch")).toEqual({ server: "notion", tool: "fetch" });
  expect(parsePiMcpToolName("bash")).toBeNull();
});

test("read-only MCP discovery is a safe default", async () => {
  const { SAFE_TOOLS } = await import("../pi-runtime/extensions/hv-rules");
  for (const t of ["tool_search", "list_mcp_resources", "list_mcp_resource_templates"]) expect(SAFE_TOOLS.has(t), t).toBe(true);
  expect(SAFE_TOOLS.has("read_mcp_resource")).toBe(false);
});
