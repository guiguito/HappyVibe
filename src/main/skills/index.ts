import fs from "node:fs";
import path from "node:path";
import { scanSkillsDir, type DiscoveredSkill } from "./discovery";
import type { SkillProvenance, SkillRegistry } from "./registry";

/**
 * Skill locations + discovery orchestration (PRD §14). Electron-free (takes
 * directories as params) so it stays vitest-importable; ipc.ts supplies
 * agentDir()/piRuntimeDir()/config linkedDirs/workspace paths.
 *
 * Scopes:
 *  - global: managed dir (<agentDir>/skills), bundled (<runtimeDir>/skills), and
 *    linked external dirs (e.g. ~/.claude/skills) — shown on the Skills screen.
 *  - workspace: <workspace>/.agents/skills — shown only in workspace settings.
 */

export * from "./discovery";
export * from "./registry";
export * from "./view";
export * from "./gitImport";
export * from "./remove";

/** HappyVibe-managed global skills live here (copied imports, promoted skills). */
export function managedSkillsDir(agentDir: string): string {
  return path.join(agentDir, "skills");
}
/** Bundled starter skills ship inside the runtime bundle. */
export function bundledSkillsDir(runtimeDir: string): string {
  return path.join(runtimeDir, "skills");
}
/** Project skills for a workspace (the Agent Skills project location Pi also reads). */
export function workspaceSkillsDir(workspacePath: string): string {
  return path.join(workspacePath, ".agents", "skills");
}

/** All global-scope skills: bundled + managed + linked. Bundled/managed ids can't
 *  collide (distinct roots); linked dirs are scanned in place. */
export function discoverGlobal(opts: {
  managedDir: string;
  bundledDir: string;
  linkedDirs: string[];
}): DiscoveredSkill[] {
  return [
    ...scanSkillsDir(opts.bundledDir, "bundled"),
    ...scanSkillsDir(opts.managedDir, "managed"),
    ...opts.linkedDirs.flatMap((d) => scanSkillsDir(d, "linked")),
  ];
}

/** Workspace-scope skills for one workspace. */
export function discoverWorkspace(workspacePath: string): DiscoveredSkill[] {
  return scanSkillsDir(workspaceSkillsDir(workspacePath), "workspace");
}

/**
 * Pre-approve the bundled starter skills at startup (PRD §14): trusted (we
 * vetted them) but enabled=false (OFF by default — one "Enable" turns one on).
 * Idempotent and non-clobbering:
 *  - first sight of a bundled skill → approve enabled=false
 *  - a bundle bump changed its hash → re-approve (still vetted), KEEPING the
 *    user's current on/off so an upgrade never silently re-enables/-disables
 *  - unchanged → skip
 * Provenance (source repo + pinned commit) comes from bundled.json alongside the
 * skills. Never touches user-imported/managed skills.
 */
export function installBundledSkills(bundledDir: string, registry: SkillRegistry, now: string): void {
  let meta: { source?: string; ref?: string; commit?: string } = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(bundledDir, "bundled.json"), "utf8"));
  } catch {
    /* no manifest — provenance stays minimal */
  }
  const provenance: SkillProvenance = { source: "bundled", sourceUrl: meta.source, ref: meta.ref, commitSha: meta.commit };
  for (const skill of scanSkillsDir(bundledDir, "bundled")) {
    if (!skill.loadable) continue;
    const rec = registry.record(skill.id);
    if (!rec) {
      registry.approve(skill, now, { enabled: false, provenance }); // first install: off by default
    } else if (rec.hash !== skill.hash) {
      registry.approve(skill, now, { enabled: rec.enabled, provenance }); // bundle bumped: keep on/off
    }
  }
}

export interface SkillManifestEntry {
  name: string;
  /** Skill directory (the `--skill` arg). */
  dir: string;
  /** Absolute SKILL.md path — the bridge serves this via use_skill and watches for raw reads. */
  skillMdPath: string;
  scope: "global" | "workspace";
  estTokens: { card: number; body: number };
}

export interface SkillManifest {
  skills: SkillManifestEntry[];
}

/**
 * Per-session manifest handed to the bridge via HV_SKILLS_FILE: the skills this
 * session actually spawned with. The bridge uses it for use_skill (name → path),
 * raw-read fallback detection (skillMdPath set), and context-weight lines.
 */
export function buildManifest(
  entries: Array<{ skill: DiscoveredSkill; scope: "global" | "workspace" }>,
): SkillManifest {
  return {
    skills: entries.map(({ skill, scope }) => ({
      name: skill.name,
      dir: skill.id,
      skillMdPath: skill.skillMdPath,
      scope,
      estTokens: skill.estTokens,
    })),
  };
}
