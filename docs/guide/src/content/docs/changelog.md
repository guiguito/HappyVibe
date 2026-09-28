---
title: Changelog
description: See which version of HappyVibe you're running, what changed in each release, and how updates reach you.
---

Which version are you on, and what's new in it? It's all here, along with how updates reach you. Mostly, they just arrive.

## Where to find it

**The record** → **Changelog** in the sidebar.

## What's on the screen

### Your version

The heading is "HappyVibe" and the number of the version you're running. The line under it lists the versions of the agent engine and the parts bundled with it, for example "Pi 0.86.1 · sub-agents 0.19.0 · MCP adapter 2.35.0 · anydoc 0.2.4". Anydoc is the document converter.

### Update controls

Under the version, one line says when the app last looked for an update: "Not checked yet", "Last checked just now" or "Last checked 12 min ago", for example. Next to it, **Check now** looks straight away. While it looks, the line reads "Checking…". If you're up to date, it says "You're on the latest version." If a check you asked for fails, the error shows here, word for word.

You don't have to remember to check: the app looks on its own shortly after it starts, then every few hours.

Below that, the **Download updates automatically** switch. It starts on: a new version downloads in the background, and you choose when to restart into it. Turn it off, and the app only tells you a new version is out, then waits for you to click **Download**.

On Linux, a copy installed from a `.deb` package can't replace itself, so this switch isn't shown. When an update is out, **Download** opens the release page instead.

In a development build, the controls are replaced by one line: "Updates are off in development builds." That build never checks and never installs over itself.

### The notes

The rest of the page is the release notes, newest first. They ship inside the app, so they're there even offline. After an update, this page shows the new version's notes.

## Update to a new version

1. When a version has downloaded, a quiet line appears just above the message box in your session: "HappyVibe 0.2.0 is ready · **Restart to update**", with the new version number.
2. Click **Restart to update**. HappyVibe restarts into the new version.
3. If a session is still working or waiting for your answer, the button reads **Restart when the running session finishes** (or **Restart when the 2 running sessions finish**) instead. Click it and the line changes to "Will restart when they finish": the restart waits, so nothing is cut off mid-turn.

If terminals are open, the line adds "open terminals will close". To dismiss the line for now, click ✕ (**Hide until next launch**). A downloaded update still installs the next time you quit.

## Check for an update yourself

1. Open **The record** → **Changelog**.
2. Click **Check now**.
3. Wait for "Checking…" to finish. "You're on the latest version." means you're up to date. If a new one is out, the line above the message box in your session says so.

## During a session

Updates show up only as that one line above the message box. With automatic downloads off, it reads "HappyVibe 0.2.0 is out · **Download**", with the new version's number. While a version downloads, it reads "Downloading HappyVibe 0.2.0 — 42%".

## Related

- [Install](/docs/install/): getting HappyVibe onto your computer in the first place.
- [Privacy](/docs/privacy/): what the app sends, and when.
