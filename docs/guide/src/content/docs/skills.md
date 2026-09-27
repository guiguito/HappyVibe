---
title: Skills
description: Add skills the agent can load, review each one before it runs, and see what it costs.
---

A skill is a set of instructions the agent loads when a task calls for it: a `SKILL.md` file, sometimes with files and scripts beside it. This screen holds your "Skills the agent can load." Nothing loads until it's approved, and a skill that changes after you approved it waits for another look.

## Where to find it

**Abilities** → **Skills** in the sidebar.

## What's on the screen

### Global skills

"Reviewed and gated. Workspace-specific skills are managed in each workspace's settings."

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
- **workspace**: lives inside one project. You manage these in that project's settings.

Two more tags can appear. "includes 2 scripts" means the skill bundles programs the agent may run. "!`cmd` not run" means the skill expects a command to run before it loads. HappyVibe doesn't run it, so "the model sees the literal command text instead of its output."

## Add a skill

There are four ways in.

### Create one with the agent

1. Click **+ New skill**.
2. HappyVibe opens a chat session, making one if none is open, and starts the skill creator there.
3. Answer its questions. It writes the skill with you.

### Import a folder

1. Click **Import folder** and pick a skill folder, or a folder of skills.
2. In **Import skills**, tick the ones you want. **Select all** and **Deselect all** help with long lists.
3. Click **Import**. They're copied into HappyVibe's skills folder.

### Import from a Git URL

1. Click **Import from Git URL**.
2. Paste the address of a public repo: "Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which skills to import." The chips under the box, **anthropics/skills** and **badlogic/pi-skills**, fill in two collections to start from.
3. Click **Fetch**.
4. Tick the skills you want, then click **Import**.

Imported skills are approved as they come in, because you've just picked them from the list: "They're approved on import (as global skills)." Before you import, look at each skill's description and whether it includes scripts.

### Link a directory

1. Click **Link a directory**.
2. Pick a folder of skills another tool keeps, for example your skills folder from another agent.

Linked skills aren't copied. HappyVibe reads them where they are, and each one shows **needs review** until you approve it.

## Review and approve a skill

Click any skill to open it. You see:

- Its name, description, status and source.
- What it costs, like "~40 tok always · ~900 tok when loaded". See [What a skill costs](#what-a-skill-costs).
- A warning if it bundles scripts: "The model may run it — review before approving."
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
- **Promote to global**, when you open a project's skill from that project's settings, to copy it here so every workspace can use it.
- **Close** to leave it as it is.

## What a skill costs

The agent reads its instructions in **tokens**, small pieces of text of roughly four characters each. Everything it's shown on a turn is its **context**, and all of it is sent again on every turn.

A skill costs in two steps, and the skill window shows both:

- **always**: its name and description, paid on every turn, so the agent knows the skill exists.
- **when loaded**: the rest of `SKILL.md`, paid only once the agent actually loads the skill.

So a skill you never use costs only its one-line card. Disable the ones you don't need to take even that away.

## During a session

- The session's top bar shows a 🧠 chip, like "🧠 1/4 skills": how many skills this session has loaded, and how many it has used so far. Click it to see the list, with "used" beside the ones the agent has opened.
- To load a skill yourself, type `/skill:` in the composer and pick one. Each entry reads "Load this skill".
- When the agent loads a skill, a tool card shows it, often reading "Using skill:" followed by the skill's name.

A project can switch a global skill off for itself in that project's settings. Approving a skill always happens here.

## Related

- [Plugins](/docs/plugins/): install skills together with prompts and MCP servers.
- [Prompts](/docs/prompts/): ready-made messages, reviewed the same way.
- [Agent tools](/docs/agent-tools/): every tool the agent can call.
- [Permissions](/docs/permissions/): the scripts a skill runs still go through your rules.
