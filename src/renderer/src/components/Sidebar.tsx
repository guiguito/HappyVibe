import { useState } from "react";
import type { SessionStatus } from "../App";

// W1.4: audit + dashboard moved inside Settings (PRD "Settings" — neither lives in the sidebar).
// §13 round 6: the old combined "agents" page split into four peer destinations.
export type View =
  | "chat" | "skills" | "mcp" | "agents" | "tools"
  // Round 8: the settings scroll exploded into pages, each its own destination.
  | "models" | "permissions" | "sysprompt" | "stats" | "audit" | "shortcuts"
  | "workspace";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** Archive box (lid + arrow into it); unarchive reverses the arrow. Stroke style matches the existing icon set. */
function ArchiveIcon({ out }: { out: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      {out ? <path d="M12 17v-5m-3 2 3-3 3 3" /> : <path d="M12 11v5m-3-2 3 3 3-3" />}
    </svg>
  );
}

/** F6: nav icons shared by the expanded footer and the collapsed rail. */
function AgentsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
/** §13 round 6: icons for the four split-out pages, matching Section.tsx's SECTION_ICONS. */
function SkillsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function McpIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l8-8 8 8-8 8z" />
      <path d="M8 12l4-4 4 4-4 4z" />
    </svg>
  );
}
function ToolsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.6-.6-2.5z" />
    </svg>
  );
}
function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  );
}
function HelpIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3M12 17h.01" />
    </svg>
  );
}
function KeyboardIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function SessionRow({
  session,
  status,
  pending,
  planning,
  selected,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  session: SessionMeta;
  status: SessionStatus | undefined;
  /** Unanswered permission prompts (B4) — attention badge. */
  pending: number;
  /** §23: this session is in plan mode. */
  planning?: boolean;
  selected: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
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
        : status === "waking"
          ? "bg-honey animate-pulse"
          : "bg-line-strong";

  // W1.3: hibernated = a subtle moon instead of a status dot; opening it just works.
  const asleep = !!session.hibernated && status === undefined;

  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold cursor-pointer ${
        selected ? "bg-honey-soft border border-honey/60" : "border border-transparent hover:bg-card/70"
      } ${session.archived ? "opacity-60" : ""}`}
      onClick={onSelect}
      title={session.title}
    >
      {asleep ? (
        <span className="text-[10px] leading-none shrink-0 text-ink-soft/80" title="Sleeping — opens right where you left off">
          ☾
        </span>
      ) : (
        <span className={`size-1.5 rounded-full shrink-0 ${dot}`} title={status === "waking" ? "waking up…" : status ?? "idle"} />
      )}
      {pending > 0 && (
        <span
          className="min-w-4 h-4 px-1 rounded-full bg-honey text-ink border border-ink/60 text-[10px] font-black flex items-center justify-center shrink-0 animate-pulse"
          title={`${pending} permission prompt${pending === 1 ? "" : "s"} waiting`}
        >
          {pending}
        </span>
      )}
      {planning && (
        <span className="text-[10px] leading-none shrink-0" title="Plan mode — read-only" aria-label="plan mode">
          🧭
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
        // V2.C2: reserved fixed-width slots — invisible until hover, so the
        // row never shifts. No stop affordance: lifecycle is automatic (W1.3).
        <span className="flex items-center gap-1 shrink-0 invisible group-hover:visible">
          <button
            type="button"
            title={session.archived ? "Unarchive" : "Archive"}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="text-ink-soft hover:text-tangerine cursor-pointer px-0.5"
          >
            <ArchiveIcon out={!!session.archived} />
          </button>
          <button
            type="button"
            title="Delete session"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-ink-soft hover:text-berry cursor-pointer px-0.5"
          >
            <TrashIcon />
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
  planning,
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
  onDeleteSession,
  onOpenHelp,
  onOpenShortcuts,
  railCollapsed,
  onToggleCollapsed,
}: {
  workspaces: string[];
  sessions: SessionMeta[];
  statuses: Record<string, SessionStatus>;
  /** Pending permission prompts per session (B4). */
  pending: Record<string, number>;
  /** §23: sessions currently in plan mode → a 🧭 badge. */
  planning?: Record<string, boolean>;
  selectedId: string | null;
  view: View;
  onNavigate: (v: View) => void;
  /** F6: open the keyboard-shortcuts cheat sheet (⌘/). */
  onOpenShortcuts: () => void;
  /** F6: slim icon-rail mode + its toggle (⌘B); state persisted in App. */
  railCollapsed: boolean;
  onToggleCollapsed: () => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (ws: string) => void;
  /** W1.4: open the workspace-settings surface (model override, rules, prompt additions). */
  onWorkspaceSettings: (ws: string) => void;
  onNewSession: (ws: string) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  /** V2.C2: permanent delete (confirmed in-sidebar before this fires). */
  onDeleteSession: (id: string) => void;
  /** B7: re-open the onboarding wow-flow. */
  onOpenHelp: () => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<SessionMeta | null>(null);
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

  // F6: collapsed icon rail — brand, workspace initials (click expands), and the
  // MCP/Settings/Help nav at the bottom. ⌘B (App) and the chevron toggle it.
  if (railCollapsed) {
    const railBtn = (active: boolean): string =>
      `size-9 flex items-center justify-center rounded-xl border-2 cursor-pointer transition-colors ${
        active ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70 text-ink-soft hover:text-ink"
      }`;
    return (
      <aside className="w-12 shrink-0 bg-paper-deep pegboard border-r-2 border-line flex flex-col items-center py-3 gap-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand sidebar (⌘B)"
          aria-label="Expand sidebar"
          className="size-9 rounded-xl bg-tangerine border-2 border-ink/80 shadow-sticker rotate-3 flex items-center justify-center hover:rotate-6 transition-transform cursor-pointer"
        >
          <span className="text-paper font-black text-sm -rotate-3">hv</span>
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-1.5 w-full pt-2">
          {workspaces.map((ws) => (
            <button
              key={ws}
              type="button"
              onClick={onToggleCollapsed}
              title={basename(ws)}
              className="size-8 shrink-0 flex items-center justify-center rounded-lg border-2 border-line bg-card text-[11px] font-black uppercase text-ink-soft hover:text-ink hover:border-honey cursor-pointer"
            >
              {basename(ws).replace(/[^a-z0-9]/gi, "").slice(0, 2) || "·"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onNavigate("skills")} title="Skills" aria-label="Skills" className={railBtn(view === "skills")}>
          <SkillsIcon />
        </button>
        <button type="button" onClick={() => onNavigate("mcp")} title="MCP" aria-label="MCP" className={railBtn(view === "mcp")}>
          <McpIcon />
        </button>
        <button type="button" onClick={() => onNavigate("agents")} title="Agents" aria-label="Agents" className={railBtn(view === "agents")}>
          <AgentsIcon />
        </button>
        <button type="button" onClick={() => onNavigate("tools")} title="All Tools" aria-label="All Tools" className={railBtn(view === "tools")}>
          <ToolsIcon />
        </button>
        <button type="button" onClick={() => onNavigate("models")} title="Settings" aria-label="Settings" className={railBtn(view === "models")}>
          <GearIcon />
        </button>
        <button type="button" onClick={onOpenHelp} title="Help" aria-label="Help" className={railBtn(false)}>
          <HelpIcon />
        </button>
        <button type="button" onClick={onOpenShortcuts} title="Keyboard shortcuts (⌘/)" aria-label="Keyboard shortcuts" className={railBtn(false)}>
          <KeyboardIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 bg-paper-deep pegboard border-r-2 border-line flex flex-col">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onNavigate("chat")}
          className="flex items-center gap-2.5 cursor-pointer group min-w-0"
        >
          <div className="size-9 rounded-xl bg-tangerine border-2 border-ink/80 shadow-sticker rotate-3 flex items-center justify-center group-hover:rotate-6 transition-transform shrink-0">
            <span className="text-paper font-black text-sm -rotate-3">hv</span>
          </div>
          <div className="font-black text-lg tracking-tight leading-none truncate">
            Happy<span className="text-tangerine">Vibe</span>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse sidebar (⌘B)"
          aria-label="Collapse sidebar"
          className="shrink-0 text-ink-soft hover:text-ink cursor-pointer text-lg leading-none px-1"
        >
          «
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
                {/* V2.C2: hover icons live in reserved slots (invisible, not
                    removed) LEFT of an always-visible, always-LAST "+" — zero
                    layout shift, "+" position stable. */}
                <button
                  type="button"
                  title="Workspace settings"
                  onClick={() => onWorkspaceSettings(ws)}
                  className="invisible group-hover:visible text-ink-soft hover:text-tangerine cursor-pointer shrink-0"
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
                  className="invisible group-hover:visible text-ink-soft hover:text-berry cursor-pointer font-bold text-xs w-3 shrink-0"
                >
                  ×
                </button>
                <button
                  type="button"
                  title="New session"
                  onClick={() => onNewSession(ws)}
                  className="text-tangerine hover:text-tangerine-deep cursor-pointer font-black text-sm w-3 shrink-0"
                >
                  +
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
                      planning={planning?.[s.id] ?? false}
                      selected={view === "chat" && s.id === selectedId}
                      onSelect={() => onSelectSession(s.id)}
                      onRename={(title) => onRenameSession(s.id, title)}
                      onArchive={() => onArchiveSession(s.id, !s.archived)}
                      onDelete={() => setConfirmDelete(s)}
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

      {/* Skills / MCP / Agents / All Tools + Settings (audit + dashboard live inside Settings, W1.4) */}
      <div className="p-4 border-t-2 border-line">
        <button
          type="button"
          onClick={() => onNavigate("skills")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "skills" ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
          }`}
        >
          <SkillsIcon />
          Skills
        </button>
        <button
          type="button"
          onClick={() => onNavigate("mcp")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "mcp" ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
          }`}
        >
          <McpIcon />
          MCP
        </button>
        <button
          type="button"
          onClick={() => onNavigate("agents")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "agents" ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
          }`}
        >
          <AgentsIcon />
          Agents
        </button>
        <button
          type="button"
          onClick={() => onNavigate("tools")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "tools" ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
          }`}
        >
          <ToolsIcon />
          All Tools
        </button>
        <button
          type="button"
          onClick={() => onNavigate("models")}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 cursor-pointer transition-colors ${
            view === "models"
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
          <HelpIcon />
          Help
        </button>
        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (⌘/)"
          className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
        >
          <KeyboardIcon />
          Keyboard shortcuts
        </button>
      </div>

      {/* V2.C2: delete confirm — same warm dialog pattern as CompactDialog. */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6" onMouseDown={() => setConfirmDelete(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="font-black text-xl">Delete this session?</h2>
            <p className="text-sm text-ink-soft mt-2">
              &ldquo;{confirmDelete.title}&rdquo; — the conversation is permanently removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border-2 border-line-strong text-ink-soft font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSession(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-5 py-2 border-2 border-berry shadow-sticker hover:brightness-105 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
