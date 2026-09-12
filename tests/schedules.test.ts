import { describe, expect, it } from "vitest";
import { applyOutcome, catchUpDecision, FAIL_PAUSE_AT, hasEnded, humanRecurrence, nextFire, runsPerDay, runTitle, untilCutoff, untilLabel, withNextRun, type Schedule } from "../src/main/schedules";
import { validateScheduleInput } from "../src/main/scheduleStore";

// All dates are LOCAL wall-clock (§35: "Local time, DST follows the wall clock").
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0): Date => new Date(y, m - 1, d, h, min, s, ms);

const base = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s1", title: "Daily change review", prompt: "review", workspaceId: "/ws",
  repeat: { kind: "daily" }, at: "09:00", mode: "readonly", reuseSession: false,
  notifyOnDone: true, catchUp: "ask", enabled: true, createdAt: "2026-09-01T00:00:00.000Z",
  nextRunAt: null, failStreak: 0, runs: [], ...over,
});

describe("nextFire", () => {
  it("daily: later today if the time is still ahead, else tomorrow", () => {
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 9, 11, 8, 59))).toEqual(local(2026, 9, 11, 9, 0));
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 9, 11, 9, 0))).toEqual(local(2026, 9, 12, 9, 0));
  });
  it("weekdays skips the weekend", () => {
    // 2026-09-11 is a Friday.
    expect(nextFire({ kind: "weekdays" }, "09:00", local(2026, 9, 11, 10, 0))).toEqual(local(2026, 9, 14, 9, 0));
  });
  it("weekly with a day picker wraps the week", () => {
    expect(nextFire({ kind: "weekly", days: [1] }, "18:00", local(2026, 9, 14, 18, 0))).toEqual(local(2026, 9, 21, 18, 0));
    expect(nextFire({ kind: "weekly", days: [] }, "18:00", local(2026, 9, 14))).toBeNull();
  });
  it("hours: the next multiple of N from `at` today, wrapping past midnight", () => {
    expect(nextFire({ kind: "hours", every: 6 }, "01:00", local(2026, 9, 11, 13, 30))).toEqual(local(2026, 9, 11, 19, 0));
    expect(nextFire({ kind: "hours", every: 6 }, "01:00", local(2026, 9, 11, 23, 0))).toEqual(local(2026, 9, 12, 1, 0));
  });
  it("minutes: the next multiple of N from `at`, wrapping past midnight", () => {
    expect(nextFire({ kind: "minutes", every: 15 }, "09:00", local(2026, 9, 11, 9, 7))).toEqual(local(2026, 9, 11, 9, 15));
    expect(nextFire({ kind: "minutes", every: 5 }, "09:02", local(2026, 9, 11, 9, 2))).toEqual(local(2026, 9, 11, 9, 7));
    // The series restarts at `at` each day rather than free-running, so the
    // last slot before midnight is followed by tomorrow's first.
    expect(nextFire({ kind: "minutes", every: 30 }, "00:00", local(2026, 9, 11, 23, 45))).toEqual(local(2026, 9, 12, 0, 0));
  });

  it("minutes: one minute is the floor the 60 s tick can honour, and 60+ is an hours schedule", () => {
    expect(nextFire({ kind: "minutes", every: 1 }, "09:00", local(2026, 9, 11, 9, 0, 30))).toEqual(local(2026, 9, 11, 9, 1));
    expect(nextFire({ kind: "minutes", every: 0 }, "09:00", local(2026, 9, 11))).toBeNull();
    expect(nextFire({ kind: "minutes", every: 60 }, "09:00", local(2026, 9, 11))).toBeNull();
  });

  it("once: null when the slot has passed", () => {
    expect(nextFire({ kind: "once", date: "2026-09-10" }, "09:00", local(2026, 9, 11))).toBeNull();
    expect(nextFire({ kind: "once", date: "2026-09-12" }, "09:00", local(2026, 9, 11))).toEqual(local(2026, 9, 12, 9, 0));
  });
  it("month end and year end roll over", () => {
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 9, 30, 10, 0))).toEqual(local(2026, 10, 1, 9, 0));
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 12, 31, 10, 0))).toEqual(local(2027, 1, 1, 9, 0));
  });
  it("DST: the wall-clock hour is kept across the spring and fall changes", () => {
    // Asserted on HOURS, never on ms deltas — the whole point is that a 9:00 run is at 9:00.
    const n1 = nextFire({ kind: "daily" }, "09:00", local(2026, 3, 28, 10, 0))!;
    expect([n1.getDate(), n1.getHours(), n1.getMinutes()]).toEqual([29, 9, 0]);
    const n2 = nextFire({ kind: "daily" }, "09:00", local(2026, 10, 24, 10, 0))!;
    expect([n2.getDate(), n2.getHours(), n2.getMinutes()]).toEqual([25, 9, 0]);
  });
  it("rejects a malformed time", () => {
    expect(nextFire({ kind: "daily" }, "9am", local(2026, 9, 11))).toBeNull();
    expect(nextFire({ kind: "daily" }, "25:00", local(2026, 9, 11))).toBeNull();
  });
});

