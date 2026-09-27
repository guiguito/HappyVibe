---
title: Plugins
description: Browse plugins, see exactly what each one brings, and install only the parts you want.
---

A plugin is someone else's good idea, packaged: skills, prompts and tools for the agent, in a few clicks. HappyVibe only lists plugins whose every part goes through your permissions, and the skills and prompts you install stay off until you turn them on.

## Where to find it

**Abilities** → **Plugins** in the sidebar.

## What's on the screen

### Marketplace

"Every plugin here was checked against the permission gate before the release, so anything listed installs. Nothing installs on its own — you pick what comes in, and skills arrive switched off."

<!-- TODO(media): plugins/plugins-marketplace.png — The Marketplace: search box, category chips and the card grid -->

- **Installed** lists the plugins you've installed, with what each one brought and a **Remove** button. It appears once you've installed one.
- **Search plugins…** filters by name and description.
- The category chips narrow the list to one kind of plugin. **All** shows everything.
- A short line under the chips says when the list was last checked. The list comes with the app, so a plugin added since then appears in a later release.
- Each card shows the plugin's name, its author's description, what's inside (skills, prompts, MCP servers) and its category. A plugin you already have is tagged "installed".
- A button at the bottom, like **Show more (24 left)**, loads the next page of cards.

The descriptions are the authors' own words, shown as they wrote them.

### What a plugin can contain

A plugin can bring three kinds of things. Each has its own page once it's installed:

- **Skills**: instructions the agent loads when a task calls for them. See [Skills](/docs/skills/).
- **Prompts**: ready-made messages you start with `/name`. See [Prompts](/docs/prompts/).
- **MCP servers**: programs that give the agent more tools. See [MCP](/docs/mcp/).

## Install a plugin

1. Click a card. HappyVibe downloads the plugin and shows you what's inside before anything is installed.
2. Read the dialog. It lists the plugin's **Skills**, **Prompts** and **MCP servers**, each with a tick box. Everything installable starts ticked.
3. Untick what you don't want. A skill with a ⚠ warning tells you why; one that can't be installed has its box greyed out. A skill that bundles scripts says how many.
4. Read the note above the buttons: "Installing only copies things in — skills and prompts arrive switched off, and MCP servers arrive unconnected — so nothing the agent can do changes yet."
5. Click **Install**. The button counts what you ticked, like **Install 3 items**. Or click **Cancel**, and nothing is installed.

The dialog also names the exact version you're getting: "Installing from the commit this was verified at:", followed by a short code that pins the exact version (or "the marketplace snapshot"). What was checked is exactly what you get.

### When a plugin ships more than HappyVibe installs

Some plugins include parts HappyVibe doesn't support. The dialog then warns you before you install: "**This plugin ships more than HappyVibe installs.** Skills, top-level prompts and MCP servers come in — so" … "will not be installed, and behaviour may differ from the author's setup." In the gap it names what's left out and how many.

The rest still installs normally. It just may not work exactly as the plugin's author intended.

## Turn it on

The dialog doesn't close after installing. It turns into the next step, and says: "Nothing from it is active yet — one click does it:"

1. Click **Enable**, for example **Enable 2 skills · 1 prompt**. It switches on every skill and prompt the plugin installed. The button changes to **Enabled**, and the dialog says "Active now."
2. For each MCP server, click **Connect**, followed by the server's name. HappyVibe checks the server answers, and if it needs you to sign in, your browser opens. The button then says the server is connected.
3. Click **Done**.

You can skip either step and come back later. Once the dialog is closed, the same buttons wait in a green banner above the cards. Or turn things on one at a time on [Skills](/docs/skills/), [Prompts](/docs/prompts/) and [MCP](/docs/mcp/), where you can also fine-tune them.

## Remove a plugin

1. Find it under **Installed**.
2. Click **Remove**.

HappyVibe removes every skill, prompt and MCP server that plugin brought, and nothing else. It happens right away, with no second check. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)). You can install it again any time.

## During a session

A plugin doesn't appear in a session as itself. What it brought does: its skills in the session's 🧠 skills chip, its prompts when you type `/` in the message box, and its MCP servers' tools as ordinary tool cards. Every one of those tool calls goes through your rules on [Permissions](/docs/permissions/) like any other.

## Related

- [Skills](/docs/skills/): review and turn on the skills a plugin brings.
- [Prompts](/docs/prompts/): the prompts a plugin brings.
- [MCP](/docs/mcp/): connect and manage a plugin's servers.
- [Permissions](/docs/permissions/): what the agent may do without asking.
