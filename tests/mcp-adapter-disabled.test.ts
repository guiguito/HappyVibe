/**
 * CONTRACT test (adapter-pin-bump gate) — docs-round #25.
 *
 * A plugin's MCP servers are written with `disabled: true` and HappyVibe relies
 * on the ADAPTER to keep them unusable: no lazy connect, no explicit connect, and
 * no name in the `mcp` tool's server list. Main reads the same flag through
 * `isMcpServerOff`, and the two must agree on every value, or the MCP page says
 * "off" about a server a session can call.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMcpServerOff } from "../src/main/mcp";

const ADAPTER = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter");
const src = (f: string): string => fs.readFileSync(path.join(ADAPTER, f), "utf8");

describe("pi-mcp-adapter disabled-flag contract", () => {
  it("only the literal true disables a server, and isMcpServerOff agrees on every value", async () => {
    const { isServerDisabled } = await import("../pi-runtime/node_modules/pi-mcp-adapter/types.ts");
    for (const v of [true, false, "true", 1, 0, null, undefined, {}]) {
      expect(isMcpServerOff({ disabled: v } as never), String(v)).toBe(isServerDisabled({ disabled: v }));
    }
    expect(isServerDisabled({ disabled: true })).toBe(true);
    expect(isServerDisabled({})).toBe(false);
  });

  it("a disabled server never lazy-connects, refuses an explicit connect, and is left out of the tool's server list", () => {
    expect(src("init.ts")).toContain("if (!definition || isServerDisabled(definition)) return false;");
    expect(src("proxy-modes.ts")).toContain('if (isServerDisabled(definition)) return disabledResult("connect", serverName);');
    expect(src("direct-tool-surface.ts")).toMatch(
      /const serverNames = Object\.keys\(config\.mcpServers\)\s*\.filter\(\(serverName\) => !isServerDisabled\(config\.mcpServers\[serverName\]\)\);/,
    );
  });
});
