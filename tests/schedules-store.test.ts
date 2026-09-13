import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editPatch, ScheduleStore, validateScheduleInput } from "../src/main/scheduleStore";
import { hasEnded, withNextRun } from "../src/main/schedules";
import type { NewSchedule } from "../src/main/schedules";
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

  /**
   * The drawer always sends every field, so an ABSENT optional one means the
   * user CLEARED it — Reschedule, "No end", "Same as this project". This
   * composes the exact two functions `hv:schedule-save` composes, because the
   * bug lived between them: validate drops absent keys and update merges with a
   * spread, so a clear left the old value in place and the row stayed "ended".
   */
  it("clearing the end date and the model on an edit actually clears them", () => {
    const f = tmpFile();
    const a = new ScheduleStore(f);
    const now = new Date(2026, 8, 11, 8, 0);
    const s = a.create({ ...input, until: "2026-09-12", model: "x/y" }, now);
    expect(s.until).toBe("2026-09-12");
    expect(s.nextRunAt).not.toBeNull();

    const v = validateScheduleInput({ ...input }, ["/ws"]);
    const u = a.update(s.id, editPatch(v), now)!;

    expect(u.until).toBeUndefined();
    expect(u.model).toBeUndefined();
    expect(u.nextRunAt).not.toBeNull();
    // …and the cleared key is gone from disk, not just from the in-memory copy.
    expect(new ScheduleStore(f).get(s.id)!.until).toBeUndefined();
  });

  it("an expired schedule comes back to life when its end is cleared", () => {
    const a = new ScheduleStore(tmpFile());
    const made = new Date(2026, 8, 11, 8, 0);
    const s = a.create({ ...input, until: "2026-09-12" }, made);
    const past = new Date(2026, 8, 20, 8, 0);
    a.replace(withNextRun(s, past));
    expect(a.get(s.id)!.nextRunAt).toBeNull();

    const v = validateScheduleInput({ ...input }, ["/ws"]);
    const u = a.update(s.id, editPatch(v), past)!;
    expect(hasEnded(u, past)).toBe(false);
    expect(u.nextRunAt).not.toBeNull();
  });

  /**
   * PAUSED_COPY sends the user to the drawer ("check the model or the key"),
   * and the drawer re-sends the record's own `enabled: false` — so the repair
   * landed back in the paused state with nothing on screen saying so.
   */
  it("editing a fail-paused schedule is the repair: it resumes", () => {
    const a = new ScheduleStore(tmpFile());
    const now = new Date(2026, 8, 11, 8, 0);
    const s = a.create(input, now);
    a.replace({ ...s, enabled: false, failStreak: 3, nextRunAt: null });
    const u = a.update(s.id, { model: "good/model", enabled: false }, now)!;
    expect(u.enabled).toBe(true);
    expect(u.failStreak).toBe(0);
    expect(u.nextRunAt).not.toBeNull();
  });

  it("a deliberately paused schedule stays paused through an edit", () => {
    const a = new ScheduleStore(tmpFile());
    const now = new Date(2026, 8, 11, 8, 0);
    const s = a.create(input, now);
    a.replace({ ...s, enabled: false, failStreak: 0 });
    const u = a.update(s.id, { title: "renamed", enabled: false }, now)!;
    expect(u.enabled).toBe(false);
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
