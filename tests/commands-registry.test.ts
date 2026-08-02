import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCommandFile, scanCommandsDir, type DiscoveredCommand } from "../src/main/commands/discovery";
import { CommandRegistry, resolveActiveCommands } from "../src/main/commands/registry";

let root: string;
let store: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdreg-"));
  store = path.join(root, "commands-approvals.jsonl");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function mkCommand(name: string, body = "Do the thing."): DiscoveredCommand {
  const abs = path.join(root, `${name}.md`);
  fs.writeFileSync(abs, `---\ndescription: A command.\n---\n${body}\n`);
  return readCommandFile(abs, "managed");
}

const NOW = "2026-08-02T00:00:00.000Z";

test("unknown command → needs-review; approve → approved, enabled, body snapshotted", () => {
  const reg = new CommandRegistry(store);
  const c = mkCommand("a");
  expect(reg.approvalStatus(c)).toBe("needs-review");
  reg.approve(c, NOW);
  expect(reg.approvalStatus(c)).toBe("approved");
  expect(reg.record(c.id)?.enabled).toBe(true);
  expect(reg.record(c.id)?.snapshot?.body).toBe("Do the thing.");
});

test("content change after approval → back to needs-review", () => {
  const reg = new CommandRegistry(store);
  const c = mkCommand("b");
  reg.approve(c, NOW);
  fs.writeFileSync(c.id, `---\ndescription: A command.\n---\nrm -rf everything.\n`);
  expect(reg.approvalStatus(readCommandFile(c.id, "managed"))).toBe("needs-review");
});

test("approvals persist across registry reloads (JSONL)", () => {
  const c = mkCommand("c");
  new CommandRegistry(store).approve(c, NOW, { provenance: { source: "git", sourceUrl: "https://example.test/x.git" } });
  const reg2 = new CommandRegistry(store);
  expect(reg2.approvalStatus(c)).toBe("approved");
  expect(reg2.record(c.id)?.provenance?.sourceUrl).toBe("https://example.test/x.git");
});

test("setEnabled toggles the global on/off without losing trust; forget tombstones", () => {
  const reg = new CommandRegistry(store);
  const c = mkCommand("d");
  reg.approve(c, NOW);
  reg.setEnabled(c.id, false, NOW);
  expect(reg.approvalStatus(c)).toBe("approved"); // still trusted
  expect(reg.record(c.id)?.enabled).toBe(false);

  reg.forget(c.id, NOW);
  expect(reg.record(c.id)).toBeUndefined();
  expect(reg.approvalStatus(c)).toBe("needs-review");
  // the tombstone survives a reload: a returning file must be re-reviewed, not auto-trusted
  const reg2 = new CommandRegistry(store);
  expect(reg2.approvalStatus(c)).toBe("needs-review");
  expect(reg2.record(c.id)?.hash).toBe("");
});

test("setEnabled on a command that was never approved is a no-op", () => {
  const reg = new CommandRegistry(store);
  const c = mkCommand("e");
  expect(reg.setEnabled(c.id, true, NOW)).toBeUndefined();
  expect(reg.record(c.id)).toBeUndefined();
});

test("activation is opt-out and a disabled command never spawns", () => {
  const reg = new CommandRegistry(store);
  mkCommand("one");
  mkCommand("two");
  const [a, b] = scanCommandsDir(root, "managed");
  reg.approve(a, NOW);
  reg.approve(b, NOW);
  expect(resolveActiveCommands([a, b], reg, undefined)).toEqual([a.id, b.id]);
  expect(resolveActiveCommands([a, b], reg, { [b.id]: false })).toEqual([a.id]);
  reg.setEnabled(a.id, false, NOW);
  expect(resolveActiveCommands([a, b], reg, undefined)).toEqual([b.id]);
});

test("resolveActiveCommands: an unapproved command never spawns, whatever the workspace says", () => {
  const reg = new CommandRegistry(store);
  const c = mkCommand("f");
  expect(resolveActiveCommands([c], reg, { [c.id]: true })).toEqual([]);
});

test("resolveActiveCommands: bundled commands are off by default via enabled=false, and one enable turns them on", () => {
  const reg = new CommandRegistry(store);
  const abs = path.join(root, "bundled-one.md");
  fs.writeFileSync(abs, `---\ndescription: Bundled.\n---\nbody\n`);
  const b = readCommandFile(abs, "bundled");
  reg.approve(b, NOW, { enabled: false });
  expect(resolveActiveCommands([b], reg, undefined)).toEqual([]);
  reg.setEnabled(b.id, true, NOW);
  expect(resolveActiveCommands([b], reg, undefined)).toEqual([b.id]);
});

test("resolveActiveCommands: a description-less command still spawns — there is no loadable gate", () => {
  const reg = new CommandRegistry(store);
  const abs = path.join(root, "nodesc.md");
  fs.writeFileSync(abs, "just a body\n");
  const c = readCommandFile(abs, "managed");
  reg.approve(c, NOW);
  expect(resolveActiveCommands([c], reg, undefined)).toEqual([c.id]);
});
