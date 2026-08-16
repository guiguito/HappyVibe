/**
 * §26 — the tab layout is persisted, so a renderer reload restores it.
 *
 * This exists for terminals but is not about terminals. `tabsByWs` was React
 * state only, so ⌘R dropped every chat, file and terminal tab alike. Restoring
 * only terminals would have made the NEWEST tab type the one that survives a
 * reload, which reads as a bug in the other two; persisting the layout costs
 * about the same and deletes the special case. Terminal re-adoption then falls
 * out for free: main never stopped owning the PTY, so a restored tab attaches
 * a fresh emulator and repaints from the headless mirror.
 *
 * Serialisation needs no encoder — `WorkspaceTabs` is already plain JSON.
 * Restoring is where the work is, because what comes back is a file a user can
 * hand-edit AND a snapshot of a world that has since moved on: sessions get
 * deleted, files get renamed, PTYs die while the app is closed. A tab that
 * survives its subject is a tab that renders nothing and cannot be closed.
 */

import { browserOf, closeTab, isChatTab, liveSlots, sessionOf, terminalOf, type Pane, type Slot, type WorkspaceTabs } from "./tabs";

/** What is still real. A file tab needs no check — an editor handles a missing file. */
export interface AliveSubjects {
  sessions: Set<string>;
  terminals: Set<string>;
  /**
   * §28: browser panes die with the app (unlike a PTY, which main keeps across a
   * renderer reload), so at boot this is normally empty and every restored
   * `:browser:` tab is pruned. Without it the strip came back showing tabs for
   * panes that no longer exist — observed as two "Browser" tabs over one pane.
   */
  browsers: Set<string>;
  /**
   * The workspaces main still knows about. Pruning used to ask only whether a
   * TAB's subject was alive and never whether its WORKSPACE still existed, so
   * removing a workspace that had a file tab open left its tabs restoring
   * forever — every `hv:fs-read` and `hv:watch-workspace` for them throwing
   * "Unknown workspace", with no way to reach the tabs and close them.
   *
   * Optional on purpose: absent means "the caller cannot tell", and every
   * workspace is kept. Losing a user's tab arrangement on a doubt is worse than
   * the errors it would prevent.
   */
  workspaces?: Set<string>;
}

const RATIO_MIN = 0.1;
const RATIO_MAX = 0.9;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clamp = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, v))
    : 0.5;

function parsePane(raw: unknown): Pane | null {
  if (!isRecord(raw)) return null;
  const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter((t): t is string => typeof t === "string") : [];
  if (tabs.length === 0) return null;
  const active = typeof raw.active === "string" && tabs.includes(raw.active) ? raw.active : tabs[0]!;
  return { tabs: [...new Set(tabs)], active };
}

/**
 * One workspace's stored layout → a valid `WorkspaceTabs`, or null.
 *
 * Structural validation first, then pruning. Pruning goes through the tabs
 * module's own `closeTab` rather than splicing arrays, so `normalize`'s
 * invariants (no empty live pane, `focused` points somewhere real, a collapsed
 * half promotes its cross partner) are restored by the code that owns them.
 * Re-deriving them here is how the two would drift.
 */
function parseWorkspace(raw: unknown, alive: AliveSubjects): WorkspaceTabs | null {
  if (!isRecord(raw) || !Array.isArray(raw.panes) || raw.panes.length !== 4) return null;

  const parsed = raw.panes.map(parsePane) as [Pane | null, Pane | null, Pane | null, Pane | null];
  const first = parsed[0];
  if (!first) return null;
  const panes: [Pane, Pane | null, Pane | null, Pane | null] = [first, parsed[1], parsed[2], parsed[3]];

  const split = raw.split === "h" || raw.split === "v" ? raw.split : null;
  const subSplitRaw = Array.isArray(raw.subSplit) ? raw.subSplit : [];
  const subSplit: [boolean, boolean] = [subSplitRaw[0] === true, subSplitRaw[1] === true];
  const sizesRaw = isRecord(raw.sizes) ? raw.sizes : {};

  let tabs: WorkspaceTabs = {
    panes: split ? panes : [panes[0], null, null, null],
    split,
    subSplit: split ? subSplit : [false, false],
    focused: 0,
    sizes: { main: clamp(sizesRaw.main), cross: clamp(sizesRaw.cross) },
  };

  // A slot may only exist where the geometry says it can (tabs.ts's invariants).
  if (!tabs.split) tabs = { ...tabs, panes: [tabs.panes[0], null, null, null] };
  if (!tabs.subSplit[0]) tabs = { ...tabs, panes: [tabs.panes[0], tabs.panes[1], null, tabs.panes[3]] };
  if (!tabs.subSplit[1]) tabs = { ...tabs, panes: [tabs.panes[0], tabs.panes[1], tabs.panes[2], null] };
  if (tabs.panes[1] == null) tabs = { ...tabs, split: null, subSplit: [false, false], panes: [tabs.panes[0], null, null, null] };

  // Prune anything whose subject is gone, through the module's own mutator.
  const doomed: [Slot, string][] = [];
  for (const slot of liveSlots(tabs)) {
    for (const id of tabs.panes[slot]!.tabs) {
      const session = sessionOf(id);
      if (session !== null && !alive.sessions.has(session)) doomed.push([slot, id]);
      const terminal = terminalOf(id);
      if (terminal !== null && !alive.terminals.has(terminal)) doomed.push([slot, id]);
      const browser = browserOf(id);
      if (browser !== null && !alive.browsers.has(browser)) doomed.push([slot, id]);
    }
  }
  for (const [slot, id] of doomed) {
    // The slot may have moved under us as earlier removals collapsed panes,
    // so `closeTab` is asked to find it again rather than trusted to stay put.
    const at = liveSlots(tabs).find((s) => tabs.panes[s]!.tabs.includes(id));
    if (at !== undefined) tabs = closeTab(tabs, at, id);
    else void slot;
  }

  const focusedRaw = typeof raw.focused === "number" ? raw.focused : 0;
  const live = liveSlots(tabs);
  const focused = (live.includes(focusedRaw as Slot) ? focusedRaw : live[0] ?? 0) as Slot;
  return { ...tabs, focused };
}

/**
 * The stored layout → what App should mount. Junk yields `{}`, never a throw:
 * a corrupt layout must cost the user their tab arrangement, not their app.
 */
export function restoreLayout(
  raw: unknown,
  alive: AliveSubjects,
): Record<string, WorkspaceTabs> {
  if (!isRecord(raw)) return {};
  const out: Record<string, WorkspaceTabs> = {};
  for (const [workspaceId, value] of Object.entries(raw)) {
    if (alive.workspaces && !alive.workspaces.has(workspaceId)) continue;
    let parsed: WorkspaceTabs | null = null;
    try {
      parsed = parseWorkspace(value, alive);
    } catch {
      parsed = null;
    }
    // An entry whose every tab was pruned is dropped rather than stored as an
    // empty pane — otherwise a workspace you never reopen keeps a row forever.
    if (parsed && liveSlots(parsed).some((s) => parsed!.panes[s]!.tabs.length > 0)) {
      out[workspaceId] = parsed;
    }
  }
  return out;
}

/** Which chat tabs a restored layout still holds — App reopens their sessions. */
export function restoredSessions(layout: Record<string, WorkspaceTabs>): string[] {
  const out = new Set<string>();
  for (const tabs of Object.values(layout)) {
    for (const slot of liveSlots(tabs)) {
      for (const id of tabs.panes[slot]!.tabs) {
        if (isChatTab(id)) out.add(sessionOf(id)!);
      }
    }
  }
  return [...out];
}
