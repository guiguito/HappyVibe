import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBundledSkills, scanSkillsDir, SkillRegistry } from "../src/main/skills";

const BUNDLED = path.join(process.cwd(), "pi-runtime", "skills");
const NOW = "2026-07-23T00:00:00.000Z";
let store: string;
beforeEach(() => { store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-bundled-")), "approvals.jsonl"); });
afterEach(() => fs.rmSync(path.dirname(store), { recursive: true, force: true }));

test("the 3 curated skills are vendored with SKILL.md", () => {
  for (const name of ["skill-creator", "frontend-design", "brand-guidelines"]) {
    expect(fs.existsSync(path.join(BUNDLED, name, "SKILL.md")), name).toBe(true);
  }
});

test("installBundledSkills pre-approves bundled skills, off by default, with provenance", () => {
  const reg = new SkillRegistry(store);
  installBundledSkills(BUNDLED, reg, NOW);
  const found = scanSkillsDir(BUNDLED, "bundled");
  expect(found.length).toBeGreaterThanOrEqual(3);
  for (const s of found) {
    expect(reg.approvalStatus(s), s.name).toBe("approved"); // trusted (no needs-review)
    const rec = reg.record(s.id)!;
    expect(rec.enabled, s.name).toBe(false); // OFF by default
    expect(rec.provenance?.source).toBe("bundled");
  }
});

test("idempotent: re-install preserves a user's enable choice", () => {
  const reg = new SkillRegistry(store);
  installBundledSkills(BUNDLED, reg, NOW);
  const s = scanSkillsDir(BUNDLED, "bundled")[0];
  reg.setEnabled(s.id, true, NOW); // user turned it on
  installBundledSkills(BUNDLED, reg, NOW); // startup runs again
  expect(reg.record(s.id)?.enabled).toBe(true); // not clobbered back to off
});
