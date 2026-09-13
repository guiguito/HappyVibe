# Schedules (PRD §35) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRD §35 — a Schedule is a prompt + workspace + time; when it fires, main opens an ordinary session and sends the prompt — plus the two mechanisms the code demanded: a spawn-time **read-only run mode** in the bridge, and **pending-prompt replay** so a permission raised with no window open is answerable later.

**Architecture:** Pure schedule math and a `Scheduler` class with injected callbacks live in `src/main/schedules.ts` / `src/main/scheduler.ts` (electron-free, vitest-driven); `ipc.ts` supplies the callbacks from things it already owns (`index.create`, `startClient`, the factored `promptSession`, `endSession`, `log.append`). A run is a `SessionMeta` with `scheduleId`. The bridge gains `hv-readonly.ts` (reuses `gatePlanCall`) and four `schedule_*` tools on the §33 memory-envelope pattern. The renderer gains a top-level sidebar row, `SchedulesView`, `ScheduleDrawer`, a missed-runs dialog and a Read-only pill.

**Tech Stack:** Electron 44 main (`powerMonitor`, `Notification`, `app.setLoginItemSettings`), React + Tailwind renderer (no DOM in tests — pure exports + source scans), vitest, TypeBox (bridge tool schemas, `typebox` pinned to Pi's), Pi RPC.

**Spec:** Notion "Automations/Schedules" (`3d8d33dfffca800ab977dbb336af25c0`, all 12 decisions locked 2026-09-12); PRD `docs/prd.md` §35 (+ §17 fold). Read both before starting.

## Global Constraints

- **A run IS a session.** No second run store, runner or "Runs" page. Runs are `SessionMeta` rows with `scheduleId`; the schedule keeps `runs[]` (last 20) of session ids + outcomes.
- **Permissions never widen.** Full = workspace rules verbatim. Read-only = `HV_READONLY=1` at spawn → bridge clamp via `gatePlanCall` BEFORE the bypass check + `READONLY_BLOCKED` (plan tools + schedule writers) blocked outright. No per-schedule bypass: `tests/schedules-source.test.ts` scans for a `bypass` key on `Schedule`.
- **Read-only mode is independent of `builtins.plan`** and has no `/hv-*` command and no toggle. Its wiring must sit OUTSIDE the `if (builtins.plan)` blocks in `happyvibe-bridge.ts` (source-scanned).
- **The four `schedule_*` tools are a Built-in tools row** `builtinTools.schedules` (default on). The scheduler itself is never gated by it.
- **`schedule_create/update` never write without the drawer**, even under bypass. Main ALWAYS `respondUi`s every `hv.schedule-*` envelope (the `hv.plan-write` rule) — a missed response hangs the bridge.
- **Workspace scoping is main's job.** No `workspaceId` parameter on any tool; a foreign id answers `not found`. Compare with `sessionsOfWorkspace`/`normPath`, never raw strings.
- **The busy gate** is `activity.isIdle` over every live session of the workspace; a run waits up to **2 h** past its slot then `schedule.skip busy`.
- **Catch-up:** `ask` (default) parks `missed:{slotAt}` and fires nothing; `always` fires ONCE per gap; `never` advances. One dialog for all missed. Unanswered `ask` → `skipped unanswered` when the next slot arrives.
- **Fail-pause at 3** consecutive `failed` outcomes; `ok` resets `failStreak`.
- **Cost is never priced here**: rows read `sessionCalls`+`ledgerTotal` (the cost bubble's source). Unknown ⇒ omit the number.
- **Sidebar:** a top-level row under the search field, NOT a `NAV` entry. `tests/sidebar-groups.test.ts` keeps `NAV` at 18 and asserts `"schedules"` absent + `groupFor("schedules") === null`.
- **Copy:** `EMPTY_COPY.schedules` must have a call site (`tests/empty-state.test.ts`). App word is **Schedules**; never "automation", "cron", "job".
- **Every `schedule.*` EventLog row** uses the frozen envelope `{ts,type,sessionId?,workspaceId?,data?}`; AuditView labels it; `analytics.ts` gets a no-op case.
- **Login-item toggle hides in dev** (`app.isPackaged === false`): `setLoginItemSettings` would register the Electron dev binary.
- **`navigate("schedules")` must not open the Settings group** (`App.navigate` does `setSettingsOpen(true)` for every non-chat view today).
- **Gate:** `npm run gate`; `npm run live:why` WILL print (bridge + `spawn.ts` change) ⇒ `npm run test:live` (background it, ~6 min; check `pgrep -fl "npm run dev"` first; read the wall time). Two new live files must be `skipIf(!KEY)` and import `{ KEY, MODEL, PROVIDER_ENV }` from `tests/liveModel.ts`.
- **Commits:** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `guiguito/schedules` (this worktree).

---

## File map

**Main — new**
| File | Responsibility | Electron-free? |
|---|---|---|
| `src/main/schedules.ts` | `Schedule` type, `nextFire`, `humanRecurrence`, `runTitle`, `catchUpDecision`, `applyOutcome`, `ScheduleStore` | yes |
| `src/main/scheduler.ts` | `Scheduler` class: tick, busy-wait, catch-up, missed answers, run-now; all effects via injected `SchedulerHost` | yes |
| `src/main/pendingPrompts.ts` | `PendingPrompts`: blocking envelopes retained for replay + counts | yes |
| `src/main/scheduleEnvelopes.ts` | `parseScheduleEnvelope` for the four `hv.schedule-*` tool payloads | yes |

**Main — modified:** `src/main/store.ts` (+`scheduleId?`), `src/main/pi/spawn.ts` (+`readonly`, +`schedules` in builtinTools), `src/main/config.ts` (+`schedules` toggle), `src/main/ipc.ts` (promptSession factoring, scheduler host, envelopes, pending replay, IPC, notifications, login item), `src/main/analytics.ts`, `src/main/index.ts` (nothing — scheduler starts inside `registerIpc`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`.

**Bridge — new:** `pi-runtime/extensions/hv-readonly.ts`. **Modified:** `happyvibe-bridge.ts` (readonly clamp + prompt block + notify; four tools), `hv-builtins.ts` (+`schedules`), `hv-rules.ts` (`schedule_list` in `SAFE_TOOLS`).

**Renderer — new:** `components/SchedulesView.tsx`, `components/ScheduleDrawer.tsx`, `components/MissedRunsDialog.tsx`, `schedulesCopy.ts` (templates, `REPEAT_LABELS`, `OUTCOME_MARK`, `CATCH_UP_LABELS`, `MODE_CARDS`). **Modified:** `Sidebar.tsx` (View union, row, rail button, clock glyph), `App.tsx`, `ChatView.tsx` (Read-only pill, ＋ menu item), `TabStrip.tsx` (menu item), `EmptyState.tsx`, `BuiltinToolsBlock.tsx`, `AuditView.tsx`.

**Tests — new:** `tests/schedules.test.ts`, `tests/schedules-store.test.ts`, `tests/scheduler.test.ts`, `tests/hv-readonly.test.ts`, `tests/pending-replay.test.ts`, `tests/schedules-tools.test.ts`, `tests/schedules-source.test.ts`, `tests/schedules-renderer.test.ts`, `tests/readonly-bridge.test.ts` (live), `tests/schedules-bridge.test.ts` (live). **Extended:** `tests/mcp-spawn.test.ts`, `tests/hv-builtins.test.ts`, `tests/sidebar-groups.test.ts`, `tests/builtins-contract.test.ts` (tool names), `tests/empty-state.test.ts` (automatic).

**Docs:** `docs/validation/d1.md` (§35 wire shapes), `CLAUDE.md` (two gotchas), memory note.

---
### Task 1: Pure schedule math — `src/main/schedules.ts`

**Files:**
- Create: `src/main/schedules.ts`
- Test: `tests/schedules.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 6, 7, 8):
```ts
export type Repeat =
  | { kind: "daily" } | { kind: "weekdays" }
  | { kind: "weekly"; days: number[] }          // 0=Sun..6=Sat, non-empty
  | { kind: "hours"; every: number }            // 1..23
  | { kind: "once"; date: string };             // YYYY-MM-DD
export type ScheduleMode = "readonly" | "full";
export type CatchUp = "ask" | "always" | "never";
export type RunOutcome = "ok" | "needs_you" | "failed" | "skipped";
export interface ScheduleRun { sessionId?: string; firedAt: string; outcome: RunOutcome; reason?: string; durationMs?: number; costUsd?: number }
export interface Schedule {
  id: string; title: string; prompt: string; workspaceId: string;
  repeat: Repeat; at: string;                    // "HH:MM" local
  mode: ScheduleMode; reuseSession: boolean; reusedSessionId?: string;
  model?: { provider: string; modelId: string };
  notifyOnDone: boolean; catchUp: CatchUp; missed?: { slotAt: string };
  enabled: boolean; createdAt: string; nextRunAt: string | null;
  failStreak: number; runs: ScheduleRun[];
  createdBy?: { source: "agent"; sessionId: string };
}
export const FAIL_PAUSE_AT = 3;
export const BUSY_WAIT_MS = 2 * 60 * 60 * 1000;
export const MAX_RUNS = 20;
export function nextFire(repeat: Repeat, at: string, after: Date): Date | null;
export function humanRecurrence(repeat: Repeat, at: string): string;   // "Weekdays at 9:00"
export function runTitle(title: string, firedAt: Date): string;         // "Daily change review · Sep 11"
export type CatchUpDecision = { kind: "fire" } | { kind: "park"; slotAt: string } | { kind: "advance" } | { kind: "none" };
export function catchUpDecision(s: Schedule, now: Date): CatchUpDecision;
export function applyOutcome(s: Schedule, run: ScheduleRun): Schedule;   // pushes run (cap MAX_RUNS), failStreak, pause
export function withNextRun(s: Schedule, now: Date): Schedule;           // recompute nextRunAt; clears a stale `missed`
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/schedules.test.ts
import { describe, expect, it } from "vitest";
import { applyOutcome, catchUpDecision, FAIL_PAUSE_AT, humanRecurrence, nextFire, runTitle, withNextRun, type Schedule } from "../src/main/schedules";

// All dates are LOCAL wall-clock (the spec: "Local time, DST follows the wall clock").
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

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
    // 2026-09-11 is a Friday
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
  it("once: null when the slot has passed", () => {
    expect(nextFire({ kind: "once", date: "2026-09-10" }, "09:00", local(2026, 9, 11))).toBeNull();
    expect(nextFire({ kind: "once", date: "2026-09-12" }, "09:00", local(2026, 9, 11))).toEqual(local(2026, 9, 12, 9, 0));
  });
  it("month end and year end roll over", () => {
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 9, 30, 10, 0))).toEqual(local(2026, 10, 1, 9, 0));
    expect(nextFire({ kind: "daily" }, "09:00", local(2026, 12, 31, 10, 0))).toEqual(local(2027, 1, 1, 9, 0));
  });
  it("DST: the wall-clock hour is kept across the spring and fall changes (Europe/Paris 2026: Mar 29 / Oct 25)", () => {
    // Runs meaningfully only when the test host observes DST; the assertion is on HOURS, never on ms deltas.
    const n1 = nextFire({ kind: "daily" }, "09:00", local(2026, 3, 28, 10, 0))!;
    expect([n1.getDate(), n1.getHours(), n1.getMinutes()]).toEqual([29, 9, 0]);
    const n2 = nextFire({ kind: "daily" }, "09:00", local(2026, 10, 24, 10, 0))!;
    expect([n2.getDate(), n2.getHours(), n2.getMinutes()]).toEqual([25, 9, 0]);
  });
  it("rejects a malformed time", () => {
    expect(nextFire({ kind: "daily" }, "9am", local(2026, 9, 11))).toBeNull();
  });
});

describe("humanRecurrence / runTitle", () => {
  it("speaks the drawer's words", () => {
    expect(humanRecurrence({ kind: "daily" }, "09:00")).toBe("Every day at 9:00");
    expect(humanRecurrence({ kind: "weekdays" }, "09:05")).toBe("Weekdays at 9:05");
    expect(humanRecurrence({ kind: "weekly", days: [1, 3] }, "18:00")).toBe("Mon, Wed at 18:00");
    expect(humanRecurrence({ kind: "hours", every: 1 }, "00:00")).toBe("Every hour");
    expect(humanRecurrence({ kind: "hours", every: 6 }, "01:00")).toBe("Every 6 hours from 1:00");
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
  it("withNextRun clears a parked ask once its slot is superseded (recorded as skipped unanswered)", () => {
    const parked = base({ missed: { slotAt: local(2026, 9, 10, 9).toISOString() }, nextRunAt: local(2026, 9, 10, 9).toISOString() });
    const s = withNextRun(parked, local(2026, 9, 11, 9, 30));
    expect(s.missed).toBeUndefined();
    expect(s.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "unanswered" });
    expect(new Date(s.nextRunAt!)).toEqual(local(2026, 9, 12, 9, 0));
  });
  it("withNextRun on a disabled or once-and-done schedule is null", () => {
    expect(withNextRun(base({ enabled: false }), local(2026, 9, 11)).nextRunAt).toBeNull();
    expect(withNextRun(base({ repeat: { kind: "once", date: "2026-09-01" } }), local(2026, 9, 11)).nextRunAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
L=/tmp/vitest.log; npx vitest run tests/schedules.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `../src/main/schedules`.

- [ ] **Step 3: Implement `src/main/schedules.ts`**

```ts
/**
 * §35 Schedules — pure, electron-free. All arithmetic is LOCAL wall-clock via
 * the Date(y, m, d, h, min) constructor, so DST follows the clock on the wall
 * (a 9:00 review is at 9:00 the day after the change). No cron library: five
 * recurrence kinds are a switch, not a grammar.
 */
export type Repeat = /* as in Interfaces */;
// ... types verbatim from the Interfaces block above ...

export const FAIL_PAUSE_AT = 3;
export const BUSY_WAIT_MS = 2 * 60 * 60 * 1000;
export const MAX_RUNS = 20;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseAt(at: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}
const atOn = (d: Date, h: number, m: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

export function nextFire(repeat: Repeat, at: string, after: Date): Date | null {
  const t = parseAt(at);
  if (!t) return null;
  switch (repeat.kind) {
    case "daily": case "weekdays": case "weekly": {
      const allowed = repeat.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6]
        : repeat.kind === "weekdays" ? [1, 2, 3, 4, 5]
        : [...new Set(repeat.days.filter((d) => d >= 0 && d <= 6))];
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
      if (every < 1 || every > 23) return null;
      // Slots are `at` + k·every within a day, restarting each day at `at`.
      for (let dayOff = 0; dayOff < 2; dayOff++) {
        const start = atOn(addDays(after, dayOff), t.h, t.m);
        for (let k = 0; k * every < 24; k++) {
          const c = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + k * every, start.getMinutes());
          if (c.getDate() !== start.getDate() && k > 0) break; // past midnight → next day's series
          if (c > after) return c;
        }
      }
      return null;
    }
    case "once": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(repeat.date);
      if (!m) return null;
      const c = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t.h, t.m);
      return c > after ? c : null;
    }
  }
}

