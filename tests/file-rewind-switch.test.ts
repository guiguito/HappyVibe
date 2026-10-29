import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluate, EMPTY_RULES } from "../pi-runtime/extensions/hv-rules";
import { childDecision } from "../pi-runtime/extensions/hv-child-rules";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { RELOAD_NOTICE } from "../src/renderer/src/reloadNotice";

/**
 * §9: the switch that turns off Rewind's copy of the files — globally (Settings ›
 * Permissions › Rewind) or for one workspace (its settings). Two things follow from
 * "off", and both are pinned here:
 *   1. nothing is copied — the captures are skipped (the expensive part, on a folder
 *      too large to copy or kept in the cloud);
 *   2. an edit inside the workspace stops being a safe default. Round 29 lets
 *      write/edit run without asking only BECAUSE Rewind can undo them; with no copy
 *      it cannot, so the edit asks like any other call.
 */

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-file-rewind-"));
  vi.resetModules();
});
const readCfg = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"));

describe("the setting — global default, per-workspace override (the bypass shape)", () => {
  test("on unless turned off; a workspace override wins; null inherits", async () => {
    const c = await import("../src/main/config");
    expect(c.getGlobalFileRewind()).toBe(true);
    expect(c.resolveFileRewind("/ws")).toBe(true);
    c.setGlobalFileRewind(false);
    expect(readCfg().fileRewindOff).toBe(true);
    expect(c.resolveFileRewind("/ws")).toBe(false);
    c.setWorkspaceFileRewind("/ws", true);
    expect(c.resolveFileRewind("/ws")).toBe(true);
    expect(c.resolveFileRewind("/other")).toBe(false);
    c.setWorkspaceFileRewind("/ws", null);
    expect(c.getWorkspaceFileRewind("/ws")).toBeNull();
    expect(readCfg().workspaceFileRewind).toBeUndefined();
    c.setGlobalFileRewind(true);
    expect(readCfg().fileRewindOff).toBeUndefined(); // only a negative is ever stored
  });
});

describe("off: an edit inside the workspace asks", () => {
  const ev = (tool: string, input: Record<string, unknown>, fileRewind?: boolean) =>
    evaluate(EMPTY_RULES, { tool, input, workspace: "/ws", ...(fileRewind === undefined ? {} : { fileRewind }) });

  test("on (or unset): write and edit inside the workspace are a safe default, as round 29 set", () => {
    expect(ev("edit", { path: "src/a.ts" })).toEqual({ action: "allow", source: "safe-default" });
    expect(ev("write", { path: "src/a.ts", content: "x" }, true)).toEqual({ action: "allow", source: "safe-default" });
  });

  test("off: they ask — they could not be undone", () => {
    expect(ev("edit", { path: "src/a.ts" }, false)).toEqual({ action: "ask", source: "default" });
    expect(ev("write", { path: "src/a.ts", content: "x" }, false)).toEqual({ action: "ask", source: "default" });
  });

  test("off changes nothing else: reads stay free, and an explicit allow rule still allows", () => {
    expect(ev("read", { path: "src/a.ts" }, false)).toEqual({ action: "allow", source: "safe-default" });
    const allowEdit = { global: [{ layer: "tool" as const, pattern: "edit", action: "allow" as const }], workspaces: {} };
    expect(evaluate(allowEdit, { tool: "edit", input: { path: "src/a.ts" }, workspace: "/ws", fileRewind: false }).action).toBe("allow");
  });

  test("a sub-agent gets the same answer (children run in-process, clamped: ask becomes deny)", () => {
    const call = { tool: "edit", input: { path: "src/a.ts" }, workspace: "/ws", fileRewind: false };
    expect(childDecision(EMPTY_RULES, call, { bypass: false, rulesReadable: true }).action).toBe("deny");
    expect(childDecision(EMPTY_RULES, { ...call, fileRewind: true }, { bypass: false, rulesReadable: true }).action).toBe("allow");
  });
});

describe("the wiring", () => {
  const src = (p: string): string => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");

  test("off reaches the session as HV_FILE_REWIND=0 at spawn; on sets nothing", () => {
    expect(resolvePiSpawn("/ws", "/s", "/rt", { fileRewind: false }).env.HV_FILE_REWIND).toBe("0");
    expect(resolvePiSpawn("/ws", "/s", "/rt", { fileRewind: true }).env.HV_FILE_REWIND).toBe(process.env.HV_FILE_REWIND);
    expect(src("src/main/ipc.ts")).toContain("fileRewind: resolveFileRewind(project ?? null)");
  });

  test("the bridge and the child guard pass it to every evaluate()", () => {
    const bridge = src("pi-runtime/extensions/happyvibe-bridge.ts");
    expect(bridge).toContain('const FILE_REWIND = process.env.HV_FILE_REWIND !== "0";');
    const permCalls = bridge.match(/evaluate\(rules, \{\s*tool: permTool[^}]*\}/g) ?? [];
    expect(permCalls.length).toBeGreaterThan(0);
    for (const c of permCalls) expect(c).toContain("fileRewind: FILE_REWIND");
    expect(src("pi-runtime/extensions/hv-child-guard.ts")).toContain('fileRewind: process.env.HV_FILE_REWIND !== "0"');
  });

  test("off skips every capture: a message's, the turn end's and Implement's", () => {
    const ipc = src("src/main/ipc.ts");
    expect(ipc).toContain('e.type === "agent_end" && fileRewindOn(snapWsId)');
    expect(ipc).toContain("!wasBusy && meta?.workspaceId && fileRewindOn(meta.workspaceId)");
    expect(ipc).toMatch(/if \(fileRewindOn\(wsId\)\) \{\s*const capture = snapshotHost\.capture\(/);
    // A worktree session follows its project's setting, like bypass.
    expect(ipc).toContain("resolveFileRewind(worktrees.projectOf(workspaceId))");
  });

  test("a change respawns the affected sessions when idle, and says why", () => {
    const ipc = src("src/main/ipc.ts");
    expect(ipc).toMatch(/"hv:set-global-file-rewind"[\s\S]{0,200}reloadForFileRewind\(\(project\) => getWorkspaceFileRewind\(project\) === null\)/);
    expect(ipc).toMatch(/"hv:set-workspace-file-rewind"[\s\S]{0,200}reloadForFileRewind\(\(project\) => project === workspace\)/);
    expect(RELOAD_NOTICE.fileRewind).toBe("Reloading to apply the Rewind setting");
  });

  test("the Permissions page's test box answers what the gate will", () => {
    expect(src("src/main/ipc.ts")).toMatch(/"hv:eval-rules"[\s\S]{0,400}fileRewind: resolveFileRewind\(worktrees\.projectOf\(workspaceId\)\)/);
  });
});
