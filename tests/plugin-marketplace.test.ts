import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseMarketplace, entryArchiveUrl } from "../src/main/plugins/marketplace";

/**
 * The fixture is a verbatim cut of the real
 * anthropics/claude-plugins-official marketplace.json (fetched 2026-08-04),
 * keeping one entry per source shape. If a Claude Code release changes the
 * schema, this is the test that says so.
 */
const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/marketplace-official.json"), "utf8"),
);
const mp = parseMarketplace(raw);
const by = (n: string) => mp.entries.find((e) => e.name === n)!;

describe("parseMarketplace", () => {
  it("reads the marketplace identity and every entry", () => {
    expect(mp.name).toBe("claude-plugins-official");
    expect(mp.entries).toHaveLength(5);
    expect(mp.skipped).toEqual([]);
  });

  it("parses git-subdir: url + path + ref + sha", () => {
    expect(by("42crunch-api-security-testing").source).toEqual({
      repoUrl: "https://github.com/42Crunch-AI/claude-plugins.git",
      subdir: "plugins/api-security-testing",
      ref: "v1.5.5",
      sha: "30287f5e3f122a646d1ac5ca3ab96e130c52a3ad",
    });
  });

  it("parses a bare ./path as local to the marketplace repo", () => {
    // No repoUrl and no sha of its own — it is pinned by the commit we fetched
    // the marketplace at.
    expect(by("agent-sdk-dev").source).toEqual({
      repoUrl: null,
      sha: null,
      subdir: "plugins/agent-sdk-dev",
    });
  });

  it("parses url + sha with no path and no ref", () => {
    const s = by("agentforce-adlc").source;
    expect(s.subdir).toBe("");
    expect(s.ref).toBeUndefined();
    expect(s.sha).toHaveLength(40);
  });

  it("parses github + repo, preferring commit over sha as the pin", () => {
    // `commit` and `sha` differ on this entry; `commit` is the plugin's pin.
    expect(by("fullstory").source).toEqual({
      repoUrl: "https://github.com/fullstorydev/fullstory-skills.git",
      sha: "1ec5865e7ab1449f9a0859d164c4b6a8c53b6e2f",
      ref: undefined,
      subdir: "",
    });
  });

  it("surfaces entry-level component declarations", () => {
    // 12 official entries declare lspServers on the ENTRY, not in the manifest —
    // a free reject with no download.
    expect(by("clangd-lsp").entryComponents).toContain("lspServers");
    expect(by("agent-sdk-dev").entryComponents).toEqual([]);
  });

  it("carries the card copy", () => {
    expect(by("42crunch-api-security-testing").description.length).toBeGreaterThan(20);
    expect(by("clangd-lsp").category).toBe("development");
  });
});

describe("parseMarketplace resilience", () => {
  it("skips malformed entries instead of throwing", () => {
    const r = parseMarketplace({
      name: "x",
      plugins: [{ description: "no name" }, "junk", { name: "nosource" }, { name: "ok", source: "./p" }],
    });
    expect(r.entries.map((e) => e.name)).toEqual(["ok"]);
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped.map((s) => s.name)).toContain("nosource");
  });

  it("returns an empty marketplace for junk rather than throwing", () => {
    expect(parseMarketplace(null).entries).toEqual([]);
    expect(parseMarketplace("nope").entries).toEqual([]);
    expect(parseMarketplace({ plugins: "nope" }).entries).toEqual([]);
  });

  it("refuses a source path that escapes", () => {
    const r = parseMarketplace({ plugins: [{ name: "evil", source: "../../etc" }] });
    expect(r.entries).toEqual([]);
    expect(r.skipped[0].reason).toContain("escapes");
  });

  it("refuses an escaping subdir on an object source", () => {
    const r = parseMarketplace({
      plugins: [{ name: "evil", source: { source: "url", url: "https://x/y/z.git", path: "a/../../b" } }],
    });
    expect(r.entries).toEqual([]);
    expect(r.skipped[0].reason).toContain("escapes");
  });

  it('treats path "." as repo root', () => {
    const r = parseMarketplace({
      plugins: [{ name: "root", source: { source: "url", url: "https://github.com/o/n.git", path: ".", sha: "abc" } }],
    });
    expect(r.entries[0].source.subdir).toBe("");
  });
});

describe("entryArchiveUrl", () => {
  it("builds a codeload URL pinned to the sha", () => {
    expect(entryArchiveUrl(by("42crunch-api-security-testing").source)).toBe(
      "https://codeload.github.com/42Crunch-AI/claude-plugins/tar.gz/30287f5e3f122a646d1ac5ca3ab96e130c52a3ad",
    );
  });

  it("uses the commit for a github-shaped source", () => {
    expect(entryArchiveUrl(by("fullstory").source)).toBe(
      "https://codeload.github.com/fullstorydev/fullstory-skills/tar.gz/1ec5865e7ab1449f9a0859d164c4b6a8c53b6e2f",
    );
  });

  it("returns null for a marketplace-local entry", () => {
    expect(entryArchiveUrl(by("agent-sdk-dev").source)).toBeNull();
  });

  it("handles a non-GitHub forge", () => {
    expect(entryArchiveUrl({ repoUrl: "https://gitlab.com/o/n.git", sha: "abc", subdir: "" })).toBe(
      "https://gitlab.com/o/n/archive/abc.tar.gz",
    );
  });
});
