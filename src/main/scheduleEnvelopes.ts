/**
 * §35 — the wire between the four `schedule_*` tools and main.
 *
 * Same shape as §33's memory envelopes: the bridge sends JSON over the blocking
 * `ctx.ui.input` channel and main answers with a string. This module is the
 * parser, and it is where the scoping invariant is enforced rather than in the
 * bridge — the bridge has no idea which workspace a session belongs to, and a
 * gate that lives in the untrusted-adjacent side is not a gate.
 *
 * The model cannot name a workspace at ALL: there is no such parameter, and a
 * payload carrying one is refused outright rather than ignored, because a
 * silently dropped field is how "it asked for another workspace and we said
 * nothing" becomes a report nobody can reproduce.
 */
import { humanRecurrence, nextFire, type CatchUp, type Repeat, type Schedule, type ScheduleMode } from "./schedules";

export interface ScheduleDraft {
  title: string;
  prompt: string;
  repeat: Repeat;
  at: string;
  mode?: ScheduleMode;
  catchUp?: CatchUp;
  reuseSession?: boolean;
  notifyOnDone?: boolean;
}

export type ScheduleEnvelope =
  | { kind: "hv.schedule-list" }
  | { kind: "hv.schedule-create"; draft: ScheduleDraft }
  | { kind: "hv.schedule-update"; id: string; patch: Partial<ScheduleDraft> }
  | { kind: "hv.schedule-delete"; id: string };

const MODES = new Set(["readonly", "full"]);
const CATCH_UPS = new Set(["ask", "always", "never"]);

/** A repeat we could not turn into a slot is one the tick would ignore forever. */
function parseRepeat(v: unknown, at: string): Repeat | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { kind?: unknown; days?: unknown; every?: unknown; date?: unknown };
  let out: Repeat;
  if (r.kind === "daily" || r.kind === "weekdays") out = { kind: r.kind };
  else if (r.kind === "weekly") {
    if (!Array.isArray(r.days)) return null;
    const days = r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!days.length) return null;
    out = { kind: "weekly", days };
  } else if (r.kind === "hours" || r.kind === "minutes") {
    const max = r.kind === "hours" ? 23 : 59;
    if (!Number.isInteger(r.every) || (r.every as number) < 1 || (r.every as number) > max) return null;
    out = { kind: r.kind, every: r.every as number };
  } else if (r.kind === "once") {
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
    out = { kind: "once", date: r.date };
  } else return null;
  if (out.kind !== "once" && nextFire(out, at, new Date()) === null) return null;
  return out;
}

/**
 * Rebuild the draft FIELD BY FIELD rather than spreading it.
 *
 * An allowlist is the point: a payload that carries `enabled`, a `workspaceId`
 * or anything else invented later reaches the store with none of it. A new
 * schedule is enabled by the user pressing Create in the drawer, never by a
 * field the model set.
 */
function parseDraft(v: unknown, partial: boolean): Partial<ScheduleDraft> | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if ("workspaceId" in d) return null;
  const out: Partial<ScheduleDraft> = {};
  if (typeof d.title === "string" && d.title.trim()) out.title = d.title.trim();
  if (typeof d.prompt === "string" && d.prompt.trim()) out.prompt = d.prompt.trim();
  if (typeof d.at === "string") {
    if (!/^\d{1,2}:\d{2}$/.test(d.at)) return null;
    const [h, m] = d.at.split(":").map(Number);
    if (h! > 23 || m! > 59) return null;
    out.at = d.at;
  }
  if (d.repeat !== undefined) {
    // `at` is needed to validate an `hours` repeat, and a patch may change only
    // one of the two — fall back to a legal time so the repeat is judged alone.
    const r = parseRepeat(d.repeat, out.at ?? "09:00");
    if (!r) return null;
    out.repeat = r;
  }
  if (d.mode !== undefined) {
    if (typeof d.mode !== "string" || !MODES.has(d.mode)) return null;
    out.mode = d.mode as ScheduleMode;
  }
  if (d.catchUp !== undefined) {
    if (typeof d.catchUp !== "string" || !CATCH_UPS.has(d.catchUp)) return null;
    out.catchUp = d.catchUp as CatchUp;
  }
  if (typeof d.reuseSession === "boolean") out.reuseSession = d.reuseSession;
  if (typeof d.notifyOnDone === "boolean") out.notifyOnDone = d.notifyOnDone;
  if (!partial && (!out.title || !out.prompt || !out.repeat || !out.at)) return null;
  return out;
}

export function parseScheduleEnvelope(r: { method?: string; title?: string }): ScheduleEnvelope | null {
  if (r.method !== "input") return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(r.title ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || "workspaceId" in p) return null;
  const id = typeof p.id === "string" && p.id ? p.id : null;
  switch (p.kind) {
    case "hv.schedule-list":
      return { kind: "hv.schedule-list" };
    case "hv.schedule-delete":
      return id ? { kind: "hv.schedule-delete", id } : null;
    case "hv.schedule-create": {
      const draft = parseDraft(p.draft, false);
      return draft ? { kind: "hv.schedule-create", draft: draft as ScheduleDraft } : null;
    }
    case "hv.schedule-update": {
      if (!id) return null;
      const patch = parseDraft(p.patch, true);
      return patch && Object.keys(patch).length ? { kind: "hv.schedule-update", id, patch } : null;
    }
    default:
      return null;
  }
}

/**
 * What the permission prompt shows for a `schedule_delete`.
 *
 * FACTUAL — the schedule's own title and recurrence, never the model's `intent`
 * (§7 round 1: the headline may be the model's words, the thing you are
 * approving may not).
 */
export function describeScheduleCall(env: ScheduleEnvelope, existing?: Pick<Schedule, "title" | "repeat" | "at">): string {
  const name = (s: Pick<Schedule, "title" | "repeat" | "at">): string => `“${s.title}” (${humanRecurrence(s.repeat, s.at)})`;
  switch (env.kind) {
    case "hv.schedule-list": return "List this workspace's schedules";
    case "hv.schedule-delete": return existing ? `Delete schedule ${name(existing)}` : "Delete a schedule";
    case "hv.schedule-create": return `Create schedule ${name({ title: env.draft.title, repeat: env.draft.repeat, at: env.draft.at })}`;
    case "hv.schedule-update": return existing ? `Change schedule ${name(existing)}` : "Change a schedule";
  }
}

/** The `schedule_list` result: one line per schedule, in the words the page uses. */
export function renderScheduleList(list: Schedule[], costOf: (s: Schedule) => number | undefined): string {
  if (!list.length) return "No schedules in this workspace.";
  return list
    .map((s) => {
      const last = s.runs.at(-1);
      const cost = costOf(s);
      const outcome = !last ? "never run"
        : last.outcome === "ok" ? `last run ok${cost !== undefined ? ` ($${cost.toFixed(2)})` : ""}`
        : last.outcome === "failed" ? `last run failed${last.reason ? `: ${last.reason}` : ""}`
        : last.outcome === "needs_you" ? "last run needs permission"
        : `last run skipped${last.reason ? ` (${last.reason})` : ""}`;
      const next = !s.enabled ? "paused" : s.nextRunAt ? `next ${s.nextRunAt}` : "no next run";
      return `• ${s.title} [${s.id}] — ${humanRecurrence(s.repeat, s.at)} — ${s.mode} — ${next} — ${outcome}`;
    })
    .join("\n");
}
