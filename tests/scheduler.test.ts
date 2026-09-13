import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Scheduler, type SchedulerHost } from "../src/main/scheduler";
import { BUSY_WAIT_MS, FAIL_PAUSE_AT, type NewSchedule } from "../src/main/schedules";
import { ScheduleStore } from "../src/main/scheduleStore";

const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-sch-")), "s.json");
const T0 = new Date(2026, 8, 11, 9, 0, 30); // 30 s past the 9:00 slot — what a 60 s tick looks like
const input: NewSchedule = {
  title: "Review", prompt: "review it", workspaceId: "/ws", repeat: { kind: "daily" }, at: "09:00",
  mode: "readonly", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true,
};

function host(over: Partial<SchedulerHost> = {}): { h: SchedulerHost; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const h: SchedulerHost = {
    now: () => T0,
    workspaceExists: () => true,
    workspaceIdle: () => true,
    sessionExists: () => true,
    createRunSession: vi.fn(async (_s, title: string) => { calls.push(`create:${title}`); return `sess-${++n}`; }),
    resumeSession: vi.fn(async (id: string) => { calls.push(`resume:${id}`); }),
    archivePreviousRun: vi.fn(async () => { calls.push("archive"); }),
    prompt: vi.fn(async (id: string, text: string) => { calls.push(`prompt:${id}:${text}`); }),
    log: vi.fn((type: string, _s, data) => { calls.push(`log:${type}:${JSON.stringify(data)}`); }),
    notify: vi.fn((kind: string) => { calls.push(`notify:${kind}`); }),
    changed: vi.fn(),
    ...over,
  };
  return { h, calls };
}

describe("Scheduler.tick", () => {
  it("fires a due schedule in order — archive previous, create, prompt, log — and advances nextRunAt", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    const { h, calls } = host();
    await new Scheduler(store, h).tick();
    expect(calls.slice(0, 3)).toEqual(["archive", "create:Review · Sep 11", "prompt:sess-1:review it"]);
    expect(calls[3]).toMatch(/^log:schedule\.fire/);
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
    expect((h.createRunSession as ReturnType<typeof vi.fn>).mock.calls[0]![0].mode).toBe("readonly");
  });

  it("does not fire twice for one slot", async () => {
    const store = new ScheduleStore(tmp());
    store.create(input, new Date(2026, 8, 10, 12));
    const { h } = host();
    const sch = new Scheduler(store, h);
    await sch.tick();
    await sch.tick();
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
  });

  it("does not fire at all when the slot is still ahead or the schedule is off", async () => {
    const store = new ScheduleStore(tmp());
    store.create(input, new Date(2026, 8, 11, 9, 1)); // next slot is tomorrow
    store.create({ ...input, enabled: false }, new Date(2026, 8, 10, 12));
    const { h } = host();
    await new Scheduler(store, h).tick();
    expect(h.createRunSession).not.toHaveBeenCalled();
  });

  it("waits while the workspace is busy, then skips after BUSY_WAIT_MS", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    let now = T0;
    const { h, calls } = host({ workspaceIdle: () => false, now: () => now });
    const sch = new Scheduler(store, h);
    await sch.tick();
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(store.get(s.id)!.nextRunAt).toBe(s.nextRunAt); // untouched — the next tick retries
    now = new Date(T0.getTime() + BUSY_WAIT_MS + 1);
    await sch.tick();
    expect(calls.some((c) => c.startsWith('log:schedule.skip:{"reason":"busy"'))).toBe(true);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "busy" });
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
  });

  it("a gone workspace skips and disables", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    const { h } = host({ workspaceExists: () => false });
    await new Scheduler(store, h).tick();
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(store.get(s.id)!.enabled).toBe(false);
    expect(store.get(s.id)!.nextRunAt).toBeNull();
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "workspace-gone" });
  });

  it("reuse resumes the one session and never archives it", async () => {
    const store = new ScheduleStore(tmp());
    store.create({ ...input, reuseSession: true, reusedSessionId: "old" }, new Date(2026, 8, 10, 12));
    const { h, calls } = host();
    await new Scheduler(store, h).tick();
    expect(calls[0]).toBe("resume:old");
    expect(calls[1]).toBe("prompt:old:review it");
    expect(h.archivePreviousRun).not.toHaveBeenCalled();
  });

  it("reuse recreates the session LOUDLY when it is gone", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create({ ...input, reuseSession: true, reusedSessionId: "old" }, new Date(2026, 8, 10, 12));
    const { h, calls } = host({ sessionExists: () => false });
    await new Scheduler(store, h).tick();
    expect(calls[0]).toBe("create:Review"); // undated: one session for the schedule
    expect(store.get(s.id)!.reusedSessionId).toBe("sess-1");
    expect(calls.some((c) => c.includes('"reusedSessionRecreated":true'))).toBe(true);
  });

  it("a spawn refusal is a failed run, and FAIL_PAUSE_AT of them pause the schedule", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    let now = T0;
    const { h } = host({ createRunSession: vi.fn(async () => { throw new Error("no model"); }), now: () => now });
    const sch = new Scheduler(store, h);
    for (let i = 0; i < FAIL_PAUSE_AT; i++) {
      await sch.tick();
      now = new Date(now.getTime() + 24 * 3600 * 1000);
    }
    expect(store.get(s.id)!.enabled).toBe(false);
    expect(store.get(s.id)!.failStreak).toBe(FAIL_PAUSE_AT);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "failed", reason: "no model" });
  });
});

