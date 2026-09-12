/**
 * §35 — every word and mapping the Schedules surfaces use, as DATA.
 *
 * The renderer suite has no DOM (vitest includes `tests/**\/*.test.ts` only), so
 * a visual contract is pinned in two halves: the mapping is exported from here
 * and asserted as data, and the ABSENCES are source scans. Copy with no call
 * site fails its test — §20 round 17's rule, because unreferenced copy is the
 * drift these records exist to end.
 */
import type { CatchUp, Repeat, RunOutcome, Schedule, ScheduleMode } from "../../main/schedules";
import { hasEnded, humanRecurrence, runsPerDay } from "../../main/schedules";

export const REPEAT_LABELS: Record<Repeat["kind"], string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Weekly",
  hours: "Every N hours",
  minutes: "Every N minutes",
  once: "Once",
};

/** Said BEFORE Create, not on the row afterwards — every run is a real session with a real bill. */
export function frequencyNote(repeat: Repeat): string | null {
  const n = runsPerDay(repeat);
  if (n === null || n < 12) return null;
  return `That is about ${n} runs a day, and each one costs like a session you ran yourself.`;
}

export const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/**
 * Exactly two, and a test says so. A third card is how "read-only" stops
 * meaning read-only — §5.1's whole claim is that a schedule never widens
 * permissions, so there is no per-schedule bypass to offer.
 */
export const MODE_CARDS: Record<ScheduleMode, { title: string; body: string; sub: string }> = {
  full: {
    title: "Full session",
    body: "Runs like a session you started. If it needs permission, it waits for you.",
    sub: "Uses this workspace's permission rules.",
  },
  readonly: {
    title: "Read-only",
    body: "Can read, search and report. Cannot change files or run commands.",
    sub: "Nothing in the run can switch this off.",
  },
};

/** Shown on the Full card when the workspace already bypasses permissions — don't hide it. */
export const BYPASS_WARNING = "This workspace bypasses permissions — runs will too.";

export const CATCH_UP_LABELS: Record<CatchUp, { title: string; body: string }> = {
  ask: { title: "Ask me", body: "When HappyVibe is back, ask whether to run it now." },
  always: { title: "Run it once", body: "Run once when HappyVibe is back, then return to the usual times." },
  never: { title: "Skip it", body: "Wait for the next scheduled time." },
};

export const OUTCOME_MARK: Record<RunOutcome | "never", string> = {
  ok: "✓",
  needs_you: "⚠",
  failed: "✕",
  skipped: "–",
  never: "—",
};

export const PAUSED_COPY = "Paused after 3 failed runs — check the model or the key.";
export const LOGIN_ITEM_COPY = "HappyVibe has to be open for schedules to run.";
export const UNTIL_LABELS = { none: "No end", date: "Ends at" } as const;
export const REUSE_SUB = "Context builds up across runs; HappyVibe compacts it when it gets long.";
export const PROMPT_HINT = "Slash prompts work here (/review), and so do @file mentions.";
export const NOTIFY_ALWAYS = "You are always notified when a run needs your permission.";
export const FOOTER_COPY = "Runs automatically until you pause it.";
export const AGENT_PROPOSED = "Proposed by the agent in this session.";

export interface ScheduleTemplate {
  title: string;
  prompt: string;
  repeat: Repeat;
  at: string;
  mode: ScheduleMode;
}

/**
 * The four starting points. All Read-only: they are reviews, and a template is
 * the one place a beginner meets this feature without having decided anything.
 */
export const TEMPLATES: readonly ScheduleTemplate[] = [
  {
    title: "Daily change review",
    prompt:
      "Review every change committed to this repository since yesterday. For each, say what it does and whether anything looks risky — security, data loss, or behaviour changing without a test. Finish with a short prioritised list of what deserves a second look.",
    repeat: { kind: "weekdays" },
    at: "09:00",
    mode: "readonly",
  },
  {
    title: "Weekly dependency check",
    prompt:
      "List this project's dependencies that have a newer version or a known advisory. Group them by risk, and name the ones worth updating this week and why. Say plainly if nothing needs doing.",
    repeat: { kind: "weekly", days: [1] },
    at: "09:00",
    mode: "readonly",
  },
  {
    title: "Release readiness",
    prompt:
      "Compare the current branch with the last release tag. List what shipped, what has no test, what the changelog is missing, and anything that should block a release.",
    repeat: { kind: "weekly", days: [4] },
    at: "16:00",
    mode: "readonly",
  },
  {
    title: "Weekly repo health",
    prompt:
      "Read this repository's structure, its TODO and FIXME comments, its failing or skipped tests and its stale branches. Report the five things most worth cleaning up, with the file paths.",
    repeat: { kind: "weekly", days: [5] },
    at: "15:00",
    mode: "readonly",
  },
];

const clockOf = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * The sidebar row's second line. `null` when there is nothing to say — an empty
 * subtitle is the difference between a row that reports and a row that nags.
 */
export function scheduleSubtitle(list: Schedule[], now: Date): string | null {
  const missed = list.filter((s) => s.missed).length;
  // A question waiting on the user outranks a count of what is healthy.
  if (missed) return `${missed} missed · decide`;
  const active = list.filter((s) => s.enabled && s.nextRunAt);
  if (!active.length) return null;
  const next = active.map((s) => s.nextRunAt!).sort()[0]!;
  const sameDay = new Date(next).toDateString() === now.toDateString();
  const when = sameDay ? clockOf(next) : `${new Date(next).toLocaleDateString(undefined, { weekday: "short" })} ${clockOf(next)}`;
  return `${active.length} active · next ${when}`;
}

/** The row's last-run cell. A cost it does not know is omitted, never shown as $0.00 (§19 ruling 3). */
export function lastRunLabel(s: Schedule): string {
  const r = s.runs.at(-1);
  if (!r) return `${OUTCOME_MARK.never} never ran`;
  if (r.outcome === "needs_you") return `${OUTCOME_MARK.needs_you} needs you`;
  if (r.outcome === "failed") return `${OUTCOME_MARK.failed} failed${r.reason ? `: ${r.reason}` : ""}`;
  if (r.outcome === "skipped") return `${OUTCOME_MARK.skipped} skipped${r.reason ? `: ${r.reason}` : ""}`;
  const mins = r.durationMs ? ` ${Math.max(1, Math.round(r.durationMs / 60000))} min` : "";
  const cost = r.costUsd !== undefined && r.costUsd > 0 ? ` · $${r.costUsd.toFixed(2)}` : "";
  return `${OUTCOME_MARK.ok}${mins}${cost}`;
}

/** The row's next-run cell. "paused" is a fail-pause; "off" is the user's own switch. */
export function nextRunLabel(s: Schedule, now: Date): string {
  // "ended" before "off": a schedule that reached its end date was not switched
  // off by anyone, and saying so is the difference between a finished job and
  // one the user has to wonder about.
  if (hasEnded(s, now)) return "ended";
  if (!s.enabled) return s.failStreak >= 3 ? "paused" : "off";
  if (!s.nextRunAt) return s.repeat.kind === "once" ? "once, done" : "no next run";
  const ms = new Date(s.nextRunAt).getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

/** "was due Thu 9:00" — the missed dialog's own line. */
export function missedLabel(slotAt: string): string {
  const d = new Date(slotAt);
  return `was due ${d.toLocaleDateString(undefined, { weekday: "short" })} ${clockOf(slotAt)}`;
}

export { hasEnded, humanRecurrence };
