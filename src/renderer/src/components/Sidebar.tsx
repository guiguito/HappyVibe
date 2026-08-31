import { useEffect, useRef, useState } from "react";
import { timeago } from "../timeago";
import type { SessionStatus } from "../App";
import { workspaceEmoji } from "../workspaceEmoji";
import { AUTO, fractionFor, isSized, readSplit, writeSplit } from "../sidebarSplit";
import { BrandLogo } from "./BrandLogo";

// W1.4: audit + dashboard moved inside Settings (PRD "Settings" — neither lives in the sidebar).
// §13 round 6: the old combined "agents" page split into four peer destinations.
export type View =
  // §24: Commands sits beside Skills — same trust model, its own page.
  // §25: Plugins sits above them — it is where skills/prompts/servers come FROM.
  // §13 round 18: "tools" (the gated inventory) and "builtinTools" (the app's
  // own agent features) were one page that did two unrelated jobs.
  | "chat" | "plugins" | "skills" | "promptTemplates" | "mcp" | "agents" | "tools" | "builtinTools"
  // Round 8: the settings scroll exploded into pages, each its own destination.
  // §19 (2026-08-30): the model calls the app makes without a session.
  // §30: the changelog is product state, like stats and audit.
  | "models" | "permissions" | "sysprompt" | "onBehalf" | "stats" | "audit" | "changelog" | "shortcuts"
  | "terminal"
  // §27.
  | "voice"
  | "workspace";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
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
/** §19: a hand doing something for you — the calls you did not ask for. */
/** §19 round 18: a pencil with a spark — the page WRITES things for you. The
    old glyph was a hand, drawn when the row read "On your behalf"; under
    "AI autofill" a hand says nothing. */
function AutofillIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20.4l3.4-.8L18 9.1l-2.6-2.6L4.8 17z" />
      <path d="M14.2 7.7l2.6 2.6" />
      <path d="M18.6 2.8l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
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
/** §30: the Changelog page — a page with a turned corner, distinct from the
    audit log's clipboard beside it. */
function ChangelogIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

function TerminalIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-5-6-5" />
      <path d="M12 19h8" />
    </svg>
  );
}

function VoiceIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
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

/**
 * §16 round 18 — four groups, and the order still lives in ONE place.
 *
 * Round 12's "one flat group with no sub-headings" was right for fourteen
 * entries and wrong at sixteen: measured in the running app, 640px of content
 * in a 423px scroll region, with `MCP`, `All Tools` and `System prompt` as the
 * first three names a beginner reads in the primary navigation.
 *
 * §29's rule governs the copy: one panel, two altitudes, one vocabulary. Group
 * headers speak human, items keep their real names, and no third vocabulary is
 * invented — nothing is renamed, and a header is not a destination.
 *
 * `NAV` stays the single flat exported array and each entry gains a `group`,
 * because `GoTo.tsx` derives `GOTO_LABELS` from it and `tests/go-to.test.ts`
 * asserts against this file's SOURCE. A `GROUPS` array listing item names per
 * group would put the order in two places, which is exactly what §20 round
 * 17's Principle 11 forbids. So `GROUPS` is headers only, the sidebar renders
 * `NAV.filter(n => n.group === g.id)`, and a test pins group members as
 * contiguous so NAV alone decides the order.
 */
export type NavGroup = "abilities" | "rules" | "app" | "record";

/**
 * Headers are short NOUNS, in the same small-caps style as the `WORKSPACES`
 * label above them — that is the sidebar's existing section idiom, and the
 * first cut broke it with four different grammatical shapes ("Set up your
 * agent", "What it's allowed to do", "What it did", "This app": an imperative,
 * a relative clause, a clause, a demonstrative). A column of mismatched forms
 * reads as arbitrary however good each name is on its own.
 *
 * Order applies round 12's own rule one level up: "the three you consult
 * rather than change sit at the bottom" — THE RECORD *is* that block (§30
 * calls it "consulted, not changed"), so it goes last.
 */
