---
title: First launch
description: What HappyVibe shows the first time you open it, and the two setup steps that get you to your first session.
---

The first time you open HappyVibe, it greets you with one small window in three beats: a hello, two setup steps, and a handover to your first session. You can leave it whenever you like.

## When you see it

The setup window appears only on a fresh install: no workspaces, no sessions, and you haven't closed it before. If you already have a project or a session in HappyVibe, it stays out of your way.

## 1. Say hello

The HappyVibe logo hops in from the right, the name drops into place, and the tagline appears: "Good vibes, real code."

It lasts about two and a half seconds. Any click or key skips straight to the end. If your computer is set to reduce motion, you see the finished frame instead of the animation.

## 2. Connect a model

On the right, step 1 reads "Connect a model": "The brain. Sign in with a plan you already pay for, run a free one on this computer, or paste an API key."

<!-- TODO(media): first-launch/onboarding-setup.png — The Setup step: step 1 "Connect a model" with its three choices, step 2 "Pick a project" -->

1. Pick one of the choices: **Sign in with a plan**, **Free, on this computer** or **Paste an API key**. The free choice appears only when HappyVibe finds Ollama, LM Studio or llama.cpp running on your computer with at least one model.
2. Follow it through. [Connect a model](/docs/connect-a-model/) walks through each choice.
3. When a model is ready, the step folds away to a ✓.

Want more options than the three choices show? The line under them reads "Every option lives on the **Models** page." Clicking **Models** closes the setup window and takes you there.

## 3. Pick a project

Step 2 reads "Pick a project": "A folder on your computer. The agent works in there — and asks first before touching anything outside it."

1. Choose how to start:
   - **Open a folder…** picks a folder you already have.
   - **Start fresh…** makes a new, empty one. Type a name in "Name your project" and click **Create it**. The app tells you where it goes: "Created in your Documents folder, under HappyVibe."
2. The step folds away to a ✓.

The folder you pick becomes your first workspace. A workspace is simply a project folder the agent works in.

On a Windows computer without Git for Windows, one more line appears under the steps: "Install Git for Windows for the best experience — HappyVibe will use its shell automatically, and sub-agents need it." It's a suggestion, not a blocker: without Git for Windows, the agent uses PowerShell instead.

## 4. Watch the handover

With both steps ticked, the window says "You're in." and "Opening your first session…". A moment later it closes and opens a session in your new workspace, with a few suggested first prompts waiting above the message box. [Your first session](/docs/first-session/) picks up from there.

If you quit after step 1, the next launch opens with step 1 already ticked.

## Setting up yourself instead

The ✕ in the top-right corner is the way out. Its tooltip reads "I'll set up myself".

On the keyboard, **Esc** works in two presses: the first skips the animation, and the second closes the window. Clicking outside the window does nothing, so a stray click can't close it.

Closing it is for good: the setup window doesn't come back. Nothing is lost, though. Everything it offers lives elsewhere in the app:

- Models: the [Models](/docs/models/) page. Until a model is connected, HappyVibe opens that page for you.
- Projects: **+ add** next to **workspaces** in the sidebar.

## Next

The window asked for a brain first. [Connect a model](/docs/connect-a-model/) shows every way to give it one.
