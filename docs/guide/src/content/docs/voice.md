---
title: Voice
description: Dictate into the message box by holding a key, with speech turned into text on your computer so your audio never leaves it.
---

Talk instead of type. Hold a key, say what you want, and the words land in the message box, ready for you to read and send. The screen's own promise: "Speech is transcribed on this machine — your audio is never written to disk, never leaves this computer, and no transcript is ever logged."

## Where to find it

**App features** → **Voice** in the sidebar.

## What stays on your computer

- Your audio is turned into text by a speech model running on your computer. The recording is never saved to a file and never sent anywhere.
- The text goes into the message box and nowhere else. It isn't sent until you send it, and there is no separate record of what you dictated: a dictated message is kept exactly like a typed one.
- The only thing voice fetches from the internet is the speech model itself, once, when you click **Download**. After that, "Everything else about this feature works offline."

## What's on the screen

### Voice input

"Whether dictation is available at all, and whether it takes up room in the chat bar." (The chat bar is the message box and the buttons beside it.)

- **Enable voice input**: with it off, "the microphone is never opened and the keyboard shortcut does nothing. The downloaded model is kept."
- **Show mic in the chat bar**: "Off reclaims the space but keeps dictation working — the keyboard shortcut and the recording overlay are unaffected."

### Speech model

The row changes with the model's state:

- **Not set up yet**: "Voice input needs a 671 MB speech model." Click **Download**.
- **Downloading**: a progress bar and a percentage, and you can keep working while it downloads. **Cancel** stops the download.
- **Ready**: how much disk space the model uses. **Remove** deletes it: "You can download it again at any time."
- **Download failed**: the reason, and a **Retry** button.

### Language

"Pick the language you speak. There is no automatic detection — see the note below." Only languages the model supports are listed, and the weaker ones are marked "— lower accuracy". Languages the model can't handle aren't offered at all, because it "produces confident nonsense" on them rather than a rough transcript. English is selected until you pick another language.

### Microphone

- **Input device**: **System default**, or a specific microphone.
- **Test**: click it and speak. "Speak — the bar should move. If it does not, the microphone is not reaching the app." The test listens for a few seconds and records nothing.
- **Echo cancellation**, **Noise suppression**, **Automatic gain control**: all on by default. "Right for most people. Turn these off if you are on a dedicated audio interface."

### Behaviour

- **Hold threshold** (300 ms by default): "Press for longer than this and releasing stops the recording. Shorter, and it latches on."
- **Maximum recording** (5 min by default): "A safety limit, so a forgotten microphone cannot record indefinitely."

### Permissions

**Microphone access** shows whether your operating system lets HappyVibe use the microphone: **Granted**, **Denied** or **Not requested**. How you change it depends on your system:

- **macOS**: you're asked the first time you dictate. If access is denied, **Open System Settings** takes you to the right page. Quit and reopen HappyVibe for the change to take effect.
- **Windows**: nothing pops up to ask. If access is denied, "Turn the microphone on for HappyVibe in Settings → Privacy & security → Microphone." **Open System Settings** opens that page for you.
- **Linux**: the app has no way to check, so the row always reads **Granted**. Use **Test** to be sure the microphone reaches the app.

### Open source licenses

Click **Show** to see which speech model and libraries voice uses, and their licenses.

## Set up voice

1. Click the microphone in the message box, or click in the message box and press the dictation key (below).
2. The first time, "Set up voice input" opens and tells you the size of the download: **671 MB**.
3. Click **Download**. You can keep working while it downloads; the microphone becomes available when it's ready. **Not now** closes the dialog, and **More options** opens this screen.

## Dictate a message

The dictation key is the right-hand ⌘ on macOS, and the right-hand Ctrl on Windows and Linux.

1. Click in the message box.
2. Hold the dictation key and speak. A "Listening…" pill shows you're recording.
3. Let go. The pill says "Transcribing…", then your words appear in the message box.
4. Read them, fix anything, and send.

Want to talk for longer without holding the key? Tap it instead of holding it. Recording stays on until you tap it again, or click the pill. Clicking the microphone in the message box works the same way: click once to start, again to stop.

Changed your mind? Press Esc while recording, and the recording is thrown away. Nothing is transcribed.

## Test your microphone

1. Open **Voice** and find **Microphone**.
2. Pick your microphone under **Input device**, or leave **System default**.
3. Click **Test** and speak. The bar should move.
4. If it doesn't, check **Microphone access** under **Permissions** (on Linux, check your system's sound settings instead).

## During a session

The microphone sits in the message box, with its other buttons, unless you've hidden it with **Show mic in the chat bar**. Its tooltip tells you what it will do: "Dictate", plus the key to hold, when it's ready; "Set up voice input" before the model is downloaded; and "Recording — click to stop, Escape to discard" while you speak.

## Related

- [Keyboard shortcuts](/docs/keyboard-shortcuts/): the dictation key is listed under **Built-in**.
- [Privacy](/docs/privacy/): what else leaves your computer, and what doesn't.
- [Your first session](/docs/first-session/): send your first message, typed or spoken.
