// tests/mcp-migrate.test.ts
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateGlobalMcpFile, migrateMcpRules } from "../src/main/mcpMigrate";

test("global file: translated in place, top-level keys kept, second run is a no-op", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-mig-")), "mcp.json");
  fs.writeFileSync(f, JSON.stringify({ settings: { x: 1 }, mcpServers: { miro: { url: "https://mcp.miro.com/", auth: "oauth", disabled: true, origin: { plugin: "miro" } } } }));
  expect(migrateGlobalMcpFile(f)).toBe(true);
  expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({ settings: { x: 1 }, mcpServers: { miro: { url: "https://mcp.miro.com/", enabled: false, origin: { plugin: "miro" }, exposure: "deferred" } } });
  expect(migrateGlobalMcpFile(f)).toBe(false);
});

test("missing or unreadable file: no write, no throw", () => {
  expect(migrateGlobalMcpFile(path.join(os.tmpdir(), "nope-hv", "mcp.json"))).toBe(false);
});

test("rules: dash-server rules keep the configured name; tool part is spelled like Pi; manage rules go", () => {
  const rules = { global: [
    { layer: "tool", pattern: "mcp:chrome-devtools_*", action: "allow" },
    { layer: "tool", pattern: "mcp:linear_get-issue", action: "allow" },
    { layer: "tool", pattern: "mcp-manage:install:*", action: "deny" },
    { layer: "tool", pattern: "bash", action: "ask" },
  ], workspaces: {} };
  const { rules: out, changed } = migrateMcpRules(rules as never, ["chrome-devtools", "linear"]);
  expect(changed).toBe(true);
  expect(out.global.map((r: { pattern: string }) => r.pattern)).toEqual(["mcp:chrome-devtools_*", "mcp:linear_get_issue", "bash"]);
});
