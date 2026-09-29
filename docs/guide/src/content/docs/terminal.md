---
title: Terminal
description: Open a real shell in a tab, make it look and behave the way you like, and follow the terminals the agent starts.
---

Want to type a command yourself? You get a real shell, in a tab, already in your project folder. This screen decides how it looks and behaves. "These settings are global": they apply in every workspace.

## Where to find it

**App features** → **Terminal** in the sidebar.

## What's on the screen

Every row has its own **Reset** button, which appears once you've changed that row. **Reset all**, at the top right, puts every setting back to its default in one click. Style, appearance and behaviour changes reach terminals you already have open, so you can watch them take effect. Shell changes apply to the next terminal you open.

### Style

"Three presets. Every one is contrast-checked, so no colour is unreadable on its own background." Each card shows a real preview in that palette.

- **Workshop** (the default): "The app's own ink and paper — the treatment chat code blocks use"
- **Paper**: "Cream, so the whole window is one temperature. Best for bright rooms"
- **Carbon**: "The palette de-warmed, neutral and high-contrast for long sessions"

### Appearance

- **Font family**: a list of the monospace fonts on your computer, each drawn in its own font so you can see it before you pick. The one that "ships with the app" is marked. If a font you chose is later uninstalled, the row says so and the terminal falls back to a system monospace font.
- **Font size**, **Line height**, **Letter spacing**.
- **Cursor style** (bar, block or underline) and **Cursor blink**.
- **Minimum contrast ratio**: "Auto-lightens unreadable output from a badly-behaved program. The palettes above already pass on their own."

### Shell

"What gets started, and in what environment. Leave the path blank to use your login shell." Your login shell is the shell your computer starts for you, with your usual settings loaded.

- **Shell path**: leave it blank, and HappyVibe picks the right shell for you. Type a path only if you want a different one. (The details: on macOS and Linux it's your login shell, `$SHELL`, falling back to `/bin/zsh` on macOS and `/bin/bash` on Linux. On Windows it's PowerShell 7, then Windows PowerShell, then the Command Prompt.)
- **Shell arguments**: "Space-separated. `-l` starts a login shell, so your real PATH and version managers work." On Windows, the default shell starts without `-l`, because PowerShell rejects it.
- **Extra environment**: "One KEY=value per line. Merged over the inherited environment."

### Behaviour

- **Scrollback**: how many lines each terminal keeps.
- **Copy on select**: copies text as soon as you select it.
- **Right-click pastes**: "Off by default — a right-click opens the context menu instead."
- **Warn on multi-line paste** (on by default): "A safety setting, not a preference: a pasted block ending in a newline runs the moment it lands." With it on, pasting text that contains or ends with a line break asks first, for example "Paste and run 3 lines? A pasted newline executes immediately." Every paste asks: from the keyboard, with a right-click (when **Right-click pastes** is on), and into an agent terminal's card.
- **Confirm close while running** (on by default): "Closing a terminal tab kills its process." With it on, closing a tab while a command is still running asks first.
- **Bell**: off, visual (a quick flash) or sound.
- **Word separators**: "Characters that end a word for double-click selection."

## Open a terminal

1. In a workspace, click the **+** at the end of the tab strip.
2. Choose **New terminal**. The shortcut is ⌘T on macOS and Ctrl+T on Windows and Linux.

The terminal opens in a tab, at your project folder. To search its output, press ⌘F on macOS or Ctrl+F on Windows and Linux while it has focus.

When the shell in a terminal exits (after you type `exit`, for example), the tab stays open so you can still read the output. A bar along the bottom says so, for example "process exited (code 0)", and names the default shortcut that closes the tab.

## Close a terminal

Closing a terminal tab stops whatever is running in it. If something is still running and **Confirm close while running** is on, HappyVibe asks first, naming the program, for example "npm is still running. Close anyway?" Click **Cancel**, and the terminal keeps running.

## During a session

The agent can open terminals of its own, for things that keep running, like a dev server or a watcher. Each command it runs there goes through the same permission check as any other command: it asks, unless one of your rules already allows it.

An agent terminal doesn't open a tab. It shows up as a circle in the row at the top of the conversation. Hover the circle to see its last few lines. Click it to open its card, which shows the command, what the agent says it's for, how long it has been running, and a live terminal you can type into. The card has three buttons:

- **Open as tab**: "Move this terminal into a tab of its own"
- **◼ Stop**: "Stop this terminal and the process in it". It doesn't ask first, so you can always stop an agent terminal in one click.
- **✕**: "Close — the terminal keeps running, and its circle stays in the row"

Agent terminals use the same style and appearance settings as yours, and the same **Warn on multi-line paste**.

## Related

- [Built-in tools](/docs/built-in-tools/): switch the agent's terminal on or off.
- [Permissions](/docs/permissions/): decide which commands the agent may run without asking.
- [Keyboard shortcuts](/docs/keyboard-shortcuts/): change the **New terminal** shortcut.
