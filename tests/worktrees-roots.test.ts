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

  it("the discovery push only ever fires for a registered parent", () => {
    // refreshWorktrees is the ONE writer of the index. A worktree is not a
    // parent, and letting one in would nest rows under rows.
    expect(src).toMatch(/const refreshWorktrees[\s\S]{0,400}?workspaces\.list\(\)\.some/);
  });
});
