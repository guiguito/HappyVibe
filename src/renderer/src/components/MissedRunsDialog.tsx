import React from "react";
import type { Schedule } from "../../../main/schedules";
import { humanRecurrence, lastRunLabel, missedLabel } from "../schedulesCopy";

/**
 * §5.3 — one dialog for every schedule that missed its time, not one per
 * schedule.
 *
 * Asking is the default because only the user knows which answer is right: a
 * missed 9:00 review at 10:30 is usually wanted, a missed Friday status post on
 * Monday morning is not. It is the permission-prompt pattern applied to a
 * missed run — never decide for them, never time out silently.
 *
 * "Run all" and "Skip all" call the same per-schedule handler in a loop, so main
 * keeps exactly one decision path.
 */
export function MissedRunsDialog({ missed, onClose }: { missed: Schedule[]; onClose: () => void }): React.JSX.Element | null {
  if (!missed.length) return null;

  const answer = (id: string, a: "run" | "skip"): void => {
    void window.hv.scheduleMissedAnswer(id, a).catch(() => {});
  };
  const all = (a: "run" | "skip"): void => {
    for (const s of missed) answer(s.id, a);
  };

  const btn = "px-2.5 py-1 rounded-lg border border-line font-bold text-xs cursor-pointer hover:bg-card";

  return (
    <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/40 px-6">
      <div className="hv-dialog-flow w-full max-w-lg rounded-2xl border-2 border-line-strong bg-paper shadow-sticker-lg p-5">
        <h2 className="font-black text-lg tracking-tight">
          {missed.length === 1 ? "A schedule missed its time" : `${missed.length} schedules missed their time`}
        </h2>
        <p className="text-sm text-ink-soft mt-1">
          HappyVibe wasn&apos;t running. Run them now, or wait for the next scheduled time.
        </p>

        <ul className="mt-4 space-y-2 max-h-72 overflow-y-auto">
          {missed.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <div className="flex-1 min-w-0">
                <span className="font-bold block truncate">{s.title}</span>
                <span className="text-xs text-ink-soft">
                  {s.missed ? missedLabel(s.missed.slotAt) : humanRecurrence(s.repeat, s.at)} · {lastRunLabel(s)}
                </span>
              </div>
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-card border border-line shrink-0">
                {s.mode === "readonly" ? "Read-only" : "Full"}
              </span>
              <button type="button" className={btn} onClick={() => answer(s.id, "run")}>Run now</button>
              <button type="button" className={btn} onClick={() => answer(s.id, "skip")}>Skip</button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2 justify-end mt-4">
          <button type="button" className={btn} onClick={onClose}>Decide later</button>
          <button type="button" className={btn} onClick={() => all("skip")}>Skip all</button>
          <button
            type="button"
            className="px-2.5 py-1 rounded-lg border-2 border-ink/60 bg-honey font-bold text-xs cursor-pointer"
            onClick={() => all("run")}
          >
            Run all
          </button>
        </div>
      </div>
    </div>
  );
}
