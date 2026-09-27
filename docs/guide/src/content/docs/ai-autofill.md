---
title: AI autofill
description: See the three small jobs HappyVibe asks a model to do for you, read their prompts, pick their model, or switch them off.
---

A few chores HappyVibe hands to a model so you don't have to: naming a session, drafting a commit message, drafting a pull request. This screen shows each one, the exact prompt it sends, and the model it uses, so nothing happens behind your back.

## Where to find it

**App features** → **AI autofill** in the sidebar.

## How these jobs run

"Each runs on its own, outside every session — nothing enters a transcript or a context window." So they never take up room in a session's [context](/docs/first-session/#context-what-the-agent-can-see), what the agent can see.

Because they run outside a session, there's no usage report from the provider to count their [tokens](/docs/first-session/#context-what-the-agent-can-see) (the chunks of text a model reads and writes, which is what providers charge for). So what they cost appears "as an **estimate** in the Audit log and in Stats, never inside a session's own cost." The estimate is a token count, never a dollar figure.

If no model is set up at all, none of them run: "a session keeps its fallback name and the draft buttons stay away."

## What's on the screen

### What runs, and when

"Each row shows the exact prompt the model is sent. You can add to it, choose which model runs it, or switch it off." Two of them start from the Changes panel, where you see what changed in your project's files and save a version of them.

- **Session title**: "Runs once per session, moments after your first message. It is the only one of the three you never ask for." Off: "a session keeps the opening of your first message as its name, and no call is made."
- **Commit message**: "Runs when you press the wand beside the message box in the Changes panel." Off: "the wand button is gone from the Changes panel. You write the message yourself."
- **Pull request description**: "Runs when you press “Open a pull request” in the Changes panel." Off: "the button still works and still opens your forge — the description falls back to your list of commits, exactly as it does when no model is configured." Your forge is the site that hosts your code, such as GitHub.

Each row has:

- **On** / **Off**: whether the job runs.
- A model picker. **Same as your default model** "resolves the way a chat session does: this session's model, else this workspace's, else your global default." Pick a model to use a specific one for this job.
- Click the row's title to open it. You see the **built-in prompt (read-only)**, with a note on what gets filled in at run time, and **your additions**.

## Add to a prompt

1. Click the row's title to open it.
2. Type in **your additions**. "Your additions are appended after it. Add preferences (e.g. 'always list affected files'), not contradictions."
3. Click **Save**.

As on [Built-in tools](/docs/built-in-tools/), the prompt itself is read-only: "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told." Here, "the agent" means the model that runs the job.

## Pick the model for a job

1. Open the model picker on the job's row.
2. Choose a model. To go back, choose **Same as your default model**.

## Draft a commit message

1. Open the Changes panel. The shortcut is ⌘⇧G on macOS and Ctrl+Shift+G on Windows and Linux.
2. Click the wand beside the commit message box, labelled "Write it for me".
3. The draft appears in the message box. Read it, edit it if you like, then save as usual.

The wand only shows when **Commit message** is on and a model is set up. If a draft doesn't come back, the panel says "Couldn’t draft a message this time." If drafting isn't possible right now, the wand goes away instead. Either way, you can write the message yourself.

## During a session

A new session gets its name from **Session title** moments after your first message. The other two jobs run only when you click their button in the Changes panel. Each call shows up in the [Audit log](/docs/audit-log/) with its model and an estimated token count.

## Related

- [Models](/docs/models/): set your default model, which these jobs use unless you pick another.
- [Stats](/docs/stats/): an estimated token count for these jobs, beside your sessions.
- [Audit log](/docs/audit-log/): every call these jobs make.
