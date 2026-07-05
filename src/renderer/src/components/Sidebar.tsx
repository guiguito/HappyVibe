export type View = "chat" | "settings";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function Sidebar({
  workspace,
  view,
  onNavigate,
  onSwitchFolder,
}: {
  workspace: string | null;
  view: View;
  onNavigate: (v: View) => void;
  onSwitchFolder: () => void;
}): React.JSX.Element {
  return (
    <aside className="w-64 shrink-0 bg-paper-deep pegboard border-r-2 border-line flex flex-col">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <button
          type="button"
          onClick={() => onNavigate("chat")}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="size-9 rounded-xl bg-tangerine border-2 border-ink/80 shadow-sticker rotate-3 flex items-center justify-center group-hover:rotate-6 transition-transform">
            <span className="text-paper font-black text-sm -rotate-3">hv</span>
          </div>
          <div className="font-black text-lg tracking-tight leading-none">
            Happy<span className="text-tangerine">Vibe</span>
          </div>
        </button>
      </div>

      {/* Workspace */}
      <div className="px-4 pb-3">
        <div className="rounded-xl bg-card border-2 border-line shadow-sticker px-3.5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-0.5">project</div>
          <div className="font-bold text-sm truncate" title={workspace ?? undefined}>
            {workspace ? basename(workspace) : "No project open"}
          </div>
          <button
            type="button"
            onClick={onSwitchFolder}
            className="mt-2 text-xs font-bold text-tangerine hover:text-tangerine-deep cursor-pointer"
          >
            {workspace ? "Switch folder…" : "Open a folder…"}
          </button>
        </div>
      </div>

      {/* Sessions (placeholder — real session manager lands in B1) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft px-1.5 pt-2 pb-1.5">
          sessions
        </div>
        {workspace ? (
          <button
            type="button"
            onClick={() => onNavigate("chat")}
            className={`w-full text-left rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-2 cursor-pointer ${
              view === "chat" ? "bg-honey-soft border border-honey/60" : "hover:bg-card/70"
            }`}
          >
            <span className="size-1.5 rounded-full bg-leaf shrink-0" />
            <span className="truncate">Current session</span>
          </button>
        ) : (
          <div className="text-xs text-ink-soft px-1.5 py-1">Open a project to start a session.</div>
        )}
        <div className="text-xs text-ink-soft/70 px-1.5 py-2">Past sessions will show up here.</div>
      </div>

      {/* Settings */}
      <div className="p-4 border-t-2 border-line">
        <button
          type="button"
          onClick={() => onNavigate("settings")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "settings"
              ? "bg-card border-line shadow-sticker"
              : "border-transparent hover:bg-card/70"
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  );
}
