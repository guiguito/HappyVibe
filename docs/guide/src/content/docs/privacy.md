---
title: Privacy
description: See what HappyVibe sends in the background, what a crash report contains, and how to switch crash reports off.
---

"What leaves this machine, and how to stop it. Everything else — your sessions, your files, your keys, your audit log and your stats — stays here."

This screen covers what HappyVibe sends on its own: crash reports. Your conversations do go to the model you picked on [Models](/docs/models/), because that's where the agent's thinking happens. Nothing on this page changes that.

## Where to find it

**App features** → **Privacy** in the sidebar.

## What's on the screen

### Crash reports

"Automatic, and content-free by design."

**Send crash reports** is **On** by default: "When HappyVibe itself breaks, send a short technical report so it can be fixed. Never your prompts, your files or your keys." Click the button to switch it **Off**. It takes effect straight away, with no restart.

### What a crash report contains

Open **What a crash report contains** for the full answer. A report holds:

- what kind of failure it was, and the error's type
- where in HappyVibe's own code it happened
- your HappyVibe version and your operating system
- a random ID that changes after 30 idle minutes and at least once a day, kept only in memory. It "lets a crash be matched with feedback you sent in the same sitting, and identifies nothing else."

"It never contains your prompts, your files, your paths or your keys. Error messages are redacted before they leave, and native crash snapshots stay on your computer."

### Show the last report and the folder

- **Show the last report** displays the most recent report sent since HappyVibe started, in full. Click **Hide the last report** to fold it away. If none has been sent since the app started, the button is greyed out and the screen says "Nothing has been sent from this computer yet."
- **Reveal crash reports** opens the folder where crash snapshots are kept on your computer, in Finder on macOS, File Explorer on Windows, or your file manager on Linux.

## Switch crash reports off

1. Open **Privacy**.
2. Click **On** next to **Send crash reports**. It turns to **Off**.

From that moment, nothing is sent. Switch it back **On** whenever you like.

## Check what was sent

1. Open **Privacy**.
2. Click **Show the last report** to read the most recent one since the app started.
3. Open the [Audit log](/docs/audit-log/) to see every report that was sent, and when.

## During a session

Nothing on this screen shows up in your sessions. If HappyVibe breaks mid-session, the report describes where in the app's own code it failed, never what you and the agent were saying. Each report that's sent is recorded in the [Audit log](/docs/audit-log/).

## Related

- [Audit log](/docs/audit-log/): a record of every crash report that left your computer.
- [Voice](/docs/voice/): dictation that never leaves your computer.
- [Models](/docs/models/): choose where your conversations go.
