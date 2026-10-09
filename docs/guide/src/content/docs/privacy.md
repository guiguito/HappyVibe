---
title: Privacy
description: See everything HappyVibe sends on its own, turn any of it off in one click, lock it off on a managed computer, or clear all data and start fresh.
---

Short version: this screen lists everything HappyVibe sends on its own, and one click turns each thing off. It's also where you start over from scratch. Everything starts on, so the app stays handy, and nothing that goes out on its own ever carries your prompts, your files or your keys.

In the app's own words: "What leaves this machine, and how to stop it. Everything else — your sessions, your files, your keys, your audit log and your Stats page — stays here."

Two connections are controlled somewhere else: the update check is on the [Changelog](/docs/changelog/), and you can swap or turn off the free web service behind the agent's web tools on [Built-in tools](/docs/built-in-tools/#choose-the-web-service).

## Where to find it

**App features** → **Privacy** in the sidebar.

## What's on the screen

### Usage statistics

"Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects."

**Send anonymous usage statistics** is on by default. Click **On** to turn it off; it takes effect straight away. Open **What usage statistics contain** for the full list of what's counted and what never leaves.

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
- **Reveal in Finder** (**Show in File Explorer** on Windows, **Show in file manager** on Linux) shows the folder where crash snapshots are kept on your computer.

### Feedback

"Things you choose to send us. Nothing leaves until you press Send or tap a rating." If this copy of HappyVibe can't send feedback, this block isn't shown.

- **Show the feedback button**: "The megaphone in the sidebar, which opens a short form." Turn it off and the megaphone disappears from the sidebar. A message you already sent still arrives.
- **Ask how a session is going**: "Once per chat session, a one-tap rating above the message box." Turn it off and the rating never shows. Turn it back on and it can ask in sessions it skipped.

### Remote settings

"HappyVibe checks a small list of settings we can change without a release, for now only whether the free web service is available."

**Receive remote settings** is on by default. "The check carries a random device ID so gradual changes reach the same devices. Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics."

Turning it off stops the check straight away. What that costs is written under the switch: "Off, HappyVibe uses its built-in settings and we can't pause the free web service for you if it's overloaded."

### Model list

"Pi, the engine inside HappyVibe, asks pi.dev for newly released models when a session starts, at most every 4 hours. The first time the agent searches files, it also downloads two search tools from GitHub if they aren't installed."

**Check for new models** is on by default. Before you turn it off, read the line under it: "Off: models released after this version of HappyVibe only appear once you update, and if the search tools aren't on this computer yet, the agent can't download them, so its file search stops working. Applies to new sessions."

### Clear all data

