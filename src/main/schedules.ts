/**
 * §35 Schedules — the pure half: recurrence math, catch-up policy, outcome
 * bookkeeping and the on-disk store. Electron-free, so vitest drives it directly.
 *
 * ALL arithmetic is LOCAL wall-clock, built with the `Date(y, m, d, h, min)`
 * constructor rather than by adding milliseconds. That is the whole DST story:
 * a 9:00 review is at 9:00 the day after the clocks change, because the wall
 * clock is what the user set. Adding 24*3600*1000 would drift it by an hour
 * twice a year and nothing would say so.
 *
 * There is no cron library, deliberately (§6.4): five recurrence kinds are a
 * switch, not a grammar, and a cron string is a syntax the user would have to
 * learn to read their own schedule back.
 *
 * This file imports NOTHING — not even node builtins — and that is load-bearing
 * rather than tidy: the renderer's copy module needs `humanRecurrence` and these
 * types, and an `import fs` here put `node:fs` in the browser bundle and failed
 * the production build (dev was perfectly happy). The store and the input
 * validator live in scheduleStore.ts for that reason.
 */

export type Repeat =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; days: number[] }      // 0 = Sunday … 6 = Saturday
  | { kind: "hours"; every: number }        // 1..23
  /**
   * 1..59. The tick is every 60 s, so one minute is the floor the scheduler can
   * actually honour — anything finer would silently round up to it.
   */
  | { kind: "minutes"; every: number }
  | { kind: "once"; date: string };         // YYYY-MM-DD

export type ScheduleMode = "readonly" | "full";
export type CatchUp = "ask" | "always" | "never";
export type RunOutcome = "ok" | "needs_you" | "failed" | "skipped";

export interface ScheduleRun {
  sessionId?: string;
  firedAt: string;
  outcome: RunOutcome;
  reason?: string;
  durationMs?: number;
  /** Undefined means UNKNOWN, never zero (§19 ruling 3a) — the row omits the figure. */
  costUsd?: number;
}

export interface Schedule {
  id: string;
  title: string;
  prompt: string;
  /** Absolute workspace path, normalised by the registry — never compared raw. */
  workspaceId: string;
  repeat: Repeat;
  at: string;                 // "HH:MM", local
  mode: ScheduleMode;
  reuseSession: boolean;
  /** Only when reuseSession: the one session every run prompts again. */
  reusedSessionId?: string;
  model?: { provider: string; modelId: string };
  notifyOnDone: boolean;
  catchUp: CatchUp;
  /** Set only while an "ask me" is waiting; cleared on answer or when the next slot arrives. */
  missed?: { slotAt: string };
  enabled: boolean;
  createdAt: string;
  /** ISO; null when disabled or once-and-done. */
  nextRunAt: string | null;
  failStreak: number;
  runs: ScheduleRun[];
  createdBy?: { source: "agent"; sessionId: string };
}

export const FAIL_PAUSE_AT = 3;
/** How long past its slot a run waits for a busy workspace before giving up (§5.2). */
export const BUSY_WAIT_MS = 2 * 60 * 60 * 1000;
export const MAX_RUNS = 20;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseAt(at: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/** The given wall-clock time on the same calendar day as `d`. */
const atOn = (d: Date, h: number, m: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0, 0);

/** The first slot strictly after `after`, or null when there will never be one. */
export function nextFire(repeat: Repeat, at: string, after: Date): Date | null {
  const t = parseAt(at);
  if (!t) return null;
  switch (repeat.kind) {
    case "daily":
    case "weekdays":
    case "weekly": {
      const allowed =
        repeat.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6]
        : repeat.kind === "weekdays" ? [1, 2, 3, 4, 5]
        : [...new Set(repeat.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (allowed.length === 0) return null;
      for (let i = 0; i < 8; i++) {
        const day = addDays(after, i);
        const c = atOn(day, t.h, t.m);
        if (c > after && allowed.includes(c.getDay())) return c;
      }
      return null;
    }
    case "hours":
    case "minutes": {
      const every = Math.floor(repeat.every);
      const max = repeat.kind === "hours" ? 23 : 59;
      if (!Number.isFinite(every) || every < 1 || every > max) return null;
      const stepMinutes = repeat.kind === "hours" ? every * 60 : every;
      // Slots are `at` + k·every WITHIN a day; the series restarts at `at` each
      // day rather than free-running, so "every 6 hours from 1:00" is always
      // 1:00/7:00/13:00/19:00 and never drifts — and "every 5 minutes from
      // 9:00" lands on :00/:05/:10 rather than wherever the app happened to
      // start.
      for (let dayOff = 0; dayOff < 2; dayOff++) {
        const start = atOn(addDays(after, dayOff), t.h, t.m);
        for (let k = 0; k * stepMinutes < 24 * 60; k++) {
          const c = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes() + k * stepMinutes, 0, 0);
          if (k > 0 && c.getDate() !== start.getDate()) break; // past midnight — that is the next day's series
          if (c > after) return c;
        }
      }
      return null;
    }
    case "once": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(repeat.date);
      if (!m) return null;
      const c = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t.h, t.m, 0, 0);
      return c > after ? c : null;
    }
  }
}

