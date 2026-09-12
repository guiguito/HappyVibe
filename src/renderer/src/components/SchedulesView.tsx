import React, { useEffect, useState } from "react";
import type { Schedule } from "../../../main/schedules";
import { EmptyState } from "./EmptyState";
import { ScheduleDrawer } from "./ScheduleDrawer";
import { Toggle } from "./Toggle";
import {
  humanRecurrence, lastRunLabel, LOGIN_ITEM_COPY, nextRunLabel, OUTCOME_MARK, PAUSED_COPY, TEMPLATES,
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
}): React.JSX.Element {
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, { perRun: Record<string, number | null>; last30: number | null }>>({});
  const [loginItem, setLoginItem] = useState<{ available: boolean; openAtLogin: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = new Date();

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
          {/* The settings pages' own add-affordance: outlined and quiet. The
              honey fill belongs to a dialog's primary action, where it is the
              one thing to press; on a page header it shouts over the title. */}
          <button
            type="button"
            onClick={() => setEditing({ workspaceId: workspaces[0] })}
            className="shrink-0 text-sm font-bold rounded-lg border-2 border-line px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer"
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
              {(ws.split("/").filter(Boolean).pop() ?? ws).toUpperCase()}
            </span>
            <ul className="mt-2 space-y-2">
              {list.map((s) => (
                <li key={s.id} className="rounded-xl border-2 border-line bg-card">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span aria-hidden className="text-sm">🕰</span>
                    <button type="button" onClick={() => setEditing(s)} className="flex-1 min-w-0 text-left cursor-pointer">
                      <span className="font-bold block truncate">{s.title}</span>
                      <span className="text-xs text-ink-soft">
                        {humanRecurrence(s.repeat, s.at)} · {lastRunLabel(s)} · {nextRunLabel(s, now)}
                      </span>
                    </button>
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
                    <p className="px-3 pb-2 text-xs font-semibold text-honey-deep">Missed its time — waiting for you to decide.</p>
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
                        onClick={() => void window.hv.scheduleDelete(s.id).catch(() => {})}
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

      {(editing || drawerRequest) && (
        <ScheduleDrawer
          key={drawerRequest?.requestId ?? editing?.id ?? "new"}
          initial={drawerRequest ? { ...drawerRequest.draft, id: drawerRequest.existingId, workspaceId: drawerRequest.workspaceId } : editing!}
          workspaces={workspaces}
          models={models}
          bypassHere={bypassHere}
          requestId={drawerRequest?.requestId}
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
