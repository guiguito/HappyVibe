/**
 * §13 round 27 — Workflows ships off. The switches store only what the user touched
 * (BuiltinToolsBlock sends partial patches), so an absent key is a user who never chose.
 * Key-free: pure fs + a mocked electron userData, like assistant-tasks.test.ts.
 */
import { beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-workflows-default-"));
  vi.resetModules();
});

test("a user who never touched the switch gets Workflows off", async () => {
  const { getBuiltinTools } = await import("../src/main/config");
  expect(getBuiltinTools().workflows).toBe(false);
});

test("a user who switched it on keeps it on", async () => {
  const { getBuiltinTools, setBuiltinTools } = await import("../src/main/config");
  setBuiltinTools({ workflows: true });
  expect(getBuiltinTools().workflows).toBe(true);
});

test("touching another switch does not turn Workflows on", async () => {
  const { getBuiltinTools, setBuiltinTools } = await import("../src/main/config");
  setBuiltinTools({ browser: false });
  expect(getBuiltinTools().workflows).toBe(false);
});

test("the bridge's own fallback agrees: no HV_BUILTINS, or a corrupt one, means off", () => {
  expect(parseBuiltins(undefined).workflows).toBe(false);
  expect(parseBuiltins("{not json").workflows).toBe(false);
  expect(parseBuiltins(JSON.stringify({ workflows: true })).workflows).toBe(true);
});
