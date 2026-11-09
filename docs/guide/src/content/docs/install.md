---
title: Install
description: Download HappyVibe for macOS, Windows or Linux, and get past the Windows warning on first launch.
---

Getting started takes five short steps, and this first one is mostly waiting for a download. Once it's installed, HappyVibe keeps itself up to date (one Linux package and the browser mode below are the exceptions).

## Download the app

Open the [latest release](https://github.com/guiguito/HappyVibe/releases/latest) and pick the file for your computer:

- **macOS** (Apple silicon): the `.dmg`.
- **Windows** (x64): the `Setup.exe`.
- **Linux** (x64): the `.deb` or the `.AppImage`. The Linux section below helps you choose.

On an Arm Windows PC, the same `Setup.exe` works: Windows runs it under emulation.

## Install on macOS

1. Open the `.dmg`.
2. Drag **HappyVibe** to **Applications**.
3. Open it from **Applications**. It opens like any other app.

## Install on Windows

1. Run the `Setup.exe`.
2. Windows shows a SmartScreen warning the first time. Click **More info**.
3. Click **Run anyway**.
4. Follow the installer's screens. It installs for your user only, so there's no admin prompt, and you can change the folder it installs to.

<!-- TODO(media): install/install-smartscreen.png — Windows SmartScreen after clicking More info, with Run anyway visible -->

The SmartScreen warning is expected for this early build. It costs two extra clicks, on the first run only.

## Install on Linux

Two packages, one choice:

- **`.deb`** installs cleanly on Ubuntu and Debian. It doesn't update itself: download each new version from the same release page.
- **`.AppImage`** runs anywhere and updates itself, but it needs `libfuse2`. Ubuntu 22.04 and later don't include it, so install it first:

  ```bash
  sudo apt install libfuse2
  ```

  Without `libfuse2`, a double-click on the AppImage does nothing at all, with no error. The `.deb` doesn't have this problem. That's why there are two.

:::caution
The Linux build is new. It's checked automatically on every change, but nobody has opened it on a real Linux computer yet. If something looks off, tell us in a [GitHub issue](https://github.com/guiguito/HappyVibe/issues).
:::

## Use it from a browser

You don't need this to get started. HappyVibe can also run without a window of its own and open in a browser tab instead: on the same computer, or from a Linux system under WSL to a browser on Windows.

1. Quit HappyVibe if it's open.
2. Start it from a terminal, with `HV_SERVE` and a port in front of its command. On macOS:

   ```bash
   HV_SERVE=8787 /Applications/HappyVibe.app/Contents/MacOS/HappyVibe
   ```

   On Linux or WSL, with the `.deb`:

   ```bash
   HV_SERVE=8787 happyvibe
   ```

3. It prints "Open this link once — it carries the access token", followed by a link. Open that link in your browser. It prints the same link through `localhost` too: from Windows into WSL, if one doesn't open, try the other.

The token is the part after the `#`. Your browser keeps it for that address, so while HappyVibe keeps running, `http://127.0.0.1:8787` is enough. To stop HappyVibe, press **Ctrl+C** in its terminal.

If the connection drops or HappyVibe stops, the page says so, for how long, and what the browser reported, and keeps trying. **Retry now** tries at once. When HappyVibe is running again, the page picks up where it was. If HappyVibe started again with a new link, the page asks you to open that one.

Each browser tab is one HappyVibe window. Closing the tab doesn't stop anything: the window waits, terminals and all, and the next tab you open picks it back up.

A few things work differently in a tab:

- The built-in browser can't show its page there. The pane says "This page shows in the desktop app", with **Open in a new tab** to see it yourself, and the agent can still use it.
- ⌘W, ⌘T and ⌘N on macOS (Ctrl+W, Ctrl+T and Ctrl+N on Windows and Linux) stay the browser's: closing the page asks first. Use **+** for a new session or terminal.
- Folder and file pickers open on the computer running HappyVibe. With WSL, that's your Windows desktop.
- A document dropped from your desktop isn't attached (a picture is). Use **+** › **Attach document** in the message box instead.
- Dictation uses your browser's microphone, and the browser asks you first.
- HappyVibe doesn't update itself in this mode. Open it as a desktop app to update.

:::caution
Keep the link to yourself: whoever has it can run commands on this computer. HappyVibe only answers on this computer (`127.0.0.1`). To use it from another one, run `ssh -L 8787:127.0.0.1:8787` followed by this computer's name on the other computer, then open the link there. Folder and file pickers still open on this computer's screen.
:::

## Next

The download was the boring part. On to [First launch](/docs/first-launch/), where HappyVibe says hello.
