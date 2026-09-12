/**
 * §35 — the on-disk schedules and the one validator every writer goes through.
 *
 * Split from schedules.ts because THAT file must stay import-free: the
 * renderer's copy module imports `humanRecurrence` and the types from it, and a
 * single `import fs` there puts node:fs in the browser bundle. It typechecks and
 * it runs in dev; it fails the production build. Everything that touches the
 * filesystem is here instead.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normPath } from "./store";
import { nextFire, withNextRun, type CatchUp, type Schedule, type ScheduleMode } from "./schedules";

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
  if (!/^\d{1,2}:\d{2}$/.test(at) || Number(at.split(":")[0]) > 23 || Number(at.split(":")[1]) > 59) {
    throw new Error("Give the schedule a time, as HH:MM.");
  }
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
