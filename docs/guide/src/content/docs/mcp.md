---
title: MCP
description: Connect MCP servers so the agent can use their tools, like a real browser or your issue tracker, in every workspace.
---

Give the agent new tools by plugging in a server. An MCP server is a small program on your computer, or a service online, that offers the agent extra tools through a shared standard called the Model Context Protocol: a browser it can drive, your Notion pages, your database.

This screen holds the servers every workspace can use: "External MCP servers, available in every workspace. To add one for a single project instead, open that workspace's own settings."

## Where to find it

**Abilities** → **MCP** in the sidebar.

## What's on the screen

### Add a server

"Recognised Model Context Protocol servers, ready to install." The list is part of the app, so browsing it doesn't go online. And "Every one still goes through your permission rules."

The category chips along the top (**All**, then **Code**, **Productivity**, **Data**, **Automation**, **Browser** and **Design**) narrow the grid. Each card shows the server's name, one line about what it does, and its category. Two badges can appear on a card:

- **installed**: you already have this server. The card can't be clicked until you remove it from your servers below.
- **needs Node**: this server runs on your computer through Node, and HappyVibe couldn't find Node. Install Node first, or the server will fail to start.

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

Changed your mind halfway? Click **Cancel**. The server simply stays on the list as **needs auth**, ready for when you are.

## Add your own server

For a server that isn't in the catalog:

1. Click **Add server** in **Your servers**.
2. Give it a **Name**: letters, digits, `-` and `_` only.
3. Pick a **Type**:
   - **Command (stdio)**: a program on your computer. Enter the **Command**, for example `npx -y @modelcontextprotocol/server-github`, and any **Environment (KEY=value per line)**.
   - **Remote URL (HTTP)**: an online server. Enter its **URL**.
4. Tick **Expose tools directly** only if you want each of this server's tools to be its own tool for the agent. It "costs context tokens per tool": every tool's description takes up room in the conversation on every turn.
5. Click **Save**. An online server connects, and asks you to sign in if it needs to, right away.

## During a session

Open sessions don't pick up a server change in the middle of a reply. Each one restarts once it's idle and comes back with your servers.

In a session's top bar, a 🔌 chip counts how many of the session's servers are connected, for example **2/3 MCP**. It lists your global servers plus the ones added for this workspace. Click it to see each server with its state, and **Manage…** to come back to this screen.

When the agent wants to use a server's tool, the call goes through your [permission rules](/docs/permissions/), the same as every other tool call.

## Related

- [Permissions](/docs/permissions/): decide which server tools run on their own and which ask first.
- [Plugins](/docs/plugins/): some plugins bring MCP servers with them.
- [Built-in tools](/docs/built-in-tools/): the tools the agent has without any server.
- [Audit log](/docs/audit-log/): every call the agent made, and what you decided.
