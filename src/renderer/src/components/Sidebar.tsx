import { useState } from "react";
import type { SessionStatus } from "../App";

// W1.4: audit + dashboard moved inside Settings (PRD "Settings" — neither lives in the sidebar).
export type View = "chat" | "settings" | "agents";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function SessionRow({
  session,
  status,
  pending,
  selected,
  onSelect,
  onRename,
  onArchive,
  onClose,
}: {
  session: SessionMeta;
  status: SessionStatus | undefined;
  /** Unanswered permission prompts (B4) — attention badge. */
  pending: number;
  selected: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = (): void => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.title) onRename(draft.trim());
  };

  const dot =
    status === "running"
      ? "bg-leaf animate-pulse"
      : status === "crashed"
        ? "bg-berry"
        : "bg-line-strong";

  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold cursor-pointer ${
        selected ? "bg-honey-soft border border-honey/60" : "border border-transparent hover:bg-card/70"
      } ${session.archived ? "opacity-60" : ""}`}
      onClick={onSelect}
      title={session.title}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${dot}`} title={status ?? "idle"} />
      {pending > 0 && (
        <span
          className="min-w-4 h-4 px-1 rounded-full bg-honey text-ink border border-ink/60 text-[10px] font-black flex items-center justify-center shrink-0 animate-pulse"
          title={`${pending} permission prompt${pending === 1 ? "" : "s"} waiting`}
        >
          {pending}
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-card border border-line rounded px-1.5 py-0.5 text-sm focus:outline-none focus:border-tangerine"
        />
      ) : (
        <span
          className="flex-1 min-w-0 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(session.title);
            setEditing(true);
          }}
        >
          {session.title}
        </span>
      )}
      {!editing && (
        <span className="hidden group-hover:flex items-center gap-1 shrink-0">
          {status === "running" && (
            <button
              type="button"
              title="Stop session"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-ink-soft hover:text-berry cursor-pointer text-[11px] font-bold px-0.5"
            >
              ■
            </button>
          )}
          <button
            type="button"
            title={session.archived ? "Unarchive" : "Archive"}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="text-ink-soft hover:text-tangerine cursor-pointer text-[11px] font-bold px-0.5"
          >
            {session.archived ? "⇧" : "⇩"}
          </button>
        </span>
      )}
    </div>
  );
}

export function Sidebar({
  workspaces,
  sessions,
  statuses,
  pending,
  selectedId,
  view,
  onNavigate,
  onAddWorkspace,
  onRemoveWorkspace,
  onWorkspaceSettings,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onArchiveSession,
  onCloseSession,
  onOpenHelp,
}: {
  workspaces: string[];
  sessions: SessionMeta[];
  statuses: Record<string, SessionStatus>;
  /** Pending permission prompts per session (B4). */
  pending: Record<string, number>;
  selectedId: string | null;
  view: View;
  onNavigate: (v: View) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (ws: string) => void;
  /** W1.4: open the workspace-settings surface (model override, rules, prompt additions). */
  onWorkspaceSettings: (ws: string) => void;
  onNewSession: (ws: string) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onCloseSession: (id: string) => void;
  /** B7: re-open the onboarding wow-flow. */
  onOpenHelp: () => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = filter.trim().toLowerCase();
  const visible = (s: SessionMeta): boolean =>
    (showArchived || !s.archived) && (!q || s.title.toLowerCase().includes(q));

  const toggle = (ws: string): void =>
    setCollapsed((p) => {
      const next = new Set(p);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });

  const archivedCount = sessions.filter((s) => s.archived).length;

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

      {/* Session title filter */}
      <div className="px-4 pb-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions…"
          className="w-full rounded-lg bg-card border-2 border-line px-2.5 py-1.5 text-sm focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
        />
      </div>

      {/* Workspace tree */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
        <div className="flex items-center justify-between px-1.5 pt-2 pb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">workspaces</span>
          <button
            type="button"
            onClick={onAddWorkspace}
            title="Add workspace folder"
            className="text-xs font-bold text-tangerine hover:text-tangerine-deep cursor-pointer"
          >
            + add
          </button>
        </div>
        {workspaces.length === 0 && (
          <div className="text-xs text-ink-soft px-1.5 py-1">Add a project folder to start.</div>
        )}
        {workspaces.map((ws) => {
          const wsSessions = sessions
            .filter((s) => s.workspaceId === ws && visible(s))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const isCollapsed = collapsed.has(ws) && !q; // filtering expands everything
          return (
            <div key={ws} className="mb-1.5">
              <div className="group flex items-center gap-1.5 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => toggle(ws)}
                  className="text-ink-soft cursor-pointer text-[10px] w-3 shrink-0"
                  title={isCollapsed ? "Expand" : "Collapse"}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <span className="flex-1 min-w-0 truncate font-bold text-sm" title={ws}>
                  {basename(ws)}
                </span>
                <button
                  type="button"
                  title="New session"
                  onClick={() => onNewSession(ws)}
                  className="text-tangerine hover:text-tangerine-deep cursor-pointer font-black text-sm shrink-0"
                >
                  +
                </button>
                <button
                  type="button"
                  title="Workspace settings"
                  onClick={() => onWorkspaceSettings(ws)}
                  className="hidden group-hover:block text-ink-soft hover:text-tangerine cursor-pointer shrink-0"
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Forget workspace"
                  onClick={() => onRemoveWorkspace(ws)}
                  className="hidden group-hover:block text-ink-soft hover:text-berry cursor-pointer font-bold text-xs shrink-0"
                >
                  ×
                </button>
              </div>
              {!isCollapsed && (
                <div className="ml-3 flex flex-col gap-0.5">
                  {wsSessions.length === 0 && (
                    <div className="text-xs text-ink-soft/70 px-2 py-0.5">
                      {q ? "No matching sessions." : "No sessions yet."}
                    </div>
                  )}
                  {wsSessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      status={statuses[s.id]}
                      pending={pending[s.id] ?? 0}
                      selected={view === "chat" && s.id === selectedId}
                      onSelect={() => onSelectSession(s.id)}
                      onRename={(title) => onRenameSession(s.id, title)}
                      onArchive={() => onArchiveSession(s.id, !s.archived)}
                      onClose={() => onCloseSession(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer px-1.5 py-1.5"
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>

      {/* Agents + Settings (audit + dashboard live inside Settings, W1.4) */}
      <div className="p-4 border-t-2 border-line">
        <button
          type="button"
          onClick={() => onNavigate("agents")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "agents" ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
          Agents &amp; tools
        </button>
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
        <button
          type="button"
          onClick={onOpenHelp}
          title="Show the getting-started guide"
          className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3M12 17h.01" />
          </svg>
          Help
        </button>
      </div>
    </aside>
  );
}
