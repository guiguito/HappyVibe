import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installPluginSkills,
  installPluginCommands,
  findPluginServers,
  pluginOrigin,
  pluginServerEntry,
} from "../src/main/plugins/install";
import { scanPluginDir } from "../src/main/plugins/scan";
import { readSkillDir } from "../src/main/skills/discovery";
import { writeMcpServer, readMcpFile, isMcpServerOff, withoutOffFlag } from "../src/main/mcp";
import { MCP_OFF_PILL } from "../src/renderer/src/components/McpServersSection";

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

  it("rewrites ${CLAUDE_SKILL_DIR} too", () => {
    w(src, "skills/two/SKILL.md", "---\nname: two\ndescription: uses its skill dir\n---\ncat ${CLAUDE_SKILL_DIR}/refs.md\n");
    const scan = scanPluginDir(src);
    const two = scan.skills.find((s) => s.name === "two")!;
    const out = installPluginSkills(scan, { destParent: dest, skillDirs: [two.dir] });
    expect(fs.readFileSync(path.join(out[0].dir, "SKILL.md"), "utf8")).toContain(`cat ${out[0].dir}/refs.md`);
    expect(out[0].substituted).toBe(1);
  });

  it("the folder/Git import route rewrites through the same function, before it hashes", () => {
    // ipc.ts `hv:skills-import-select` copies with cpSync; without the rewrite a
    // ${CLAUDE_SKILL_DIR} skill imported that way pointed at nothing, silently.
    const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");
    const i = ipc.indexOf('"hv:skills-import-select"');
    const body = ipc.slice(i, ipc.indexOf("\n  );", i));
    const copy = body.indexOf("fs.cpSync(srcDir, dest");
    const rewrite = body.indexOf("rewriteSkillRoots(dest)");
    const read = body.indexOf("readSkillDir(dest");
    expect(copy).toBeGreaterThan(0);
    expect(rewrite).toBeGreaterThan(copy);
    expect(read).toBeGreaterThan(rewrite);
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

describe("docs-round #25: a plugin's MCP servers arrive switched off", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const between = (src: string, a: string, b: string): string => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i);
    expect(i, a).toBeGreaterThan(-1);
    expect(j, b).toBeGreaterThan(i);
    return src.slice(i, j);
  };

  it("the entry the install writes is off (Pi's enabled:false), attributed, and carries no auth key", () => {
    const e = pluginServerEntry({ url: "https://mcp.miro.com/", headers: { "X-AI-Source": "claude-code-plugin" } }, "miro", "official");
    expect(e.enabled).toBe(false);
    expect(isMcpServerOff(e)).toBe(true);
    expect(e.origin).toEqual({ plugin: "miro", marketplace: "official" });
    // §13 (2026-10-05): Pi rejects a non-object `auth` and skips the whole entry; it starts
    // OAuth on a 401 whenever there is no Authorization header, so no hint is needed.
    expect(e).not.toHaveProperty("auth");
  });

  it("a plugin that ships disabled:false still arrives off", () => {
    expect(pluginServerEntry({ command: "npx", args: ["x"], enabled: true }, "p", "m").enabled).toBe(false);
  });

  it("the flag survives mcp.json, and withoutOffFlag turns it on without touching the rest", () => {
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "s", pluginServerEntry({ command: "npx", args: ["x"] }, "demo", "official"));
    const cfg = readMcpFile(f).mcpServers.s;
    expect(isMcpServerOff(cfg)).toBe(true);
    const on = withoutOffFlag(cfg);
    expect("enabled" in on).toBe(false);
    expect(on).toMatchObject({ command: "npx", args: ["x"], origin: { plugin: "demo", marketplace: "official" } });
    expect(isMcpServerOff(on)).toBe(false);
    expect(findPluginServers(f, "demo")).toEqual(["s"]); // Remove still finds it
  });

  it("main: install writes the off entry and restarts nothing; Connect is the switch; probes skip off servers", () => {
    const ipc = read("src/main/ipc.ts");
    const install = between(ipc, '"hv:plugins-install"', 'ipcMain.handle("hv:plugins-installed"');
    expect(install).toMatch(/pluginServerEntry\(cfg, scan\.name, marketplaceId\), \{ failIfExists: true \}/); // Review Focus 2: a reinstall never rewrites (so never re-disables) a server you already connected
    expect(install).not.toMatch(/scheduleMcpReload\(/);
    const flow = between(ipc, '"hv:mcp-connect-flow"', 'ipcMain.handle("hv:mcp-status"');
    expect(flow).toMatch(/if \(result\.state === "connected"\) \{/);
    expect(flow).toMatch(/if \(now && isMcpServerOff\(now\)\) \{\s*writeMcpServer\(file, name, withoutOffFlag\(now\)\);\s*scheduleMcpReload\(scope, workspaceId\);/);
    expect(between(ipc, "const checkServer = async", "// Startup connectivity sweep")).toMatch(/if \(!cfg \|\| isMcpServerOff\(cfg\)\) \{/);
    expect(between(ipc, "const httpByName", "const wanted").match(/isMcpServerOff\(cfg\)/g)).toHaveLength(2);
  });

  it("cleanup C5: a failed Connect on an off server leaves no status, Log out hides on off, saving an off server reloads nothing", () => {
    const ipc = read("src/main/ipc.ts");
    const flow = between(ipc, '"hv:mcp-connect-flow"', 'ipcMain.handle("hv:mcp-status"');
    expect(flow).toMatch(/mcpStatusMap\.delete\(statusKey\(scope, workspaceId, name\)\);\s*mcpStatusChanged\(\);/);
    const set = between(ipc, '"hv:mcp-set-server"', '"hv:mcp-install-catalog"');
    expect(set).toMatch(/if \(!\(cfg && isMcpServerOff\(cfg\) && \(isNew \|\| wasOff\)\)\) scheduleMcpReload\(scope, workspaceId\);/);
    const src = read("src/renderer/src/components/McpServersSection.tsx");
    expect(src).toMatch(/\{!off && status\?\.state === "connected" && isHttp && \(/);
  });

  it("the MCP page shows an off server as off, with Connect in place of Reconnect and no Authenticate", () => {
    expect(MCP_OFF_PILL.label).toBe("off");
    expect(MCP_OFF_PILL.title).toBe("Installed by a plugin and switched off. Sessions can't use it until you click Connect.");
    const src = read("src/renderer/src/components/McpServersSection.tsx");
    expect(src).toMatch(/const off = s\.cfg\.enabled === false;/);
    expect(src).toMatch(/status=\{status\}\s*off=\{off\}/);
    expect(src).toMatch(/onClick=\{\(\) => \(off \? authenticate\(s\.scope, s\.name, "connect"\) : reconnect\(s\)\)\}/);
    expect(src).toMatch(/\{off \? "Connect" : "Reconnect"\}/);
    expect(src).toMatch(/\{!off && status\?\.state === "needs-auth" && \(/);
    expect(src).toMatch(/via === "connect" \? window\.hv\.mcpConnectFlow : window\.hv\.mcpAuthenticate/);
    // Edit keeps it off, and saving an off server does not sign in behind the row's back.
    expect(src).toMatch(/\.\.\.\(cfg\.enabled === false \? \{ enabled: false \} : \{\}\),/);
    expect(src).toMatch(/onSaved\(scope, name, kind === "http" && cfg\.enabled !== false\);/);
  });

  it("the install dialog still tells the truth about servers", () => {
    const src = read("src/renderer/src/components/PluginsSection.tsx");
    expect(src).not.toContain("but NOT connected");
    expect(src).toContain("Added to your global mcp.json, switched off: sessions can't use them until you click Connect, here once installed or on the MCP page. Removed with the plugin.");
    expect(src).toMatch(/MCP servers arrive unconnected<\/strong> — so nothing the agent can do changes yet/);
  });
});