const clock = (at: string): string => { const t = parseAt(at)!; return `${t.h}:${String(t.m).padStart(2, "0")}`; };

export function humanRecurrence(repeat: Repeat, at: string): string {
  switch (repeat.kind) {
    case "daily": return `Every day at ${clock(at)}`;
    case "weekdays": return `Weekdays at ${clock(at)}`;
    case "weekly": return `${repeat.days.map((d) => DAY[d]).join(", ")} at ${clock(at)}`;
    case "hours": return repeat.every === 1 ? "Every hour" : `Every ${repeat.every} hours from ${clock(at)}`;
    case "once": { const [y, m, d] = repeat.date.split("-").map(Number); return `Once, ${MON[m - 1]} ${d} at ${clock(at)}`; void y; }
  }
}

export function runTitle(title: string, firedAt: Date): string {
  return `${title} · ${MON[firedAt.getMonth()]} ${firedAt.getDate()}`;
}

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
  const enabled = failStreak >= FAIL_PAUSE_AT ? false : s.enabled;
  return { ...s, runs, failStreak, enabled };
}

export function withNextRun(s: Schedule, now: Date): Schedule {
  let out = s;
  // A parked ask whose slot has been superseded is moot — record it, drop it.
  if (s.missed && nextFire(s.repeat, s.at, new Date(s.missed.slotAt)) && nextFire(s.repeat, s.at, new Date(s.missed.slotAt))! <= now) {
    out = applyOutcome({ ...out, missed: undefined }, { firedAt: s.missed.slotAt, outcome: "skipped", reason: "unanswered" });
  }
  const next = out.enabled ? nextFire(out.repeat, out.at, now) : null;
  return { ...out, nextRunAt: next ? next.toISOString() : null };
}
```

- [ ] **Step 4: Run the tests until green** — same command as Step 2. Expected: PASS (fix the `hours` slot walk if the wrap case fails; the assertion is the spec).

- [ ] **Step 5: Commit**

```bash
git add src/main/schedules.ts tests/schedules.test.ts
git commit -m "feat(schedules): pure recurrence math, catch-up decision and fail-pause

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `ScheduleStore` + `SessionMeta.scheduleId`

**Files:**
- Modify: `src/main/schedules.ts` (append the store), `src/main/store.ts:13-60` (one optional field)
- Test: `tests/schedules-store.test.ts`

**Interfaces:**
- Produces: `class ScheduleStore { constructor(file: string); list(): Schedule[]; get(id): Schedule | undefined; create(input: NewSchedule, now: Date): Schedule; update(id, patch: Partial<Omit<Schedule,"id"|"createdAt">>, now: Date): Schedule | undefined; replace(s: Schedule): void; remove(id): void }` where `NewSchedule = Omit<Schedule, "id"|"createdAt"|"nextRunAt"|"failStreak"|"runs">`. `create`/`update` call `withNextRun(…, now)` so `nextRunAt` is never stale. Same `readJson`/`writeJson` pattern as `SessionIndex` (copy the two 6-line helpers — they are module-private in store.ts; do NOT export them, a `ponytail:` comment notes the duplication).
- `SessionMeta.scheduleId?: string` — additive; absent = not a run.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schedules-store.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ScheduleStore } from "../src/main/schedules";
import type { SessionMeta } from "../src/main/store";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-sched-")), "schedules.json");
const input = { title: "T", prompt: "p", workspaceId: "/ws", repeat: { kind: "daily" as const }, at: "09:00", mode: "full" as const, reuseSession: false, notifyOnDone: true, catchUp: "ask" as const, enabled: true };

