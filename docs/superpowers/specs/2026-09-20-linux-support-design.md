# Linux support — design

**Round:** PRD §4, 2026-09-20. **Status:** locked.
**Predecessor:** the Windows round (`2026-09-13-windows-support.md`), whose closing sentence
was *"Linux falls out of the same seam and stays out of this round."* This round collects
what fell out, and finds the three things that did not.

---

## 1. What is already built

Linux is not a port. The Windows round put every platform question behind one injected seam,
and the Linux arms were written at the same time — they have simply never been run.

| Capability | Where | Pinned by |
| --- | --- | --- |
| Child launcher → `bin/pi-node.sh` | `src/main/platform.ts` | `tests/platform.test.ts:49` |
| Terminal shell → `/bin/bash` | `src/main/platform.ts` | `tests/platform.test.ts:156` |
| Packaged resource layout (flat beside the executable) | `build/afterPackLayout.mjs:29` | `tests/afterpack-layout.test.ts:39` |
| Window / taskbar icon | `src/main/index.ts:236` | — |
| Voice engine | `sherpa-onnx-linux-x64` | `tests/voice-runtime-contract.test.ts:31` |
| Modifier copy → `Ctrl` | `src/renderer/src/platformCopy.ts` | `tests/mod-key-copy.test.ts:51` |
| Reveal copy → "Show in file manager" | `src/renderer/src/platformCopy.ts` | `tests/mod-key-copy.test.ts:118` |
| Voice gesture → `ControlRight` | `src/renderer/src/voice/gesture.ts` | `tests/voice-gesture.test.ts:28` |

Measured 2026-09-20 in a `node:24` linux/amd64 container, repo cloned inside so the macOS
tree was never touched: **`npm run build` is green** — all three typechecks and the
electron-vite build, 4.41 s. **`npm test` is `14 failed | 3943 passed | 55 skipped`.**

**Do not plan fixes off that red list.** Three of its five files fail for reasons belonging to
the container, not to Linux: `model-exclusions` ran as **root**, where `chmod 000` cannot deny
the owner a read (this is the existing `CAN_DENY_READ` capability case, and GitHub's
`ubuntu-latest` runs as the non-root `runner`); `mcp-adapter-store` had no Electron binary to
spawn; and the eleven pty failures across `terminals` / `agent-terminals` report
`execvp(3) failed.` — a shell the container does not have. The first task of the plan is to
land the CI job and read the real list from a real runner.

## 2. Decisions

### D1 — Format: AppImage **and** deb, x64

Both, and the reason is that neither alone is honest. AppImage runs anywhere and needs no
install, but on Ubuntu 22.04 and later it needs `libfuse2`, which is **not installed by
default** — a double-click does nothing, with no error and nothing to read. `.deb` is the one
that works out of the box on the distributions most of this audience runs, and it is the only
one of the two that can *declare* what it needs (D3).

### D2 — x64 only, and for a different reason than Windows

Windows is x64-only because `sherpa-onnx` and `@firecrawl/anydoc` publish **no** win-arm64
build: the constraint is availability. On Linux both publish arm64 (verified on the registry,
2026-09-20), so linux-arm64 is *possible*. It is excluded because **nothing tests it**, and a
target nobody runs is a promise nobody keeps. Writing the two reasons down separately matters:
Windows arm64 unblocks when upstream ships a binary, Linux arm64 unblocks when we add a runner.

### D3 — The keychain dependency is already declared, and writing it down would break it

MCP OAuth tokens live in the OS keychain through `pi-mcp-adapter`; on Linux that is libsecret.
electron-builder 26 **already lists `libsecret-1-0`** in its default deb dependencies
(`app-builder-lib/out/targets/FpmTarget.js:315`, alongside `libgtk-3-0`, `libnotify4`,
`libnss3`, `libxss1`, `libxtst6`, `xdg-utils`, `libatspi2.0-0`, `libuuid1`).

So the correct action is to **write no `deb.depends` at all** — and that is not the lazy
reading, it is the load-bearing one. A `depends:` key does not extend the defaults, it
**replaces** them (`FpmTarget.js:185-194` assigns straight to `customDepends`). Adding the one
line that looks like it fixes this problem — `deb: { depends: ["libsecret-1-0"] }` — would drop
`libgtk-3-0` and `libnss3` and ship a package that installs cleanly and will not launch. This is
pinned by a test asserting the key is **absent**, with the reason, because an absence cannot be
inferred from the config and the next person to read it will want to add the line.

AppImage cannot declare anything, so there it degrades: the adapter surfaces its own error. We
do not invent a fallback token store — the same rule the MCP keychain drift already established.

### D4 — The file tree does not live-refresh on Linux, and that is recorded, not fixed

