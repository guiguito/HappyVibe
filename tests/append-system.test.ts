import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalAppendFile, readAppend, writeAppend } from "../src/main/appendSystem";

// Round 8 removed the per-workspace additions tier (and resolveWorkspaceAppend
// with it), so what's left to pin is the global file's path and the writer's
// blank-means-remove behaviour.

test("globalAppendFile is exactly <agentDir>/APPEND_SYSTEM.md", () => {
  expect(globalAppendFile("/agent/dir")).toBe(path.join("/agent/dir", "APPEND_SYSTEM.md"));
});

test("read returns null when missing; write creates the dir and roundtrips", () => {
  const agentDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-agentdir-")), "nested");
  const file = globalAppendFile(agentDir);
  expect(readAppend(file)).toBeNull();
  writeAppend(file, "Always answer in haiku.\n");
  expect(readAppend(file)).toBe("Always answer in haiku.\n");
});

test("blank content removes the file (the layer stops applying)", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agentdir-"));
  const file = globalAppendFile(agentDir);
  writeAppend(file, "something");
  writeAppend(file, "   \n");
  expect(fs.existsSync(file)).toBe(false);
  expect(readAppend(file)).toBeNull();
  writeAppend(file, ""); // removing an already-missing file is fine
});
