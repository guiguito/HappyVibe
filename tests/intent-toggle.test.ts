/**
 * §13 round 12 — the `intent` switch.
 *
 * Both arms are asserted, and that pairing is the point: a test that only
 * checks "off ⇒ no intent" passes just as happily against a broken injector
 * that never injects at all.
 */
import { describe, expect, test } from "vitest";
import { requireIntent } from "../pi-runtime/extensions/happyvibe-bridge";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

type Tool = { name: string; parameters: { properties: Record<string, unknown>; required?: string[] }; sourceInfo?: { path?: string } };

/** The slice of ExtensionAPI requireIntent touches. */
const fakePi = (tools: Tool[]): { getAllTools: () => Tool[] } => ({ getAllTools: () => tools });

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
