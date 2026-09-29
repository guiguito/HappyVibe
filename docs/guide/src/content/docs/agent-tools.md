---
title: Agent tools
description: See every tool the agent can call, and whether your rules let it run, ask first, or block it.
---

Here's the full list of what the agent can call right now, and what your rules say about each: "Everything the agent can call, and whether it is allowed to." It's look-only. Nothing you do here changes anything, so browse freely.

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
- **per MCP tool**, **per agent** or **per site**: the tool is checked under another name on each call, so it has no one answer. Open the row to see that name, for example "Checked as `subagent:<agent>` on every call."

The pills come from your [permission rules](/docs/permissions/), the same ones that decide real calls, for the workspace of the session you have selected. A pill answers for the tool as a whole, so it reflects **tool** rules and the defaults. A **path** or **command** rule only kicks in on a real call. So a tool marked **allow** here can still ask, or be blocked, for one particular file or command.

The pill doesn't know about the session's state either. With **Bypass ALL permissions** on, calls run without asking, whatever the pill says. In plan mode, editing files, running commands that change things, clicking or typing in the browser and running workflows are blocked, and anything else that isn't read-only asks first.

A few tools are checked under another name on a real call: `mcp` per MCP tool (unless its server has **Expose tools directly** ticked, then each tool keeps its own name), `Agent` per subagent, and the browser and web tools that open an address per site. Their pill says which, instead of a verdict. `SubagentWorkflow` is checked as `workflow`, and its pill shows your `workflow` rules. Every workflow asks unless a rule denies it, so that pill never says **allow**. [Permissions](/docs/permissions/) lists the names to use.

### Where the list comes from

The list is read from the agent itself, so it shows what the agent really has. While the app asks, you'll see "Loading…". If it comes back empty, the page reads "No tools yet — Start a session and this fills in from the live agent."

## Check a tool before you rely on it

1. Open **Control** → **Agent tools**.
2. Find the tool and look at its pill.
3. Click the row to read what the tool does.
4. To change its pill, go to [Permissions](/docs/permissions/) and add a **tool** rule with the tool's name as the pattern.

## Block a tool

1. Note the tool's name on this screen.
2. Open [Permissions](/docs/permissions/) and click **+ Add rule**.
3. Leave the type on **tool**, type the tool's name as the pattern, and set the action to **deny**.
4. Click **Save rules**. Back here, the tool's pill reads **deny**.

For MCP tools, subagents, workflows and sites, use the names listed on [Permissions](/docs/permissions/) instead, such as `mcp:*` or `browser:*`.

## During a session

The tools listed here are the ones the agent can reach for while it works. Each call shows up in your session as a tool card, and anything marked **ask** opens the approval dialog first.

## Related

- [Permissions](/docs/permissions/): where the rules behind the pills live.
- [Built-in tools](/docs/built-in-tools/): switch the app's own tools on or off.
- [MCP](/docs/mcp/): add tools from MCP servers.
- [Approve a tool call](/docs/approve-a-tool-call/): what happens when a tool asks.
