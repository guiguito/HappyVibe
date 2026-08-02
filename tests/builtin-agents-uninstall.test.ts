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

test("a bundle fix reaches a file whose mtime drifted but whose content is untouched", async () => {
  // The bug this pins: identity used to be mtime-based, so ANYTHING that restamped
  // the file without changing it (a second install pass racing the stat, a copy, a
  // sync tool) looked like a user edit and froze that agent FOREVER — silently.
  // Observed in the wild: an installed agents-md-maker.md stuck several bundle
  // versions behind, still byte-identical to a previously shipped copy.
  await install(bundleDir);
  const target = path.join(agentsDir(), "code-explorer.md");
  expect(fs.readFileSync(target, "utf8")).toBe("explorer");

  // Content untouched; only the timestamp moves.
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(target, future, future);

  fs.writeFileSync(path.join(bundleDir, "code-explorer.md"), "explorer v2");
  await install(bundleDir);

  expect(fs.readFileSync(target, "utf8")).toBe("explorer v2");
});

test("a genuine user edit still survives a bundle bump", async () => {
  await install(bundleDir);
  const target = path.join(agentsDir(), "code-explorer.md");
  fs.writeFileSync(target, "my explorer");

  fs.writeFileSync(path.join(bundleDir, "code-explorer.md"), "explorer v2");
  await install(bundleDir);

  expect(fs.readFileSync(target, "utf8")).toBe("my explorer");
});

test("a legacy mtime-stamped divergence is repaired, keeping a one-time backup", async () => {
  // Upgrade path for installs stamped by the old scheme: we cannot tell a stale
  // copy from an edit, and leaving it frozen is the bug. Prefer the bundle, but
  // never destroy content.
  await install(bundleDir);
  const target = path.join(agentsDir(), "code-explorer.md");
  fs.writeFileSync(target, "possibly-stale-possibly-mine");

  // Rewrite the stamp in the old {version, installedMtime} shape.
  const stampFile = path.join(userData, "pi-agent", "installed-agents.json");
  const stamps = JSON.parse(fs.readFileSync(stampFile, "utf8")) as Record<string, unknown>;
  stamps["code-explorer.md"] = { version: 12345, installedMtime: 12345 };
  fs.writeFileSync(stampFile, JSON.stringify(stamps));

  fs.writeFileSync(path.join(bundleDir, "code-explorer.md"), "explorer v2");
  await install(bundleDir);

  expect(fs.readFileSync(target, "utf8")).toBe("explorer v2");
  expect(fs.readFileSync(`${target}.bak`, "utf8")).toBe("possibly-stale-possibly-mine");
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
