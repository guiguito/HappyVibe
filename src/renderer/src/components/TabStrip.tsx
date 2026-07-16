import { basename, CHAT_TAB, type Pane, type TabId } from "../tabs";

/**
 * WS6 — center tab strip for ONE pane. The chat tab (session title, never
 * closable) + one tab per open file (basename, dirty dot, close X, middle-click
 * close). Tabs are draggable between a split's two strips (HTML5 DnD carrying
 * the TabId). A `trailing` slot hosts the pane's right-end controls (files
 * toggle, and — WS7 — search + context bubble).
 */
const DRAG_MIME = "application/x-hv-tabid";

export function TabStrip({
  pane,
  paneIndex,
  sessionTitle,
  dirty,
  canSplit,
  split,
  chatBusy = false,
  onSelect,
  onClose,
  onMoveTab,
  onSplit,
  onUnsplit,
  trailing,
}: {
  pane: Pane;
  paneIndex: 0 | 1;
  sessionTitle: string;
  /** relPath → has unsaved edits. */
  dirty: Record<string, boolean>;
  /** WS7: pulse dot on the chat tab while the agent works (moved from the header). */
  chatBusy?: boolean;
  /** show the split button (only when not already split). */
  canSplit: boolean;
  split: "h" | "v" | null;
  onSelect: (tab: TabId) => void;
  onClose: (tab: TabId) => void;
  onMoveTab: (tab: TabId, toPane: 0 | 1) => void;
  onSplit: (dir: "h" | "v") => void;
  onUnsplit: () => void;
  trailing?: React.ReactNode;
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

  return (
    <div
      className="flex items-stretch border-b-2 border-line bg-paper shrink-0"
      role="tablist"
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex-1 min-w-0 flex items-stretch overflow-x-auto">
        {pane.tabs.map((id) => {
          const active = pane.active === id;
          const isChat = id === CHAT_TAB;
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
              onAuxClick={(e) => e.button === 1 && !isChat && onClose(id)}
              className={tab(active)}
              title={isChat ? sessionTitle : id}
            >
              {isChat && <ChatGlyph />}
              <span className="truncate">{isChat ? sessionTitle : basename(id)}</span>
              {isChat && chatBusy && <span className="size-1.5 rounded-full bg-tangerine animate-pulse shrink-0" title="Working…" />}
              {!isChat && dirty[id] && <span className="size-1.5 rounded-full bg-tangerine shrink-0" title="Unsaved changes" />}
              {!isChat && (
                <button
                  type="button"
                  aria-label={`Close ${basename(id)}`}
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
      {/* Split / unsplit controls */}
      {canSplit ? (
        <>
          <StripButton onClick={() => onSplit("v")} label="Split right" title="Split — side by side">
            <SplitVGlyph />
          </StripButton>
          <StripButton onClick={() => onSplit("h")} label="Split down" title="Split — stacked">
            <SplitHGlyph />
          </StripButton>
        </>
      ) : split ? (
        <StripButton onClick={onUnsplit} label="Close split" title="Close split">
          <span className="text-sm font-bold leading-none">⊟</span>
        </StripButton>
      ) : null}
      {trailing}
    </div>
  );
}

function StripButton({
  onClick,
  label,
  title,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className="shrink-0 flex items-center border-l-2 border-line px-2.5 text-ink-soft hover:text-ink hover:bg-paper-deep/40 cursor-pointer transition-colors"
    >
      {children}
    </button>
  );
}

function ChatGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SplitVGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

function SplitHGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18" />
    </svg>
  );
}
