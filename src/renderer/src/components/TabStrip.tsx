import { useState } from "react";
import { basename, browserOf, sessionOf, terminalOf, type Pane, type TabId } from "../tabs";

/**
 * WS6 — center tab strip for ONE pane: one tab per open chat (session title) and
 * one per open file (basename, dirty dot, close X, middle-click close). Tabs are
 * draggable between panes (HTML5 DnD carrying the TabId).
 *
 * Round 11: a chat tab is per SESSION, so a strip can hold several, each with its
 * own title and its own working dot; and a trailing `+` fills the pane without
 * leaving it. Chat tabs ARE closable now (closing hides the session, it does not
 * end it), which is why the close button is no longer file-only.
 *
 * §26: a TERMINAL is the third kind. Its label is the foreground command rather
 * than a static name, because terminals sitting at a prompt should not all read
 * the same — and unlike a chat, closing one KILLS its process, which is why its
 * × routes through the same confirm ⌘W uses.
 *
 * Every LAYOUT control lives here too — split, file drawer, close pane — because
 * the global toolbar they replaced sat in the top strip row and pushed that one
 * pane's controls 96px inward while every other pane's sat flush at its own edge.
 * Per pane, all four strips are identical and each button acts on its own pane.
 */
const DRAG_MIME = "application/x-hv-tabid";

/**
 * §7 round 23 — one row style for the tab menu.
 *
 * Reported as "too large and lacking icons": it was `text-sm` with `py-1.5` and
 * three bare strings, which at three items read as a dialog rather than a
 * context menu. Tighter type, tighter rows, and a glyph per row so the eye can
 * tell them apart without reading.
 */
const menuItem =
  "w-full flex items-center gap-2 text-left px-3 py-1 hover:bg-paper-deep/40 cursor-pointer " +
  "disabled:cursor-not-allowed disabled:text-ink-soft disabled:hover:bg-transparent";

/** The app's icon idiom: 24-box, stroked, sized by the caller's row. */
const glyph = "size-3.5 shrink-0 text-ink-soft";

function PencilGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z" />
    </svg>
  );
}

/** A window with a plus: the tab lands somewhere that does not exist yet. */
function NewWindowGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" />
      <path d="M17 3v6M14 6h6" />
    </svg>
  );
}

/** A window with an arrow going into it: an existing one. */
function WindowGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 9h16" />
      <path d="M9 15h6m0 0-2-2m2 2-2 2" />
    </svg>
  );
}

