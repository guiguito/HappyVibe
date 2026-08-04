import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../App";
import { workspaceEmoji } from "../workspaceEmoji";

// W1.4: audit + dashboard moved inside Settings (PRD "Settings" — neither lives in the sidebar).
// §13 round 6: the old combined "agents" page split into four peer destinations.
export type View =
  // §24: Commands sits beside Skills — same trust model, its own page.
  // §25: Plugins sits above them — it is where skills/prompts/servers come FROM.
  | "chat" | "plugins" | "skills" | "promptTemplates" | "mcp" | "agents" | "tools"
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
// §24: a terminal prompt — a command is something you type, not something the
// model discovers, and the glyph should say so at a glance.
/** §25: a jigsaw piece — the plugin glyph Claude Code and the docs both use. */
function PluginsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.5a1.5 1.5 0 0 1 3 0V5h2.5A1.5 1.5 0 0 1 17 6.5V9h1.5a1.5 1.5 0 0 1 0 3H17v2.5a1.5 1.5 0 0 1-1.5 1.5H13v1.5a1.5 1.5 0 0 1-3 0V16H6.5A1.5 1.5 0 0 1 5 14.5V12H3.5a1.5 1.5 0 0 1 0-3H5V6.5A1.5 1.5 0 0 1 6.5 5H10z" />
    </svg>
  );
}
function PromptTemplatesIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-5-6-5" />
      <path d="M12 19h8" />
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
/** Round 8: icons for the pages exploded out of the old Settings scroll.
    Same paths as the shared Section component's SECTION_ICONS. */
function ModelsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}
function PermissionsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </svg>
  );
}
function SysPromptIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  );
}
function StatsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function AuditIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12h6M9 16h6M9 8h2" />
      <path d="M5 4a1 1 0 0 1 1-1h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
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

/** Round 8: every configuration destination lives under ONE collapsible group —
    the flat footer had grown to seven entries. The four round-6 pages keep
    their order at the top; the exploded settings pages sit below a divider. */
const NAV: Array<{ view: View; label: string; Icon: () => React.JSX.Element }> = [
  // §25 first: it is the source the three below get their contents from.
  { view: "plugins", label: "Plugins", Icon: PluginsIcon },
  { view: "skills", label: "Skills", Icon: SkillsIcon },
  { view: "promptTemplates", label: "Prompts", Icon: PromptTemplatesIcon },
  { view: "mcp", label: "MCP", Icon: McpIcon },
  { view: "agents", label: "Agents", Icon: AgentsIcon },
  { view: "tools", label: "All Tools", Icon: ToolsIcon },
  { view: "models", label: "Models", Icon: ModelsIcon },
  { view: "permissions", label: "Permissions", Icon: PermissionsIcon },
  { view: "sysprompt", label: "System prompt", Icon: SysPromptIcon },
  { view: "stats", label: "Stats", Icon: StatsIcon },
  { view: "audit", label: "Audit log", Icon: AuditIcon },
  { view: "shortcuts", label: "Keyboard shortcuts", Icon: KeyboardIcon },
];

