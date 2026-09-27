---
title: Approve a tool call
description: What the approval dialog shows, what each of its five buttons remembers, and which calls ask you first.
---

Step 5 of 5, and the moment HappyVibe is built around. By default, before the agent changes a file or runs a command, it stops and asks you in an approval dialog. Nothing runs until you say yes, and the agent waits for as long as you need.

## Which calls ask

Anything that changes something or runs something asks first: creating or editing a file, running a command, saving a memory, and any tool the app doesn't know to be harmless.

A few calls only look, and never ask:

- reading, searching and listing files inside your workspace;
- reading the page already open in the app's browser, and searching the web;
- recalling a memory you've already saved.

Two more never show the approval dialog, for different reasons:

- Opening a page on your own computer (localhost) in the app's browser, the usual way to preview what you're building.
- Creating or changing a schedule. That opens the schedule form for you to fill in and confirm instead, so you're never asked the same thing twice.

Opening a new site in the app's browser, or fetching a page from the web, asks first. So does reading a file outside your workspace, even though reading inside it doesn't. The dialog then says so: "This is outside your workspace:" and the path.

You can change what asks and what doesn't with your own rules on the [Permissions](/docs/permissions/) page. The switch that turns every question off is **⚠ Bypass ALL permissions**: one on that page for every workspace, and one in each workspace's [workspace settings](/docs/first-session/#workspace-settings).

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

Each button answers this call. Three of them also remember something, and what they remember is the whole tool, never just this one command or file:

- **Allow:** yes to this one call, and nothing more. The next one asks again.
- **Allow for session:** yes to this tool for the rest of this session. For running commands, that means every command the agent runs in this session, so use it when you trust where the session is going. It lasts until the session restarts. The card gets a clock whose tooltip reads "Allowed for this session".
- **Allow for workspace:** yes, and it adds a rule allowing this tool in this workspace, for every future session there.
- **Always allow:** yes, and it adds a rule allowing this tool in every workspace.
- **Deny:** no. The call doesn't run, its card shows as denied, and the agent is told you said no, so it can try another way or explain what it needed.

Worth knowing before you click one that remembers:

- **Allow for session** also stops the outside-your-workspace question for that tool. For web and browser calls it covers one site; for a tool from an MCP server, that one tool; for a subagent, that one agent. Subagents the session starts get the same yes. A tool you've set a rule to always ask about still asks.
- **Allow for workspace** and **Always allow** skip the outside-your-workspace question too. For running commands, that means every command, and for file edits, edits anywhere on your computer, without asking again.

The rules those two buttons add appear on the [Permissions](/docs/permissions/) page, where you can delete them any time.

A subagent is a helper agent the main agent hands a task to, and a workflow is a small script that runs several subagents. When one of them asks, the dialog offers fewer buttons:

- a subagent: **Allow**, **Allow for this run** and **Deny**. **Allow for this run** covers that tool until the subagent's run ends;
- a workflow: **Allow** and **Deny**.

None of their answers ever becomes a rule.

## It waits for you

The approval dialog has no timer, and it never says yes on your behalf. **Esc** and clicking outside it do nothing: the only way out is one of its buttons. Take as long as you need.

If you're on another screen when the question comes, the dialog appears there, over the whole window, so it's never hidden.

Every answer you give is recorded in the [Audit log](/docs/audit-log/). And if you said yes and wish you hadn't, you can [rewind](/docs/first-session/#changed-your-mind-rewind) the conversation, and often your files, to before that message.

## Next

That's the whole journey: installed, connected, and your first yes. Nice work. Next, decide what the agent may do without asking on [Permissions](/docs/permissions/), or fine-tune who it talks to on [Models](/docs/models/).