"Start over as if HappyVibe were just installed." The **Clear all data…** button is at the bottom of the screen. See [Clear all data and start over](#clear-all-data-and-start-over).

## Turn things off

Every switch starts on. Each one acts straight away, except **Check for new models**, which applies to new sessions.

1. Open **Privacy**.
2. Click **On** next to the switch you want off. It reads **Off**, and from that moment that thing isn't sent. Click it again whenever you want it back.

Where each switch lives:

- On **Privacy**: **Send anonymous usage statistics**, **Send crash reports**, **Show the feedback button**, **Ask how a session is going**, **Receive remote settings** and **Check for new models**.
- On the [Changelog](/docs/changelog/): **Check for updates automatically**.
- On [Built-in tools](/docs/built-in-tools/#choose-the-web-service): pick **Your own** web service, or turn the web tools off.

## On a managed computer

On a company laptop, a lab machine, or a network that only lets approved addresses through, an administrator can turn things off before anyone opens the app, with an environment variable. A variable only ever turns something off. The switch it holds is off and greyed out, with the line "Turned off on this computer by an environment setting." and a **Learn more** link.

| Variable | Turns off |
|---|---|
| `HV_NO_PHONE_HOME` | Everything else in this table |
| `HV_NO_USAGE_STATS` | Usage statistics |
| `HV_NO_CRASH_REPORTS` | Crash reports |
| `HV_NO_FEEDBACK` | The feedback button and the session rating. Nothing waiting to be sent goes out while it's set |
| `HV_NO_REMOTE_CONFIG` | Remote settings |
| `HV_NO_UPDATE_CHECK` | The update check, including **Check now**. Download new versions yourself |
| `HV_NO_DEFAULT_WEB` | HappyVibe's free web service. Your own web service still works |
| `PI_OFFLINE` | Pi's own variable: the model list and the search-tool download |

Only the value `1` counts: `0`, an empty value or anything else leaves the switch alone. `PI_OFFLINE` is different: Pi treats it as set whatever its value, so set it only to `1`, and remove it to turn the model list back on. With the model list off, install `fd` and `rg` yourself if file search should keep working.

Your conversations still go to the model you picked on [Models](/docs/models/). No variable changes that.

**On macOS**, an app you open from the Dock or Finder doesn't read your shell's variables, so a line in `~/.zshrc` does nothing for it. Set the variable for your login session instead. A LaunchAgent that runs `launchctl setenv` does it at every login: save this as `~/Library/LaunchAgents/dev.happyvibe.env.plist` (or deploy it to `/Library/LaunchAgents/` from your device management tool), then log out and back in.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.happyvibe.env</string>
  <key>ProgramArguments</key>
  <array><string>launchctl</string><string>setenv</string><string>HV_NO_PHONE_HOME</string><string>1</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

For a single launch, quit HappyVibe first, then run `open -a HappyVibe --env HV_NO_PHONE_HOME=1` in Terminal.

**On Linux**, start it with the variable set:

```bash
HV_NO_PHONE_HOME=1 happyvibe
```

That works for the `.deb`. For the AppImage, put the variable before its path: `HV_NO_PHONE_HOME=1 ./HappyVibe-….AppImage`. To make it stick, copy HappyVibe's `.desktop` file to `~/.local/share/applications/` and change its `Exec=` line to start with `env HV_NO_PHONE_HOME=1`.

**On Windows**, set `HV_NO_PHONE_HOME` to `1` in your user environment variables (search the Start menu for "Edit environment variables for your account"), then quit and restart HappyVibe.

## Check what was sent

1. Open **Privacy**.
2. Click **Show the last report** to read the most recent one.
3. Open the [Audit log](/docs/audit-log/) to see every report that was sent, and when.

## Clear all data and start over

Uninstalling HappyVibe keeps your data, so reinstalling doesn't start fresh. To start over:

1. Open **Privacy** and click **Clear all data…**.
2. Read what goes, then click **Clear all data**, or **Cancel**.
3. HappyVibe closes and reopens on its first-run screen.

Nothing is deleted until you click **Clear all data** in the dialog. After that, it can't be undone.

- **What goes:** every chat, workspace, setting, permission rule, sign-in and API key, your memory, schedules and Audit log, downloaded voice models, and the worktrees HappyVibe made.
- **What stays:** the branches of those worktrees, in your repositories, and everything inside your project folders. HappyVibe writes two folders there, `.pi-subagents/` and `.agents/plans/`. Delete them yourself if you want them gone.
- **When it refuses:** if a worktree has changes you haven't committed, or its project can't be found (moved, renamed, or on a drive that isn't plugged in), the dialog says "Some worktrees have unsaved work", lists them, and deletes nothing. Commit or discard those changes, or move the folder somewhere safe, then try again.

## During a session

If HappyVibe breaks mid-session, the report describes where in the app's own code it failed, never what you and the agent were saying. Each report that's sent is recorded in the [Audit log](/docs/audit-log/).

## Related

- [Changelog](/docs/changelog/): the update check and automatic downloads.
- [Built-in tools](/docs/built-in-tools/#choose-the-web-service): choose the web service.
- [Audit log](/docs/audit-log/): a record of every crash report that left your computer.
- [Voice](/docs/voice/): dictation that never leaves your computer.
- [Models](/docs/models/): choose where your conversations go.
