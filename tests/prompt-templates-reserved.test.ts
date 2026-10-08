import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isShadowed, RESERVED_SLASH_COMMANDS } from "../src/main/promptTemplates/view";

/**
 * A hand-maintained reserved list rots the moment someone adds an `/hv-*`
 * command: the new bridge command silently shadows any same-named prompt
 * template (PRD §24), and the Commands page would show that file as "active"
 * while Pi never reaches it. So the truth is DERIVED from the bridge here, and
 * `view.ts` only has to agree.
 */
const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");

import { PI_MCP_EXTENSIONS } from "../src/main/pi/spawn";

const RT = path.join(__dirname, "..", "pi-runtime");
const PI_EXT = path.join(RT, "node_modules/@earendil-works/pi-coding-agent/dist/extensions");
const TW_SRC = path.join(RT, "node_modules/@tintinweb/pi-subagents/src");
const literals = (src: string): string[] => [...src.matchAll(/registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1]);
const filesUnder = (dir: string, ext: RegExp): string[] =>
  (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => ext.test(f) && !/test/.test(f)).map((f) => path.join(dir, f));

test("reserved names = every command a chat session registers (bridge + tintinweb + loaded Pi built-ins)", () => {
  const bridge = fs.readFileSync(BRIDGE, "utf8");
  // Every bridge registerCommand call must be a plain string literal, or the scan under-counts.
  expect((bridge.match(/pi\.registerCommand\(/g) ?? []).length).toBe(literals(bridge).length);
  const builtins = PI_MCP_EXTENSIONS.filter((a) => a.startsWith("builtin:")).map((a) => a.slice("builtin:".length));
  const found = new Set([
    ...literals(bridge),
    ...filesUnder(TW_SRC, /\.ts$/).flatMap((f) => literals(fs.readFileSync(f, "utf8"))),
    ...builtins.flatMap((b) => filesUnder(path.join(PI_EXT, b), /\.js$/).flatMap((f) => literals(fs.readFileSync(f, "utf8")))),
  ]);
  // Guards against a scan that silently matches nothing.
  expect(found.has("agents")).toBe(true);
  expect(found.has("mcp")).toBe(true);
  expect(found.size).toBeGreaterThan(15);
  expect([...RESERVED_SLASH_COMMANDS].sort()).toEqual([...found].sort());
});

test("isShadowed is the only reader — bare names, no leading slash", () => {
  for (const name of RESERVED_SLASH_COMMANDS) {
    expect(name.startsWith("/")).toBe(false);
    expect(isShadowed(name)).toBe(true);
  }
});
