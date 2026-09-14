import { afterEach, beforeEach, expect, it, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findByName, HV_SKILLS_SENTENCE, loadManifest, matchReadPath, skillTokenLines, type SkillManifest } from "../pi-runtime/extensions/hv-skills";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skman-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// Absolute paths are resolved per-platform (PRD §4, Windows round): a literal
// "/ws/..." gains a drive letter under path.resolve on Windows, so the relative arm
// below could never match a POSIX-literal manifest. The module compares normalised
// forms; the FIXTURE has to be host-shaped for that comparison to mean anything.
const WS = path.resolve("/ws");
const G = path.resolve("/g");
const manifest: SkillManifest = {
  skills: [
    { name: "pdf", dir: path.join(G, "skills", "pdf"), skillMdPath: path.join(G, "skills", "pdf", "SKILL.md"), scope: "global", estTokens: { card: 10, body: 100 } },
    { name: "local", dir: path.join(WS, ".agents", "skills", "local"), skillMdPath: path.join(WS, ".agents", "skills", "local", "SKILL.md"), scope: "workspace", estTokens: { card: 5, body: 50 } },
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
  expect(findByName(manifest, "pdf")?.dir).toBe(path.join(G, "skills", "pdf"));
  expect(findByName(manifest, "missing")).toBeUndefined();
});

test("matchReadPath detects a raw read of an active SKILL.md (absolute + relative)", () => {
  expect(matchReadPath(manifest, { path: path.join(G, "skills", "pdf", "SKILL.md") }, WS)?.name).toBe("pdf");
  expect(matchReadPath(manifest, { file_path: path.join(WS, ".agents", "skills", "local", "SKILL.md") }, WS)?.name).toBe("local");
  // relative to cwd
  // A forward-slash relative path from the model must still match on Windows.
  expect(matchReadPath(manifest, { path: ".agents/skills/local/SKILL.md" }, WS)?.name).toBe("local");
  // an unrelated read is not a skill load
  expect(matchReadPath(manifest, { path: path.join(WS, "src", "index.ts") }, WS)).toBeUndefined();
});

test("skillTokenLines sums tokens + counts per scope", () => {
  expect(skillTokenLines(manifest)).toEqual({
    global: { tokens: 10, count: 1, items: [{ name: "pdf", tokens: 10 }] },
    workspace: { tokens: 5, count: 1, items: [{ name: "local", tokens: 5 }] },
  });
  expect(skillTokenLines({ skills: [] })).toEqual({
    global: { tokens: 0, count: 0, items: [] },
    workspace: { tokens: 0, count: 0, items: [] },
  });
});

it("skillTokenLines lists each skill by name per scope", () => {
  const m = {
    skills: [
      { name: "pdf-tools", dir: "/a", skillMdPath: "/a/SKILL.md", scope: "global", estTokens: { card: 20, body: 400 } },
      { name: "house-style", dir: "/b", skillMdPath: "/b/SKILL.md", scope: "workspace", estTokens: { card: 12, body: 90 } },
    ],
  } as never;
  const lines = skillTokenLines(m);
  expect(lines.global).toEqual({ tokens: 20, count: 1, items: [{ name: "pdf-tools", tokens: 20 }] });
  expect(lines.workspace.items).toEqual([{ name: "house-style", tokens: 12 }]);
});

// A4 (2026-09-10): there is no <happyvibe-skills> block any more — the one
// sentence replaces Pi's own, in the same system prompt. Shape and pin-bump
// gate live in tests/pi-skills-sentence.test.ts.
test("the skills instruction steers to use_skill", () => {
  expect(HV_SKILLS_SENTENCE).toMatch(/use_skill/);
});
