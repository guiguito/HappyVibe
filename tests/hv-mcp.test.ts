import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isMcpManageRule, MCP_MANAGE_ACTIONS, MCP_MANAGE_PREFIX, MCP_READ_ACTIONS, unwrapMcpCall,
} from "../pi-runtime/extensions/hv-mcp";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { gateReadonlyCall } from "../pi-runtime/extensions/hv-readonly";

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

test("#34 install is a manage call that names the URL and where it is written", () => {
  const g = unwrapMcpCall({ action: "install", url: "https://evil.example/mcp" });
  expect(g.kind).toBe("manage");
  expect(g.ruleTool).toBe("mcp-manage:install:https://evil.example/mcp");
  expect(g.display).toBe("MCP: install https://evil.example/mcp into your global MCP config");
  expect(unwrapMcpCall({ action: "install", url: "https://x.example/mcp", target: "project" }).display)
    .toBe("MCP: install https://x.example/mcp into this project's MCP config");
  expect(unwrapMcpCall({ action: "install" }).display).toBe("MCP: install (no URL given) into your global MCP config");
});

test("#34 the headline shows the canonical URL the adapter writes, never model text folded into it", () => {
  // `new URL` accepts this and encodes the spaces; the adapter then writes the canonical form GLOBALLY.
  const g = unwrapMcpCall({ action: "install", url: "https://a.example/mcp into this project's MCP config" });
  expect(g.kind).toBe("manage");
  expect(g.display).toContain("%20");
  expect(g.display).not.toContain("mcp into this project's MCP config");
  expect(g.display).toMatch(/ into your global MCP config$/);
  expect(g.ruleTool).not.toMatch(/ /);
  expect(g.ruleTool).toBe("mcp-manage:install:https://a.example/mcp%20into%20this%20project's%20MCP%20config");
  // Surrounding whitespace is trimmed, as the adapter trims it.
  expect(unwrapMcpCall({ action: "install", url: "  https://x.example/mcp \n" }).ruleTool).toBe("mcp-manage:install:https://x.example/mcp");
});

test("#34 a URL that doesn't parse is never echoed into the headline or the rule name", () => {
  const g = unwrapMcpCall({ action: "install", url: "not a url; safe" });
  expect(g.kind).toBe("manage");
  expect(g.display).toBe("MCP: install (not a valid URL) into your global MCP config");
  expect(g.ruleTool).toBe("mcp-manage:install:(not a valid URL)");
  // A missing URL keeps its own words; a canonical one is unchanged.
  expect(unwrapMcpCall({ action: "install" }).display).toBe("MCP: install (no URL given) into your global MCP config");
  expect(unwrapMcpCall({ action: "install", url: "http://127.0.0.1:9/mcp" }).display).toBe("MCP: install http://127.0.0.1:9/mcp into your global MCP config");
});

test("#34 both sign-in actions are manage calls that name the server", () => {
  for (const action of ["auth-start", "auth-complete"]) {
    const g = unwrapMcpCall({ action, server: "linear" });
    expect(g.kind, action).toBe("manage");
    expect(g.ruleTool, action).toBe("mcp-manage:auth:linear");
    expect(g.display, action).toBe("MCP: sign in to linear");
    expect(g.server, action).toBe("linear");
  }
});

test("#34 action is read FIRST, exactly as the adapter dispatches it", () => {
  // The adapter runs the install here, not the tool call and not the search.
  expect(unwrapMcpCall({ tool: "x", action: "install", url: "https://a.example/mcp" }).kind).toBe("manage");
  expect(unwrapMcpCall({ search: "a", action: "install", url: "https://a.example/mcp" }).kind).toBe("manage");
  expect(unwrapMcpCall({ connect: "srv", action: "auth-start", server: "srv" }).kind).toBe("manage");
  // ui-messages is a read, and it too wins over a tool beside it.
  const ui = unwrapMcpCall({ tool: "x", action: "ui-messages" });
  expect(ui.kind).toBe("discovery");
  expect(ui.ruleTool).toBe("mcp");
});