`src/main/watch.ts:10` already carries the ceiling: recursive `fs.watch` does not exist on
Linux, so `watchWorkspace` returns early and the renderer keeps its manual refresh path. A
per-directory watcher fan-out is a feature, not a platform fix, and it is out of this round.
This is the one user-visible capability gap between Linux and the other two platforms, so it
belongs in the PRD rather than only in a source comment.

### D5 — The Linux CI job is required, in the same shape as Windows

`tests/ci-windows-required.test.ts` exists because `continue-on-error: true` once let a red
Windows job report a green tick on a PR, hiding a bug neither developer machine could
reproduce. The same flag would do the same thing here. The job is required, and that test grows
from "the Windows job gates" to "every platform job gates", so a fourth platform inherits the
rule instead of re-learning it.

### D6 — A rendered icon set, and the desktop-entry half nobody sees until it is wrong

The *app* icon is already correct: `src/main/index.ts:236` hands Electron
`resources/icon.png` on Linux. What is missing is everything the *package* contributes.

- `linux.icon` → a rendered set (16…512) at `build/icons/`. Left unset, electron-builder
  derives Linux icons from the macOS `.icns` (`linuxOptions.d.ts:49`); the artwork is a
  squircle with two dots and a smile, and 1024→16 downscaling is exactly where that turns to
  mud. Rendering each size from `build/icon.svg` costs one script and is crisp at every size.
- `linux.syncDesktopName: true` → **this is the double-icon-in-the-dock bug**, and
  electron-builder has already conceded it: the option defaults to `false` in v26 and *"in v27
  the default will change to `true`"* (`linuxOptions.d.ts:57-60`, issue #9103). Without it the
  installed `.desktop` filename does not match Electron's `app_id`, so a running window does not
  group with its launcher — the user sees a second, generic icon appear beside the real one.
  Setting it now is both the fix and forward-compatibility with v27.
- `desktop.entry.StartupWMClass` → set explicitly beside it. Belt and braces on the same
  grouping, and the one an older desktop environment reads.
- `linux.category: Development` and a `synopsis` — the menu entry is otherwise uncategorised.

### D7 — CI builds the artifact; it is not attached to a release

The job uploads AppImage and deb as run artifacts, which is what makes the build *verified*
rather than merely configured. Attaching them to a GitHub Release belongs to the remote-update
round, which is not locked.

### D8 — node-pty compiles from source on Linux, and the users/developers split is the point

**node-pty 1.1.0 ships no Linux prebuild.** Verified against the installed package: the
`prebuilds/` directory holds `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64` and
nothing else. On Linux, `npm install` compiles it through node-gyp.

Three consequences, and only one of them is a problem:

1. **End users are unaffected, and §3's self-sufficiency promise holds.** node-pty is N-API
   (`node-addon-api ^7.1.0`), so a source build is ABI-stable across Node and Electron exactly
   as a prebuild would be — the CI machine compiles it once and the shipped artifact carries the
   result. `npmRebuild: false` stays correct on Linux for the same reason it is correct on
   Windows.
2. **Linux developers need `build-essential` and `python3`** to run `npm ci`. This is the same
   shape as the Visual Studio failure that `tests/native-modules.test.ts` was written about —
   except there it was a misconfiguration we removed, and here it is unavoidable. It is a
   developer prerequisite, not a user one, and the PRD says so in those words.
3. **`tests/native-modules.test.ts:52` is false on Linux by construction.** It asserts a
   prebuild exists for the running platform. It gets a Linux arm that asserts the *built* binary
   loads instead, so the test keeps meaning "this native module works here with no manual step"
   on all three platforms rather than quietly meaning "a prebuild exists" on two.

## 3. Scope

**In:** the `linux:` block, the rendered icon set and desktop entry, the required
`ubuntu-latest` CI job with artifact upload, the Linux arm for `native-modules`, whatever the
real runner's red list turns out to contain, a `docs/validation/lin1.md` recording the
measurements, and the PRD fold.

**Out:** linux-arm64 (D2) · the watcher fan-out (D4) · Release attachment (D7) · Snap and
Flatpak · signing (Linux has no equivalent gate, and AppImage/deb are unsigned like the
Windows dogfood builds) · a Linux GUI pass on real hardware, which is named in the plan as the
one thing this round cannot self-verify.

## 4. Verification

`npm run gate` on macOS stays green throughout — every change here is config, a committed
asset, or a platform arm in a test. The Linux claims are verified by the CI job itself: the
run is the evidence, and `docs/validation/lin1.md` records what it said.

The honest limit, stated rather than papered over: **no one has launched this app on Linux.**
CI proves it builds, installs into a package and passes the suite. It does not prove the
window opens, the icon groups in the dock, or that a terminal tab spawns a usable shell. That
is a GUI pass on real hardware and the plan names it as an explicit follow-up rather than
folding it into a green tick.
