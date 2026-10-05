import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMcpFile, writeMcpServer, serverNameInFiles, isValidServerName } from "../src/main/mcp";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcpcfg-")), "mcp.json");

test("missing / invalid file reads as empty mcpServers", () => {
  expect(readMcpFile("/nonexistent/mcp.json")).toEqual({ mcpServers: {} });
  const f = tmpFile();
  fs.writeFileSync(f, "not json");
  expect(readMcpFile(f)).toEqual({ mcpServers: {} });
});

test("write → read round-trip; null removes", () => {
  const f = tmpFile();
  writeMcpServer(f, "echo", { command: "node", args: ["server.mjs"] });
  // §13 (2026-10-05): every write lands in Pi's shape — deferred unless said otherwise.
  expect(readMcpFile(f).mcpServers.echo).toEqual({ command: "node", args: ["server.mjs"], exposure: "deferred" });
  writeMcpServer(f, "echo", null);
  expect(readMcpFile(f).mcpServers).toEqual({});
});

test("unknown top-level keys survive (hand-edited imports/settings)", () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ imports: ["cursor"], mcpServers: {} }));
  writeMcpServer(f, "gh", { url: "https://example.com/mcp" });
  const out = readMcpFile(f);
  expect(out.imports).toEqual(["cursor"]);
  expect(out.mcpServers.gh.url).toBe("https://example.com/mcp");
});

test("serverNameInFiles: credential-revocation guard on removal", () => {
  const a = tmpFile();
  const b = tmpFile();
  writeMcpServer(a, "notion", { url: "https://mcp.notion.com/mcp" });
  // Still referenced by file a (e.g. another workspace) → keep credentials.
  expect(serverNameInFiles("notion", [a, b])).toBe(true);
  // Missing files are tolerated (unregistered workspace without .mcp.json).
  expect(serverNameInFiles("notion", ["/nonexistent/.mcp.json", b])).toBe(false);
  writeMcpServer(a, "notion", null);
  expect(serverNameInFiles("notion", [a, b])).toBe(false);
});

test("server name validation", () => {
  expect(isValidServerName("github-mcp_2")).toBe(true);
  expect(isValidServerName("")).toBe(false);
  expect(isValidServerName("../evil")).toBe(false);
  expect(isValidServerName("a b")).toBe(false);
});

test("failIfExists refuses to overwrite and leaves the existing server untouched", () => {
  const f = tmpFile();
  writeMcpServer(f, "github", { url: "https://mine.example/mcp" });

  expect(() =>
    writeMcpServer(f, "github", { url: "https://catalog.example/mcp" }, { failIfExists: true }),
  ).toThrow(/already exists/);

  // The user's hand-rolled config survives verbatim — that is the point.
  expect(readMcpFile(f).mcpServers.github).toEqual({ url: "https://mine.example/mcp", exposure: "deferred" });
});

test("failIfExists writes normally when the name is free", () => {
  const f = tmpFile();
  writeMcpServer(f, "notion", { url: "https://notion.example/mcp" }, { failIfExists: true });
  expect(readMcpFile(f).mcpServers.notion).toEqual({ url: "https://notion.example/mcp", exposure: "deferred" });
});

test("write still overwrites by default — the editor's Edit flow depends on it", () => {
  const f = tmpFile();
  writeMcpServer(f, "notion", { url: "https://one.example/mcp" });
  writeMcpServer(f, "notion", { url: "https://two.example/mcp" });
  expect(readMcpFile(f).mcpServers.notion).toEqual({ url: "https://two.example/mcp", exposure: "deferred" });
});

test("failIfExists collides case-insensitively and names the existing key", () => {
  // Real GUI finding: a hand-added "Notion" plus a catalog "notion" would be two
  // separate servers with duplicated tools, because mcpServers keys are
  // case-sensitive. The guard must catch it and report the name as written.
  const f = tmpFile();
  writeMcpServer(f, "Notion", { url: "https://mine.example/mcp" });

  expect(() =>
    writeMcpServer(f, "notion", { url: "https://catalog.example/mcp" }, { failIfExists: true }),
  ).toThrow(/"Notion" already exists/);

  expect(Object.keys(readMcpFile(f).mcpServers)).toEqual(["Notion"]);
});

test("off is Pi's enabled:false; withoutOffFlag clears both spellings", async () => {
  const { isMcpServerOff, withoutOffFlag } = await import("../src/main/mcp");
  expect(isMcpServerOff({ enabled: false })).toBe(true);
  expect(isMcpServerOff({ url: "u" })).toBe(false);
  expect(withoutOffFlag({ url: "u", enabled: false, disabled: true })).toEqual({ url: "u" });
});
