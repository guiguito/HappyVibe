---
title: MCP
description: Connect MCP servers so the agent can use their tools, like a real browser or your issue tracker, in every workspace.
---

Give the agent new tools by plugging in a server. An MCP server is a small program, on your computer or online, that hands the agent extra tools: a browser it can drive, your Notion pages, your database. MCP (Model Context Protocol) is simply the shared standard they speak.

This screen holds the global (in every workspace) servers: "External MCP servers, available in every workspace. To add one for a single project instead, open that workspace's own settings." See [workspace settings](/docs/first-session/#workspace-settings) for how to open them.

## Where to find it

**Abilities** → **MCP** in the sidebar.

## What's on the screen

### Add a server

"Recognised Model Context Protocol servers, ready to install." The list is part of the app, so browsing it doesn't go online. Every server in it still asks first where your rules say so: "Every one still goes through your permission rules."

The category chips along the top (**All**, then **Code**, **Productivity**, **Data**, **Automation**, **Browser** and **Design**) narrow the grid. Each card shows the server's name, one line about what it does, and its category. Two badges can appear on a card:

- **installed**: you already have this server. The card can't be clicked until you remove it from your servers below.
- **needs Node**: this server runs on your computer through Node, a free program that runs JavaScript apps. HappyVibe couldn't find it on your computer. Install Node first (from nodejs.org), or the server will fail to start.

### Your servers

"Connected Model Context Protocol servers, and adding more." Each row shows the server's name, a **global** badge, a status badge, and underneath, the exact address or command it runs.

The status badge is HappyVibe checking the server for you:

- **checking…**: HappyVibe is connecting to it now.
- A tool count, like **5 tools**: it answered. Click the count to see every tool and what it does.
- **needs auth**: it wants you to sign in. Click **Authenticate**.
- **failed**: it didn't answer. Hover the badge to read why.
- **—**: no check has run yet.

A **direct** badge means you chose **Expose tools directly** for that server.

The buttons on each row:

- **Authenticate**: sign in, when the badge says **needs auth**.
- **Log out**: sign out of a connected online server.
- **Reconnect**: check the server again.
- **Edit**: change its name, command, address or settings.
- **Remove**: take it off the list. It goes straight away, so the catalog card becomes clickable again.

With no servers yet, the list says "No MCP servers yet" and "Install one from the catalog above, or add your own."

:::note[What the badge means]
In short: the badge is the app's own check, not your session's.

"This badge is HappyVibe's own probe: the app connects to the server itself, checks that it answers, and lists its tools. Your agent's connection is a different one, made when a session starts. So a red badge does not mean the running session lost those tools, and a green one is not proof that it has them. Changing a server restarts your sessions so they pick it up."
:::

## Add a server from the catalog

1. Click a card, for example **Playwright**.
2. Read the dialog. It asks "Add Playwright?", says what the server does, and links to its documentation.
3. Look under **What will be added**. It shows exactly what gets written: the server's name, where it goes ("your global MCP config"), and the command or address it will run. Nothing is written until you click the button at the bottom.
4. If the server needs a key or a token, paste it into the field. The hint under the field says where to get it. Keys are "stored encrypted, never written to the config file."
5. Click **Add Playwright** (the button carries the server's name).
6. HappyVibe connects straight away. When it works, you see "Connected to Playwright" and how many tools it found, with the list. Click **Done**.

<!-- TODO(media): mcp/mcp-add — Pick Playwright, Add, and it connects: "Connected to Playwright" with the number of tools discovered -->

If it can't connect, the dialog shows "Could not connect to" the server and the reason. Click **Retry**, or **Close** and fix it with **Edit**.

## Sign in to a server

Some online servers ask you to sign in with your account instead of a key. The dialog tells you before you add one: "You'll sign in through your browser after adding it."

1. Add the server, or click **Authenticate** on its row.
2. The dialog reads "Connecting to" the server and "If this server needs you to sign in, your browser will open — approve access, then return to HappyVibe."
3. Approve access in your browser.
4. Come back to HappyVibe. You see "Connected to" the server and its tools.

To stop, click **Cancel**. The server stays on the list as **needs auth** until you sign in.

## Add your own server

For a server that isn't in the catalog:

1. Click **Add server** in **Your servers**.
2. Give it a **Name**: letters, digits, `-` and `_` only.
3. Pick a **Type**:
   - **Command (stdio)**: a program on your computer. Enter the **Command**, for example `npx -y @modelcontextprotocol/server-github` (copy it from the server's own instructions), and any **Environment (KEY=value per line)**.
   - **Remote URL (HTTP)**: an online server. Enter its **URL**.
4. Tick **Expose tools directly** only if you want each of this server's tools to be its own tool for the agent. It "costs context tokens per tool": every tool's description takes up tokens (the unit models read and bill text in, roughly four characters) of the agent's [context](/docs/first-session/#context-what-the-agent-can-see) on every turn.
5. Click **Save**. An online server connects, and asks you to sign in if it needs to, right away.

## During a session

A server change never lands in the middle of a reply. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

In a session's top bar, a 🔌 chip shows how many of your servers answered HappyVibe's check, for example **2/3 MCP**. It lists your global servers plus the ones added for this workspace. Click it to see each server with its state, and **Manage…** to come back to this screen.

When the agent wants to use a server's tool, the call goes through your [permission rules](/docs/permissions/), the same as every other tool call. If the agent tries to add a server itself, it asks you first and names the address and where it would be saved. If it tries to sign in to one, it asks you first and names the server.

## Related

- [Permissions](/docs/permissions/): decide which server tools run on their own and which ask first.
- [Plugins](/docs/plugins/): some plugins bring MCP servers with them.
- [Built-in tools](/docs/built-in-tools/): the tools the agent has without any server.
- [Audit log](/docs/audit-log/): every call the agent made, and what you decided.
