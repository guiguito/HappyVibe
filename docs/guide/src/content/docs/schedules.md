---
title: Schedules
description: Have the agent run a prompt for you on its own, every morning or every Friday, and choose whether each run may change anything.
---

Liked what the agent did this morning? Have it do it again tomorrow, and every weekday after, without you asking. The screen puts it in one line: "A prompt, a project and a time. When it fires, HappyVibe opens a session and sends it — you watch it, approve it and pay for it exactly like one you started yourself."

A run is an ordinary session. It shows up in the sidebar, it asks before it acts like any other session does, and you can open it, read it and carry on the conversation. Nothing about it is hidden.

## Where to find it

The **Schedules** row near the top of the sidebar, above **workspaces**, with a clock beside it. When the sidebar is folded into its [icon rail](/docs/workspaces-and-sessions/#the-icon-rail), it's the clock just above the gear.

The row also tells you what's coming, for example "2 active · next 9:00". When a run missed its time and is waiting for you, it reads "1 missed · decide", and the rail's clock gets a small dot.

At the bottom of the screen, **How this page works ↗** opens this page.

## What's on the screen

One switch at the top, then your schedules grouped by workspace, or four templates while you have none.

The screen's intro is followed by one plain fact: "HappyVibe has to be open for schedules to run." Beside it, on macOS and Windows, the **Open at login** switch starts HappyVibe when you log in to your computer, so your schedules don't depend on you remembering to open it.

At the top right, **New schedule** opens the drawer to make one.

### Before your first schedule

The screen says "No schedules yet" and points at the two ways to start: "Start from a template below, or right-click any chat tab and pick “Repeat this on a schedule…”."

Under **START FROM A TEMPLATE** are four ready-made reviews. Each opens the drawer already filled in, and all four are Read-only, so none of them can change your project:

- **Daily change review**: weekdays at 9:00. Reviews what was committed since yesterday and flags anything risky.
- **Weekly dependency check**: Mondays at 9:00. Lists dependencies with a newer version or a known advisory.
- **Release readiness**: Thursdays at 16:00. Compares the branch with the last release tag.
- **Weekly repo health**: Fridays at 15:00. Reports the five things most worth cleaning up.

### The list

Schedules are grouped under their workspace's name. Each row shows:

- The clock, the schedule's title, and a line underneath: when it repeats, how the last run went, and when the next one is. For example "Weekdays at 9:00 · ✓ 3 min · $0.04 · in 5 h".
- A pill reading **Read-only** or **Full**. Its tooltip says what it does: "Click to switch between Read-only and Full". One click changes the mode, without opening anything.
- **Run now**, to start a run straight away. It doesn't change when the next one is due.
- A switch that turns the schedule on or off. Off, it doesn't run until you turn it back on.
- **▸**, which opens the schedule's recent runs (see below).

Click a schedule's title to open it in the drawer and change anything.

<!-- TODO(media): schedules/schedules-list.png — The Schedules screen with two schedules and a recent run -->

How the last run went:

- "— never ran": it hasn't run yet.
- **✓**, then how long it took and what it cost, when HappyVibe knows the cost. A cost it doesn't know is left out, never shown as $0.00.
- "✕ failed:" and the reason.
- "– skipped:" and the reason: "busy" (another session in that workspace was working the whole time), "missed" (you skipped a missed run, or chose **Skip it**), "unanswered" (a missed run you never decided on) or "workspace-gone" (the project isn't in the sidebar any more, so the schedule switches itself off).

When the next run is: "in 20 min", "in 5 h" or "in 3 d", "due now", "off" (you switched it off), "paused" (see below), "ended" (it passed its end date), or "once, done" for a one-off that has run.

A row can carry one more line:

- "Paused after 3 failed runs — check the model or the key." Three failures in a row usually mean something that won't fix itself, like a missing key, so HappyVibe stops spending on it. Open the schedule, fix what's wrong, and click **Save**. The drawer says so: "Paused after 3 failed runs — saving will start it again."
- "Missed its time — waiting for you to decide." Click **Decide** beside it to answer (see [If a run is missed](#if-a-run-is-missed)).
- "It reached its end and stopped on its own. Reschedule it to start again, or delete it." An ended row swaps its pill and switch for **Reschedule** (tooltip "Give it a new end, or no end at all"), **Run now** and **Delete**.

### Recent runs

Click **▸** on a row to see its last ten runs, newest first: a mark (✓, ✕ or –), when it ran, the reason if it didn't go well, its cost when known, and **Open** to jump to the run's session. Below them, "Last 30 days:" adds up what the schedule has cost lately. Before its first run, the panel says "No runs yet."

**Delete this schedule** sits at the bottom of the panel.

## Create a schedule

1. Click **New schedule**, or pick a template.
2. The drawer opens: "New schedule". Fill in:
   - **Title**: a short name. Leave it empty and the first line of the prompt becomes the title.
   - **Prompt**: what to send each time. "Slash prompts work here (/review), and so do @file mentions." Write it so it stands on its own: nobody is there to explain it when it runs.
   - **Workspace**: the project it runs in.
3. Pick when it runs (see [Timing](#timing)).
4. Under **How careful**, pick **Full session** or **Read-only** (see [Full or read-only](#full-or-read-only)).
5. Adjust the rest if you like:
   - **Reuse the same session for every run**: off by default, so each run gets a fresh session. On, every run goes into one session: "Context builds up across runs; HappyVibe compacts it when it gets long." ([Context: what the agent can see](/docs/first-session/#context-what-the-agent-can-see).)
   - **Model**: "Same as this project" unless you pick one, so runs use the workspace's model, or your default model if the workspace has none.
   - **Notify when a run finishes**: on by default. "You are always notified when a run needs your permission."
   - **If it misses its time**: see [If a run is missed](#if-a-run-is-missed).
6. Click **Create**. The drawer's footer says what happens next: "Runs automatically until you pause it."

**Cancel** or **Esc** closes the drawer without saving. If something's missing, the drawer says what, for example "Give the schedule a prompt (20,000 characters or fewer)."

## Repeat a session on a schedule

This is the easy way in: do a task by hand once, like the result, then make it recurring.

1. In the session, click **+** in the message box and pick **Repeat this on a schedule…**. Its tooltip reads "Run this session's first message again, on a schedule". Or right-click the session's tab and pick the same thing.
2. The Schedules screen opens with the drawer filled in: your session's first message as the prompt, its workspace, and its name as the title.
3. Pick the timing and the mode, then click **Create**.

## When the agent suggests one

With the **Schedules** built-in tool on, you can ask the agent to check your dependencies every Monday, and it can propose the schedule itself. It can't make one on its own.

1. The agent proposes a schedule. Instead of an approval dialog, the Schedules screen opens with the drawer filled in, marked "Proposed by the agent in this session."
2. Read it through, especially the prompt, the timing and **How careful**. The agent's proposal starts as **Full session** unless it chose read-only. Change anything you like.
3. Click **Create** to make it, or **Cancel** to turn it down. The agent is told either way, and waits until you've decided.

A change the agent proposes to an existing schedule opens the same drawer, titled "Edit schedule", with **Save**. If you're already editing a schedule when a proposal arrives, the proposal is turned down and the agent is told so.

The agent can also list the workspace's schedules, and ask to delete one. A delete comes as an ordinary [approval dialog](/docs/approve-a-tool-call/) naming the schedule and when it runs, unless a bypass is on: then it goes straight through, and the [Audit log](/docs/audit-log/) still records it. The agent only ever sees the schedules of the workspace it's working in. [Built-in tools](/docs/built-in-tools/#schedules--4-tools) is where you turn these tools off. Your schedules keep running.

## Timing

Under **Repeat**, pick one:

- **Every day**, at the time in **At**.
- **Weekdays**: Monday to Friday.
- **Weekly**: pick the days from the row of letters (S M T W T F S, Sunday first).
- **Every N hours**: "Every [6] hours, starting at" the time in **At**. From 1 to 23.
- **Every N minutes**: the same, from 1 to 59.
- **Once**: on the date you pick, at **At**.

Times are your computer's clock. A 9:00 review stays at 9:00 when the clocks change for summer time.

"Every N" restarts from the **At** time each day. Every 6 hours from 1:00 runs at 1:00, 7:00, 13:00 and 19:00, every day.

When a choice means a lot of runs, the drawer says so before you create it, for example: "That is about 96 runs a day, and each one costs like a session you ran yourself."

Under **Until**, **No end** is the default: "It runs until you pause it." **Ends at** takes a date and time: "It stops on its own then — no need to come back and pause it." A **Once** schedule has no **Until**.

## Full or read-only

Every run is a real session, so the one question that matters is what it may do while you're not watching. **How careful** offers two cards:

- **Full session**: "Runs like a session you started. If it needs permission, it waits for you." It uses the workspace's own [permission rules](/docs/permissions/). Anything that would ask you waits, however long, in an approval dialog. If this workspace bypasses permissions, through **Bypass ALL permissions** on [Permissions](/docs/permissions/#bypass-all-permissions) or its own [workspace settings](/docs/first-session/#workspace-settings), a Full run bypasses too: nothing waits for you, and the drawer doesn't warn you. Choose **Read-only** when that's not what you want.
- **Read-only**: "Can read, search and report. Cannot change files or run commands." And: "Nothing in the run can switch this off."

In a read-only run the agent can read and search your project and write its report in the session. Editing or creating files, starting terminals, and clicking or typing in its browser are all blocked. Commands are limited to a short list that only look. It can't plan, and it can't create, change or delete schedules. Running a workflow is blocked, and it can only hand work to a subagent whose tools only read. A blocked call shows as a skipped card and the agent carries on. Read-only holds even under a bypass, and even your rules can't widen it.

Some calls still ask you first, and the run waits for your answer: running a command (even one that only looks), reading a web page, a tool from an MCP server, opening a page in its browser, handing work to a subagent, saving or forgetting a memory, and reading outside the project. A bypass doesn't answer these for you: in a read-only run they ask even with bypass on. An allow rule on [Permissions](/docs/permissions/) is what lets one run without asking.

Change a schedule's mode any time with the pill on its row.

## If a run is missed

A run can't happen while HappyVibe is closed or your computer is asleep. When the app is back, each missed schedule does what you picked under **If it misses its time**:

- **Ask me** (the default): "When HappyVibe is back, ask whether to run it now."
- **Run it once**: "Run once when HappyVibe is back, then return to the usual times." Three missed days are one run, not three.
- **Skip it**: "Wait for the next scheduled time."

For **Ask me**, a dialog opens: "A schedule missed its time", or "3 schedules missed their time", with "HappyVibe wasn't running. Run them now, or wait for the next scheduled time." Each schedule is listed with when it was due and its mode. Then:

1. Click **Run now** or **Skip** on each one, or **Run all** or **Skip all** for the lot.
2. Not sure yet? Click **Decide later**. The row keeps "Missed its time — waiting for you to decide.", and its **Decide** link reopens the dialog.

Nothing runs while it waits. The question stands until the schedule's next time comes round. Then the missed run is recorded as skipped, and the new one runs as usual.

## When the app is closed

- On macOS, closing every window keeps HappyVibe running, so schedules still run. On Windows and Linux, closing the last window quits the app, and schedules wait until it's open again.
- A run that's still working when the app quits stops there, and its row doesn't record how it went.
- While your computer sleeps, nothing runs. When it wakes, missed runs are handled as above.
- On macOS and Windows, **Open at login** keeps HappyVibe open without you thinking about it. On Linux the switch is there but doesn't work yet, so open HappyVibe yourself.

## Delete a schedule

1. Click **▸** on its row, then **Delete this schedule**. On an ended row, **Delete** does the same.
2. The app asks "Delete this schedule?" and explains: "Its record of past runs goes too. The sessions those runs produced stay where they are."
3. Click **Delete**, or **Keep it** to change your mind.

To stop a schedule without losing it, turn its switch off instead.

## During a session

- **In the sidebar:** each run is a session in its workspace, marked with a small clock whose tooltip reads "Started by a schedule". It's named after the schedule and the day, like "Daily change review · Sep 29". When a new run starts, the previous run's session moves to **Show archived**, unless you've sent it a message or renamed it since. With **Reuse the same session for every run** on, every run lands in the same session.
- **In the session:** the schedule's prompt shows as the first message, and the agent works as usual. A read-only run shows **🕰 Read-only run** at the top, with the tooltip "Read-only run — started by a schedule. It can read and report; changes are blocked, and nothing in the run can allow them." The **🧭 Plan** button isn't there.
- **If it needs you:** the approval dialog waits in the run's session, like any other question ([Approve a tool call](/docs/approve-a-tool-call/#it-waits-for-you)). On macOS, if every window is closed, it waits until you open one.
- **Busy workspace:** a run doesn't start while another session in the same workspace is working, because they share the same files. It waits up to two hours, then skips. If another session in that workspace is working, **Run now** doesn't start the run, even though the message says it will wait. Click it again once that session has finished.
- **Notifications:** your computer's notifications say "… finished" with the time and cost when known (silently), "… needs your permission", or "1 schedule missed its time". Click one to go to the run, or to the missed-runs dialog.
- **In the record:** on the [Audit log](/docs/audit-log/), **Any source** → **Schedules** shows what your schedules did, and **Read-only run** shows what read-only runs blocked.

## Related

- [Built-in tools](/docs/built-in-tools/#schedules--4-tools): turn off the agent's schedule tools.
- [Permissions](/docs/permissions/): the rules a Full run follows.
- [Approve a tool call](/docs/approve-a-tool-call/): what to do when a run asks.
- [Workspaces and sessions](/docs/workspaces-and-sessions/): where runs appear, and the archive.
- [Audit log](/docs/audit-log/): what each schedule did, and when.
