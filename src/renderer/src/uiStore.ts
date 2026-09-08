/**
 * §7 round 23 — per-window chrome.
 *
 * The active workspace, the sidebar's collapse and split, the drawer's panel
 * and widths and the settings group all lived in `localStorage`, which every
 * renderer of the SAME ORIGIN shares. A second window would therefore have
 * mirrored the first one's chrome — and `hv:active-ws` would have dragged its
 * whole workspace along, so switching workspace in one window switched it in
 * the other. They now live in this window's own record.
 *
 * Reads are SYNCHRONOUS, which is the whole reason the record arrives at
 * preload rather than over an invoke: these are read inside `useState`
 * initialisers, exactly as they were read from localStorage. An async read
 * renders one frame of defaults first — a flash of the expanded sidebar, and
 * worse, `activeWs` null for a frame, which is the state that draws the WELCOME
 * screen on top of a fully restored layout.
 *
 * The seed is LAZY though, and that is load-bearing rather than tidy: the
 * no-DOM suite imports pure exports from `.tsx` components that import this
 * module, and a `window.hv` read at module scope took 12 test files down with
 * `window is not defined`. First actual read seeds it; an environment with no
 * preload gets an empty map and every caller falls back to its default.
 *
 * Writes are fire-and-forget: losing the last chrome tweak to a crash costs a
 * collapsed sidebar, and blocking the UI on a disk write costs more.
 */
let ui: Record<string, string> | null = null;

/**
 * The keys this store took over from localStorage — and the whole reason it
 * needs a migration at all.
 *
 * Without it every existing install loses its chrome exactly once: the record
 * starts empty, so the sidebar comes back expanded, the settings group shut,
 * the drawer at its default width and the workspace picked by the layout
 * restore's fallback rather than the one you were on. The tabs survive (they
 * were in config.json all along), which is what makes the loss easy to miss.
 *
 * One-time and self-erasing: once a value is in the record, the record wins,
 * and the stale localStorage entries are simply never read again.
 */
const ADOPTED = [
  "hv:active-ws",
  "hv:drawer-panel",
  "hv:drawer-width:files",
  "hv:drawer-width:changes",
  "hv:sidebar-collapsed",
  "hv:settings-open",
  "hv:settings-groups",
  "hv:ws-collapsed",
  "hv:sidebar-split",
] as const;

function seed(): Record<string, string> {
  const stored = { ...(window.hv?.boot?.record?.ui ?? {}) };
  if (Object.keys(stored).length > 0) return stored;
  // A record with nothing in it is either a brand-new window or the first
  // launch after round 23. Both want whatever the old shared store held; a new
  // window then immediately overwrites it with its own choices.
  for (const key of ADOPTED) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) stored[key] = v;
    } catch {
      /* private window, blocked site data — defaults are correct here */
    }
  }
  return stored;
}

const store = (): Record<string, string> => (ui ??= seed());

export function uiGet(key: string): string | null {
  const s = store();
  return key in s ? s[key]! : null;
}

export function uiSet(key: string, value: string | null): void {
  const s = store();
  if (value === null) delete s[key];
  else s[key] = value;
  void window.hv?.setWindowUi({ ...s })?.catch(() => {});
}
