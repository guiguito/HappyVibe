import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** PRD §38: the packaging half of self-update. Key-free; reads config files only. */
const ROOT = path.join(__dirname, "..");
const yml = parse(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));

describe("electron-builder.yml — §38", () => {
  it("builds a zip beside the dmg (Squirrel.Mac updates from the zip)", () => {
    expect(yml.mac.target).toEqual(expect.arrayContaining(["dmg", "zip"]));
  });
  it("keeps identity: null so a laptop build stays ad-hoc; release:mac overrides it on the CLI", () => {
    expect(yml.mac.identity).toBeNull();
  });
  it("publishes a DRAFT to the public repo — a draft is invisible to every running app", () => {
    expect(yml.publish).toMatchObject({ provider: "github", owner: "guiguito", repo: "HappyVibe", releaseType: "draft" });
  });
});

describe(".github/workflows/release.yml — §38", () => {
  const text = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const wf = parse(text);
  it("fires on v* tags only", () => expect(wf.on).toEqual({ push: { tags: ["v*"] } }));
  it("builds Windows and Linux, never macOS (signing is local, §4)", () => {
    const runners = Object.values(wf.jobs as Record<string, { "runs-on": string }>).map((j) => j["runs-on"]);
    expect(runners).toEqual(expect.arrayContaining(["windows-latest", "ubuntu-latest"]));
    expect(runners.join()).not.toMatch(/macos/);
  });
  it("refuses a tag that disagrees with package.json", () => {
    expect(text).toMatch(/require\('\.\/package\.json'\)\.version/);
    expect(text).toMatch(/GITHUB_REF_NAME/);
  });
  it("runs the suite before packaging", () => {
    expect(text.indexOf("npm test")).toBeGreaterThan(-1);
    expect(text.indexOf("npm test")).toBeLessThan(text.indexOf("--publish always"));
  });
  it("uses only the built-in token — no Apple secret ever reaches GitHub", () => {
    expect(text).toMatch(/GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    expect(text).not.toMatch(/APPLE_|CSC_LINK|CSC_KEY/);
  });
  it("asserts its own updater metadata exists — a metadata-less build updates nobody", () => {
    expect(text).toMatch(/test -f release\/latest\.yml/);
    expect(text).toMatch(/test -f release\/latest-linux\.yml/);
  });
  it("sets the draft's notes from the CHANGELOG entry", () => {
    expect(text).toMatch(/node scripts\/changelog-entry\.mjs/);
  });
});
