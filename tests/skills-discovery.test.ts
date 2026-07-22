import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSkillDir, parseSkillFrontmatter, readSkillDir, scanSkillsDir } from "../src/main/skills/discovery";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skills-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSkill(dir: string, frontmatter: string, extraFiles: Record<string, string> = {}): string {
  const abs = path.join(root, dir);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Body\n\nInstructions here.\n`);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const f = path.join(abs, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  return abs;
}

test("parseSkillFrontmatter reads name/description and quotes", () => {
  expect(parseSkillFrontmatter(`---\nname: my-skill\ndescription: "Does a thing."\n---\nbody`)).toEqual({
    name: "my-skill",
    description: "Does a thing.",
    disableModelInvocation: false,
  });
  expect(parseSkillFrontmatter(`---\nname: x\ndescription: y\ndisable-model-invocation: true\n---`).disableModelInvocation).toBe(true);
  expect(parseSkillFrontmatter("no frontmatter here")).toEqual({ disableModelInvocation: false });
});

test("readSkillDir: name falls back to dir basename; missing description → not loadable", () => {
  const withName = writeSkill("a", "name: pdf-tools\ndescription: Extract text from PDFs.");
  const s = readSkillDir(withName, "managed");
  expect(s.name).toBe("pdf-tools");
  expect(s.loadable).toBe(true);
  expect(s.id).toBe(withName);

  const noName = writeSkill("fallback-dir", "description: A skill.");
  expect(readSkillDir(noName, "managed").name).toBe("fallback-dir");

  const noDesc = writeSkill("b", "name: broken");
  const bad = readSkillDir(noDesc, "managed");
  expect(bad.loadable).toBe(false);
  expect(bad.error).toMatch(/description/);
});

test("readSkillDir counts scripts and lists files", () => {
  const dir = writeSkill("c", "name: has-scripts\ndescription: Runs scripts.", {
    "scripts/run.sh": "#!/bin/sh\necho hi",
    "scripts/proc.py": "print(1)",
    "references/doc.md": "# ref",
  });
  const s = readSkillDir(dir, "workspace");
  expect(s.scriptCount).toBe(2);
  expect(s.files).toContain("SKILL.md");
  expect(s.files).toContain("scripts/run.sh");
  expect(s.estTokens.card).toBeGreaterThan(0);
});

test("hashSkillDir changes when content changes", () => {
  const dir = writeSkill("d", "name: h\ndescription: Hashing.");
  const before = readSkillDir(dir, "managed").hash;
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: h\ndescription: Hashing changed.\n---\nnew body`);
  const after = readSkillDir(dir, "managed").hash;
  expect(after).not.toBe(before);
  // stable when nothing changes
  expect(readSkillDir(dir, "managed").hash).toBe(after);
});

test("hashSkillDir changes when a referenced file is added", () => {
  const dir = writeSkill("e", "name: h2\ndescription: Files matter.");
  const files1 = ["SKILL.md"];
  const h1 = hashSkillDir(dir, files1);
  fs.writeFileSync(path.join(dir, "new.txt"), "content");
  const h2 = hashSkillDir(dir, ["SKILL.md", "new.txt"]);
  expect(h2).not.toBe(h1);
});

test("scanSkillsDir: dir with SKILL.md is a root, no deeper recursion; sibling dirs found", () => {
  writeSkill("packA/skill-one", "name: skill-one\ndescription: One.");
  writeSkill("packA/skill-two", "name: skill-two\ndescription: Two.");
  // A nested SKILL.md under an already-discovered root must NOT be discovered separately.
  writeSkill("packA/skill-one/nested", "name: nested\ndescription: Should be ignored.");
  const found = scanSkillsDir(path.join(root, "packA"), "linked");
  const names = found.map((s) => s.name).sort();
  expect(names).toEqual(["skill-one", "skill-two"]);
});

test("scanSkillsDir: missing root → empty", () => {
  expect(scanSkillsDir(path.join(root, "nope"), "managed")).toEqual([]);
});
