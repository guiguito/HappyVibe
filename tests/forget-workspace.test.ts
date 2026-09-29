import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * docs-round #26/#27 — Forget workspace. ipc.ts is not vitest-importable (it
 * reaches electron), so the handler is pinned as a source scan, the
 * worktrees-roots.test.ts pattern.
 */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const ipc = read("src/main/ipc.ts");
const handler = ipc.slice(
  ipc.indexOf('ipcMain.handle("hv:remove-workspace"'),
  ipc.indexOf('ipcMain.handle("hv:workspace-session-count"'),
);
const doc = ipc.slice(ipc.indexOf("Round 11: removal is a confirmed choice"), ipc.indexOf('ipcMain.handle("hv:remove-workspace"'));

describe("docs-round #26: forgetting a workspace stops its agents", () => {
  it("every affected session's agent is ended BEFORE either outcome runs", () => {
    const loop = handler.slice(handler.indexOf("for (const s of affected)"));
    const stop = loop.indexOf("if (manager.get(s.id)) await endSession(s.id);");
    const branch = loop.indexOf('if (mode === "delete") {');
    expect(stop).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(0);
    expect(stop).toBeLessThan(branch);
    // …and once: the delete branch no longer needs its own copy.
    expect(loop.split("await endSession(s.id)").length - 1).toBe(1);
  });
});

describe("docs-round #27: forgetting writes nothing to the sessions", () => {
  it("no archive flag is set, so re-adding the folder restores them as they were", () => {
    expect(handler).not.toMatch(/archived: true/);
    expect(handler).not.toMatch(/else if \(!s\.archived\)/);
  });

  it("the handler's doc comment no longer promises an archive", () => {
    expect(doc).not.toContain("forget — archive its sessions");
    expect(doc).toContain("re-adding");
  });

  it("the settings copy says what forget does now", () => {
    const ws = read("src/renderer/src/components/WorkspaceSettingsView.tsx");
    expect(ws).not.toMatch(/and archives its|will be archived/);
    expect(ws).toContain("adding the folder again brings its sessions back as they were.");
  });

  it("Show archived counts only sessions the sidebar can show", () => {
    const sb = read("src/renderer/src/components/Sidebar.tsx");
    expect(sb).not.toContain("const archivedCount = sessions.filter((s) => s.archived).length;");
    expect(sb).toContain(
      "const listed = new Set(workspaces.flatMap((ws) => [ws, ...(worktrees?.[ws] ?? []).map((w) => w.path)]));",
    );
    expect(sb).toContain("const archivedCount = sessions.filter((s) => s.archived && listed.has(s.workspaceId)).length;");
  });
});
