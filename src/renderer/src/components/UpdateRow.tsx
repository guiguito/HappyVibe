import { useEffect, useState } from "react";
import type { UpdateState } from "../../../main/update/state";
import { UPDATE_COPY as C } from "./updateCopy";

/**
 * §38 — what the row says for a given state. Exported as data because the
 * renderer suite has no DOM (tests/update-row.test.ts). Null = no row: idle,
 * checking and every error stay off the chat — a background failure is an
 * audit row, a manual one shows on the Changelog page where it was asked.
 */
export function rowView(s: UpdateState): null | { text: string; action?: { label: string; kind: "install" | "download" }; note?: string } {
  if (s.mode === "disabled") return null;
  const p = s.phase;
  if (p.k === "downloading") return { text: C.downloading(p.version, p.percent) };
  if (p.k === "available") return { text: C.available(p.version), action: { label: C.download, kind: "download" } };
  if (p.k !== "ready") return null;
  const note = s.gate.terminalsOpen ? C.terminals : undefined;
  if (s.gate.armed && s.gate.blockedBy.length > 0) return { text: C.ready(p.version), note: C.armed };
  const label = s.gate.blockedBy.length > 0 ? C.waiting(s.gate.blockedBy.length) : C.restart;
  return { text: C.ready(p.version), action: { label, kind: "install" }, ...(note ? { note } : {}) };
}

/** "Last checked 12 min ago" — for the Changelog page. */
export function relativeChecked(at: number | null, now: number): string {
  if (at === null) return C.never;
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return C.justNow;
  if (min < 60) return C.minutesAgo(min);
  return C.hoursAgo(Math.floor(min / 60));
}

/** Main's state, live. Shared by the row and the Changelog page. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void window.hv.updateGet().then((s) => live && setState(s));
    const off = window.hv.onUpdateState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/**
 * The row. The pulse's line, not a banner: §20 keeps banners for things that
 * are wrong, and an update is good news. Main decides whether a restart is
 * safe — this only asks, and shows what main answered.
 */
export function UpdateRow(): React.JSX.Element | null {
  const state = useUpdateState();
  // ✕ hides for this run only. Never a "never": the next launch shows it again,
  // and install-on-quit happens regardless.
  const [hidden, setHidden] = useState(false);
  const view = state ? rowView(state) : null;
  if (!view || hidden) return null;
  const act = view.action;
  return (
    <div className="flex items-center justify-center gap-2 px-6 text-sm">
      <span className="font-bold">{view.text}</span>
      {act && (
        <>
          <span className="text-ink-soft">·</span>
          <button
            type="button"
            onClick={() => void (act.kind === "install" ? window.hv.updateInstall() : window.hv.updateDownload())}
            className="text-ink-soft underline cursor-pointer"
          >
            {act.label}
          </button>
        </>
      )}
      {view.note && <span className="text-ink-soft">— {view.note}</span>}
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label={C.hide}
        title={C.hide}
        className="text-ink-soft/60 hover:text-ink cursor-pointer text-[10px] leading-none p-1 -m-1"
      >
        ✕
      </button>
    </div>
  );
}
