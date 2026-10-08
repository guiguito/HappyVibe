---
title: Skills
description: Add skills the agent can load, review each one before it runs, and see what it costs.
---

A skill teaches the agent how to do one job your way. It's know-how the agent picks up when a task calls for it: a short instruction file (`SKILL.md`), sometimes with helper files and scripts. The skills that come with HappyVibe start switched on. Anything else loads only once you've picked or approved it, and if a skill changes after that, it waits for you to look again.

## Where to find it

**Abilities** → **Skills** in the sidebar.

## What's on the screen

At the top, one switch turns skills on or off for the whole app. It's the same switch as the **Skills** row on [Built-in tools](/docs/built-in-tools/#skills). While it's off, it says "Skills are off — no skill loads in any session." Your conversation stays: open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

### Global skills

Global means in every workspace. The section says: "Reviewed and gated. Workspace-specific skills are managed in each workspace's settings." A workspace's own skills are in its [workspace settings](/docs/first-session/#workspace-settings), not on this screen.

The buttons along the top add skills: **+ New skill**, **Import folder**, **Import from Git URL** and **Link a directory**. See [Add a skill](#add-a-skill).

When something is waiting for you, a banner says so, for example "2 skills need review before they can run."

### The list

Each row shows the skill's status, its name, where it came from, and its description.

The status is one of:

- **active**: approved and switched on. The agent can load it.
- **disabled**: approved, but switched off.
- **needs review**: new, or changed since you approved it. It won't load until you approve it.
- **error**: the skill can't be loaded, for example because it has no description.

Where it came from is one of:

- **bundled**: comes with HappyVibe, already switched on.
- **managed**: one you added, kept in HappyVibe's own skills folder. Skills from a [plugin](/docs/plugins/) land here too, switched off.
- **linked**: lives in a directory you linked, which belongs to another tool. HappyVibe reads it where it is.

Two more tags can appear:

- **includes 2 scripts**: the skill bundles programs the agent may run. Running one still goes through your [Permissions](/docs/permissions/), like any command.
- **!`cmd` not run**: the skill wanted to run a command before loading. HappyVibe doesn't run it, so the agent just sees the command's text. Hover the tag, or open the skill, to read why: "the model sees the literal command text instead of its output."

## Add a skill

There are four ways in.

### Create one with the agent

1. Click **+ New skill**.
2. HappyVibe opens a session, making one if none is open, and starts the skill creator there.
3. Answer its questions. It writes the skill with you.

### Import a folder

1. Click **Import folder** and pick a skill folder, or a folder of skills.
2. In **Import skills**, every skill starts ticked. Untick any you don't want. **Select all** and **Deselect all** help with long lists.
3. Look at each skill's description, and whether it includes scripts.
4. Click **Import** (it counts what's ticked, like **Import 3**). They're copied into HappyVibe's skills folder.

### Import from a Git URL

1. Click **Import from Git URL**.
2. Paste the address of a public repo: "Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which skills to import." The chips under the box, **anthropics/skills** and **badlogic/pi-skills**, fill in two collections to start from.
3. Click **Fetch**.
4. Untick any skills you don't want, and look at each one's description and whether it includes scripts.
5. Click **Import** (it counts what's ticked, like **Import 3**).

Imported skills are approved and switched on as they come in, because you've just picked them from the list: "They're approved on import (as global skills)." That's why the look in the step before **Import** matters.

### Link a directory

1. Click **Link a directory**.
2. Pick a folder of skills another tool keeps, for example your skills folder from another agent.

Linked skills aren't copied. HappyVibe reads them where they are, and each one shows **needs review** until you approve it.

## Review and approve a skill

Click any skill to open it. You see:

- Its name, description, status and source.
- What it costs in tokens (the unit models read and bill text in, roughly four characters), like "~40 tok always · ~900 tok when loaded". See [What a skill costs](#what-a-skill-costs).
- A warning if it bundles scripts: "The model may run it — review before approving." Running one still goes through your [Permissions](/docs/permissions/).
- Where it came from, when HappyVibe knows.
- The `SKILL.md` itself, rendered, and the list of files that come with it.

Then:

1. Read it. This is what the agent will be told when it loads the skill.
2. Click **Approve**. The skill turns **active**.

If a skill you approved changes afterwards, it goes back to **needs review** and stops loading. Open it and click "Content changed since you approved — review the diff" to see exactly what changed, then **Re-approve** if you're happy with it.

The same window lets you:

- **Disable** an active skill, or **Enable** a disabled one.
- **Delete** a skill you added, after you confirm. The folder is removed from disk. Skills that come with HappyVibe can't be deleted; disable them instead.
- **Unlink** a linked directory. HappyVibe stops reading the whole directory, and "No files are deleted — the directory belongs to another tool."
- **Promote to global**, when you open a workspace's own skill from its workspace settings, to copy it here so every workspace can use it.
- **Close** to leave it as it is.

## What a skill costs

Everything the agent is shown sits in its context, what it can see on every turn, measured in tokens ([more on context](/docs/first-session/#context-what-the-agent-can-see)). A skill costs in two steps, and the skill window shows both:

- **always**: its name and description, paid on every turn, so the agent knows the skill exists.
- **when loaded**: the rest of `SKILL.md`, paid only once the agent actually loads the skill.

So a skill you never use costs just its one-line card. Switch off the ones you don't need, and even that goes.

## During a session

- The session's top bar shows a 🧠 chip, like "🧠 1/4 skills": how many skills the agent has used so far, out of the ones loaded for this session. Click it to see the list, with "used" beside the ones the agent has opened.
- To load a skill yourself, type `/skill:` in the message box and pick one. Each entry reads "Load this skill".
- When the agent loads a skill, a tool card shows it, often reading "Using skill:" followed by the skill's name.

A workspace can turn a global skill off for itself in its workspace settings. Approving a skill always happens here.

## Related

- [Plugins](/docs/plugins/): install skills together with prompts and MCP servers.
- [Prompts](/docs/prompts/): ready-made messages, reviewed the same way.
- [Agent tools](/docs/agent-tools/): every tool the agent can call.
- [Permissions](/docs/permissions/): the scripts a skill runs still go through your rules.
