---
title: First launch
description: What HappyVibe shows the first time you open it, and the two setup steps that get you to your first session.
---

The first time you open HappyVibe, it greets you with one small window in three beats: a hello, two setup steps, and a last look at everything your agent comes with. This is step 2 of 5, and you can leave it whenever you like.

## When you see it

The setup window appears only on a fresh install, before you've added a project or started a session, and only until you close it. If you've used HappyVibe before, it stays out of your way. Stuck or curious? While you set up, a **Read the setup guide ↗** link under the tagline opens this page in your browser, and setup stays where it is.

## Say hello

The HappyVibe logo hops in from the right, the name drops into place, and the tagline appears: "Good vibes, real code."

It lasts about two and a half seconds. Any click or key skips straight to the end. If your computer is set to reduce motion, you see the finished frame instead of the animation.

## Connect a model

The app's first step reads "Connect a model": "The brain. Sign in with a plan you already pay for, run a free one on this computer, or paste an API key."

<!-- TODO(media): first-launch/onboarding-setup.png — The Setup step: step 1 "Connect a model" with its three choices, step 2 "Pick a project" -->

1. Pick one of the choices: **Sign in with a plan**, **Free, on this computer** or **Paste an API key**. The free choice appears only when HappyVibe finds Ollama, LM Studio or llama.cpp (free apps that run AI models on your own computer) running with at least one model.
2. Follow it through. [Connect a model](/docs/connect-a-model/) walks through each choice.
3. When a model is ready, the step folds away to a ✓. If the provider refuses your key, the step stays open with a red line saying why, so you can paste another.

Want more than the three choices? The line under them reads "Every option lives on the **Models** page." Clicking **Models** closes the setup window and takes you there.

## Pick a project

The second step reads "Pick a project": "A folder on your computer. The agent works in there — and asks first before touching anything outside it."

1. Choose how to start:
   - **Open a folder…** picks a folder you already have.
   - **Start fresh…** makes a new, empty one. Type a name in "Name your project" and click **Create it**. The app tells you where it goes: "Created in your Documents folder, under HappyVibe."
2. The step folds away to a ✓.

The folder you pick becomes your first workspace. A workspace is how a project shows up in HappyVibe's sidebar: the project is the folder and its files, and the workspace is where you start sessions on it and keep its settings.

On a Windows computer without Git for Windows, one more line appears under the steps: "Install Git for Windows for the best experience — HappyVibe will use its shell automatically, and sub-agents need it." In plain words: HappyVibe works best with Git for Windows, and subagents (helper agents the main agent hands work to) need it. Without it, the agent runs its commands in PowerShell instead.

## Check what your agent comes with

With both steps ticked, the window says "You're in." and "Your agent comes fully loaded." Under it: "Untick anything you don't want. You can change all of it later on Built-in tools, Skills, Agents and Prompts."

<!-- TODO(media): first-launch/onboarding-kit.png — The kit beat with its tiles, total and Start button -->

Nothing here is final: you can change every choice later on those pages. Nothing happens on a timer either. The window waits until you click **Start my first session**.

- **The tiles.** Each one is a group of abilities the agent has: **Plan mode**, **Ask user**, **Agent terminal — 3 tools**, **Agent browser — 10 tools**, **Web tools — 4 tools**, **Memory — 3 tools**, **Schedules — 4 tools**, **Documents — 1 tool**, **Sub-agents — 4 tools** (with **Workflows — 1 tool** inside its tile) and **Skills**, plus **Images — 1 tool** when you have an OpenRouter key or sign-in, and **Core tools** and **Prompts**. Hover a tile to read what it does. Tick or untick the box to switch the group on or off. **Ask user** stays ticked while **Plan mode** is ticked, because plan mode needs it. **Workflows** has its own box inside the **Sub-agents** tile, and stays unticked while **Sub-agents** is unticked.
- **Core tools and Prompts** have no box of their own. Click the ▸ and number beside them, and every tool or ready-made prompt opens to one tick each. **Skills** and **Sub-agents** open the same way, so you can drop single skills or agents. Prompts read "Ready-made prompts you start with /. They weigh nothing until you use one."
- **The grey weights.** Under each tile's name is what it adds to every message, like "~1.1k tokens". A token is the unit a model reads text in, roughly four characters. Skills and Sub-agents add "with the bundled ones on", because they grow with what you add later. Open a tile and each skill, agent or core tool shows its own weight beside its name; prompts, and tools that weigh nothing, show none.
- **The total.** At the bottom, above the two buttons: "~N tokens on every message", with N for whatever is ticked right now. It moves as you tick.
- **Just the basics** unticks every group at once. Your ticks on **Core tools**, skills, agents and prompts stay as they were. The agent keeps the core tools and can still read, edit and run commands.
- **The consent line.** "Anything that changes your files or runs a command asks you first."
- **The footer.** "Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each."

Nothing is saved until you start, apart from the small-model preset below.

### If your model has a small window

Every model can read only so much at once, its context window ([what that is](/docs/first-session/#context-what-the-agent-can-see)). When the full set would take more than a quarter of your model's window, the window opens with **Just the basics** already applied, and says so: "Your model reads 8,192 tokens at a time and the full kit takes about 13.2k, so you're starting with just the basics." (The numbers here are examples; the window shows yours.) Click **Load everything anyway** to put every group back on, except **Workflows**, which starts off on a fresh install. The line goes away once you do.

If the window is very small, no bigger than the room HappyVibe's agent keeps free for its own summarising, the agent starts condensing your conversation almost at once, so there's no room for real work. Then a red line appears: "Even the basics fill about 40% of it — too little room for real work." (The percentage is yours.) Or, when they take all of it: "Even the basics don't fit in it — too little room for real work." Click **Give your model more room ↗** to open [Give your model more room](/docs/connect-a-model/#give-your-model-more-room), which shows how.

### Start

Click **Start my first session**. The window saves your choices, closes, and opens a session in your new workspace, with a few suggested first prompts waiting above the message box. Press **Esc** and you start the same way, with whatever is ticked.

If you quit after the first step, the next launch opens with it already ticked.

## Setting up yourself instead

The ✕ in the top-right corner is the way out while you're on the two setup steps. Its tooltip reads "I'll set up myself". It's gone from the last window, which has no ✕: you leave it by starting your session.

On the keyboard, **Esc** closes the window during the setup steps. While the animation plays, the first **Esc** skips it and a second one closes the window. On the last window, **Esc** means **Start my first session**. Clicking outside the window does nothing, so a stray click can't close it.

Once closed, the window doesn't come back, and you don't need it to. Everything it offers lives elsewhere in the app:

- Models: the [Models](/docs/models/) page. Until a model is connected, HappyVibe opens that page for you.
- Projects: **+ add** next to **workspaces** in the sidebar.

## Next

Done with setup? Your session is waiting: jump to [Your first session](/docs/first-session/). Want to see every way to connect a model first? [Connect a model](/docs/connect-a-model/) has them all.
