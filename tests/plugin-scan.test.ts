import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanPluginDir, readPluginManifest } from "../src/main/plugins/scan";

let root: string;
const w = (rel: string, body: string): void => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plugin-"));
  w(".claude-plugin/plugin.json", JSON.stringify({ name: "demo", description: "a demo plugin", author: {}, category: "dev" }));
  w("skills/good/SKILL.md", "---\nname: good\ndescription: a good skill\n---\nBody using ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh\n");
  w("skills/bad/SKILL.md", "---\nname: bad\ndescription: hardcoded paths\n---\ncat ~/.claude/skills/bad/notes.md 2>/dev/null || true\n");
  w("skills/nodesc/SKILL.md", "---\nname: nodesc\n---\nPi will not load this.\n");
  w("commands/review.md", "---\ndescription: review it\n---\nReview $ARGUMENTS\n");
  w("commands/plain.md", "Just a body, no frontmatter at all\n");
  w("commands/git/commit.md", "---\ndescription: nested\n---\nnope\n");
  w("commands/git/deep/er.md", "---\ndescription: deeper\n---\nnope\n");
  w(".mcp.json", JSON.stringify({ mcpServers: { demo: { url: "https://example.com/mcp" } } }));
  w("hooks/hooks.json", JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "echo a" }, { type: "command", command: "echo b" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo c" }] }],
    },
  }));
  w("scripts/payload.sh", "#!/bin/sh\necho payload\n");
  w("core/lib.js", "module.exports = {};\n");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("scanPluginDir", () => {
  it("reads the manifest identity", () => {
    const s = scanPluginDir(root);
    expect(s.name).toBe("demo");
    expect(s.description).toBe("a demo plugin");
  });

  it("rejects on hooks found in the tree", () => {
    const s = scanPluginDir(root);
    expect(s.verdict.accepted).toBe(false);
    expect(s.verdict.rejected).toEqual(["hooks"]);
    // the installable part is still reported — "installing 3 of 14"
    expect(s.verdict.components).toEqual(["commands", "mcpServers", "skills"]);
  });

  it("finds loadable skills and screens each one", () => {
    const s = scanPluginDir(root);
    const good = s.skills.find((k) => k.name === "good")!;
    const bad = s.skills.find((k) => k.name === "bad")!;
    expect(good.screen.verdict).toBe("ok");
    expect(good.pluginRootRefs).toBe(1);
    expect(bad.screen.verdict).toBe("reject");
  });

  it("drops a skill Pi would not load at all", () => {
    // no description ⇒ Pi refuses it; offering it would be a lie
    expect(scanPluginDir(root).skills.map((k) => k.name)).not.toContain("nodesc");
  });

  it("takes top-level commands only and counts the nested ones", () => {
    const s = scanPluginDir(root);
    expect(s.commands.map((c) => c.name).sort()).toEqual(["plain", "review"]);
    expect(s.nestedCommands).toEqual(["git/commit.md", "git/deep/er.md"]);
  });

  it("reads a command description, with Pi's first-body-line fallback", () => {
    const s = scanPluginDir(root);
    expect(s.commands.find((c) => c.name === "review")!.description).toBe("review it");
    expect(s.commands.find((c) => c.name === "plain")!.description).toBe("Just a body, no frontmatter at all");
  });

  it("reads .mcp.json servers", () => {
    expect(Object.keys(scanPluginDir(root).mcpServers)).toEqual(["demo"]);
  });

  it("counts dropped hook COMMANDS, not hook files", () => {
    // 3 commands across 2 events — the number the banner should show.
    expect(scanPluginDir(root).dropped).toMatchObject({ hooks: 3 });
  });

  it("discloses nested commands and unusable skills", () => {
    const d = scanPluginDir(root).dropped;
    expect(d["namespaced commands"]).toBe(2);
    expect(d["skills with unusable hardcoded paths"]).toBe(1);
  });

  it("ignores payload directories", () => {
    const s = scanPluginDir(root);
    expect(s.verdict.components).not.toContain("scripts");
    expect(s.verdict.components).not.toContain("core");
    expect(Object.keys(s.dropped)).not.toContain("scripts");
  });
});

describe("scanPluginDir resilience", () => {
  it("scans an empty dir to a verdict instead of throwing", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hv-empty-"));
    const s = scanPluginDir(empty);
    expect(s.verdict.accepted).toBe(false);
    expect(s.verdict.reason).toBe("nothing HappyVibe can install");
    expect(s.skills).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("survives a corrupt manifest", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-bad-"));
    fs.mkdirSync(path.join(d, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(d, ".claude-plugin", "plugin.json"), "{not json");
    fs.mkdirSync(path.join(d, "skills", "a"), { recursive: true });
    fs.writeFileSync(path.join(d, "skills", "a", "SKILL.md"), "---\nname: a\ndescription: d\n---\nb\n");
    expect(readPluginManifest(d)).toBeNull();
    const s = scanPluginDir(d);
    expect(s.verdict.accepted).toBe(true); // classify from the tree alone
    expect(s.name).toBe(path.basename(d)); // falls back to the dir name
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("takes lspServers from the marketplace entry with no download evidence", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lsp-"));
    fs.mkdirSync(path.join(d, "skills", "a"), { recursive: true });
    fs.writeFileSync(path.join(d, "skills", "a", "SKILL.md"), "---\nname: a\ndescription: d\n---\nb\n");
    const s = scanPluginDir(d, ["lspServers"]);
    expect(s.verdict.accepted).toBe(false);
    expect(s.dropped["LSP servers"]).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
