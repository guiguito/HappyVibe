---
title: Approve a tool call
description: What the approval dialog shows, what each of its five buttons remembers, and which calls ask you first.
---

This is the moment HappyVibe is built around. It's step 5 of 5: by default, before the agent changes a file or runs a command, it stops and asks you in an approval dialog. Nothing runs until you say yes, and the agent waits for as long as you need.

## Which calls ask

Anything that changes something or runs something asks first: creating or editing a file, running a command, saving a memory, and any tool the app doesn't know to be harmless.

A few calls only look, and never ask:

- reading, searching and listing files inside your workspace;
- reading the page already open in the app's browser, and searching the web;
- recalling a memory you've already saved.

You can change what asks on [Permissions](/docs/permissions/), which also lists the few exceptions to these lists.

## Approve your first call

1. In a session, ask for something small: "Create a file called hello.txt that says hi."
2. The agent reaches for its file tool, and the approval dialog appears: "The agent wants to run something". Under that title, one line says what is about to happen, here "Creating hello.txt".
3. Want the raw version? Open **details** to see the tool's name and what it was given (a long input is cut short).
4. Click **Allow**.
5. The card in the session runs, then turns done, with a check whose tooltip reads "Allowed by you".

<!-- TODO(media): approve-a-tool-call/permission-approve — Ask to create hello.txt, the dialog appears, click Allow, and the card turns done with its approval mark -->

## Who writes the dialog

The app writes the approval dialog, never the model. The line you approve against is built by the app from the call itself: a plain description of the command, the file, the site. The model's own sentence about its call, its [tool intent](/docs/built-in-tools/#tool-intent), is stripped out before the dialog is drawn, so you approve what will happen, not what the model says will happen.

## The five buttons

<!-- TODO(media): approve-a-tool-call/permission-modal.png — "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny -->

Each button answers this call. Three buttons also remember your answer. What they remember is the whole tool, never just this one command or file, so pick them when you trust the tool, not just the call. For web and browser calls, "the tool" is one site; for a tool from an MCP server, that one tool; for a subagent (a helper agent the main agent hands a task to), that one agent.

- **Allow:** yes to this one call, and nothing more. The next one asks again.
- **Allow for session:** yes to this tool for the rest of this session. For running commands, that means every command the agent runs in this session, so use it when you trust where the session is going. It lasts until the session restarts, which happens, for example, after you change its tools, prompts or servers. The card gets a clock whose tooltip reads "Allowed for this session".
- **Allow for workspace:** yes, and it adds a rule allowing this tool in this workspace, for every future session there.
- **Always allow:** yes, and it adds a rule allowing this tool in every workspace.
- **Deny:** no. The call doesn't run, its card shows as denied, and the agent is told you said no, so it can try another way or explain what it needed.

The rules **Allow for workspace** and **Always allow** add appear on the [Permissions](/docs/permissions/) page, where you can delete them any time.

:::note[The fine print]
A yes that remembers also covers the same tool reaching outside your workspace. So **Always allow** on running commands means every command, and on file edits, edits anywhere on your computer. When a subagent or a workflow asks, the dialog offers fewer buttons, and none of them becomes a rule. [Permissions](/docs/permissions/) has the details.
:::

## It waits for you

The approval dialog has no timer, and it never says yes on your behalf. **Esc** and clicking outside it do nothing: the only way out is one of its buttons. Take as long as you need.

If you're on another screen when the question comes, the dialog appears there, over the whole window, so it's never hidden. A question from a session you're not looking at waits in that session, with a badge in the sidebar.

If you're in another app when a question or an approval arrives, HappyVibe lets you know:

- **macOS:** the Dock icon bounces once and shows how many are waiting. The first time, macOS asks whether HappyVibe may send notifications. The Dock count needs that permission, and you can keep banners turned off in System Settings.
- **Windows:** the taskbar button flashes and shows a dot.
- **Linux:** the taskbar button flashes, and docks that support it show the count.

Nothing happens when HappyVibe is already the app in front.

Every answer you give is recorded in the [Audit log](/docs/audit-log/). And if you said yes and wish you hadn't, you can [rewind](/docs/first-session/#changed-your-mind-rewind) the conversation, and often your files, to before that message.

## Next

That's the whole journey: installed, connected, and your first yes. Nice work. From here, get to know the places you'll spend your days, starting with [Workspaces and sessions](/docs/workspaces-and-sessions/). Or decide what the agent may do without asking on [Permissions](/docs/permissions/).
