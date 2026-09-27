---
title: Agent tools
description: See every tool the agent can call, and whether your rules let it run, ask first, or block it.
---

Curious what the agent can actually do? This is the full list: "Everything the agent can call, and whether it is allowed to." Nothing here changes anything. It's a place to look, so you know what you're working with.

## Where to find it

**Control** → **Agent tools** in the sidebar.

## What's on the screen

### Tools

"Permission state comes from your rules." To change them, follow the **Permissions** link under that line.

Each row is one tool: a coloured pill, the tool's name, and the start of its description. Click a row to open it and read the whole description, and the file the tool comes from, where the app knows it. "No description provided." means the tool came without one.

The pill says what happens when the agent calls that tool:

- **allow**: it runs without asking.
- **ask**: the approval dialog opens, and the call waits for you.
- **deny**: it's blocked.

The pills come from your [permission rules](/docs/permissions/), the same ones that decide real calls, for the workspace of the session you have selected. A pill answers for the tool as a whole, so it reflects **tool** rules and the defaults. A **path** or **command** rule only applies once there's an actual file or command to check, so a tool marked **allow** here can still ask, or be blocked, for a particular file or command.

### Where the list comes from

The list is read from the agent itself, so it shows what the agent really has. While the app asks, you'll see "Loading…". If it comes back empty, the page reads "No tools yet — Start a session and this fills in from the live agent."

## Check a tool before you rely on it

1. Open **Control** → **Agent tools**.
2. Find the tool and look at its pill.
3. Click the row to read what the tool does.
4. To change its pill, go to [Permissions](/docs/permissions/) and add a **tool** rule with the tool's name as the pattern.

## During a session

The tools listed here are the ones the agent can reach for while it works. Each call shows up in your session as a tool card, and anything marked **ask** opens the approval dialog first.

## Related

- [Permissions](/docs/permissions/): where the rules behind the pills live.
- [Built-in tools](/docs/built-in-tools/): switch the app's own tools on or off.
- [MCP](/docs/mcp/): add tools from MCP servers.
- [Approve a tool call](/docs/approve-a-tool-call/): what happens when a tool asks.
