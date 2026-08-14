/**
 * §13 round 12 — the `intent` switch.
 *
 * Both arms are asserted, and that pairing is the point: a test that only
 * checks "off ⇒ no intent" passes just as happily against a broken injector
 * that never injects at all.
 */
import { describe, expect, test } from "vitest";
import { requireIntent, stripIntent } from "../pi-runtime/extensions/happyvibe-bridge";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

type Tool = { name: string; parameters: { properties: Record<string, unknown>; required?: string[] }; sourceInfo?: { path?: string } };

/** The slice of ExtensionAPI requireIntent touches. */
const fakePi = (tools: Tool[]): { getAllTools: () => Tool[] } => ({ getAllTools: () => tools });

const BRIDGE = "/x/pi-runtime/extensions/happyvibe-bridge.ts";

const tool = (name: string, sourcePath?: string): Tool => ({
  name,
  parameters: { properties: {}, required: [] },
  ...(sourcePath ? { sourceInfo: { path: sourcePath } } : {}),
});

describe("the flag itself", () => {
  test("defaults ON and fails open — a corrupt value must not strip the headline", () => {
    expect(parseBuiltins(undefined).intent).toBe(true);
    expect(parseBuiltins("{ not json").intent).toBe(true);
    expect(parseBuiltins("{}").intent).toBe(true);
  });

  test("only an explicit false turns it off", () => {
    expect(parseBuiltins(JSON.stringify({ intent: false })).intent).toBe(false);
    expect(parseBuiltins(JSON.stringify({ intent: true })).intent).toBe(true);
    // A non-boolean is not "off" — same convention as the other toggles.
    expect(parseBuiltins(JSON.stringify({ intent: "no" })).intent).toBe(true);
  });

  test("it is independent of the other toggles", () => {
    const b = parseBuiltins(JSON.stringify({ intent: false }));
    expect(b.plan).toBe(true);
    expect(b.terminal).toBe(true);
    expect(b.askUser).toBe(true);
  });
});

describe("requireIntent ON", () => {
  test("injects a REQUIRED intent into the registered tools", () => {
    const mcp = tool("mcp");
    requireIntent(fakePi([mcp]) as never, true);
    expect(mcp.parameters.properties.intent).toBeDefined();
    expect(mcp.parameters.required).toContain("intent");
  });

  test("subagent advertises intent but never requires it", () => {
    // A hard requirement made looser models fail their first delegation.
    const sub = tool("subagent");
    requireIntent(fakePi([sub]) as never, true);
    expect(sub.parameters.properties.intent).toBeDefined();
    expect(sub.parameters.required ?? []).not.toContain("intent");
  });

  test("adapter-registered DIRECT tools get it too — that is where it scales", () => {
    const direct = tool("github_create_issue", "/x/node_modules/pi-mcp-adapter/index.ts");
    requireIntent(fakePi([direct]) as never, true);
    expect(direct.parameters.required).toContain("intent");
  });

  test("a server tool with its OWN intent param is left alone", () => {
    const own = tool("weird_tool", "/x/node_modules/pi-mcp-adapter/index.ts");
    own.parameters.properties.intent = { type: "string", description: "theirs" };
    requireIntent(fakePi([own]) as never, true);
    expect(own.parameters.properties.intent).toEqual({ type: "string", description: "theirs" });
    expect(own.parameters.required ?? []).not.toContain("intent");
  });
});

describe("requireIntent OFF", () => {
  test("injects nothing anywhere", () => {
    const mcp = tool("mcp");
    const sub = tool("subagent");
    const direct = tool("github_create_issue", "/x/node_modules/pi-mcp-adapter/index.ts");
    requireIntent(fakePi([mcp, sub, direct]) as never, false);
    for (const t of [mcp, sub, direct]) {
      expect(t.parameters.properties.intent, `${t.name} should carry no intent`).toBeUndefined();
      expect(t.parameters.required ?? []).not.toContain("intent");
    }
  });

  test("is idempotent — a second turn does not sneak it back in", () => {
    const mcp = tool("mcp");
    requireIntent(fakePi([mcp]) as never, false);
    requireIntent(fakePi([mcp]) as never, false);
    expect(mcp.parameters.properties.intent).toBeUndefined();
  });
});


/**
 * The half the first version of this switch missed.
 *
 * requireIntent skips a tool whose schema already carries `intent` ("already
 * wired") — and every tool the BRIDGE registers declares it directly. So with
 * the switch off, the MCP proxy and subagent lost their intent while ask_user,
 * use_skill, terminal_run/kill and the three plan tools kept theirs. Measured
 * on a real Pi child: 7 tools still carried it. Off has to mean off.
 */
describe("stripIntent", () => {
  const own = (name: string): Tool => {
    const t = tool(name, BRIDGE);
    t.parameters.properties.intent = { type: "string" };
    t.parameters.required = ["intent", "name"];
    return t;
  };

  test("removes intent from the bridge's own tools when the switch is off", () => {
    const tools = ["ask_user", "use_skill", "terminal_run", "terminal_kill", "plan_complete"].map(own);
    stripIntent(fakePi(tools) as never, false);
    for (const t of tools) {
      expect(t.parameters.properties.intent, `${t.name} should have lost intent`).toBeUndefined();
      expect(t.parameters.required ?? []).not.toContain("intent");
    }
  });

  test("leaves them alone when the switch is ON", () => {
    const t = own("use_skill");
    stripIntent(fakePi([t]) as never, true);
    expect(t.parameters.properties.intent).toBeDefined();
    expect(t.parameters.required).toContain("intent");
  });

  test("never touches an MCP SERVER tool that declares its own intent", () => {
    // The direct-mode rule deliberately leaves those alone — stripping one
    // would change the arguments a third-party server receives.
    const server = tool("weird_tool", "/x/node_modules/pi-mcp-adapter/index.ts");
    server.parameters.properties.intent = { type: "string", description: "theirs" };
    server.parameters.required = ["intent"];
    stripIntent(fakePi([server]) as never, false);
    expect(server.parameters.properties.intent).toEqual({ type: "string", description: "theirs" });
    expect(server.parameters.required).toContain("intent");
  });

  test("selects by OWNER, so a tool added to the bridge later is covered with no list to update", () => {
    const brandNew = own("some_future_bridge_tool");
    stripIntent(fakePi([brandNew]) as never, false);
    expect(brandNew.parameters.properties.intent).toBeUndefined();
  });

  test("is idempotent and harmless on a tool that never had intent", () => {
    const plain = tool("plan_status_update", BRIDGE);
    stripIntent(fakePi([plain]) as never, false);
    stripIntent(fakePi([plain]) as never, false);
    expect(plain.parameters.properties.intent).toBeUndefined();
  });
});
