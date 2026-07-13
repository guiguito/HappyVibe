import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMcpFile, writeMcpServer, isValidServerName } from "../src/main/mcp";

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
  expect(readMcpFile(f).mcpServers.echo).toEqual({ command: "node", args: ["server.mjs"] });
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

test("server name validation", () => {
  expect(isValidServerName("github-mcp_2")).toBe(true);
  expect(isValidServerName("")).toBe(false);
  expect(isValidServerName("../evil")).toBe(false);
  expect(isValidServerName("a b")).toBe(false);
});
