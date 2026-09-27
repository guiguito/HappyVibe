import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBundledSkills, scanSkillsDir, SkillRegistry } from "../src/main/skills";
import { screenSkillText } from "../src/main/plugins/screen";

const BUNDLED = path.join(process.cwd(), "pi-runtime", "skills");
const NOW = "2026-07-23T00:00:00.000Z";
let store: string;
beforeEach(() => { store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-bundled-")), "approvals.jsonl"); });
afterEach(() => fs.rmSync(path.dirname(store), { recursive: true, force: true }));

const SHIPPED = ["analyze", "brand-review", "doublecheck", "frontend-design", "review-contract", "skill-creator", "theme-factory", "write-spec"];

test("the curated skills are vendored with SKILL.md — and brand-guidelines is gone (PRD §14, 2026-09-27)", () => {
  expect(scanSkillsDir(BUNDLED, "bundled").map((s) => path.basename(s.id)).sort()).toEqual(SHIPPED);
  for (const name of SHIPPED) expect(fs.existsSync(path.join(BUNDLED, name, "SKILL.md")), name).toBe(true);
  // Anthropic's own brand; its description steered a user's brand request to Anthropic's.
  expect(fs.existsSync(path.join(BUNDLED, "brand-guidelines"))).toBe(false);
});

test("every shipped skill is loadable, licensed, has provenance, and passes the §25 ingestion screen", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLED, "bundled.json"), "utf8")) as {
    items: Array<{ name: string; source: string; commit: string; license: string }>;
  };
  for (const s of scanSkillsDir(BUNDLED, "bundled")) {
    const name = path.basename(s.id);
    expect(s.loadable, name).toBe(true);
    const item = manifest.items.find((i) => i.name === name);
    expect(item, `${name} missing from bundled.json`).toBeTruthy();
    expect(item!.commit, name).toMatch(/^[0-9a-f]{40}$/);
    expect(item!.license, name).toMatch(/^(Apache-2\.0|MIT)$/);
    expect(fs.readdirSync(s.id).some((f) => /^LICENSE/i.test(f)), `${name} ships its license file`).toBe(true);
    for (const rel of s.files) {
      const text = fs.readFileSync(path.join(s.id, rel), "utf8");
      expect(screenSkillText(text).verdict, `${name}/${rel}`).toBe("ok");
    }
  }
});

test("adapted skills keep no Claude-Code-only machinery", () => {
  // Connector placeholders, slash-command args and Claude-only paths all fail SILENTLY in Pi.
  const BAD = [/~~[a-z]/i, /\$ARGUMENTS\b/, /(^|\s)\$1\b/m, /CLAUDE_PLUGIN_ROOT/, /\bpip install\b/];
  for (const name of ["analyze", "brand-review", "doublecheck", "review-contract", "theme-factory", "write-spec"]) {
    const text = fs.readFileSync(path.join(BUNDLED, name, "SKILL.md"), "utf8");
    for (const re of BAD) expect(re.test(text), `${name}: ${re}`).toBe(false);
  }
});

test("resting cost budget: bundled skill cards stay under 900 tokens (accepted 2026-09-27 as a number, not as unbounded)", () => {
  const total = scanSkillsDir(BUNDLED, "bundled").reduce((n, s) => n + s.estTokens.card, 0);
  expect(total).toBeLessThanOrEqual(900);
});

test("review-contract says it is not legal advice", () => {
  expect(fs.readFileSync(path.join(BUNDLED, "review-contract", "SKILL.md"), "utf8")).toMatch(/not legal advice/i);
});

test("installBundledSkills pre-approves bundled skills, ON by default (PRD §14, 2026-09-27), with provenance", () => {
  const reg = new SkillRegistry(store);
  installBundledSkills(BUNDLED, reg, NOW);
  const found = scanSkillsDir(BUNDLED, "bundled");
  expect(found.length).toBeGreaterThanOrEqual(3);
  for (const s of found) {
    expect(reg.approvalStatus(s), s.name).toBe("approved"); // trusted (no needs-review)
    const rec = reg.record(s.id)!;
    expect(rec.enabled, s.name).toBe(true); // ON by default since 2026-09-27
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

const writeSkill = (dir: string, name: string, body = "Do it."): void => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`);
};

test("provenance is per item: two skills from two repos keep their own source and commit", () => {
  const dir = path.join(path.dirname(store), "bundle");
  writeSkill(dir, "alpha");
  writeSkill(dir, "beta");
  fs.writeFileSync(path.join(dir, "bundled.json"), JSON.stringify({
    items: [
      { name: "alpha", source: "github.com/a/one", ref: "main", commit: "aaa", license: "Apache-2.0" },
      { name: "beta", source: "github.com/b/two", ref: "main", commit: "bbb", license: "MIT" },
    ],
  }));
  const reg = new SkillRegistry(store);
  installBundledSkills(dir, reg, NOW);
  const byName = Object.fromEntries(scanSkillsDir(dir, "bundled").map((s) => [s.name, reg.record(s.id)!]));
  expect(byName.alpha.provenance).toMatchObject({ source: "bundled", sourceUrl: "github.com/a/one", commitSha: "aaa" });
  expect(byName.beta.provenance).toMatchObject({ source: "bundled", sourceUrl: "github.com/b/two", commitSha: "bbb" });
});

test("upgrade rule: a record already OFF stays OFF when the bundle bumps its content", () => {
  const dir = path.join(path.dirname(store), "bundle");
  writeSkill(dir, "alpha");
  const reg = new SkillRegistry(store);
  installBundledSkills(dir, reg, NOW);
  const s = scanSkillsDir(dir, "bundled")[0];
  reg.setEnabled(s.id, false, NOW); // an old-default OFF record, or a user's choice — indistinguishable
  writeSkill(dir, "alpha", "Do it better."); // bundle bump → new hash
  installBundledSkills(dir, reg, NOW);
  const rec = reg.record(s.id)!;
  expect(rec.hash).toBe(scanSkillsDir(dir, "bundled")[0].hash); // re-approved at the new content
  expect(rec.enabled).toBe(false); // only items NEW to the bundle arrive ON
});
