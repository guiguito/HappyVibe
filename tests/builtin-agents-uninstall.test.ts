/**
 * WS11: installBuiltinAgents removal pass — a builtin dropped from the bundle
 * (summarizer, now that compaction is Pi-native) is uninstalled IF unedited;
 * a user-edited copy survives as their own agent. The stamp is dropped either way.
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

async function install(bundleDir: string): Promise<void> {
  const { installBuiltinAgents } = await import("../src/main/config");
  installBuiltinAgents(bundleDir);
}

let bundleDir: string;
const agentsDir = (): string => path.join(userData, "pi-agent", "agents");

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ud-"));
  bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-bundle-"));
  fs.writeFileSync(path.join(bundleDir, "code-explorer.md"), "explorer");
  fs.writeFileSync(path.join(bundleDir, "agents-md-maker.md"), "maker");
  fs.writeFileSync(path.join(bundleDir, "summarizer.md"), "summarize");
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

test("an unedited builtin dropped from the bundle is uninstalled", async () => {
  await install(bundleDir);
  expect(fs.existsSync(path.join(agentsDir(), "summarizer.md"))).toBe(true);

  fs.rmSync(path.join(bundleDir, "summarizer.md"));
  await install(bundleDir);

  expect(fs.existsSync(path.join(agentsDir(), "summarizer.md"))).toBe(false);
  expect(fs.existsSync(path.join(agentsDir(), "code-explorer.md"))).toBe(true);
  expect(fs.existsSync(path.join(agentsDir(), "agents-md-maker.md"))).toBe(true);
  const stamps = JSON.parse(fs.readFileSync(path.join(userData, "pi-agent", "installed-agents.json"), "utf8"));
  expect(stamps["summarizer.md"]).toBeUndefined();
  expect(stamps["code-explorer.md"]).toBeDefined();
});

test("a user-edited builtin dropped from the bundle is preserved", async () => {
  await install(bundleDir);
  const target = path.join(agentsDir(), "summarizer.md");
  // Simulate a user edit: change content AND bump mtime well past the stamp.
  fs.writeFileSync(target, "my custom summarizer");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(target, future, future);

  fs.rmSync(path.join(bundleDir, "summarizer.md"));
  await install(bundleDir);

  expect(fs.existsSync(target)).toBe(true);
  expect(fs.readFileSync(target, "utf8")).toBe("my custom summarizer");
  const stamps = JSON.parse(fs.readFileSync(path.join(userData, "pi-agent", "installed-agents.json"), "utf8"));
  expect(stamps["summarizer.md"]).toBeUndefined(); // no longer tracked as a builtin
});
