import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bundledPromptTemplatesDir,
  claudeCommandsDir,
  PromptTemplateRegistry,
  discoverGlobalPromptTemplates,
  discoverWorkspacePromptTemplates,
  installBundledPromptTemplates,
  isShadowed,
  managedPromptTemplatesDir,
  scanPromptTemplatesDir,
  workspacePromptTemplatesDir,
} from "../src/main/promptTemplates";

const NOW = "2026-08-02T00:00:00.000Z";
let tmp: string;
let store: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-loc-"));
  store = path.join(tmp, "commands.jsonl");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (dir: string, name: string, body: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, body);
  return f;
};

test("the four scope roots", () => {
  expect(managedPromptTemplatesDir("/agent")).toBe(path.join("/agent", "prompts"));
  expect(bundledPromptTemplatesDir("/runtime")).toBe(path.join("/runtime", "prompts"));
  expect(workspacePromptTemplatesDir("/ws")).toBe(path.join("/ws", ".agents", "prompts"));
  expect(claudeCommandsDir("/ws")).toBe(path.join("/ws", ".claude", "commands"));
});

test("scans .agents/prompts and .claude/commands with distinct sources", () => {
  const ws = path.join(tmp, "ws");
  write(workspacePromptTemplatesDir(ws), "mine.md", "mine\n");
  write(claudeCommandsDir(ws), "team.md", "team\n");
  const bySource = Object.fromEntries(discoverWorkspacePromptTemplates(ws).map((c) => [c.name, c.source]));
  expect(bySource).toEqual({ mine: "workspace", team: "claude" });
});

test("a workspace with neither root yields nothing", () => {
  expect(discoverWorkspacePromptTemplates(path.join(tmp, "empty-ws"))).toEqual([]);
});

test("global scope is bundled + managed + linked, in that order", () => {
  const managedDir = managedPromptTemplatesDir(path.join(tmp, "agent"));
  const bundledDir = bundledPromptTemplatesDir(path.join(tmp, "runtime"));
  const linked = path.join(tmp, "dot-claude-commands");
  write(managedDir, "m.md", "m\n");
  write(bundledDir, "b.md", "b\n");
  write(linked, "l.md", "l\n");
  const found = discoverGlobalPromptTemplates({ managedDir, bundledDir, linkedDirs: [linked] });
  expect(found.map((c) => [c.name, c.source])).toEqual([
    ["b", "bundled"],
    ["m", "managed"],
    ["l", "linked"],
  ]);
});

test("installBundledPromptTemplates pre-approves bundled commands, off by default, with provenance", () => {
  const bundledDir = bundledPromptTemplatesDir(path.join(tmp, "runtime"));
  write(bundledDir, "review.md", "---\ndescription: Review the diff\n---\nReview $1.\n");
  write(bundledDir, "explain.md", "Explain $1.\n");
  fs.writeFileSync(
    path.join(bundledDir, "bundled.json"),
    JSON.stringify({ source: "https://example.test/pack", ref: "main", commit: "deadbeef" }),
  );

  const reg = new PromptTemplateRegistry(store);
  installBundledPromptTemplates(bundledDir, reg, NOW);

  const found = scanPromptTemplatesDir(bundledDir, "bundled");
  expect(found.length).toBe(2); // bundled.json is not a command
  for (const c of found) {
    expect(reg.approvalStatus(c), c.name).toBe("approved"); // trusted (no needs-review)
    const rec = reg.record(c.id)!;
    expect(rec.enabled, c.name).toBe(false); // OFF by default
    expect(rec.provenance?.source).toBe("bundled");
    expect(rec.provenance?.commitSha).toBe("deadbeef");
  }
});

test("idempotent: an unchanged bundle writes nothing on the second pass", () => {
  const bundledDir = bundledPromptTemplatesDir(path.join(tmp, "runtime"));
  write(bundledDir, "review.md", "Review $1.\n");
  const reg = new PromptTemplateRegistry(store);
  installBundledPromptTemplates(bundledDir, reg, NOW);
  const after1 = fs.readFileSync(store, "utf8");
  installBundledPromptTemplates(bundledDir, reg, NOW);
  expect(fs.readFileSync(store, "utf8")).toBe(after1);
});

// The bundle we actually ship (Task 15). Guards the files themselves, not the
// installer: a missing `description`/`argument-hint`, an accidental !`bash`
// (which Pi drops silently) or a name a /hv-* command already owns would all
// reach users as a broken starter command.
test("the shipped starter bundle installs approved and OFF, with hints and no risk pills", () => {
  const bundledDir = bundledPromptTemplatesDir(path.join(__dirname, "..", "pi-runtime"));
  const found = scanPromptTemplatesDir(bundledDir, "bundled");
  expect(found.map((c) => c.name).sort()).toEqual(["explain", "review", "test"]);

  const reg = new PromptTemplateRegistry(store);
  installBundledPromptTemplates(bundledDir, reg, NOW);
  for (const c of found) {
    expect(reg.approvalStatus(c), c.name).toBe("approved");
    expect(reg.record(c.id)?.enabled, c.name).toBe(false);
    expect(c.description.length, c.name).toBeGreaterThan(10);
    expect(c.argumentHint, c.name).toBeTruthy();
    expect(c.hasBashInjection, c.name).toBe(false);
    expect(isShadowed(c.name), c.name).toBe(false);
  }
});

test("a bundle bump re-approves but keeps the user's on/off", () => {
  const bundledDir = bundledPromptTemplatesDir(path.join(tmp, "runtime"));
  const file = write(bundledDir, "review.md", "Review $1.\n");
  const reg = new PromptTemplateRegistry(store);
  installBundledPromptTemplates(bundledDir, reg, NOW);
  reg.setEnabled(file, true, NOW); // user turned it on

  fs.writeFileSync(file, "Review $1 harder.\n"); // bundle bumped
  const bumped = scanPromptTemplatesDir(bundledDir, "bundled")[0];
  expect(reg.approvalStatus(bumped)).toBe("needs-review"); // content moved
  installBundledPromptTemplates(bundledDir, reg, NOW); // startup runs again
  expect(reg.approvalStatus(bumped)).toBe("approved"); // still vetted
  expect(reg.record(file)?.enabled).toBe(true); // not clobbered back to off
});
