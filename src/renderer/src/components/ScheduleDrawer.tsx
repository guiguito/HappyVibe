import React, { useEffect, useState } from "react";
import { FAIL_PAUSE_AT, type CatchUp, type Repeat, type Schedule, type ScheduleMode } from "../../../main/schedules";
import {
  AGENT_PROPOSED, BYPASS_WARNING, CATCH_UP_LABELS, DAY_LABELS, FOOTER_COPY, frequencyNote, MODE_CARDS,
  NOTIFY_ALWAYS, PAUSED_IN_DRAWER, PROMPT_HINT, REPEAT_LABELS, REUSE_SUB, UNTIL_LABELS,
} from "../schedulesCopy";
import { ModelSelect } from "./ModelSelect";

/**
 * §35 — create and edit a schedule.
 *
 * Also the confirm step for the agent's `schedule_create` / `schedule_update`
 * (§4.5): opened by a tool, it carries a `requestId` and MUST answer it on both
 * Create and Cancel, or the bridge waits forever on a tool call that never
 * returns.
 *
 * Deliberately absent, and a test says so: cron text, a "runs on" host picker,
 * a per-schedule permission bypass, notification tiers, a max-runs counter and
 * a per-run timeout.
 */
export function ScheduleDrawer({
  initial,
  workspaces,
  models,
  bypassHere,
  requestId,
  leaving,
  onSaved,
  onClose,
}: {
  initial: Partial<Schedule>;
  workspaces: string[];
  models: Array<{ provider: string; id: string; name: string }>;
  /** Whether the chosen workspace already bypasses permissions — said out loud, never hidden. */
  bypassHere: (ws: string) => boolean;
  requestId?: string;
  /** Supplied by the page, which owns the conditional render and therefore owns the exit. */
  leaving?: boolean;
  onSaved: (s: Schedule) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(initial.title ?? "");
  const [prompt, setPrompt] = useState(initial.prompt ?? "");
  const [workspaceId, setWorkspaceId] = useState(initial.workspaceId ?? workspaces[0] ?? "");
  const [repeat, setRepeat] = useState<Repeat>(initial.repeat ?? { kind: "daily" });
  const [at, setAt] = useState(initial.at ?? "09:00");
  const [mode, setMode] = useState<ScheduleMode>(initial.mode ?? "full");
  const [reuseSession, setReuse] = useState(!!initial.reuseSession);
  const [model, setModel] = useState(initial.model);
  const [notifyOnDone, setNotify] = useState(initial.notifyOnDone ?? true);
  const [catchUp, setCatchUp] = useState<CatchUp>(initial.catchUp ?? "ask");
  // No end date is the default — a schedule runs until you pause it.
  const [until, setUntil] = useState<string | undefined>(initial.until);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = !!initial.id;

  // Esc cancels — and a tool-opened drawer must answer on that path too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cancel = (): void => {
    if (requestId) window.hv.scheduleDrawerAnswer(requestId, { cancelled: true });
    onClose();
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await window.hv.scheduleSave({
        ...(editing ? { id: initial.id } : {}),
        title: title.trim() || prompt.trim().split("\n")[0]?.slice(0, 60) || "",
        prompt,
        workspaceId,
        repeat,
        at,
        mode,
        reuseSession,
        model,
        notifyOnDone,
        catchUp,
        until: repeat.kind === "once" ? undefined : until,
        enabled: initial.enabled ?? true,
      });
      if (requestId) window.hv.scheduleDrawerAnswer(requestId, { saved });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this schedule.");
      setSaving(false);
    }
  };

  const setRepeatKind = (kind: Repeat["kind"]): void => {
    setRepeat(
      kind === "weekly" ? { kind, days: repeat.kind === "weekly" ? repeat.days : [1] }
      : kind === "hours" ? { kind, every: repeat.kind === "hours" ? repeat.every : 6 }
      : kind === "minutes" ? { kind, every: repeat.kind === "minutes" ? repeat.every : 15 }
      : kind === "once" ? { kind, date: repeat.kind === "once" ? repeat.date : new Date().toISOString().slice(0, 10) }
      : { kind: kind as "daily" | "weekdays" },
    );
  };

  /**
   * `datetime-local` speaks LOCAL wall clock with no zone, which is exactly what
   * we store — an ISO instant would drift by an hour across a DST change, the
   * same reason `at` is a wall-clock string.
   */
  const localNow = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const defaultUntil = (): string => {
    const d = new Date(Date.now() + 7 * 86400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const seg = (on: boolean): string =>
    `px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${on ? "bg-honey-soft border-honey text-ink" : "border-line text-ink-soft hover:bg-card"}`;

  return (
    <div
      // The app's side-panel motion, same as the context and cost panels: it
      // slides in from its OWN edge, 12px, never from off-screen. Exits need
      // `leaving` because React unmounts the element before CSS could play one.
      data-leaving={leaving || undefined}
      className="absolute inset-y-0 right-0 w-[420px] max-w-full border-l-2 border-line-strong bg-paper flex flex-col z-20 shadow-sticker-lg motion-safe:transition-[opacity,translate] motion-safe:duration-270 motion-safe:ease-hv-out motion-safe:starting:opacity-0 motion-safe:starting:translate-x-3 motion-safe:data-[leaving]:opacity-0 motion-safe:data-[leaving]:translate-x-3 motion-safe:data-[leaving]:duration-180 motion-safe:data-[leaving]:ease-hv-in"
    >
      <div className="px-5 py-4 border-b border-line">
        <h2 className="font-black text-lg tracking-tight">{editing ? "Edit schedule" : "New schedule"}</h2>
        {requestId && <p className="text-xs text-ink-soft mt-1">{AGENT_PROPOSED}</p>}
        {/* PAUSED_COPY sends the user HERE to fix the model, so this is where
            the repair has to be visible — the save re-enables it. */}
        {(initial.failStreak ?? 0) >= FAIL_PAUSE_AT && (
          <p className="text-xs text-ink-soft mt-1">{PAUSED_IN_DRAWER}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
        <label className="block">
          <span className="font-bold block mb-1">Title</span>
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Daily change review"
            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5"
          />
        </label>

        <label className="block">
          <span className="font-bold block mb-1">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Review yesterday's changes and tell me what's risky."
            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 font-normal"
          />
          <span className="text-xs text-ink-soft">{PROMPT_HINT}</span>
        </label>

        <label className="block">
          <span className="font-bold block mb-1">Workspace</span>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5"
          >
            {workspaces.map((w) => (
              <option key={w} value={w}>{w.split("/").filter(Boolean).pop() ?? w}</option>
            ))}
          </select>
        </label>

        <div>
          <span className="font-bold block mb-1">Repeat</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(REPEAT_LABELS) as Array<Repeat["kind"]>).map((k) => (
              <button key={k} type="button" onClick={() => setRepeatKind(k)} className={seg(repeat.kind === k)}>
                {REPEAT_LABELS[k]}
              </button>
            ))}
          </div>
          {repeat.kind === "weekly" && (
            <div className="flex gap-1.5 mt-2">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`day ${i}`}
                  aria-pressed={repeat.days.includes(i)}
                  onClick={() =>
                    setRepeat({ kind: "weekly", days: repeat.days.includes(i) ? repeat.days.filter((x) => x !== i) : [...repeat.days, i].sort() })
                  }
                  className={`size-7 rounded-full text-xs font-bold border cursor-pointer ${repeat.days.includes(i) ? "bg-honey-soft border-honey" : "border-line text-ink-soft"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {(repeat.kind === "hours" || repeat.kind === "minutes") && (
            <label className="flex items-center gap-2 mt-2 text-xs">
              Every
              <input
                type="number"
                min={1}
                max={repeat.kind === "hours" ? 23 : 59}
                value={repeat.every}
                onChange={(e) => {
                  const max = repeat.kind === "hours" ? 23 : 59;
                  setRepeat({ kind: repeat.kind, every: Math.min(max, Math.max(1, Number(e.target.value) || 1)) });
                }}
                className="w-16 rounded-lg border border-line bg-card px-2 py-1"
              />
              {repeat.kind === "hours" ? "hours, starting at" : "minutes, starting at"}
            </label>
          )}
          {repeat.kind === "once" && (
            <input
              type="date"
              value={repeat.date}
              onChange={(e) => setRepeat({ kind: "once", date: e.target.value })}
              className="mt-2 rounded-lg border border-line bg-card px-2 py-1"
            />
          )}
          {/* The cost is a fact about the choice just made, so it belongs beside
              the choice — not on the row after the schedule exists. */}
          {frequencyNote(repeat) && <p className="text-xs font-semibold text-berry mt-2">{frequencyNote(repeat)}</p>}
          <label className="flex items-center gap-2 mt-2">
            <span className="font-bold">At</span>
            {/* A native time input: the platform's own picker already knows the
                user's 12/24-hour preference, which a hand-rolled one would get
                wrong for half the world. */}
            <input type="time" value={at} onChange={(e) => setAt(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1" />
          </label>
        </div>

        {/* Its own section, like Repeat — it is a separate decision about the
            schedule's life, not a detail of how often it runs. A `once`
            schedule has none: it is already a single run. */}
        {repeat.kind !== "once" && (
          <div>
            <span className="font-bold block mb-1">Until</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setUntil(undefined)} className={seg(!until)}>
                {UNTIL_LABELS.none}
              </button>
              <button type="button" onClick={() => setUntil(until ?? defaultUntil())} className={seg(!!until)}>
                {UNTIL_LABELS.date}
              </button>
              {until && (
                <input
                  type="datetime-local"
                  value={until}
                  min={localNow()}
                  onChange={(e) => setUntil(e.target.value)}
                  className="rounded-lg border border-line bg-card px-2 py-1 text-xs"
                />
              )}
            </div>
            <p className="text-xs text-ink-soft mt-1">
              {until ? "It stops on its own then — no need to come back and pause it." : "It runs until you pause it."}
            </p>
          </div>
        )}

        <div>
          <span className="font-bold block mb-1">How careful</span>
          <div className="space-y-2">
            {(["full", "readonly"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`w-full text-left rounded-xl border-2 px-3 py-2 cursor-pointer ${mode === m ? "border-honey bg-honey-soft" : "border-line hover:bg-card"}`}
              >
                <span className="font-bold block">{MODE_CARDS[m].title}</span>
                <span className="text-xs text-ink-soft block">{MODE_CARDS[m].body}</span>
                <span className="text-xs text-ink-soft block">{MODE_CARDS[m].sub}</span>
                {m === "full" && bypassHere(workspaceId) && (
                  <span className="text-xs font-semibold text-berry block mt-1">{BYPASS_WARNING}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={reuseSession} onChange={(e) => setReuse(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-bold block">Reuse the same session for every run</span>
            {reuseSession && <span className="text-xs text-ink-soft block">{REUSE_SUB}</span>}
          </span>
        </label>

        <div>
          <span className="font-bold block mb-1">Model</span>
          <ModelSelect
            models={models}
            value={model ?? null}
            onPick={(m) => setModel({ provider: m.provider, modelId: m.id })}
            onClear={() => setModel(undefined)}
            // Accurate, not vague: leaving it empty stores no override, so the
            // spawn falls through resolveSpawnModel's own tiers — this project's
            // model, then the global default.
            clearLabel="Same as this project"
            placeholder="Same as this project"
            menuWidthClassName="w-full"
          />
        </div>

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={notifyOnDone} onChange={(e) => setNotify(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-bold block">Notify when a run finishes</span>
            <span className="text-xs text-ink-soft block">{NOTIFY_ALWAYS}</span>
          </span>
        </label>

        <div>
          <span className="font-bold block mb-1">If it misses its time</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATCH_UP_LABELS) as CatchUp[]).map((c) => (
              <button key={c} type="button" onClick={() => setCatchUp(c)} className={seg(catchUp === c)}>
                {CATCH_UP_LABELS[c].title}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-soft mt-1">{CATCH_UP_LABELS[catchUp].body}</p>
        </div>

        {error && <p className="text-sm font-semibold text-berry">{error}</p>}
      </div>

      <div className="px-5 py-4 border-t border-line">
        <p className="text-xs text-ink-soft mb-2">{FOOTER_COPY}</p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={cancel} className="px-3 py-1.5 rounded-lg border border-line font-bold text-sm cursor-pointer hover:bg-card">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 cursor-pointer disabled:opacity-50"
          >
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
