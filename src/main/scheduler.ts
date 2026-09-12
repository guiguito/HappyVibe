/**
 * §35 — the tick.
 *
 * Pure and electron-free: every effect (creating a session, spawning, prompting,
 * archiving, logging, notifying) arrives as an injected `SchedulerHost`, the
 * same shape `SessionManager` takes its `hibernate` callback in. That is what
 * lets vitest drive the whole fire path — busy gate, catch-up, fail-pause,
 * reuse fallback — without an Electron app or a Pi child.
 *
 * There is no job runner and no second execution engine (§6.4): a scheduled run
 * IS a session, so this file decides only WHEN and hands the rest to ipc.ts.
 */
import {
  applyOutcome, BUSY_WAIT_MS, catchUpDecision, runTitle, withNextRun,
  type Schedule, type ScheduleRun, type ScheduleStore,
} from "./schedules";

export interface SchedulerHost {
  now(): Date;
  workspaceExists(ws: string): boolean;
  /** Every live session of that workspace is idle — they share one working tree (§5.2). */
  workspaceIdle(ws: string): boolean;
  sessionExists(id: string): boolean;
  /** Creates the run's session and spawns it (read-only clamped per the schedule's mode). Throws if the spawn is refused. */
  createRunSession(s: Schedule, title: string): Promise<string>;
  /** Wakes the reused session. Throws if it is gone. */
  resumeSession(id: string): Promise<void>;
  /** Archives the previous run unless the user adopted it (§4.4). Owns that judgment — it owns SessionMeta. */
  archivePreviousRun(s: Schedule): Promise<void>;
  prompt(sessionId: string, text: string): Promise<void>;
  log(type: ScheduleEventType, s: Schedule, data: Record<string, unknown>): void;
  notify(kind: "done" | "needs_you" | "missed", s: Schedule, extra: NotifyExtra): void;
  changed(): void;
}

export type ScheduleEventType = "schedule.fire" | "schedule.skip" | "schedule.done" | "schedule.missed";
export interface NotifyExtra { sessionId?: string; count?: number; durationMs?: number; costUsd?: number }

export class Scheduler {
  /**
   * Runs that have been prompted and not yet ended, by session id.
   *
   * In memory rather than on the schedule, deliberately: a run whose app quit
   * mid-turn has no outcome anyone can record, and a persisted "in flight"
   * marker would come back on the next launch as a run that never ends. The
   * cost of forgetting is one missing history row; the cost of remembering
   * wrongly is a schedule that looks permanently busy.
   */
  private readonly inflight = new Map<string, { scheduleId: string; firedAt: string; needsYouSent: boolean }>();

  constructor(
    private readonly store: ScheduleStore,
    private readonly host: SchedulerHost,
  ) {}

  /** One minute's work. Safe to call more often; a slot fires at most once. */
  async tick(): Promise<void> {
    const now = this.host.now();
    for (const s of this.store.list()) {
      if (!s.enabled || !s.nextRunAt) continue;
      const due = new Date(s.nextRunAt) <= now;
      if (!due) continue;
      if (s.missed) {
        // §5.3: an unanswered ask never fires and never nags — it waits until
        // the schedule's NEXT slot arrives, at which point the question is moot.
        // `nextRunAt` was advanced to a real future slot when the ask was
        // parked, so its arrival IS that moment. Record the miss, drop the
        // question, and let the new slot fire normally below.
        const retired = applyOutcome({ ...s, missed: undefined }, { firedAt: s.missed.slotAt, outcome: "skipped", reason: "unanswered" });
        this.store.replace(retired);
        this.host.log("schedule.missed", retired, { reason: "unanswered", slotAt: s.missed.slotAt });
        this.host.changed();
        await this.fire(retired, new Date(s.nextRunAt));
        continue;
      }
      await this.fire(s, new Date(s.nextRunAt));
    }
  }

