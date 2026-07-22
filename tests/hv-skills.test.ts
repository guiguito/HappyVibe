import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildUseSkillGuidance, findByName, loadManifest, matchReadPath, skillTokenLines, type SkillManifest } from "../pi-runtime/extensions/hv-skills";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skman-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const manifest: SkillManifest = {
  skills: [
    { name: "pdf", dir: "/g/skills/pdf", skillMdPath: "/g/skills/pdf/SKILL.md", scope: "global", estTokens: { card: 10, body: 100 } },
    { name: "local", dir: "/ws/.agents/skills/local", skillMdPath: "/ws/.agents/skills/local/SKILL.md", scope: "workspace", estTokens: { card: 5, body: 50 } },
  ],
};

test("loadManifest reads a file, tolerates missing/corrupt", () => {
  const f = path.join(root, "m.json");
  fs.writeFileSync(f, JSON.stringify(manifest));
  expect(loadManifest(f).skills).toHaveLength(2);
  expect(loadManifest(path.join(root, "nope.json")).skills).toEqual([]);
  fs.writeFileSync(f, "{bad json");
  expect(loadManifest(f).skills).toEqual([]);
  expect(loadManifest(undefined).skills).toEqual([]);
});

test("findByName", () => {
  expect(findByName(manifest, "pdf")?.dir).toBe("/g/skills/pdf");
  expect(findByName(manifest, "missing")).toBeUndefined();
});

test("matchReadPath detects a raw read of an active SKILL.md (absolute + relative)", () => {
  expect(matchReadPath(manifest, { path: "/g/skills/pdf/SKILL.md" }, "/ws")?.name).toBe("pdf");
  expect(matchReadPath(manifest, { file_path: "/ws/.agents/skills/local/SKILL.md" }, "/ws")?.name).toBe("local");
  // relative to cwd
  expect(matchReadPath(manifest, { path: ".agents/skills/local/SKILL.md" }, "/ws")?.name).toBe("local");
  // an unrelated read is not a skill load
  expect(matchReadPath(manifest, { path: "/ws/src/index.ts" }, "/ws")).toBeUndefined();
});

test("skillTokenLines sums tokens + counts per scope", () => {
  expect(skillTokenLines(manifest)).toEqual({
    global: { tokens: 10, count: 1 },
    workspace: { tokens: 5, count: 1 },
  });
  expect(skillTokenLines({ skills: [] })).toEqual({
    global: { tokens: 0, count: 0 },
    workspace: { tokens: 0, count: 0 },
  });
});

test("buildUseSkillGuidance empty when no skills, present otherwise", () => {
  expect(buildUseSkillGuidance({ skills: [] })).toBe("");
  expect(buildUseSkillGuidance(manifest)).toMatch(/use_skill/);
});
