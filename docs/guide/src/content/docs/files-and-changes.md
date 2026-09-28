---
title: Files and changes
description: Browse and edit your project's files, see exactly what changed, and save versions of your work you can come back to.
---

The agent edits your files, and you get to see every one of them. The right-hand panels show your project two ways: the files panel is the folder as it is right now, and the Changes panel is what changed since you last saved a version, in plain words, with a way back.

## Where to find it

Two icons sit at the right end of the top bar, above your tabs. Click one to open its panel, and click it again to close it. Only one panel shows at a time.

- **Files panel** (a folder icon): its tooltip reads "Show the files panel", with the shortcut. The shortcut is ⌘⇧E on macOS and Ctrl+Shift+E on Windows and Linux.
- **Changes panel** (a branch icon): its tooltip reads "Show the Changes panel", with the shortcut, the branch you're on and how many files changed. The shortcut is ⌘⇧G on macOS and Ctrl+Shift+G on Windows and Linux.

A small number on the Changes icon counts your changed files. It's green while the changes are small and turns amber from 50 changed lines, a gentle nudge to save a version. It never opens anything by itself.

Drag a panel's left edge to make it wider ("Drag to resize"). Each workspace remembers which panel you had open.

## What's on the screen

### The files panel

The header shows your project folder's name and three buttons:

- **New file**: a name box appears at the top of the tree. Type a name and press **Enter**, and the new, empty file opens in a tab. Type a path like `notes/ideas.md` to put it in a folder; missing folders are made for you. **Esc** cancels.
- **New folder**: the same, for a folder.
- **Collapse all folders**: folds every open folder back up.

Click a folder to open it, and a file to open it in a tab. The tree keeps itself up to date: when you or the agent adds, moves or deletes something, it shows up without a refresh.

A few things never show in the tree: `node_modules`, `.git`, and files and folders whose names start with a dot, except `.pi`, `.github` and `.agents`, which hold settings for the agent and your project.

Right-click a file or folder for three more choices:

- **Open**.
- **Delete…**: asks "Move file to Trash?" (or "Move folder to Trash?"). **Move to Trash** sends it to your computer's Trash, so you can restore it from there.
- **Details**: its kind, size, when it was last modified, and its path.

You can also drag things around:

- Drag files from your computer onto the tree to copy them into your project. Drop them on a folder to put them there.
- Drag a file or folder onto another folder to move it.
- Drag a file into the middle of the window to open it.

Nothing is ever overwritten: if a file with that name is already there, the tree says so and leaves both alone.

### The editor

A file opens as a tab, in the pane you're working in. If it's already open, the app jumps to its tab instead. One file opens differently: `AGENTS.md` opens in a dialog of its own.

The bar at the top of the file holds its controls. The first three form a switcher, shown when the file has more than one view:

