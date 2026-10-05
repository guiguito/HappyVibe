import { expect, test } from "vitest";
import bridge from "../pi-runtime/extensions/happyvibe-bridge";

/**
 * MCP intent (§13, Pi's built-in MCP — companion to mcp-bridge.test.ts, but pure):
 *
 *  - requireIntent injects a required `intent` into every tool Pi's MCP registered
 *    (sourceInfo.path "builtin:mcp") except server tools that declare their own.
 *  - The bridge's tool_call handler strips the injected intent from event.input
 *    BEFORE the permission gate reads it (Pi forwards params verbatim to the MCP
 *    server), and never strips a server-owned intent.
 */

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>;

type FakeTool = {
  name: string;
  parameters: { type: string; properties: Record<string, unknown>; required: string[] };
  namespace?: { name: string };
  sourceInfo: { path: string; source: string; scope: string; origin: string };
};

const mcpSource = { path: "builtin:mcp", source: "builtin", scope: "temporary", origin: "top-level" };
const tools: FakeTool[] = [
  { name: "mcp__github__create_issue", namespace: { name: "mcp__github" }, parameters: { type: "object", properties: { title: {} }, required: ["title"] }, sourceInfo: mcpSource },
  { name: "mcp__srv__own_intent", namespace: { name: "mcp__srv" }, parameters: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] }, sourceInfo: mcpSource },
  { name: "Agent", parameters: { type: "object", properties: { description: {} }, required: [] }, sourceInfo: { ...mcpSource, path: "/x/@tintinweb/pi-subagents/src/index.ts", source: "pi-subagents" } },
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

test("requireIntent injects a required intent into Pi's MCP tools", () => {
  const byName = (n: string) => tools.find((t) => t.name === n)!;
  expect(byName("mcp__github__create_issue").parameters.properties.intent).toBeTruthy();
  expect(byName("mcp__github__create_issue").parameters.required).toEqual(["title", "intent"]);
  // The delegation tool is left alone: its own `description` is the card's headline.
  expect(byName("Agent").parameters.properties.intent).toBeUndefined();
  // Server tool with its own intent param: untouched (no duplicate required).
  expect(byName("mcp__srv__own_intent").parameters.required).toEqual(["intent"]);
});

test("session_start is idempotent (no duplicate required entries)", async () => {
  await handlers.get("session_start")!({}, ctx);
  expect(tools.find((t) => t.name === "mcp__github__create_issue")!.parameters.required).toEqual(["title", "intent"]);
});

test("tool_call strips the injected intent from MCP tool input", async () => {
  const event = { toolName: "mcp__github__create_issue", input: { title: "bug", intent: "Filing the bug you described" } };
  await handlers.get("tool_call")!(event, ctx);
  expect(event.input).toEqual({ title: "bug" });
  // Factual permission prompt: the model's intent never reaches it.
  expect(promptTitles.at(-1)).not.toContain("Filing the bug");
});

test("tool_call leaves a server-owned intent param alone", async () => {
  const event = { toolName: "mcp__srv__own_intent", input: { intent: "server semantics" } };
  await handlers.get("tool_call")!(event, ctx);
  expect(event.input.intent).toBe("server semantics");
});
