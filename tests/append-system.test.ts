import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalAppendFile, readAppend, resolveWorkspaceAppend, writeAppend } from "../src/main/appendSystem";

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-append-"));
const registered = [ws];

test("globalAppendFile is exactly <agentDir>/APPEND_SYSTEM.md", () => {
  expect(globalAppendFile("/agent/dir")).toBe(path.join("/agent/dir", "APPEND_SYSTEM.md"));
});

test("resolveWorkspaceAppend returns exactly <workspace>/.pi/APPEND_SYSTEM.md", () => {
  expect(resolveWorkspaceAppend(registered, ws)).toBe(path.join(ws, ".pi", "APPEND_SYSTEM.md"));
});

test("unregistered workspace is rejected", () => {
  expect(() => resolveWorkspaceAppend(registered, os.tmpdir())).toThrow(/Unknown workspace/);
});

test("traversal via workspaceId is rejected (resolves outside the registry)", () => {
  expect(() => resolveWorkspaceAppend(registered, path.join(ws, "..", "elsewhere"))).toThrow(/Unknown workspace/);
  expect(() => resolveWorkspaceAppend(registered, ws + "/../" + path.basename(ws) + "/sub")).toThrow(/Unknown workspace/);
  // Same dir spelled with a ".." hop still resolves to the registered path — allowed.
  expect(resolveWorkspaceAppend(registered, path.join(ws, "sub", ".."))).toBe(path.join(ws, ".pi", "APPEND_SYSTEM.md"));
});

test("read returns null when missing; write creates .pi dir and roundtrips", () => {
  const file = resolveWorkspaceAppend(registered, ws);
  expect(readAppend(file)).toBeNull();
  writeAppend(file, "Always answer in haiku.\n");
  expect(readAppend(file)).toBe("Always answer in haiku.\n");
});

test("blank content removes the file (the layer stops applying)", () => {
  const file = resolveWorkspaceAppend(registered, ws);
  writeAppend(file, "something");
  writeAppend(file, "   \n");
  expect(fs.existsSync(file)).toBe(false);
  expect(readAppend(file)).toBeNull();
  writeAppend(file, ""); // removing an already-missing file is fine
});

test("global writer roundtrips too", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agentdir-"));
  const file = globalAppendFile(agentDir);
  writeAppend(file, "# Global additions\n");
  expect(readAppend(file)).toBe("# Global additions\n");
  writeAppend(file, "");
  expect(readAppend(file)).toBeNull();
});

test("write to an unregistered workspace never touches disk", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hv-outside-"));
  expect(() => writeAppend(resolveWorkspaceAppend(registered, outside), "nope")).toThrow(/Unknown workspace/);
  expect(fs.existsSync(path.join(outside, ".pi", "APPEND_SYSTEM.md"))).toBe(false);
});
