import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAgentsMd, resolveAgentsMd, workspaceFacts, writeAgentsMd } from "../src/main/agentsMd";

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-"));
const registered = [ws];

test("resolveAgentsMd returns exactly <workspace>/AGENTS.md for a registered workspace", () => {
  expect(resolveAgentsMd(registered, ws)).toBe(path.join(ws, "AGENTS.md"));
});

test("unregistered workspace is rejected", () => {
  expect(() => resolveAgentsMd(registered, os.tmpdir())).toThrow(/Unknown workspace/);
});

test("traversal via workspaceId is rejected (resolves outside the registry)", () => {
  expect(() => resolveAgentsMd(registered, path.join(ws, "..", "elsewhere"))).toThrow(/Unknown workspace/);
  expect(() => resolveAgentsMd(registered, ws + "/../" + path.basename(ws) + "/sub")).toThrow(/Unknown workspace/);
  // Same dir spelled with a ".." hop still resolves to the registered path — allowed.
  expect(resolveAgentsMd(registered, path.join(ws, "sub", ".."))).toBe(path.join(ws, "AGENTS.md"));
});

test("read returns null when missing; write/read roundtrip", () => {
  expect(readAgentsMd(registered, ws)).toBeNull();
  writeAgentsMd(registered, ws, "# Agents\n\nBe kind.\n");
  expect(readAgentsMd(registered, ws)).toBe("# Agents\n\nBe kind.\n");
});

test("write to an unregistered workspace never touches disk", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hv-outside-"));
  expect(() => writeAgentsMd(registered, outside, "nope")).toThrow(/Unknown workspace/);
  expect(fs.existsSync(path.join(outside, "AGENTS.md"))).toBe(false);
});

test("workspaceFacts lists top-level entries and package.json name/scripts", () => {
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "vite" } }));
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  const facts = workspaceFacts(ws);
  expect(facts).toContain("src");
  expect(facts).toContain("demo");
  expect(facts).toContain('"dev":"vite"');
});