describe("humanRecurrence / runTitle", () => {
  it("speaks the drawer's words", () => {
    expect(humanRecurrence({ kind: "daily" }, "09:00")).toBe("Every day at 9:00");
    expect(humanRecurrence({ kind: "weekdays" }, "09:05")).toBe("Weekdays at 9:05");
    expect(humanRecurrence({ kind: "weekly", days: [1, 3] }, "18:00")).toBe("Mon, Wed at 18:00");
    expect(humanRecurrence({ kind: "hours", every: 1 }, "00:00")).toBe("Every hour");
    expect(humanRecurrence({ kind: "hours", every: 6 }, "01:00")).toBe("Every 6 hours from 1:00");
    expect(humanRecurrence({ kind: "minutes", every: 1 }, "00:00")).toBe("Every minute");
    expect(humanRecurrence({ kind: "minutes", every: 15 }, "09:00")).toBe("Every 15 minutes from 9:00");
    expect(humanRecurrence({ kind: "once", date: "2026-09-12" }, "09:00")).toBe("Once, Sep 12 at 9:00");
  });
  it("titles a run with the schedule name and the day", () => {
    expect(runTitle("Daily change review", local(2026, 9, 11, 9))).toBe("Daily change review · Sep 11");
  });
});

describe("catchUpDecision", () => {
  const due = base({ nextRunAt: local(2026, 9, 8, 9, 0).toISOString() }); // three days ago
  const now = local(2026, 9, 11, 10, 0);
  it("ask parks the slot and fires nothing", () => {
    expect(catchUpDecision({ ...due, catchUp: "ask" }, now)).toEqual({ kind: "park", slotAt: due.nextRunAt });
  });
  it("always fires ONCE for a three-day gap", () => {
    expect(catchUpDecision({ ...due, catchUp: "always" }, now)).toEqual({ kind: "fire" });
  });
  it("never only advances", () => {
    expect(catchUpDecision({ ...due, catchUp: "never" }, now)).toEqual({ kind: "advance" });
  });
  it("nothing when the slot is in the future, the schedule is disabled, or an ask is already parked", () => {
    expect(catchUpDecision(base({ nextRunAt: local(2026, 9, 12, 9).toISOString() }), now)).toEqual({ kind: "none" });
    expect(catchUpDecision({ ...due, enabled: false }, now)).toEqual({ kind: "none" });
    expect(catchUpDecision({ ...due, missed: { slotAt: due.nextRunAt! } }, now)).toEqual({ kind: "none" });
  });
});

