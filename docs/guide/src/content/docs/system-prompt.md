---
title: System prompt
description: See exactly what the agent is told before every conversation, and add instructions of your own.
---

Before you type a word, the agent has already been given its instructions: the system prompt. This screen shows you those instructions, word for word, and lets you add your own. In the screen's words: "What the main agent is told before every conversation. The base prompt is the same for every session; your additions layer on top of it."

## Where to find it

**Control** → **System prompt** in the sidebar.

## What's on the screen

### Resolved prompt

"Exactly what the agent sees, read-only — the same honesty as the context panel." You can read it, but you can't edit it here.

The first time you open this screen, the box may be empty: "Run a session once and the resolved prompt is captured and shown here (it stays visible afterwards)." That's because the full prompt is only put together when a session actually runs. Once one has, the app keeps a copy, so the box stays filled after a restart. A copy kept from an earlier session is marked "from your last session".

### Your additions

"Appended to the system prompt for every workspace." Type your instructions in the box and click **Save**. "Saved." confirms it.

Your additions reach new or restarted sessions, not the one already running. For instructions that belong to one project only, the screen points you to that project's `AGENTS.md` instead.

### Open files and terminals

"Let the agent see which files you have open, and which terminals it has running."

**Include open files and terminals** is **On** by default. It tells the agent which files you have open, as a list of paths: "never their contents." That's what lets you say "this file" without spelling out the path. It's sent only when the list changes, and it takes effect on your next message.

It also lists the terminals the agent started itself, so it can find a dev server it opened earlier in a long conversation. If you turn this **Off**, the agent loses that too: "the terminal keeps running and you keep seeing it, but the agent may lose track of it."

## Add your own instructions

1. Open **Control** → **System prompt**.
2. Type your instructions under **Your additions**.
3. Click **Save**.
4. Start a new session, or restart one, to use them.

## During a session

Every new session is given the base prompt with your additions on top. With **Include open files and terminals** on, each message you send also carries the list of files you have open, whenever it has changed.

## Related

- [Memory](/docs/memory/): notes the agent keeps about you and your projects.
- [Permissions](/docs/permissions/): what the agent may do without asking.
- [Terminal](/docs/terminal/): the terminals the agent can start.
- [Models](/docs/models/): the model that reads this prompt.
