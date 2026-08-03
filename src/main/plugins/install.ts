import fs from "node:fs";
import path from "node:path";
import { readSkillDir, type DiscoveredSkill } from "../skills/discovery";
import { substitutePluginRoot } from "./screen";
import { readMcpFile } from "../mcp";
import type { PluginScan } from "./scan";

/**
 * §25 plugin install/remove — the impure half. Electron-free so it is testable
 * against a temp dir; the caller owns the download and the registries.
 *
 * Confinement is the first thing every writer does (the `ipc.ts` skills-import
 * pattern): a destination is resolved and asserted to be inside the parent we
 * were given, so a crafted plugin name or subdir cannot write outside it.
 */

/** The link that lets `remove` find a plugin's components later (§25). */
export interface PluginOrigin {
  plugin: string;
  marketplace: string;
}

export function pluginOrigin(plugin: string, marketplace: string): PluginOrigin {
  return { plugin, marketplace };
}

/** Files whose text we rewrite for ${CLAUDE_PLUGIN_ROOT}. Binary is left alone. */
const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".sh", ".bash", ".zsh", ".py", ".rb", ".pl",
  ".js", ".mjs", ".cjs", ".ts", ".json", ".yaml", ".yml", ".toml",
]);

/** Resolve `child` under `parent`, throwing unless it stays inside. */
function confine(parent: string, child: string): string {
  const p = path.resolve(parent);
  const c = path.resolve(p, child);
  if (c !== p && !c.startsWith(p + path.sep)) {
    throw new Error(`refusing to write outside ${p}: ${c}`);
  }
  return c;
}

/**
 * Rewrite ${CLAUDE_PLUGIN_ROOT} throughout an installed skill dir, in place.
 * @returns how many refs were replaced, for the disclosure.
 */
function rewritePluginRoot(dir: string): number {
  let count = 0;
  const walk = (abs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        walk(child);
        continue;
      }
      if (!e.isFile() || !TEXT_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      let text: string;
      try {
        text = fs.readFileSync(child, "utf8");
      } catch {
        continue;
      }
      const next = substitutePluginRoot(text, dir);
      if (next !== text) {
        // Count refs by the delta in occurrences, not by re-scanning `next`.
        count += (text.match(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g) ?? []).length;
        fs.writeFileSync(child, next);
      }
    }
  };
  walk(dir);
  return count;
}

export interface InstalledSkill {
  /** Absolute installed dir — the `--skill` arg and the approval key. */
  dir: string;
  /** Re-read AFTER substitution, so `hash` covers the bytes the user approves. */
  skill: DiscoveredSkill;
  substituted: number;
}

export interface InstallSkillsOpts {
  destParent: string;
  /** Which scanned skill dirs to install. */
  skillDirs: string[];
  /** "workspace" installs read back as workspace-sourced. */
  source?: "managed" | "workspace";
}

/**
 * Copy the chosen skills into `destParent`, rewrite their plugin-root refs, and
 * re-read each so the returned hash is of the SUBSTITUTED content. A skill whose
 * screen verdict is "reject" is refused — it cannot work and it fails silently,
 * which is the whole reason the screen exists.
 */
export function installPluginSkills(scan: PluginScan, opts: InstallSkillsOpts): InstalledSkill[] {
  fs.mkdirSync(opts.destParent, { recursive: true });
  const out: InstalledSkill[] = [];
  for (const wanted of opts.skillDirs) {
    const scanned = scan.skills.find((s) => s.dir === wanted);
    if (!scanned) throw new Error(`not part of this plugin scan: ${wanted}`);
    if (scanned.screen.verdict === "reject") {
      throw new Error(`refusing to install "${scanned.name}": ${scanned.screen.reason}`);
    }
    const dest = confine(opts.destParent, path.basename(wanted));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(wanted, dest, { recursive: true });
    const substituted = rewritePluginRoot(dest);
    out.push({ dir: dest, skill: readSkillDir(dest, opts.source ?? "managed"), substituted });
  }
  return out;
}

export interface InstallCommandsOpts {
  destDir: string;
  /** Which scanned top-level command files to install. */
  files: string[];
}

/**
 * Copy the chosen top-level command files into `destDir`.
 *
 * Refuses rather than overwrites: the prompt-template namespace is FLAT (a
 * template's name is its basename — Pi reads no frontmatter `name`), so two
 * plugins shipping `commands/review.md` collide, and so does a plugin colliding
 * with a file the user wrote. Silently replacing either would be the worst
 * outcome of the three.
 *
 * @returns the installed template names.
 */
export function installPluginCommands(scan: PluginScan, opts: InstallCommandsOpts): string[] {
  fs.mkdirSync(opts.destDir, { recursive: true });
  const names: string[] = [];
  // Check every collision BEFORE writing anything, so a refusal is not a half
  // install.
  const planned = opts.files.map((f) => {
    const scanned = scan.commands.find((c) => c.file === f);
    if (!scanned) throw new Error(`not part of this plugin scan: ${f}`);
    const dest = confine(opts.destDir, `${scanned.name}.md`);
    if (fs.existsSync(dest)) {
      throw new Error(`a prompt named "${scanned.name}" already exists — rename or remove it first`);
    }
    return { src: f, dest, name: scanned.name };
  });
  const seen = new Set<string>();
  for (const p of planned) {
    if (seen.has(p.name)) throw new Error(`two commands named "${p.name}" in this plugin`);
    seen.add(p.name);
  }
  for (const p of planned) {
    fs.copyFileSync(p.src, p.dest);
    names.push(p.name);
  }
  return names;
}

/** Server names in `file` whose `origin.plugin` matches — what removal deletes. */
export function findPluginServers(file: string, plugin: string): string[] {
  const servers = readMcpFile(file).mcpServers;
  return Object.entries(servers)
    .filter(([, cfg]) => {
      const origin = (cfg as { origin?: unknown }).origin;
      return !!origin && typeof origin === "object" && (origin as PluginOrigin).plugin === plugin;
    })
    .map(([name]) => name)
    .sort();
}
