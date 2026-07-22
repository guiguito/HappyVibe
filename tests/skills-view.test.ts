import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSkillDir, type DiscoveredSkill } from "../src/main/skills/discovery";
import { SkillRegistry } from "../src/main/skills/registry";
import { toSkillView } from "../src/main/skills/view";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skview-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function mk(dir: string, frontmatter: string, source: DiscoveredSkill["source"] = "managed"): DiscoveredSkill {
  const abs = path.join(root, dir);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\n${frontmatter}\n---\nbody`);
  return readSkillDir(abs, source);
}
const NOW = "2026-07-23T00:00:00.000Z";

test("status: error (not loadable) beats everything", () => {
  const s = mk("a", "name: a"); // no description
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  reg.approve(s, NOW);
  expect(toSkillView(readSkillDir(s.id, "managed"), reg).status).toBe("error");
});

test("status: new skill → needs-review (not changed)", () => {
  const s = mk("b", "name: b\ndescription: New.");
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  const v = toSkillView(s, reg);
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(false);
});

test("status: approved+enabled → active (global view)", () => {
  const s = mk("c", "name: c\ndescription: Ok.");
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  reg.approve(s, NOW);
  expect(toSkillView(s, reg).status).toBe("active");
  reg.setEnabled(s.id, false, NOW);
  expect(toSkillView(s, reg).status).toBe("disabled");
});

test("status: approved then content changed → needs-review + changed flag (diff case)", () => {
  const s = mk("d", "name: d\ndescription: V1.");
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  reg.approve(s, NOW);
  fs.writeFileSync(path.join(s.id, "SKILL.md"), `---\nname: d\ndescription: V2 changed.\n---\nnew`);
  const v = toSkillView(readSkillDir(s.id, "managed"), reg);
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(true);
});

test("workspace activation view: opt-out drops a normal approved skill to disabled", () => {
  const s = mk("e", "name: e\ndescription: Ok.");
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  reg.approve(s, NOW);
  expect(toSkillView(s, reg, {}).status).toBe("active"); // default on
  expect(toSkillView(s, reg, { [s.id]: false }).status).toBe("disabled");
});

test("bundled approved skill shows disabled until globally enabled", () => {
  const s = mk("f", "name: f\ndescription: Bundled.", "bundled");
  const reg = new SkillRegistry(path.join(root, "r.jsonl"));
  reg.approve(s, NOW, { enabled: false }); // bundled default: trusted but off
  expect(toSkillView(s, reg).status).toBe("disabled");
  reg.setEnabled(s.id, true, NOW);
  expect(toSkillView(s, reg).status).toBe("active"); // one enable turns it on
});
