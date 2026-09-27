---
title: Stats
description: See how much you use the agent, where, with which models, and what it cost, all worked out on your own computer.
---

How much have you and the agent done together, and what did it cost? Stats adds it up, right here on your computer: "Your usage, computed entirely on this machine — nothing is ever sent anywhere."

## Where to find it

**The record** → **Stats** in the sidebar.

## What's on the screen

### The workspace filter

A menu at the top reads **All workspaces**. Pick one workspace to see only its numbers. A session in a worktree (a second working copy of a git project, made with **New worktree…**) counts under its project.

Before your first session, the screen says "Nothing to show yet." and "Start a session and chat with the agent — your stats will build up here." That's all it needs.

### The four tiles

- **Sessions**: how many sessions you've run. If some are still open, it says how many, like "2 still open". A session that crashed without ending counts here too.
- **Tokens**: tokens in and out, added up. Tokens are how models measure text, and what providers charge by ([more on tokens](/docs/first-session/#context-what-the-agent-can-see)). The line under the total splits it, like "1.2k in · 800 out".
- **Cost (est.)**: an estimate, worked out locally. Its note reads "local estimate, plan spend excluded": what you use through a plan you already pay for isn't counted here. When some prices aren't known, the total ends in "+?" and the note reads "estimate — some prices unknown", so a partial total never passes for a complete one.
- **Avg session**: how long a session lasts on average, with the median underneath.

Under the tiles, a short sentence may count the model calls the app made on its own, outside any session: naming a session, writing a commit message, drafting a pull request. Their tokens are estimated and they're kept out of the cost above. The sentence ends "Each one is listed in the audit log." You'll find them in the [Audit log](/docs/audit-log/).

### The charts

- **Sessions over time**: "How much you've used the agent, day by day." One bar per day, with the count on top.
- **By workspace**: "Where your sessions happen." Each row shows the sessions, tokens and estimated cost for one workspace.
- **By model**: "Which models you actually use — and what each one cost." Same rows, per model. This section shows only once there is model data to put in it.
- **Permission activity**: "What the agent asked for, and what you decided." Counts **by decision** and **by source**. Before the agent has asked for anything, it reads "No permission decisions yet — They appear here once the agent asks for something."

If any sessions crashed, a last line says how many, like "1 session crashed."

## Check what a workspace costs

1. Open **The record** → **Stats**.
2. Pick the workspace in the **All workspaces** menu.
3. Read the **Cost (est.)** tile, then **By model** to see which model the money went to.

## During a session

Stats doesn't show up while the agent works. Every session you run adds to it, and the numbers are there the next time you open the screen.

## Related

- [Audit log](/docs/audit-log/): each decision behind **Permission activity**, one row at a time.
- [Models](/docs/models/): where you choose the models **By model** counts.
- [Privacy](/docs/privacy/): what leaves your computer, and what doesn't.
