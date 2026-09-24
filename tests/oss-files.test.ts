import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** PRD §18 (open-source round, 2026-09-24): the repository a stranger lands on. */
const ROOT = path.join(__dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("open-source files — §18", () => {
  it.each([
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/workflows/dco.yml",
  ])("%s exists", (f) => expect(existsSync(path.join(ROOT, f))).toBe(true));

  it("CONTRIBUTING asks for DCO sign-off, states BOTH installs, and requires no CLA", () => {
    const c = read("CONTRIBUTING.md");
    expect(c).toMatch(/git commit -s/);
    expect(c).toMatch(/cd pi-runtime && npm ci/);
    expect(c).toMatch(/npm run gate/);
    expect(c).not.toMatch(/sign (a|the) CLA/i);
  });

  it("SECURITY routes reports to private vulnerability reporting, not public issues", () => {
    expect(read("SECURITY.md")).toMatch(/github\.com\/guiguito\/HappyVibe\/security\/advisories\/new/);
  });

  it("the DCO check fails a commit without Signed-off-by, using plain git (no third-party action)", () => {
    const t = read(".github/workflows/dco.yml");
    expect(parse(t).on).toHaveProperty("pull_request");
    expect(t).toMatch(/Signed-off-by:/);
    expect(t).not.toMatch(/uses: (?!actions\/checkout)/);
  });

  it("blank issues are off, so a report carries a version and an OS", () => {
    expect(parse(read(".github/ISSUE_TEMPLATE/config.yml")).blank_issues_enabled).toBe(false);
    expect(read(".github/ISSUE_TEMPLATE/bug_report.yml")).toMatch(/Changelog page/);
  });

  it("the README links the latest release and no longer tells macOS users to strip quarantine", () => {
    const r = read("README.md");
    expect(r).toMatch(/github\.com\/guiguito\/HappyVibe\/releases\/latest/);
    expect(r).not.toMatch(/xattr -dr com\.apple\.quarantine/);
    expect(r).toMatch(/SmartScreen/);
  });
});
