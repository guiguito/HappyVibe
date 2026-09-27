---
title: Audit log
description: Look back at every permission decision, and at every model call the app made for you, session by session.
---

The audit log is the app's record of the agent: every time it asked, who answered, and what the answer was. In the screen's own words: "Every permission decision — and every model call the app made for you, without being asked — per session and per workspace."

## Where to find it

**The record** → **Audit log** in the sidebar.

## What's on the screen

### The filters

Four menus sit at the top. They all start on showing everything, and the newest rows come first.

- **All workspaces**: narrow the log to one workspace. A session in a worktree (a second working copy of a git project, made with **New worktree…**) counts under its workspace.
- **All sessions**: narrow it to one session. Once you've picked a workspace, this menu lists only that workspace's sessions.
- **Any decision**: show only **Allowed**, **Allowed for session** or **Denied** rows. Rows that aren't decisions (the other kinds below) step aside while this filter is on.
- **Any source**: show only the rows that came from one place, like **Rule**, **You**, **Bypass** or **Plan mode**. The last few choices pick out the other kinds of row: **The app itself**, **Model availability**, **Memory**, **Feedback** and **Crash reports**.

If the filters leave nothing, the log says "No decisions match these filters." Before the agent has asked for anything at all, it says "No permission decisions yet — they appear here once the agent asks for something."

<!-- TODO(media): audit-log/audit-log.png — Permission decisions including denials, with the filters visible -->

### Permission decisions

Most rows are decisions: a tool call the agent wanted to make, and what happened to it. Each one shows:

- The decision, as a tag: allow, allow-session or deny, the same as **Allowed**, **Allowed for session** and **Denied** in the filter. Allows are green and denials are red.
- The tool's name.
- Who decided. For example: "rule" when one of your rules answered, "user" when you answered the approval dialog yourself, "plan" when [plan mode](/docs/built-in-tools/#start-plan-mode) did, and "sub-agent" followed by the agent's name when the call came from one of the agent's [subagents](/docs/agents/) (helpers it hands work to). When a rule matched, its pattern follows. Hover over it to see which rule it was.
- When it happened.
- Underneath: a summary of the call, then the workspace and the session it belongs to.

### Calls let through by a bypass

With a bypass on, calls are allowed without asking (plan mode and read-only runs still hold), so the log also keeps a note of what you'd have been asked. The screen explains it: "When a call was let through by a bypass rather than by your rules, the row also says what your rules would have answered on their own — allow, ask or deny."

That note reads "rules would have asked", "rules would have allowed" or "rules would have DENIED". The one to look for is the note that ends in "denied". [Permissions](/docs/permissions/) explains the bypass and how to turn it off.

### Calls the app made on its own

Some model calls happen outside any session: naming a session, writing a commit message, drafting a pull request. Each gets a row tagged "assistant" ("assistant · failed" if it didn't complete) that reads "named a session", "wrote a commit message" or "drafted a pull request". Underneath, the model it used and its tokens, marked "(estimated)". These calls have no price attached, which is why [Stats](/docs/stats/) keeps them out of its cost.

### Other rows

- **model**: a model your subagents stopped using because it failed. They switched to another one, even though the session still shows the model you picked. The row reads "… not in use", with the app's notice underneath.
- **memory**: what the agent remembered, recalled, forgot or was refused, plus memories you forgot, edited or imported yourself, with the memory's name. The memory itself is never copied into the log: only its name and its one-line description, or the reason it was refused. See [Memory](/docs/memory/).
- **feedback**: feedback you sent, such as "Sent feedback" or "Rated the session". Your answers stay out of the log.
- **crash**: a crash report the app sent, as "Sent a crash report" and its kind, with "new" when it's the first of its sort. The log records the report's ID and size, never its content. See [Privacy](/docs/privacy/).

## Find every call you denied

1. Open **The record** → **Audit log**.
2. Set **Any decision** to **Denied**.
3. To narrow it further, pick a workspace in **All workspaces**, then a session in **All sessions**.

## Check what a bypass let through

1. Set **Any source** to **Bypass**.
2. Read the note on each row. The one that ends in "denied" marks a call your rules would have stopped.
3. If you'd rather be asked next time, turn the bypass off in [Permissions](/docs/permissions/).

Calls made by subagents are listed under "sub-agent", not **Bypass**, so this filter hides them. To see them too, leave **Any source** on **Any source**.

## During a session

Each time you answer an approval dialog, or a rule answers for you, a row lands here. It shows the next time you open the screen. [Approve a tool call](/docs/approve-a-tool-call/) walks through the dialog itself.

## Related

- [Permissions](/docs/permissions/): the rules that make most of these decisions.
- [Stats](/docs/stats/): the same decisions, counted.
- [Memory](/docs/memory/): what the memory rows refer to.
