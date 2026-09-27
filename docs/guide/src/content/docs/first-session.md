---
title: Your first session
description: Add a project, start a session, ask for a change, and follow what the agent does, card by card.
---

A session is one conversation with the agent, inside one project. You ask, it works, and every step it takes shows up as a card you can open. An empty session says it best: "Ready when you are." and "Ask for a change and the agent gets to work. Anything risky knocks first."

If you just finished the [first launch](/docs/first-launch/) setup, your first session is already open. Skip to step 3.

## 1. Add a workspace

A workspace is a project folder the agent works in.

1. In the sidebar, next to **workspaces**, click **+ add**. When no session is open, the middle of the window also offers **Add a workspace folder…**.
2. Pick a folder. It appears in the sidebar under **workspaces**.

## 2. Start a session

1. Click the **+** next to your workspace's name.
2. If the folder is a git repository, the **+** opens a small menu: click **New session**. Otherwise it starts the session straight away.

Or press ⌘N on macOS, Ctrl+N on Windows and Linux, for a new session in the current workspace.

## 3. Ask for something

1. Type what you want in the message box. It reads "Ask for a change… (@ to add a file)". Type @ to point the agent at a file.
2. Press **Enter** to send. **Shift+Enter** starts a new line.

In the session the setup window opens for you, a few suggested prompts sit above the message box. They're matched to your folder. A folder that already holds files gets ideas like "Give me a tour of this codebase". An empty one gets ideas like "Make a snake game I can open in my browser".

Clicking one fills the message box and never sends it. Change it as much as you like, then press **Enter** yourself. The suggestions leave for good once you send your first message.

## 4. Watch it work

Every tool the agent uses shows up as a card, with a plain description of what it's doing: "Editing" or "Creating" and the file's name, or a command described in words. Expand a card to see exactly what it did. In your very first session, the app says so too: "Each card is a tool the agent ran — expand one to see exactly what it did."

<!-- TODO(media): first-session/session-running.png — A turn in progress: tool cards editing a file and running a command, the composer reading "Steer the agent — lands between tool calls…", the Stop button -->

The dot at the start of each card shows its state. Hover over it to read the word:

- **running:** a pulsing dot. It's still going.
- **done:** green. It finished.
- **error:** red, with the error shown under the card.
- **denied:** red, with a red border. You said no to it.
- **skipped:** amber. It didn't run, for example because plan mode doesn't allow it.

A few cards carry one more mark. Hover over it to read what it means:

- a check: "Allowed by you";
- a clock: "Allowed for this session";
- a red warning triangle: "Destructive command".

Some calls wait for your yes before they run. [Approve a tool call](/docs/approve-a-tool-call/) is next, and covers them.

## 5. Steer, or stop

You don't have to wait for the agent to finish. While it works, the message box reads "Steer the agent — lands between tool calls…".

1. Type a correction or an extra detail.
2. Press **Enter**. Your message waits, marked "queued · kept on stop", and reaches the agent between two tool calls.

To stop the agent, click the stop button beside the message box. Its tooltip reads "Stop the agent". Anything you queued stays queued.

When the first turn ends, one more note appears: "Everything the model knows is in the context gauge at the top — open it to see, and prune, what it holds." The context is everything the model can see right now: your messages, its replies and what its tools returned.

## Next

Sooner or later the agent asks before it acts. Here's what to do when it knocks: [Approve a tool call](/docs/approve-a-tool-call/).