export function TabStrip({
  pane,
  paneIndex,
  sessionTitleFor,
  terminalTitleFor,
  browserTitleFor,
  terminalExited,
  dirty,
  busyFor,
  onSelect,
  onClose,
  onTabDrop,
  onNewSession,
  newSessionKey,
  onNewTerminal,
  onNewBrowser,
  newTerminalKey,
  newBrowserKey,
  onOpenFilePanel,
  splitOptions,
  onSplit,
  onClosePane,
  trailing,
  onRename,
  onMoveToWindow,
  canMoveToWindow,
  otherWindows,
  onDragBegin,
  onDragEnd,
}: {
  pane: Pane;
  /** Slot index in the 2×2 grid (0–3). */
  paneIndex: number;
  /** A chat tab's label — per tab now, since a strip can hold several sessions. */
  sessionTitleFor: (sessionId: string) => string;
  /** §26: a terminal tab's label — the foreground command, else the shell. */
  terminalTitleFor: (terminalId: string) => string;
  /** §28: a browser tab shows the page title, falling back to its host. */
  browserTitleFor: (browserId: string) => string;
  /** §26: a terminal whose process has exited renders muted, not gone. */
  terminalExited: (terminalId: string) => boolean;
  /** relPath → has unsaved edits. */
  dirty: Record<string, boolean>;
  /** WS7: pulse dot while that session's agent works. Per session (round 11). */
  busyFor: (sessionId: string) => boolean;
  onSelect: (tab: TabId) => void;
  onClose: (tab: TabId) => void;
  /**
   * §7 round 12: right-click → Rename. A chat tab renames the SESSION (the
   * sidebar row changes with it — it is the session's name, not a tab alias);
   * a terminal tab renames the terminal, which then stops following its
   * foreground process. A file tab is not renameable: its title is its
   * filename, and renaming the file is the tree's job.
   */
  onRename: (tab: TabId, title: string) => void;
  /** §7 round 23: hand this tab to a brand-new window, or to a named one. */
  onMoveToWindow: (tab: TabId, target: "new" | number) => void;
  /** The OTHER windows, so moving between two open ones needs no drag. */
  otherWindows: Array<{ id: number; label: string }>;
  /** False while a kind cannot live in a second window yet (browser, stage 3). */
  canMoveToWindow: (tab: TabId) => boolean;
  /** §7 round 23: a drag starts/ends — the payload is parked in main. */
  onDragBegin: (tab: TabId) => void;
  onDragEnd: (tab: TabId, at: { x: number; y: number }, dropped: boolean) => void;
  /** A drop whose payload came from ANOTHER window. */

  /**
   * §7 round 23: ONE handler for every tab drop, shared with the empty pane —
   * "is this my own drag or another window's" is a single decision and had
   * started being answered in two places.
   */
  onTabDrop: (e: React.DragEvent, toPane: number) => void;
  /** Round 11: the trailing `+` — fill this pane without leaving it. */
  onNewSession: () => void;
  /** Shown beside "New session" in the `+` menu, as ⌘T is beside New terminal. */
  newSessionKey: string;
  /** §26: opens a terminal in THIS pane. Same action ⌘T dispatches. */
  onNewTerminal: () => void;
  /** §28: ⌘B — a human opens a browser pane, like ⌘T opens a terminal. */
  onNewBrowser: () => void;
  /** Shown beside "New terminal" so the menu teaches the binding. */
  newTerminalKey: string;
  newBrowserKey: string;
  onOpenFilePanel: () => void;
  /**
   * Which split directions this pane can offer (tabs.ts splitOptions). Per pane
   * rather than one global toolbar: the old control acted on the FOCUSED half,
   * which the user cannot see, and rotated the layout when asked for a direction
   * the model could not divide on.
   */
  splitOptions: { v: boolean; h: boolean };
  onSplit: (dir: "h" | "v") => void;
  /** Absent on the last pane — there is nothing to close into. */
  onClosePane?: () => void;
  /** §7 round 13: the layout-wide Files/Changes cluster, rendered in the
   *  top-right strip only (App picks it with `topRightSlot`). */
  trailing?: React.ReactNode;
  /**
   * The file drawer, per pane. It used to be one button in a global toolbar, whose
   * presence in the top strip row is what forced THAT pane's controls 96px inward
   * while every other pane's sat flush. Per pane it also reads better: a file
   * picked from the drawer opens into the pane you asked from.
   */
}): React.JSX.Element {
  // B6 (Animations round, 2026-09-10): a new tab pops in; closing is instant.
  // The asymmetry is the rule — an exit that lingers is a tab you can still
  // click after deciding to close it.
  const tab = (active: boolean): string =>
    `flex items-center gap-1.5 max-w-48 shrink-0 border-r-2 border-line px-3.5 py-2 text-[13px] cursor-pointer transition-colors motion-safe:transition-[scale,opacity,color,background-color] motion-safe:duration-180 motion-safe:ease-hv-out motion-safe:starting:scale-90 motion-safe:starting:opacity-0 ${
      active ? "bg-card font-bold border-b-2 border-b-card -mb-0.5" : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink"
    }`;

  const [dropHover, setDropHover] = useState(false);
  // §7 round 12: right-click → Rename. Same shape as the file tree's menu (the
  // app's only other one): coords + a full-screen catcher that closes on click
  // AND on a second right-click, so the menu can never be orphaned.
  const [menu, setMenu] = useState<{ tab: TabId; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ tab: TabId; draft: string } | null>(null);

  const commitRename = (): void => {
    if (!editing) return;
    const t = editing.draft.trim();
    setEditing(null);
    if (t) onRename(editing.tab, t);
  };

  /**
   * §7 round 23 — only a chat or a terminal has a title of its OWN to change.
   * A file tab's title is its filename (renaming it is the tree's job) and a
   * browser tab's is the page's. Shared by the menu's Rename… and by the
   * double-click below, so "which tabs can be renamed" is answered once.
   */
  const renameable = (t: TabId): boolean => sessionOf(t) !== null || terminalOf(t) !== null;

  const startRename = (t: TabId): void => {
    // Already editing THIS tab: a double-click inside the input is a user
    // selecting a word, and re-seeding the draft would throw away what they
    // have typed.
    if (editing?.tab === t) return;
    const sid = sessionOf(t);
    const tid = terminalOf(t);
    if (sid === null && tid === null) return;
    setEditing({ tab: t, draft: sid ? sessionTitleFor(sid) : tid ? terminalTitleFor(tid) : "" });
  };

  return (
    <div
      className={`flex items-stretch border-b-2 border-line shrink-0 h-full ${dropHover ? "bg-honey-soft" : "bg-paper"}`}
      role="tablist"
      onDragOver={(e) => {
        // A drag from another window DOES reach here, MIME and all — Chromium
        // keeps it internal to the app — so this lights up for a foreign tab
        // too, which is what makes the strip look like a target. The drop
        // itself is then ignored for a tab this window does not own, and the
        // SOURCE window's release point performs the move (App.onTabDropped).
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => { setDropHover(false); onTabDrop(e, paneIndex); }}
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
          const tid = terminalOf(id);
          const bid = browserOf(id);
          const isChat = sid !== null;
          const isTerm = tid !== null;
          const isBrowser = bid !== null;
          const label = isChat
            ? sessionTitleFor(sid)
            : isTerm
              ? terminalTitleFor(tid)
              : isBrowser
                ? browserTitleFor(bid)
                : basename(id);
          const exited = isTerm && terminalExited(tid);
          return (
            <span
              key={id}
              role="tab"
              aria-selected={active}
              // B6: where the "Open as tab" flight lands.
              data-hv-tab={id}
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                // The MIME still carries the id for a SAME-window drop, which
                // is the common case and needs no round trip. Across windows
                // the OS drag drops custom types, so main holds the payload.
                e.dataTransfer.setData(DRAG_MIME, id);
                onDragBegin(id);
              }}
              onDragEnd={(e) => onDragEnd(id, { x: e.screenX, y: e.screenY }, e.dataTransfer.dropEffect !== "none")}
              onClick={() => onSelect(id)}
              // The other half of the same gesture the menu offers — the idiom
              // every tabbed app shares, and the one people reach for first.
              onDoubleClick={() => startRename(id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
              onAuxClick={(e) => e.button === 1 && onClose(id)}
              onContextMenu={(e) => {
                // §7 round 23: EVERY tab kind opens this menu. Round 12 gated
                // it on renameability (a file tab's title IS its filename), so
                // when "To new window" joined it, the menu was unreachable
                // for exactly the kind whose move matters most — a file with an
                // unsaved buffer. Renaming is now gated per ITEM instead.
                e.preventDefault();
                setMenu({ tab: id, x: e.clientX, y: e.clientY });
              }}
              className={tab(active)}
              title={isChat || isTerm || isBrowser ? label : id}
            >
              {isChat && <ChatGlyph />}
              {isTerm && <TerminalGlyph />}
              {isBrowser && <BrowserGlyph />}
              {editing?.tab === id ? (
                <input
                  autoFocus
                  value={editing.draft}
                  onChange={(e) => setEditing({ tab: id, draft: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="w-28 min-w-0 bg-paper border border-tangerine rounded px-1 text-[13px] focus:outline-none"
                />
              ) : (
                <span className={`truncate ${exited ? "line-through opacity-60" : ""}`}>{label}</span>
              )}
              {isChat && busyFor(sid) && <span className="size-1.5 rounded-full bg-tangerine animate-pulse shrink-0" title="Working…" />}
              {!isChat && !isTerm && !isBrowser && dirty[id] && <span className="size-1.5 rounded-full bg-tangerine shrink-0" title="Unsaved changes" />}
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
      {/* Round 11: fill THIS pane — a session, a terminal (§26), or a file. */}
      <NewTabButton
        onNewSession={onNewSession}
        newSessionKey={newSessionKey}
        onNewTerminal={onNewTerminal}
        onNewBrowser={onNewBrowser}
        newTerminalKey={newTerminalKey}
        newBrowserKey={newBrowserKey}
        onOpenFilePanel={onOpenFilePanel}
      />
      {/* Absorbs the leftover width so the strip remains a drop target end to end. */}
      <span className="flex-1 min-w-0" />
      {/* This pane's own layout controls. Only what is legal for THIS pane is
          rendered, so a visible button always does something to the strip it
          sits in — nothing depends on which pane happens to be focused. */}
      {splitOptions.v && (
        <PaneButton title="Split this pane — side by side" label="Split this pane vertically" onClick={() => onSplit("v")}>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" />
          </svg>
        </PaneButton>
      )}
      {splitOptions.h && (
        <PaneButton title="Split this pane — stacked" label="Split this pane horizontally" onClick={() => onSplit("h")}>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" />
          </svg>
        </PaneButton>
      )}
      {/* §7 round 13: the file-panel button is GONE from here. It opened a
          single global overlay, so a split workspace showed it once per pane —
          four buttons for one drawer at 2×2. It now lives, with its Changes
          sibling, in the right rail. What stays is round 11's actual finding:
          every control in this strip acts on THIS pane. */}
      {onClosePane && (
        <PaneButton title="Close this pane (its tabs move to the next one)" label="Close this pane" onClick={onClosePane}>
          {/* An X, deliberately NOT another box-with-a-line: beside the two split
              glyphs and the merge-all one, a fourth rectangle was unreadable. */}
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </PaneButton>
      )}
      {trailing}
      {/* §7 round 12: the rename menu. Catcher first so a click anywhere —
          including a second right-click — dismisses it. */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed hv-menu-in origin-top-left z-50 min-w-44 rounded-lg border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-[13px] font-semibold"
            style={{ left: menu.x, top: menu.y }}
          >
            {renameable(menu.tab) && (
              <button
                type="button"
                onClick={() => {
                  startRename(menu.tab);
                  setMenu(null);
                }}
                className={menuItem}
              >
                <PencilGlyph />
                Rename…
              </button>
            )}
            {/* §7 round 23. onMouseDown + preventDefault, not onClick: pressing
                a <button> does not focus it, and this menu's own dismissal has
                unmounted an item between mousedown and mouseup twice before
                (tests/tabstrip-menu.test.ts). */}
            <button
              type="button"
              disabled={!canMoveToWindow(menu.tab)}
              onMouseDown={(e) => {
                e.preventDefault();
                onMoveToWindow(menu.tab, "new");
                setMenu(null);
              }}
              className={menuItem}
            >
              <NewWindowGlyph />
              To new window
            </button>
            {/* §7 round 23: moving to an ALREADY-OPEN window. The drag is the
                nicer gesture and it works, but it cannot be the only route —
                this is the precise, keyboard-reachable way to say where, and it
                names the destination instead of asking you to aim at it. */}
            {otherWindows.map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={!canMoveToWindow(menu.tab)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onMoveToWindow(menu.tab, w.id);
                  setMenu(null);
                }}
                className={menuItem}
              >
                <WindowGlyph />
                {/* Sentence case, like every other label in the app: "To new
                    window" and "To window 2" are the same sentence. The verb is
                    dropped on purpose — every row here acts on the tab that was
                    right-clicked, the glyph says which kind of destination, and
                    "Move to window 2" was long enough to need truncating. */}
                To {w.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One of this pane's layout controls, in its own strip. */
function PaneButton({
  title,
  label,
  onClick,
  pressed,
  children,
}: {
  title: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`shrink-0 flex items-center border-l-2 border-line px-2 cursor-pointer transition-colors ${
        pressed ? "text-tangerine-deep bg-paper-deep/50" : "text-ink-soft hover:text-ink hover:bg-paper-deep/40"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The trailing `+`: a three-item menu, closed on blur so there is no backdrop.
 *
 * Every row that HAS a keyboard binding shows it, in one shared renderer — the
 * menu is where a binding gets taught, and a row that omits its own shortcut
 * while the row beneath it shows one reads as an oversight. "Open file…" stays
 * bare on purpose: ⌘⇧E TOGGLES the file drawer, so printing it next to an
 * action that only ever opens it would be wrong half the time.
 */
function NewTabButton({
  onNewSession,
  newSessionKey,
  onNewTerminal,
  newTerminalKey,
  onNewBrowser,
  newBrowserKey,
  onOpenFilePanel,
}: {
  onNewSession: () => void;
  /** Shown beside "New session" — the same binding ⌘N dispatches. */
  newSessionKey: string;
  /** §26: opens a terminal in THIS pane. Same action ⌘T dispatches. */
  onNewTerminal: () => void;
  /** Shown beside "New terminal" so the menu teaches the binding. */
  newTerminalKey: string;
  /** §28: opens a browser in THIS pane. Same action ⌘B dispatches. */
  onNewBrowser: () => void;
  newBrowserKey: string;
  onOpenFilePanel: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  /** One row. `hint` is the shortcut, omitted where there is no exact one.
      Round 15: each row leads with the glyph of the tab kind it opens — the
      same glyphs the tabs themselves carry, so the menu previews its result. */
  const Item = ({
    label,
    hint,
    icon,
    onPick,
  }: {
    label: string;
    hint?: string;
    icon: React.ReactNode;
    onPick: () => void;
  }): React.JSX.Element => (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-6 px-3 py-2 text-left text-[13px] whitespace-nowrap hover:bg-paper-deep/60 cursor-pointer"
      // onMouseDown, NOT onClick, and the preventDefault is the load-bearing
      // half. Pressing a button does not focus it, so the wrapper's blur fires
      // with relatedTarget === null, the containment guard below cannot see that
      // the pointer is still inside, and the menu unmounted between mousedown and
      // mouseup — the click then had nothing to land on. Measured in the running
      // app: after mousePressed the menu was already gone and focus had fallen to
      // BODY. Acting on the press sidesteps the race entirely, and preventDefault
      // stops the focus shift that starts it.
      onMouseDown={(e) => {
        e.preventDefault();
        setOpen(false);
        onPick();
      }}
    >
      <span className="flex items-center gap-2 text-ink-soft">
        {icon}
        <span className="text-ink">{label}</span>
      </span>
      {hint && <span className="text-[11px] text-ink-soft font-mono">{hint}</span>}
    </button>
  );

  return (
    <div
      className="relative shrink-0 flex items-stretch"
      // Keeps ⌘-tabbing away or clicking elsewhere from leaving the menu open.
      // The items no longer depend on this firing late enough to matter.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
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
        <div className="absolute hv-menu-in origin-top-left left-0 top-full z-30 mt-0.5 rounded-xl border-2 border-line-strong bg-paper shadow-pop overflow-hidden">
          <Item label="New session" hint={newSessionKey} icon={<ChatGlyph />} onPick={onNewSession} />
          <Item label="New terminal" hint={newTerminalKey} icon={<TerminalGlyph />} onPick={onNewTerminal} />
          <Item label="New browser" hint={newBrowserKey} icon={<BrowserGlyph />} onPick={onNewBrowser} />
          <Item label="Open file…" icon={<FileGlyph />} onPick={onOpenFilePanel} />
        </div>
      )}
    </div>
  );
}

/** §26: the same glyph toolLabel.ts already uses for bash — a terminal reads
    as "a running command", which is what it is. */
function TerminalGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 17l6-5-6-5" />
      <path d="M12 19h8" />
    </svg>
  );
}

/** §28: a globe — the one glyph nobody has to be taught. */
function BrowserGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </svg>
  );
}

/** Round 15: the `+` menu's "Open file…" row. A page with a folded corner. */
function FileGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ChatGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
