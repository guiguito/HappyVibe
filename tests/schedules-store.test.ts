import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScheduleStore, type NewSchedule } from "../src/main/schedules";
import type { SessionMeta } from "../src/main/store";

const tmpFile = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-sched-")), "schedules.json");
const input: NewSchedule = {
  title: "T", prompt: "p", workspaceId: "/ws", repeat: { kind: "daily" }, at: "09:00",
  mode: "full", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true,
};

describe("ScheduleStore", () => {
  it("round-trips through disk and computes nextRunAt on create", () => {
    const f = tmpFile();
    const a = new ScheduleStore(f);
    const s = a.create(input, new Date(2026, 8, 11, 8, 0));
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(s.nextRunAt!)).toEqual(new Date(2026, 8, 11, 9, 0));
    expect(s.runs).toEqual([]);
    expect(s.failStreak).toBe(0);
    expect(new ScheduleStore(f).get(s.id)).toEqual(s);
  });

  it("update recomputes nextRunAt and never touches runs", () => {
    const a = new ScheduleStore(tmpFile());
    const s = a.create(input, new Date(2026, 8, 11, 8, 0));
    a.replace({ ...s, runs: [{ firedAt: "x", outcome: "ok" }] });
    const u = a.update(s.id, { at: "18:00" }, new Date(2026, 8, 11, 8, 0))!;
    expect(new Date(u.nextRunAt!)).toEqual(new Date(2026, 8, 11, 18, 0));
    expect(u.runs).toHaveLength(1);
  });

  it("re-enabling a fail-paused schedule clears the streak", () => {
    const a = new ScheduleStore(tmpFile());
    const s = a.create(input, new Date(2026, 8, 11, 8, 0));
    a.replace({ ...s, enabled: false, failStreak: 3, nextRunAt: null });
    const u = a.update(s.id, { enabled: true }, new Date(2026, 8, 11, 8, 0))!;
    expect(u.failStreak).toBe(0);
    expect(u.nextRunAt).not.toBeNull();
  });

  it("remove forgets; an unknown id updates nothing; a corrupt file reads as empty", () => {
    const f = tmpFile();
    const a = new ScheduleStore(f);
    const s = a.create(input, new Date());
    expect(a.update("nope", { at: "10:00" }, new Date())).toBeUndefined();
    a.remove(s.id);
    expect(a.list()).toEqual([]);
    fs.writeFileSync(f, "{nope");
    expect(new ScheduleStore(f).list()).toEqual([]);
  });
});

describe("SessionMeta.scheduleId is additive", () => {
  it("a meta without it is still a valid SessionMeta", () => {
    const m: SessionMeta = { id: "a", title: "t", workspaceId: "/w", createdAt: "c", updatedAt: "u", archived: false, titleSource: "fallback" };
    expect(m.scheduleId).toBeUndefined();
    const run: SessionMeta = { ...m, scheduleId: "s1" };
    expect(run.scheduleId).toBe("s1");
  });
});
