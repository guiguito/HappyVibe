/**
 * Center-tab state: a 2×2 grid of panes, each holding tabs (round 11).
 * Pure helpers, unit-tested in tests/tabs.test.ts.
 *
 * Tabs are PER-WORKSPACE (Record<workspaceId, WorkspaceTabs> in App). A tab is
 * either a workspace-relative FILE path or a CHAT, keyed by session id — round
 * 11 made the chat per-session, so opening a second session ADDS a tab instead
 * of replacing the one in front of you (WS6 had a single `:chat` sentinel).
 *
 * GEOMETRY. Four fixed slots, so an index never shifts under a consumer:
 *
 *      split "v"                    split "h"
 *   ┌────┬────┐                  ┌─────────┐
 *   │ 0  │ 1  │   subSplit[0]    │    0    │   subSplit[0] stacks 2 beside 0
 *   ├────┼────┤   stacks 2       ├─────────┤
 *   │ 2  │ 3  │   under 0        │    2    │
 *   └────┴────┘                  ├─────────┤
 *                                │    1    │
 *   slot 0 = half A              ├─────────┤
 *   slot 1 = half B              │    3    │
 *   slot 2 = A's cross partner   └─────────┘
 *   slot 3 = B's cross partner
 *
 * Invariants `normalize` maintains:
 *   - slot 0 always exists; slot 1 exists iff `split !== null`
 *   - slot 2 exists iff subSplit[0]; slot 3 exists iff subSplit[1]
 *   - no live slot is ever empty (an emptied pane collapses)
 *   - `focused` always points at a live slot
 *
 * Nesting stops at 2×2 deliberately (§7 round 11): a flat four-slot grid keeps
 * the rendering invariant below, where an arbitrary-depth tree would not.
 *
 * Rendering invariant (App.tsx): every tab's content component is mounted ONCE
 * as a flat grid child and placed into its pane's area via CSS — moving a tab
 * between panes must not remount it (FileTab edit buffers would be lost).
 */

/** A tab is a workspace-relative file path, `:chat:<sessionId>`, `:term:<id>` or `:browser:<id>`. */
export type TabId = string;

/** Paths never start with ":", so this cannot collide with one. */
export const CHAT_PREFIX = ":chat:";
export const chatTab = (sessionId: string): TabId => `${CHAT_PREFIX}${sessionId}`;
export const isChatTab = (id: TabId): boolean => id.startsWith(CHAT_PREFIX);
/** The session a chat tab belongs to, or null for any other tab. */
export const sessionOf = (id: TabId): string | null =>
  isChatTab(id) ? id.slice(CHAT_PREFIX.length) : null;

/** §26's third tab type. Same prefix trick, same reason it cannot collide. */
export const TERM_PREFIX = ":term:";
export const termTab = (terminalId: string): TabId => `${TERM_PREFIX}${terminalId}`;
export const isTermTab = (id: TabId): boolean => id.startsWith(TERM_PREFIX);
/** The terminal a term tab belongs to, or null for any other tab. */
export const terminalOf = (id: TabId): string | null =>
  isTermTab(id) ? id.slice(TERM_PREFIX.length) : null;

/** §28's fourth tab type. Same prefix trick, same reason it cannot collide. */
export const BROWSER_PREFIX = ":browser:";
export const browserTab = (browserId: string): TabId => `${BROWSER_PREFIX}${browserId}`;
export const isBrowserTab = (id: TabId): boolean => id.startsWith(BROWSER_PREFIX);
/** The browser a browser tab belongs to, or null for any other tab. */
export const browserOf = (id: TabId): string | null =>
  isBrowserTab(id) ? id.slice(BROWSER_PREFIX.length) : null;

export interface Pane {
  tabs: TabId[];
  active: TabId | null;
}

/** Slot index into `panes`. 0/1 are the primary halves, 2/3 their cross partners. */
export type Slot = 0 | 1 | 2 | 3;

export interface WorkspaceTabs {
  /** Fixed length 4; null = that slot is not live. Slot 0 always exists. */
  panes: [Pane, Pane | null, Pane | null, Pane | null];
  /** null = one pane; "v" = halves side-by-side; "h" = halves stacked. */
  split: "h" | "v" | null;
  /** Is half A / half B split on the cross axis? Requires `split !== null`. */
  subSplit: [boolean, boolean];
  /** Which pane receives new tabs. Always a live slot. */
  focused: Slot;
  /**
   * Divider positions, as a ratio of the first side. `main` splits the two
   * halves; `cross` is the SHARED second-level divider.
   *
   * Shared rather than per-half on purpose: the panes are placed into one flat
   * CSS grid (the mount-once invariant above), and in a flat grid the halves'
   * inner tracks are the same tracks — so two independent ratios cannot both be
   * honoured without nested containers. A 2×2 with one cross divider is also
   * what "2×2" means to the user.
   */
  sizes: { main: number; cross: number };
}