  /**
   * Launch and wake: decide what to do about every slot that passed while the
   * app was closed or the Mac asleep. Returns the ids parked for asking.
   */
  async catchUp(): Promise<string[]> {
    const now = this.host.now();
    const parked: string[] = [];
    for (const s of this.store.list()) {
      const d = catchUpDecision(s, now);
      if (d.kind === "none") continue;
      if (d.kind === "fire") {
        await this.fire(s, new Date(s.nextRunAt!));
      } else if (d.kind === "advance") {
        this.record(s, { firedAt: s.nextRunAt!, outcome: "skipped", reason: "missed" }, { advance: true });
        // (advance:true — nothing has moved nextRunAt here, unlike the park path.)
        this.host.log("schedule.missed", s, { reason: "skipped", slotAt: s.nextRunAt });
      } else {
        // Parking ADVANCES nextRunAt to the next future slot, which is what
        // gives the question a deadline: the ask stands until that slot arrives.
        this.store.replace(withNextRun({ ...s, missed: { slotAt: d.slotAt } }, now));
        this.host.changed();
        this.host.log("schedule.missed", s, { reason: "asking", slotAt: d.slotAt });
        parked.push(s.id);
      }
    }
    if (parked.length) {
      const first = this.store.get(parked[0]!)!;
      this.host.notify("missed", first, { count: parked.length });
    }
    return parked;
  }

  /** The user answered the missed-runs dialog. One decision path for a row and for "Run all". */
  async answerMissed(id: string, answer: "run" | "skip"): Promise<void> {
    const s = this.store.get(id);
    if (!s?.missed) return;
    const slotAt = s.missed.slotAt;
    const cleared: Schedule = { ...s, missed: undefined };
    if (answer === "run") {
      this.store.replace(cleared);
      // `now` is the slot, not the missed one: the busy gate's two hours start
      // when the user asked for it, not three days ago.
      await this.fire(cleared, this.host.now());
    } else {
      // No `advance` — parking already moved nextRunAt to the next future slot.
      this.record(cleared, { firedAt: slotAt, outcome: "skipped", reason: "missed" });
      this.host.log("schedule.missed", s, { reason: "skipped", slotAt });
    }
    this.host.changed();
  }

  /**
   * "Run now" from the page. Deliberately keeps the busy gate: the tree is
   * shared whoever pressed the button, and a run that edits under a session
   * someone is using is the failure this gate exists for.
   */
  async runNow(id: string): Promise<{ ok: true } | { ok: false; reason: "busy" | "disabled" | "gone" }> {
    const s = this.store.get(id);
    if (!s) return { ok: false, reason: "gone" };
    if (!s.enabled) return { ok: false, reason: "disabled" };
    if (!this.host.workspaceExists(s.workspaceId)) return { ok: false, reason: "gone" };
    if (!this.host.workspaceIdle(s.workspaceId)) return { ok: false, reason: "busy" };
    await this.fire(s, this.host.now());
    return { ok: true };
  }

