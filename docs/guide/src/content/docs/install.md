---
title: Install
description: Download HappyVibe for macOS, Windows or Linux, and get past the one extra click on first launch.
---

Welcome. This is the first of five short steps, and it takes about as long as a download. After this one, HappyVibe keeps itself up to date.

## 1. Download the app

Open the [latest release](https://github.com/guiguito/HappyVibe/releases/latest) and pick the file for your computer:

- **macOS** (Apple silicon): the `.dmg`.
- **Windows** (x64): the `Setup.exe`. On an Arm Windows machine, the x64 installer runs under emulation.
- **Linux** (x64): the `.deb` or the `.AppImage`. Step 2 helps you choose.

## 2. Install it

### macOS

1. Open the `.dmg`.
2. Drag **HappyVibe** to **Applications**.
3. Open it from **Applications**. It opens like any other app.

### Windows

1. Run the `Setup.exe`. It installs for your user only, so there is no admin prompt.
2. Windows shows a SmartScreen warning the first time. Click **More info**.
3. Click **Run anyway**.

<!-- TODO(media): install/install-smartscreen.png — Windows SmartScreen after clicking More info, with Run anyway visible -->

That's expected for this early build, and it costs two extra clicks on the first run only.

### Linux

Two packages, one choice:

- **`.deb`** installs cleanly on Ubuntu and Debian. It doesn't update itself: download each new version from the same release page.
- **`.AppImage`** runs anywhere and updates itself, but it needs `libfuse2`. Ubuntu 22.04 and later don't ship it, so install it first:

  ```bash
  sudo apt install libfuse2
  ```

  Without `libfuse2`, a double-click on the AppImage does nothing at all, with no error. The `.deb` doesn't have this problem, which is why both are built.

:::caution
Nobody has launched the Linux build on real hardware yet. It builds, packages and passes its test suite on every change, but a green test suite isn't the same as a window that opens.
:::

## 3. Let it update itself

On macOS, on Windows and with the Linux `.AppImage`, HappyVibe updates itself from now on. You won't need this page again.

## Next

The download was the boring part. [First launch](/docs/first-launch/) is where HappyVibe says hello.
