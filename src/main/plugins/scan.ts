import fs from "node:fs";
import path from "node:path";
import { classifyPlugin, type Verdict } from "./classify";
import { countPluginRootRefs, screenSkillText, type ScreenResult } from "./screen";
import { scanSkillsDir } from "../skills/discovery";
import { readMcpFile, type McpServerConfig } from "../mcp";

/**
 * §25 — turn an extracted plugin directory into the components HappyVibe can
 * install, plus the verdict and the disclosure counts. Electron-free so it is
 * unit-testable against a temp dir; the caller owns the download.
 *
 * Every read is wrapped: a corrupt or half-published plugin must scan to a
 * verdict, never throw. A store that crashes on one bad row is worse than one
 * that greys it out with a reason.
 */

export interface ScannedSkill {
  /** Absolute dir inside the extraction — the copy source. */
  dir: string;
  name: string;
  description: string;
  scriptCount: number;
  /** Path screening (§25). A "reject" skill must not be installable. */
  screen: ScreenResult;
  /** How many ${CLAUDE_PLUGIN_ROOT} refs we will rewrite — disclosed, not hidden. */
  pluginRootRefs: number;
}

export interface ScannedCommand {
  /** Absolute .md path inside the extraction. */
  file: string;
  /** Basename minus .md — Pi reads no frontmatter `name`, so this IS the slash name. */
  name: string;
  description: string;
}

export interface PluginScan {
  name: string;
  description: string;
  verdict: Verdict;
  skills: ScannedSkill[];
  /** Top-level commands/*.md only — Pi's template loader is a flat readdir. */
  commands: ScannedCommand[];
  /** Namespaced command paths: counted and disclosed, never installed. */
  nestedCommands: string[];
  mcpServers: Record<string, McpServerConfig>;
  /** Dropped thing ⇢ how many, for the disclosure banner. */
  dropped: Record<string, number>;
}

/** Read `<dir>/.claude-plugin/plugin.json`; null when absent or corrupt. */
export function readPluginManifest(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** First line of frontmatter `description`, else Pi's first-body-line fallback (60 chars). */
function templateDescription(text: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm) {
    const m = /^description\s*:\s*(.*)$/m.exec(fm[1]);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const first = body.split(/\r?\n/).find((l) => l.trim());
  return (first ?? "").trim().slice(0, 60);
}

/** Count the shell commands a hooks.json would have fired — the honest "5 hooks" number. */
function countHookCommands(dir: string): number {
  let file = path.join(dir, "hooks", "hooks.json");
  if (!fs.existsSync(file)) {
    // Some plugins put it at the plugin root.
    file = path.join(dir, "hooks.json");
    if (!fs.existsSync(file)) return 0;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const events = (raw.hooks && typeof raw.hooks === "object" ? raw.hooks : raw) as Record<
      string,
      unknown
    >;
    let n = 0;
    for (const matchers of Object.values(events)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers) {
        const hooks = (m as Record<string, unknown> | null)?.hooks;
        if (Array.isArray(hooks)) n += hooks.length;
        else n += 1; // a bare command entry
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Count entries under a component dir, for the disclosure when it is not hooks. */
function countDirEntries(dir: string): number {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/** Every `.md` beneath a subdirectory of `commands/`, as paths relative to it. */
function nestedMarkdown(commandsDir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), childRel, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(childRel);
    }
  };
  let top: fs.Dirent[];
  try {
    top = fs.readdirSync(commandsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top) {
    if (e.isDirectory() && !e.name.startsWith(".")) {
      walk(path.join(commandsDir, e.name), e.name, 1);
    }
  }
  return out.sort();
}

export function scanPluginDir(dir: string, entryComponents: string[] = []): PluginScan {
  const manifest = readPluginManifest(dir);
  let topLevel: string[] = [];
  try {
    topLevel = fs.readdirSync(dir);
  } catch {
    /* unreadable — classify from the manifest alone */
  }
  const verdict = classifyPlugin({ manifest, topLevel, entryComponents });

  // ── skills ────────────────────────────────────────────────────────────────
  const skills: ScannedSkill[] = [];
  for (const s of scanSkillsDir(path.join(dir, "skills"), "managed")) {
    if (!s.loadable) continue; // Pi would not load it; nothing to offer
    let text = "";
    try {
      text = fs.readFileSync(s.skillMdPath, "utf8");
    } catch {
      /* unreadable — screens as ok, will simply carry no refs */
    }
    skills.push({
      dir: s.id,
      name: s.name,
      description: s.description,
      scriptCount: s.scriptCount,
      screen: screenSkillText(text),
      pluginRootRefs: countPluginRootRefs(text),
    });
  }

  // ── commands (top-level only; Pi's loader is a flat readdir) ──────────────
  const commandsDir = path.join(dir, "commands");
  const commands: ScannedCommand[] = [];
  let cmdEntries: fs.Dirent[] = [];
  try {
    cmdEntries = fs.readdirSync(commandsDir, { withFileTypes: true });
  } catch {
    /* no commands/ */
  }
  for (const e of cmdEntries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    const file = path.join(commandsDir, e.name);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      /* unreadable — still installable, Pi falls back to the first body line */
    }
    commands.push({
      file,
      name: e.name.slice(0, -3),
      description: templateDescription(text),
    });
  }
  const nestedCommands = nestedMarkdown(commandsDir);

  // ── MCP servers (tree AND manifest; the manifest wins a key clash) ────────
  const fromFile = readMcpFile(path.join(dir, ".mcp.json")).mcpServers;
  const declared = manifest?.mcpServers;
  const fromManifest =
    declared && typeof declared === "object" && !Array.isArray(declared)
      ? (declared as Record<string, McpServerConfig>)
      : {};
  const mcpServers: Record<string, McpServerConfig> = { ...fromFile, ...fromManifest };

  // ── disclosure ────────────────────────────────────────────────────────────
  const dropped: Record<string, number> = {};
  for (const r of verdict.rejected) {
    if (r === "hooks") {
      dropped.hooks = countHookCommands(dir) || countDirEntries(path.join(dir, "hooks"));
    } else if (r === "outputStyles") {
      dropped["output styles"] = countDirEntries(path.join(dir, "output-styles"));
    } else if (r === "lspServers") {
      dropped["LSP servers"] = 1;
    } else {
      dropped[r] = countDirEntries(path.join(dir, r)) || 1;
    }
  }
  if (nestedCommands.length > 0) dropped["namespaced commands"] = nestedCommands.length;
  const unscreenable = skills.filter((s) => s.screen.verdict === "reject").length;
  if (unscreenable > 0) dropped["skills with unusable hardcoded paths"] = unscreenable;

  return {
    name: (typeof manifest?.name === "string" && manifest.name) || path.basename(dir),
    description: typeof manifest?.description === "string" ? manifest.description : "",
    verdict,
    skills,
    commands,
    nestedCommands,
    mcpServers,
    dropped,
  };
}
