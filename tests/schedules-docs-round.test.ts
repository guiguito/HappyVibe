import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { lastRunLabel, OUTCOME_MARK, SKIP_REASON } from "../src/renderer/src/schedulesCopy";
import { type Schedule } from "../src/main/schedules";
import { resolveBypass } from "../src/main/bypass";

const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const S = (o: Partial<Schedule> = {}): Schedule => ({
  id: "s", title: "T", prompt: "p", workspaceId: "/w", repeat: { kind: "daily" }, at: "09:00",
  mode: "full", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true,
  createdAt: "c", nextRunAt: null, failStreak: 0, runs: [], ...o,
});
const sv = R("src/renderer/src/components/SchedulesView.tsx");
const ipc = R("src/main/ipc.ts");

describe("docs-round #29: the drawer's bypass warning", () => {
  it("App no longer stubs it off", () => {
    expect(R("src/renderer/src/App.tsx")).not.toContain("bypassHere");
  });

  it("SchedulesView resolves it the way a spawn does — workspace over global", () => {
    expect(sv).toContain('import { resolveBypass } from "../../../main/bypass";');
    expect(sv).toContain("window.hv.getGlobalBypass()");
    expect(sv).toContain("window.hv.getWorkspaceBypass(ws)");
    expect(sv).toContain("resolveBypass(globalOn, perWs[i])");
    expect(sv).toContain("bypassHere={(ws) => bypass[ws] ?? false}");
  });

  it("the resolver the renderer imports stays import-free, and means what spawn means", () => {
    expect(R("src/main/bypass.ts")).not.toMatch(/^import /m);
    expect(resolveBypass(true, null)).toBe(true);
    expect(resolveBypass(true, false)).toBe(false);
    expect(resolveBypass(false, true)).toBe(true);
    expect(resolveBypass(false, undefined)).toBe(false);
  });
});

describe("docs-round #29: Run now on a busy project", () => {
  it("does not promise a wait the scheduler never queues (scheduler.ts runNow returns busy)", () => {
    expect(sv).not.toContain("the run will wait");
    expect(sv).toContain("Another session in that project is working — try again when that session finishes.");
  });
});

describe("docs-round #29/#33: Open at login", () => {
  it("is unavailable on Linux, through the platform seam", () => {
    const h = ipc.slice(ipc.indexOf('ipcMain.handle("hv:login-item-get"'), ipc.indexOf('ipcMain.handle("hv:login-item-set"'));
    expect(h).toContain('const available = app.isPackaged && platform.name !== "linux";');
    expect(h).toContain("openAtLogin: available ? app.getLoginItemSettings().openAtLogin : false");
    expect(h).not.toContain("process.platform");
  });
});

describe("docs-round #29: skip reasons in words", () => {
  const written = [...new Set([...R("src/main/scheduler.ts").matchAll(/outcome: "skipped", reason: "([a-z-]+)"/g)].map((m) => m[1]!))];

  it("the scan still finds the reasons the scheduler writes", () => {
    expect(written).toEqual(expect.arrayContaining(["busy", "missed", "unanswered", "workspace-gone"]));
  });

  it("every reason the scheduler writes has words", () => {
    expect(written.filter((r) => !SKIP_REASON[r])).toEqual([]);
  });

  it("the row and the history both use them", () => {
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "skipped", reason: "workspace-gone" }] })))
      .toBe("– skipped: the project was removed from the sidebar");
    expect(sv).toContain('r.outcome === "skipped" ? SKIP_REASON[r.reason] ?? r.reason : r.reason');
  });
});

describe("docs-round #29: the dead 'needs you' outcome is gone", () => {
  it("has no mark, no label and no type member", () => {
    expect(Object.keys(OUTCOME_MARK).sort()).toEqual(["failed", "never", "ok", "skipped"]);
    expect(R("src/main/schedules.ts")).not.toContain('"needs_you"');
    expect(R("src/main/scheduleEnvelopes.ts")).not.toContain('"needs_you"');
    expect(R("src/renderer/src/schedulesCopy.ts")).not.toContain("needs_you");
  });

  it("the notification for a run that asks is untouched", () => {
    expect(R("src/main/scheduler.ts")).toContain('this.host.notify("needs_you", s, { sessionId })');
  });
});

describe("docs-round #32: an agent-created schedule", () => {
  it("is stamped createdBy in main once the agent's drawer saves a NEW schedule", () => {
    const i = ipc.indexOf('if ("cancelled" in res) return answer("declined");');
    expect(i).toBeGreaterThan(0);
    expect(ipc.slice(i, i + 600)).toMatch(
      /if \(!existing\) \{[\s\S]{0,300}scheduleStore\.update\(res\.saved\.id, \{ createdBy: \{ source: "agent", sessionId \} \}, new Date\(\)\);/,
    );
  });

  it("logs ONE audit row: the save path skips its user-sourced row while an agent drawer waits", () => {
    const h = ipc.slice(ipc.indexOf('ipcMain.handle("hv:schedule-save"'), ipc.indexOf('ipcMain.handle("hv:schedule-delete"'));
    expect(h).toMatch(/if \(scheduleDrawerWaits\.size === 0\) \{\s*void log\.append\(/);
  });

  it("the row line it feeds is still there", () => {
    expect(sv).toContain('s.createdBy?.source === "agent"');
  });
});
