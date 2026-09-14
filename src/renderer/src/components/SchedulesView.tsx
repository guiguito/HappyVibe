import React, { useEffect, useRef, useState } from "react";
import { basename } from "../basename";
import type { Schedule } from "../../../main/schedules";
import { EmptyState } from "./EmptyState";
import { usePresence } from "../usePresence";
import { DUR } from "../motion";
import { ScheduleDrawer } from "./ScheduleDrawer";
import { Toggle } from "./Toggle";
import {
  ENDED_COPY, hasEnded, humanRecurrence, lastRunLabel, LOGIN_ITEM_COPY, MISSED_ROW, nextRunLabel, OUTCOME_MARK, PAUSED_COPY,
  TEMPLATES,
} from "../schedulesCopy";

/**
 * §35 — the Schedules page.
 *
 * One list grouped by workspace, and no separate "Runs" console: a schedule's
 * row EXPANDS to its own history, because the runs are ordinary sessions that
 * already have a home in the sidebar.
 */
export function SchedulesView({
  schedules,
  workspaces,
  models,
  bypassHere,
  prefill,
  drawerRequest,
  onPrefillUsed,
  onDrawerRequestUsed,
  onOpenSession,
  onDecideMissed,
}: {
  schedules: Schedule[];
  workspaces: string[];
  models: Array<{ provider: string; id: string; name: string }>;
  bypassHere: (ws: string) => boolean;
  /** From "Repeat this on a schedule…" — a session's own prompt and title. */
  prefill: Partial<Schedule> | null;
  /** From the agent's schedule_create / schedule_update: the drawer is the confirm step. */
  drawerRequest: { requestId: string; workspaceId: string; draft: Partial<Schedule>; existingId?: string } | null;
  onPrefillUsed: () => void;
  onDrawerRequestUsed: () => void;
  onOpenSession: (sessionId: string) => void;
  /** Re-opens the missed-runs dialog: "Decide later" must not be a dead end. */
  onDecideMissed: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, { perRun: Record<string, number | null>; last30: number | null }>>({});
  const [loginItem, setLoginItem] = useState<{ available: boolean; openAtLogin: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Deleting takes the run history with it, so it asks — ONE confirm for both
  // routes in (the ended row's button and the expanded panel's link), because
  // two paths to an irreversible thing is how one of them ends up without it.
  const [confirmDelete, setConfirmDelete] = useState<Schedule | null>(null);
  const now = new Date();
  // The drawer stays mounted through its exit so the slide-out can play —
  // React would otherwise remove it before any transition started.
  const open = editing || (drawerRequest ? { ...drawerRequest.draft, id: drawerRequest.existingId, workspaceId: drawerRequest.workspaceId } : null);
  const drawer = usePresence(!!open, DUR.panel);
  // …and it has to keep its CONTENT through that exit: rendering on `open`
  // alone unmounts the moment it closes, so nothing is left to animate.
  const shown = useRef<{ initial: Partial<Schedule>; requestId?: string } | null>(null);
  // The requestId belongs to the draft the drawer is SHOWING. Taking it from
  // `drawerRequest` regardless of which one won meant the user's own open
  // drawer carried the agent's request: pressing Save answered the agent's
  // schedule_create with a schedule it never proposed.
  if (open) shown.current = { initial: open, requestId: editing ? undefined : drawerRequest?.requestId };

  // A proposal that arrives while the user is mid-edit is DECLINED, not queued.
  // The bridge call has no timeout by design, and the alternative — holding it
  // until the drawer frees up — is a tool call blocked on a form the user does
  // not know is waiting. "declined" is true and the model can say so.
  useEffect(() => {
    if (drawerRequest && editing) {
      window.hv.scheduleDrawerAnswer(drawerRequest.requestId, { cancelled: true });
      onDrawerRequestUsed();
    }
  }, [drawerRequest, editing, onDrawerRequestUsed]);

  useEffect(() => {
    void window.hv.loginItemGet().then(setLoginItem).catch(() => {});
  }, []);

  // "Repeat this on a schedule…" opened us with a session's prompt in hand.
  useEffect(() => {
    if (prefill) {
      setEditing(prefill);
      onPrefillUsed();
    }
  }, [prefill, onPrefillUsed]);

  useEffect(() => {
    if (expanded) void window.hv.scheduleRunCosts(expanded).then((c) => setCosts((p) => ({ ...p, [expanded]: c }))).catch(() => {});
  }, [expanded, schedules]);

  const byWorkspace = new Map<string, Schedule[]>();
  for (const s of schedules) byWorkspace.set(s.workspaceId, [...(byWorkspace.get(s.workspaceId) ?? []), s]);

  const runNow = (id: string): void => {
    setNotice(null);
    void window.hv.scheduleRunNow(id).then((r) => {
      if (!r.ok) {
        setNotice(
          r.reason === "busy" ? "That project is busy right now — the run will wait for the session that's working."
          : r.reason === "disabled" ? "That schedule is paused. Switch it on first."
          : "That schedule is gone.",
        );
      }
    }).catch(() => {});
  };

  const flipMode = (s: Schedule): void => {
    void window.hv.scheduleSave({ ...s, mode: s.mode === "readonly" ? "full" : "readonly" }).catch(() => {});
  };

  return (
    <div className="flex-1 overflow-y-auto relative">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <div className="flex items-start gap-3 mb-2">
          <h1 className="font-black text-3xl tracking-tight flex-1">Schedules</h1>
          {/* Tangerine, the app's own accent, which is already what "add one"
              looks like here — the sidebar's `+ add` and every `+` on a
              workspace row. Honey was wrong for a different reason than being
              loud: it is a DIALOG's primary action, the one thing to press in a
              box with nothing else in it. The same filled shape as PromptRow's
              Save and the ask-user modal's confirm. */}
          <button
            type="button"
            onClick={() => setEditing({ workspaceId: workspaces[0] })}
            className="shrink-0 rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer"
          >
            New schedule
          </button>
        </div>
        <p className="text-sm text-ink-soft mb-6">
          A prompt, a project and a time. When it fires, HappyVibe opens a session and sends it — you watch it, approve
          it and pay for it exactly like one you started yourself.
        </p>

        <p className="text-sm text-ink-soft mb-6 flex items-center gap-2">
          <span>{LOGIN_ITEM_COPY}</span>
          {/* Hidden rather than disabled in development: there the setting would
              register the Electron binary itself, which is not the app anyone
              means to launch at login. */}
          {loginItem?.available && (
            <>
              <Toggle
                on={loginItem.openAtLogin}
                onChange={(v) => {
                  setLoginItem({ ...loginItem, openAtLogin: v });
                  void window.hv.loginItemSet(v).catch(() => setLoginItem({ ...loginItem, openAtLogin: !v }));
                }}
                label="Open HappyVibe at login"
              />
              <span className="font-semibold">Open at login</span>
            </>
          )}
        </p>

        {notice && <p className="text-sm font-semibold text-berry mb-4">{notice}</p>}

        {schedules.length === 0 && <EmptyState copy="schedules" />}

        {schedules.length === 0 && (
          <div className="mt-6">
            <span className="text-xs font-black tracking-wide text-ink-soft">START FROM A TEMPLATE</span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.title}
                  type="button"
                  onClick={() => setEditing({ ...t, workspaceId: workspaces[0] })}
                  className="text-left rounded-xl border-2 border-line px-3 py-2 hover:bg-card cursor-pointer"
                >
                  <span className="font-bold block">{t.title}</span>
                  <span className="text-xs text-ink-soft">{humanRecurrence(t.repeat, t.at)} · Read-only</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {[...byWorkspace.entries()].map(([ws, list]) => (
          <div key={ws} className="mb-8">
            <span className="text-xs font-black tracking-wide text-ink-soft">
              {basename(ws).toUpperCase()}
            </span>
            <ul className="mt-2 space-y-2">
              {list.map((s) => (
                <li key={s.id} className="rounded-xl border-2 border-line bg-card">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span aria-hidden className="text-sm">🕰</span>
                    <button type="button" onClick={() => setEditing(s)} className="flex-1 min-w-0 text-left cursor-pointer">
                      <span className="font-bold block truncate">{s.title}</span>
                      <span className="text-xs text-ink-soft">
                        {humanRecurrence(s.repeat, s.at, s.until)} · {lastRunLabel(s)} · {nextRunLabel(s, now)}
                      </span>
                    </button>
                    {/* An ENDED schedule gets the actions that mean something to
                        it, and none that do not. Its on/off toggle was the worst
                        kind of control: flipping it set `enabled` and left
                        `nextRunAt` null, so it looked live and did nothing. The
                        mode pill goes too — a detail of runs that are over.
                        "Run now" STAYS: it is an explicit ask, it works (§35),
                        and it does not restart the recurrence, because
                        withNextRun still returns null past the cutoff. */}
                    {hasEnded(s, now) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing({ ...s, until: undefined })}
                          title="Give it a new end, or no end at all"
                          className="text-xs font-bold px-2 py-1 rounded-lg border border-line cursor-pointer hover:bg-paper shrink-0"
                        >
                          Reschedule
                        </button>
                        <button type="button" onClick={() => runNow(s.id)} className="text-xs font-bold px-2 py-1 rounded-lg border border-line cursor-pointer hover:bg-paper shrink-0">
                          Run now
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(s)}
                          className="text-xs font-bold px-2 py-1 rounded-lg border border-line text-berry cursor-pointer hover:bg-paper shrink-0"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        {/* One click to change the mode, without opening the drawer. */}
                        <button
                          type="button"
                          onClick={() => flipMode(s)}
                          title="Click to switch between Read-only and Full"
                          className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-paper border border-line cursor-pointer hover:border-line-strong shrink-0"
                        >
                          {s.mode === "readonly" ? "Read-only" : "Full"}
                        </button>
                        <button type="button" onClick={() => runNow(s.id)} className="text-xs font-bold px-2 py-1 rounded-lg border border-line cursor-pointer hover:bg-paper shrink-0">
                          Run now
                        </button>
                        <Toggle
                          on={s.enabled}
                          onChange={(v) => void window.hv.scheduleSave({ ...s, enabled: v }).catch(() => {})}
                          label={`${s.title} on`}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                      aria-expanded={expanded === s.id}
                      aria-label="Show recent runs"
                      className="text-ink-soft cursor-pointer px-1 shrink-0"
                    >
                      {expanded === s.id ? "▾" : "▸"}
                    </button>
                  </div>

                  {!s.enabled && s.failStreak >= 3 && (
                    <p className="px-3 pb-2 text-xs font-semibold text-berry">{PAUSED_COPY}</p>
                  )}
                  {s.missed && (
                    <p className="px-3 pb-2 text-xs font-semibold text-honey-deep">
                      {MISSED_ROW}{" "}
                      {/* "Decide later" closed the one dialog and left the row
                          saying decide with nothing to decide with. */}
                      <button type="button" onClick={onDecideMissed} className="underline font-bold cursor-pointer">
                        Decide
                      </button>
                    </p>
                  )}
                  {hasEnded(s, now) && (
                    <p className="px-3 pb-2 text-xs text-ink-soft">{ENDED_COPY}</p>
                  )}

                  {expanded === s.id && (
                    <div className="border-t border-line px-3 py-2">
                      {s.runs.length === 0 ? (
                        <p className="text-xs text-ink-soft">No runs yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {[...s.runs].reverse().slice(0, 10).map((r, i) => {
                            const cost = r.sessionId ? costs[s.id]?.perRun[r.sessionId] : null;
                            return (
                              <li key={`${r.firedAt}-${i}`} className="text-xs flex items-center gap-2">
                                <span aria-hidden>{OUTCOME_MARK[r.outcome]}</span>
                                <span className="text-ink-soft">{new Date(r.firedAt).toLocaleString()}</span>
                                {r.reason && <span className="text-ink-soft">{r.reason}</span>}
                                {cost != null && <span className="text-ink-soft">${cost.toFixed(2)}</span>}
                                {r.sessionId && (
                                  <button type="button" onClick={() => onOpenSession(r.sessionId!)} className="font-bold cursor-pointer hover:underline">
                                    Open
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {costs[s.id]?.last30 != null && (
                        <p className="text-xs text-ink-soft mt-2">Last 30 days: ${costs[s.id]!.last30!.toFixed(2)}</p>
                      )}
                      {s.createdBy?.source === "agent" && <p className="text-xs text-ink-soft mt-2">Created by the agent.</p>}
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(s)}
                        className="text-xs font-bold text-berry cursor-pointer mt-2 hover:underline"
                      >
                        Delete this schedule
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/40 px-6" onMouseDown={() => setConfirmDelete(null)}>
          <div className="hv-dialog-flow w-full max-w-sm rounded-2xl border-2 border-line-strong bg-paper shadow-sticker-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="font-black text-lg tracking-tight">Delete this schedule?</h2>
            <p className="text-sm text-ink-soft mt-2">&ldquo;{confirmDelete.title}&rdquo;</p>
            <p className="text-sm text-ink-soft mt-2">
              Its record of past runs goes too. The sessions those runs produced stay where they are.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded-lg border border-line font-bold text-sm cursor-pointer hover:bg-card"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  void window.hv.scheduleDelete(confirmDelete.id).catch(() => {});
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 rounded-lg border-2 border-berry bg-berry text-paper font-bold text-sm cursor-pointer hover:brightness-105"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer.mounted && shown.current && (
        <ScheduleDrawer
          key={shown.current.requestId ?? shown.current.initial.id ?? "new"}
          initial={shown.current.initial}
          workspaces={workspaces}
          models={models}
          bypassHere={bypassHere}
          requestId={shown.current.requestId}
          leaving={drawer.leaving}
          onSaved={() => {}}
          onClose={() => {
            setEditing(null);
            if (drawerRequest) onDrawerRequestUsed();
          }}
        />
      )}
    </div>
  );
}
