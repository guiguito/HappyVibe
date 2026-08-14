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

test("resolveActiveSkills: bundled skills off by default via enabled=false, load once enabled", () => {
  const reg = new SkillRegistry(store);
  const abs = path.join(root, "bundled-one");
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\nname: bundled-one\ndescription: Bundled.\n---\nbody`);
  const b = readSkillDir(abs, "bundled");
  reg.approve(b, NOW, { enabled: false }); // trusted but globally OFF (bundled default)
  expect(resolveActiveSkills([b], reg, undefined)).toEqual([]);
  // one "Enable" turns it on → active in workspaces by default
  reg.setEnabled(b.id, true, NOW);
  expect(resolveActiveSkills([b], reg, undefined)).toEqual([b.id]);
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

/**
 * §25 round 12 — the install banner enables in place, and it finds what to
 * enable by the SAME provenance link `hv:plugins-remove` scans. The reason it
 * works that way: hv:plugins-install returns skill NAMES while setEnabled takes
 * a skill's ID (its directory), so the alternative was plumbing a second
 * identifier over the wire and hoping the two stayed in agreement.
 *
 * The assertion that matters is the negative one — enabling plugin A must not
 * switch on plugin B's skills, or a one-click handover quietly widens what the
 * agent can do.
 */
test("enabling by provenance touches only that plugin's skills", () => {
  const reg = new SkillRegistry(store);
  const a = mkSkill("from-plugin-a");
  const b = mkSkill("from-plugin-b");
  const own = mkSkill("user-imported");

  // Plugin installs land disabled (§25, 2026-08-04); a hand-imported skill does not.
  reg.approve(a, NOW, { enabled: false, provenance: { source: "plugin", plugin: "p1" } });
  reg.approve(b, NOW, { enabled: false, provenance: { source: "plugin", plugin: "p2" } });
  reg.approve(own, NOW, { enabled: false });

  // What the handler does, over the records it finds for p1.
  for (const s of [a, b, own]) {
    if (reg.record(s.id)?.provenance?.plugin === "p1") reg.setEnabled(s.id, true, NOW);
  }

  expect(reg.record(a.id)?.enabled).toBe(true);
  expect(reg.record(b.id)?.enabled).toBe(false); // another plugin's — untouched
  expect(reg.record(own.id)?.enabled).toBe(false); // not a plugin's at all
});

test("enabling keeps trust and provenance intact — it is not a re-approval", () => {
  const reg = new SkillRegistry(store);
  const s = mkSkill("from-plugin");
  reg.approve(s, NOW, { enabled: false, provenance: { source: "plugin", plugin: "p1", sourceUrl: "https://example/x" } });
  reg.setEnabled(s.id, true, NOW);
  expect(reg.approvalStatus(s)).toBe("approved");
  expect(reg.record(s.id)?.provenance?.plugin).toBe("p1");
  expect(reg.record(s.id)?.provenance?.sourceUrl).toBe("https://example/x");
});
