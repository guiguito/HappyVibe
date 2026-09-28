---
title: Workspaces and sessions
description: Add projects, start, find, rename and tidy away sessions, and read what every mark in the sidebar means.
---

The sidebar is home base. Every project you've added sits there, with every session you've had in it one click away, and small marks tell you at a glance which ones are busy, asleep or waiting for you.

A **workspace** is a project as it shows up in the sidebar. A **session** is one conversation with the agent, inside one workspace.

## Where to find it

The sidebar runs down the left of the window. This page covers its top half, everything above **Settings**. The groups under **Settings** have pages of their own, starting with [Models](/docs/models/).

## What's on the screen

From top to bottom: a row of buttons, **Schedules**, then your workspaces, each with its sessions underneath. Most days you only click a session, or the **+** beside a workspace.

<!-- TODO(media): workspaces-and-sessions/sidebar-workspaces.png — The sidebar with two workspaces and their sessions, showing the working, plan-mode and sleeping marks, with the + menu open on New session -->

### The top row

- **HappyVibe:** the name and logo. Click them to go back to your sessions from any other screen.
- **Send feedback:** a megaphone, when your copy of HappyVibe offers it.
- **Find a session:** a magnifying glass. Its tooltip also shows the shortcut: ⌘K on macOS, Ctrl+K on Windows and Linux.
- **«:** "Collapse sidebar". It folds the sidebar into a slim [icon rail](#the-icon-rail). The shortcut is ⌘\ on macOS, Ctrl+\ on Windows and Linux.

### Schedules

The first row takes you to [Schedules](/docs/schedules/), the one thing in HappyVibe that runs on its own, across workspaces. Once a schedule is switched on, the row says how things stand, like "2 active · next 9:00". When a run was missed, it says so instead ("1 missed · decide") and waits for you to choose.

### workspaces

The heading of your project list. **+ add** beside it ("Add workspace folder") adds a project. With none added yet, the list reads "Add a project folder to start."

### A workspace row

- **The emoji:** picked from the folder's path, so it stays the same every time you open the app. It's decoration.
- **The name:** the folder's name. Hover over it to see the full path. Click it to fold the workspace's sessions away, or to bring them back. The chevron after it shows which way it is. The app remembers what you folded, even after a restart.
- **Which one is on screen:** the workspace whose tabs you're looking at has its emoji on a honey-coloured chip, and its tooltip ends in "— showing". The other names are a little fainter.
- **The branch line:** under the name, when the folder uses git (version control). It shows ⎇ and the current branch. For the workspace on screen it also counts the files you've changed since you last saved a version, like "· 3 changes", green at first and amber once the changes add up. Click the line to open the Changes panel, where [Files and changes](/docs/files-and-changes/) takes over.
- **The gear:** appears when you hover over the row. Its tooltip reads "Workspace settings". It opens [workspace settings](/docs/first-session/#workspace-settings).
- **+:** always there, always last. On a git project its tooltip reads "New session or worktree", and it opens a small menu: **New session** and **New worktree…**, each with its shortcut beside it. On a folder without git it's a plain button, "New session", that starts one straight away.

Under the row come its sessions, newest-used first. A workspace with none yet says "No sessions yet — hit + next to a workspace."

### Worktrees

The app explains it in one sentence: "A worktree is a second copy of this project's files, on its own branch, in its own folder — so an agent can work there without touching what you have open here." [Files and changes](/docs/files-and-changes/#worktrees) covers making, merging and removing one.

A git project that has worktrees lists them under a small **Worktrees** heading, beneath its own sessions. Each one shows:

- a chevron to fold its sessions away ("Hide its sessions") or show them again ("Show its sessions");
- its folder's name and its branch, with the same change count as a project;
- **+** ("New session"), to start a session inside that worktree.

Click a worktree's name to put it on screen. It has no gear of its own: a worktree shares its project's settings, so the project's gear covers both. If a worktree's folder has gone missing, its row fades, and hovering over it says "this folder is gone. Click to clean up." Clicking it opens the project's Changes panel, where **Clean up a stale worktree** tidies the list ([how](/docs/files-and-changes/#worktrees)).

**What a worktree is**, under the list, opens a longer explanation, right there in the sidebar.

### A session row

Each row shows the session's title, and hovering shows the full title if it's cut short. The row you're in is highlighted in honey. A session open in another tab has a thin outline.

At rest, the right-hand end shows how long ago you last used it: "now", "5m", "3h", "2d", "4mo". A session whose agent is running shows no age. Hover over the row and the age turns into a bin icon, "Archive or delete this session".

The marks at the start of the row tell you what the session is up to. Hover over any of them to read its word:

| Mark | Tooltip | What it means |
|---|---|---|
| A spinning orange ring | "working…" | The agent is mid-turn. |
| A green dot | "running — waiting for you" | The agent is up and waiting for your next message. |
| A pulsing honey dot | "waking up…" | The session is starting up: after a sleep, or when you open one that wasn't running. |
| A red dot | "crashed" | The agent stopped unexpectedly. |
| A grey dot | "idle" | The agent isn't running. Open the session to start it. |
| ☾ | "Sleeping — opens right where you left off" | The app put this session to sleep to make room for others. Click it and it picks up exactly where it was. |
| 🧭 | "Plan mode — read-only" | The session is in [plan mode](/docs/built-in-tools/#start-plan-mode): the agent can look around, but can't change anything. |
| 🕰 | "Started by a schedule" | A [schedule](/docs/schedules/) opened this session, not you. |
| A number in a honey badge | "1 permission prompt waiting" | The agent is waiting for your answer in an approval dialog. The number counts how many. |

These marks are about the session. The cards inside it have dots of their own ([Your first session](/docs/first-session/#watch-it-work)).

### Show archived

When you've archived sessions, **Show archived** appears under the last workspace, with the count, like "Show archived (3)". Click it to show them, a little faded, among the others. **Hide archived** tucks them away again.

## Add a workspace

1. Next to **workspaces**, click **+ add**.
2. Pick your project's folder.

It appears in the list straight away. Adding a folder changes nothing inside it.

## Start a session, or a worktree

1. Click the **+** at the end of the workspace's row.
2. On a git project, the menu opens. Click **New session**. On a folder without git, the session starts straight away.

The new session opens in a tab of its own. Or press ⌘N on macOS, Ctrl+N on Windows and Linux, for a new session in the workspace on screen.

For a worktree, pick **New worktree…** from the same menu, or press ⌘⇧T on macOS, Ctrl+Shift+T on Windows and Linux. The Changes panel opens with its New worktree dialog, and [Files and changes](/docs/files-and-changes/) walks you through the rest.

To open a session you already have, click its row. It opens in a tab, or comes to the front if it already has one. [Session view](/docs/session-view/) covers what you see there.

## Find a session

1. Click the magnifying glass, or press ⌘K on macOS, Ctrl+K on Windows and Linux. The shortcut opens the sidebar first if it's collapsed.
2. Type part of a title in the box that reads "Filter sessions…".

The list narrows to matching titles as you type, and folded workspaces open up so nothing hides. When nothing matches, a workspace says "No matching sessions." Clicking a result keeps your filter in place. Press **Esc** to clear it and close the box.

## Rename a session

A new session gets its name on its own, and you can change it any time.

1. Double-click the session's title.
2. Type the new name.
3. Press **Enter** to save, or **Esc** to keep the old one. Clicking away saves too.

## Archive or delete a session

1. Hover over the session's row and click the bin icon, "Archive or delete this session".
2. The dialog shows the session's title and asks "Archive or delete this session?" If the agent is mid-turn, it warns you first: "This session is running — deleting it stops the agent mid-task."
3. Choose:
   - **Archive:** "hide it from the list. You can bring it back from “Show archived”."
   - **Delete permanently:** "the conversation, its session file and its sub-agent transcripts are gone for good."
   - **Cancel** leaves everything as it was.

Archive is the gentle one. If the session's agent is running, archiving stops it. Everything else stays: the whole conversation, any terminals the session started, and your files. You can still open an archived session under **Show archived**. To bring it back into the list, click its bin icon again. The dialog then asks "Restore or delete this session?", and **Unarchive** will "put it back in the list. Nothing is lost."

Your project's files are never touched. Delete permanently removes everything else, for good: it stops the agent if it's running, closes the session's tab, and removes the conversation, its session file, the transcripts of any subagents it ran, and the saved snapshots that [rewind](/docs/first-session/#changed-your-mind-rewind) uses to restore files.

If the session started commands that are still running in terminals, deleting asks one more question first, like "1 process started by this session is still running". Choose **Keep them as terminals** to keep them going, or **Stop them**. Clicking outside that dialog cancels the delete.

## Remove a workspace

Removing is tucked away in the workspace's settings, so it never sits one careless click from **+**.

1. Hover over the workspace's name and click the gear, "Workspace settings".
2. Scroll to the last section, **Remove workspace**: "Take this project out of HappyVibe."
3. Pick one:
   - **Forget workspace:** takes it out of the list and archives its sessions. "Nothing on disk is touched, and adding the folder again brings them back." Click **Forget**.
   - **Delete permanently:** removes it and permanently deletes its sessions, "conversations, history and sub-agent transcripts included. Your files are never touched. This cannot be undone." Click **Delete**.
4. The app asks once more, naming the workspace and how many sessions it holds. Click **Forget** or **Delete** to go ahead, or **Cancel**.

Both choices also cover the sessions in the project's worktrees, and both stop the terminals open in that workspace. Your project's files stay where they are either way. If you forget a workspace and add its folder again later, its sessions return archived, under **Show archived**.

## The icon rail

Click **«** at the top of the sidebar, or press ⌘\ on macOS, Ctrl+\ on Windows and Linux, and the sidebar folds into a narrow rail. The app remembers it that way, and the same keys open it again. From top to bottom:

- **The logo:** "Expand sidebar". Click it to open the full sidebar again.
- **Send feedback**, when offered.
- **One tile per workspace**, showing its emoji. The one on screen has a honey border. A spinning ring on a tile's corner means "An agent is working in this workspace", so you can see that from across the room. Click any tile to open the full sidebar.
- **Schedules:** a clock. Its tooltip adds the same status the full row shows, and a honey dot appears when a run was missed.
- **Settings:** a gear. It opens the full sidebar.

## During a session

The sidebar keeps you posted while the agent works, even in sessions you're not looking at.

- The row's dot becomes a spinning ring while the agent works, and goes back to green when it's waiting for you.
- When a session you're not looking at needs an answer, its row gets the honey badge. Click the row to open it and answer the [approval dialog](/docs/approve-a-tool-call/).
- Sessions with their agent running sit at the top of their workspace. The rest follow in the order you last opened or messaged them.
- While your pointer is over the sidebar, the rows hold still, so the one you're reaching for never slides out from under your click. They settle into their new order when the pointer leaves.

:::note[The fine print]
- The branch line's count turns amber at 50 changed lines. It's a nudge to save a version, not a warning: nothing is wrong.
- While **Settings** is open, the line between your projects and **Settings** is a handle. Its tooltip reads "Drag to resize". Drag it up or down to give more room to either half. Double-click it to go back to the original split. The app remembers where you left it.
- Only a limited number of sessions run at once. When a new one needs room, the app puts an idle session to sleep (☾). It never puts a working session to sleep.
- The shortcuts here are the defaults. If you've changed them on [Keyboard shortcuts](/docs/keyboard-shortcuts/), the **+** menu shows yours.
:::

## Related

- [Your first session](/docs/first-session/): your first workspace and session, step by step.
- [Session view](/docs/session-view/): what's inside a session once it's open.
- [Files and changes](/docs/files-and-changes/): the Changes panel, branches and worktrees.
- [Schedules](/docs/schedules/): sessions that start on their own.
- [Keyboard shortcuts](/docs/keyboard-shortcuts/): change any of the keys on this page.
