import { describe, it, expect } from "vitest";
import { classifyPlugin, detectComponents, ALLOWED_MANIFEST_KEYS } from "../src/main/plugins/classify";

/** 42crunch's REAL manifest keys, read at its pinned commit 2026-08-04. */
const clean = {
  name: "42crunch-api-security-testing",
  description: "d",
  version: "1.15.0",
  author: { name: "42Crunch" },
  homepage: "https://42crunch.com",
  repository: "https://github.com/42Crunch-AI/claude-plugins",
  license: "Apache 2.0",
  category: "security",
  keywords: ["openapi"],
};

describe("classifyPlugin", () => {
  it("accepts the hand-validated clean plugin, category and all", () => {
    // Regression guard: `category` is real and was missing from the first
    // allowlist, which would have rejected the plugin used to prove the design.
    const v = classifyPlugin({
      manifest: clean,
      topLevel: [".claude-plugin", "LICENSE", "README.md", "RECIPES.md", "references", "skills"],
    });
    expect(v.accepted).toBe(true);
    expect(v.components).toEqual(["skills"]);
    expect(v.rejected).toEqual([]);
  });

  it("sees a tree-only .mcp.json — a manifest-only filter would miss it", () => {
    // airtable declares no mcpServers yet ships .mcp.json. Under scenario C we
    // accept it, but we must DETECT it either way or the filter is unsound.
    const v = classifyPlugin({
      manifest: { name: "airtable", description: "d", author: {} },
      topLevel: [".mcp.json", "skills"],
    });
    expect(v.components).toEqual(["mcpServers", "skills"]);
    expect(v.accepted).toBe(true);
  });

  it("rejects hooks found only on disk", () => {
    const v = classifyPlugin({
      manifest: { name: "x", description: "d", author: {} },
      topLevel: ["skills", "hooks"],
    });
    expect(v.accepted).toBe(false);
    expect(v.rejected).toEqual(["hooks"]);
    expect(v.reason).toBe("uses hooks, not supported in HappyVibe");
    // the accepted part is still reported, for "installing 3 of 14"
    expect(v.components).toEqual(["skills"]);
  });

  it("rejects lspServers declared on the marketplace entry alone", () => {
    // The official marketplace puts lspServers on 12 ENTRIES, not in manifests.
    const v = classifyPlugin({
      manifest: { name: "clangd-lsp", description: "d", author: {} },
      topLevel: [],
      entryComponents: ["lspServers"],
    });
    expect(v.accepted).toBe(false);
    expect(v.rejected).toEqual(["lspServers"]);
  });

  it("IGNORES unknown directories — they are payload, not components", () => {
    // Every one of these is a real top-level dir in the official marketplace's
    // bundled plugins. Rejecting on them would kill working plugins.
    const v = classifyPlugin({
      manifest: clean,
      topLevel: [
        "skills", "hooks-handlers", "scripts", "core", "utils", "matchers",
        "examples", "assets", "references", "docs", ".gitignore", "SECURITY.md",
        "automation-recommender-example.png",
      ],
    });
    expect(v.accepted).toBe(true);
    expect(v.components).toEqual(["skills"]);
  });

  it("rejects a future component type declared in the manifest, and names it", () => {
    const v = classifyPlugin({ manifest: { ...clean, monitors: {} }, topLevel: ["skills"] });
    expect(v.accepted).toBe(false);
    expect(v.rejected).toContain("monitors");
  });

  it("names an unrecognised metadata key rather than failing silently", () => {
    const v = classifyPlugin({ manifest: { ...clean, wobble: 1 }, topLevel: ["skills"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toContain("wobble");
  });

  it("reports a plugin with nothing we can install", () => {
    const v = classifyPlugin({ manifest: { name: "x", description: "d", author: {} }, topLevel: ["README.md"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe("nothing HappyVibe can install");
  });

  it("tolerates an absent manifest (classify from the tree alone)", () => {
    const v = classifyPlugin({ manifest: null, topLevel: ["skills"] });
    expect(v.accepted).toBe(true);
    expect(v.components).toEqual(["skills"]);
  });

  it("detects a component from the manifest field as well as the dir", () => {
    expect(detectComponents({ name: "x", commands: ["./c.md"] }, [])).toEqual(["commands"]);
    expect(detectComponents({ name: "x" }, ["commands"])).toEqual(["commands"]);
    expect(detectComponents({ name: "x" }, ["output-styles"])).toEqual(["outputStyles"]);
  });

  it("keeps the accepted three inside the manifest allowlist", () => {
    // else a plugin declaring its own skills/commands/mcpServers would reject
    // on the unknown-key branch before the component branch ever ran.
    for (const k of ["skills", "commands", "mcpServers"]) {
      expect(ALLOWED_MANIFEST_KEYS.has(k), k).toBe(true);
    }
  });
});