describe("applyOutcome / withNextRun", () => {
  it("pauses after FAIL_PAUSE_AT consecutive failures and says so", () => {
    let s = base();
    for (let i = 0; i < FAIL_PAUSE_AT; i++) s = applyOutcome(s, { firedAt: "t", outcome: "failed", reason: "402" });
    expect(s.failStreak).toBe(FAIL_PAUSE_AT);
    expect(s.enabled).toBe(false);
  });
  it("ok resets the streak; skipped leaves it alone", () => {
    let s = applyOutcome(base({ failStreak: 2 }), { firedAt: "t", outcome: "ok" });
    expect(s.failStreak).toBe(0);
    s = applyOutcome(base({ failStreak: 2 }), { firedAt: "t", outcome: "skipped", reason: "busy" });
    expect(s.failStreak).toBe(2);
  });
  it("keeps only the last 20 runs, newest last", () => {
    let s = base();
    for (let i = 0; i < 25; i++) s = applyOutcome(s, { firedAt: String(i), outcome: "ok" });
    expect(s.runs).toHaveLength(20);
    expect(s.runs.at(-1)!.firedAt).toBe("24");
  });
  it("withNextRun leaves a parked ask alone — retiring it is the scheduler's call, on the deadline the park set", () => {
    const parked = base({ missed: { slotAt: local(2026, 9, 10, 9).toISOString() }, nextRunAt: local(2026, 9, 10, 9).toISOString() });
    const s = withNextRun(parked, local(2026, 9, 11, 9, 30));
    expect(s.missed).toEqual({ slotAt: local(2026, 9, 10, 9).toISOString() });
    expect(s.runs).toEqual([]);
    expect(new Date(s.nextRunAt!)).toEqual(local(2026, 9, 12, 9, 0));
  });
  it("withNextRun on a disabled or once-and-done schedule is null", () => {
    expect(withNextRun(base({ enabled: false }), local(2026, 9, 11)).nextRunAt).toBeNull();
    expect(withNextRun(base({ repeat: { kind: "once", date: "2026-09-01" } }), local(2026, 9, 11)).nextRunAt).toBeNull();
  });
});

describe("an end date", () => {
  const withUntil = (until?: string): Schedule => base({ until, nextRunAt: null });

  it("is absent by default — a schedule runs until you pause it", () => {
    expect(base().until).toBeUndefined();
    expect(withNextRun(base(), local(2026, 9, 11, 10)).nextRunAt).not.toBeNull();
  });

  it("runs THROUGH its last day, then has no next run", () => {
    const s = withUntil("2026-09-12");
    // The 12th's own slot is still ahead of the 11th: it fires.
    expect(new Date(withNextRun(s, local(2026, 9, 11, 10)).nextRunAt!)).toEqual(local(2026, 9, 12, 9, 0));
    // After it, the next slot would be the 13th, which is past the end.
    expect(withNextRun(s, local(2026, 9, 12, 10)).nextRunAt).toBeNull();
  });

  it("does NOT switch the schedule off — finished and paused are different states", () => {
    const done = withNextRun(withUntil("2026-09-10"), local(2026, 9, 12));
    expect(done.enabled).toBe(true);
    expect(done.nextRunAt).toBeNull();
    expect(hasEnded(done, local(2026, 9, 12))).toBe(true);
    // A schedule the USER switched off has not "ended".
    expect(hasEnded(base({ enabled: false, until: "2026-09-10" }), local(2026, 9, 12))).toBe(false);
    expect(hasEnded(base(), local(2026, 9, 12))).toBe(false);
  });

  it("reads as part of the recurrence", () => {
    expect(humanRecurrence({ kind: "weekdays" }, "09:00", "2026-10-03")).toBe("Weekdays at 9:00 until Oct 3");
    expect(humanRecurrence({ kind: "weekdays" }, "09:00")).toBe("Weekdays at 9:00");
    // A `once` schedule is already a single run; an end date would say nothing.
    expect(humanRecurrence({ kind: "once", date: "2026-09-12" }, "09:00", "2026-10-03")).toBe("Once, Sep 12 at 9:00");
  });

  it("a bare date means the END of that day — a user typing a date means to include it", () => {
    expect(untilCutoff("2026-09-12")).toEqual(local(2026, 9, 12, 23, 59, 59, 999));
  });

  it("a date WITH a time means exactly that moment, local", () => {
    expect(untilCutoff("2026-09-12T17:30")).toEqual(local(2026, 9, 12, 17, 30));
    // `datetime-local` emits this shape; a space instead of T is accepted too.
    expect(untilCutoff("2026-09-12 17:30")).toEqual(local(2026, 9, 12, 17, 30));
  });

  it("refuses what it cannot read, rather than guessing a moment", () => {
    for (const bad of ["nope", "2026-09-12T25:00", "2026-09-12T10:61", "2026-13-01", "2026-02-30", ""]) {
      expect(untilCutoff(bad), bad).toBeNull();
    }
  });

  it("labels a whole day without a time, and names the time when there is one", () => {
    expect(untilLabel("2026-10-03")).toBe("Oct 3");
    expect(untilLabel("2026-10-03T17:00")).toBe("Oct 3, 17:00");
    expect(humanRecurrence({ kind: "daily" }, "09:00", "2026-10-03T17:05")).toBe("Every day at 9:00 until Oct 3, 17:05");
  });

  it("stops at the MOMENT, not at the end of its day", () => {
    const s = base({ until: "2026-09-12T10:00" });
    expect(new Date(withNextRun(s, local(2026, 9, 11, 10)).nextRunAt!)).toEqual(local(2026, 9, 12, 9, 0));
    // The 13th's 9:00 is past 10:00 on the 12th, so there is no next run.
    expect(withNextRun(s, local(2026, 9, 12, 9, 30)).nextRunAt).toBeNull();
  });
});

