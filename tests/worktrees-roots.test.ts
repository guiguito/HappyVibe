import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §29 worktrees — ONE admission list.
 *
 * Every fs entry point that takes a SESSION's workspaceId or a renderer-supplied
 * path admits `roots()` (registered workspaces ∪ discovered worktrees). A call
 * still handed the bare registry list refuses every file read, file save, plan
 * write and terminal in a worktree as "Unknown workspace" — the whole feature
 * dead, with one error string to debug it by.
 *
 * Config reads go the other way: they stay on the registry and route a worktree
 * through `projectOf`, because a worktree has no settings of its own.
 *
 * A source scan rather than a behavioural test on purpose: the failure mode is a
 * NEW call site written months from now that re-spells the check, and no runtime
 * test can fail for a line nobody added yet.
 */
const FS_FNS = [
  "resolveInWorkspace",
  "listDir",
  "listRecursive",
  "readWorkspaceFile",
  "writeWorkspaceFile",
  "statMtime",
  "statDetails",
  "createFile",
  "createDir",
  "moveEntry",
  "importEntries",
  "listPlanProgress",
  "readAgentsMd",
  "writeAgentsMd",
  "writeAgentsMdFiles",
  "hasClaudeMd",
  "copyClaudeMdToAgentsMd",
  "writePlanFile",
  "readPlan",
  "setPlanStatus",
  "buildMentionBlocks",
];

const src = fs.readFileSync(path.join(__dirname, "../src/main/ipc.ts"), "utf8");

describe("ipc.ts admits worktree roots at every fs entry point", () => {
  it("no fs helper is handed the bare registry list", () => {
    const re = new RegExp(`\\b(${FS_FNS.join("|")})\\(\\s*workspaces\\.list\\(\\)`, "g");
    expect(src.match(re) ?? []).toEqual([]);
  });

  it("snapshot restores and the terminal admit roots()", () => {
    expect(src).toMatch(/snapshotDir\(\), sessionId, roots\(\)/);
    expect(src).toMatch(/roots\(\)\.find\(\(p\) => normPath\(p\) === normPath\(String\(ws\)\)\)/);
  });

  it("config reads stay on the registry, routed through projectOf", () => {
    expect(src).toMatch(/workspaces\.getModel\(project\)/);
    expect(src).toMatch(/resolveBypass\(project/);
    expect(src).toMatch(/const project = workspace \? worktrees\.projectOf\(workspace\) : undefined/);
  });

  it("the composer's model getter routes too, so main and the renderer agree", () => {
    // CLAUDE.md's standing rule: spawnOpts and the renderer's resolveModel
    // resolve the same tiers or neither. ChatView reads this handler with the
    // SESSION's root, so unrouted it showed the global default for a worktree
    // that main was about to spawn on the project's override.
    expect(src).toMatch(/hv:get-workspace-model[\s\S]{0,60}workspaces\.getModel\(worktrees\.projectOf\(workspaceId\)\)/);
    // The setter must NOT route — a worktree has no settings page, and a silent
    // no-op beats silently editing the project's model.
    expect(src).toMatch(/hv:set-workspace-model[\s\S]{0,120}workspaces\.setModel\(workspaceId/);
  });

  it("the boot read DISCOVERS — a cold cache would prune every worktree's tabs", () => {
    // The renderer builds the layout's alive set from this handler's answer at
    // boot, before any git-status has run. Returning the cache there answered
    // {} and every tab open in a worktree vanished on restart (GUI pass).
    expect(src).toMatch(/hv:worktree-list"[\s\S]{0,200}?await Promise\.all\(workspaces\.list\(\)\.map\(\(w\) => refreshWorktrees\(w\)\)\)/);
  });

  it("the discovery push only ever fires for a registered parent", () => {
    // refreshWorktrees is the ONE writer of the index. A worktree is not a
    // parent, and letting one in would nest rows under rows.
    expect(src).toMatch(/const refreshWorktrees[\s\S]{0,400}?workspaces\.list\(\)\.some/);
  });
});