- **Edit source** (a code icon): the file as text, ready to edit. Press ⌘F on macOS or Ctrl+F on Windows and Linux to search it.
- **Preview rendered** (an eye icon), for Markdown and HTML files, which open in the preview first. An HTML preview runs no scripts, so it's a quick look, not a working page.
- **Changes** (two arrows), shown only when the file differs from your last saved version: "What changed since your last save". See [Undo one change](#undo-one-change).
- A speech-bubble button, shown while you have lines selected. Its tooltip names them, for example "Send lines 3–8 to the chat". It drops the lines into the message box of the session you're in, and never sends them for you.
- **Save**, with a dot on it while you have unsaved changes. The file's tab carries the same dot: "Unsaved changes".

The editor opens text files up to 1 MB. A bigger file says "Too large to edit here". A file that isn't text, like an image or a Word document, says "Binary file". To have the agent read a PDF or a Word document, attach it to a message in the [session view](/docs/session-view/) instead.

HappyVibe also tells the agent which files you have open, by name only, never their contents, so "this file" means what you're looking at.

### The Changes panel

The Changes panel is git, in plain words. Git is the tool that keeps your project's history: each saved version is a snapshot of every file, and you can always get back to one. HappyVibe keeps the everyday words at the top and git's own words in the corners, and every action prints the command it ran on the bottom line, like `$ git fetch --prune`, so you can see exactly what happened.

<!-- TODO(media): files-and-changes/changes-panel.png — The Changes panel with its changed files, one diff open and a drafted commit message -->

**The branch bar**, at the top:

- The branch button, showing the branch you're on (a branch is a separate line of work, so you can try something without disturbing the main version). Its tooltip reads "Switch branch, or make a new one". See [Switch branch, or make a new one](#switch-branch-or-make-a-new-one).
- **Fetch**: "Check the remote for new work, without changing your files". The remote is the copy of your project that lives somewhere else, such as GitHub. Fetch only looks; your files stay as they are.
- In a project that sits inside a bigger repository, a line reads "repo at … · showing …", because branches apply to the whole repository, not just your folder.

**The message box and the save button:**

- The message box reads "What did you change?". The message is how you'll recognise this version later.
- The wand, "Write it for me", drafts a message from your changes. It shows only when the **Commit message** job is on in [AI autofill](/docs/ai-autofill/) and a model is set up.
- The save button (an arrow rising out of a tray): its tooltip reads "Save a version". It stays greyed until you've written a message.
- **▾** beside it: "Other ways to save".

When there's nothing to save, the same spot shows the next useful step instead:

- **Publish branch**: your branch isn't on the remote yet. It sends it there for the first time, with every version saved on it.
- **Sync** with a number: your branch and the remote have drifted apart. Its tooltip counts both sides, for example "2 to send, 0 to receive".
- "All saved ✨" and "Everything is saved and up to date.": nothing to do.

**Open a pull request** appears when your branch has been published to GitHub, GitLab or Bitbucket and isn't the project's main branch. A pull request asks for your branch to be merged into the main one. See [Open a pull request](#open-a-pull-request).

**The file list.** A line on top sums it up, for example "Since your last save · 3 files · +12 −4". Changed files follow, grouped by folder, with files at the top of the project listed last as "project root". A group of files that are all new says "· new".

The letter before each file says what happened to it: **A** added, **M** modified, **D** deleted, **R** renamed, **U** new and not saved in any version yet. Hover over the letter to read the word. The green and red numbers count the lines added and removed.

Click a file to open it in a tab, then click its **Changes** button to see the lines that changed. A deleted file has nothing to open, so its changes unfold right in the list.

Hover over a file for its buttons:

- **stage** / **unstage** ("Stage this file" / "Unstage this file"): picks the files that go into your next version. Leave everything unstaged to save it all.
- **undo** ("Undo this file"): asks "Undo every change in this file?", then puts the file back the way it was at your last save.
- **discard**, on a new file ("Delete this new file"): asks "Discard this new file?" and warns "It will be deleted from your project. This can’t be undone." It skips the Trash.

**Stashed**, with a count, appears when you've parked some changes. Open it to see each one:

- **Restore** brings the changes back into your files.
- **Delete** asks "Delete this stash?", then removes it: "The changes in it are gone for good."

**History**, closed at first, lists your 20 most recent versions, each with its message, a short code and its date. Click one to see its files, under "Files in …". **Close** folds them away.

### When the panel can't do its job yet

- **The folder isn't using git.** The panel says "This project isn’t tracking versions yet" and offers **Start tracking**. See [Start tracking versions](#start-tracking-versions).
- **Git isn't installed.** The Changes icon isn't there at all. Your [workspace settings](/docs/first-session/#workspace-settings) say "git isn’t installed on this computer, so the Changes panel is hidden." and offer **Install**. On macOS, **Install** makes macOS offer to install its Command Line Tools, which include git. On Windows and Linux, it opens git's download page in your browser.
- **Git can't read the project.** The panel says "git couldn’t read this project." and shows git's own message, word for word. When there's a known fix, it shows the command under "Run this yourself to fix it:", with a **Copy** button. "HappyVibe won’t run this for you — it changes settings outside this project."

## Save a version

1. Open the Changes panel.
2. Look through the list. Click a file, then its **Changes** button, to read what changed.
3. Type a message in "What did you change?", or click the wand to have one drafted and edit it as you like.
4. Click the save button.

"Version saved." appears at the foot of the panel. Every changed file goes in, new ones too. To save only some files, stage them first: the save button then shows how many, for example "2/5", and its tooltip adds "(staged only)". New files have no stage button, so they wait for a save that includes everything.

If the save would sweep in folders nobody means to keep, like `node_modules`, the panel stops and asks: "This save includes files you probably didn’t mean to keep". **Add to .gitignore and save** leaves those folders out of this save and every later one. **Cancel** saves nothing.

### Other ways to save

Click **▾** beside the save button ("Other ways to save"):

- **Amend last commit**: "Replace the last commit instead of adding a new one". A commit is git's word for a saved version. Amend folds your changes and your new message into the version you saved last, instead of adding another. It needs a message, and there has to be a version to replace. The panel has no button to take an amend back, and if you'd already sent that version to the remote, the next **Sync** won't go through, so amend only a version you haven't sent yet.
- **Stash changes**: "Park these changes and come back to them". A stash sets your unsaved changes aside, new files included, and puts your files back to your last save. They wait under **Stashed** until you **Restore** them.

## Undo one change

Every change can be taken back, one piece at a time.

1. Open the file, then click its **Changes** button. Each block of changed lines has its own **Undo** button ("Undo just this hunk").
2. Click **Undo**. The app asks "Undo this change?" and names the file.
3. Click **Undo** again to confirm.

That block goes back to how it was at your last save, and the rest of the file stays as it is. If the file changed since you opened this view, nothing is touched and the app says so. Once the last change is undone, the file's view says "All changes undone" and goes back to the text.

To undo a whole file at once, use **undo** on its row in the Changes panel.

## Switch branch, or make a new one

1. Click the branch button in the branch bar. A list of your branches opens, with a ● next to the one you're on.
2. Click a branch to switch to it. Or type a name in "New branch…" and click **Add** to make one and switch to it. If a branch by that name exists already, the button reads **Go** and takes you there.

Your unsaved changes come along with you. When the other branch has its own version of the same files, the app asks "Switch to …?" instead: **Stash them and switch** parks your changes under **Stashed** first, and **Cancel** stays put.

To delete a branch, hover over it and click the bin. It asks "Delete …?": "This deletes the branch … from this computer only. Anything already pushed stays on the remote, and the files in your project don’t change." If the branch holds versions no other branch has, a second question warns that deleting "loses that work", and only **Delete it anyway** goes ahead. You can't delete the branch you're on, or the project's main branch; the bin's tooltip says why.

## Open a pull request

1. Publish your branch, then click **Open a pull request**. It reads "Writing it up…" while it drafts.
2. Your browser opens at the new pull request page of GitHub, GitLab or Bitbucket, with the title and description filled in. "Nothing is created until you press Create there."

HappyVibe never logs in anywhere for you and stores no password: you finish on the site, where you're already logged in. The description is drafted by the **Pull request description** job in [AI autofill](/docs/ai-autofill/). With that job off, or no model set up, it's your list of commits instead.

If you have changes that aren't saved yet, the app asks first, because they won't be part of the pull request: **Let me commit it first** puts you in the message box, and **Open it anyway** goes ahead without them.

## Start tracking versions

1. Open the Changes panel in a project that isn't using git yet, and click **Start tracking**.
2. The panel shows what it will do before it does anything: the command it will run, and a `.gitignore` (the list of files git should leave out) you can edit. It lists only the throwaway folders it actually found in your project.
3. Click **Start tracking**. "Nothing is saved yet — your first “Save a version” will be your first save."
4. Write a message under "Save your first version ✨" and click the save button.

HappyVibe refuses to start tracking your whole home folder, the top of a drive, or the root of your computer: "Pick a project folder instead."

## Worktrees

A worktree is "A second copy of this project’s files, on its own branch, so an agent can work there without touching what you have open here." To make one, open the branch menu and click **New worktree…** at the bottom, then type a branch name and click **Make worktree**. It lives in HappyVibe's own folder, "not inside your project, so it never shows up as changes to save", and you land in it straight away.

A worktree's Changes panel says "worktree of …" under the branch bar, and adds two ways to finish:

- **Merge into …**: brings the worktree's saved versions back into the project. "If they don’t apply cleanly nothing changes, and you’ll see why." Unsaved changes in the worktree don't come along. Afterwards the app offers to remove the worktree; you can keep working in it instead.
- **Remove worktree…**: "The folder goes." The branch stays, unless you pick **Remove and delete branch**. Sessions in the worktree move to Archived. If the worktree holds unsaved changes, it asks again before removing it.

If git still lists a worktree whose folder has gone, the project's panel offers **Clean up a stale worktree**. Confirm with **Clean up** to tidy the list: "Nothing on disk is deleted."

## During a session

- **The agent keeps working while you look.** Browsing, reading changes and saving a version never get in its way.
- **Some actions wait for it.** Switching branches, stashing, syncing, undoing, discarding and starting tracking would change files under the agent's feet, so while a session in this project is working, the panel says "Anything that changes files waits until it finishes." and names the session. Try again when the turn ends.
- **The panel catches up at the end of a turn.** It doesn't refresh on every edit while the agent works; the list and the badge update once its turn ends. The files panel updates as files appear.
- **Open files follow along.** If the agent edits a file you have open, the tab reloads. If you have unsaved edits in it, you choose: "This file changed on disk while you have unsaved edits." with **Reload from disk** or **Keep mine**. If the file was deleted, your edits are kept, and saving puts the file back.
- **The buttons here are yours.** The agent has no way to press them. When it runs git commands of its own, each one goes through the [approval dialog](/docs/approve-a-tool-call/) like any other command, and a few risky ones, like force-pushing, come with rules already set on [Permissions](/docs/permissions/).


## Related

- [Your first session](/docs/first-session/#changed-your-mind-rewind): rewind a conversation, and often your files, to before a message.
- [AI autofill](/docs/ai-autofill/): the jobs that draft commit messages and pull requests.
- [Permissions](/docs/permissions/): the git rules the agent's commands meet.
- [Keyboard shortcuts](/docs/keyboard-shortcuts/): change the keys that open these panels.
