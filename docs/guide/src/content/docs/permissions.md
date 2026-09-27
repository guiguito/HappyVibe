---
title: Permissions
description: Decide what the agent may do on its own, what it must ask about, and what it may never do.
---

You decide what the agent may do on its own. Everything else waits for your click. When a call needs your answer, the app writes the approval dialog, never the model. For a shell command, what you read there is exactly what will run. This screen holds the rules behind those decisions: "Global rules for every workspace. Per-workspace overrides live in each workspace's own settings." Those are the [workspace settings](/docs/first-session/#workspace-settings).

## Where to find it

**Control** → **Permissions** in the sidebar.

## What's on the screen

<!-- TODO(media): permissions/permissions-rules.png — The rule list mixing allow, ask and deny, with the test box -->

### Rules

"Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). No match falls back to asking you."

Under that line, **How rules combine** opens the longer explanation.

Each rule is one row with three parts: its type, a pattern, and an action. The **×** at the end of a row deletes it.

The type says what the pattern is matched against:

- **tool**: the name of the tool the agent wants to call, such as `bash`.
- **path**: the file or folder a file tool is given, such as `src/**`. Inside your workspace, the path is read from the workspace folder, so `src/**` means the `src` folder of your project. A path rule doesn't look inside shell commands: a **deny** on `secrets/**` doesn't stop `cat secrets/key`. Use a **command** rule for those.
- **command**: the shell command the agent wants to run, such as `git push*`.

The action says what happens when the rule matches:

- **allow**: the call runs without asking.
- **ask**: the approval dialog opens, and the call waits for you.
- **deny**: the call is blocked.

In a pattern, `*` stands for any run of characters. In a path, `*` stays within one folder and `**` reaches into folders at any depth. `?` stands for exactly one character. For example:

- `src/**` matches every file in `src`, however deep.
- `*.env` matches files ending in `.env` at the top of your project folder, but not in its subfolders.
- `git push*` matches `git push origin main`.

One exception to "No match falls back to asking you": with no rule matching, tools that only read or look things up, like reading and searching files or searching the web, run without asking. A file tool that reaches outside your workspace always asks, unless a rule says otherwise.

### Test a call

The box under the rules checks what your saved rules would do, without the agent doing anything.

1. Type a tool name in the first field. It starts as `bash`.
2. Type a command in the second field (for `bash`) or a path (for any other tool).
3. Click **Evaluate**.

The answer is **allow**, **ask** or **deny**, followed by why: the rule that decided it, "(safe tool default)", or "(no rule matched — default is ask)". On this screen it checks your global rules.

### Bypass ALL permissions

Even with bypass on, you can still see everything: every call lands in the [Audit log](/docs/audit-log/), and a session in plan mode stays read-only.

"Auto-approve every action — file writes, shell commands, MCP calls — in every workspace, with no prompts." It's off unless you turn it on, and "Individual workspaces can override this" in their [workspace settings](/docs/first-session/#workspace-settings).

While it's on, even your **deny** rules don't stop a call. The audit log records what they would have decided.

The switch reads **Off** while it's off. Clicking it asks you first: "⚠ Auto-approve every action?" with "This turns off ALL permission prompts globally — the agent may write files and run shell commands without asking. Only enable this if you fully trust what you're running." Click **Enable bypass** to turn it on, or **Cancel** to leave everything as it was. To turn it off again, click the switch. It reads **On**.

Sessions that are already open when you switch bypass on show a red banner: "Dangerous mode is ON for this session — every tool call runs without asking." Its **Turn off** button makes that one session ask again. Sessions started or restarted while bypass is on don't show the banner, but bypass still applies to them. The switch on this screen is the place to check.

## Add a rule

1. Click **+ Add rule**. A new row appears as a **tool** rule that asks.
2. Pick the type: **tool**, **path** or **command**.
3. Type the pattern.
4. Pick the action: **allow**, **ask** or **deny**.
5. Click **Save rules**.

"Saved — live in all sessions." Your rules apply straight away, including to sessions already running. **Save rules** stays greyed out while nothing has changed or while a row's pattern is empty.

## Turn "Always allow" into a rule

<!-- TODO(media): approve-a-tool-call/permission-modal.png — "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny -->

Two buttons in the [approval dialog](/docs/approve-a-tool-call/) write a rule for you:

- **Always allow** adds an allow rule for that tool to the list on this screen, for every workspace.
- **Allow for workspace** adds the same rule to that workspace's [workspace settings](/docs/first-session/#workspace-settings), so it applies to that workspace only.

Either way, the call you were asked about runs, and from then on that tool runs without asking, unless a stricter rule also matches it. For `bash`, that means every shell command from now on, not just this one. For a narrower grant, add a **command** rule here instead.

To take the permission back, delete the rule's row here and click **Save rules**.

**Allow for session** writes no rule. It covers calls that would have asked by default, not calls an **ask** rule sends to you, and it ends when the session restarts, which a change to MCP settings also does.

## During a session

When a call needs your answer, the approval dialog opens over the session. It never times out and never allows anything by itself: the call waits until you click. [Approve a tool call](/docs/approve-a-tool-call/) walks through it.

Subagents and workflows get a narrower dialog: it offers only the choices that cover that one run, never a rule.

## Related

- [Approve a tool call](/docs/approve-a-tool-call/): the dialog, button by button.
- [Agent tools](/docs/agent-tools/): every tool the agent can call, and what your rules say about it.
- [Audit log](/docs/audit-log/): every decision, including denials.
- [Built-in tools](/docs/built-in-tools/): plan mode and the tools that come with the app.
