---
title: Install
description: Download HappyVibe for macOS, Windows or Linux, and get past the Windows warning on first launch.
---

Getting started takes five short steps, and this first one is mostly waiting for a download. Once it's installed, HappyVibe keeps itself up to date (one Linux package is the exception, see below).

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

## Next

The download was the boring part. On to [First launch](/docs/first-launch/), where HappyVibe says hello.
