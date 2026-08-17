/**
 * `writeSubagentConfig` — the pi-subagents config HappyVibe owns
 * (`<agentDir>/extensions/subagent/config.json`, read by pi-subagents at spawn).
 *
 * Four keys, each enforcing a locked PRD §12 decision, and the merge-write is
 * itself load-bearing: the dir is app-owned but the FILE's schema is upstream's,
 * so a key a future pin adds must survive us rewriting the file.
 *
 * Key-free: pure fs + a mocked electron userData. Stays in the non-live suite.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userData: string;

vi.mock("electron", () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const configFile = (): string => path.join(userData, "pi-agent", "extensions", "subagent", "config.json");

async function write(): Promise<Record<string, unknown>> {
  const { writeSubagentConfig } = await import("../src/main/config");
  writeSubagentConfig();
  return JSON.parse(fs.readFileSync(configFile(), "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-subcfg-"));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test("writes the four keys the PRD's async-delegation contract rests on", async () => {
  const cfg = await write();
  // §12 (2026-07-17): async by default — the turn ends at dispatch so the user
  // keeps chatting.
  expect(cfg.asyncByDefault).toBe(true);
  // One completion notify per run, which the renderer maps 1:1 to a run card.
  expect(cfg.completionBatch).toMatchObject({ enabled: false });
  // Intercom off: we deliver results via async-complete, never ack intercom.
  expect(cfg.intercomBridge).toMatchObject({ mode: "off" });
  // §12 (2026-08-17): the wait tool is disabled AT SOURCE. A blocking wait is
  // never right here; per-task discretion is `async:false` at dispatch instead.
  expect(cfg.waitTool).toMatchObject({ enabled: false });
});

test("merges over an existing file, keeping keys a future pin may have added", async () => {
  // The regression this pins: a plain overwrite would drop upstream's own keys
  // (and any user edit inside its schema) every time the app booted.
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({
    futureTopLevelKey: 42,
    waitTool: { enabled: true, futureSubKey: "keep me" },
    completionBatch: { enabled: true, windowMs: 250 },
  }));

  const cfg = await write();
  expect(cfg.futureTopLevelKey).toBe(42);
  // Ours wins on the keys we own…
  expect(cfg.waitTool).toMatchObject({ enabled: false });
  expect(cfg.completionBatch).toMatchObject({ enabled: false });
  // …and theirs survives beside it.
  expect((cfg.waitTool as Record<string, unknown>).futureSubKey).toBe("keep me");
  expect((cfg.completionBatch as Record<string, unknown>).windowMs).toBe(250);
});

test("recovers from a corrupt config rather than throwing at startup", async () => {
  // writeSubagentConfig runs on the boot path; a half-written file must not be
  // fatal. Starting fresh is right: every key we care about is re-asserted.
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), "{ not json");
  const cfg = await write();
  expect(cfg.asyncByDefault).toBe(true);
  expect(cfg.waitTool).toMatchObject({ enabled: false });
});
