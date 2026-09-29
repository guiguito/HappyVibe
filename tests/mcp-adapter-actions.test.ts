/**
 * CONTRACT test (adapter-pin-bump gate) — docs-round #34.
 *
 * The bridge gates an `mcp` call by what `unwrapMcpCall` says it is, so the
 * classifier has to read the params in the SAME order the adapter dispatches
 * them, and it has to know every `action` the adapter runs. Before #34 it read
 * tool → search → describe → connect → action, and `{tool:"x", action:"install"}`
 * was asked as `mcp:x` while the adapter installed a server. A bump that adds an
 * action or reorders the dispatch fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_MANAGE_ACTIONS, MCP_READ_ACTIONS } from "../pi-runtime/extensions/hv-mcp";

const INDEX = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter", "index.ts");
const src = fs.readFileSync(INDEX, "utf8");
// The proxy tool: from its registration to the status fallback at the end of `execute`.
const start = src.indexOf('name: "mcp",');
const end = src.indexOf("return proxyModes.executeStatus(proxyState);", start);
const body = src.slice(start, end);
const ours = new Set([...MCP_READ_ACTIONS, ...MCP_MANAGE_ACTIONS]);

describe("pi-mcp-adapter proxy dispatch contract", () => {
  it("finds the proxy's execute body (guards against a vacuous pass)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("dispatches exactly the actions HappyVibe classifies", () => {
    const dispatched = [...body.matchAll(/params\.action === "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dispatched)).toEqual(ours);
  });

  it("the schema's own action list agrees", () => {
    const m = body.match(/action: Type\.Optional\(Type\.String\(\{ description: "Action: ([^"]+)" \}\)\)/);
    expect(m, "the action param's description moved or changed shape").not.toBeNull();
    expect(new Set([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]))).toEqual(ours);
  });

  it("checks action, then tool, connect, describe, instructions, search — unwrapMcpCall's order", () => {
    const at = (needle: string): number => {
      const i = body.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at('if (params.action === "install")'),
      at("if (params.tool)"),
      at("if (params.connect)"),
      at("if (params.describe)"),
      at("if (params.instructions)"),
      at("if (params.search !== undefined)"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const lastAction = Math.max(...[...body.matchAll(/params\.action === "/g)].map((m) => m.index ?? -1));
    expect(lastAction, "every action branch must come before the tool branch").toBeLessThan(at("if (params.tool)"));
  });
});