describe("ScheduleStore", () => {
  it("round-trips through disk and computes nextRunAt on create", () => {
    const f = tmpFile();
    const a = new ScheduleStore(f);
    const s = a.create(input, new Date(2026, 8, 11, 8, 0));
    expect(s.id).toMatch(/[0-9a-f-]{36}/);
    expect(new Date(s.nextRunAt!)).toEqual(new Date(2026, 8, 11, 9, 0));
    expect(s.runs).toEqual([]); expect(s.failStreak).toBe(0);
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
  it("remove forgets; a corrupt file reads as empty", () => {
    const f = tmpFile(); const a = new ScheduleStore(f);
    const s = a.create(input, new Date()); a.remove(s.id);
    expect(a.list()).toEqual([]);
    fs.writeFileSync(f, "{nope"); expect(new ScheduleStore(f).list()).toEqual([]);
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
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/schedules-store.test.ts` → FAIL (`ScheduleStore` not exported / `scheduleId` type error at typecheck).

- [ ] **Step 3: Implement** — append to `src/main/schedules.ts`:

```ts
import fs from "node:fs"; import path from "node:path"; import { randomUUID } from "node:crypto";
// ponytail: same 12 lines as store.ts's private helpers — exporting them from store.ts would make schedules.ts import electron-adjacent code it does not need.
function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; } }
function writeJson(file: string, data: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

export type NewSchedule = Omit<Schedule, "id" | "createdAt" | "nextRunAt" | "failStreak" | "runs">;

export class ScheduleStore {
  private items: Schedule[];
  constructor(private readonly file: string) {
    const raw = readJson<unknown>(file, []);
    this.items = Array.isArray(raw) ? (raw as Schedule[]) : [];
  }
  private save(): void { writeJson(this.file, this.items); }
  list(): Schedule[] { return [...this.items]; }
  get(id: string): Schedule | undefined { return this.items.find((s) => s.id === id); }
  create(input: NewSchedule, now: Date): Schedule {
    const s = withNextRun({ ...input, id: randomUUID(), createdAt: now.toISOString(), nextRunAt: null, failStreak: 0, runs: [] }, now);
    this.items.push(s); this.save(); return s;
  }
  update(id: string, patch: Partial<Omit<Schedule, "id" | "createdAt">>, now: Date): Schedule | undefined {
    const i = this.items.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    // Re-enabling clears a fail-pause; editing never touches past runs.
    const merged = { ...this.items[i]!, ...patch, ...(patch.enabled === true ? { failStreak: 0 } : {}) };
    this.items[i] = withNextRun(merged, now); this.save(); return this.items[i];
  }
  /** Whole-record write for the scheduler's own bookkeeping (runs, missed, nextRunAt already computed). */
  replace(s: Schedule): void { const i = this.items.findIndex((x) => x.id === s.id); if (i >= 0) { this.items[i] = s; this.save(); } }
  remove(id: string): void { this.items = this.items.filter((s) => s.id !== id); this.save(); }
}
```
And in `src/main/store.ts` after `pulseAskedAt`:
```ts
  /** §35: the schedule that fired this session. Additive — absent = not a scheduled run. Read by the sidebar (clock glyph) and by the scheduler (outcome routing); nothing in the transcript reads it. */
  scheduleId?: string;
```

- [ ] **Step 4: Run** `npx vitest run tests/schedules-store.test.ts tests/schedules.test.ts` → PASS. `npm run typecheck` → green.

- [ ] **Step 5: Commit** `feat(schedules): ScheduleStore and the additive SessionMeta.scheduleId`.

---
### Task 3: Read-only run mode — `hv-readonly.ts`, `HV_READONLY`, bridge clamp + pill notify

**Files:**
- Create: `pi-runtime/extensions/hv-readonly.ts`
- Modify: `src/main/pi/spawn.ts:57-60` (opts) and `:254` (env), `pi-runtime/extensions/happyvibe-bridge.ts:379` (flag), `:795-830` (session_start notify), `:876-882` (prompt section), `:1249-1263` (clamp)
- Test: `tests/hv-readonly.test.ts`, extend `tests/mcp-spawn.test.ts`

**Interfaces:**
- `hv-readonly.ts` exports:
```ts
export const READONLY_BLOCKED: ReadonlySet<string>; // plan_start, plan_complete, plan_status_update, schedule_create, schedule_update, schedule_delete
export function gateReadonlyCall(toolName: string, input: unknown): PlanGate;   // block if READONLY_BLOCKED else gatePlanCall(toolName, input)
export function readonlyFromEnv(env: NodeJS.ProcessEnv): boolean;             // env.HV_READONLY === "1"
export const READONLY_PROMPT_MARKER = "[HAPPYVIBE READ-ONLY RUN]";
export function buildReadonlyPrompt(registeredTools?: Iterable<string>): string; // <happyvibe_readonly_run> block; names only tools the model HAS (A3 rule)
```
- `PiSpawnOptions.readonly?: boolean` → env `HV_READONLY: "1"` (absent otherwise — the `HV_BYPASS` pattern).
- Bridge: `const readonly = readonlyFromEnv(process.env)` beside `dangerous` (line 379). Notify on `session_start`: `{ kind: "hv.readonly", enabled: true }` (only when true). Clamp inserted BEFORE the §23 plan clamp; both feed the same `planFloorAsk` variable and the same `hv.plan.blocked` notify (renderer draws one card kind) with `source: "readonly"` on the audit row.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hv-readonly.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
import { buildReadonlyPrompt, gateReadonlyCall, READONLY_BLOCKED, READONLY_PROMPT_MARKER, readonlyFromEnv } from "../pi-runtime/extensions/hv-readonly";
import { BLOCKED_PLAN_TOOLS } from "../pi-runtime/extensions/hv-plan";

describe("gateReadonlyCall", () => {
  it("blocks everything Plan mode blocks", () => {
    for (const t of BLOCKED_PLAN_TOOLS) expect(gateReadonlyCall(t, {}).kind, t).toBe("block");
  });
  it("ALSO blocks the plan tools and the schedule writers outright — a read-only run plans nothing and schedules nothing", () => {
    for (const t of ["plan_start", "plan_complete", "plan_status_update", "schedule_create", "schedule_update", "schedule_delete"]) {
      expect(READONLY_BLOCKED.has(t), t).toBe(true);
      expect(gateReadonlyCall(t, {}).kind, t).toBe("block");
    }
  });
  it("passes reads, schedule_list and an allowlisted bash", () => {
    for (const t of ["read", "grep", "ls", "schedule_list", "memory_recall", "web_search"]) expect(gateReadonlyCall(t, {}).kind, t).toBe("pass");
    expect(gateReadonlyCall("bash", { command: "git status" }).kind).toBe("pass");
    expect(gateReadonlyCall("bash", { command: "rm -rf x" }).kind).toBe("block");
  });
  it("floor-asks the unknown (MCP) and needs-boundary for subagent — the plan gate's verdicts, unchanged", () => {
    expect(gateReadonlyCall("mcp", {}).kind).toBe("floor-ask");
    expect(gateReadonlyCall("subagent", {}).kind).toBe("needs-boundary");
  });
  it("the block reason names the run, not plan mode", () => {
    const g = gateReadonlyCall("write", {});
    expect(g.kind === "block" && g.reason).toMatch(/read-only run/i);
  });
});

describe("readonlyFromEnv / buildReadonlyPrompt", () => {
  it("is on only for the literal \"1\"", () => {
    expect(readonlyFromEnv({ HV_READONLY: "1" })).toBe(true);
    expect(readonlyFromEnv({ HV_READONLY: "true" })).toBe(false);
    expect(readonlyFromEnv({})).toBe(false);
  });
  it("names only the blocked tools the model actually has, and never plan_complete", () => {
    const p = buildReadonlyPrompt(["read", "edit", "bash"]);
    expect(p.startsWith("<happyvibe_readonly_run>\n" + READONLY_PROMPT_MARKER)).toBe(true);
    expect(p).toContain("edit"); expect(p).not.toContain("terminal_run"); expect(p).not.toContain("plan_complete");
    expect(p).toMatch(/report .* in chat/i);
  });
});

describe("bridge wiring (source scan)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  it("the readonly clamp is not inside the builtins.plan block and runs before the bypass check", () => {
    const clamp = src.indexOf("gateReadonlyCall(");
    const dangerousCheck = src.indexOf("if (dangerous && !plan.enabled");
    expect(clamp).toBeGreaterThan(0);
    expect(clamp).toBeLessThan(dangerousCheck);
    // The plan block is `if (builtins.plan && plan.enabled) {` — our clamp must not be gated by builtins.plan.
    const line = src.slice(src.lastIndexOf("\n", clamp), clamp);
    expect(line).not.toMatch(/builtins\.plan/);
  });
  it("bypass yields to the clamp: the dangerous branch is skipped while readonly", () => {
    expect(src).toMatch(/if \(dangerous && !plan\.enabled && !readonly\)/);
  });
  it("the prompt block is appended outside the plan block and the pill notify exists", () => {
    expect(src).toMatch(/readonly \? "\\n\\n" \+ buildReadonlyPrompt\(/);
    expect(src).toContain('kind: "hv.readonly"');
  });
});
```
And append to `tests/mcp-spawn.test.ts`:
```ts
test("§35: HV_READONLY=1 is set only when the spawn is a read-only scheduled run", () => {
  expect(resolvePiSpawn("/ws", "/sessions", runtime).env.HV_READONLY).toBeUndefined();
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { readonly: false }).env.HV_READONLY).toBeUndefined();
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { readonly: true }).env.HV_READONLY).toBe("1");
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/hv-readonly.test.ts tests/mcp-spawn.test.ts` → FAIL (module missing; `readonly` not an option).

- [ ] **Step 3: Implement `hv-readonly.ts`**

```ts
/**
 * §35 — the read-only RUN mode. A scheduled run the user marked "Read-only"
 * spawns with HV_READONLY=1 and this clamp runs on every tool call, BEFORE the
 * bypass check (read-only must mean read-only, exactly Plan mode's rule).
 *
 * It is deliberately NOT Plan mode: `/hv-plan` exists only while the Plan-mode
 * built-in is on (off, the literal text would reach the model), and the planning
 * prompt asks for plan_complete, which writes a plan file into the repo. This
 * mode has no command and no toggle — nothing can turn it off from inside.
 */
import { gatePlanCall, type PlanGate } from "./hv-plan";

export const READONLY_BLOCKED: ReadonlySet<string> = new Set([
  "plan_start", "plan_complete", "plan_status_update",   // a run reports; it never plans
  "schedule_create", "schedule_update", "schedule_delete", // §4.5: list yes, write no — and not floor-ask, nobody is there to answer
]);

export function readonlyFromEnv(env: NodeJS.ProcessEnv): boolean {
  return env.HV_READONLY === "1";
}

export function gateReadonlyCall(toolName: string, input: unknown): PlanGate {
  if (READONLY_BLOCKED.has(toolName)) {
    return { kind: "block", reason: `This is a read-only run — '${toolName}' is not available. Report your findings in chat.` };
  }
  const g = gatePlanCall(toolName, input);
  if (g.kind === "block") return { kind: "block", reason: g.reason.replace(/^Plan mode is read-only/, "This is a read-only run").replace(/^Plan mode blocks/, "A read-only run blocks") };
  return g;
}

export const READONLY_PROMPT_MARKER = "[HAPPYVIBE READ-ONLY RUN]";

export function buildReadonlyPrompt(registeredTools?: Iterable<string>): string {
  const have = registeredTools ? new Set(registeredTools) : null;
  // Derived from the gate (Principle 11): BLOCKED_PLAN_TOOLS via gatePlanCall's set, filtered to what exists.
  const blocked = [...(have ?? [])].filter((t) => gateReadonlyCall(t, {}).kind === "block" && !READONLY_BLOCKED.has(t));
  const names = blocked.length ? blocked.join(", ") : "file edits";
  return `<happyvibe_readonly_run>
${READONLY_PROMPT_MARKER}
This is a scheduled, read-only run. Read, search and analyse, then report your
findings in chat as your final message — nobody is watching live, so the report
must stand alone. Blocked: ${names}; bash is limited to a read-only allowlist.
Do not try to plan or to schedule anything; do not ask questions.
</happyvibe_readonly_run>`;
}
```
`spawn.ts`: add to `PiSpawnOptions`
```ts
  /** §35: a read-only scheduled run → HV_READONLY=1 → the bridge clamps every tool call (hv-readonly.ts). Same pattern as HV_BYPASS. */
  readonly?: boolean;
```
and beside `HV_BYPASS` in `env`: `...(opts.readonly ? { HV_READONLY: "1" } : {}),`.

Bridge (`happyvibe-bridge.ts`):
1. Import: `import { buildReadonlyPrompt, gateReadonlyCall, readonlyFromEnv } from "./hv-readonly";`
2. Line 379, after `let dangerous = …`: `const readonly = readonlyFromEnv(process.env); // §35 — const: nothing can flip it`
3. `session_start` handler, after `busUi = ctx.ui;`: `if (readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.readonly", enabled: true }), "info");`
4. `before_agent_start`, beside `planSection`: `const readonlySection = readonly ? "\n\n" + buildReadonlyPrompt(pi.getAllTools().map((t) => t.name)) : "";` and include it in the returned systemPrompt right where `planSection` is concatenated (readonly and plan are mutually exclusive in practice; if both, readonly first).
5. `tool_call`, immediately BEFORE the `// §23 Plan Mode clamp` comment:
```ts
    // §35 read-only run clamp — before plan, before bypass, before rules. The
    // verdict shape is Plan mode's, so the renderer draws the same "Skipped" card.
    if (readonly) {
      const g = resolvePlanVerdict(gateReadonlyCall(tool, input), boundary);
      if (g.kind === "block") {
        audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "readonly" });
        ctx.ui.notify(JSON.stringify({ kind: "hv.plan.blocked", toolName: tool, toolCallId: event.toolCallId, reason: g.reason }), "info");
        return { block: true, reason: g.reason };
      }
      planFloorAsk = planFloorAsk || g.kind === "floor-ask";
    }
```
   (`planFloorAsk` is declared just above the plan clamp today — move `let planFloorAsk = false;` up so both branches can set it.)
6. Change `if (dangerous && !plan.enabled) {` → `if (dangerous && !plan.enabled && !readonly) {`.
7. `audit()`'s `source` union (hv-rules.ts `AuditSource` or wherever `"plan"` is typed) gains `"readonly"`; `AuditView`/`analytics.ts` map it beside `plan` (check `grep -n '"plan"' src/main/analytics.ts src/renderer/src/components/AuditView.tsx`).

- [ ] **Step 4: Run** `npx vitest run tests/hv-readonly.test.ts tests/mcp-spawn.test.ts tests/hv-plan.test.ts` → PASS; `npm run typecheck` (includes `tsconfig.extensions.json`) → green.

- [ ] **Step 5: Commit** `feat(bridge): read-only run mode — HV_READONLY clamps like plan mode, cannot be switched off`.

---

### Task 4: `builtinTools.schedules` toggle end to end

**Files:**
- Modify: `pi-runtime/extensions/hv-builtins.ts:7-66`, `src/main/config.ts:52,335-360`, `src/main/pi/spawn.ts` (the `builtinTools` opts type line), `src/renderer/src/components/BuiltinToolsBlock.tsx:31,596-612`, `src/renderer/src/hv.d.ts` (the `builtinsSet` patch type)
- Test: extend `tests/hv-builtins.test.ts`; `tests/schedules-source.test.ts` (created here, grows in later tasks)

**Interfaces:** `BuiltinToggles.schedules: boolean` (default true). The bridge registers the four tools (Task 7) only inside `if (builtins.schedules) { … }`.

- [ ] **Step 1: Failing tests** — in `tests/hv-builtins.test.ts` every `toEqual({...})` literal gains `schedules: true`; add:
```ts
  it("reads schedules:false, and defaults it on", () => {
    expect(parseBuiltins(JSON.stringify({ schedules: false })).schedules).toBe(false);
    expect(parseBuiltins(undefined).schedules).toBe(true);
  });
```
Create `tests/schedules-source.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const R = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
describe("Built-in tools row for Schedules", () => {
  it("BuiltinToolsBlock renders a schedules switch bound to builtins.schedules", () => {
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    expect(src).toMatch(/builtins\.schedules/);
    expect(src).toMatch(/builtinsSet\(\{ schedules: on \}\)/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/hv-builtins.test.ts tests/schedules-source.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `hv-builtins.ts`: add `schedules: boolean;` to `BuiltinToggles` with the doc comment `/** §35: schedule_list/create/update/delete. Gates the MODEL's tools only — the scheduler runs regardless. */`, default `schedules: true` in `out`, parse `if (p.schedules === false) out.schedules = false;`. `config.ts`: add `schedules?: boolean` to the `builtinTools` type (line 52), to `getBuiltinTools`'s return type + `schedules: t?.schedules ?? true`, to `setBuiltinTools`'s param type. `spawn.ts`: add `schedules: boolean` to the `builtinTools` option type. `hv.d.ts`: add `schedules?: boolean` to the `builtinsSet` patch type and to the builtins record type. `BuiltinToolsBlock.tsx`: add `schedules: boolean;` to the props type and, after `<MemoryRow …/>`, a `<SchedulesRow>` modelled on the simplest existing row (the Web row at ~585-596): title **"Schedules"**, body *"Lets the agent list your schedules and propose new ones — every create, change or delete opens the drawer for you to confirm. Turning this off removes the four schedule tools from the model; your schedules keep running."*, `on={builtins.schedules}`, `onChange` → `window.hv.builtinsSet({ schedules: on }).then(() => patch({ schedules: on }), …)`.

- [ ] **Step 4: Run** the two files + `npm run typecheck` → green.

- [ ] **Step 5: Commit** `feat(builtins): a Schedules row — the model's four schedule tools, on by default`.

---
### Task 5: Pending-prompt replay — `src/main/pendingPrompts.ts` + renderer boot fetch

**Files:**
- Create: `src/main/pendingPrompts.ts`
- Modify: `src/main/ipc.ts:1017-1046` (replace the `pendingPrompts` Map + `notePending`/`clearPending`), `:2275-2282` (retain the stamped envelope), `:2478-2482` (drop on exit), `src/preload/index.ts` (+`pendingUiRequests`), `src/renderer/src/hv.d.ts`, `src/renderer/src/App.tsx:1009` (boot fetch through the same handler)
- Test: `tests/pending-replay.test.ts`

**Interfaces:**
```ts
// src/main/pendingPrompts.ts — pure
export interface PendingEnvelope { id: string; sessionId: string; method: string; title?: string; message?: string; options?: string[] }
export class PendingPrompts {
  constructor(private readonly blocking: ReadonlySet<string>) {}
  note(env: PendingEnvelope): boolean;            // retained iff env.method is blocking; returns whether counts changed
  clear(id: string): boolean;                      // answered — drop; returns whether it existed
  dropSession(sessionId: string): boolean;         // crash/exit — returns whether anything dropped
  counts(exclude?: string): Record<string, number>; // sessionId → n (the hv:pending-changed payload)
  list(): PendingEnvelope[];                       // for replay, oldest first
}
```
- IPC `hv:pending-ui-requests` → `PendingEnvelope[]`, each re-stamped through `stampPrompt` at REPLAY time (the original stamp may name a window that is gone). Renderer: `window.hv.pendingUiRequests()` at boot, each fed into the same `onUiRequest` handler body (extract it as `handleUiRequest(r)`).

- [ ] **Step 1: Failing test**

```ts
// tests/pending-replay.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
import { PendingPrompts } from "../src/main/pendingPrompts";

const P = () => new PendingPrompts(new Set(["select", "input"]));
const perm = (id: string, sid = "s1") => ({ id, sessionId: sid, method: "select", title: JSON.stringify({ kind: "hv.permission" }) });

describe("PendingPrompts", () => {
  it("retains a blocking envelope for replay and counts it", () => {
    const p = P(); expect(p.note(perm("a"))).toBe(true);
    expect(p.list()).toEqual([perm("a")]); expect(p.counts()).toEqual({ s1: 1 });
  });
  it("never retains a notify — that map would grow with every transcript card", () => {
    const p = P(); expect(p.note({ id: "n", sessionId: "s1", method: "notify", message: "{}" })).toBe(false);
    expect(p.list()).toEqual([]); expect(p.counts()).toEqual({});
  });
  it("answering clears it; a crashed session drops all of its own and no other's", () => {
    const p = P(); p.note(perm("a")); p.note(perm("b", "s2")); p.note(perm("c"));
    expect(p.clear("a")).toBe(true); expect(p.clear("a")).toBe(false);
    expect(p.dropSession("s1")).toBe(true); expect(p.list().map((e) => e.id)).toEqual(["b"]);
  });
  it("counts can exclude the utility session", () => {
    const p = P(); p.note(perm("u", "utility")); p.note(perm("a"));
    expect(p.counts("utility")).toEqual({ s1: 1 });
  });
});

describe("wiring (source scan)", () => {
  it("main exposes hv:pending-ui-requests and the renderer fetches it at boot through the SAME handler as live requests", () => {
    const ipc = fs.readFileSync(path.join(process.cwd(), "src/main/ipc.ts"), "utf8");
    expect(ipc).toMatch(/ipcMain\.handle\("hv:pending-ui-requests"/);
    expect(ipc).toMatch(/pendingUi\.list\(\)\.map\(\(r\) => stampPrompt\(r\)\)/); // re-stamped at replay time
    const app = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");
    expect(app).toMatch(/window\.hv\.pendingUiRequests\(\)\.then\(\(rs\) => rs\.forEach\(handleUiRequest\)/);
    expect(app).toMatch(/window\.hv\.onUiRequest\(handleUiRequest\)/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/pending-replay.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/pendingPrompts.ts
/**
 * §35 — blocking ui-requests main has forwarded and nobody has answered yet.
 *
 * Before this, main kept only COUNTS and broadcast each envelope once, so a
 * permission raised with zero windows open (a scheduled Full run at 3 am) was
 * never shown to the window opened at 9 — the badge said 1 forever and the run
 * waited forever. Retaining the envelope lets a new window ask for it.
 *
 * Only BLOCKING methods are kept (the reason there were two maps before): a
 * notify is fire-and-forget and nothing ever clears it.
 */
export interface PendingEnvelope { id: string; sessionId: string; method: string; title?: string; message?: string; options?: string[] }

export class PendingPrompts {
  private readonly map = new Map<string, PendingEnvelope>();
  constructor(private readonly blocking: ReadonlySet<string>) {}
  note(env: PendingEnvelope): boolean {
    if (!this.blocking.has(env.method)) return false;
    this.map.set(env.id, env); return true;
  }
  clear(id: string): boolean { return this.map.delete(id); }
  dropSession(sessionId: string): boolean {
    let dropped = false;
    for (const [id, e] of this.map) if (e.sessionId === sessionId) { this.map.delete(id); dropped = true; }
    return dropped;
  }
  counts(exclude?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.map.values()) if (e.sessionId !== exclude) out[e.sessionId] = (out[e.sessionId] ?? 0) + 1;
    return out;
  }
  list(): PendingEnvelope[] { return [...this.map.values()]; }
}
```
`ipc.ts`: replace `const pendingPrompts = new Map<string,string>()` and its helpers with
```ts
  const pendingUi = new PendingPrompts(BLOCKING_UI_METHODS);
  const pendingChanged = (): void => send("hv:pending-changed", pendingUi.counts(UTILITY));
  const notePending = (r: { id: string; method?: string; title?: string; message?: string; options?: string[] }, sessionId: string): void => {
    if (r.method && pendingUi.note({ ...r, method: r.method, sessionId })) pendingChanged();
  };
  const clearPending = (id: string): void => { if (pendingUi.clear(id)) pendingChanged(); };
  ipcMain.handle("hv:pending-ui-requests", () => pendingUi.list().map((r) => stampPrompt(r)));
```
Update the two `notePending(r.id, sessionId, r.method)` call sites to `notePending(r, sessionId)`; replace the exit loop at :2481 with `if (pendingUi.dropSession(sessionId)) pendingChanged();`. Preload: `pendingUiRequests: () => ipcRenderer.invoke("hv:pending-ui-requests"),`; `hv.d.ts`: `pendingUiRequests(): Promise<Array<{ id: string; sessionId?: string; method?: string; title?: string; message?: string; options?: string[]; promptWindowId?: number }>>;`. App.tsx: turn the arrow at :1009 into `const handleUiRequest = (r: …) => { …existing body… };`, then `const offUiRequest = window.hv.onUiRequest(handleUiRequest);` and, right after, `void window.hv.pendingUiRequests().then((rs) => rs.forEach(handleUiRequest)).catch(() => {});`. Guard against double-queueing: `setUiQueue((q) => q.some((x) => x.req.id === r.id) ? q : [...q, …])` for both the permission and askUser pushes (a live push and a replay can race at boot).

- [ ] **Step 4: Run** `npx vitest run tests/pending-replay.test.ts tests/prompt-routing.test.ts` (if present) + `npm run typecheck` → green.

- [ ] **Step 5: Commit** `fix(prompts): a permission raised with no window open is replayed to the next window`.

---

### Task 6: `Scheduler` (pure) + wiring in `ipc.ts` (tick, host callbacks, outcomes, IPC, notifications, login item)

**Files:**
- Create: `src/main/scheduler.ts`
- Modify: `src/main/ipc.ts` — factor `promptSession` out of the `hv:prompt-session` handler (`:2983-3160`), add the host, hook `agent_end` (`:1549`), `session-exit` (`:2459`), permission prompt (`:2280`), new IPC handlers, `hv:schedules-changed` push
- Test: `tests/scheduler.test.ts`

**Interfaces:**
```ts
// src/main/scheduler.ts — pure, effects via host
export interface SchedulerHost {
  now(): Date;
  workspaceExists(ws: string): boolean;
  workspaceIdle(ws: string): boolean;
  sessionExists(id: string): boolean;
  /** Creates a run session (spawns, readonly per mode), returns its id. Throws on spawn refusal. */
  createRunSession(s: Schedule, title: string): Promise<string>;
  /** Resumes/wakes an existing session for reuse; throws if gone. */
  resumeSession(id: string): Promise<void>;
  archivePreviousRun(s: Schedule): Promise<void>;   // decides adoption (renamed/prompted) itself — it owns SessionMeta
  prompt(sessionId: string, text: string): Promise<void>;
  log(type: "schedule.fire" | "schedule.skip" | "schedule.done" | "schedule.missed", s: Schedule, data: Record<string, unknown>): void;
  notify(kind: "done" | "needs_you" | "missed", s: Schedule, extra: { sessionId?: string; count?: number; durationMs?: number; costUsd?: number }): void;
  changed(): void;                                   // push hv:schedules-changed
}
export class Scheduler {
  constructor(private readonly store: ScheduleStore, private readonly host: SchedulerHost) {}
  /** One tick: fire due schedules (busy-wait/skip), expire parked asks. Idempotent per minute. */
  tick(): Promise<void>;
  /** Launch/resume: apply catch-up policy to every overdue schedule; returns the ids parked for asking. */
  catchUp(): Promise<string[]>;
  answerMissed(id: string, answer: "run" | "skip"): Promise<void>;
  runNow(id: string): Promise<{ ok: true } | { ok: false; reason: "busy" | "disabled" | "gone" }>;
  /** Outcome hooks, called by ipc.ts from the session event stream. */
  onAgentEnd(sessionId: string, durationMs: number, costUsd?: number): void;
  onSessionCrash(sessionId: string, error: string): void;
  onNeedsYou(sessionId: string): void;              // once per run
  scheduleOfSession(sessionId: string): Schedule | undefined;
}
```
Fire algorithm (`fireSchedule(s)`): (1) `!s.enabled` → return; `!host.workspaceExists` → skip `workspace-gone`, disable; (2) `!host.workspaceIdle(ws)` → if `now - nextRunAt < BUSY_WAIT_MS` leave `nextRunAt` alone (retry next tick) else `applyOutcome(skipped busy)` + `withNextRun`; (3) if `s.reuseSession && s.reusedSessionId && host.sessionExists(...)` → `resumeSession`, else if `!s.reuseSession` → `archivePreviousRun(s)` then `createRunSession(s, runTitle(...))`, else (reuse but gone) → `createRunSession` with plain title and set `reusedSessionId` + `log("schedule.fire", {reusedSessionRecreated:true})`; (4) `prompt(sessionId, s.prompt)`; (5) push `runs[]` with `{sessionId, firedAt, outcome:"ok"}` provisional? — NO: push `outcome: "skipped"`-free provisional entry is wrong; keep an in-memory `inflight: Map<sessionId, {scheduleId, firedAt}>` and only `applyOutcome` at `onAgentEnd`/`onSessionCrash`. `withNextRun(s, now)` immediately after the prompt so a crash cannot re-fire the same slot. Any throw in (3)-(4) → `applyOutcome(failed, reason)` (pause at 3) + log `schedule.done failed`.

- [ ] **Step 1: Failing tests**

```ts
// tests/scheduler.test.ts
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Scheduler, type SchedulerHost } from "../src/main/scheduler";
import { BUSY_WAIT_MS, FAIL_PAUSE_AT, ScheduleStore } from "../src/main/schedules";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-sch-")), "s.json");
const T0 = new Date(2026, 8, 11, 9, 0, 30); // 30 s past the 9:00 slot
const input = { title: "Review", prompt: "review it", workspaceId: "/ws", repeat: { kind: "daily" as const }, at: "09:00", mode: "readonly" as const, reuseSession: false, notifyOnDone: true, catchUp: "ask" as const, enabled: true };

function host(over: Partial<SchedulerHost> = {}) {
  const calls: string[] = [];
  let n = 0;
  const h: SchedulerHost = {
    now: () => T0, workspaceExists: () => true, workspaceIdle: () => true, sessionExists: () => true,
    createRunSession: vi.fn(async (_s, title) => { calls.push(`create:${title}`); return `sess-${++n}`; }),
    resumeSession: vi.fn(async (id) => { calls.push(`resume:${id}`); }),
    archivePreviousRun: vi.fn(async () => { calls.push("archive"); }),
    prompt: vi.fn(async (id, text) => { calls.push(`prompt:${id}:${text}`); }),
    log: vi.fn((type, _s, data) => { calls.push(`log:${type}:${JSON.stringify(data)}`); }),
    notify: vi.fn((kind) => { calls.push(`notify:${kind}`); }),
    changed: vi.fn(),
    ...over,
  };
  return { h, calls };
}

describe("Scheduler.tick", () => {
  it("fires a due schedule in order: archive previous → create (readonly) → prompt → log, and advances nextRunAt", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create(input, new Date(2026, 8, 10, 12));
    const { h, calls } = host(); const sch = new Scheduler(store, h);
    await sch.tick();
    expect(calls.slice(0, 3)).toEqual(["archive", "create:Review · Sep 11", "prompt:sess-1:review it"]);
    expect(calls[3]).toMatch(/^log:schedule\.fire/);
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
    expect((h.createRunSession as ReturnType<typeof vi.fn>).mock.calls[0][0].mode).toBe("readonly");
  });
  it("does not fire twice for one slot, and not at all when not due", async () => {
    const store = new ScheduleStore(tmp()); store.create(input, new Date(2026, 8, 10, 12));
    const { h } = host(); const sch = new Scheduler(store, h);
    await sch.tick(); await sch.tick();
    expect(h.createRunSession).toHaveBeenCalledTimes(1);
  });
  it("waits while the workspace is busy and skips after BUSY_WAIT_MS", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create(input, new Date(2026, 8, 10, 12));
    let now = T0;
    const { h, calls } = host({ workspaceIdle: () => false, now: () => now }); const sch = new Scheduler(store, h);
    await sch.tick();
    expect(h.createRunSession).not.toHaveBeenCalled();
    expect(store.get(s.id)!.nextRunAt).toBe(s.nextRunAt); // untouched — retried next tick
    now = new Date(T0.getTime() + BUSY_WAIT_MS + 1); await sch.tick();
    expect(calls.some((c) => c.startsWith('log:schedule.skip:{"reason":"busy"'))).toBe(true);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "busy" });
    expect(new Date(store.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
  });
  it("a gone workspace skips and disables; a disabled schedule never fires", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create(input, new Date(2026, 8, 10, 12));
    const { h } = host({ workspaceExists: () => false }); await new Scheduler(store, h).tick();
    expect(h.createRunSession).not.toHaveBeenCalled(); expect(store.get(s.id)!.enabled).toBe(false);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "workspace-gone" });
  });
  it("reuse: resumes the reused session; recreates it loudly when it is gone", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create({ ...input, reuseSession: true, reusedSessionId: "old" }, new Date(2026, 8, 10, 12));
    const a = host(); await new Scheduler(store, a.h).tick();
    expect(a.calls[0]).toBe("resume:old"); expect(a.h.archivePreviousRun).not.toHaveBeenCalled();
    const store2 = new ScheduleStore(tmp()); const s2 = store2.create({ ...input, reuseSession: true, reusedSessionId: "old" }, new Date(2026, 8, 10, 12));
    const b = host({ sessionExists: () => false }); await new Scheduler(store2, b.h).tick();
    expect(b.calls[0]).toBe("create:Review"); expect(store2.get(s2.id)!.reusedSessionId).toBe("sess-1");
    expect(b.calls.some((c) => c.includes('"reusedSessionRecreated":true'))).toBe(true); void s;
  });
  it("a spawn refusal is a failed run; FAIL_PAUSE_AT of them pause the schedule", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create(input, new Date(2026, 8, 10, 12));
    let now = T0;
    const { h } = host({ createRunSession: vi.fn(async () => { throw new Error("no model"); }), now: () => now });
    const sch = new Scheduler(store, h);
    for (let i = 0; i < FAIL_PAUSE_AT; i++) { await sch.tick(); now = new Date(now.getTime() + 24 * 3600 * 1000); }
    expect(store.get(s.id)!.enabled).toBe(false); expect(store.get(s.id)!.failStreak).toBe(FAIL_PAUSE_AT);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ outcome: "failed", reason: "no model" });
  });
});

describe("outcomes", () => {
  it("agent_end → done ok (+cost), notify done, streak reset; crash → failed; needs_you once per run", async () => {
    const store = new ScheduleStore(tmp()); const s = store.create({ ...input }, new Date(2026, 8, 10, 12));
    store.replace({ ...store.get(s.id)!, failStreak: 2 });
    const { h, calls } = host(); const sch = new Scheduler(store, h); await sch.tick();
    sch.onNeedsYou("sess-1"); sch.onNeedsYou("sess-1");
    expect(calls.filter((c) => c === "notify:needs_you")).toHaveLength(1);
    sch.onAgentEnd("sess-1", 120_000, 0.03);
    expect(store.get(s.id)!.runs.at(-1)).toMatchObject({ sessionId: "sess-1", outcome: "ok", durationMs: 120_000, costUsd: 0.03 });
    expect(store.get(s.id)!.failStreak).toBe(0); expect(calls).toContain("notify:done");
    sch.onAgentEnd("sess-1", 1); // a second end for the same run (user prompted it) is not a run
    expect(store.get(s.id)!.runs).toHaveLength(1);
  });
  it("notifyOnDone:false silences done but never needs_you", async () => {
    const store = new ScheduleStore(tmp()); store.create({ ...input, notifyOnDone: false }, new Date(2026, 8, 10, 12));
    const { h, calls } = host(); const sch = new Scheduler(store, h); await sch.tick();
    sch.onNeedsYou("sess-1"); sch.onAgentEnd("sess-1", 5);
    expect(calls).toContain("notify:needs_you"); expect(calls).not.toContain("notify:done");
  });
});

describe("catch-up", () => {
  const overdue = () => { const st = new ScheduleStore(tmp()); const s = st.create(input, new Date(2026, 8, 7, 12)); return { st, s }; }; // due Sep 8 9:00, now Sep 11
  it("ask parks and returns the id; answering run fires once; skip advances", async () => {
    const { st, s } = overdue(); const { h } = host(); const sch = new Scheduler(st, h);
    expect(await sch.catchUp()).toEqual([s.id]);
    expect(st.get(s.id)!.missed).toEqual({ slotAt: s.nextRunAt }); expect(h.createRunSession).not.toHaveBeenCalled();
    await sch.answerMissed(s.id, "run");
    expect(h.createRunSession).toHaveBeenCalledTimes(1); expect(st.get(s.id)!.missed).toBeUndefined();
    expect(new Date(st.get(s.id)!.nextRunAt!)).toEqual(new Date(2026, 8, 12, 9, 0));
  });
  it("always fires exactly once for a three-day gap; never only advances", async () => {
    const a = overdue(); a.st.update(a.s.id, { catchUp: "always" }, new Date(2026, 8, 7, 12));
    const ha = host(); await new Scheduler(a.st, ha.h).catchUp(); expect(ha.h.createRunSession).toHaveBeenCalledTimes(1);
    const b = overdue(); b.st.update(b.s.id, { catchUp: "never" }, new Date(2026, 8, 7, 12));
    const hb = host(); await new Scheduler(b.st, hb.h).catchUp(); expect(hb.h.createRunSession).not.toHaveBeenCalled();
    expect(b.st.get(b.s.id)!.runs.at(-1)).toMatchObject({ outcome: "skipped", reason: "missed" });
  });
  it("an unanswered ask is recorded skipped:unanswered when the next slot arrives, and that slot fires normally", async () => {
    const { st, s } = overdue(); let now = new Date(2026, 8, 10, 10); const { h } = host({ now: () => now });
    const sch = new Scheduler(st, h); await sch.catchUp();
    now = new Date(2026, 8, 11, 9, 0, 30); await sch.tick();
    const runs = st.get(s.id)!.runs; expect(runs.some((r) => r.outcome === "skipped" && r.reason === "unanswered")).toBe(true);
    expect(h.createRunSession).toHaveBeenCalledTimes(1); expect(st.get(s.id)!.missed).toBeUndefined();
  });
  it("runNow respects the busy gate and reports it", async () => {
    const st = new ScheduleStore(tmp()); const s = st.create(input, new Date(2026, 8, 11, 12));
    const { h } = host({ workspaceIdle: () => false });
    expect(await new Scheduler(st, h).runNow(s.id)).toEqual({ ok: false, reason: "busy" });
    expect(await new Scheduler(st, host().h).runNow(s.id)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `src/main/scheduler.ts`** exactly to the algorithm above. Key bodies:

```ts
export class Scheduler {
  private readonly inflight = new Map<string, { scheduleId: string; firedAt: string; needsYouSent: boolean }>();
  constructor(private readonly store: ScheduleStore, private readonly host: SchedulerHost) {}

  async tick(): Promise<void> {
    const now = this.host.now();
    for (const s of this.store.list()) {
      if (!s.enabled || !s.nextRunAt) continue;
      // A parked ask whose slot was superseded: withNextRun records it as skipped:unanswered,
      // and THIS tick fires the new slot (§5.3: "the new slot fires normally") — with `now` as
      // the slot, so the busy gate's 2 h window starts here.
      if (s.missed) {
        const n = withNextRun(s, now);
        if (n.missed !== undefined) continue;          // still parked, slot not yet superseded
        this.store.replace(n); this.host.changed();
        await this.fire(n, now); continue;
      }
      const cur = this.store.get(s.id)!;
      if (!cur.nextRunAt || new Date(cur.nextRunAt) > now) continue;
      await this.fire(cur, new Date(cur.nextRunAt));
    }
  }

  private async fire(s: Schedule, slot: Date): Promise<void> {
    const now = this.host.now();
    if (!this.host.workspaceExists(s.workspaceId)) {
      this.record(s, { firedAt: slot.toISOString(), outcome: "skipped", reason: "workspace-gone" }, { enabled: false }); this.host.log("schedule.skip", s, { reason: "workspace-gone" }); return;
    }
    if (!this.host.workspaceIdle(s.workspaceId)) {
      if (now.getTime() - slot.getTime() < BUSY_WAIT_MS) return; // retry next tick; nextRunAt untouched
      this.record(s, { firedAt: slot.toISOString(), outcome: "skipped", reason: "busy" }); this.host.log("schedule.skip", s, { reason: "busy" }); return;
    }
    // Advance FIRST so a crash below cannot re-fire this slot.
    let cur = withNextRun({ ...s, missed: undefined }, now); this.store.replace(cur);
    const firedAt = now.toISOString();
    try {
      let sessionId: string; const data: Record<string, unknown> = {};
      if (cur.reuseSession && cur.reusedSessionId && this.host.sessionExists(cur.reusedSessionId)) {
        sessionId = cur.reusedSessionId; await this.host.resumeSession(sessionId);
      } else if (cur.reuseSession) {
        sessionId = await this.host.createRunSession(cur, cur.title); cur = { ...cur, reusedSessionId: sessionId }; this.store.replace(cur); data.reusedSessionRecreated = true;
      } else {
        await this.host.archivePreviousRun(cur);
        sessionId = await this.host.createRunSession(cur, runTitle(cur.title, now));
      }
      this.inflight.set(sessionId, { scheduleId: cur.id, firedAt, needsYouSent: false });
      await this.host.prompt(sessionId, cur.prompt);
      this.host.log("schedule.fire", cur, { sessionId, mode: cur.mode, ...data });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.record(this.store.get(cur.id)!, { firedAt, outcome: "failed", reason }); this.host.log("schedule.done", cur, { outcome: "failed", reason });
    }
    this.host.changed();
  }

  private record(s: Schedule, run: ScheduleRun, patch: Partial<Schedule> = {}): void {
    const next = { ...applyOutcome(s, run), ...patch };
    this.store.replace(next.enabled === s.enabled ? next : withNextRun(next, this.host.now())); this.host.changed();
  }

  onAgentEnd(sessionId: string, durationMs: number, costUsd?: number): void {
    const f = this.inflight.get(sessionId); if (!f) return; this.inflight.delete(sessionId);
    const s = this.store.get(f.scheduleId); if (!s) return;
    const run: ScheduleRun = { sessionId, firedAt: f.firedAt, outcome: "ok", durationMs, ...(costUsd !== undefined ? { costUsd } : {}) };
    this.record(s, run); this.host.log("schedule.done", s, { outcome: "ok", durationMs, sessionId });
    if (s.notifyOnDone) this.host.notify("done", s, { sessionId, durationMs, costUsd });
  }
  onSessionCrash(sessionId: string, error: string): void { /* same shape, outcome "failed", reason error, no notify */ }
  onNeedsYou(sessionId: string): void { const f = this.inflight.get(sessionId); if (!f || f.needsYouSent) return; f.needsYouSent = true; const s = this.store.get(f.scheduleId); if (s) this.host.notify("needs_you", s, { sessionId }); }
  // catchUp(): for each schedule, catchUpDecision → fire (once, via this.fire(s, slot)) | park (store.replace({...s, missed:{slotAt}}); log schedule.missed) | advance (record skipped reason "missed"; withNextRun). Returns parked ids; if any, host.notify("missed", first, {count}).
  // answerMissed(id, "run"): clear missed then this.fire(s, new Date(slotAt)); "skip": record skipped reason "missed" + withNextRun.
  // runNow(id): gone → {ok:false,"gone"}; !enabled → "disabled"; !workspaceIdle → "busy"; else fire(s, now) and {ok:true}.
  scheduleOfSession(sessionId: string) { const f = this.inflight.get(sessionId); return f ? this.store.get(f.scheduleId) : undefined; }
}
```
Write the three commented methods in full — the test file above is their spec.

- [ ] **Step 4: Run** `npx vitest run tests/scheduler.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(schedules): the Scheduler — tick, busy gate, catch-up, outcomes, all effects injected`.

- [ ] **Step 6: Wire it in `ipc.ts`** (no new unit test — the host is thin; `tests/schedules-source.test.ts` gains the scans below):

  a. **Factor `promptSession`.** Turn the `hv:prompt-session` handler body (`:2983-3160`) into `const promptSession = async (sessionId, msg, behavior?, images?, mentions?, openFiles?, documents?, opts: { source?: "user" | "schedule" } = {}) => { …same body… }` and make the handler `(_e, ...args) => promptSession(...args)`. Inside, `index.touch(sessionId)` and the `firstPrompt` title logic run only when `opts.source !== "schedule"` — that is what keeps `lastUsedAt` meaning "the USER used it", which `archivePreviousRun` relies on.
  b. **Store + scheduler**, after `const activity = …` and `const manager = …`:
```ts
  const scheduleStore = new ScheduleStore(path.join(userData, "schedules.json"));
  const schedulesChanged = (): void => send("hv:schedules-changed", scheduleStore.list());
  const scheduler = new Scheduler(scheduleStore, {
    now: () => new Date(),
    workspaceExists: (ws) => workspaces.list().some((w) => normPath(w) === normPath(ws)),   // export normPath from store.ts
    workspaceIdle: (ws) => sessionsOfWorkspace(index.list(), ws).every((s) => manager.get(s.id) === null || activity.isIdle(s.id)),
    sessionExists: (id) => !!index.get(id),
    createRunSession: async (s, title) => {
      await ensureDefaultModel();
      const meta = index.create(s.workspaceId);
      index.update(meta.id, { scheduleId: s.id, title, titleSource: "user", ...(s.model ? { model: s.model } : {}) }); // titleSource "user": never auto-retitled by the model
      try { await startClient(index.get(meta.id)!, false); } catch (e) { index.remove(meta.id); throw e; }
      sessionsChanged(); return meta.id;
    },
    resumeSession: async (id) => { const meta = index.get(id); if (!meta) throw new Error("session gone"); if (!manager.get(id)) await startClient(meta, !!meta.piSessionFile); },
    archivePreviousRun: async (s) => {
      const prev = [...s.runs].reverse().find((r) => r.sessionId && index.get(r.sessionId) && !index.get(r.sessionId)!.archived);
      if (!prev?.sessionId) return;
      const m = index.get(prev.sessionId)!;
      // Adopted = the user prompted it after it fired (touch happens only for user prompts) or renamed it away from the run title.
      const adopted = (m.lastUsedAt && m.lastUsedAt > prev.firedAt) || m.title !== runTitle(s.title, new Date(prev.firedAt));
      if (adopted) return;
      if (manager.get(m.id)) await endSession(m.id);
      index.update(m.id, { archived: true }); sessionsChanged();
    },
    prompt: (sessionId, text) => promptSession(sessionId, text, undefined, undefined, undefined, undefined, undefined, { source: "schedule" }).then(() => undefined),
    log: (type, s, data) => { void log.append({ type, workspaceId: s.workspaceId, sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined, data: { scheduleId: s.id, title: s.title, ...data } }); },
    notify: (kind, s, x) => showScheduleNotification(kind, s, x),   // Step 6e
    changed: schedulesChanged,
  });
```
     `startClient` must pass `readonly`: in `spawnOpts(workspace, resumeFile, sessionId)` add `readonly: !!sessionId && scheduleStore.get(index.get(sessionId)?.scheduleId ?? "")?.mode === "readonly"` — re-derived at every spawn/resume (decision 9). `spawnOpts` is declared before `scheduleStore`; hoist the store declaration above it (it has no deps).
  c. **Tick**: after wiring, `const tickTimer = setInterval(() => void scheduler.tick(), 60_000); app.on("will-quit", () => clearInterval(tickTimer));` `powerMonitor.on("resume", () => void scheduler.catchUp().then(() => scheduler.tick()));` and once at boot: `void scheduler.catchUp().then((parked) => { if (parked.length) send("hv:schedules-missed", parked); }).then(() => scheduler.tick());` (`powerMonitor` is importable here — `registerIpc` runs inside `app.whenReady`).
  d. **Outcome hooks**: in `attach`'s `agent_end` branch add `if (meta?.scheduleId) { const c = sessionCostNow(sessionId); scheduler.onAgentEnd(sessionId, Date.now() - (turnStartedAt.get(sessionId) ?? Date.now()), c); }` where `sessionCostNow` = `sessionCalls(sessionDir(), index.get(sessionId)?.piSessionFile, planProvidersFor(providerKeyStatus()))` → `ledgerTotal(calls).usd` if that field exists (read `LedgerTotal` in `calls.ts` for the exact field; omit when `null`). Record `turnStartedAt.set(sessionId, Date.now())` inside `promptSession`. In `session-exit`: `if (!intentional && meta?.scheduleId) scheduler.onSessionCrash(sessionId, stderr?.slice(-200) || \`exit ${code}\`)`. Where `isPermissionPrompt(r)` is true (`:2280`): `if (meta?.scheduleId) scheduler.onNeedsYou(sessionId);`.
  e. **Notifications** (`import { Notification } from "electron"`):
```ts
  const showScheduleNotification = (kind: "done" | "needs_you" | "missed", s: Schedule, x: { sessionId?: string; count?: number; durationMs?: number; costUsd?: number }): void => {
    if (!Notification.isSupported()) return;
    const body = kind === "needs_you" ? `${s.title} needs your permission`
      : kind === "missed" ? `${x.count} schedule${x.count === 1 ? "" : "s"} missed ${x.count === 1 ? "its" : "their"} time`
      : `${s.title} finished${x.durationMs ? ` · ${Math.round(x.durationMs / 60000)} min` : ""}${x.costUsd !== undefined ? ` · $${x.costUsd.toFixed(2)}` : ""}`;
    const n = new Notification({ title: "HappyVibe", body, silent: kind === "done" });
    n.on("click", () => {
      const w = windows.primary() ?? openWindowFromIpc();   // index.ts exposes `openWindow`; pass it into registerIpc like persistLayout
      w.show(); w.focus();
      if (kind === "missed") send("hv:schedules-missed", scheduleStore.list().filter((s) => s.missed).map((s) => s.id));
      else if (x.sessionId) send("hv:show-session", { sessionId: x.sessionId, workspaceId: s.workspaceId });
    });
    n.show();
  };
```
     Add a third `registerIpc` parameter `openWindow: () => BrowserWindow` supplied by `index.ts:398` as `() => openWindow({ tabsByWs: {}, ui: {} })`.
  f. **IPC**:
```ts
  ipcMain.handle("hv:schedules-list", () => scheduleStore.list());
  ipcMain.handle("hv:schedule-save", (_e, input: NewSchedule & { id?: string }) => {
    const v = validateScheduleInput(input, workspaces.list()); // pure, in schedules.ts: title non-empty ≤120, prompt non-empty ≤20k, workspace registered, repeat/at parse, mode ∈, catchUp ∈ — throws Error(message)
    const s = input.id ? scheduleStore.update(input.id, v, new Date()) : scheduleStore.create(v, new Date());
    if (!s) throw new Error("Unknown schedule");
    void log.append({ type: input.id ? "schedule.update" : "schedule.create", workspaceId: s.workspaceId, data: { scheduleId: s.id, title: s.title, mode: s.mode, source: "user" } });
    schedulesChanged(); return s;
  });
  ipcMain.handle("hv:schedule-delete", (_e, id: string) => { const s = scheduleStore.get(id); scheduleStore.remove(id); if (s) void log.append({ type: "schedule.delete", workspaceId: s.workspaceId, data: { scheduleId: id, title: s.title } }); schedulesChanged(); });
  ipcMain.handle("hv:schedule-missed-answer", (_e, id: string, answer: "run" | "skip") => scheduler.answerMissed(id, answer));
  ipcMain.handle("hv:schedule-run-now", (_e, id: string) => scheduler.runNow(id));
  ipcMain.handle("hv:schedule-run-costs", (_e, id: string) => { /* {sessionId → usd|null} for the row's history + 30-day total, via sessionCalls/ledgerTotal over s.runs[].sessionId; null when a file is unreadable (§19 3a) */ });
  ipcMain.handle("hv:login-item-get", () => ({ available: app.isPackaged, openAtLogin: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false }));
  ipcMain.handle("hv:login-item-set", (_e, on: boolean) => { if (!app.isPackaged) throw new Error("Not available in development"); app.setLoginItemSettings({ openAtLogin: on }); });
```
     Add `validateScheduleInput` to `schedules.ts` with tests in `tests/schedules.test.ts` (rejects empty title, unknown workspace, `at: "25:00"`, `weekly` with `days: []`; passes a valid input unchanged).
  g. **Source scans** in `tests/schedules-source.test.ts`: `setLoginItemSettings` appears in `src/` exactly once and inside the `hv:login-item-set` handler; `promptSession(` is called from the scheduler host with `source: "schedule"`; `index.touch(` inside `promptSession` is guarded by `opts.source !== "schedule"`; `Notification` is constructed only in `showScheduleNotification`.

- [ ] **Step 7: Run** `npm run typecheck`, `npx vitest run tests/schedules-source.test.ts tests/schedules.test.ts`, then `npm test` (the prompt-session refactor touches every prompt path — the whole non-live suite is the check) → green.

- [ ] **Step 8: Commit** `feat(schedules): main wires the scheduler — tick, resume, outcomes, notifications, IPC, login item`.

---
### Task 7: The four `schedule_*` bridge tools + `hv.schedule-*` envelopes in main

**Files:**
- Create: `src/main/scheduleEnvelopes.ts`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (tools, inside `if (builtins.schedules) { … }`, placed right after the `// builtins.memory` block ends at `:2355`; `INTENT_TOOLS` at `:249`), `pi-runtime/extensions/hv-rules.ts:78` (`SAFE_TOOLS` + `"schedule_list"`), `src/main/ipc.ts` (ui-request dispatch beside the memory envelope handler at `:2100-2170`)
- Test: `tests/schedules-tools.test.ts`; extend `tests/schedules-source.test.ts`, `tests/builtins-contract.test.ts` (the registered-tool inventory — add the four names to whatever list it derives; read the file first)

**Interfaces:**
```ts
// src/main/scheduleEnvelopes.ts — pure
export type ScheduleEnvelope =
  | { kind: "hv.schedule-list" }
  | { kind: "hv.schedule-create"; draft: ScheduleDraft }
  | { kind: "hv.schedule-update"; id: string; patch: Partial<ScheduleDraft> }
  | { kind: "hv.schedule-delete"; id: string };
export interface ScheduleDraft { title: string; prompt: string; repeat: Repeat; at: string; mode?: ScheduleMode; catchUp?: CatchUp; reuseSession?: boolean; notifyOnDone?: boolean }
export function parseScheduleEnvelope(r: { method?: string; title?: string }): ScheduleEnvelope | null;  // null for a payload carrying `workspaceId` (the model must not name one) or a malformed repeat/at
export function describeScheduleCall(env: ScheduleEnvelope, existing?: Schedule): string;               // FACTUAL permission display: "Delete schedule “Daily change review” (Weekdays at 9:00)"
```
- Tool results (strings the bridge returns): `schedule_list` → a bullet list `• <title> — <recurrence> — <mode> — next <iso|never> — last <outcome> [$x]` or `No schedules in this workspace.`; `schedule_create` → `created <id>` | `declined`; `schedule_update` → `updated <id>` | `declined` | `not found`; `schedule_delete` → `deleted` | `not found` (the permission gate, not the tool, handles a denial — the call never reaches main).
- Renderer contract (Task 8): main pushes `hv:schedule-drawer-request { requestId, workspaceId, draft, existingId? }`; the renderer answers `hv:schedule-drawer-answer(requestId, { saved: Schedule } | { cancelled: true })`. Main resolves the envelope from that answer. **Timeout: none** (prompts never time out); a window close resolves `declined`.

- [ ] **Step 1: Failing tests**

```ts
// tests/schedules-tools.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
import { describeScheduleCall, parseScheduleEnvelope } from "../src/main/scheduleEnvelopes";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";

const inp = (p: unknown) => ({ method: "input", title: JSON.stringify(p) });
const draft = { title: "T", prompt: "p", repeat: { kind: "daily" }, at: "09:00" };

describe("parseScheduleEnvelope", () => {
  it("parses the four kinds", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-list" }))).toEqual({ kind: "hv.schedule-list" });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft }))).toEqual({ kind: "hv.schedule-create", draft });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-update", id: "x", patch: { at: "10:00" } }))).toEqual({ kind: "hv.schedule-update", id: "x", patch: { at: "10:00" } });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-delete", id: "x" }))).toEqual({ kind: "hv.schedule-delete", id: "x" });
  });
  it("refuses a workspaceId anywhere — scoping is main's, the model cannot name a workspace", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-list", workspaceId: "/other" }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, workspaceId: "/other" } }))).toBeNull();
  });
  it("refuses a malformed repeat or time, a non-input method, and non-JSON", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, at: "9am" } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, repeat: { kind: "cron", expr: "* * *" } } }))).toBeNull();
    expect(parseScheduleEnvelope({ method: "notify", title: JSON.stringify({ kind: "hv.schedule-list" }) })).toBeNull();
    expect(parseScheduleEnvelope({ method: "input", title: "{nope" })).toBeNull();
  });
  it("never accepts a bypass or enabled:true via create (a new schedule is enabled by the drawer, not by the model)", () => {
    const env = parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, bypass: true, enabled: true } }));
    expect(env && "draft" in env && Object.keys(env.draft)).toEqual(["title", "prompt", "repeat", "at"]);
  });
});

describe("describeScheduleCall", () => {
  it("names the schedule and its recurrence, never an intent", () => {
    const s = { title: "Daily change review", repeat: { kind: "weekdays" }, at: "09:00" } as never;
    expect(describeScheduleCall({ kind: "hv.schedule-delete", id: "x" }, s)).toBe("Delete schedule “Daily change review” (Weekdays at 9:00)");
    expect(describeScheduleCall({ kind: "hv.schedule-create", draft: { ...draft, title: "New" } as never })).toBe("Create schedule “New” (Every day at 9:00)");
  });
});

describe("gate placement", () => {
  it("schedule_list is a safe default; the three writers are not", () => {
    expect(SAFE_TOOLS.has("schedule_list")).toBe(true);
    for (const t of ["schedule_create", "schedule_update", "schedule_delete"]) expect(SAFE_TOOLS.has(t), t).toBe(false);
  });
  it("the three writers require intent; list does not; all four register only under builtins.schedules", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
    const intent = /const INTENT_TOOLS = \[([^\]]*)\]/.exec(src)![1];
    for (const t of ["schedule_create", "schedule_update", "schedule_delete"]) expect(intent).toContain(`"${t}"`);
    expect(intent).not.toContain('"schedule_list"');
    const block = src.slice(src.indexOf("if (builtins.schedules) {"), src.indexOf("} // builtins.schedules"));
    for (const t of ["schedule_list", "schedule_create", "schedule_update", "schedule_delete"]) expect(block).toContain(`name: "${t}"`);
  });
  it("no bundled agent asks for a schedule tool", () => {
    const dir = path.join(process.cwd(), "pi-runtime/agents");
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/schedule_/);
  });
  it("main resolves every schedule envelope on BOTH answer paths (respondUi in the saved and the cancelled branch)", () => {
    const ipc = fs.readFileSync(path.join(process.cwd(), "src/main/ipc.ts"), "utf8");
    const h = ipc.slice(ipc.indexOf("parseScheduleEnvelope(r"), ipc.indexOf("// end schedule envelopes"));
    expect(h.match(/respondUi\(/g)!.length).toBeGreaterThanOrEqual(4); // list, create/update saved, create/update cancelled, delete, plus the error path
    expect(h).toContain('"declined"'); expect(h).toContain('"not found"');
  });
});
```
(Check `pi-runtime/agents` is the bundled-agents directory — `grep -rn "installBuiltinAgents" src/main/config.ts` names it; adjust the path.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`src/main/scheduleEnvelopes.ts`: parse with the same shape as `parseMemoryEnvelope` (`ipc.ts:464`); a `draft`/`patch` is rebuilt field by field (only `title, prompt, repeat, at, mode, catchUp, reuseSession, notifyOnDone`) so unknown keys are dropped; `repeat` validated through `nextFire(repeat, at, new Date()) !== null || repeat.kind === "once"`; any `workspaceId` key at top level or in draft/patch → `null`. `describeScheduleCall` uses `humanRecurrence`.

Bridge — after the memory block:
```ts
  // ── §35 Schedules: four tools, main owns every decision ────────────────────
  if (builtins.schedules) {
    const scheduleAsk = async (ctx: { ui: { input: (t: string, v: string) => Promise<unknown> } }, payload: Record<string, unknown>): Promise<string> => {
      const raw = await ctx.ui.input(JSON.stringify(payload), "");
      return typeof raw === "string" && raw ? raw : "ERROR: no answer";
    };
    const RepeatSchema = Type.Union([
      Type.Object({ kind: Type.Literal("daily") }), Type.Object({ kind: Type.Literal("weekdays") }),
      Type.Object({ kind: Type.Literal("weekly"), days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1 }) }),
      Type.Object({ kind: Type.Literal("hours"), every: Type.Integer({ minimum: 1, maximum: 23 }) }),
      Type.Object({ kind: Type.Literal("once"), date: Type.String({ description: "YYYY-MM-DD" }) }),
    ]);
    const Mode = Type.Union([Type.Literal("readonly"), Type.Literal("full")], { description: "readonly = can read and report only; full = this workspace's permission rules, asks wait for the user." });
    pi.registerTool({
      name: "schedule_list", label: "List schedules",
      description: "List this workspace's schedules: title, when they run, mode, next run, last outcome.",
      parameters: Type.Object({}),
      async execute(_id, _p, _s, _u, ctx) { const raw = await scheduleAsk(ctx, { kind: "hv.schedule-list" }); return { content: [{ type: "text", text: raw }] }; },
    });
    pi.registerTool({
      name: "schedule_create", label: "Propose a schedule",
      description: "Propose a recurring run of a prompt in this workspace. The user sees the proposal in a drawer and confirms or declines; nothing is created until they do.",
      parameters: Type.Object({ intent: intentParam(), title: Type.String(), prompt: Type.String(), repeat: RepeatSchema, at: Type.String({ description: "HH:MM, local time" }), mode: Type.Optional(Mode) }),
      async execute(_id, params, _s, _u, ctx) {
        const p = params as { title: string; prompt: string; repeat: unknown; at: string; mode?: string };
        const raw = await scheduleAsk(ctx, { kind: "hv.schedule-create", draft: { title: p.title, prompt: p.prompt, repeat: p.repeat, at: p.at, ...(p.mode ? { mode: p.mode } : {}) } });
        return { content: [{ type: "text", text: raw.startsWith("created ") ? `Schedule created (${raw.slice(8)}). It appears on the Schedules page.` : raw === "declined" ? "The user declined the schedule." : raw }], details: { result: raw } };
      },
    });
    // schedule_update: parameters {intent, id, title?, prompt?, repeat?, at?, mode?} → envelope {kind:"hv.schedule-update", id, patch}; same result mapping with "updated ".
    // schedule_delete: parameters {intent, id} → envelope {kind:"hv.schedule-delete", id}; result "deleted" | "not found".
  } // builtins.schedules
```
`INTENT_TOOLS` → `[..., "schedule_create", "schedule_update", "schedule_delete"]`. `hv-rules.ts` `SAFE_TOOLS` + `"schedule_list"`. Also add the three writers + `schedule_list` to `PLAN_PASS_TOOLS`? **No** — in Plan mode the writers must floor-ask (they are side effects) and `schedule_list` is in `SAFE_TOOLS`, which the plan gate's floor-ask clamps to ask; add ONLY `"schedule_list"` to `PLAN_PASS_TOOLS` with a comment ("a read; floor-ask would prompt on every list").

`ipc.ts` — in the `ui-request` handler beside the memory envelope branch:
```ts
      const sched = parseScheduleEnvelope(r as { method?: string; title?: string });
      if (sched) {
        void (async () => {
          const rid = r.id; const ws = meta?.workspaceId;
          const answer = (v: string): void => client.respondUi(rid, { value: v });
          try {
            if (!ws) return answer("ERROR: no workspace");
            const mine = scheduleStore.list().filter((s) => normPath(s.workspaceId) === normPath(ws));
            if (sched.kind === "hv.schedule-list") return answer(renderScheduleList(mine, runCostsFor)); // pure, in schedules.ts
            if (sched.kind === "hv.schedule-delete") {
              const s = mine.find((x) => x.id === sched.id); if (!s) return answer("not found");
              scheduleStore.remove(s.id); void log.append({ type: "schedule.delete", sessionId, workspaceId: ws, data: { scheduleId: s.id, title: s.title, source: "agent" } }); schedulesChanged(); return answer("deleted");
            }
            const existing = sched.kind === "hv.schedule-update" ? mine.find((x) => x.id === sched.id) : undefined;
            if (sched.kind === "hv.schedule-update" && !existing) return answer("not found");
            const draft = sched.kind === "hv.schedule-create" ? { mode: "full", catchUp: "ask", reuseSession: false, notifyOnDone: true, ...sched.draft } : { ...existing!, ...sched.patch };
            const res = await drawerRequest({ workspaceId: ws, draft, existingId: existing?.id, sessionId }); // Promise<{saved: Schedule} | {cancelled: true}>; resolved by hv:schedule-drawer-answer; rejected-as-cancelled if every window closes
            if ("cancelled" in res) return answer("declined");
            void log.append({ type: existing ? "schedule.update" : "schedule.create", sessionId, workspaceId: ws, data: { scheduleId: res.saved.id, title: res.saved.title, mode: res.saved.mode, source: "agent" } });
            answer(`${existing ? "updated" : "created"} ${res.saved.id}`);
          } catch (e) { answer(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
        })();
        return;
      }
      // end schedule envelopes
```
`drawerRequest` keeps a `Map<requestId, resolve>`; pushes `send("hv:schedule-drawer-request", {...})`; `ipcMain.on("hv:schedule-drawer-answer", (_e, requestId, res))` resolves (the renderer calls `hv:schedule-save` itself before answering `saved`, so main has ONE write path). The permission prompt for `schedule_delete` is the ordinary gate: extend `unwrapMcpCall`-style factual display — in `toolLabel.ts`/the gate's `summary` for tool `schedule_delete` use `describeScheduleCall` (renderer imports from `src/main/scheduleEnvelopes.ts` like it imports `hv-rules`; check an existing main→renderer pure import first, e.g. `subagentSettings`).

- [ ] **Step 4: Run** `npx vitest run tests/schedules-tools.test.ts tests/schedules-source.test.ts tests/builtins-contract.test.ts tests/hv-readonly.test.ts` + `npm run typecheck` → green. (`builtins-contract` spawns Pi with a dummy key and lists registered tools — it will now see the four names; update its expected inventory.)

- [ ] **Step 5: Commit** `feat(bridge): schedule_list/create/update/delete — the model proposes, the drawer confirms`.

---
### Task 8: Renderer — sidebar row, Schedules page, drawer, missed dialog, Read-only pill, "Repeat this…"

**Files:**
- Create: `src/renderer/src/schedulesCopy.ts`, `src/renderer/src/components/SchedulesView.tsx`, `src/renderer/src/components/ScheduleDrawer.tsx`, `src/renderer/src/components/MissedRunsDialog.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx:15-27` (View), `:960-1000` (row under the search header), `:845-900` (rail button), `:520-560` (clock glyph on a run row); `src/renderer/src/App.tsx:2631-2637` (navigate), `:3046` (page render), state for `readonlyRuns`, `schedulePrefill`, `drawerRequest`, `missedIds`, `hv:show-session`; `src/renderer/src/components/ChatView.tsx:949` (Read-only pill), `:1590-1612` (＋ menu item), props `readonlyRun`, `onRepeatOnSchedule`; `src/renderer/src/components/TabStrip.tsx:390-405` (menu item + `onRepeatOnSchedule` prop); `src/renderer/src/components/EmptyState.tsx:24` (`schedules` key); `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Test: `tests/schedules-renderer.test.ts`; extend `tests/sidebar-groups.test.ts`; `tests/empty-state.test.ts` (automatic)

**Interfaces (exported DATA for the no-DOM suite, in `schedulesCopy.ts`):**
```ts
export const REPEAT_LABELS = { daily: "Every day", weekdays: "Weekdays", weekly: "Weekly", hours: "Every N hours", once: "Once" } as const;
export const MODE_CARDS = {
  full: { title: "Full session", body: "Runs like a session you started. If it needs permission, it waits for you.", sub: "Uses this workspace's permission rules." },
  readonly: { title: "Read-only", body: "Can read, search and report. Cannot change files or run commands.", sub: "" },
} as const;                                                                    // exactly two keys — a test asserts it
export const CATCH_UP_LABELS = { ask: ["Ask me", "When HappyVibe is back, ask whether to run it now."], always: ["Run it once", "Run once when HappyVibe is back, then return to the usual times."], never: ["Skip it", "Wait for the next scheduled time."] } as const;
export const OUTCOME_MARK = { ok: "✓", needs_you: "⚠", failed: "✕", skipped: "–", never: "—" } as const;
export const TEMPLATES: ReadonlyArray<{ title: string; prompt: string; repeat: Repeat; at: string; mode: "readonly" }> = [
  { title: "Daily change review", prompt: "Review every change committed since yesterday in this repository. For each, say what it does and whether anything looks risky (security, data loss, behaviour changes without tests). Finish with a short prioritised list.", repeat: { kind: "weekdays" }, at: "09:00", mode: "readonly" },
  { title: "Weekly dependency check", prompt: "List this project's dependencies that have a newer version or a known advisory. Group by risk; name the ones worth updating this week and why.", repeat: { kind: "weekly", days: [1] }, at: "09:00", mode: "readonly" },
  { title: "Release readiness", prompt: "Compare the current branch with the last release tag. List what shipped, what has no test, what the changelog is missing, and anything that should block a release.", repeat: { kind: "weekly", days: [4] }, at: "16:00", mode: "readonly" },
  { title: "Weekly repo health", prompt: "Read the repository's structure, TODO/FIXME comments, failing or skipped tests and stale branches. Report the five things most worth cleaning up, with the file paths.", repeat: { kind: "weekly", days: [5] }, at: "15:00", mode: "readonly" },
];
export const PAUSED_COPY = "Paused after 3 failed runs — check the model or the key.";
export const LOGIN_ITEM_COPY = "HappyVibe has to be open for schedules to run.";
export function scheduleSubtitle(list: Schedule[], now: Date): string | null;   // "3 active · next 9:00" | "2 missed · decide" | null when empty
export function lastRunLabel(s: Schedule): string;                              // "✓ 2 min · $0.03" | "⚠ needs you" | "✕ failed: 402" | "— never ran"
export function nextRunLabel(s: Schedule, now: Date): string;                    // "in 14 h" | "paused" | "off" | "once, done"
```
- `View` gains `"schedules"`. `groupFor("schedules")` stays `null` (it is not in `NAV`). `App.navigate`: `if (t.view !== "chat" && t.view !== "schedules") setSettingsOpen(true);`.
- New window.hv: `schedulesList()`, `scheduleSave(input)`, `scheduleDelete(id)`, `scheduleMissedAnswer(id, "run"|"skip")`, `scheduleRunNow(id)`, `scheduleRunCosts(id)`, `loginItemGet()`, `loginItemSet(on)`, `scheduleDrawerAnswer(requestId, res)`, `onSchedulesChanged(cb)`, `onScheduleDrawerRequest(cb)`, `onSchedulesMissed(cb)`, `onShowSession(cb)`.
- `hv.readonly` notify → `App` `readonlyRuns: Record<sessionId, true>` → `ChatView readonlyRun` → the pill replaces the plan toggle for that session.

- [ ] **Step 1: Failing tests**

```ts
// tests/schedules-renderer.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
import { CATCH_UP_LABELS, lastRunLabel, MODE_CARDS, nextRunLabel, scheduleSubtitle, TEMPLATES } from "../src/renderer/src/schedulesCopy";
import { EMPTY_COPY } from "../src/renderer/src/components/EmptyState";
import { nextFire } from "../src/main/schedules";
const R = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const S = (o: object) => ({ id: "s", title: "T", prompt: "p", workspaceId: "/w", repeat: { kind: "daily" }, at: "09:00", mode: "full", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true, createdAt: "c", nextRunAt: null, failStreak: 0, runs: [], ...o }) as never;

describe("copy is data", () => {
  it("exactly two mode cards, three catch-up settings, four read-only templates whose times parse", () => {
    expect(Object.keys(MODE_CARDS)).toEqual(["full", "readonly"]);
    expect(Object.keys(CATCH_UP_LABELS)).toEqual(["ask", "always", "never"]);
    expect(TEMPLATES).toHaveLength(4);
    for (const t of TEMPLATES) { expect(t.mode).toBe("readonly"); expect(nextFire(t.repeat, t.at, new Date())).not.toBeNull(); }
  });
  it("the words are Schedules, never automation/cron/job", () => {
    const src = R("src/renderer/src/schedulesCopy.ts") + R("src/renderer/src/components/SchedulesView.tsx") + R("src/renderer/src/components/ScheduleDrawer.tsx") + R("src/renderer/src/components/MissedRunsDialog.tsx");
    expect(src.toLowerCase()).not.toMatch(/automation|cron|\bjob\b/);
  });
  it("EMPTY_COPY.schedules exists (its call site is checked by empty-state.test.ts)", () => { expect(EMPTY_COPY.schedules.headline).toBe("No schedules yet"); });
});

describe("row labels", () => {
  const now = new Date(2026, 8, 11, 19, 0);
  it("subtitle: count + next, missed wins, null when empty", () => {
    expect(scheduleSubtitle([], now)).toBeNull();
    expect(scheduleSubtitle([S({ nextRunAt: new Date(2026, 8, 12, 9).toISOString() }), S({ enabled: false })], now)).toBe("1 active · next 9:00");
    expect(scheduleSubtitle([S({ missed: { slotAt: "x" } }), S({ missed: { slotAt: "y" } })], now)).toBe("2 missed · decide");
  });
  it("last run: cost only when known; never ran; failed carries its reason", () => {
    expect(lastRunLabel(S({}))).toBe("— never ran");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "ok", durationMs: 125_000, costUsd: 0.03 }] }))).toBe("✓ 2 min · $0.03");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "ok", durationMs: 125_000 }] }))).toBe("✓ 2 min");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "failed", reason: "402" }] }))).toBe("✕ failed: 402");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "needs_you" }] }))).toBe("⚠ needs you");
  });
  it("next run: relative, paused after 3 failures, off, once-done", () => {
    expect(nextRunLabel(S({ nextRunAt: new Date(2026, 8, 12, 9).toISOString() }), now)).toBe("in 14 h");
    expect(nextRunLabel(S({ enabled: false, failStreak: 3 }), now)).toBe("paused");
    expect(nextRunLabel(S({ enabled: false }), now)).toBe("off");
    expect(nextRunLabel(S({ repeat: { kind: "once", date: "2026-09-01" } }), now)).toBe("once, done");
  });
});