describe("outcomes", () => {
  it("agent_end records ok with its cost, notifies, and resets the streak", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    store.replace({ ...store.get(s.id)!, failStreak: 2 });
    const { h, calls } = host();
    const sch = new Scheduler(store, h);
    await sch.tick();
    sch.onAgentEnd("sess-1", 120_000, 0.03);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ sessionId: "sess-1", outcome: "ok", durationMs: 120_000, costUsd: 0.03 });
    expect(store.get(s.id)!.failStreak).toBe(0);
    expect(calls).toContain("notify:done");
  });

  it("an unknown cost is omitted rather than recorded as zero", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    const sch = new Scheduler(store, host().h);
    await sch.tick();
    sch.onAgentEnd("sess-1", 5);
    expect(store.get(s.id)!.runs.at(-1)).not.toHaveProperty("costUsd");
  });

  it("a SECOND agent_end for the same session is not a second run", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    const sch = new Scheduler(store, host().h);
    await sch.tick();
    sch.onAgentEnd("sess-1", 5);
    sch.onAgentEnd("sess-1", 5); // the user prompted the run themselves afterwards
    expect(store.get(s.id)!.runs).toHaveLength(1);
  });

  it("a crash before agent_end is a failed run", async () => {
    const store = new ScheduleStore(tmp());
    const s = store.create(input, new Date(2026, 8, 10, 12));
    const sch = new Scheduler(store, host().h);
    await sch.tick();
    sch.onSessionCrash("sess-1", "exit 1");
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "failed", reason: "exit 1" });
    expect(store.get(s.id)!.failStreak).toBe(1);
  });

  it("needs_you notifies once per run however often the run asks", async () => {
    const store = new ScheduleStore(tmp());
    store.create(input, new Date(2026, 8, 10, 12));
    const { h, calls } = host();
    const sch = new Scheduler(store, h);
    await sch.tick();
    sch.onNeedsYou("sess-1");
    sch.onNeedsYou("sess-1");
    sch.onNeedsYou("sess-1");
    expect(calls.filter((c) => c === "notify:needs_you")).toHaveLength(1);
  });

  it("notifyOnDone:false silences the finish, never the needs-you", async () => {
    const store = new ScheduleStore(tmp());
    store.create({ ...input, notifyOnDone: false }, new Date(2026, 8, 10, 12));
    const { h, calls } = host();
    const sch = new Scheduler(store, h);
    await sch.tick();
    sch.onNeedsYou("sess-1");
    sch.onAgentEnd("sess-1", 5);
    expect(calls).toContain("notify:needs_you");
    expect(calls).not.toContain("notify:done");
  });

  it("an hourly run's NEXT slot is not pushed out by a long turn", async () => {
    // nextRunAt is computed at FIRE time; recomputing it at agent_end would move
    // the 10:00 slot to 11:00 just because the 09:00 run finished at 10:05.
    const store = new ScheduleStore(tmp());
    let now = new Date(2026, 8, 11, 9, 0, 30);
    const s = store.create({ ...input, repeat: { kind: "hours", every: 1 } }, new Date(2026, 8, 11, 8, 30));
    const sch = new Scheduler(store, host({ now: () => now }).h);
    await sch.tick();
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 11, 10, 0));
    now = new Date(2026, 8, 11, 10, 5);
    sch.onAgentEnd("sess-1", 1);
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 11, 10, 0));
  });
});

