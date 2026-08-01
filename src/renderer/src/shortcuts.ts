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
  | "closeTab"
  | "save"
  | "search"
  | "toggleSidebar"
  | "toggleFileDrawer"
  | "openSettings"
  | "openShortcuts";

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  defaultKey: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "newSession", label: "New session in the current workspace", defaultKey: "Mod-n" },
  { id: "closeTab", label: "Close the active file tab", defaultKey: "Mod-w" },
  { id: "save", label: "Save the open file", defaultKey: "Mod-s" },
  // One action, two consumers: whichever of the chat / the editor has focus.
  // Two actions would make the default ⌘F conflict with itself on first render.
  { id: "search", label: "Search the conversation or the open file", defaultKey: "Mod-f" },
  { id: "toggleSidebar", label: "Show or hide the workspace panel", defaultKey: "Mod-b" },
  { id: "toggleFileDrawer", label: "Show or hide the file drawer", defaultKey: "Mod-Shift-e" },
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