/** Keep every divider visible and every pane usable. */
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;
const clampRatio = (r: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

const emptyPane = (): Pane => ({ tabs: [], active: null });

export const emptyTabs: WorkspaceTabs = {
  panes: [emptyPane(), null, null, null],
  split: null,
  subSplit: [false, false],
  focused: 0,
  sizes: { main: 0.5, cross: 0.5 },
};

/** The other axis — a half split "against" the primary one. */
const cross = (dir: "h" | "v"): "h" | "v" => (dir === "v" ? "h" : "v");

/** Live slots, in slot order. */
export function liveSlots(t: WorkspaceTabs): Slot[] {
  return ([0, 1, 2, 3] as Slot[]).filter((i) => t.panes[i] != null);
}

/**
 * Every open file path across every pane.
 *
 * A tab is a file only if it is none of the OTHER kinds. The negative test
 * matters more than it looks: this one function feeds THREE consumers — the
 * flat mounted FileTab list, the filesystem watch targets (watchTargets.ts),
 * and §9's open-files block injected into the agent's context. When it meant
 * merely "not a chat", a `:term:` tab reached all three and the model was told
 * a file named `:term:t1` was open.
 *
 * §28's `:browser:` prefix is excluded in the SAME commit that introduced it,
 * which is the rule for any future fourth kind: add the prefix and the
 * exclusion together, or all three consumers inherit the bug.
 */
export function allFiles(t: WorkspaceTabs): string[] {
  const out: string[] = [];
  for (const i of liveSlots(t))
    for (const id of t.panes[i]!.tabs) if (!isChatTab(id) && !isTermTab(id) && !isBrowserTab(id)) out.push(id);
  return out;
}

/** Every browser with an open tab (App mounts one BrowserTab per entry). */
export function allBrowsers(t: WorkspaceTabs): string[] {
  const out: string[] = [];
  for (const i of liveSlots(t)) {
    for (const id of t.panes[i]!.tabs) {
      const bid = browserOf(id);
      if (bid) out.push(bid);
    }
  }
  return out;
}

/** Every terminal with an open tab (App mounts one TerminalTab per entry). */
export function allTerminals(t: WorkspaceTabs): string[] {
  const out: string[] = [];
  for (const i of liveSlots(t)) {
    for (const id of t.panes[i]!.tabs) {
      const tid = terminalOf(id);
      if (tid) out.push(tid);
    }
  }
  return out;
}

/** Every session with an open chat tab (App mounts one ChatView per entry). */
export function allChats(t: WorkspaceTabs): string[] {
  const out: string[] = [];
  for (const i of liveSlots(t)) {
    for (const id of t.panes[i]!.tabs) {
      const sid = sessionOf(id);
      if (sid) out.push(sid);
    }
  }
  return out;
}

/**
 * §17 round 12 — is this the ONLY tab open for that session?
 *
 * Closing it ends the session's process, so the question has to be asked across
 * every pane rather than per pane: the same session can be open in two panes
 * (drag a tab, or open it from the sidebar into another half), and closing one
 * of those two must leave the child running.
 */
export function chatTabCount(t: WorkspaceTabs, sessionId: string): number {
  return allChats(t).filter((s) => s === sessionId).length;
}

/**
 * The sessions a user can actually SEE right now: the active tab of each live
 * pane, chats only. A pane shows exactly one tab at a time, so this is at most
 * four and usually one or two.
 *
 * This is the set App hydrates. It exists because `selectedId` could be set
 * WITHOUT the session's history ever being fetched — the layout restore and the
 * tab strip both set it directly, and only the sidebar path called
 * `openSession`. After a restart that meant restored chat tabs rendered the
 * empty "Ready when you are." state while their transcripts sat on disk (146
 * messages, in the case that surfaced it) and the cost pill cheerfully showed
 * the money they had already spent.
 *
 * Deliberately NOT `allChats`: hydrating every open tab would spawn a Pi
 * process per restored chat at boot — six, in that same case — which is the
 * opposite of what hibernation is for. Off-screen tabs hydrate when they are
 * brought on screen.
 */
export function visibleChats(t: WorkspaceTabs): string[] {
  const out: string[] = [];
  for (const i of liveSlots(t)) {
    const active = t.panes[i]!.active;
    if (!active) continue;
    const sid = sessionOf(active);
    if (sid) out.push(sid);
  }
  return out;
}

/** Which slot holds `tab`, or -1. */
export function paneOf(t: WorkspaceTabs, tab: TabId): number {
  for (const i of liveSlots(t)) if (t.panes[i]!.tabs.includes(tab)) return i;
  return -1;
}

/** The tab focused in the focused pane (what the toolbar and context panel act on). */
export function activeTabOf(t: WorkspaceTabs): TabId | null {
  return t.panes[t.focused]?.active ?? null;
}

type Slots = (Pane | null)[];

/**
 * Restore the invariants after any mutation: drop empty panes, collapse a half
 * whose primary pane went away, and clamp `focused`.
 *
 * An emptied slot 0 is the interesting case. If half A still has its cross
 * partner, that partner becomes half A. Otherwise half A is gone entirely and
 * half B slides over — and if B was cross-split, that split becomes the PRIMARY
 * one, which is geometrically exactly what the user sees when B fills the area.
 */
function normalize(
  raw: Slots,
  split: "h" | "v" | null,
  subSplit: [boolean, boolean],
  focused: number,
  sizes: WorkspaceTabs["sizes"],
): WorkspaceTabs {
  const s: Slots = [...raw];
  const sub: [boolean, boolean] = [...subSplit];
  let dir = split;
  const nextSizes = { ...sizes };

  const drop = (i: number): void => { s[i] = null; };
  const isEmpty = (i: number): boolean => !s[i] || s[i]!.tabs.length === 0;

  // Cross partners first: they have no dependents.
  if (isEmpty(2)) { drop(2); sub[0] = false; }
  if (isEmpty(3)) { drop(3); sub[1] = false; }

  // Half A's primary pane went away.
  if (isEmpty(0)) {
    if (s[2]) {
      s[0] = s[2]; s[2] = null; sub[0] = false;
    } else {
      // Half A is gone: slide half B (and its partner) over.
      s[0] = s[1]; s[1] = null;
      s[2] = s[3]; s[3] = null;
      sub[0] = false;
      if (sub[1] && s[2]) {
        // B's cross split becomes the primary split of the whole area.
        s[1] = s[2]; s[2] = null;
        dir = dir ? cross(dir) : null;
        nextSizes.main = nextSizes.cross;
      } else if (s[2]) {
        sub[0] = true;
      } else {
        dir = null;
      }
      sub[1] = false;
      nextSizes.cross = 0.5;
    }
  }

  // Half B's primary pane went away.
  if (dir && isEmpty(1)) {
    if (s[3]) {
      s[1] = s[3]; s[3] = null; sub[1] = false;
    } else {
      // Only half A remains. Its cross split, if any, becomes the primary one.
      s[1] = null; sub[1] = false;
      if (sub[0] && s[2]) {
        s[1] = s[2]; s[2] = null;
        dir = cross(dir);
        nextSizes.main = nextSizes.cross;
        sub[0] = false;
        nextSizes.cross = 0.5;
      } else {
        dir = null;
      }
    }
  }

  if (!s[0]) { s[0] = emptyPane(); dir = null; sub[0] = false; sub[1] = false; }
  if (!dir) { s[1] = null; s[2] = null; s[3] = null; sub[0] = false; sub[1] = false; }

  const live = ([0, 1, 2, 3] as Slot[]).filter((i) => s[i] != null);
  const f = (live.includes(focused as Slot) ? focused : live[0] ?? 0) as Slot;
  return {
    panes: [s[0]!, s[1] ?? null, s[2] ?? null, s[3] ?? null],
    split: dir,
    subSplit: sub,
    focused: f,
    sizes: nextSizes,
  };
}

/** Add `tab` to the focused pane, or focus it where it already is. */
function addOrFocus(t: WorkspaceTabs, tab: TabId): WorkspaceTabs {
  const existing = paneOf(t, tab);
  if (existing >= 0) {
    const panes = [...t.panes] as Slots;
    panes[existing] = { ...panes[existing]!, active: tab };
    return { ...t, panes: panes as WorkspaceTabs["panes"], focused: existing as Slot };
  }
  const panes = [...t.panes] as Slots;
  const target = panes[t.focused]!;
  panes[t.focused] = { tabs: [...target.tabs, tab], active: tab };
  return { ...t, panes: panes as WorkspaceTabs["panes"] };
}

/** Open (or focus) a file. */
export function openFile(t: WorkspaceTabs, relPath: string): WorkspaceTabs {
  return addOrFocus(t, relPath);
}

/**
 * Open (or focus) a session's chat. Round 11: this is what makes selecting a
 * second session ADD a tab rather than replace the one already on screen.
 */
export function openChat(t: WorkspaceTabs, sessionId: string): WorkspaceTabs {
  return addOrFocus(t, chatTab(sessionId));
}

/** Open (or focus) a terminal. §26: ⌘T and the pane `+` menu land here. */
export function openTerminal(t: WorkspaceTabs, terminalId: string): WorkspaceTabs {
  return addOrFocus(t, termTab(terminalId));
}

/**
 * §28: open a browser pane WITHOUT covering the chat the agent is talking in.
 *
 * "Split horizontally if needed" is the locked rule, and the interesting half is
 * "if needed": the layout supports exactly ONE 2×2 grid, so when a split already
 * exists there is nowhere new to put a half — the browser joins the tab strip of
 * a pane that is not showing the active chat. Falling back to the focused pane
 * only happens when every live pane holds that chat, where covering it is the
 * only option left.
 */
export function openBrowserTab(t: WorkspaceTabs, browserId: string, chatTabId?: TabId | null): WorkspaceTabs {
  const tab = browserTab(browserId);
  if (paneOf(t, tab) >= 0) return addOrFocus(t, tab); // already open — just focus it
  if (!t.split) {
    // No split yet: make one and put the browser in the new half. splitPane
    // focuses slot 1, so addOrFocus lands it there.
    return addOrFocus(splitPane(t, "v"), tab);
  }
  const free = liveSlots(t).find((s) => t.panes[s]!.active !== chatTabId && !t.panes[s]!.tabs.includes(chatTabId ?? ""));
  const target = free ?? liveSlots(t).find((s) => t.panes[s]!.active !== chatTabId);
  return addOrFocus(target == null ? t : focusPane(t, target), tab);
}

/** Close a tab in a specific pane; focus a neighbour, then collapse if empty. */
export function closeTab(t: WorkspaceTabs, slot: number, tab: TabId): WorkspaceTabs {
  const pane = t.panes[slot];
  if (!pane) return t;
  const i = pane.tabs.indexOf(tab);
  if (i < 0) return t;
  const tabs = pane.tabs.filter((x) => x !== tab);
  const active = pane.active !== tab ? pane.active : tabs[i] ?? tabs[i - 1] ?? null;
  const panes = [...t.panes] as Slots;
  panes[slot] = { tabs, active };
  return normalize(panes, t.split, t.subSplit, t.focused, t.sizes);
}

/** Focus a tab within a pane (also makes that pane the focused one). */
export function activateTab(t: WorkspaceTabs, slot: number, tab: TabId): WorkspaceTabs {
  const pane = t.panes[slot];
  if (!pane || !pane.tabs.includes(tab)) return t;
  const panes = [...t.panes] as Slots;
  panes[slot] = { ...pane, active: tab };
  return { ...t, panes: panes as WorkspaceTabs["panes"], focused: slot as Slot };
}

/** Focus a pane without changing its active tab. */
export function focusPane(t: WorkspaceTabs, slot: number): WorkspaceTabs {
  if (!t.panes[slot] || t.focused === slot) return t;
  return { ...t, focused: slot as Slot };
}

/** Split into two halves, or just change the primary direction if already split. */
export function splitPane(t: WorkspaceTabs, dir: "h" | "v"): WorkspaceTabs {
  if (t.split) return { ...t, split: dir };
  return {
    ...t,
    panes: [t.panes[0], emptyPane(), null, null],
    split: dir,
    subSplit: [false, false],
    focused: 1,
    sizes: { main: 0.5, cross: 0.5 },
  };
}

/**
 * Which split directions are legal for ONE pane, given the 2×2 ceiling.
 *
 * This is what makes the per-pane controls honest: a strip only offers the button
 * that will actually do something to its own pane. The global toolbar it replaces
 * acted on the FOCUSED half — invisible state — and would silently ROTATE the
 * whole layout when asked for a direction the model could not divide on.
 *
 * Rules: the first split is a free choice; afterwards a half can only be divided
 * on the CROSS axis (its partner sits across it); and a cross partner, or a half
 * that already has one, is the ceiling.
 */
export function splitOptions(t: WorkspaceTabs, slot: number): { v: boolean; h: boolean } {
  if (t.panes[slot] == null) return { v: false, h: false };
  if (!t.split) return { v: true, h: true };
  if (slot >= 2) return { v: false, h: false };
  if (t.subSplit[slot as 0 | 1]) return { v: false, h: false };
  const legal = cross(t.split);
  return { v: legal === "v", h: legal === "h" };
}

/** Split the pane NAMED, not the focused one. No-op when illegal (splitOptions). */
export function splitAt(t: WorkspaceTabs, slot: number, dir: "h" | "v"): WorkspaceTabs {
  const opts = splitOptions(t, slot);
  if (!(dir === "v" ? opts.v : opts.h)) return t;
  return t.split ? splitHalf(t, slot as 0 | 1) : splitPane(t, dir);
}

/**
 * Close ONE pane: its tabs move into a sibling, then the layout collapses.
 *
 * Closing panes one at a time IS the merge — the old layout-wide "unsplit" was
 * deleted with the global toolbar it lived in. Refuses on the
 * last pane — there would be nowhere for the tabs to go, and an empty layout is
 * what `closeTab` already produces.
 */
export function closePane(t: WorkspaceTabs, slot: number): WorkspaceTabs {
  const pane = t.panes[slot];
  const live = liveSlots(t);
  if (!pane || live.length < 2) return t;
  const target = live.find((s) => s !== slot)!;
  const panes = [...t.panes] as Slots;
  const dst = panes[target]!;
  const merged = [...dst.tabs, ...pane.tabs.filter((x) => !dst.tabs.includes(x))];
  panes[target] = { tabs: merged, active: dst.active ?? merged[0] ?? null };
  panes[slot] = { tabs: [], active: null };
  return normalize(panes, t.split, t.subSplit, target, t.sizes);
}

/**
 * Split one half on the cross axis — the second level, and the last. A half
 * already split is a no-op: 2×2 is the ceiling (§7 round 11).
 */
export function splitHalf(t: WorkspaceTabs, half: 0 | 1): WorkspaceTabs {
  if (!t.split) return t; // nothing to sub-divide yet
  if (t.subSplit[half]) return t; // already split — ceiling reached
  const slot = (half === 0 ? 2 : 3) as Slot;
  const panes = [...t.panes] as Slots;
  panes[slot] = emptyPane();
  const subSplit: [boolean, boolean] = [...t.subSplit];
  subSplit[half] = true;
  return { ...t, panes: panes as WorkspaceTabs["panes"], subSplit, focused: slot };
}


/** Move a tab to another pane (drag between strips). Collapses an emptied pane. */
export function moveTab(t: WorkspaceTabs, tab: TabId, toSlot: number): WorkspaceTabs {
  const from = paneOf(t, tab);
  if (from < 0 || from === toSlot || !t.panes[toSlot]) return t;
  const panes = [...t.panes] as Slots;
  const src = panes[from]!;
  const idx = src.tabs.indexOf(tab);
  const rest = src.tabs.filter((x) => x !== tab);
  panes[from] = { tabs: rest, active: src.active !== tab ? src.active : rest[idx] ?? rest[idx - 1] ?? null };
  const dst = panes[toSlot]!;
  panes[toSlot] = { tabs: [...dst.tabs, tab], active: tab };
  return normalize(panes, t.split, t.subSplit, toSlot, t.sizes);
}

/**
 * Drop a session's chat tab from every pane (the session was deleted).
 *
 * Tab lifecycle and session lifecycle are separate — closing a tab leaves the
 * session running — but deletion is the one direction where the tab MUST follow,
 * or a strip keeps a tab for a session that no longer exists.
 */
export function closeSessionTabs(t: WorkspaceTabs, sessionId: string): WorkspaceTabs {
  const tab = chatTab(sessionId);
  const slot = paneOf(t, tab);
  return slot < 0 ? t : closeTab(t, slot, tab);
}

/** Move a divider. `main` splits the halves, `cross` is the shared second level. */
export function setSize(t: WorkspaceTabs, which: "main" | "cross", ratio: number): WorkspaceTabs {
  return { ...t, sizes: { ...t.sizes, [which]: clampRatio(ratio) } };
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
