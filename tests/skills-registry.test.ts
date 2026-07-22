import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSkillDir, type DiscoveredSkill } from "../src/main/skills/discovery";
import { resolveActiveSkills, SkillRegistry } from "../src/main/skills/registry";

let root: string;
let store: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skreg-"));
  store = path.join(root, "skills-approvals.jsonl");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function mkSkill(dir: string, desc = "A skill."): DiscoveredSkill {
  const abs = path.join(root, dir);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\nname: ${dir}\ndescription: ${desc}\n---\nbody`);
  return readSkillDir(abs, "managed");
}

const NOW = "2026-07-23T00:00:00.000Z";

test("unknown skill → needs-review; approve → approved", () => {
  const reg = new SkillRegistry(store);
  const s = mkSkill("a");
  expect(reg.approvalStatus(s)).toBe("needs-review");
  reg.approve(s, NOW);
  expect(reg.approvalStatus(s)).toBe("approved");
  expect(reg.record(s.id)?.enabled).toBe(true);
  expect(reg.record(s.id)?.snapshot?.skillMd).toMatch(/description: A skill\./);
});

test("content change after approval → back to needs-review", () => {
  const reg = new SkillRegistry(store);
  const s = mkSkill("b");
  reg.approve(s, NOW);
  fs.writeFileSync(path.join(s.id, "SKILL.md"), `---\nname: b\ndescription: Changed now.\n---\nnew`);
  const s2 = readSkillDir(s.id, "managed");
  expect(reg.approvalStatus(s2)).toBe("needs-review");
});

test("approvals persist across registry reloads (JSONL)", () => {
  const s = mkSkill("c");
  new SkillRegistry(store).approve(s, NOW);
  const reg2 = new SkillRegistry(store);
  expect(reg2.approvalStatus(s)).toBe("approved");
});

test("setEnabled toggles global on/off without losing trust", () => {
  const reg = new SkillRegistry(store);
  const s = mkSkill("d");
  reg.approve(s, NOW);
  reg.setEnabled(s.id, false, NOW);
  expect(reg.approvalStatus(s)).toBe("approved"); // still trusted
  expect(reg.record(s.id)?.enabled).toBe(false);
  reg.setEnabled(s.id, true, NOW);
  expect(reg.record(s.id)?.enabled).toBe(true);
});

test("resolveActiveSkills: approved+enabled+active default on for normal skills", () => {
  const reg = new SkillRegistry(store);
  const s = mkSkill("e");
  const unapproved = mkSkill("f");
  reg.approve(s, NOW);
  // s approved+enabled, default activation on; unapproved excluded
  expect(resolveActiveSkills([s, unapproved], reg, undefined)).toEqual([s.id]);
  // explicit workspace opt-out drops it
  expect(resolveActiveSkills([s], reg, { [s.id]: false })).toEqual([]);
  // globally disabled drops it even if workspace says on
  reg.setEnabled(s.id, false, NOW);
  expect(resolveActiveSkills([s], reg, { [s.id]: true })).toEqual([]);
});

test("resolveActiveSkills: bundled skills are off by default (opt-in)", () => {
  const reg = new SkillRegistry(store);
  const abs = path.join(root, "bundled-one");
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\nname: bundled-one\ndescription: Bundled.\n---\nbody`);
  const b = readSkillDir(abs, "bundled");
  reg.approve(b, NOW, { enabled: true }); // trusted + globally enabled
  // bundled default activation is OFF
  expect(resolveActiveSkills([b], reg, undefined)).toEqual([]);
  // explicit workspace opt-in loads it
  expect(resolveActiveSkills([b], reg, { [b.id]: true })).toEqual([b.id]);
});

test("resolveActiveSkills: non-loadable skills never load", () => {
  const reg = new SkillRegistry(store);
  const abs = path.join(root, "nodesc");
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\nname: nodesc\n---\nbody`); // no description
  const s = readSkillDir(abs, "managed");
  reg.approve(s, NOW);
  expect(resolveActiveSkills([s], reg, { [s.id]: true })).toEqual([]);
});
