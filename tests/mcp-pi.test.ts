// tests/mcp-pi.test.ts
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOGIN_URL_RE, configErrorFor, parseMcpStatus, piMcpList, statusFromList } from "../src/main/mcpPi";

const runtime = path.join(process.cwd(), "pi-runtime");
const MCP_DIST = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp");

test("contract: the sign-in and status wording we parse is still Pi's", () => {
  const cli = fs.readFileSync(path.join(MCP_DIST, "cli.js"), "utf8");
  const idx = fs.readFileSync(path.join(MCP_DIST, "index.js"), "utf8");
  for (const src of [cli, idx]) expect(src).toContain('Sign in to MCP server "${name}" in your browser:\\n${');
  expect(idx).toContain(": needs sign-in, run /mcp login ${name} (${exposure})");
  expect(idx).toContain("return `${name}: ${state}${tools} (${exposure})${error}`;");
  expect(idx).toContain("lines.push(`overridden: ${line}`)");
  expect(idx).toContain('`"${name}" registered by ${extensionPath} is overridden by "${configured.name}" in ${configured.source}`');
  expect(idx).toContain("lines.push(`config error: ${error}`)");
});

test("LOGIN_URL_RE reads Pi's line", () => {
  const m = LOGIN_URL_RE.exec('Sign in to MCP server "linear" in your browser:\nhttps://auth.x/authorize?a=1\n');
  expect(m?.[1]).toBe("linear");
  expect(m?.[2]).toBe("https://auth.x/authorize?a=1");
});

test("statusFromList maps Pi's states", () => {
  const base = { name: "a", scope: "global", enabled: true, exposure: "deferred", tools: ["x", "y"] };
  expect(statusFromList({ ...base, state: "connected" })).toEqual({ state: "connected", toolCount: 2, tools: [{ name: "x" }, { name: "y" }] });
  expect(statusFromList({ ...base, state: "needs-auth", tools: [] })?.state).toBe("needs-auth");
  expect(statusFromList({ ...base, state: "failed", tools: [], error: "Failed to resolve HV_MCP_CTX_KEY from environment variable: HV_MCP_CTX_KEY" })).toMatchObject({ state: "failed", error: expect.stringContaining("Failed to resolve") });
  expect(statusFromList({ ...base, enabled: false, state: "disabled", tools: [] })).toBeNull();
});

test("configErrorFor finds a rejected entry so its row keeps Pi's reason", () => {
  expect(configErrorFor("old", ['/a/mcp.json: server "old": legacy SSE transport is not supported; use the streamable HTTP URL'])).toContain("SSE");
  expect(configErrorFor("old", ['/a/mcp.json: server "older": x'])).toBeUndefined();
});

test("parseMcpStatus reads /mcp's text", () => {
  const text = [
    "echo: connected, 1 tools (deferred)",
    "linear: needs sign-in, run /mcp login linear (deferred)",
    "bad: failed (deferred)\n    spawn ENOENT\n    more",
    "off: disabled (deferred)",
    'overridden: "dup" registered by /rt/extensions/happyvibe-bridge.ts is overridden by "dup" in /a/mcp.json',
    "config error: x",
  ].join("\n");
  expect(parseMcpStatus(text)).toEqual([
    { name: "echo", state: "connected", toolCount: 1 },
    { name: "linear", state: "needs-auth" },
    { name: "bad", state: "failed", error: "spawn ENOENT\nmore" },
    { name: "off", state: "off" },
    { name: "dup", state: "overridden" },
  ]);
});

test("real key-free run: pi mcp list --json on the echo fixture", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-pimcp-"));
  fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    echo: { command: process.execPath, args: [path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs")], exposure: "deferred" } } }));
  const r = await piMcpList({ runtimeDir: runtime, agentDir, env: {}, execPath: process.execPath });
  expect(r.servers.find((s) => s.name === "echo")).toMatchObject({ state: "connected", tools: ["echo"] });
}, 30_000);
