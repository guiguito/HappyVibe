import { basename, type WorkspaceTabs } from "../tabs";

/**
 * W2.2 — center tab strip: the chat tab (session title, always first, never
 * closable) + one tab per open file (basename, dirty dot, close X, middle-
 * click close). The file-tree toggle lives at the right end of the strip.
 */
export function TabStrip({
  sessionTitle,
  tabs,
  dirty,
  treeOpen,
  onSelect,
  onClose,
  onToggleTree,
}: {
  sessionTitle: string;
  tabs: WorkspaceTabs;
  /** relPath → has unsaved edits. */
  dirty: Record<string, boolean>;
  treeOpen: boolean;
  onSelect: (target: string | null) => void;
  onClose: (relPath: string) => void;
  onToggleTree: () => void;
}): React.JSX.Element {
  const tab = (active: boolean): string =>
    `flex items-center gap-1.5 max-w-48 shrink-0 border-r-2 border-line px-3.5 py-2 text-[13px] cursor-pointer transition-colors ${
      active ? "bg-card font-bold border-b-2 border-b-card -mb-0.5" : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink"
    }`;

  return (
    <div className="flex items-stretch border-b-2 border-line bg-paper shrink-0" role="tablist">
      <div className="flex-1 min-w-0 flex items-stretch overflow-x-auto">
        <button
          type="button"
          role="tab"
          aria-selected={tabs.active === null}
          onClick={() => onSelect(null)}
          className={tab(tabs.active === null)}
          title={sessionTitle}
        >
          <ChatGlyph />
          <span className="truncate">{sessionTitle}</span>
        </button>
        {tabs.files.map((f) => {
          const active = tabs.active === f;
          return (
            <span
              key={f}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect(f)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(f)}
              onAuxClick={(e) => e.button === 1 && onClose(f)}
              className={tab(active)}
              title={f}
            >
              <span className="truncate">{basename(f)}</span>
              {dirty[f] && <span className="size-1.5 rounded-full bg-tangerine shrink-0" title="Unsaved changes" />}
              <button
                type="button"
                aria-label={`Close ${basename(f)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(f);
                }}
                className="shrink-0 -mr-1 rounded px-0.5 text-ink-soft hover:text-berry font-bold leading-none cursor-pointer"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleTree}
        aria-pressed={treeOpen}
        title={treeOpen ? "Hide the file tree" : "Browse workspace files"}
        className={`shrink-0 flex items-center gap-1.5 border-l-2 border-line px-3 text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
          treeOpen ? "text-tangerine-deep bg-paper-deep/50" : "text-ink-soft hover:text-ink hover:bg-paper-deep/40"
        }`}
      >
        <FolderGlyph />
        files
      </button>
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

function FolderGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
