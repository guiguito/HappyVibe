import { useState } from "react";
import { basename, sessionOf, type Pane, type TabId } from "../tabs";

/**
 * WS6 — center tab strip for ONE pane: one tab per open chat (session title) and
 * one per open file (basename, dirty dot, close X, middle-click close). Tabs are
 * draggable between panes (HTML5 DnD carrying the TabId). v5.1: tabs-only —
 * split/unsplit + file-panel controls live in the App-level top-right toolbar.
 *
 * Round 11: a chat tab is per SESSION, so a strip can hold several, each with its
 * own title and its own working dot; and a trailing `+` fills the pane without
 * leaving it. Chat tabs ARE closable now (closing hides the session, it does not
 * end it), which is why the close button is no longer file-only.
 */
const DRAG_MIME = "application/x-hv-tabid";

export function TabStrip({
  pane,
  paneIndex,
  sessionTitleFor,
  dirty,
  busyFor,
  onSelect,
  onClose,
  onMoveTab,
  onNewSession,
  onOpenFilePanel,
}: {
  pane: Pane;
  /** Slot index in the 2×2 grid (0–3). */
  paneIndex: number;
  /** A chat tab's label — per tab now, since a strip can hold several sessions. */
  sessionTitleFor: (sessionId: string) => string;
  /** relPath → has unsaved edits. */
  dirty: Record<string, boolean>;
  /** WS7: pulse dot while that session's agent works. Per session (round 11). */
  busyFor: (sessionId: string) => boolean;
  onSelect: (tab: TabId) => void;
  onClose: (tab: TabId) => void;
  onMoveTab: (tab: TabId, toPane: number) => void;
  /** Round 11: the trailing `+` — fill this pane without leaving it. */
  onNewSession: () => void;
  onOpenFilePanel: () => void;
}): React.JSX.Element {
  const tab = (active: boolean): string =>
    `flex items-center gap-1.5 max-w-48 shrink-0 border-r-2 border-line px-3.5 py-2 text-[13px] cursor-pointer transition-colors ${
      active ? "bg-card font-bold border-b-2 border-b-card -mb-0.5" : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink"
    }`;

  const onDrop = (e: React.DragEvent): void => {
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (id) {
      e.preventDefault();
      onMoveTab(id, paneIndex);
    }
  };

  const [dropHover, setDropHover] = useState(false);
  return (
    <div
      className={`flex items-stretch border-b-2 border-line shrink-0 h-full ${dropHover ? "bg-honey-soft" : "bg-paper"}`}
      role="tablist"
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropHover(true); } }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => { setDropHover(false); onDrop(e); }}
    >
      {/* Sized to its tabs, NOT flex-1: the `+` belongs immediately after the last
          tab, and a growing strip would push it to the far edge. `min-w-0` still
          lets it shrink and scroll when the tabs outgrow the pane. */}
      <div className="min-w-0 flex items-stretch overflow-x-auto">
        {pane.tabs.length === 0 && (
          <span className="flex items-center px-3.5 text-[12px] italic text-ink-soft select-none">
            Drag a tab here
          </span>
        )}
        {pane.tabs.map((id) => {
          const active = pane.active === id;
          const sid = sessionOf(id);
          const isChat = sid !== null;
          const label = isChat ? sessionTitleFor(sid) : basename(id);
          return (
            <span
              key={id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, id)}
              onClick={() => onSelect(id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
              onAuxClick={(e) => e.button === 1 && onClose(id)}
              className={tab(active)}
              title={isChat ? label : id}
            >
              {isChat && <ChatGlyph />}
              <span className="truncate">{label}</span>
              {isChat && busyFor(sid) && <span className="size-1.5 rounded-full bg-tangerine animate-pulse shrink-0" title="Working…" />}
              {!isChat && dirty[id] && <span className="size-1.5 rounded-full bg-tangerine shrink-0" title="Unsaved changes" />}
              {(
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(id);
                  }}
                  className="shrink-0 -mr-1 rounded px-0.5 text-ink-soft hover:text-berry font-bold leading-none cursor-pointer"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/* Round 11: fill THIS pane — a new session, or the file panel to pick from. */}
      <NewTabButton onNewSession={onNewSession} onOpenFilePanel={onOpenFilePanel} />
      {/* Absorbs the leftover width so the strip remains a drop target end to end. */}
      <span className="flex-1 min-w-0" />
    </div>
  );
}

/** The trailing `+`: a two-item menu, closed on blur so there is no backdrop. */
function NewTabButton({
  onNewSession,
  onOpenFilePanel,
}: {
  onNewSession: () => void;
  onOpenFilePanel: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const item =
    "block w-full text-left px-3 py-2 text-[13px] hover:bg-paper-deep/60 cursor-pointer whitespace-nowrap";
  return (
    <div className="relative shrink-0 flex items-stretch" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        type="button"
        title="New tab in this pane"
        aria-label="New tab in this pane"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center px-2.5 text-ink-soft hover:text-ink hover:bg-paper-deep/40 cursor-pointer font-black shrink-0"
      >
        +
      </button>
      {/* Drops to the RIGHT (left-0): the `+` now sits just after the last tab, so
          a right-aligned menu would extend leftward off the pane. */}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-0.5 rounded-xl border-2 border-line-strong bg-paper shadow-pop overflow-hidden">
          <button type="button" className={item} onClick={() => { setOpen(false); onNewSession(); }}>
            New session
          </button>
          <button type="button" className={item} onClick={() => { setOpen(false); onOpenFilePanel(); }}>
            Open file…
          </button>
        </div>
      )}
    </div>
  );
}

function ChatGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
