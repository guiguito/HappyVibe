---
title: Your first session
description: Add a project, start a session, ask for a change, and follow what the agent does, card by card.
---

A session is one conversation with the agent, inside one workspace. This is step 4 of 5, and the fun one: you ask, it works, and every step it takes shows up as a card you can open. An empty session puts it simply: "Ready when you are." and "Ask for a change and the agent gets to work. Anything risky knocks first."

If you just finished the [first launch](/docs/first-launch/) setup, your first session is already open. Skip to [Ask for something](#ask-for-something).

## Add a workspace

A [workspace](/docs/first-launch/#pick-a-project) is your project, as it shows up in the sidebar.

1. In the sidebar, next to **workspaces**, click **+ add**. When no session is open, the middle of the window also offers **Add a workspace folder…**.
2. Pick your project's folder. It appears in the sidebar under **workspaces**.

## Start a session

1. Click the **+** next to your workspace's name.
2. If the folder uses git (version control), the **+** opens a small menu: click **New session**. Otherwise it starts the session straight away.

Or press ⌘N on macOS, Ctrl+N on Windows and Linux, for a new session in the current workspace.

Everything else the sidebar does, from renaming to archiving, is on [Workspaces and sessions](/docs/workspaces-and-sessions/).

## Ask for something

1. Type what you want in the message box. It reads "Ask for a change… (@ to add a file)". Type @ to point the agent at a file.
2. Press **Enter** to send. **Shift+Enter** starts a new line.

If the agent wants to change a file or run a command, it stops and asks you first. Nothing happens until you say yes. [Approve a tool call](/docs/approve-a-tool-call/) shows you how.

If you came through the setup window, a few suggested prompts sit above the message box, matched to your folder. A folder that already holds files gets ideas like "Give me a tour of this codebase". An empty one gets ideas like "Make a snake game I can open in my browser".

Clicking one fills the message box and never sends it. Change it as much as you like, then press **Enter** yourself. The suggestions leave for good once you send your first message.

## Watch it work

A tool is one action the agent can take: read a file, edit one, run a command. Every tool it uses shows up as a card, with a plain description of what it's doing: "Editing" or "Creating" and the file's name, or a command described in words. Expand a card to see exactly what it did. In the session the setup window opens for you, the app says so too: "Each card is a tool the agent ran — expand one to see exactly what it did."

<!-- TODO(media): first-session/session-running.png — A turn in progress: tool cards editing a file and running a command, the composer reading "Steer the agent — lands between tool calls…", the Stop button -->

The dot at the start of each card shows its state. Hover over it to read the word. The three you'll meet first:

- **running:** a pulsing dot. It's still going.
- **done:** green. It finished.
- **denied:** red, with a red border. You said no to it.

:::note[The other states and marks]
You'll pick these up as you go:

- **error:** red, with the error shown under the card.
- **skipped:** amber. It didn't run, for example because the session is in [plan mode](/docs/built-in-tools/#start-plan-mode), where the agent can look around and draft a plan but can't change anything.

Some cards carry one more mark. Hover over it to read what it means:

- a check: "Allowed by you", after **Allow**, **Allow for workspace** or **Always allow**;
- a clock: "Allowed for this session";
- a skip mark: "Skipped — not allowed in plan mode";
- a red warning triangle: "Destructive command".
:::

Every button on a card and around the message box is mapped on [Session view](/docs/session-view/).

## Steer, or stop

You don't have to wait for the agent to finish. While it works, the message box reads "Steer the agent — lands between tool calls…". Whatever you type reaches the agent between two of its steps, so it can change course without stopping.

1. Type a correction or an extra detail.
2. Press **Enter**. Your message waits, marked "queued · kept on stop", until the agent's next step.

To stop the agent, click the stop button beside the message box. Its tooltip reads "Stop the agent". Anything you queued stays queued.

## Context: what the agent can see

In that same session, when the first turn ends, a note points at a small pill at the top of the session: "Everything the model knows is in the context gauge at the top — open it to see, and prune, what it holds." It answers a good question: what does the model actually know right now?

- **Context** is everything the model can see right now: the instructions HappyVibe gives it, your messages, its replies, and what its tools returned. It knows nothing else about your session.
- The **context window** is how much fits. Each model has its own size.
- A **token** is the unit both are measured in, roughly four characters of text.

The **context gauge** is that percentage pill. It's green while there's plenty of room, and turns amber, then red, as the window fills. Click it to open the **context panel**, titled "Context window", and see what's inside, piece by piece: the system prompt, the conversation, tool calls and more.

Running short on room? There are two ways to make some:

1. **Remove old parts.** Open a kind, tick the items you don't need, and click **Remove from context**. Only finished turns can be removed, never the one the agent is working on, and removing a tool call also removes its result. A removed item stays in the list, struck through, with a **restore** button to bring it back (its tooltip reads "Restore to context").
2. **Compact.** Click **Compact now…**. The app explains: "Compaction replaces older turns with a summary so the agent has room to keep going. It keeps recent messages and important decisions, and your full session history stays on disk — nothing is lost." Click **Compact now** to go ahead.

Beside the gauge, a second pill shows what this session has cost so far. Click it for the call-by-call breakdown ([Session view](/docs/session-view/#the-top-bar) explains its marks).

:::note[The fine print]
- The gauge turns amber at 35% and red at 80%. In the red, the panel says "Context is filling up."
- Hover over the gauge to see the tokens used out of the window, and whether the figure is "measured" (what the model reported for the last turn) or "estimated".
- Right after compaction the gauge reads "…%" until the next reply measures it again.
- The sizes in the panel are always estimates ("Breakdown sizes are **estimated** (≈ chars/4)."). Only the gauge can be measured.
- Messages from before a compaction can't be rewound to.
:::

## Changed your mind? Rewind

Don't like where that went? Take the session back to one of your own messages, and often your files too.

1. Wait until the agent has finished its turn. Rewind isn't offered while it's working.
2. Hover over your message and click the rewind icon beside the copy icon. Its tooltip reads "Rewind to this message — you choose whether files roll back too".
3. The app asks "Rewind to this message?" and explains what happens: everything after it is removed from the conversation, and your message moves back into the message box so you can edit and resend it. If you pick **Files only** below, the explanation changes to "The conversation and the agent's context stay exactly as they are. Only files on disk roll back to before this message."
4. Choose what to take back:
   - **Conversation only:** "Files on disk are left exactly as they are."
   - **Conversation and files:** "Also roll the workspace back to before this message."
   - **Files only:** "Roll the workspace back, keep the conversation."
5. Click **Rewind**.

The two file choices appear only when the app has something to restore for that message. Before you confirm, it tells you how many files will be restored and removed, and names any file changed since, which it leaves alone.

To undo one change instead of a whole message, see [Files and changes](/docs/files-and-changes/#undo-one-change).

## Workspace settings

Each workspace has its own settings: the model its sessions start with, its permission rules, its skills, prompts, memory and MCP servers. To open them, hover over the workspace's name in the sidebar and click the gear icon. Its tooltip reads "Workspace settings".

## Next

Sooner or later the agent asks before it acts. Here's what to do when it knocks: [Approve a tool call](/docs/approve-a-tool-call/).