export const GROUPS: Array<{ id: NavGroup; label: string }> = [
  { id: "abilities", label: "Abilities" },
  // The three pages that answer "am I still in charge": what it may do, which
  // tools it has and whether they are allowed, and what it is told before every
  // turn. "Ground rules" was tried and read as jargon; "Control" is the word a
  // nervous beginner actually reaches for, and it covers the system prompt —
  // which is NOT a permission, so "What it's allowed to do" was filing it
  // wrongly.
  { id: "rules", label: "Control" },
  // What HappyVibe does, as distinct from what the agent does.
  { id: "app", label: "App features" },
  { id: "record", label: "The record" },
];

/**
 * §16 round 12 ordered this by how often it is REACHED, not by where it came
 * from. That rule is NOT superseded by the grouping — it now applies WITHIN
 * each group, with one deliberate exception noted at `permissions`.
 */
export const NAV: Array<{ view: View; label: string; Icon: () => React.JSX.Element; group: NavGroup }> = [
  // Everything you GIVE the agent. Models leads because a beginner can do
  // nothing before it and ⌘, already lands there; §25 leads the capability
  // pages, being the source the three below it get their contents from.
  { view: "models", label: "Models", Icon: ModelsIcon, group: "abilities" },
  { view: "plugins", label: "Plugins", Icon: PluginsIcon, group: "abilities" },
  { view: "skills", label: "Skills", Icon: SkillsIcon, group: "abilities" },
  { view: "promptTemplates", label: "Prompts", Icon: PromptTemplatesIcon, group: "abilities" },
  { view: "mcp", label: "MCP", Icon: McpIcon, group: "abilities" },
  { view: "agents", label: "Agents", Icon: AgentsIcon, group: "abilities" },

  // Permissions leads ahead of All Tools, inverting round 12's flat order: it
  // is the more often reached of the two, and it is the group's thesis rather
  // than an inventory. System prompt closes it — the standing instructions
  // that shape every session, beside the rules that bound them.
  { view: "permissions", label: "Permissions", Icon: PermissionsIcon, group: "rules" },
  // "All Tools" claimed to be the complete catalogue while the switches for
  // half of it lived on the same page; it is the gated INVENTORY, so it says so
  // and sits beside the rules that gate it.
  { view: "tools", label: "Agent tools", Icon: ToolsIcon, group: "rules" },
  // Every one of its switches is ON by default, so nobody opens this page to
  // ENABLE something — every visit is a restriction. That makes it a control
  // surface, not a capability one, and it puts the two tool pages adjacent,
  // which is where someone hunting for "tools" looks. Trails Agent tools by
  // round 12's frequency rule.
  { view: "builtinTools", label: "Built-in tools", Icon: BuiltinToolsIcon, group: "rules" },
  { view: "sysprompt", label: "System prompt", Icon: SysPromptIcon, group: "rules" },
  // Things the APP does for you. Terminal and Voice are surfaces you use
  // daily; the two configure-once pages trail. §19's page lives here rather
  // than with the records because it is not one: it carries a per-task
  // (model, append, on/off) record, so it CONFIGURES app behaviour.
  { view: "terminal", label: "Terminal", Icon: TerminalIcon, group: "app" },
  { view: "voice", label: "Voice", Icon: VoiceIcon, group: "app" },
  // "AI" is the app's ONLY use of the word, and it earns the exception: it is
  // an adjective separating GENERATED text from the browser-autofill sense of
  // remembered text, not a second name for "the agent" or "the model".
  { view: "onBehalf", label: "AI autofill", Icon: AutofillIcon, group: "app" },
  // Closes the group: of the four it is the one you set once and never reopen.
  { view: "shortcuts", label: "Keyboard shortcuts", Icon: KeyboardIcon, group: "app" },
  // Consulted, not changed (§30's own phrase) — the read-only surfaces.
  { view: "stats", label: "Stats", Icon: StatsIcon, group: "record" },
  { view: "audit", label: "Audit log", Icon: AuditIcon, group: "record" },
  { view: "changelog", label: "Changelog", Icon: ChangelogIcon, group: "record" },
];

/** The group a destination lives in — `null` for the views that are not in the
    nav at all (`chat`, `workspace`). `App.navigate` uses it so a cross-page
    pointer can never land on a page whose row is inside a shut group. */
