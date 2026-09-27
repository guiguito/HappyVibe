import fs from "node:fs";
import path from "node:path";
import { scanPromptTemplatesDir, type DiscoveredPromptTemplate } from "./discovery";
import type { PromptTemplateProvenance, PromptTemplateRegistry } from "./registry";

/**
 * Command locations + discovery orchestration (PRD §24), a near-clone of
 * skills/index.ts. Electron-free (takes directories as params) so it stays
 * vitest-importable; ipc.ts supplies agentDir()/piRuntimeDir()/config
 * linkedDirs/workspace paths.
 *
 * Scopes:
 *  - global: managed dir (<agentDir>/prompts), bundled (<runtimeDir>/prompts),
 *    and linked external dirs (e.g. ~/.claude/commands) — shown on the Commands
 *    screen.
 *  - workspace: TWO roots — <workspace>/.agents/prompts (ours) and
 *    <workspace>/.claude/commands (Claude Code's) — shown only in workspace
 *    settings, each with its own source badge.
 *
 * `.claude/commands` is read IN PLACE and never copied (PRD §24): it is
 * typically git-tracked and team-owned, so importing it into .agents/prompts
 * would yield two files that drift apart on the next git pull. HappyVibe writes
 * to .agents/prompts only for commands it creates or imports itself.
 *
 * There is no manifest here (cf. skills' buildManifest): Pi expands templates
 * itself, so the bridge is handed nothing about commands and the resting context
 * cost is zero.
 */

export * from "./discovery";
export * from "./registry";
export * from "./view";
export * from "./remove";
// gitImport is source-agnostic (clone → pick a subtree), so §14's is reused as-is.
export * from "../skills/gitImport";

/** HappyVibe-managed global commands live here (copied imports, promoted commands). */
export function managedPromptTemplatesDir(agentDir: string): string {
  return path.join(agentDir, "prompts");
}
/** Bundled starter commands ship inside the runtime bundle. */
export function bundledPromptTemplatesDir(runtimeDir: string): string {
  return path.join(runtimeDir, "prompts");
}
/** Project commands a workspace owns, written by HappyVibe. */
export function workspacePromptTemplatesDir(workspacePath: string): string {
  return path.join(workspacePath, ".agents", "prompts");
}

/** All global-scope commands: bundled + managed + linked. Bundled/managed ids
 *  can't collide (distinct roots); linked dirs are scanned in place. */
export function discoverGlobalPromptTemplates(opts: {
  managedDir: string;
  bundledDir: string;
  linkedDirs: string[];
}): DiscoveredPromptTemplate[] {
  return [
    ...scanPromptTemplatesDir(opts.bundledDir, "bundled"),
    ...scanPromptTemplatesDir(opts.managedDir, "managed"),
    ...opts.linkedDirs.flatMap((d) => scanPromptTemplatesDir(d, "linked")),
  ];
}

/** Workspace-scope commands for one workspace, from both roots. */
export function discoverWorkspacePromptTemplates(workspacePath: string): DiscoveredPromptTemplate[] {
  return [
    ...scanPromptTemplatesDir(workspacePromptTemplatesDir(workspacePath), "workspace"),
  ];
}

/**
 * Pre-approve the bundled starter commands at startup (PRD §24, port of
 * installBundledSkills): trusted (we vetted them) and enabled=true (ON by
 * default since 2026-09-27 — one "Disable" turns one off). Idempotent and non-clobbering:
 *  - first sight of a bundled command → approve enabled=true
 *  - a bundle bump changed its hash → re-approve (still vetted), KEEPING the
 *    user's current on/off so an upgrade never silently re-enables/-disables
 *    (which is also why only items NEW to the bundle arrive ON: an old-default
 *    OFF record cannot be told apart from a user's choice)
 *  - unchanged → skip
 * Provenance (source repo + pinned commit) comes from bundled.json alongside the
 * commands. Never touches user-imported/managed commands. Unlike skills there is
 * no `loadable` filter to apply: Pi loads every readable .md.
 */
export function installBundledPromptTemplates(bundledDir: string, registry: PromptTemplateRegistry, now: string): void {
  // Top-level fields are defaults; `items[]` overrides them per item, because the
  // bundle spans several upstream repos (PRD §14, 2026-09-27).
  type Origin = { source?: string; ref?: string; commit?: string };
  let meta: Origin & { items?: Array<Origin & { name: string }> } = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(bundledDir, "bundled.json"), "utf8"));
  } catch {
    /* no manifest — provenance stays minimal */
  }
  const provenanceOf = (name: string): PromptTemplateProvenance => {
    const item = meta.items?.find((i) => i.name === name);
    return { source: "bundled", sourceUrl: item?.source ?? meta.source, ref: item?.ref ?? meta.ref, commitSha: item?.commit ?? meta.commit };
  };
  for (const cmd of scanPromptTemplatesDir(bundledDir, "bundled")) {
    const rec = registry.record(cmd.id);
    if (!rec) {
      registry.approve(cmd, now, { enabled: true, provenance: provenanceOf(cmd.name) }); // first install: ON (PRD §14, 2026-09-27)
    } else if (rec.hash !== cmd.hash) {
      registry.approve(cmd, now, { enabled: rec.enabled, provenance: provenanceOf(cmd.name) }); // bundle bumped: keep on/off
    }
  }
}
