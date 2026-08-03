import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installPluginSkills,
  installPluginCommands,
  findPluginServers,
  pluginOrigin,
} from "../src/main/plugins/install";
import { scanPluginDir } from "../src/main/plugins/scan";
import { readSkillDir } from "../src/main/skills/discovery";
import { writeMcpServer, readMcpFile } from "../src/main/mcp";

let tmp: string, src: string, dest: string;
const w = (base: string, rel: string, body: string): void => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-pi-"));
  src = path.join(tmp, "plugin");
  dest = path.join(tmp, "dest");
  w(src, ".claude-plugin/plugin.json", JSON.stringify({ name: "demo", description: "d", author: {} }));
  w(src, "skills/one/SKILL.md", "---\nname: one\ndescription: uses its own root\n---\nbash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh\n");
  w(src, "skills/one/scripts/x.sh", "cd ${CLAUDE_PLUGIN_ROOT} && echo hi\n");
  w(src, "skills/one/logo.png", "\x89PNG binary");
  w(src, "skills/nope/SKILL.md", "---\nname: nope\ndescription: hardcoded\n---\ncat ~/.claude/skills/nope/x.md\n");
  w(src, "commands/review.md", "---\ndescription: r\n---\nbody\n");
  w(src, "commands/ship.md", "---\ndescription: s\n---\nbody\n");
  fs.mkdirSync(dest, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("installPluginSkills", () => {
  it("copies the skill and rewrites CLAUDE_PLUGIN_ROOT to the installed dir", () => {
    const scan = scanPluginDir(src);
    const one = scan.skills.find((s) => s.name === "one")!;
    const out = installPluginSkills(scan, { destParent: dest, skillDirs: [one.dir] });
    expect(out).toHaveLength(1);
    const installed = out[0].dir;
    expect(fs.readFileSync(path.join(installed, "SKILL.md"), "utf8")).toContain(`bash ${installed}/scripts/x.sh`);
    // …in every text file, not just SKILL.md
    expect(fs.readFileSync(path.join(installed, "scripts", "x.sh"), "utf8")).toContain(`cd ${installed} &&`);
    expect(out[0].substituted).toBe(2);
  });

  it("hashes AFTER substitution, so approval covers what actually runs", () => {
    const scan = scanPluginDir(src);
    const one = scan.skills.find((s) => s.name === "one")!;
    const out = installPluginSkills(scan, { destParent: dest, skillDirs: [one.dir] });
    expect(out[0].skill.hash).toBe(readSkillDir(out[0].dir, "managed").hash);
    expect(out[0].skill.description).toBe("uses its own root");
  });

  it("leaves binary files untouched", () => {
    const scan = scanPluginDir(src);
    const one = scan.skills.find((s) => s.name === "one")!;
    const out = installPluginSkills(scan, { destParent: dest, skillDirs: [one.dir] });
    expect(fs.readFileSync(path.join(out[0].dir, "logo.png"), "utf8")).toBe("\x89PNG binary");
  });

  it("refuses to install a skill that failed the path screen", () => {
    // It would install, run, and fail silently — the exact outcome §25 exists
    // to prevent.
    const scan = scanPluginDir(src);
    const nope = scan.skills.find((s) => s.name === "nope")!;
    expect(() => installPluginSkills(scan, { destParent: dest, skillDirs: [nope.dir] })).toThrow(/hardcodes/);
  });

  it("refuses a dir that is not part of this scan", () => {
    const scan = scanPluginDir(src);
    expect(() => installPluginSkills(scan, { destParent: dest, skillDirs: ["/etc"] })).toThrow(/not part of/);
  });

  it("confines the write to the destination parent", () => {
    // The destination is basename(scanned dir), and basename() already strips
    // "a/../b" — so the case that actually reaches the guard is a path whose
    // basename IS "..", which resolves to dest's PARENT.
    const scan = scanPluginDir(src);
    const one = scan.skills.find((s) => s.name === "one")!;
    const dotdot = { ...one, dir: `${one.dir}${path.sep}..` };
    expect(path.basename(dotdot.dir)).toBe("..");
    expect(() =>
      installPluginSkills({ ...scan, skills: [dotdot] }, { destParent: dest, skillDirs: [dotdot.dir] }),
    ).toThrow(/refusing to write outside/);
    // and nothing was created next to dest
    expect(fs.existsSync(path.join(tmp, "one"))).toBe(false);
  });
});

describe("installPluginCommands", () => {
  it("copies top-level commands under their slash names", () => {
    const scan = scanPluginDir(src);
    const names = installPluginCommands(scan, { destDir: dest, files: scan.commands.map((c) => c.file) });
    expect(names.sort()).toEqual(["review", "ship"]);
    expect(fs.existsSync(path.join(dest, "review.md"))).toBe(true);
  });

  it("refuses a name already on disk rather than overwriting", () => {
    // The prompt-template namespace is flat, so this is a real collision — and
    // the file it would clobber may be one the user wrote.
    fs.writeFileSync(path.join(dest, "review.md"), "mine");
    const scan = scanPluginDir(src);
    expect(() => installPluginCommands(scan, { destDir: dest, files: scan.commands.map((c) => c.file) })).toThrow(/review/);
    expect(fs.readFileSync(path.join(dest, "review.md"), "utf8")).toBe("mine");
  });

  it("refuses BEFORE writing anything, so a collision is not a half install", () => {
    fs.writeFileSync(path.join(dest, "ship.md"), "mine");
    const scan = scanPluginDir(src);
    expect(() => installPluginCommands(scan, { destDir: dest, files: scan.commands.map((c) => c.file) })).toThrow();
    // review.md sorts first but must NOT have landed
    expect(fs.existsSync(path.join(dest, "review.md"))).toBe(false);
  });

  it("refuses a file that is not part of this scan", () => {
    const scan = scanPluginDir(src);
    expect(() => installPluginCommands(scan, { destDir: dest, files: ["/etc/passwd"] })).toThrow(/not part of/);
  });
});

describe("the origin link", () => {
  it("finds a plugin's servers for removal and leaves hand-added ones alone", () => {
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "fromplugin", { url: "https://a", origin: pluginOrigin("demo", "official") });
    writeMcpServer(f, "byhand", { url: "https://b" });
    writeMcpServer(f, "otherplugin", { url: "https://c", origin: pluginOrigin("other", "official") });
    expect(findPluginServers(f, "demo")).toEqual(["fromplugin"]);
  });

  it("survives the mcp.json round-trip — unknown keys are preserved", () => {
    // This is what makes removal possible without a fourth store.
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "s", { url: "https://a", origin: pluginOrigin("demo", "official") });
    writeMcpServer(f, "t", { url: "https://b" });
    expect(readMcpFile(f).mcpServers.s.origin).toMatchObject({ plugin: "demo", marketplace: "official" });
  });

  it("is empty for a file with no plugin servers", () => {
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "byhand", { url: "https://b" });
    expect(findPluginServers(f, "demo")).toEqual([]);
    expect(findPluginServers(path.join(tmp, "absent.json"), "demo")).toEqual([]);
  });
});