test("#34 an action the adapter doesn't know falls through to the next key, like the adapter; alone, it asks", () => {
  expect(unwrapMcpCall({ action: "bogus", tool: "github_x" }).ruleTool).toBe("mcp:github_x");
  expect(unwrapMcpCall({ action: "bogus", connect: "srv" }).kind).toBe("discovery");
  const alone = unwrapMcpCall({ action: "bogus" });
  expect(alone.kind).toBe("manage");
  expect(alone.ruleTool).toBe("mcp-manage:bogus");
  expect(alone.display).toBe("MCP: bogus");
});

test("#34 every action in MCP_MANAGE_ACTIONS is asked, even beside a discovery key (adding one to the set IS the fix)", () => {
  for (const a of MCP_MANAGE_ACTIONS) expect(unwrapMcpCall({ action: a, search: "x" }).kind, a).toBe("manage");
  // The branch for an action with no hard-coded case: a bump adds `uninstall` to the set and nothing else.
  const set = MCP_MANAGE_ACTIONS as Set<string>;
  set.add("uninstall");
  try {
    const g = unwrapMcpCall({ action: "uninstall", search: "x" });
    expect(g.kind).toBe("manage");
    expect(g.ruleTool).toBe("mcp-manage:uninstall");
  } finally {
    set.delete("uninstall");
  }
});

test("#34 connect beats describe beats instructions beats search, like the adapter", () => {
  expect(unwrapMcpCall({ describe: "t", connect: "srv" }).display).toBe("MCP: connect to srv");
  expect(unwrapMcpCall({ instructions: "srv", describe: "t" }).display).toBe("MCP discovery: describe t");
  expect(unwrapMcpCall({ search: "q", instructions: "srv" }).display).toBe("MCP discovery: instructions srv");
  expect(unwrapMcpCall({ instructions: "srv" }).kind).toBe("discovery");
});

test("#34 no manage call has a rule name that an MCP tool rule or grant covers", () => {
  expect(MCP_MANAGE_PREFIX.startsWith("mcp:")).toBe(false);
  for (const input of [{ action: "install", url: "https://a.example/mcp" }, { action: "auth-start", server: "s" }, { action: "bogus" }]) {
    const r = unwrapMcpCall(input).ruleTool;
    expect(isMcpManageRule(r), r).toBe(true);
    expect(r.startsWith("mcp:"), r).toBe(false);
  }
  expect(isMcpManageRule("mcp:github_x")).toBe(false);
  expect([...MCP_READ_ACTIONS, ...MCP_MANAGE_ACTIONS].sort()).toEqual(["auth-complete", "auth-start", "install", "ui-messages"]);
});

test("#34 plan mode and read-only runs block a manage call; discovery and invoke keep floor-ask", () => {
  const install = { action: "install", url: "https://a.example/mcp" };
  const plan = gatePlanCall("mcp", install);
  expect(plan.kind).toBe("block");
  expect(plan.kind === "block" && plan.reason).toMatch(/^Plan mode is read-only — adding an MCP server or signing in to one is blocked\./);
  expect(gatePlanCall("mcp", { action: "auth-start", server: "s" }).kind).toBe("block");
  const ro = gateReadonlyCall("mcp", install);
  expect(ro.kind).toBe("block");
  expect(ro.kind === "block" && ro.reason).toBe("This is a read-only run — adding an MCP server or signing in to one is blocked. Read, search and report what you find.");
  expect(gatePlanCall("mcp", { search: "q" }).kind).toBe("floor-ask");
  expect(gatePlanCall("mcp", { tool: "srv_do" }).kind).toBe("floor-ask");
  expect(gatePlanCall("mcp", {}).kind).toBe("floor-ask");
});

test("#34 the bridge auto-allows discovery ONLY, and prompts with the factual display", () => {
  const bridge = fs.readFileSync(path.join(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  expect(bridge).toContain('if (mcp?.kind === "discovery" && v.source === "default" && !planFloorAsk) {');
  expect(bridge).not.toMatch(/mcp\?\.kind !== "invoke"/); // the regression: "anything not an invoke is safe"
  expect(bridge).toContain("const summary = mcp?.display ?? summarize(tool, input);");
});

test("#34 the permission prompt heads a manage call with that factual display", () => {
  const modal = fs.readFileSync(path.join(__dirname, "../src/renderer/src/components/PermissionModal.tsx"), "utf8");
  expect(modal).toMatch(/isMcpManageRule\(info\.tool\)\s*\?\s*\{ icon: "wrench" as const, label: info\.summary \}\s*:\s*toolLabel\(info\.tool, args\)/);
});
