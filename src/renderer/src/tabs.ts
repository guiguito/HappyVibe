/**
 * Center-tab state (chat + open files), now with a single 2-way split (WS6).
 * Pure helpers, unit-tested in tests/tabs.test.ts.
 *
 * Tabs are PER-WORKSPACE (Record<workspaceId, WorkspaceTabs> in App). The chat
 * is a tab like any file (the CHAT_TAB sentinel) so it can be dragged between
 * panes; it is simply never closable in the UI.
 *
 * Rendering invariant (App.tsx): every tab's content component is mounted ONCE
 * as a flat grid child and placed into its pane's area via CSS — moving a tab
 * between panes must not remount it (FileTab edit buffers would be lost).
 */

/** A tab is a workspace-relative file path, or the chat sentinel. */
export type TabId = string;
/** Cannot collide with a workspace-relative path (paths never start with ":"). */
export const CHAT_TAB = ":chat";

export interface Pane {
  tabs: TabId[];
  active: TabId | null;
}

export interface WorkspaceTabs {
  /** One pane, or two when split. */
  panes: [Pane] | [Pane, Pane];
  /** null = single pane; "v" = side-by-side; "h" = stacked. */
  split: "h" | "v" | null;
  /** Which pane receives openFile / new tabs. */
  focused: 0 | 1;
}

export const emptyTabs: WorkspaceTabs = {
  panes: [{ tabs: [CHAT_TAB], active: CHAT_TAB }],
  split: null,
  focused: 0,
};

/** Every open file path across both panes (for the flat mounted FileTab list). */
export function allFiles(t: WorkspaceTabs): string[] {
  return t.panes.flatMap((p) => p.tabs).filter((id) => id !== CHAT_TAB);
}

function paneOf(t: WorkspaceTabs, tab: TabId): number {
  return t.panes.findIndex((p) => p.tabs.includes(tab));
}

/**
 * Collapse to a single pane when a pane is empty (never leaves a blank pane).
 * Keeps `dir` as the split direction when both panes survive.
 */
function normalize(panes: Pane[], focused: 0 | 1, dir: "h" | "v"): WorkspaceTabs {
  const nonEmpty = panes.filter((p) => p.tabs.length > 0);
  if (nonEmpty.length <= 1) {
    return { panes: [nonEmpty[0] ?? { tabs: [CHAT_TAB], active: CHAT_TAB }], split: null, focused: 0 };
  }
  const f = panes.indexOf(nonEmpty[0]) === focused || panes.indexOf(nonEmpty[1]) === focused ? focused : 0;
  return { panes: [nonEmpty[0], nonEmpty[1]] as [Pane, Pane], split: dir, focused: f };
}

/** Open (or focus) a file. If already open in a pane, focus it there; else add to the focused pane. */
export function openFile(t: WorkspaceTabs, relPath: string): WorkspaceTabs {
  const existing = paneOf(t, relPath);
  if (existing >= 0) {
    const panes = t.panes.map((p, i) => (i === existing ? { ...p, active: relPath } : p)) as WorkspaceTabs["panes"];
    return { ...t, panes, focused: existing as 0 | 1 };
  }
  const panes = t.panes.map((p, i) =>
    i === t.focused ? { tabs: [...p.tabs, relPath], active: relPath } : p,
  ) as WorkspaceTabs["panes"];
  return { ...t, panes };
}

/** Close a tab in a specific pane; focus a neighbor, then chat; collapse an empty pane. */
export function closeTab(t: WorkspaceTabs, paneIdx: number, tab: TabId): WorkspaceTabs {
  const pane = t.panes[paneIdx];
  if (!pane) return t;
  const i = pane.tabs.indexOf(tab);
  if (i < 0) return t;
  const tabs = pane.tabs.filter((x) => x !== tab);
  const active = pane.active !== tab ? pane.active : tabs[i] ?? tabs[i - 1] ?? null;
  const nextPanes = t.panes.map((p, idx) => (idx === paneIdx ? { tabs, active } : p));
  return normalize(nextPanes, t.focused, t.split ?? "v");
}

/** Focus a tab within a pane (also makes that pane the focused one). */
export function activateTab(t: WorkspaceTabs, paneIdx: number, tab: TabId): WorkspaceTabs {
  const pane = t.panes[paneIdx];
  if (!pane || !pane.tabs.includes(tab)) return t;
  const panes = t.panes.map((p, i) => (i === paneIdx ? { ...p, active: tab } : p)) as WorkspaceTabs["panes"];
  return { ...t, panes, focused: paneIdx as 0 | 1 };
}

/** Split into two panes (or just change direction if already split). New pane starts empty. */
export function splitPane(t: WorkspaceTabs, dir: "h" | "v"): WorkspaceTabs {
  if (t.split) return { ...t, split: dir };
  return { panes: [t.panes[0], { tabs: [], active: null }], split: dir, focused: 1 };
}

/** Collapse the split back to a single pane (merges the second pane's tabs into the first). */
export function unsplit(t: WorkspaceTabs): WorkspaceTabs {
  const [a, b] = t.panes;
  if (!t.split || !b) return { panes: [a], split: null, focused: 0 };
  const merged = [...a.tabs, ...b.tabs.filter((x) => !a.tabs.includes(x))];
  return { panes: [{ tabs: merged, active: a.active ?? b.active ?? merged[0] ?? null }], split: null, focused: 0 };
}

/** Move a tab to the other pane (drag between strips). Collapses an emptied pane. */
export function moveTab(t: WorkspaceTabs, tab: TabId, toPane: 0 | 1): WorkspaceTabs {
  const from = paneOf(t, tab);
  if (from < 0 || from === toPane || !t.panes[toPane]) return t;
  const panes = t.panes.map((p, i) => {
    if (i === from) {
      const idx = p.tabs.indexOf(tab);
      const tabs = p.tabs.filter((x) => x !== tab);
      return { tabs, active: p.active !== tab ? p.active : tabs[idx] ?? tabs[idx - 1] ?? null };
    }
    if (i === toPane) return { tabs: [...p.tabs, tab], active: tab };
    return p;
  });
  return normalize(panes, toPane, t.split ?? "v");
}

/** Stable key for the per-file editor buffer map. */
export const bufferKey = (workspaceId: string, relPath: string): string => `${workspaceId}\0${relPath}`;

export const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/**
 * Resolve a path surfaced on a tool/diff card against the session workspace.
 * Returns a normalized workspace-relative path, or null when the path points
 * outside the workspace (not openable — link is not rendered).
 */
export function resolveCardPath(workspace: string, raw: string): string | null {
  const ws = workspace.replace(/\/+$/, "");
  let rel: string;
  if (raw.startsWith("/")) {
    if (!raw.startsWith(ws + "/")) return null;
    rel = raw.slice(ws.length + 1);
  } else {
    rel = raw;
  }
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}