const clock = (at: string): string => {
  const t = parseAt(at);
  return t ? `${t.h}:${String(t.m).padStart(2, "0")}` : at;
};

export function humanRecurrence(repeat: Repeat, at: string): string {
  switch (repeat.kind) {
    case "daily": return `Every day at ${clock(at)}`;
    case "weekdays": return `Weekdays at ${clock(at)}`;
    case "weekly": return `${repeat.days.map((d) => DAY[d]).join(", ")} at ${clock(at)}`;
    case "hours": return repeat.every === 1 ? "Every hour" : `Every ${repeat.every} hours from ${clock(at)}`;
    case "minutes": return repeat.every === 1 ? "Every minute" : `Every ${repeat.every} minutes from ${clock(at)}`;
    case "once": {
      const [, m, d] = repeat.date.split("-").map(Number);
      return `Once, ${MON[(m ?? 1) - 1]} ${d} at ${clock(at)}`;
    }
  }
}

/** A run session's title. Dated, so thirty daily runs are thirty distinguishable rows. */
export function runTitle(title: string, firedAt: Date): string {
  return `${title} · ${MON[firedAt.getMonth()]} ${firedAt.getDate()}`;
}

/**
 * Roughly how often a schedule fires in a day — for the drawer's own warning.
 *
 * A run is a real session with a real bill, so "every 5 minutes" is 288 of them
 * and the user deserves to read that number BEFORE pressing Create rather than
 * on the row afterwards. Null when the answer is not a per-day count.
 */
export function runsPerDay(repeat: Repeat): number | null {
  if (repeat.kind === "minutes") return Math.floor((24 * 60) / repeat.every);
  if (repeat.kind === "hours") return Math.floor(24 / repeat.every);
  return null;
}

export type CatchUpDecision =
  | { kind: "fire" }
  | { kind: "park"; slotAt: string }
  | { kind: "advance" }
  | { kind: "none" };

/**
 * What to do about a schedule whose slot passed while the app was closed.
 *
 * "always" fires ONCE however long the gap — three days away is one run, not
 * three, because the user wanted a daily review, not a backlog.
 */
export function catchUpDecision(s: Schedule, now: Date): CatchUpDecision {
  if (!s.enabled || !s.nextRunAt || s.missed) return { kind: "none" };
  if (new Date(s.nextRunAt) > now) return { kind: "none" };
  if (s.catchUp === "always") return { kind: "fire" };
  if (s.catchUp === "never") return { kind: "advance" };
  return { kind: "park", slotAt: s.nextRunAt };
}

export function applyOutcome(s: Schedule, run: ScheduleRun): Schedule {
  const runs = [...s.runs, run].slice(-MAX_RUNS);
  let failStreak = s.failStreak;
  if (run.outcome === "ok" || run.outcome === "needs_you") failStreak = 0;
  else if (run.outcome === "failed") failStreak += 1;
  // The money guard: a schedule that has failed three times in a row is failing
  // for a reason that will not fix itself (no key, no model, a dead provider).
  const enabled = failStreak >= FAIL_PAUSE_AT ? false : s.enabled;
  return { ...s, runs, failStreak, enabled };
}

/**
 * Recompute `nextRunAt` — the next FUTURE slot, or null when the schedule is off
 * or a `once` whose day has gone.
 *
 * It deliberately leaves `missed` alone. A parked "ask me" is retired by the
 * scheduler when `nextRunAt` actually arrives, and that is the whole reason
 * parking advances this field: measuring "has the next slot arrived?" from the
 * MISSED slot instead would retire a three-day-old question one tick after the
 * app launched, turning "ask me" into "always" for anyone away for a weekend.
 */
export function withNextRun(s: Schedule, now: Date): Schedule {
  const next = s.enabled ? nextFire(s.repeat, s.at, now) : null;
  return { ...s, nextRunAt: next ? next.toISOString() : null };
}