/** Round 8: the collapse affordance — an actual chevron rather than a 10px
    glyph, sitting immediately right of the name it collapses. */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
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
  settingsOpen,
  onToggleSettingsOpen,
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
  /** Round 8: the Settings group's open/closed state (persisted in App). */
  settingsOpen: boolean;
  onToggleSettingsOpen: () => void;
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
}): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<SessionMeta | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Round 8: which workspaces are collapsed, remembered across restarts —
  // several workspaces of many sessions each is exactly when it matters.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("hv:ws-collapsed") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem("hv:ws-collapsed", JSON.stringify([...collapsed]));
  }, [collapsed]);

  // Round 11: the workspace-tree / Settings split, dragged by the handle below.
  // 0 = "auto", i.e. the original flex-1 behaviour; double-clicking the handle
  // returns to it. Persisted like the other sidebar state (no IPC — this is a
  // renderer-local preference).
  const treeRef = useRef<HTMLDivElement>(null);
  const [treePx, setTreePx] = useState(() => {
    const v = Number(localStorage.getItem("hv:sidebar-split"));
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  useEffect(() => {
    localStorage.setItem("hv:sidebar-split", String(treePx));
  }, [treePx]);

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault(); // else the drag selects sidebar text
    const startY = e.clientY;
    const startH = treeRef.current?.getBoundingClientRect().height ?? 0;
    const onMove = (ev: MouseEvent): void => {
      // Floor keeps a usable tree; ceiling always leaves room for the Settings row.
      setTreePx(Math.max(96, Math.min(startH + ev.clientY - startY, window.innerHeight - 160)));
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

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
              className="size-8 shrink-0 flex items-center justify-center rounded-lg border-2 border-line bg-card text-base hover:border-honey cursor-pointer"
            >
              {/* Round 11: the emoji replaces two-letter initials — a column of
                  `HA`/`FL`/`DE` was unreadable at 48px. */}
              <span aria-hidden>{workspaceEmoji(ws)}</span>
            </button>
          ))}
        </div>
        {/* Round 8: ten destinations would be a wall in a 48px rail — one gear
            expands the sidebar, exactly as the workspace initials above do. */}
        <button type="button" onClick={onToggleCollapsed} title="Settings" aria-label="Settings" className={railBtn(false)}>
          <GearIcon />
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

      {/* Workspace tree. Round 11: an explicit height when the user has dragged
          the handle, otherwise `flex-1` as before. */}
      <div
        ref={treeRef}
        style={treePx ? { flex: "0 0 auto", height: treePx } : undefined}
        className="flex-1 min-h-32 overflow-y-auto px-4 pb-2"
      >
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
                {/* Round 8: the name itself toggles the session list, and the
                    arrow moved right with the other icons — but stays VISIBLE,
                    since it reports state rather than offering an action. */}
                <button
                  type="button"
                  onClick={() => toggle(ws)}
                  aria-expanded={!isCollapsed}
                  className="flex-1 min-w-0 flex items-center gap-1 font-bold text-sm text-left cursor-pointer"
                  title={ws}
                >
                  {/* Round 11: derived from the path — decoration, not data. */}
                  <span className="shrink-0" aria-hidden>{workspaceEmoji(ws)}</span>
                  <span className="truncate">{basename(ws)}</span>
                  <Chevron open={!isCollapsed} />
                </button>
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

      {/* Round 11: the drag handle. It sits ON the border the user pointed at, and
          it is the only resizer in the app — hence hand-rolled rather than a dep. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onMouseDown={startResize}
        onDoubleClick={() => setTreePx(0)}
        className="h-1.5 shrink-0 cursor-row-resize hover:bg-tangerine/40 transition-colors"
      />

      {/* Round 11: max-h is the actual defect fix — the footer was content-sized
          with no bound, so its own overflow never engaged and ten nav rows
          squeezed the tree to its 128px floor. */}
      <div className="px-4 pt-4 pb-1 border-t-2 border-line min-h-0 max-h-[60%] flex flex-col">
        <button
          type="button"
          onClick={onToggleSettingsOpen}
          aria-expanded={settingsOpen}
          className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
        >
          <GearIcon />
          <span className="text-left">Settings</span>
          <Chevron open={settingsOpen} />
          <span className="flex-1" />
        </button>
        {settingsOpen && (
          <div className="mt-1 flex flex-col min-h-0 overflow-y-auto">
            {NAV.map((n) => (
              <div key={n.view}>
                <button
                  type="button"
                  onClick={() => onNavigate(n.view)}
                  className={`w-full flex items-center gap-2.5 rounded-xl pl-6 pr-3.5 py-2 text-sm font-bold border-2 cursor-pointer transition-colors ${
                    view === n.view ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
                  }`}
                >
                  <n.Icon />
                  {n.label}
                </button>
              </div>
            ))}
          </div>
        )}
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
