---
title: Session view
description: Find every control around a session, from the tab strip to the message box, and learn to search, point the agent at files and split panes.
---

You and the agent spend most of your time together right here. The conversation sits in the middle, the controls for this one session sit above it, and the message box waits at the bottom. New here? [Your first session](/docs/first-session/) walks you through a first run. This page is the map to come back to.

## Where to find it

The middle of the window. Click a session in the sidebar and it opens here, in a tab. [Workspaces and sessions](/docs/workspaces-and-sessions/) covers the sidebar side.

## What's on the screen

From top to bottom: the tab strip, the session's top bar, the conversation and the message box. Day to day you need three things: the message box, the cards in the conversation, and the context gauge at the top right. Everything else is here for when you go looking.

<!-- TODO(media): session-view/session-view.png — A session with its top bar (model, thinking effort, cost, context gauge), a second tab in a split pane, and the message box -->

### The tab strip

Each tab shows one thing: a session, a file, a terminal or a browser. A session's tab carries its title, a file's tab its name, a terminal's tab the command running in it, and a browser's tab the page's title.

- A pulsing dot on a session's tab means its agent is working. Hover over it: "Working…".
- A dot on a file's tab means it has "Unsaved changes".
- **×** closes a tab, and so does a middle-click. ⌘W on macOS, Ctrl+W on Windows and Linux, closes the active tab. What closing does depends on the kind:
  - **A file:** it closes. With unsaved changes, the app asks first: they'd be lost.
  - **A session:** the session stays in the sidebar, so you can open it again. Closing its last tab stops its agent. If it's still working, the app asks first: "This session is still working. Close it and stop the agent?" If it has terminals open, the app asks whether to stop them or keep them. A session you never sent a message to is deleted.
  - **A terminal:** its process stops too. If a command is still running, the app asks first (unless you turned **Confirm close while running** off on [Terminal](/docs/terminal/)).
  - **A browser:** it closes straight away, unless a session is using it right now; then the app asks first.
- **+** ("New tab in this pane") opens a menu: **New session**, **New terminal**, **New browser** and **Open file…**. The first three show their keys (by default ⌘N, ⌘T and ⌘B on macOS, Ctrl+N, Ctrl+T and Ctrl+B on Windows and Linux). **Open file…** opens the files panel.
- Drag a tab to move it to another pane. An empty pane reads "Drag a tab here".

Right-click a tab for more:

- **Rename…**: for a session or a terminal. Double-clicking the tab does the same.
- **Repeat this on a schedule…** and **Export as HTML…**: for a session.
- **To new window**, and **To** followed by another open window's name: moves the tab there.

