---
title: Permissions
description: Decide what the agent may do on its own, what it must ask about, and what it may never do.
---

You decide what the agent may do on its own. Everything else waits for your click. When a call needs your answer, the app writes the approval dialog, never the model, so what you read there is what will actually run. This screen holds the rules behind those decisions: "Global rules for every workspace. Per-workspace overrides live in each workspace's own settings."

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
- **path**: the file or folder the call touches, such as `src/**`. Inside your workspace, the path is read from the workspace folder, so `src/**` means the `src` folder of your project.
- **command**: the shell command the agent wants to run, such as `git push*`.

The action says what happens when the rule matches:

- **allow**: the call runs without asking.
- **ask**: the approval dialog opens, and the call waits for you.
- **deny**: the call is blocked.

In a pattern, `*` stands for any run of characters. In a path, `*` stays within one folder and `**` reaches into folders at any depth. `?` stands for exactly one character.

When several rules match one call, the strictest wins: deny beats ask, and ask beats allow. When no rule matches, the agent's read-only tools, like reading and searching files, run without asking, and everything else asks you. A file tool that reaches outside your workspace always asks, unless a rule says otherwise.

### Test a call

The box under the rules checks what your saved rules would do, without the agent doing anything.

1. Type a tool name in the first field. It starts as `bash`.
2. Type a command in the second field (for `bash`) or a path (for any other tool).
3. Click **Evaluate**.

The answer is **allow**, **ask** or **deny**, followed by why: the rule that decided it, "(safe tool default)", or "(no rule matched — default is ask)". On this screen it checks your global rules.

### Bypass ALL permissions

"Auto-approve every action — file writes, shell commands, MCP calls — in every workspace, with no prompts." It's **Off** unless you turn it on, and "Individual workspaces can override this."

Switching it on asks you first: "⚠ Auto-approve every action?" with "This turns off ALL permission prompts globally — the agent may write files and run shell commands without asking. Only enable this if you fully trust what you're running." Click **Enable bypass** to turn it on, or **Cancel** to leave everything as it was. Turning it back off is one click on **On**.

Even with bypass on, every call is still recorded in the [Audit log](/docs/audit-log/). Plan mode still wins: a session in plan mode stays read-only.

## Add a rule

1. Click **+ Add rule**. A new row appears as a **tool** rule that asks.
2. Pick the type: **tool**, **path** or **command**.
3. Type the pattern.
4. Pick the action: **allow**, **ask** or **deny**.
5. Click **Save rules**.

"Saved — live in all sessions." Your rules apply straight away, including to sessions already running. **Save rules** stays greyed out while nothing has changed or while a row's pattern is empty.

## Turn "Always allow" into a rule

<!-- TODO(media): approve-a-tool-call/permission-modal.png — "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny -->

When the agent asks, the dialog offers **Allow**, **Allow for session**, **Allow for workspace**, **Always allow** and **Deny**. Two of those write a rule for you:

- **Always allow** adds an allow rule for that tool to the list on this screen, for every workspace.
- **Allow for workspace** adds the same rule to that workspace's own settings, so it applies to that project only.

Either way, the call you were asked about runs, and from then on that tool runs without asking, unless a stricter rule also matches it. To take the permission back, delete the rule's row here and click **Save rules**.

**Allow for session** writes no rule. It lasts until that session restarts.

## During a session

When a call needs your answer, the approval dialog opens over the session. It never times out and never allows anything by itself: the call waits until you click. [Approve a tool call](/docs/approve-a-tool-call/) walks through it.

Sub-agents and workflows get a narrower dialog: it offers only the choices that cover that one run, never a rule.

## Related

- [Approve a tool call](/docs/approve-a-tool-call/): the dialog, button by button.
- [Agent tools](/docs/agent-tools/): every tool the agent can call, and what your rules say about it.
- [Audit log](/docs/audit-log/): every decision, including denials.
- [Built-in tools](/docs/built-in-tools/): plan mode and the tools that come with the app.
