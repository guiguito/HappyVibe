---
title: Prompts
description: Save the prompts you type again and again, then send any of them with /name.
---

Write a good prompt once, then reuse it with a few keystrokes. The screen puts it this way: "Reusable prompts you type as /name. Reviewed and gated, like skills."

A prompt is a Markdown file. When you type `/name`, its text goes into your message, and that's all it does: "Typing /name expands the file into your message — nothing runs on its own."

## Where to find it

**Abilities** → **Prompts** in the sidebar.

## What's on the screen

### Global prompts

Global (in every workspace) prompts work everywhere, unless a workspace turns one off for itself in its [workspace settings](/docs/first-session/#workspace-settings). Prompts that belong to one project live there too: "Project prompts are managed in each workspace's settings."

At the top are three ways to bring prompts in:

- **Import folder**: pick a folder on your computer and choose which prompts in it to copy in.
- **Import from Git URL**: fetch prompts from a "Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which prompts to import."
- **Link a directory**: point at a folder of prompts that another tool keeps. HappyVibe reads the files where they are and never copies them.

If a prompt is waiting for you, a banner says so, for example "1 prompt needs review before it can run."

### The list

Each row shows the prompt's `/name`, what to type after it (if the prompt says), its description, and a few badges:

- **Status**: **active**, **disabled**, **needs review**, or **shadowed**.
- **Where it came from**: **managed** (kept in HappyVibe's own prompts folder, where imports land), **bundled** (ships with HappyVibe), or **linked** (read from a linked directory).
- **reserved name**: a built-in command already uses this name, so this prompt can never run. Rename its file to use it.
- **!`bash` not run**: the prompt tries to run a command as it expands. That isn't supported, so the command shows up in your message as plain text, and nothing runs.

With no prompts yet, the list says: "No prompts yet. Drop a .md file into the managed prompts directory, or link an existing commands directory to review it here."

The managed prompts directory is the `pi-agent/prompts` folder inside HappyVibe's app-data folder. On macOS that's `~/Library/Application Support/HappyVibe/pi-agent/prompts`. On Windows and Linux, look in the `HappyVibe` folder where your system keeps app data.

### A prompt's details

Click a row to open it. You see the prompt's full text, where it came from, and the note "costs nothing until you type it": a prompt takes no room in the agent's [context](/docs/first-session/#context-what-the-agent-can-see) (what the model can see) until you send it.

The buttons at the bottom depend on the prompt's state: **Approve** (or **Re-approve**), **Disable**, **Enable**, and **Delete** (or **Unlink** for a linked prompt). Bundled prompts can't be deleted, only disabled.

## Add a prompt

1. Click **Import folder** and choose the folder, or click **Import from Git URL**, paste the repo's address, then click **Fetch**.
2. In **Import prompts**, tick the prompts you want. **Select all** and **Deselect all** help with a long list.
3. Click **Import** (the button shows how many you ticked). Prompts you import this way are approved straight away: "They're approved on import (as global prompts)."

A prompt's name is its file name without `.md`. To rename a prompt, rename its file.

## Review and approve a prompt

Nothing new reaches your sessions until you've read it. A prompt from a linked directory, or one dropped into the prompts folder by hand, starts as **needs review**.

1. Click the prompt's row.
2. Read the text.
3. Click **Approve**.

If an approved prompt's file changes later, it goes back to **needs review** and stops working until you look again. The details show "Content changed since you approved — review the diff". Click it to see exactly what changed, then click **Re-approve**.

## Turn a prompt off or remove it

1. Click the prompt's row.
2. Click **Disable** to turn it off. **Enable** brings it back.
3. Or click **Delete** to remove the file. You're asked to confirm first.

For a linked prompt the button reads **Unlink**. It stops HappyVibe reading the whole directory, so every prompt from it disappears together. "No files are deleted — the directory belongs to another tool."

An approval, an import, or a prompt turned on or off never lands in the middle of a reply. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

## During a session

Type `/` at the start of the message box. A menu lists your active prompts, each with its hint and description, next to your skills. Pick one, or keep typing its name.

If the prompt takes input (most show a hint under the name in the menu), type it after the name. A prompt with no place for input ignores what you add. An `@` file mention in that input becomes the file's path in your project, so the prompt can point the agent straight at it.

The prompt's text is part of your message, so the agent reads it like anything else you write. Every tool call it makes after that still goes through your [permission rules](/docs/permissions/).

## Related

- [Skills](/docs/skills/): instructions the agent loads by itself when a task needs them. Prompts only arrive when you type them.
- [Agents](/docs/agents/): hand a whole task to a subagent instead.
- [Permissions](/docs/permissions/): what the agent may do after it reads your prompt.
- [System prompt](/docs/system-prompt/): the standing instructions every session starts with.
