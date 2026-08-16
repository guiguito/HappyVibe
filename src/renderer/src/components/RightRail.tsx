/**
 * §7 round 13 — the right icon rail.
 *
 * One entry point per side panel, always in the same place. It replaces the
 * per-pane file button, which showed up once per pane for a single global
 * overlay: with a 2×2 layout that was four buttons opening one drawer.
 *
 * **It lives in the top bar, in normal flow.** Two placements were tried and
 * rejected before this one, and both are recorded in paneGrid.ts: a toolbar
 * TRACK leaves content spanning under it (a pane measuring 628px against its
 * own 552px strip), and a full-height column beside the grid leaves a dead
 * empty gutter running the whole window — which is what it looked like, and it
 * read as broken. So the cluster is simply the LAST item of the top-right
 * strip (`topRightSlot`): no grid track, no overlay, no reserved padding, and
 * nothing composited over a `WebContentsView`.
 *
 * The cost, named rather than hidden: that strip's own split/close controls sit
 * inboard of the cluster while every other strip's sit flush at its edge. Round
 * 11 rejected exactly this asymmetry — for a 96px cluster of LAYOUT controls
 * whose target pane was ambiguous. These two are ~44px and act on neither pane:
 * they open a global panel, so there is nothing for the user to disambiguate.
 * Round 11's real finding stands: every layout control still lives in its own
 * strip and still acts on the strip it sits in.
 */

export type DrawerPanel = "files" | "changes";

export function RightRail({
  open,
  onToggle,
  gitAvailable,
  branch,
  changeCount,
  changeTint,
  filesKey,
  changesKey,
}: {
  /** Which panel the drawer is showing, or null when it is closed. */
  open: DrawerPanel | null;
  onToggle: (panel: DrawerPanel) => void;
  /** False = no git on this machine: the Changes button is ABSENT, not greyed. */
  gitAvailable: boolean;
  branch: string | null;
  changeCount: number;
  changeTint: "green" | "amber";
  /** Formatted shortcuts, so the tooltip teaches the binding. */
  filesKey: string;
  changesKey: string;
}): React.JSX.Element {
  return (
    <div className="shrink-0 flex items-stretch">
      <RailButton
        title={`${open === "files" ? "Hide" : "Show"} the files panel (${filesKey})`}
        label="Files panel"
        pressed={open === "files"}
        onClick={() => onToggle("files")}
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </RailButton>

      {/* §29 5a: no git on this machine means no Changes button at all — the
          capability is stated once, on the workspace settings page. A greyed
          control here would ask the user to reason about why it cannot work. */}
      {gitAvailable && (
        <span className="relative inline-flex">
          <RailButton
            title={
              `${open === "changes" ? "Hide" : "Show"} the Changes panel (${changesKey})` +
              (branch ? ` — on ${branch}` : "") +
              (changeCount > 0 ? `, ${changeCount} changed` : "")
            }
            label="Changes panel"
            pressed={open === "changes"}
            onClick={() => onToggle("changes")}
          >
            {/* A branch glyph: one line forking to another. */}
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="6" cy="5" r="2" />
              <circle cx="6" cy="19" r="2" />
              <circle cx="18" cy="9" r="2" />
              <path d="M6 7v10" />
              <path d="M18 11c0 4-5 3-9 5" />
            </svg>
          </RailButton>
          {/* The count belongs HERE rather than on the files icon: it is a
              property of the working tree, not of the file list. Passive
              awareness — it opens nothing by itself (§29 1a). */}
          {changeCount > 0 && (
            <span
              aria-hidden
              className={`pointer-events-none absolute top-0.5 right-0.5 min-w-3 h-3 px-0.5 rounded-full text-[8px] font-bold leading-[12px] text-center border border-paper ${
                // The context bubble taught this vocabulary: leaf = calm,
                // honey = filling up. Same shape of thing, same colours.
                changeTint === "amber" ? "bg-honey text-ink" : "bg-leaf text-paper"
              }`}
            >
              {changeCount > 99 ? "99+" : changeCount}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** Deliberately identical to TabStrip's PaneButton: the cluster sits in that
 *  row, so anything else would read as a foreign object. */
function RailButton({
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
