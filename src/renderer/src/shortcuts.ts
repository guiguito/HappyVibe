/**
 * F6 → round 8: the keyboard-shortcut registry — the single source for the
 * shortcuts PAGE and for every site that dispatches a shortcut.
 *
 * Canonical binding format is CodeMirror's ("Mod-s", "Mod-Shift-e"), because
 * one of the three dispatch sites IS a CodeMirror keymap (EditorPane) — storing
 * our own format would buy a translation layer that only that site reads.
 * "Mod" = ⌘ on macOS, Ctrl elsewhere, matching the app's existing
 * `metaKey || ctrlKey` handling.
 */

export type ShortcutId =
  | "newSession"
  | "newTerminal"
  | "newBrowser"
  | "closeTab"
  | "save"
  | "search"
  | "toggleSidebar"
  | "toggleFileDrawer"
  | "toggleChangesPanel"
  | "openSettings"
  | "openShortcuts";

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  defaultKey: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "newSession", label: "New session in the current workspace", defaultKey: "Mod-n" },
  // §26. Mod-t was free — nothing in the app registered it.
  { id: "newTerminal", label: "New terminal in the current workspace", defaultKey: "Mod-t" },
  // §28 feedback round 1. ⌘B is the browser key people expect, so the browser
  // gets it and the sidebar moves to ⌘\ — findConflict refuses duplicates, so
  // this is a swap, never an addition.
  { id: "newBrowser", label: "New browser in the current workspace", defaultKey: "Mod-b" },
  // §26 widened this from files to "file or terminal". A chat is still exempt:
  // closing a chat tab only hides a session, so it needs no keyboard route,
  // whereas closing a terminal KILLS a process and therefore confirms first.
  { id: "closeTab", label: "Close the active tab", defaultKey: "Mod-w" },
  { id: "save", label: "Save the open file", defaultKey: "Mod-s" },
  // One action, two consumers: whichever of the chat / the editor has focus.
  // Two actions would make the default ⌘F conflict with itself on first render.
  { id: "search", label: "Search the conversation or the open file", defaultKey: "Mod-f" },
  { id: "toggleSidebar", label: "Show or hide the workspace panel", defaultKey: "Mod-\\" },
  { id: "toggleFileDrawer", label: "Show or hide the files panel", defaultKey: "Mod-Shift-e" },
  // §7 round 13: Changes is its own panel, so it gets its own key. Mod-Shift-g
  // was free (Mod-Shift-e was the only Mod-Shift binding) and matches what a
  // user arriving from another editor will reach for.
  { id: "toggleChangesPanel", label: "Show or hide the Changes panel", defaultKey: "Mod-Shift-g" },
  { id: "openSettings", label: "Open Settings", defaultKey: "Mod-," },
  { id: "openShortcuts", label: "Open keyboard shortcuts", defaultKey: "Mod-/" },
];

/** Composer and dialog semantics, not bindings — rebinding them breaks typing.
    Listed on the page with a "built-in" tag so the page stays a complete map. */
export const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Enter", label: "Send the message" },
  { keys: "⇧Enter", label: "New line in the composer" },
  { keys: "@", label: "Reference a file or folder in the composer" },
  { keys: "Esc", label: "Close a dialog or search" },
  // §27. NOT a SHORTCUT_ACTIONS entry, and it cannot become one: eventToBinding
  // returns null for a modifier key and again when no modifier accompanies it,
  // the canonical form carries no left/right (e.key is "Meta" for both ⌘s), and
  // one dispatch site is a CodeMirror keymap, which has no press-and-hold.
  { keys: "Hold right ⌘", label: "Dictate into the composer (tap to keep recording)" },
];

type KeyEventish = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

/** A KeyboardEvent → its canonical binding, or null when it isn't one. */
export function eventToBinding(e: KeyEventish): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (parts.length === 0) return null; // a bare key is never an app shortcut
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("-");
}

/** Match by canonical form, so capture and dispatch can never disagree. */
export function matchesBinding(e: KeyEventish, binding: string): boolean {
  return eventToBinding(e) === binding;
}

export function formatBinding(binding: string, mac = true): string {
  return binding
    .split("-")
    .map((p) => {
      if (p === "Mod") return mac ? "⌘" : "Ctrl+";
      if (p === "Shift") return mac ? "⇧" : "Shift+";
      if (p === "Alt") return mac ? "⌥" : "Alt+";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("");
}

/** Stored overrides layered over the defaults. Unknown ids are dropped, so a
    renamed action can never resurrect a stale binding from an old config. */
export function resolveBindings(saved: Record<string, string> | null | undefined): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const a of SHORTCUT_ACTIONS) {
    const s = saved?.[a.id];
    out[a.id] = typeof s === "string" && s.length > 0 ? s : a.defaultKey;
  }
  return out;
}

/** The OTHER action already holding `binding`, if any. */
export function findConflict(
  bindings: Record<ShortcutId, string>,
  id: ShortcutId,
  binding: string,
): ShortcutId | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id !== id && bindings[a.id] === binding) return a.id;
  }
  return null;
}
