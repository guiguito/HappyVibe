---
title: Memory
description: Tell the agent something once and it remembers next time. Read, edit and forget what it keeps.
---

Tell the agent something once, and it remembers next time. It asks before it saves anything, and this screen shows you every note it keeps: "What the agent remembers about you, across every workspace."

## Where to find it

**Abilities** → **Memory** in the sidebar.

## What's on the screen

### Global memories

"These apply in every project." These are notes about you: how you like to work, things you've corrected. Notes about a single project live in that project's own settings, and the line under the list links there.

The agent keeps each set of notes as ordinary text files on this computer. Nothing is sent anywhere or shared with anyone you work with.

### The cost line

The first line reads, for example, "Costs ≈ 120 tokens every turn. Memories open on demand. 12 of 100 used."

A **token** is a small piece of text, roughly four characters. On every turn the agent is shown a one-line summary of each note, and that's all memory costs until it opens a note, which it does only when the summary looks relevant. The number is the same estimate the session's context panel shows. Each set holds up to 100 notes; when one is full, the agent has to merge or drop a note before it can add one.

### The list

Each row shows what kind of note it is, its name, how long ago it changed, and its summary. The kinds are:

- **About you**
- **Something you corrected**
- **About this project**
- **A pointer to something**

Once you have more than four notes, a **Search memories** box appears above the list.

With no notes yet, the screen says: "No memories yet. Tell the agent “remember that …”, or it will offer to save what it learns from your corrections. Every save asks you first."

### Forget all… and Import from Claude Code

Under the list sit **Forget all…** and **Import from Claude Code**. Both are covered below.

If notes are left over from projects you no longer have open, a banner says how many, with a button to forget each folder's notes.

### How memory works

The disclosure at the bottom explains the rules in full. Two worth knowing: notes are hints, not facts, so the agent is told to check anything that might have changed before acting on it. And it won't save anything that looks like a password, a key or a token; that's refused with a reason.

## How a memory gets saved

You say "remember that …", or the agent offers to save something it learned from a correction. Either way, nothing is saved until you say yes.

1. The agent asks to save. A dialog opens: "The agent wants to remember this".
2. Read the note itself: its **Name**, **Kind**, **Scope** and **Summary**, then what it remembers. The scope says where it applies: "About you, in every project" or "About this project only".
3. If it would replace a note you already have, the title reads "The agent wants to REPLACE this memory", and you see **what changes** instead of the whole text.
4. Click **Allow** to save it, or **Deny** to keep it out.

<!-- TODO(media): memory/memory-save-prompt.png — In a session, the approval dialog for saving a memory, with the memory and what changes -->

Forgetting asks the same way: "The agent wants to forget this". Opening a note to read it never asks, since you can read every one on this screen anyway. More on the dialog in [Approve a tool call](/docs/approve-a-tool-call/).

## Read, edit or forget a memory

1. Click a note in the list. It opens in full, with where it came from, for example "Saved by the agent in “Fix the login bug”", or "Edited by you, or imported".
2. To change it, click **Edit**. You can change the **Summary** ("this is the line the agent sees every turn", up to 150 characters) and **What it remembers**. Click **Save**, or **Cancel** to leave it as it was.
3. To delete it, click **Forget**. The app checks: "Forget “name”?" Click **Forget it**, or **Keep it** to change your mind.

## Forget everything

1. Click **Forget all…** under the list.
2. The app asks, for example, "Forget all 12 global memories? This cannot be undone."
3. Click **Forget them all**, or **Keep them**.

This only clears the set you're looking at. A project's own notes stay until you clear them in that project's settings.

## Import from Claude Code

If you've used Claude Code on this computer, you can bring its memories across.

1. Click **Import from Claude Code**. The dialog explains: "Memories are copied in, never linked. Anything already here with the same name is skipped and named."
2. The memories are grouped by the project folder they came from. Untick any you don't want.
3. For each folder, pick where they go: **Into global memory**, or **Into this project** when a project is open. "The destination applies to a whole folder."
4. Click **Import selected**. The dialog tells you how many came in, and names any it skipped, with why.
5. Click **Done**.

If there's nothing to import, it says "No Claude Code memories found on this computer."

## Turn memory off

Memory has no switch on this screen. It lives on [Built-in tools](/docs/built-in-tools/), as **Memory — 3 tools**. There you can also read the memory policy the agent follows and add your own lines to it. When it's off, this screen says "Memory is turned off for this app." Your notes stay where they are.

To turn it off for one project only, untick **Use memory in this project** in that project's settings. Global memories still apply there.

## During a session

- A save or a forget waits for you in an approval dialog, showing the note itself.
- The session's context panel counts memory's cost, with the same number as this screen.

## Related

- [Built-in tools](/docs/built-in-tools/): memory's on/off switch and its policy.
- [Approve a tool call](/docs/approve-a-tool-call/): how the approval dialog works.
- [System prompt](/docs/system-prompt/): standing instructions for every session, when you'd rather write them yourself.