describe("catch-up", () => {
  // Created Sep 7 12:00 → slot Sep 8 09:00; "now" is Sep 11, so three days were missed.
  const overdue = (): { st: ScheduleStore; id: string } => {
    const st = new ScheduleStore(tmp());
    const s = st.create(input, new Date(2026, 8, 7, 12));
    return { st, id: s.id };
  };

  it("ask parks the slot, fires nothing, and notifies once for all of them", async () => {
    const { st, id } = overdue();
    const before = st.get(id)!.nextRunAt;
    const { h, calls } = host();
    const sch = new Scheduler(st, h);
    expect(await sch.catchUp()).toEqual([id]);
    expect(st.get(id)!.missed).toEqual({ slotAt: before });
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(calls.filter((c) => c === "notify:missed")).toHaveLength(1);
  });

  it("answering \"run\" fires it once and returns to the usual times", async () => {
    const { st, id } = overdue();
    const { h } = host();
    const sch = new Scheduler(st, h);
    await sch.catchUp();
    await sch.answerMissed(id, "run");
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
    expect(st.get(id)!.missed).toBeUndefined();
    expect(new Date(st.get(id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
    // Fired at `now`, not at the three-day-old slot — the busy gate's two hours
    // start when the user pressed Run now.
  });

  it("answering \"skip\" records the miss and advances", async () => {
    const { st, id } = overdue();
    const { h } = host();
    const sch = new Scheduler(st, h);
    await sch.catchUp();
    await sch.answerMissed(id, "skip");
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(st.get(id)!.missed).toBeUndefined();
    expect(st.get(id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "missed" });
    // The deadline the park set, not advanced a second time by the answer.
    expect(new Date(st.get(id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
  });

  it("always fires exactly ONCE for a three-day gap", async () => {
    const { st, id } = overdue();
    st.update(id, { catchUp: "always" }, new Date(2026, 8, 7, 12));
    const { h } = host();
    await new Scheduler(st, h).catchUp();
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
  });

  it("never only advances, and records the miss", async () => {
    const { st, id } = overdue();
    st.update(id, { catchUp: "never" }, new Date(2026, 8, 7, 12));
    const { h } = host();
    await new Scheduler(st, h).catchUp();
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(st.get(id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "missed" });
  });

  it("an unanswered ask stands until the next slot arrives, however long the app was away", async () => {
    // The regression this pins: measuring the deadline from the MISSED slot
    // instead of from a real future one retired a three-day-old question on the
    // first tick after launch, turning "ask me" into "always" for anyone who
    // took a weekend off.
    const { st, id } = overdue();
    let now = new Date(2026, 8, 10, 10);
    const { h } = host({ now: () => now });
    const sch = new Scheduler(st, h);
    await sch.catchUp();
    expect(new Date(st.get(id)!.nextRunAt!)).toEqual(new Date(2026, 8, 11, 9, 0)); // the deadline
    for (let i = 0; i < 5; i++) await sch.tick();
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(st.get(id)!.missed).toBeDefined();

    now = new Date(2026, 8, 11, 9, 0, 30);
    await sch.tick();
    expect(st.get(id)!.runs.some((r) => r.outcome === "skipped" && r.reason === "unanswered")).toBe(true);
    expect(h.createRunSession).toHaveBeenCalledTimes(1); // the new slot fires normally
    expect(st.get(id)!.missed).toBeUndefined();
  });

  it("answering the ask keeps the usual times — the park already advanced them", async () => {
    const { st, id } = overdue();
    const sch = new Scheduler(st, host().h);
    await sch.catchUp();
    const deadline = st.get(id)!.nextRunAt;
    await sch.answerMissed(id, "skip");
    expect(st.get(id)!.nextRunAt).toBe(deadline); // not advanced twice
  });

  it("an EXPIRED schedule is not caught up — 'stop after the 15th' outranks 'this should have run'", async () => {
    // The regression: close the app over the end date, open it a week later,
    // and the schedule the user had already ended fires once more. Catch-up
    // never consulted `until`.
    const st = new ScheduleStore(tmp());
    const s = st.create({ ...input, catchUp: "always", until: "2026-09-15" }, new Date(2026, 8, 14, 10));
    expect(new Date(st.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 15, 9, 0));
    const now = new Date(2026, 8, 20, 10); // launched five days past the end
    const { h } = host({ now: () => now });
    await new Scheduler(st, h).catchUp();
    expect(h.createRunSession).not.toHaveBeenCalled();
    // And it is retired rather than left due, so the next tick has nothing to do.
    expect(st.get(s.id)!.nextRunAt).toBeNull();
  });

  it("…and it is not PARKED to ask about either — the question is already answered", async () => {
    const st = new ScheduleStore(tmp());
    const s = st.create({ ...input, catchUp: "ask", until: "2026-09-15" }, new Date(2026, 8, 14, 10));
    const now = new Date(2026, 8, 20, 10);
    const { h } = host({ now: () => now });
    expect(await new Scheduler(st, h).catchUp()).toEqual([]);
    expect(st.get(s.id)!.missed).toBeUndefined();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a miss INSIDE its life is still caught up normally", async () => {
    const st = new ScheduleStore(tmp());
    const s = st.create({ ...input, catchUp: "always", until: "2026-09-15" }, new Date(2026, 8, 14, 10));
    const now = new Date(2026, 8, 15, 12); // the 09:00 slot was missed, but the end is 23:59
    const { h } = host({ now: () => now });
    await new Scheduler(st, h).catchUp();
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
    void s;
  });

  it("a second catchUp does not re-park an already-parked schedule", async () => {
    const { st, id } = overdue();
    const sch = new Scheduler(st, host().h);
    await sch.catchUp();
    expect(await sch.catchUp()).toEqual([]);
    expect(st.get(id)!.missed).toBeDefined();
  });
});

describe("runNow", () => {
  const ready = (): { st: ScheduleStore; id: string } => {
    const st = new ScheduleStore(tmp());
    const s = st.create(input, new Date(2026, 8, 11, 12)); // next slot tomorrow — not due
    return { st, id: s.id };
  };

  it("fires immediately when the workspace is free", async () => {
    const { st, id } = ready();
    const { h } = host();
    expect(await new Scheduler(st, h).runNow(id)).toEqual({ ok: true });
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
  });

  it("still respects the busy gate, and says which refusal it is", async () => {
    const { st, id } = ready();
    expect(await new Scheduler(st, host({ workspaceIdle: () => false }).h).runNow(id)).toEqual({ ok: false, reason: "busy" });
    expect(await new Scheduler(st, host().h).runNow("nope")).toEqual({ ok: false, reason: "gone" });
    st.update(id, { enabled: false }, new Date());
    expect(await new Scheduler(st, host().h).runNow(id)).toEqual({ ok: false, reason: "disabled" });
  });
});
