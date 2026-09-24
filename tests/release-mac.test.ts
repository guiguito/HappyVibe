import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM, no type declarations
import { macReleasePreflight, missingMacArtifacts } from "../scripts/release-mac.mjs";

/**
 * PRD §4/§38 — the macOS leg is signed on the maintainer's Mac. Everything it
 * refuses, it refuses BEFORE a 10-minute build, and names the fix.
 */
const ID = '  1) ABCDEF "Developer ID Application: Guilhem Duche (BZGBG4WG68)"\n     1 valid identities found';
const good = { clean: true, headTags: ["v0.2.0"], version: "0.2.0", identities: ID, profileOk: true, ghToken: "t" };

describe("macReleasePreflight", () => {
  it("all good → the Developer ID name", () => {
    expect(macReleasePreflight(good)).toEqual({ ok: true, identity: "Developer ID Application: Guilhem Duche (BZGBG4WG68)" });
  });
  it("an Apple Development cert alone is refused, naming the fix", () => {
    const r = macReleasePreflight({ ...good, identities: '  1) X "Apple Development: Guilhem Duche (BZGBG4WG68)"' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Developer ID Application/);
    expect(JSON.stringify(r)).toMatch(/Manage Certificates/);
  });
  it.each([
    [{ clean: false }, /uncommitted/],
    [{ headTags: [] }, /v0\.2\.0/],
    [{ headTags: ["v0.1.9"] }, /v0\.2\.0/],
    [{ profileOk: false }, /notarytool store-credentials happyvibe/],
    [{ ghToken: undefined }, /GH_TOKEN/],
    [{ ghToken: "" }, /GH_TOKEN/],
  ])("refuses %o", (patch, msg) => {
    const r = macReleasePreflight({ ...good, ...patch });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(msg);
  });
  it("reports every problem at once, not one per run", () => {
    const r = macReleasePreflight({ clean: false, headTags: [], version: "0.2.0", identities: "", profileOk: false });
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBe(5);
  });
});

describe("missingMacArtifacts — Review Focus 5", () => {
  it("a dmg-only build is incomplete: the updater needs the zip, its blockmap and latest-mac.yml", () => {
    expect(missingMacArtifacts(["HappyVibe-0.2.0-arm64.dmg"], "0.2.0")).toEqual([
      "HappyVibe-0.2.0-arm64-mac.zip",
      "HappyVibe-0.2.0-arm64-mac.zip.blockmap",
      "latest-mac.yml",
    ]);
  });
  it("a complete build misses nothing", () => {
    expect(
      missingMacArtifacts(
        ["HappyVibe-0.2.0-arm64.dmg", "HappyVibe-0.2.0-arm64-mac.zip", "HappyVibe-0.2.0-arm64-mac.zip.blockmap", "latest-mac.yml"],
        "0.2.0",
      ),
    ).toEqual([]);
  });
  it("a stale build of another version does not count", () => {
    expect(missingMacArtifacts(["HappyVibe-0.1.0-arm64.dmg", "latest-mac.yml"], "0.2.0")).toContain("HappyVibe-0.2.0-arm64.dmg");
  });
});
