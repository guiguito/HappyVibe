---
title: Privacy
description: See what a crash report contains, read the last one sent, and turn crash reports off in one click.
---

Short version: this screen controls one thing, crash reports. They're short technical notes about the app, never about your work. You can read the last one sent, see every send in the Audit log, and one click stops them.

In the app's own words: "What leaves this machine, and how to stop it. Everything else — your sessions, your files, your keys, your audit log and your stats — stays here."

A few things this screen doesn't cover. Your conversations go to the model you picked on [Models](/docs/models/), because that's where the agent's thinking happens. HappyVibe checks for updates on its own; the [Changelog](/docs/changelog/) explains how. And the agent's web tools fetch pages through a web service, by default one HappyVibe runs, which sees the addresses and searches; [Built-in tools](/docs/built-in-tools/#choose-the-web-service) explains how to use your own.

## Where to find it

**App features** → **Privacy** in the sidebar.

## What's on the screen

### Crash reports

"Automatic, and content-free by design."

**Send crash reports** is on by default: "When HappyVibe itself breaks, send a short technical report so it can be fixed. Never your prompts, your files or your keys." The switch reads **On** while it's on. Click it to turn it off. It takes effect straight away, with no restart.

### What a crash report contains

Open **What a crash report contains** for the full answer. A report holds:

- what kind of failure it was, and the error's type
- where in HappyVibe's own code it happened
- your HappyVibe version and your operating system
- a random ID, held in memory and replaced after 30 idle minutes and at least once a day. It lets a crash be matched with feedback you sent in the same sitting, and "identifies nothing else." The last report you sent, ID included, is also kept on this computer so the Privacy page can show it after a restart. Turning off **Send crash reports** or **Send anonymous usage statistics** deletes that copy.

"It never contains your prompts, your files, your paths or your keys. Error messages are redacted before they leave, and native crash snapshots stay on your computer."

### Show the last report and the folder

- **Show the last report** displays the most recent report sent from this computer, in full. A copy stays on your computer, so it's still there after HappyVibe restarts. Click **Hide the last report** to fold it away. If none has been sent yet, the button is greyed out and the screen says "Nothing has been sent from this computer yet."
- **Reveal crash reports** shows the folder where crash snapshots are kept on your computer, selected in Finder on macOS or File Explorer on Windows. On Linux it opens in your file manager.

## Turn crash reports off

1. Open **Privacy**.
2. Next to **Send crash reports**, the switch reads **On** while reports are on. Click it to turn them off.

From that moment, nothing is sent. Click it again whenever you want to turn reports back on.

## Check what was sent

1. Open **Privacy**.
2. Click **Show the last report** to read the most recent one.
3. Open the [Audit log](/docs/audit-log/) to see every report that was sent, and when.

## During a session

If HappyVibe breaks mid-session, the report describes where in the app's own code it failed, never what you and the agent were saying. Each report that's sent is recorded in the [Audit log](/docs/audit-log/).

## Related

- [Audit log](/docs/audit-log/): a record of every crash report that left your computer.
- [Voice](/docs/voice/): dictation that never leaves your computer.
- [Models](/docs/models/): choose where your conversations go.