describe("runsPerDay", () => {
  it("counts the interval kinds and refuses to guess for the rest", () => {
    expect(runsPerDay({ kind: "minutes", every: 5 })).toBe(288);
    expect(runsPerDay({ kind: "minutes", every: 1 })).toBe(1440);
    expect(runsPerDay({ kind: "hours", every: 6 })).toBe(4);
    expect(runsPerDay({ kind: "daily" })).toBeNull();
    expect(runsPerDay({ kind: "weekly", days: [1] })).toBeNull();
  });
});

describe("validateScheduleInput", () => {
  const ws = ["/ws"];
  const ok = { title: "T", prompt: "p", workspaceId: "/ws", repeat: { kind: "daily" as const }, at: "09:00", mode: "full" as const, reuseSession: false, notifyOnDone: true, catchUp: "ask" as const, enabled: true };
  it("passes a valid input through", () => {
    expect(validateScheduleInput(ok, ws)).toMatchObject({ title: "T", workspaceId: "/ws", at: "09:00" });
  });
  it("refuses an empty title or prompt, an unknown workspace, a bad time and an empty weekly", () => {
    expect(() => validateScheduleInput({ ...ok, title: "  " }, ws)).toThrow(/title/i);
    expect(() => validateScheduleInput({ ...ok, prompt: "" }, ws)).toThrow(/prompt/i);
    expect(() => validateScheduleInput({ ...ok, workspaceId: "/nope" }, ws)).toThrow(/workspace/i);
    expect(() => validateScheduleInput({ ...ok, at: "25:00" }, ws)).toThrow(/time/i);
    expect(() => validateScheduleInput({ ...ok, repeat: { kind: "weekly", days: [] } }, ws)).toThrow(/day/i);
    expect(() => validateScheduleInput({ ...ok, repeat: { kind: "minutes", every: 0 } }, ws)).toThrow(/run/i);
    expect(validateScheduleInput({ ...ok, repeat: { kind: "minutes", every: 15 } }, ws).repeat).toEqual({ kind: "minutes", every: 15 });
    // An end date already in the past would make a schedule with no next run —
    // refused rather than created and inert.
    expect(() => validateScheduleInput({ ...ok, until: "2020-01-01" }, ws)).toThrow(/future/i);
    expect(() => validateScheduleInput({ ...ok, until: "next week" }, ws)).toThrow(/date/i);
    const far = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    expect(validateScheduleInput({ ...ok, until: far }, ws).until).toBe(far);
    expect(validateScheduleInput(ok, ws).until).toBeUndefined();
    expect(() => validateScheduleInput({ ...ok, mode: "bypass" as never }, ws)).toThrow(/mode/i);
  });
  it("normalises a trailing-slash workspace to the registered spelling", () => {
    expect(validateScheduleInput({ ...ok, workspaceId: "/ws/" }, ws).workspaceId).toBe("/ws");
  });
});