At the right end of the strip sit up to three small icon buttons for the pane. Hover over them to read their tooltips: "Split this pane — side by side", "Split this pane — stacked" and "Close this pane (its tabs move to the next one)". A button shows only when it can act on that pane. See [Split the view](#split-the-view).

### The top bar

The row above the conversation belongs to this session alone. On the left:

- **The model chip** shows the model this session uses. Hover over it to see the model's provider and id, and where the choice came from: "session override", "workspace default" or "global default". Click it to pick another model. With no model set, it reads **model…** and its tooltip says "No model configured".
- **think:** shows the thinking effort, for example **think: default**. Hover over it for "Thinking effort: default" (or the level you picked), and click it to pick another level. The pill only appears when the model can think.
- **🧠 skills** counts the skills loaded for this session, and how many the agent has used so far, like **1/4 skills**. Click it to see which, and which were "used". The list ends with a reminder: "Loaded for this session. Type /skill: to load one now." See [Skills](/docs/skills/).
- **agents** counts the subagents you can delegate to (a subagent is a helper agent the main agent hands a task to). Click it and pick one: the message box fills with "Ask *name* to ", ready for you to finish the sentence. The list ends with a reminder: "Or type @ in the message box." See [Agents](/docs/agents/).
- **🔌 MCP** reads like **2/3 MCP**: how many of the MCP servers this workspace can use (small programs that hand the agent extra tools) answered HappyVibe's own check, which the app runs itself, apart from this session. Hover over it for "2 of 3 MCP servers answered HappyVibe's check". Click it to see each server's state, and **Manage…** to open [MCP](/docs/mcp/).
- **📋 Plan ready**, **Implementing 2/5** or **Plan implemented** appears when the session has a plan: "The plan for this session — open it to implement, discard, or check progress". Click it to open the plan.
- **🧭 Plan mode**, with **Wrap up** ("Ask the agent to finalize the plan now") and **✕** ("Exit plan mode"), while the session is in plan mode. See [Start plan mode](/docs/built-in-tools/#start-plan-mode).
- **🕰 Read-only run**, on a session a schedule started: "It can read and report; changes are blocked, and nothing in the run can allow them." See [Schedules](/docs/schedules/).

On the right:

- **⌕** opens [search](#search-this-conversation). Its tooltip reads "Search this conversation", with the search shortcut: ⌘F on macOS, Ctrl+F on Windows and Linux.
- **The cost pill** shows an estimate of what this session has cost so far. Click it to open **Session cost**, the call-by-call breakdown. "—" means nothing has been billed yet, "plan" means your subscription covered it, "$?" means the app has no price for the model, and "+?" after an amount means part of the bill is missing.
- **The context gauge** shows how full the model's context is, as a percentage. Click it to open the context panel. [Context: what the agent can see](/docs/first-session/#context-what-the-agent-can-see) explains both.

The skills, agents and MCP chips only appear when there's something to count. In a narrow pane, the bar wraps onto a second line rather than hiding anything.

### Strips above the conversation

Now and then a strip appears under the top bar:

- "The agent process stopped (code …)." Click **Restart agent** to start it again.
- "Context is …% full. Open the context panel to review or compact." Compacting swaps older messages for a summary to free up room. Click **Review context**. Dismiss it, and it won't come back in this session. The strip itself never compacts anything.
- "No AGENTS.md found — add project context so the agent understands this codebase?" AGENTS.md is a file of notes about your project that the agent reads. **Generate one** opens a panel for writing it; **Dismiss** hides the strip for good in this workspace.

### The conversation

Your messages and the agent's replies, with a card for every tool the agent uses. [Watch it work](/docs/first-session/#watch-it-work) explains the cards and their marks.

On a message:

- Your messages show when they were sent ("3h ago"). Hover over the time for the exact date and time.
- The agent's last reply of a turn shows how long the turn took. Hover over it: "This turn took …".
- Hover over a message for its buttons: **Copy message** on yours, **Copy answer** on the agent's. Code blocks get their own **Copy code**.
- On your own messages, the rewind icon takes the session back to that point. It's hidden while the agent is working. See [Changed your mind? Rewind](/docs/first-session/#changed-your-mind-rewind).
- A very long message is folded. **Show more** and **Show less** open and close it. A message sent from a [prompt](/docs/prompts/) shows what you typed, with **Show the expanded prompt** for the full text the agent got.

On a tool card:

- An edit shows its diff straight away; click the card's title to fold it. A new file's contents open when you click the title. Other tools open their details.
- **⋯** ("Show details", "Hide details") shows exactly what the tool was given and what it returned.
- A command's last few lines of output show on the card. Click them to see the full output. A failed call shows its error on one line; click it to see the full error.
- A file path on the card opens the file in a tab ("Open … in the editor"). Hover over it for **Reveal in Finder** on macOS, **Show in File Explorer** on Windows or **Show in file manager** on Linux, and for **Copy path** ("Copy absolute path").

And around them:

- **Thinking…** shows while the agent reasons, then **Thought for 12s**. Click it to read its reasoning for that turn. It folds again each time you send.
- A long session starts at its latest messages. **Show earlier messages (…)** draws the rest.
- After a compaction ([Context: what the agent can see](/docs/first-session/#context-what-the-agent-can-see) says more), a note says "Earlier messages were compacted into a summary" and why. **Load earlier messages** brings them back into view, marked "earlier — not in the agent's context": you can read them, but the agent can't see them.
- Scrolled up while the agent writes? The conversation stops following it. **Jump to latest** takes you back down.
- If a request fails, the error says what happened, and often offers **Retry** or **Restart & resend**. For a rejected key, an unknown model or a conversation past the model's context window, the error also shows a **Read the guide ↗** link. It opens the **User guide** page inside the app, at the part that explains the fix; for the context window, that's the custom-endpoint steps on the Models page.

### Subagents and terminals at work

When the agent hands a task to a subagent, or starts a command in one of its terminals, a row of circles appears at the top of the conversation. It stays in view while you scroll. One circle is one subagent (a robot) or one terminal.

- Hover over a circle to see its name, what it's doing and its "Elapsed time". For a subagent, you also see its tokens (the unit models read and bill text in, roughly four characters), its cost and how full its context is. A working one offers **◼ Stop**: "Stop this subagent", or for a terminal "Stop this terminal and the process in it".
- Click a circle to open its card. A subagent's card shows what it's doing and thinking, live, and a box to "Message *name* while it works…". When a subagent runs several children at once, each gets its own **◼** ("Stop just … — the others keep going").
- **✕** closes the card: "Close — the run keeps going, and its circle stays in the row"
- A subagent that needs you pops out as a full card, and stays until you deal with it. One that has gone quiet says "No activity for 10 min — Stop?". The app never stops it for you.

A terminal's card has **Open as tab** ("Move this terminal into a tab of its own"). [Terminal](/docs/terminal/) says more.

### The message box

Type here, press **Enter** to send, **Shift+Enter** for a new line. It reads "Ask for a change… (@ to add a file)". Around it, from left to right:

- **+** opens a menu:
  - **Attach image**: "Attach an image to your next message". If the model can't see images, the row is greyed out and says "model has no vision".
  - **Repeat this on a schedule…**: "Run this session's first message again, on a schedule". See [Schedules](/docs/schedules/).
  - **Attach document**: "Attach a document — converted to Markdown on this machine". The row lists the formats it takes. If it reads "off in Built-in tools", turn **Documents** on in [Built-in tools](/docs/built-in-tools/).
- **🧭 Plan**: turns plan mode on or off for this session. It shows while the **Plan mode** built-in tool is on, and hides in a read-only run. See [Start plan mode](/docs/built-in-tools/#start-plan-mode).
- **The mic**: "Dictate", and the tooltip names the key to hold (right ⌘ on macOS, right Ctrl on Windows and Linux). It's hidden when voice is off, or when **Show mic in the chat bar** is off on [Voice](/docs/voice/).
- **Stop** ("Stop the agent"), only while the agent is working.
- **Send**, the paper plane. While the agent works, its tooltip changes to "Steer — lands between tool calls".

You can also paste or drop an image straight into the box, and, while **Documents** is on, drop a document on it. Each attachment waits above the box as a chip, with **×** to remove it, until you send. A document can go on its own, with nothing typed. A document's chip shows its size as Markdown and roughly how many tokens it will take, so you know what it costs before you send it.

Pasting more than 100,000 characters asks first: "That's a large amount of text to add to the composer. Insert it anyway?" (the composer is the message box).

Above the box, you may also see:

- the first-prompt suggestions, in the session the setup window opened for you;
- your queued messages, marked "queued · kept on stop", while the agent works (see [Steer, or stop](/docs/first-session/#steer-or-stop));
- "Model saved — applies when this session restarts.", after a change that couldn't reach the running session;
- "No model configured — set one up on the Models page to start chatting.", when no model is set. Click **Models** in it to go there. You can't send until a model is set;
- an update line, when a new version of HappyVibe is ready, for example "HappyVibe … is ready" with **Restart to update**. **✕** hides it until the next launch.

### The browser pane

**New browser** opens a web page in a pane, beside your session. It has **Back**, **Forward**, **Reload** and an address box ("Enter a URL"), and opens http and https pages. It keeps its cookies apart from your usual browser, shared by every browser pane. You start signed out there, and anything you sign into stays signed in.

It reaches localhost freely. Any other site is blocked until you allow it: the pane says "Blocked: …", and **Allow …** lets that site in for this pane.

**Comment on an element** lets you point at something on the page. Hover to highlight a part of the page, click it, type what you want ("What should it do?") and press **Enter**. Your comment lands in the message box as a chip, and a picture of that part goes with your next message. Nothing is sent until you send it.

The agent can use a browser of its own too. See [Agent browser](/docs/built-in-tools/#agent-browser--10-tools).

## Search this conversation

1. Press ⌘F on macOS, Ctrl+F on Windows and Linux, or click **⌕** in the top bar.
2. Type in "Search this conversation…". Every match lights up, and the counter shows which one you're on, like **2/7**.
3. Press **Enter** for the next match, **Shift+Enter** for the previous one, or click **↓** and **↑**.
4. Press **Esc**, or click **✕**, to close the search.

While the cursor is in a file you're editing, ⌘F or Ctrl+F searches that file instead. The keys are yours to change on [Keyboard shortcuts](/docs/keyboard-shortcuts/).

## Change the model or thinking effort for one session

1. Click the model chip at the left of the top bar.
2. Pick a model from the list. With more than five, type in "Search models…" to narrow it. Each row shows its price.
3. To change how hard it thinks, click **think:** beside it and pick a level. **default** ("Follow the default set on the Models page") puts it back.
4. To drop this session's own choice, open the chip again and pick **Use the workspace default** at the top of the list (**Use the global default** when the workspace has no model of its own). The session switches right away.

The choice belongs to this session only. Other sessions keep theirs, and new sessions start from the workspace's model (set in [workspace settings](/docs/first-session/#workspace-settings)) or the default one on [Models](/docs/models/).

## Point the agent at a file, an agent or a prompt

**A file or folder:**

1. Type **@** in the message box, then a few letters of its name.
2. Pick it from the list with the arrow keys and **Tab** or **Enter**, or click it.
3. Send as usual. The agent receives the file with your message.

**A subagent:** the same **@** list shows matching subagents above the files, as 🤖 **@name**. Click one, and **@name** goes into your message, so the agent knows to hand the task to it.

**A subagent that's already running:** its row reads 💬 "Message *name* · run 1": "sends your message to this running sub-agent, not to the main agent". Pick it, and the box shows "💬 to *name* (running) — not the main agent". Send, and "Sent to *name*" confirms it. Changed your mind? Click the **✕** on that line, and your message goes to the main agent instead.

**A skill or a prompt:** type **/** at the very start of the message. The list shows `/skill:` entries ("Load this skill") and your prompts, with their hints. Press **Tab** or **Enter** to complete one, then **Enter** again to send. See [Skills](/docs/skills/) and [Prompts](/docs/prompts/).

## Split the view

A workspace's middle area holds up to four panes, each with its own tabs.

1. In the tab strip of the pane you want to divide, click the split button whose tooltip reads "Split this pane — side by side" or "Split this pane — stacked". Only the directions that pane can take show.
2. Drag tabs between the panes, or use each pane's **+** to open a new tab in it.
3. To go back, click the X-shaped icon beside the split buttons ("Close this pane (its tabs move to the next one)"). Nothing closes: the tabs just move over.

## During a session

You always know when the agent is busy:

- the session's tab pulses;
- the message box reads "Steer the agent — lands between tool calls…", and the Send button's tooltip changes to "Steer — lands between tool calls";
- **Stop** appears beside it;
- the rewind icon hides until the turn ends.

While subagents work, the message box says so instead: "Subagents are working in the background — keep chatting; results drop in when they finish", or, while one subagent holds the turn, "Type away — messages will be answered when *name* finishes".

## Related

- [Your first session](/docs/first-session/): the guided first run, rewind and the context panel.
- [Approve a tool call](/docs/approve-a-tool-call/): what to do when the agent asks.
- [Workspaces and sessions](/docs/workspaces-and-sessions/): the sidebar, where sessions live.
- [Files and changes](/docs/files-and-changes/): the file tree and the Changes panel beside a session.
- [Keyboard shortcuts](/docs/keyboard-shortcuts/): every key on this page, and how to change them.