describe("structure (source scans)", () => {
  it("the sidebar row is top-level under the search header and NOT a NAV entry; the rail has the clock", () => {
    const sb = R("src/renderer/src/components/Sidebar.tsx");
    expect(sb).toMatch(/data-hv-schedules-row/);          // the row element
    expect(sb).toMatch(/data-hv-schedules-rail/);         // the collapsed-rail button
    expect(sb.slice(sb.indexOf("export const NAV"), sb.indexOf("export function groupFor"))).not.toContain('"schedules"');
  });
  it("navigate does not open the Settings group for schedules", () => {
    expect(R("src/renderer/src/App.tsx")).toMatch(/t\.view !== "chat" && t\.view !== "schedules"\) setSettingsOpen\(true\)/);
  });
  it("the Read-only pill replaces the plan toggle for a run; the drawer has no bypass control", () => {
    const cv = R("src/renderer/src/components/ChatView.tsx");
    expect(cv).toContain("Read-only run");
    expect(cv).toMatch(/readonlyRun \? \(/); // the composer's plan toggle branch is conditional on it
    const dr = R("src/renderer/src/components/ScheduleDrawer.tsx");
    expect(dr.toLowerCase()).not.toMatch(/bypass|dangerous/);
    expect(dr).toContain('type="time"');
  });
  it("“Repeat this on a schedule…” lives in the tab menu and the composer ＋ menu", () => {
    expect(R("src/renderer/src/components/TabStrip.tsx")).toContain("Repeat this on a schedule…");
    expect(R("src/renderer/src/components/ChatView.tsx")).toContain("Repeat this on a schedule…");
    expect(R("src/renderer/src/components/Sidebar.tsx")).not.toContain("Repeat this on a schedule…"); // decision 8: not a row icon
  });
  it("the drawer answers a tool-opened request on BOTH Create and Cancel", () => {
    const dr = R("src/renderer/src/components/ScheduleDrawer.tsx");
    expect(dr.match(/scheduleDrawerAnswer\(/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("the login-item toggle renders only when main says available", () => {
    expect(R("src/renderer/src/components/SchedulesView.tsx")).toMatch(/loginItem\.available &&/);
  });
});
```
Extend `tests/sidebar-groups.test.ts` with:
```ts
  it("§35: Schedules is a top-level row, not a destination in a group", () => {
    expect(NAV.some((n) => (n.view as string) === "schedules")).toBe(false);
    expect(groupFor("schedules")).toBeNull();
  });
```

- [ ] **Step 2: Run** `npx vitest run tests/schedules-renderer.test.ts tests/sidebar-groups.test.ts tests/empty-state.test.ts` → FAIL.

- [ ] **Step 3: Implement**, in this order:

  a. `schedulesCopy.ts` — the exports above. `scheduleSubtitle`: `missed = list.filter(s => s.missed).length` → `"${n} missed · decide"`; else `active = enabled with nextRunAt`; `0` → `null`; next = min `nextRunAt` → `"${n} active · next H:MM"` (same-day) or `"· next Tue 9:00"`.
  b. `EmptyState.tsx`: `schedules: { headline: "No schedules yet", next: "Start from a template below, or open any session's tab menu and pick “Repeat this on a schedule…”." }`.
  c. `Sidebar.tsx`: `View` + `"schedules"`. Props + `schedules: Schedule[]` (App passes the list). Directly BELOW the header `div` that holds the wordmark/search/collapse buttons (`:960-1000`), before the search input block:
```tsx
        {/* §35: the app's first non-workspace top-level entry — the one thing that runs across workspaces on its own. Not a NAV entry (tests/sidebar-groups). */}
        <button type="button" data-hv-schedules-row onClick={() => onNavigate("schedules")}
          className={`mx-2 mt-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold cursor-pointer ${view === "schedules" ? "bg-honey-soft border border-honey/60" : "border border-transparent hover:bg-card/70"}`}>
          <ClockIcon />
          <span className="flex-1 text-left">Schedules</span>
          {subtitle && <span className="text-[10px] font-medium text-ink-soft truncate">{subtitle}</span>}
        </button>
```
     with `const subtitle = scheduleSubtitle(schedules, new Date());` and a `ClockIcon` SVG in the file's icon style (circle + two hands). In the collapsed rail (`:884+`), a `data-hv-schedules-rail` icon button beside the existing nav icons, `title="Schedules"`, with a small honey dot when `subtitle?.includes("missed")`. In `SessionRow` (`:545`), after the `planning` glyph: `{session.scheduleId && <span className="text-[10px] leading-none shrink-0" title="Started by a schedule" aria-label="scheduled run">🕰</span>}`.
  d. `SchedulesView.tsx`: header "Schedules" + `+` (opens the drawer empty) + template chips (each opens the drawer prefilled from `TEMPLATES[i]`, workspace = `activeWs`); a `LOGIN_ITEM_COPY` line with a `Toggle` when `loginItem.available` ("Open HappyVibe at login"); list grouped by workspace (`basename(ws)` headers, the sidebar's idiom), each row: 🕰 · title · `humanRecurrence` · mode pill (click → `scheduleSave({...s, mode: other})`, no drawer) · `lastRunLabel` · `nextRunLabel` · `Toggle enabled` · row click → drawer; a disabled-by-failure row shows `PAUSED_COPY` under it; expand (chevron) → last runs from `s.runs` with `OUTCOME_MARK`, `firedAt`, duration, cost from `scheduleRunCosts`, "Open" → `onOpenSession(sessionId)` when the session still exists; `createdBy?.source === "agent"` renders "created by the agent". Empty → `<EmptyState copy="schedules" />` + templates. Data: `window.hv.schedulesList()` on mount + `onSchedulesChanged`.
  e. `ScheduleDrawer.tsx`: right-side panel, same shell as the file drawer (`RightRail`'s width/border classes; `absolute right-0 inset-y-0 w-[420px]` inside the page) — fields in spec order (title · prompt textarea with the hint · workspace `<select>` over `workspaces` · Repeat segmented over `REPEAT_LABELS` + day picker for weekly + `every` number for hours + `<input type="date">` for once · `<input type="time">` · two `MODE_CARDS` (Full card shows *"This workspace bypasses permissions — runs will too."* when `bypassWorkspaces.has(ws)`, read via the existing bypass IPC) · reuse tickbox with its sub-line · `ModelSelect` · notify checkbox + the fixed copy line · catch-up segmented). Footer: "Runs automatically until you pause it." · Cancel · Create/Save. Props: `{ open, initial: Partial<Schedule>, workspaces, requestId?: string, onClose }`. On Create/Save: `await window.hv.scheduleSave(input)`; if `requestId` → `window.hv.scheduleDrawerAnswer(requestId, { saved })`; on Cancel/Esc → `scheduleDrawerAnswer(requestId, { cancelled: true })` when `requestId`. A tool-opened drawer shows a top line "Proposed by the agent in this session".
  f. `MissedRunsDialog.tsx`: `.hv-overlay`/`.hv-dialog` app-level dialog; rows: title · "was due Thu 9:00" · mode pill · last cost (`lastRunLabel`) · **Run now** / **Skip** → `scheduleMissedAnswer(id, …)`; footer **Run all** / **Skip all** loop the same call per id. Rows disappear via `onSchedulesChanged` (a schedule with no `missed` leaves the list); dialog closes when empty.
  g. `App.tsx`: state `schedules` (list, subscribed), `readonlyRuns`, `schedulePrefill: Partial<Schedule> | null`, `drawerReq: {requestId, draft, existingId?} | null`, `missedIds: string[]`. `parseReadonly(r)` beside `parsePlan` (`kind === "hv.readonly"` → `setReadonlyRuns(p => ({...p, [sid]: true}))`). `onScheduleDrawerRequest` → `setDrawerReq` + `navigate({ view: "schedules" })`. `onSchedulesMissed` → `setMissedIds`. `onShowSession({sessionId, workspaceId})` → `setWsSettings`/`setActiveWs(workspaceId)` then `openSession(sessionId)` (the existing tab-open path). `repeatOnSchedule(sid)`: `const first = transcripts[sid]?.find(i => i.kind === "user")`; `setSchedulePrefill({ workspaceId: meta.workspaceId, prompt: first?.text ?? "", title: meta.title })`; `navigate({ view: "schedules" })`. Render `{activeView === "schedules" && <SchedulesView … />}` beside `:3046`; `<MissedRunsDialog ids={missedIds} …/>` at app level. Pass `onRepeatOnSchedule` to `TabStrip` and `ChatView`, `readonlyRun={!!readonlyRuns[sid]}` to `ChatView`, `schedules` to `Sidebar`.
  h. `ChatView.tsx`: at `:949` render `readonlyRun ? (<span className="… bg-sky-soft text-sky …" title="Read-only run — started by a schedule. It can read and report; changes are blocked.">🕰 Read-only run</span>) : planEnabled && (…existing…)`; the composer's plan toggle button (`:1637`) is hidden when `readonlyRun`. ＋ menu: after "Attach document", `<button … onClick={() => { setAttachMenuOpen(false); onRepeatOnSchedule?.(); }}>Repeat this on a schedule…</button>` (disabled with reason when the session has no user message yet).
  i. `TabStrip.tsx`: in the context menu, after Rename…, for chat tabs only: `onMouseDown` + `preventDefault` (the file's own rule) → `onRepeatOnSchedule(sessionOf(menu.tab))`.
  j. `preload/index.ts` + `hv.d.ts`: the twelve entries listed in Interfaces, mirroring the `memoryList`/`onMemoryChanged` lines.

- [ ] **Step 4: Run** `npx vitest run tests/schedules-renderer.test.ts tests/sidebar-groups.test.ts tests/empty-state.test.ts tests/go-to.test.ts tests/modal-layer.test.ts` + `npm run typecheck` → green. (`modal-layer` scans for anything climbing to z-100 — the drawer must not.)

- [ ] **Step 5: Commit** `feat(schedules): the page, the drawer, the sidebar row, the missed-runs dialog and the Read-only pill`.

---
### Task 9: Audit rows and analytics for `schedule.*` events

**Files:**
- Modify: `src/main/analytics.ts:170-180` (no-op cases), `src/renderer/src/components/AuditView.tsx:130-140` (row mapping + labels), `src/renderer/src/analytics-format.ts` if it enumerates types
- Test: extend `tests/schedules-source.test.ts`; run `tests/analytics*.test.ts` and `tests/audit*.test.ts` (existing)

**Interfaces:** event types `schedule.create | schedule.update | schedule.delete | schedule.fire | schedule.skip | schedule.done | schedule.missed`, data always carries `{ scheduleId, title }` plus the per-type fields Task 6/7 wrote (`mode`, `sessionId`, `reason`, `outcome`, `durationMs`, `source`). Audit label per type (exported as `SCHEDULE_EVENT_LABELS` from AuditView.tsx, data for the test): create → "created schedule", update → "changed schedule", delete → "deleted schedule", fire → "schedule fired", skip → "schedule skipped", done → "schedule run ended", missed → "schedule missed its time". `source:"readonly"` audit rows (Task 3) map to the label "read-only run" beside `plan`'s.

- [ ] **Step 1: Failing test** (append to `tests/schedules-source.test.ts`):
```ts
import { SCHEDULE_EVENT_LABELS } from "../src/renderer/src/components/AuditView";
it("every schedule event type main emits has an audit label, and analytics ignores them rather than throwing", () => {
  const ipc = R("src/main/ipc.ts") + R("src/main/scheduler.ts");
  const emitted = new Set([...ipc.matchAll(/"(schedule\.[a-z]+)"/g)].map((m) => m[1]));
  expect(emitted.size).toBeGreaterThanOrEqual(7);
  for (const t of emitted) expect(Object.keys(SCHEDULE_EVENT_LABELS), t).toContain(t);
  expect(R("src/main/analytics.ts")).toMatch(/case "schedule\./);
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3:** add the seven `case` lines to `analytics.ts`'s switch (no-op, beside `feedback.sent`); in `AuditView.tsx` export `SCHEDULE_EVENT_LABELS` and map `e.type.startsWith("schedule.")` to `{ row: "schedule", label, title: data.title, …base }` with a row renderer showing label · title · reason/outcome. **Step 4:** run the file + `npm test` → green. **Step 5:** commit `feat(audit): schedule events read as sentences`.

---

### Task 10: Live tests (Pi + real model)

**Files:**
- Create: `tests/readonly-bridge.test.ts`, `tests/schedules-bridge.test.ts`

Both: `test.skipIf(!KEY)`, import `{ KEY, MODEL, PROVIDER_ENV }` from `./liveModel`, `PI_CLI_RELPATH` from `../src/main/pi/spawn`, `askUntil` from `./reask`; spawn exactly as `tests/plan-bridge.test.ts:17-27` does (`--mode rpc --no-session -e …/happyvibe-bridge.ts`), auto-answer every blocking `input`/`select` (a permission → `{ value: "deny" }`-shaped answer the way `rules-bridge.test.ts` does; read it first), collect notifies.

- [ ] **Step 1: `tests/readonly-bridge.test.ts`**
```ts
test.skipIf(!KEY)("HV_READONLY=1: a write is blocked with the run's reason and nothing lands on disk; without the env the same ask writes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ro-"));
  const run = async (env: Record<string, string>) => {
    client = new PiClient({ execPath: process.execPath, args: [...], env: { ...process.env, ...PROVIDER_ENV, ...env }, cwd: tmp });
    const notifies: Record<string, unknown>[] = []; const blocked: string[] = [];
    client.on("ui-request", (m) => { /* notifies.push(JSON.parse(message)); permission select → respondUi(id, {value:"allow"}) so the UNCLAMPED arm can actually write */ });
    await askUntil(client, "Create a file named hello.txt containing the word hi, using the write tool.", () => notifies.some((n) => n.kind === "hv.plan.blocked") || fs.existsSync(path.join(tmp, "hello.txt")));
    return { notifies, wrote: fs.existsSync(path.join(tmp, "hello.txt")) };
  };
  const ro = await run({ HV_READONLY: "1" });
  expect(ro.wrote).toBe(false);
  const b = ro.notifies.find((n) => n.kind === "hv.plan.blocked") as { reason: string } | undefined;
  expect(b?.reason).toMatch(/read-only run/i);
  expect(ro.notifies.some((n) => n.kind === "hv.readonly")).toBe(true);  // the pill's notify fired at session_start
  client.stop();
  const rw = await run({});
  expect(rw.wrote).toBe(true);
}, 180_000);
```
  Also assert the `hv.audit` notify for the blocked call has `source: "readonly"` and `decision: "deny"`.

- [ ] **Step 2: `tests/schedules-bridge.test.ts`** — spawn with `HV_BUILTINS` default (schedules on). Test A: ask *"List my schedules using the schedule_list tool."* → an `input` envelope with `kind: "hv.schedule-list"` arrives (answer `"No schedules in this workspace."`) and the turn ends with that text in the model's reply; no `hv.permission` prompt was raised (safe default). Test B: ask *"Propose a schedule that runs 'review recent commits' every weekday at 9:00, read-only, titled Daily review, using schedule_create."* → an `input` envelope `kind: "hv.schedule-create"` whose `draft` has `title`, `prompt`, `repeat.kind === "weekdays"`, `at === "09:00"`, `mode === "readonly"` and **no `workspaceId`**; the `tool_execution_start` args carry a non-empty `intent`; answer `"declined"` and assert the model's final text acknowledges a decline (use `askUntil`; never assert on the first turn). Test C: with `HV_BUILTINS='{"schedules":false}'`, `/hv-tools` inventory (the `hv.tools` notify) lists none of the four names.

- [ ] **Step 3: Run** `npx vitest run tests/readonly-bridge.test.ts tests/schedules-bridge.test.ts > /tmp/live.log 2>&1; echo EXIT=$?` → green. If a live assertion fails: `pgrep -fl "npm run dev"` first, then balance (`curl` per CLAUDE.md), then re-run in isolation.

- [ ] **Step 4: Commit** `test(live): read-only run clamp and the schedule tools against a real Pi`.

---

### Task 11: Docs, gate, live batch, GUI pass

- [ ] **Step 1: `docs/validation/d1.md`** — new section "§35 Schedules": the `hv.schedule-*` envelope shapes (list/create/update/delete, the answer strings), the `hv.readonly` notify, the `hv:schedule-drawer-request/answer` pair, the `hv:pending-ui-requests` replay shape, and one measured run of each live test (wall time, tool calls).
- [ ] **Step 2: `CLAUDE.md`** gotchas — two entries: (a) *Read-only runs are `HV_READONLY`, not plan mode* (why: `/hv-plan` is registered only under `builtins.plan`; `plan_complete` writes a file); (b) *`hv:ui-request` is retained for replay* (`PendingPrompts`) — a new blocking method must be in `BLOCKING_UI_METHODS` or it is neither counted nor replayed.
- [ ] **Step 3: Gate** — `npm run gate` (build → non-live). Then `npm run live:why` — it prints (bridge + spawn.ts) — so `npm run test:live` in the background (`run_in_background: true`), touching nothing under `src/` or `pi-runtime/` meanwhile. Read the wall time: ~6–8 min is real; seconds means `.env` is missing in this worktree (`ln -s ~/Documents/Github/HappyVibe/.env .env`).
- [ ] **Step 4: GUI pass** (`/uicheck`, `npm run dev`, dev server restarted for main changes). Observable assertions, each with the page it is observed on:

  **Sidebar (expanded and collapsed)**
  - The row "Schedules" with a clock sits directly under the wordmark/search header, ABOVE the first workspace, with NO subtitle when there are no schedules. Absence: "Schedules" does not appear inside the Settings group when it is expanded.
  - Collapsed rail: a clock button exists; clicking it opens the Schedules page and the Settings group stays shut.
  - A session started by a schedule shows 🕰 after its title; a session started by the user shows none.

  **Schedules page, empty**
  - The dashed `EmptyState` reads "No schedules yet"; four template chips are visible; the login-item toggle is ABSENT in dev (`app.isPackaged` false).
  - Clicking "Daily change review" opens the drawer with title, prompt, Weekdays, 09:00 and the **Read-only** card selected; workspace = the active one.

  **Drawer**
  - Exactly two mode cards; Full is selected on a blank `+` drawer; there is no bypass/dangerous control anywhere in the drawer (absence).
  - "If it misses its time" shows Ask me selected by default.
  - Create → the row appears under its workspace header with recurrence "Weekdays at 9:00", "— never ran", "in N h"; the sidebar subtitle reads "1 active · next 9:00".
  - Click the mode pill on the row → it flips to Full without a drawer opening.

  **A run (set a schedule 2 minutes ahead, Read-only, prompt "Say hello and stop")**
  - Within ~60 s of the slot a new session "T · Sep 12" appears under the workspace with 🕰; its ChatView shows the "🕰 Read-only run" pill and NO "🧭 Plan mode" pill and NO plan toggle button in the composer (absences).
  - After `agent_end`: an OS notification "T finished · …"; the row reads "✓ …"; clicking the notification focuses the window and opens that session's tab.
  - Set a second schedule 2 min ahead on the same workspace, Full, prompt "Create a file x.txt" → the permission modal appears in the pane; the dock badge shows 1; the row reads "⚠ needs you".
  - **Regression sequence for pending replay:** with that prompt still open, close every window (⌘W on each; app stays alive on macOS) → dock badge still 1 → click the dock icon → the new window shows the permission modal immediately, without any agent action. Deny it → badge 0.
  - **Regression for the busy gate:** start typing a long prompt in an unrelated session of the same workspace and let it run; set a schedule 1 min ahead → its row reads "in 1 min" past the slot, no session appears; once the other turn ends, the run starts within a tick.
  - **Reuse:** tick "Reuse the same session" on a schedule, fire twice (Run now ×2) → ONE session titled "T" (no date) with two user prompts; the row's history shows two runs.
  - **Auto-archive:** un-tick reuse; Run now twice → the sidebar shows only the latest "T · Sep 12" run; "Show archived (1)" reveals the previous one.
  - **Fail-pause:** set a session model override to a provider with no key on the schedule; Run now ×3 → the row shows "✕ failed: …" then "paused" and the PAUSED_COPY line; the enabled toggle is off.
  - **Missed dialog:** set a schedule 1 min ahead, quit the app before it fires, relaunch after the slot → one dialog lists it with "was due …", Run now / Skip, Run all / Skip all; the sidebar subtitle reads "1 missed · decide"; Skip → dialog closes, row shows "– missed".
  - **Agent tools:** in a Full session type "List my schedules" → a tool card `schedule_list` with the list, no permission modal. Type "Set up a read-only weekday 9am review of recent commits" → the app navigates to Schedules and the drawer opens prefilled with "Proposed by the agent in this session"; Cancel → the model's reply says it was declined. Type "Delete the Daily review schedule" → a permission modal whose headline is the FACTUAL "Delete schedule “Daily review” (Weekdays at 9:00)"; Deny → the schedule remains.
  - **Built-in tools page:** a "Schedules" row exists under the Memory row; turning it off and starting a new session → "List my schedules" produces no tool call (the tool is absent from the Agent tools inventory page too), while the Schedules page still lists and fires schedules.
  - **Tab menu + ＋ menu:** right-click a chat tab → "Repeat this on a schedule…" beside Rename…; the composer ＋ menu has the same item; either opens the drawer with that session's first prompt and title.

- [ ] **Step 5: Memory note** — update `~/.claude/projects/-Users-guilhemduche-Documents-Github-HappyVibe/memory/schedules-proposal.md` to "IMPLEMENTED <date>, gate + live + GUI status", and MEMORY.md's pointer line.
- [ ] **Step 6:** stop for `/land`.

---

## Self-review notes (done at plan time)

- **Spec coverage:** §4.1 row/page/templates/from-a-session → T8; §4.2 drawer fields → T8e; §4.3 run/pill/finish/failure → T3, T6d-e, T8h; §4.4 archive + reuse → T6 host + Scheduler; §4.5 tools → T7 (+ T4 toggle, T3 writers blocked); §4.6 cost → T6f `hv:schedule-run-costs` + T8d; §5.1 → T3; §5.2 → T6 `fire`; §5.3 tick/resume/login/catch-up → T6c, T6f, Scheduler.catchUp; §5.4 → T6e; §6.1 → T1-2; §6.2 → T6; §6.3 → T8; §7 tests → T1-T10; decision 12 replay → T5.
- **Names used across tasks:** `Schedule`, `ScheduleStore`, `NewSchedule`, `nextFire`, `humanRecurrence`, `runTitle`, `catchUpDecision`, `applyOutcome`, `withNextRun`, `validateScheduleInput`, `renderScheduleList` (T1/T6/T7), `Scheduler`, `SchedulerHost` (T6), `PendingPrompts`, `PendingEnvelope` (T5), `gateReadonlyCall`, `READONLY_BLOCKED`, `readonlyFromEnv`, `buildReadonlyPrompt` (T3), `parseScheduleEnvelope`, `describeScheduleCall`, `ScheduleDraft` (T7), the `schedulesCopy.ts` exports (T8). `normPath` must be EXPORTED from `store.ts` (T6b) — today it is module-private.
- **Known judgment calls left to the implementer:** the exact `LedgerTotal` field for USD (read `calls.ts`), the bundled-agents directory path (T7 test), and the `RightRail` classes to copy for the drawer shell.
