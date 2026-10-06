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
- A tool count, like **5 tools**: it answered. Click the count to see the name of every tool.
- **needs auth**: it wants you to sign in. Click **Authenticate**.
- **failed**: it didn't answer, or its settings have a mistake. Hover the badge to read why.
- **—**: no check has run yet.
- **off**: a plugin installed this server and it's switched off. Sessions can't use it until you click **Connect**, and HappyVibe doesn't check it either.

In a workspace's own settings, a server can also show **overridden**: it has the same name as one of your global servers. The global one wins, so sessions use that one.

A **direct** badge means you chose **Expose tools directly** for that server.

HappyVibe checks the servers added for a workspace when you open this screen or that workspace's settings, not when the app starts. Checking a server means starting it, so it waits until you look.

The buttons on each row:

- **Authenticate**: sign in, when the badge says **needs auth**.
- **Log out**: sign out of a connected online server.
- **Reconnect**: check the server again. On an **off** server this button reads **Connect**: HappyVibe checks the server answers and signs you in if it needs to. Once it's connected, your sessions can use it.
- **Edit**: change its name, command, address or settings.
- **Remove**: take it off the list, after you confirm. The catalog card becomes clickable again.

With no servers yet, the list says "No MCP servers yet" and "Install one from the catalog above, or add your own."

:::note[What the badge means]
In short: the badge is the app's own check, not your session's.

"This badge is HappyVibe's own check: a separate copy of the agent connects to the server, checks that it answers, and lists its tools. Your agent's connection is a different one, made when a session starts. So a red badge does not mean the running session lost those tools, and a green one is not proof that it has them. Changing a server restarts your sessions so they pick it up."
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
2. The dialog reads "Connecting to" the server. If it needs you to sign in, your browser opens and the dialog says "Waiting for sign-in in your browser…".
3. Approve access in your browser. Closed the tab by mistake? Click **Open the sign-in page again**.
4. Come back to HappyVibe. You see "Connected to" the server and its tools.

To stop, click **Cancel**. The sign-in stops right away, and the server stays on the list as **needs auth** until you sign in.

Your sign-ins are saved in a file in HappyVibe's own data folder, inside your user account. Nothing goes in your system's keychain, so MCP never asks for your password.

:::caution[Signed in before this version?]
MCP sign-ins used to live in your system's keychain. HappyVibe doesn't read them any more, so each server asks you to sign in once again. The old entries stay there, unused. To delete them, search your keychain for `pi-mcp-adapter.oauth` (on macOS, in **Keychain Access**; on Windows, in **Credential Manager**; on Linux, in your keyring app, such as **Passwords and Keys**) and delete what it finds.
:::

## Add your own server

For a server that isn't in the catalog:

1. Click **Add server** in **Your servers**.
2. Give it a **Name**: letters, digits, `-` and `_` only.
3. Pick a **Type**:
   - **Command (stdio)**: a program on your computer. Enter the **Command**, for example `npx -y @modelcontextprotocol/server-github` (copy it from the server's own instructions), and any **Environment (KEY=value per line)**.
   - **Remote URL (HTTP)**: an online server. Enter its **URL**.
4. Tick **Expose tools directly** only if you want the agent to see every tool of this server on every turn. It "costs context tokens per tool": every tool's description takes up tokens (the unit models read and bill text in, roughly four characters) of the agent's [context](/docs/first-session/#context-what-the-agent-can-see). Left unticked, the agent sees only a one-line note about the server, and looks up its tools when it needs them.
5. Click **Save**. An online server connects, and asks you to sign in if it needs to, right away.

## During a session

A server change never lands in the middle of a reply. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

In a session's top bar, a 🔌 chip shows how many of your servers answered HappyVibe's check, for example **2/3 MCP**. It lists your global servers plus the ones added for this workspace. Click it to see each server with its state, and **Manage…** to come back to this screen.

When the agent needs a server's tool, it first searches for it: you see a "Searching tools:" card with what it looked for. Searching doesn't ask you unless one of your rules says so. Then the call itself goes through your [permission rules](/docs/permissions/), the same as every other tool call.

The approval dialog names the server and the tool, for example "MCP → linear: get_issue". When the server describes its tool, a line underneath says so: **Server says: read-only** or **Server says: may delete data**. That's the server's own claim, not a check by HappyVibe.

In [plan mode](/docs/built-in-tools/#start-plan-mode), a tool its server calls read-only follows your rules instead of always asking. So if you allowed that server, it runs while the agent plans. Any other server tool still asks, unless a rule of yours blocks it. Read-only scheduled runs work the same way.

The agent has no tool to add a server or sign in to one. You do that here, or in a workspace's own settings.

## Related

- [Permissions](/docs/permissions/): decide which server tools run on their own and which ask first.
- [Plugins](/docs/plugins/): some plugins bring MCP servers with them.
- [Built-in tools](/docs/built-in-tools/): the tools the agent has without any server.
- [Audit log](/docs/audit-log/): every call the agent made, and what you decided.
