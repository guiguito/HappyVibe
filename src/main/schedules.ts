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
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normPath } from "./store";

export type Repeat =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; days: number[] }      // 0 = Sunday … 6 = Saturday
  | { kind: "hours"; every: number }        // 1..23
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
    case "hours": {
      const every = Math.floor(repeat.every);
      if (!Number.isFinite(every) || every < 1 || every > 23) return null;
      // Slots are `at` + k·every WITHIN a day; the series restarts at `at` each
      // day rather than free-running, so "every 6 hours from 1:00" is always
      // 1:00/7:00/13:00/19:00 and never drifts.
      for (let dayOff = 0; dayOff < 2; dayOff++) {
        const start = atOn(addDays(after, dayOff), t.h, t.m);
        for (let k = 0; k * every < 24; k++) {
          const c = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + k * every, start.getMinutes(), 0, 0);
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
 * Recompute `nextRunAt`, and retire a parked "ask me" whose moment has passed.
 *
 * An unanswered ask never fires and never nags (§5.3): it waits until the
 * schedule's NEXT slot arrives, at which point the question is moot — the miss
 * is recorded as `skipped: unanswered` and the new slot takes over.
 */
export function withNextRun(s: Schedule, now: Date): Schedule {
  let out = s;
  if (s.missed) {
    const supersededBy = nextFire(s.repeat, s.at, new Date(s.missed.slotAt));
    if (supersededBy && supersededBy <= now) {
      out = applyOutcome({ ...out, missed: undefined }, { firedAt: s.missed.slotAt, outcome: "skipped", reason: "unanswered" });
    }
  }
  const next = out.enabled ? nextFire(out.repeat, out.at, now) : null;
  return { ...out, nextRunAt: next ? next.toISOString() : null };
}

export type NewSchedule = Omit<Schedule, "id" | "createdAt" | "nextRunAt" | "failStreak" | "runs">;

const MODES: ScheduleMode[] = ["readonly", "full"];
const CATCH_UPS: CatchUp[] = ["ask", "always", "never"];

/**
 * The trust boundary for everything that reaches the store: the drawer, the IPC
 * handler and (through the drawer) the model's proposal. Throws a sentence the
 * UI can show rather than returning a flag nobody checks.
 */
export function validateScheduleInput(input: Partial<NewSchedule>, workspaces: string[]): NewSchedule {
  const title = (input.title ?? "").trim();
  if (!title || title.length > 120) throw new Error("Give the schedule a title (120 characters or fewer).");
  const prompt = (input.prompt ?? "").trim();
  if (!prompt || prompt.length > 20_000) throw new Error("Give the schedule a prompt (20,000 characters or fewer).");
  const ws = workspaces.find((w) => normPath(w) === normPath(input.workspaceId ?? ""));
  if (!ws) throw new Error("Pick a workspace HappyVibe still knows about.");
  const at = input.at ?? "";
  if (!parseAt(at)) throw new Error("Give the schedule a time, as HH:MM.");
  const repeat = input.repeat;
  if (!repeat || typeof repeat !== "object") throw new Error("Pick how often it repeats.");
  if (repeat.kind === "weekly" && !(Array.isArray(repeat.days) && repeat.days.some((d) => Number.isInteger(d) && d >= 0 && d <= 6))) {
    throw new Error("Pick at least one day of the week.");
  }
  // nextFire is the parser: a repeat it cannot turn into a slot is one the tick
  // would silently ignore forever. `once` in the past is legal here (the drawer
  // shows "once, done"); everything else must produce a slot.
  if (repeat.kind !== "once" && nextFire(repeat, at, new Date()) === null) throw new Error("That repeat is not one HappyVibe can run.");
  const mode = input.mode ?? "full";
  if (!MODES.includes(mode)) throw new Error("Pick a mode: read-only or full.");
  const catchUp = input.catchUp ?? "ask";
  if (!CATCH_UPS.includes(catchUp)) throw new Error("Pick what happens when it misses its time.");
  return {
    title, prompt, workspaceId: ws, repeat, at, mode,
    reuseSession: !!input.reuseSession,
    ...(input.reusedSessionId ? { reusedSessionId: input.reusedSessionId } : {}),
    ...(input.model ? { model: input.model } : {}),
    notifyOnDone: input.notifyOnDone ?? true,
    catchUp,
    enabled: input.enabled ?? true,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  };
}

// ponytail: the same twelve lines as store.ts's private helpers. Exporting them
// from store.ts would make this file import the session index to write a
// different file; a copy is the smaller coupling.
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * `<userData>/schedules.json`, rewritten whole on every mutation — the same
 * pattern as SessionIndex.
 *
 * ponytail: documented ceiling — this is O(n) per write and fine into the
 * hundreds. If someone ever has thousands of schedules, the fix is a real
 * database for sessions AND schedules together, not a clever one here.
 */
export class ScheduleStore {
  private items: Schedule[];

  constructor(private readonly file: string) {
    const raw = readJson<unknown>(file, []);
    this.items = Array.isArray(raw) ? (raw as Schedule[]) : [];
  }

  private save(): void {
    writeJson(this.file, this.items);
  }

  list(): Schedule[] {
    return [...this.items];
  }

  get(id: string): Schedule | undefined {
    return this.items.find((s) => s.id === id);
  }

  create(input: NewSchedule, now: Date): Schedule {
    const s = withNextRun({ ...input, id: randomUUID(), createdAt: now.toISOString(), nextRunAt: null, failStreak: 0, runs: [] }, now);
    this.items.push(s);
    this.save();
    return s;
  }

  /** Editing recomputes the next run; it never touches past runs. Re-enabling clears a fail-pause. */
  update(id: string, patch: Partial<Omit<Schedule, "id" | "createdAt">>, now: Date): Schedule | undefined {
    const i = this.items.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    const merged = { ...this.items[i]!, ...patch, ...(patch.enabled === true ? { failStreak: 0 } : {}) };
    this.items[i] = withNextRun(merged, now);
    this.save();
    return this.items[i];
  }

  /** Whole-record write for the scheduler's own bookkeeping, which has already computed nextRunAt. */
  replace(s: Schedule): void {
    const i = this.items.findIndex((x) => x.id === s.id);
    if (i >= 0) {
      this.items[i] = s;
      this.save();
    }
  }

  remove(id: string): void {
    this.items = this.items.filter((s) => s.id !== id);
    this.save();
  }
}
