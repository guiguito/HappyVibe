---
title: Permissions
description: Decide what the agent may do on its own, what it must ask about, and what it may never do.
---

This is where your yeses and nos become rules. Anything you haven't decided waits for you, in an approval dialog the app writes itself, never the model. For a shell command, the dialog describes the command itself (open **details** for the exact text), never the model's description of it.

The screen says what it holds: "Global rules for every workspace. Per-workspace overrides live in each workspace's own settings." Those are the [workspace settings](/docs/first-session/#workspace-settings).

## Where to find it

**Control** → **Permissions** in the sidebar.

## What's on the screen

<!-- TODO(media): permissions/permissions-rules.png — The rule list mixing allow, ask and deny, with the test box -->

### Rules

"Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). With no match, a short list of safe tools runs on its own and everything else asks you." The safe tools are the ones that only read, such as reading and searching your project's files. The **Test a call** box below tells you which ones: it says "(safe tool default)".

Under that line, **How rules combine** opens the longer explanation.

Each rule is one row with three parts: its type, a pattern, and an action. The **×** at the end of a row deletes it.

The type says what the pattern is matched against:

- **tool**: the name of the tool the agent wants to call, such as `bash`.
- **path**: the file or folder a file tool is given, such as `src/**`. Inside your workspace, the path is read from the workspace folder, so `src/**` means the `src` folder of your project.
- **command**: the shell command the agent wants to run, such as `git push*`.

A path rule doesn't look inside shell commands: a **deny** on `secrets/**` doesn't stop `cat secrets/key`. Use a **command** rule for those.

The action says what happens when the rule matches:

- **allow**: the call runs without asking.
- **ask**: the approval dialog opens, and the call waits for you.
- **deny**: the call is blocked.

In a pattern, `*` stands for any run of characters. In a path, `*` stays within one folder and `**` reaches into folders at any depth. `?` stands for exactly one character. For example:

- `src/**` matches every file in `src`, however deep.
- `*.env` matches files ending in `.env` at the top of your project folder, but not in its subfolders.
- `git push*` matches `git push origin main`.

A few tools are checked under their own names, so a **tool** rule for them uses that name:

- MCP tools: `mcp:` and the tool's name, or `mcp:*` for all of them. For a server with **Expose tools directly** ticked, use each tool's own name, as it's listed on [Agent tools](/docs/agent-tools/).
- Adding an MCP server or signing in to one: `mcp-manage:install:` and the server's address, or `mcp-manage:auth:` and the server's name. `mcp:*` doesn't cover these. With no rule they ask you, and in plan mode or a read-only run they're blocked.
- The browser and the web tools that open an address: `browser:` and the site, such as `browser:docs.example.com`, or `browser:*`.
- Subagents: `subagent:` and the agent's name, or `subagent:*`.
- Workflows: `workflow`. Only **deny** has an effect: every workflow asks you.

### Test a call

The box under the rules checks what your saved rules would do, without the agent doing anything.

1. Type a tool name in the first field. It starts as `bash`.
2. Type a command in the second field (for `bash`) or a path (for any other tool).
3. Click **Evaluate**.

The answer is **allow**, **ask** or **deny**, followed by why: the rule that decided it, "(safe tool default)", or "(no rule matched — default is ask)". On this screen it checks your global rules. Testing `workflow` never answers **allow**: an allow rule doesn't skip the workflow question, so the box says **ask**.

Type a tool that's checked under another name (`mcp`, `Agent`, `SubagentWorkflow`, or a browser or web tool that opens an address), and the box names the one to test instead, for example "Agent is checked as `subagent:<agent>` on every call. Test that name instead."

### Bypass ALL permissions

"Auto-approve every action — file writes, shell commands, MCP calls — in every workspace, with no prompts."

It's off, and most people never need it. "Individual workspaces can override this" in their [workspace settings](/docs/first-session/#workspace-settings).

Before you turn it on, know two things. Your **deny** rules no longer stop a call, with one exception: a **deny** rule on `workflow` still blocks workflows. And every call still lands in the [Audit log](/docs/audit-log/), with what your rules would have decided. A session in plan mode stays read-only either way.

The switch reads **Off** while it's off. Clicking it asks you first: "⚠ Auto-approve every action?" with "This turns off ALL permission prompts globally — the agent may write files and run shell commands without asking. Only enable this if you fully trust what you're running." Click **Enable bypass** to turn it on, or **Cancel** to leave everything as it was. To turn it off again, click the switch. It reads **On**.

While it's on, every session it applies to shows a red banner, "Dangerous mode is ON for this session — every tool call runs without asking.": the ones already open, and every one you start or restart. The banner's **Turn off** button makes that session ask again until it restarts. To stop bypass for good, turn this switch off.

## Add a rule

1. Click **+ Add rule**. A new row appears as a **tool** rule that asks.
2. Pick the type: **tool**, **path** or **command**.
3. Type the pattern.
4. Pick the action: **allow**, **ask** or **deny**.
5. Click **Save rules**.

"Saved — live in all sessions." Your rules apply straight away, including to sessions already running. **Save rules** stays greyed out while nothing has changed or while a row's pattern is empty.

## Turn "Always allow" into a rule

<!-- TODO(media): approve-a-tool-call/permission-modal.png — "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny -->

Two buttons in the [approval dialog](/docs/approve-a-tool-call/#the-five-buttons) write a rule for you:

- **Always allow** adds an allow rule for that tool to the list on this screen, for every workspace.
- **Allow for workspace** adds the same rule to that workspace's [workspace settings](/docs/first-session/#workspace-settings), so it applies to that workspace only.

Either way, the call you were asked about runs, and from then on that tool runs without asking, unless a stricter rule also matches it. For `bash`, that means every shell command, not just this one. For a narrower grant, add a **command** rule here instead.

To take the permission back, delete the rule's row here and click **Save rules**.

## During a session

When a call needs your answer, the approval dialog opens over the session. It never times out and never allows anything by itself: the call waits until you click. [Approve a tool call](/docs/approve-a-tool-call/) walks through it.

### Calls that don't ask

With no rule matching, these run without the approval dialog:

- Tools that only read or look things up: reading, searching and listing files inside your workspace, reading the page open in the app's browser, searching the web, and recalling a memory.
- Opening a page on your own computer (localhost) in the app's browser, the usual way to preview what you're building.
- Creating or changing a schedule. That opens the schedule form for you to fill in and confirm instead, so you're never asked the same thing twice. Deleting a schedule asks.

A rule of yours still wins over all of these: an **ask** or **deny** rule on `browser:localhost` applies, for example.

### Calls that ask even when they'd usually run

A file tool that reaches outside your workspace asks, even to read. The dialog says so: "This is outside your workspace:" and the path. A rule that matches the call decides instead.

Opening a site other than localhost in the app's browser, or fetching a page from the web, asks too, one site at a time.

### What a remembering button covers

**Allow for session**, **Allow for workspace** and **Always allow** remember the tool, under the name it's checked by. For web and browser calls that's one site. For an MCP tool, that one tool. For a subagent, that one agent.

- **Allow for session** writes no rule. It covers calls that would have asked by default, including the outside-your-workspace question, but not calls an **ask** rule sends to you. Subagents the session starts get the same yes.
- **Allow for workspace** and **Always allow** write an allow rule, and a rule decides before the outside-your-workspace question. For `bash` that means every command, and for file edits it means edits anywhere on your computer, without asking again.

### Subagents and workflows

A subagent is a helper agent the main agent hands a task to, and a workflow is a small script that runs several subagents. When one of them asks, the dialog offers fewer buttons:

- A subagent: the title names it, for example "Sub-agent worker wants to run something". The buttons are **Allow**, **Allow for this run** and **Deny**. **Allow for this run** covers that tool until the subagent's run ends.
- A workflow: **Allow** and **Deny**.

None of their answers ever becomes a rule.

## Related

- [Approve a tool call](/docs/approve-a-tool-call/): the dialog, button by button.
- [Agent tools](/docs/agent-tools/): every tool the agent can call, and what your rules say about it.
- [Audit log](/docs/audit-log/): every decision, including denials.
- [Built-in tools](/docs/built-in-tools/): plan mode and the tools that come with the app.
