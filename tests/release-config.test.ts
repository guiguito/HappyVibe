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
