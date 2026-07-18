/**
 * F6: keyboard-shortcut registry — the single source for the help dialog and a
 * reference for the global handler in App.tsx. Mac-first symbols (the app is
 * macOS-first); on Windows/Linux ⌘ maps to Ctrl.
 */

export interface Shortcut {
  keys: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "⌘N", label: "New session in the current workspace" },
  { keys: "⌘W", label: "Close the active file tab" },
  { keys: "⌘S", label: "Save the open file" },
  { keys: "⌘F", label: "Search the conversation / editor" },
  { keys: "⌘B", label: "Show or hide the workspace panel" },
  { keys: "⌘⇧E", label: "Show or hide the file drawer" },
  { keys: "⌘,", label: "Open Settings" },
  { keys: "⌘/", label: "Show keyboard shortcuts" },
  { keys: "Enter", label: "Send the message" },
  { keys: "⇧Enter", label: "New line in the composer" },
  { keys: "@", label: "Reference a file or folder in the composer" },
  { keys: "Esc", label: "Close a dialog or search" },
];
