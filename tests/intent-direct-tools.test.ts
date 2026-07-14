import { expect, test } from "vitest";
import bridge from "../pi-runtime/extensions/happyvibe-bridge";

/**
 * Direct-mode MCP intent (companion to the proxy-mode wiring in
 * intent-bridge.test.ts / mcp-bridge.test.ts, but pure — no live Pi):
 *
 *  - requireIntent injects a required `intent` into every tool registered by
 *    pi-mcp-adapter EXCEPT the `mcp` proxy (handled by INTENT_TOOLS) and
 *    server tools that declare their own `intent` param.
 *  - The bridge's tool_call handler strips the injected intent from
 *    event.input BEFORE the permission gate reads it (the adapter forwards
 *    direct-tool params verbatim to the MCP server), and never strips it from
 *    the proxy or from tools whose intent is server-owned.
 */

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>;

type FakeTool = {
  name: string;
  parameters: { type: string; properties: Record<string, unknown>; required: string[] };
  sourceInfo: { path: string; source: string; scope: string; origin: string };
};

const adapterSource = { path: "/x/pi-mcp-adapter/index.ts", source: "pi-mcp-adapter", scope: "user", origin: "package" };
const tools: FakeTool[] = [
  { name: "mcp", parameters: { type: "object", properties: { tool: {}, args: {} }, required: [] }, sourceInfo: adapterSource },
  { name: "github_create_issue", parameters: { type: "object", properties: { title: {} }, required: ["title"] }, sourceInfo: adapterSource },
  { name: "srv_own_intent", parameters: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] }, sourceInfo: adapterSource },
  { name: "subagent", parameters: { type: "object", properties: { agent: {} }, required: [] }, sourceInfo: { ...adapterSource, path: "/x/pi-subagents/index.ts", source: "pi-subagents" } },
];

const handlers = new Map<string, Handler>();
const pi = {
  on: (name: string, fn: Handler) => handlers.set(name, fn),
  registerCommand: () => {},
  registerTool: () => {},
  appendEntry: () => {},
  getAllTools: () => tools,
} as never;

bridge(pi);
const promptTitles: string[] = [];
const ctx = {
  sessionManager: { getEntries: () => [] },
  ui: {
    notify: () => {},
    select: async (title: string) => {
      promptTitles.push(title);
      return "Allow";
    },
    input: async () => "",
  },
};

await handlers.get("session_start")!({}, ctx);

test("requireIntent injects a required intent into direct MCP tools only", () => {
  const byName = (n: string) => tools.find((t) => t.name === n)!;
  expect(byName("github_create_issue").parameters.properties.intent).toBeTruthy();
  expect(byName("github_create_issue").parameters.required).toEqual(["title", "intent"]);
  expect(byName("mcp").parameters.properties.intent).toBeTruthy(); // proxy, via INTENT_TOOLS
  expect(byName("subagent").parameters.properties.intent).toBeTruthy(); // via INTENT_TOOLS
  // Server tool with its own intent param: untouched (no duplicate required).
  expect(byName("srv_own_intent").parameters.required).toEqual(["intent"]);
});

test("session_start is idempotent (no duplicate required entries)", async () => {
  await handlers.get("session_start")!({}, ctx);
  expect(tools.find((t) => t.name === "github_create_issue")!.parameters.required).toEqual(["title", "intent"]);
});

test("tool_call strips the injected intent from direct MCP tool input", async () => {
  const event = { toolName: "github_create_issue", input: { title: "bug", intent: "Filing the bug you described" } };
  await handlers.get("tool_call")!(event, ctx);
  expect(event.input).toEqual({ title: "bug" });
  // Factual permission prompt: the model's intent never reaches it.
  expect(promptTitles.at(-1)).not.toContain("Filing the bug");
});

test("tool_call leaves the proxy tool's intent alone (adapter ignores it)", async () => {
  const event = { toolName: "mcp", input: { tool: "notion_fetch", args: "{}", intent: "Fetching the page" } };
  await handlers.get("tool_call")!(event, ctx);
  expect(event.input.intent).toBe("Fetching the page");
});

test("tool_call leaves a server-owned intent param alone", async () => {
  const event = { toolName: "srv_own_intent", input: { intent: "server semantics" } };
  await handlers.get("tool_call")!(event, ctx);
  expect(event.input.intent).toBe("server semantics");
});
