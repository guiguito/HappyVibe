import path from "node:path";
import { scanSkillsDir, type DiscoveredSkill } from "./discovery";

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
