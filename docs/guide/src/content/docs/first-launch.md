---
title: First launch
description: What HappyVibe shows the first time you open it, and the three setup steps that get you to your first session.
---

The first time you open HappyVibe, it greets you with one small window: a hello, three setup steps, and a last "You're in." before your first session. This is step 2 of 5, and you can leave it whenever you like.

## When you see it

The setup window appears only on a fresh install, before you've added a project or started a session, and only until you close it. If you've used HappyVibe before, it stays out of your way. Stuck or curious? During the first two steps, a **Read the setup guide ↗** link under the tagline opens this page in your browser, and setup stays where it is.

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

If you quit after this step, the next launch opens with it already ticked.

## Pick a project

The second step reads "Pick a project": "A folder on your computer. The agent works in there — and asks first before touching anything outside it."

1. Choose how to start:
   - **Open a folder…** picks a folder you already have.
   - **Start fresh…** makes a new, empty one. Type a name in "Name your project" and click **Create it**. The app tells you where it goes: "Created in your Documents folder, under HappyVibe."
2. The step folds away to a ✓.

The folder you pick becomes your first workspace. A workspace is how a project shows up in HappyVibe's sidebar: the project is the folder and its files, and the workspace is where you start sessions on it and keep its settings.

On a Windows computer without Git for Windows, one more line appears under the steps: "Install Git for Windows for the best experience — HappyVibe will use its shell automatically, and sub-agents need it." In plain words: HappyVibe works best with Git for Windows, and subagents (helper agents the main agent hands work to) need it. Without it, the agent runs its commands in PowerShell instead.

## Personalize your agent

With the first two steps ticked, the hello panel on the left steps aside and step 3 takes the whole window. A line at the top shows the two finished steps with their ✓, and under it the third step reads "Personalize your agent": "Your agent comes fully loaded. Untick anything you don't want."

<!-- TODO(media): first-launch/onboarding-kit.png — Step 3 "Personalize your agent" with its tiles, total and Continue button -->

Nothing here is final, and nothing happens on a timer. You can change every choice later.

- **The tiles.** Each one is a group of abilities the agent has: **Plan mode**, **Ask user**, **Agent terminal — 3 tools**, **Agent browser — 10 tools**, **Web tools — 4 tools**, **Memory — 3 tools**, **Schedules — 4 tools**, **Documents — 1 tool**, **Sub-agents — 4 tools** and **Skills**, plus **Images — 1 tool** when you have an OpenRouter key or sign-in. **Prompts** comes last. Hover a tile to read what it does. Tick or untick the box to switch the group on or off. Prompts has no box: there's nothing to switch off as a group, because prompts weigh nothing until you use one. **Workflows** isn't a tile here: it starts off, and you can turn it on later from **Built-in tools**.
- **The grey weights.** Under each tile's name is what it adds to every message, like "~1.1k tokens". A token is the unit a model reads text in, roughly four characters. Skills and Sub-agents add "with the bundled ones on", because they grow with what you add later.
- **Skills, Sub-agents and Prompts** each have a ▸ and a number. Click it and the tiles make way for that list: every skill or agent gets a tick of its own and its own weight, so you can drop single ones. Prompts are the ready-made messages you start with /. Unticking one switches it off, and **Prompts** in the sidebar turns it back on. The list has the group's name as its heading, with its weight beside it. Click the back arrow above it (its tooltip reads "Back"), or press **Esc**, to return to the tiles. While the group itself is unticked, its list is greyed out.
- **The total.** In the bottom-right corner, beside **Continue**: "~N tokens on every message", with N for whatever is ticked right now, plus the core tools the agent always has for reading, editing and running commands. It moves as you tick, and stays put when a list opens.
- **The reminder.** On the left of that row: "You can change all of it later on Built-in tools, Skills and Agents."

Nothing is saved yet, apart from one safety setting for small models, explained next. Click **Continue** when you're happy.

### If your model has a small window

Every model can read only so much at once, its context window ([what that is](/docs/first-session/#context-what-the-agent-can-see)). When the full set would take more than a quarter of your model's window, step 3 opens with every tile unticked, and says so: "Your model reads 8,192 tokens at a time and the full kit takes about 13.2k, so you're starting with just the basics." (The numbers here are examples; the window shows yours.) The agent keeps the core tools and can still read, edit and run commands. Click **Load everything anyway** to put every tile back on. The line goes away once you do, or as soon as you tick any tile.

If the window is very small, no bigger than the room HappyVibe's agent keeps free for its own summarising, the agent starts condensing your conversation almost at once, so there's no room for real work. Then a red line appears: "Even the basics fill about 40% of it — too little room for real work." (The percentage is yours.) Or, when they take all of it: "Even the basics don't fit in it — too little room for real work." Click **Give your model more room ↗** to open [Give your model more room](/docs/connect-a-model/#give-your-model-more-room), which shows how.

## You're in

Setup's done, and your agent is ready when you are. After **Continue**, a 🎉 pops and the window says "You're in." At the bottom:

- **The consent line.** "Anything that changes your files or runs a command asks you first."
- **The footer.** "Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each."

Under those two lines, click **Start my first session**. The window saves your choices, closes, and opens a session in your new workspace, with a few suggested first prompts waiting above the message box. Changed your mind about a tile? The back arrow in the top-left corner takes you to step 3 again.

## Setting up yourself instead

The ✕ in the top-right corner is the way out while you're on the first two steps. Its tooltip reads "I'll set up myself". It's gone from step 3 and from "You're in.": you leave those by starting your session.

On the keyboard, **Esc** closes the window during the first two steps. While the animation plays, the first **Esc** skips it and a second one closes the window. On step 3, **Esc** means **Continue** (inside a Skills, Sub-agents or Prompts list, it takes you back to the tiles), and on "You're in." it means **Start my first session**, with whatever is ticked. Clicking outside the window does nothing, so a stray click can't close it.

Quit on step 3 or on "You're in." and the window doesn't come back either: your project is already added, so the next launch opens straight into the app. Your ticks on step 3 aren't saved, and you can set them any time on **Built-in tools**, **Skills**, **Agents** and **Prompts**.

Once closed, the window doesn't come back, and you don't need it to. Everything it offers lives elsewhere in the app:

- Models: the [Models](/docs/models/) page. Until a model is connected, HappyVibe opens that page for you.
- Projects: **+ add** next to **workspaces** in the sidebar.

## Next

Done with setup? Your session is waiting: jump to [Your first session](/docs/first-session/). Want to see every way to connect a model first? [Connect a model](/docs/connect-a-model/) has them all.
