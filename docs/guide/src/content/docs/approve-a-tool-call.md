---
title: Approve a tool call
description: What the approval dialog shows, what each of its five buttons remembers, and which calls ask you first.
---

This is the moment HappyVibe is built around. By default, before the agent changes a file or runs a command, it stops and asks you. Nothing runs until you click **Allow**, and the agent waits for as long as you need.

## Which calls ask

Anything that changes something or runs something asks first: creating or editing a file, running a command, deleting a schedule, saving a memory, and any tool the app doesn't know to be harmless.

A few calls only look, and never ask:

- reading, searching and listing files inside your workspace;
- reading a page in the app's browser, and searching the web;
- recalling a memory you've already saved.

Reading a file outside your workspace asks, even though reading inside it doesn't. The dialog then says so: "This is outside your workspace:" and the path.

You can change what asks and what doesn't with your own rules on the [Permissions](/docs/permissions/) page. The one setting that turns every question off is **⚠ Bypass ALL permissions**, also on that page.

## Approve your first call

1. In a session, ask for something small: "Create a file called hello.txt that says hi."
2. The agent reaches for its file tool, and a dialog appears: "The agent wants to run something". Under that title, one line says what is about to happen, here "Creating hello.txt".
3. Want the raw version? Open **details** to see the tool's name and exactly what it was given.
4. Click **Allow**.
5. The card in the transcript runs, then turns done, with a check whose tooltip reads "Allowed by you".

<!-- TODO(media): approve-a-tool-call/permission-approve — Ask to create hello.txt, the dialog appears, click Allow, and the card turns done with its approval mark -->

## Who writes the dialog

The app writes the approval dialog, never the model. The line you approve against is built from what the call will actually do: the command itself, the file's name, the web address. The model's own sentence about its call is stripped out before the dialog is drawn, so you approve what will happen, not what the model says will happen.

## The five buttons

<!-- TODO(media): approve-a-tool-call/permission-modal.png — "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny -->

Each button answers this call. Three of them also remember something:

- **Allow:** yes to this one call, and nothing more. The next one asks again.
- **Allow for session:** yes to this tool for the rest of this session. For the shell, that means every command, so use it when you trust the direction the session is going. The card gets a clock whose tooltip reads "Allowed for this session". A tool you've set a rule to always ask about still asks.
- **Allow for workspace:** yes, and it adds a rule allowing this tool in this workspace, for every future session there.
- **Always allow:** yes, and it adds a rule allowing this tool in every workspace.
- **Deny:** no. The call doesn't run, its card shows as denied, and the agent is told you said no, so it can try another way or explain what it needed.

The rules the workspace and always buttons add appear on the [Permissions](/docs/permissions/) page, where you can delete them any time.

When a sub-agent or a workflow asks, the dialog offers fewer buttons. Their answers never become a rule, so a yes covers what you approved and nothing after it.

## It waits for you

The dialog has no timer, and it never says yes on your behalf. **Esc** and clicking outside it do nothing: the only way out is one of its buttons. Take as long as you need.

If you're on another screen when the question comes, the dialog appears there, over the whole window, so it's never hidden.

Every answer you give is recorded in the [Audit log](/docs/audit-log/).

## Next

That's the whole journey, from download to your first approved call. From here, [Models](/docs/models/) is the place to fine-tune who the agent talks to.