  private async fire(s: Schedule, slot: Date): Promise<void> {
    const now = this.host.now();
    if (!s.enabled) return;
    if (!this.host.workspaceExists(s.workspaceId)) {
      // Disabled rather than left to retry forever: the folder is gone, and a
      // row saying so is more use than one that silently never runs again.
      this.record(s, { firedAt: slot.toISOString(), outcome: "skipped", reason: "workspace-gone" }, { advance: true, patch: { enabled: false } });
      this.host.log("schedule.skip", s, { reason: "workspace-gone" });
      return;
    }
    if (!this.host.workspaceIdle(s.workspaceId)) {
      // WAIT rather than skip: nextRunAt is left alone so the next tick retries.
      if (now.getTime() - slot.getTime() < BUSY_WAIT_MS) return;
      this.record(s, { firedAt: slot.toISOString(), outcome: "skipped", reason: "busy" }, { advance: true });
      this.host.log("schedule.skip", s, { reason: "busy" });
      return;
    }

    // Advance FIRST. A crash anywhere below must not leave this slot due, or the
    // next tick re-fires it and a broken schedule becomes a loop that spends money.
    let cur = withNextRun({ ...s, missed: undefined }, now);
    this.store.replace(cur);
    const firedAt = now.toISOString();
    try {
      let sessionId: string;
      const data: Record<string, unknown> = {};
      if (cur.reuseSession && cur.reusedSessionId && this.host.sessionExists(cur.reusedSessionId)) {
        sessionId = cur.reusedSessionId;
        await this.host.resumeSession(sessionId);
      } else if (cur.reuseSession) {
        // The reused session is gone (deleted by the user, or unreadable). Start
        // a fresh one and say so on the row — silently losing the accumulated
        // context is exactly the thing this mode was chosen for.
        sessionId = await this.host.createRunSession(cur, cur.title);
        cur = { ...cur, reusedSessionId: sessionId };
        this.store.replace(cur);
        data.reusedSessionRecreated = true;
      } else {
        await this.host.archivePreviousRun(cur);
        sessionId = await this.host.createRunSession(cur, runTitle(cur.title, now));
      }
      this.inflight.set(sessionId, { scheduleId: cur.id, firedAt, needsYouSent: false });
      await this.host.prompt(sessionId, cur.prompt);
      this.host.log("schedule.fire", cur, { sessionId, mode: cur.mode, ...data });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.record(this.store.get(cur.id) ?? cur, { firedAt, outcome: "failed", reason });
      this.host.log("schedule.done", cur, { outcome: "failed", reason });
    }
    this.host.changed();
  }

  /**
   * Write an outcome.
   *
   * `advance` is opt-in and that is not tidiness: nextRunAt is computed at FIRE
   * time, so recomputing it when a run ENDS would move an hourly schedule's
   * 10:00 slot to 11:00 just because the 09:00 run finished at 10:05. Only the
   * paths that never fired (skips, misses) may advance — plus a pause, where
   * "next run" must become nothing at all.
   */
  private record(s: Schedule, run: ScheduleRun, opts: { advance?: boolean; patch?: Partial<Schedule> } = {}): void {
    let next: Schedule = { ...applyOutcome(s, run), ...opts.patch };
    if (opts.advance || !next.enabled) next = withNextRun(next, this.host.now());
    this.store.replace(next);
    this.host.changed();
  }

  /** The turn ended cleanly. Called by ipc.ts from the session's own event stream. */
  onAgentEnd(sessionId: string, durationMs: number, costUsd?: number): void {
    const f = this.inflight.get(sessionId);
    if (!f) return; // not a run, or the run's outcome is already recorded
    this.inflight.delete(sessionId);
    const s = this.store.get(f.scheduleId);
    if (!s) return;
    this.record(s, { sessionId, firedAt: f.firedAt, outcome: "ok", durationMs, ...(costUsd !== undefined ? { costUsd } : {}) });
    this.host.log("schedule.done", s, { outcome: "ok", durationMs, sessionId });
    if (s.notifyOnDone) this.host.notify("done", s, { sessionId, durationMs, costUsd });
  }

  /** The child died before ending its turn. */
  onSessionCrash(sessionId: string, error: string): void {
    const f = this.inflight.get(sessionId);
    if (!f) return;
    this.inflight.delete(sessionId);
    const s = this.store.get(f.scheduleId);
    if (!s) return;
    this.record(s, { sessionId, firedAt: f.firedAt, outcome: "failed", reason: error });
    this.host.log("schedule.done", s, { outcome: "failed", reason: error, sessionId });
  }

  /**
   * The run raised a permission prompt. Once per run: an unattended run can ask
   * a dozen times and the user needs telling once.
   */
  onNeedsYou(sessionId: string): void {
    const f = this.inflight.get(sessionId);
    if (!f || f.needsYouSent) return;
    f.needsYouSent = true;
    const s = this.store.get(f.scheduleId);
    if (s) this.host.notify("needs_you", s, { sessionId });
  }

  scheduleOfSession(sessionId: string): Schedule | undefined {
    const f = this.inflight.get(sessionId);
    return f ? this.store.get(f.scheduleId) : undefined;
  }
}
