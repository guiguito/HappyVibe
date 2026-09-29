import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolveBypass } from "../src/main/bypass";

/** Round 3 #14 — persistent bypass precedence: workspace ?? global ?? off. */
describe("resolveBypass precedence (#14)", () => {
  test("unset workspace inherits global", () => {
    expect(resolveBypass(false, null)).toBe(false);
    expect(resolveBypass(true, null)).toBe(true);
    expect(resolveBypass(false, undefined)).toBe(false);
    expect(resolveBypass(true, undefined)).toBe(true);
  });

  test("workspace overrides global in both directions", () => {
    expect(resolveBypass(false, true)).toBe(true); // ws turns it ON despite global off
    expect(resolveBypass(true, false)).toBe(false); // ws turns it OFF despite global on
  });
});

describe("docs round #2: the bypass switches reach open sessions, and the copy says so", () => {
  test("a workspace switch reaches that project's open sessions, worktree sessions included", () => {
    const ipc = readFileSync("src/main/ipc.ts", "utf8");
    const at = ipc.indexOf('ipcMain.handle("hv:set-workspace-bypass"');
    expect(at).toBeGreaterThan(0);
    const handler = ipc.slice(at, at + 500);
    expect(handler).toContain('if (worktrees.projectOf(index.get(id)?.workspaceId ?? "") === workspace) applyBypassLive(id);');
  });

  test("the workspace hint says it applies to open sessions too", () => {
    const view = readFileSync("src/renderer/src/components/WorkspaceSettingsView.tsx", "utf8");
    // Scoped to the bypass hint: the model picker's own "Applies to new or restarted sessions." (:86) is true.
    expect(view).not.toMatch(/banner shows in each session\)\. Applies to new or restarted sessions\./);
    expect(view).toContain("banner shows in each session). Applies to open sessions at once, and to every session you start.");
  });

  test("the global switch reads a worktree session's override from its project, like the workspace switch", () => {
    const ipc = readFileSync("src/main/ipc.ts", "utf8");
    const at = ipc.indexOf('ipcMain.handle("hv:set-global-bypass"');
    expect(at).toBeGreaterThan(0);
    const handler = ipc.slice(at, at + 600);
    expect(handler).toContain("getWorkspaceBypass(worktrees.projectOf(ws)) === null");
  });

  test("a session spawned with HV_BYPASS=1 seeds the analytics state, so its Turn off click counts", () => {
    const ipc = readFileSync("src/main/ipc.ts", "utf8");
    expect(ipc).toContain("if (sessionId) sessionBypass.set(sessionId, bypass);");
    expect(ipc).toContain("const bypass = resolveBypass(project ?? null);");
    // and a live toggle keeps it current, so the next click is measured against what the session runs
    const at = ipc.indexOf("const applyBypassLive");
    expect(ipc.slice(at, at + 700)).toContain("sessionBypass.set(id, on);");
  });
});