export function groupFor(view: View): NavGroup | null {
  return NAV.find((n) => n.view === view)?.group ?? null;
}

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

/** §7 round 18: the search affordance. The INPUT hides at rest; this does not. */
function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** §13 round 18: sliders, because this page is switches — deliberately NOT the
    wrench `ToolsIcon` uses, so the two tool pages never read as the same row. */
function BuiltinToolsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
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
  open,
  onSelect,
  onRename,
  onDelete,
}: {
  session: SessionMeta;
  status: SessionStatus | undefined;
  /** Unanswered permission prompts (B4) — attention badge. */
  pending: number;
  /** §23: this session is in plan mode. */
  planning?: boolean;
  selected: boolean;
  /** Round 11: has an open chat tab, but is not the focused one. */
  open: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
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
        selected
          ? "bg-honey-soft border border-honey/60"
          : open
            // Open elsewhere in the layout: marked, but quieter than the focused row.
            ? "bg-card border border-line"
            : "border border-transparent hover:bg-card/70"
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
        /**
         * Round 15 — ONE trash icon on hover, the session's AGE at rest.
         *
         * Two icons meant two one-click destinations for one decision, and the
         * archive/delete pair is exactly the choice §5 already makes the user
         * make explicitly for a workspace. So the trash opens that same two-
         * outcome dialog and the archive shortcut goes; unarchiving stays under
         * "Show archived", where the archived sessions are.
         *
         * The slot is not empty the rest of the time: a resting sidebar of ten
         * identical rows tells you nothing about which you touched this
         * morning. A WORKING session shows nothing here — its dot is already
         * pulsing, and a second moving thing in one row is noise.
         */
        <span className="flex items-center shrink-0">
          {!status && (
            <span className="text-[10px] tabular-nums text-ink-soft/70 group-hover:hidden" title={new Date(session.updatedAt).toLocaleString()}>
              {timeago(Date.parse(session.updatedAt))}
            </span>
          )}
          <button
            type="button"
            title="Archive or delete this session"
            aria-label="Archive or delete this session"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="hidden group-hover:block text-ink-soft hover:text-berry cursor-pointer px-0.5"
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
  openSessionIds,
  view,
  onNavigate,
  onAddWorkspace,
  onWorkspaceSettings,
  gitInfo,
  onBranchMenu,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  settingsOpen,
  searchNonce,
  openGroups,
  onToggleGroup,
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
  /**
   * Round 11: every session with an open chat tab. `selectedId` is the FOCUSED
   * one — with tabs, "which sessions are on screen" and "which one am I in" are
   * two different facts, and the row has to show both.
   */
  openSessionIds: ReadonlySet<string>;
  view: View;
  onNavigate: (v: View) => void;
  /** Round 8: the Settings group's open/closed state (persisted in App). */
  settingsOpen: boolean;
  onToggleSettingsOpen: () => void;
  /** §7 round 18: bumped by ⌘K to open and focus the session filter. */
  searchNonce: number;
  /** §16 round 18: which settings groups are open. Owned by App for the same
      reason `settingsOpen` is — `navigate()` has to open the group holding its
      destination, and a second mechanism would be a second thing to sync. */
  openGroups: ReadonlySet<string>;
  onToggleGroup: (g: string) => void;
  /** F6: slim icon-rail mode + its toggle (⌘\); state persisted in App. */
  railCollapsed: boolean;
  onToggleCollapsed: () => void;
  onAddWorkspace: () => void;
  /** W1.4: open the workspace-settings surface (model override, rules, prompt additions). */
  onWorkspaceSettings: (ws: string) => void;
  /**
   * §29 1b: the branch under each workspace. A MISSING entry (or a null branch)
   * means "not a repo" and the line is ABSENT, never greyed — don't show what
   * cannot work. `changes` is null for every workspace but the active one: the
   * branch name is cheap (a .git watch), a count costs a `git status`, and
   * sweeping every repo at boot is a cost nobody asked for.
   */
  gitInfo?: Record<string, { branch: string | null; changes: number | null; tint: "green" | "amber" }>;
  onBranchMenu?: (ws: string) => void;
  onNewSession: (ws: string) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  /** V2.C2: permanent delete (confirmed in-sidebar before this fires). */
  onDeleteSession: (id: string) => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState("");
  // §7 round 18: the field was 44px of permanent chrome, empty at rest, with no
  // keyboard route at all. It renders only while `searching`.
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Focus is `autoFocus` on the input plus a direct `.focus()` here, and
   * deliberately NOT a `requestAnimationFrame` callback. Two reasons, one
   * measured. rAF is PAUSED while the window is occluded (the same trap §28's
   * coverage check already pays for), so a scheduled focus can simply never
   * run; and a single rAF can fire BEFORE React has committed the input, in
   * which case the ref is still null and the focus silently does nothing.
   * `autoFocus` covers the mount case with no clock at all, and the call below
   * covers the one case it cannot — ⌘K pressed while the field is already
   * open, where there is no mount and the ref is already populated.
   */
  const openSearch = (): void => {
    setSearching(true);
    searchRef.current?.focus();
  };
  // A COUNTER, not a boolean: ⌘K pressed twice must re-focus the field, and a
  // boolean already true fires no effect. App owns it because ⌘K must expand
  // the rail first, which is App's state.
  useEffect(() => {
    if (searchNonce === 0) return;
    openSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNonce]);
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
  // §7 round 12: stored as a FRACTION of the sidebar, not a pixel height — a px
  // value means something different at a different window size, so the split
  // the user chose was not the split they got back. `AUTO` (0) is the original
  // flex behaviour, which double-clicking the handle restores. Persisted like
  // the other sidebar state (no IPC — a renderer-local preference).
  const asideRef = useRef<HTMLElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [treeFrac, setTreeFrac] = useState(() => readSplit(localStorage.getItem("hv:sidebar-split")));
  useEffect(() => {
    localStorage.setItem("hv:sidebar-split", writeSplit(treeFrac));
  }, [treeFrac]);

  // The split only exists while the group is open: a dragged height with the
  // group collapsed is a division of nothing. §16 round 18 put four groups
  // inside that group, so `isSized` applies the same rule one level down.
  const sized = isSized(settingsOpen, treeFrac, openGroups.size);

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault(); // else the drag selects sidebar text
    const startY = e.clientY;
    const startH = treeRef.current?.getBoundingClientRect().height ?? 0;
    const sidebarPx = asideRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const onMove = (ev: MouseEvent): void => {
      setTreeFrac(fractionFor(startH + ev.clientY - startY, sidebarPx));
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
  // MCP/Settings/Help nav at the bottom. ⌘\ (App) and the chevron toggle it.
  // (§28 round 1 swapped the keys: ⌘B opens a BROWSER, the sidebar moved to ⌘\.)
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
          title="Expand sidebar (⌘\)"
          aria-label="Expand sidebar"
          className="cursor-pointer hover:brightness-105 transition-all"
        >
          <BrandLogo size="sm" className="hover:rotate-6 transition-transform" />
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
    <aside ref={asideRef} className="w-64 shrink-0 bg-paper-deep pegboard border-r-2 border-line flex flex-col">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onNavigate("chat")}
          className="flex items-center gap-2.5 cursor-pointer group min-w-0"
        >
          <BrandLogo size="sm" className="group-hover:rotate-6 transition-transform" />
          <div className="font-black text-lg tracking-tight leading-none truncate">
            Happy<span className="text-tangerine">Vibe</span>
          </div>
        </button>
        {/* §7 round 18: the affordance stays, the input does not. Same idiom
            as the collapse control beside it — icon button, shortcut in the
            tooltip. */}
        <button
          type="button"
          onClick={openSearch}
          title="Find a session (⌘K)"
          aria-label="Find a session"
          className="shrink-0 text-ink-soft hover:text-ink cursor-pointer px-1"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse sidebar (⌘\)"
          aria-label="Collapse sidebar"
          className="shrink-0 text-ink-soft hover:text-ink cursor-pointer text-lg leading-none px-1"
        >
          «
        </button>
      </div>

      {/* §7 round 18: hidden at rest, expanding IN PLACE — exactly where it
          used to live, so nothing moves but its existence. Blur while the
          filter is non-empty KEEPS it open (losing an active filter because
          you clicked a result would be hostile), while Esc collapses AND
          clears. That last clause is what removes a piece of state instead of
          adding one: the only route to "collapsed with a live filter" is Esc
          with text in the field, so clearing there makes "a collapsed search
          can never mean a filtered list" true by construction, where the
          alternative was a permanent filter-active dot on the icon. */}
      {searching && (
        <div className="px-4 pb-2">
          <input
            ref={searchRef}
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onBlur={() => { if (!filter) setSearching(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setFilter(""); setSearching(false); }
            }}
            placeholder="Filter sessions…"
            className="w-full rounded-lg bg-card border-2 border-line px-2.5 py-1.5 text-sm focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
          />
        </div>
      )}

      {/* Workspace tree. An explicit height ONLY while the Settings group is open
          and the user has dragged the handle. Collapsed, the split has nothing to
          divide — keeping the dragged height there left the session list clipped
          mid-row with dead pegboard beneath it, which is the whole reason to
          collapse the group in the first place. */}
      <div
        ref={treeRef}
        style={sized ? { flex: "0 0 auto", height: `${treeFrac * 100}%` } : undefined}
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
              <div className="group flex items-center gap-1.5 px-1.5 pt-1">
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
                {/* Round 11: the "×" is gone. An unconfirmed one-click remove sat
                    next to "New session"; removal now lives in a confirmed danger
                    zone at the bottom of the workspace settings page (the gear). */}
                <button
                  type="button"
                  title="New session"
                  onClick={() => onNewSession(ws)}
                  className="text-tangerine hover:text-tangerine-deep cursor-pointer font-black text-sm w-3 shrink-0"
                >
                  +
                </button>
              </div>
              {/* §29 1b: the branch, on its own line under the name. Absent —
                  not greyed — when this folder is not a repository. */}
              {gitInfo?.[ws]?.branch && (
                <button
                  type="button"
                  onClick={() => onBranchMenu?.(ws)}
                  className="ml-6 mb-0.5 flex items-center gap-1 text-[10px] text-ink-soft hover:text-ink cursor-pointer max-w-full"
                  title={`On branch ${gitInfo[ws].branch}${gitInfo[ws].changes !== null ? ` · ${gitInfo[ws].changes} changed` : ""}`}
                >
                  <span aria-hidden>⎇</span>
                  <span className="truncate font-mono">{gitInfo[ws].branch}</span>
                  {gitInfo[ws].changes !== null && gitInfo[ws].changes! > 0 && (
                    <span className={gitInfo[ws].tint === "amber" ? "text-honey font-bold" : "text-leaf font-bold"}>
                      · {gitInfo[ws].changes} {gitInfo[ws].changes === 1 ? "change" : "changes"}
                    </span>
                  )}
                </button>
              )}
              {!isCollapsed && (
                <div className="ml-3 flex flex-col gap-0.5">
                  {wsSessions.length === 0 && (
                    <div className="text-xs text-ink-soft/70 px-2 py-0.5">
                      {q ? "No matching sessions." : "No sessions yet — hit + next to a workspace."}
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
                      open={openSessionIds.has(s.id)}
                      onSelect={() => onSelectSession(s.id)}
                      onRename={(title) => onRenameSession(s.id, title)}
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
          it is the only resizer in the app — hence hand-rolled rather than a dep.
          §7 round 12: only while the group is OPEN. Collapsed, there is nothing
          to size — a resize cursor on the edge of a single row is a control that
          promises something it cannot do. */}
      {/* Round 15: the app's two draggable dividers are now ONE control by feel —
          a 10px hit strip you grab, with a 5px tint centred in it that you see.
          Two jobs, two widths (App.tsx PaneDividers carries the same pair). The
          old 6px bar painted its whole height, which read as a fat bar and was
          still fiddly to catch.

          `-mb-1.5` is what puts it ON the line rather than above it. The strip
          is the last child of the TREE, and the visible rule is the footer's
          own `border-t-2` — so at rest the band ended exactly where the border
          began, and the hover tint appeared a clear 6px high, pointing at
          nothing. The negative margin pulls the footer up by 6px so the strip's
          centre and the border's centre coincide; `relative z-10` keeps the
          footer, which comes later in the DOM, from painting over it. */}
      {settingsOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onMouseDown={startResize}
          onDoubleClick={() => setTreeFrac(AUTO)}
          className="group relative z-10 mt-auto -mb-1.5 h-2.5 shrink-0 cursor-row-resize flex items-center"
        >
          <div className="h-[5px] w-full bg-transparent group-hover:bg-tangerine/40 transition-colors" />
        </div>
      )}

      {/* Round 11 bounded this so ten nav rows could not squeeze the tree to its
          floor. §7 round 12: it now TAKES the leftover space (flex-1) instead of
          being content-sized. That is the reported "weird margin at the bottom":
          once the handle gave the tree an explicit height, nothing claimed the
          remainder, so the footer floated up and left dead space beneath it.
          The same rule is what pins the collapsed `Settings ›` row to the very
          bottom, with no extra case. */}
      <div
        className={`px-4 py-4 border-t-2 border-line min-h-0 flex flex-col ${
          sized ? "flex-1" : "max-h-[60%] mt-auto"
        }`}
      >
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
            {GROUPS.map((g) => {
              const open = openGroups.has(g.id);
              return (
                <div key={g.id}>
                  {/* A header TOGGLES. There is no page behind it — the human
                      altitude sits above the real names, never instead of
                      them, so a header is not a destination. */}
                  <button
                    type="button"
                    onClick={() => onToggleGroup(g.id)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2 rounded-xl pl-5 pr-3.5 py-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
                  >
                    <span className="flex-1 text-left">{g.label}</span>
                    <Chevron open={open} />
                  </button>
                  {open &&
                    NAV.filter((n) => n.group === g.id).map((n) => (
                      <button
                        key={n.view}
                        type="button"
                        onClick={() => onNavigate(n.view)}
                        className={`w-full flex items-center gap-2.5 rounded-xl pl-8 pr-3.5 py-2 text-sm font-bold border-2 cursor-pointer transition-colors ${
                          view === n.view ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
                        }`}
                      >
                        <n.Icon />
                        <span className="flex-1 text-left">{n.label}</span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/**
        * V2.C2: same warm dialog pattern as CompactDialog.
        *
        * Round 15: it asks the two-outcome question rather than only the
        * destructive one — the same shape §5 uses for removing a workspace,
        * because "get this out of my list" and "destroy this conversation" are
        * different wishes and the trash icon cannot tell which one you meant.
        * Archive leads: it is the reversible one.
        */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6" onMouseDown={() => setConfirmDelete(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="font-black text-xl">
              {confirmDelete.archived ? "Restore or delete?" : "Archive or delete?"}
            </h2>
            <p className="text-sm text-ink-soft mt-2">&ldquo;{confirmDelete.title}&rdquo;</p>
            <ul className="mt-3 text-sm text-ink-soft space-y-1.5">
              <li>
                <b className="text-ink">{confirmDelete.archived ? "Unarchive" : "Archive"}</b> —{" "}
                {confirmDelete.archived
                  ? "put it back in the list. Nothing is lost."
                  : "hide it from the list. You can bring it back from “Show archived”."}
              </li>
              <li>
                <b className="text-ink">Delete permanently</b> — the conversation, its session file and its sub-agent transcripts are gone for good.
              </li>
            </ul>
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
                  onArchiveSession(confirmDelete.id, !confirmDelete.archived);
                  setConfirmDelete(null);
                }}
                className="rounded-xl border-2 border-line-strong bg-card text-ink font-bold text-sm px-4 py-2 shadow-sticker hover:bg-paper-deep/40 cursor-pointer"
              >
                {confirmDelete.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSession(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-5 py-2 border-2 border-berry shadow-sticker hover:brightness-105 cursor-pointer"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
