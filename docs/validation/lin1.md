# lin1 — Linux support, measured

PRD §4, Linux round, 2026-09-20. Design:
`docs/superpowers/specs/2026-09-20-linux-support-design.md`.

Everything here is a measurement or a verbatim quote from source. Where a number came
from a Docker container rather than a CI runner it says so, because the difference
turned out to matter more than anything else in this round.

---

## 1. node-pty ships no Linux prebuild

The single finding that changed a decision. Verified twice — against the tree installed
on the developer's Mac (npm installs every platform's prebuilds, since they are just
files in the tarball) and against a clean install inside `node:24` linux/amd64:

```
$ ls node_modules/node-pty/prebuilds/
darwin-arm64  darwin-x64  win32-arm64  win32-x64

$ docker run --rm --platform linux/amd64 node:24 \
    sh -c 'npm i node-pty@1.1.0 >/dev/null 2>&1; ls node_modules/node-pty/build/Release/'
pty.node
```

So on Linux `npm ci` compiles it through node-gyp, and `build/Release/pty.node` is where
the result lands — which is what `tests/native-modules.test.ts`'s Linux arm asserts.

**Why this changes nothing for users.** node-pty declares `node-addon-api ^7.1.0`, i.e.
it is N-API, so a source build is ABI-stable across Node and Electron exactly as a
prebuild would be. The build machine compiles once, the binary rides inside the package,
and `npmRebuild: false` stays correct. What it does change is that a Linux
**contributor** needs `build-essential` and `python3` — the same class of prerequisite
the Windows round deliberately removed (Visual Studio), but here unavoidable rather than
self-inflicted.

## 2. `deb.depends` replaces, it does not extend

`app-builder-lib/out/targets/FpmTarget.js:315`, verbatim:

```js
return ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6",
        "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"];
```

and `:185-194`:

```js
const depends = options.depends;
if (depends != null) {
    if (Array.isArray(depends)) {
        fpmConfiguration.customDepends = depends;
```

`libsecret-1-0` — the one MCP OAuth's keychain needs — is **already there**, and a
`depends` key assigns straight to `customDepends` rather than appending. So declaring the
dependency that the feature needs is precisely the change that would remove the other
eight and ship a package that installs cleanly and fails to launch.

Confirmed on the real artifact (`control` from the built deb):

```
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils,
         libatspi2.0-0, libuuid1, libsecret-1-0
```

## 3. The icon bug is an association bug

`LinuxTargetHelper.js:276` derives `StartupWMClass` from `desktopName`, falling back to
`productName`; `:203-215` derives the installed `.desktop` **filename** from the same
field when `syncDesktopName` is true, falling back to `executableName`, which
`linuxPackager.js:16` computes as `appInfo.sanitizedName.toLowerCase()`.

Our values make the mismatch automatic: `productName` is `HappyVibe`, `executableName`
is `happyvibe`. Electron reads the same field — from its own typings,
`electron.d.ts:1692`:

> `app.setDesktopName` (or the `desktopName` field in `package.json`) must match […]

Built artifact, `/usr/share/applications/happyvibe.desktop`:

```
[Desktop Entry]
Name=HappyVibe
Exec=/opt/HappyVibe/happyvibe %U
Terminal=false
Type=Application
Icon=happyvibe
StartupWMClass=happyvibe
Comment=Vibe coding you can actually watch.
Categories=Development;
```

Filename, `Icon`, `StartupWMClass` and the executable all read `happyvibe`. That is the
association holding. `StartupWMClass` is **not** written by hand anywhere in our config —
it is derived, so a second copy could only drift out of sync with the first.

Icons install as expected:

```
./usr/share/icons/hicolor/{16x16,32x32,48x48,64x64,128x128,256x256,512x512}/apps/happyvibe.png
```

## 4. Building the icon set with Chromium

`scripts/icons.mjs` renders `build/icon.svg`. Four failures on the way, each recorded
because each one is silent:

| Attempt | Result |
| --- | --- |
| top-level `await app.whenReady()` | **hangs forever, prints nothing.** Ready fires only after the entry module finishes evaluating; top-level await is what stops it finishing. |
| static `import { app } from "electron"` (with the await) | same hang, before the first statement |
| hidden ordinary window + `capturePage()` | never settles — no compositor output for a hidden window on macOS |
| one window per size | first size fine, every later `loadFile` → `ERR_FAILED (-2)` |
| 128px window, `capturePage()` | wrote **256×256** files — capture answers at the display scale factor |

Working shape: `createRequire`, no top-level await, one `offscreen: true` window at
1024, one capture, then `resize()` per target. The resize is supersampling a vector
render, and it makes the output identical on a Retina Mac and a 1× CI box.

The generator self-checks: pixel (0,0) is outside the squircle, so its alpha must be 0,
and it throws rather than writing an opaque square. `tests/linux-icons.test.ts` re-checks
the written files by parsing the PNG IHDR — width, height and colour type 6 (RGBA) —
because electron-builder matches icons by FILENAME and would never complain about a
512×512 file called `16x16.png`.

## 5. Artifacts

Built from macOS (electron-builder downloads `fpm` and the linux tools):

| File | Size |
| --- | --- |
| `release/happyvibe_0.1.0_amd64.deb` | 198 MB |
| `release/HappyVibe-0.1.0.AppImage` | 243 MB |

## 6. The suite on Linux

### Docker, `node:24` linux/amd64, repo cloned inside (2026-09-20)

```
npm run build    green, 4.41 s
npm test         Test Files  5 failed | 302 passed | 20 skipped (327)
                      Tests  14 failed | 3943 passed | 55 skipped (4012)
```

**Three of those five files fail for reasons belonging to the container, not to Linux,
and this is the entry worth remembering.** Planning fixes off this list would have burned
the round:

| File | Fails | Why it is not a Linux bug |
| --- | --- | --- |
| `terminals.test.ts` | 7 | `execvp(3) failed.: No such file or directory` — the image has no shell at the fixture's path |
| `agent-terminals.test.ts` | 4 | same root: `expected null to be 'sleep'`, no foreground process because nothing spawned |
| `model-exclusions.test.ts` | 1 | ran as **root**, where `chmod 000` cannot deny the owner a read — the existing `CAN_DENY_READ` capability case |
| `mcp-adapter-store.test.ts` | 1 | no Electron binary in the image to spawn as node |
| `native-modules.test.ts` | 1 | **real** — §1 above |

`ubuntu-latest` runs as the non-root `runner` with a real shell and a downloadable
Electron, so only the last one was expected to survive — and that is what happened.

### `ubuntu-latest`, run 1 (35519649558)

```
Test Files  2 failed | 307 passed | 20 skipped (329)
```

Three of the container's five files were indeed container artifacts and did not
reproduce. What remained was **11 tests across `terminals.test.ts` and
`agent-terminals.test.ts`**, and all eleven had ONE cause:

**`tests/shellFixture.ts:23` hardcoded `/bin/zsh` for everything that is not Windows,
and ubuntu-latest has no zsh.** macOS has shipped zsh as the default since Catalina so
the constant was right where it was written; Linux ships bash.

The reason it took four investigations to see is worth the entry: **`pty.spawn` does not
throw on a missing shell** — that is its own pinned behaviour — so every assertion
downstream failed on its own terms (`expected null to be 'sleep'`, `expected [] to
include 'sleep'`, `expected 'zsh' to be 'sleep'`) and the only hint was one `execvp(3)
failed.: No such file or directory` sitting in a scrollback buffer three assertions away.
Fixed by choosing the shell per platform, and deriving the rc-skip flag (`-f` for zsh,
`--norc` for bash) from the shell actually chosen rather than from the platform — the
same question only while not-Windows meant zsh.

### `ubuntu-latest`, run 2 (35520040156)

```
Test Files  2 failed | 307 passed | 20 skipped (329)
```

Same two files, but 11 failures down to **5**, and the remaining two causes were **real
defects in `src/main/terminals.ts`** rather than fixtures. This is the round's return on
running the suite on the platform at all.

**`pty.process` answers a NAME on macOS and a PATH on Linux** (4 tests,
`expected '/bin/bash' to be null`). node-pty reports argv[0] of the tty's foreground
process: macOS gives `bash`, Linux gives `/bin/bash` for the shell — because that is how
it was exec'd — while still giving a bare `sleep` for a command typed at the prompt.
`shellName` is `path.basename(file)`, so `"/bin/bash" !== "bash"` was **true at an idle
prompt** and `foreground()` never answered null. Consequences, all user-visible and none
of them caught by any macOS test:

- every Linux terminal reads as permanently busy;
- the close confirm always warns;
- the agent can never reuse a terminal, so it fills its cap of 3 for good;
- the tab title reads `/bin/bash` instead of `bash`.

That is the same failure `FOREGROUND_SUPPORTED` exists to prevent on Windows, arriving by
a different route. Fixed with `processName()` at the one point both readers pass through,
which also strips a login shell's leading `-` (`-bash`) — `shellArgs: ["-l"]` would
otherwise reproduce it exactly.

**On Linux a shell that never started DOES print a byte** (1 test). The "name the path it
tried" branch (`terminals.ts`, `onExit`) guarded on `!entry.sawData`. node-pty's
spawn-helper writes `execvp(3) failed.: No such file or directory` **into the pty** when
the exec fails, so the terminal HAS seen data, the guard skipped, and a Linux user with a
typo'd shell path was told an exec failed without being told which path — the precise
failure that branch was written to prevent, restored by a platform difference. The helper
names the errno, never the path.

### Run 3 — the fix for the second defect was itself racy

The first attempt at the `execvp` fix read the mirror back inside `onExit`
(`EXEC_FAILED.test(this.readText(id))`). **`@xterm/headless`'s `write()` is
asynchronous**, so the line may not be parsed when the exit handler runs — and the race
landed the worst possible way: green in Docker, red on the CI runner, on the one test it
was written for. Recorded because the lesson generalises past this bug: *do not read a
buffer back to learn something you were handed synchronously.* The signal is now taken
off the raw `onData` bytes into an `execFailed` flag.

### Run 4 — and one last fixture

With both defects fixed, one test remained: `interleave hold > does not hold once the
user's line is ended`. It loops over three line-enders but waited for a prompt only
*before* the loop; a terminal still finishing the previous `echo` is refused by the
busy-reuse rule instead — and a refusal is also fast, so the timing assertion would have
passed while `ok` was false. That is the vacuous-assertion trap its own describe block
warns about. macOS returned to idle inside the loop's overhead; Linux does not.

Final: **`terminals.test.ts` + `agent-terminals.test.ts` = 28 passed | 1 skipped** on
linux/amd64.

### A caveat on the Docker proxy, learned the hard way

After the defects were fixed, `agent-terminals.test.ts` failed **3 passes out of 3** in the
container — and the failing test MOVED between runs (`allows reuse of an idle terminal`,
then `does not hold once the user's line is ended`). Both are the same shape: a
`run(cmd, existingId)` refused.

It is not a Linux bug. On the real `ubuntu-latest` runner that file passed throughout;
the only Linux failure at that point was the `execvp` one in `terminals.test.ts`. The
container reproduces it because **amd64 Docker on an arm64 Mac is emulated**, so it is
slow enough for pty timing to matter, and vitest runs the two terminal files in parallel
— `terminals.test.ts` spawns a PTY per test. Run `agent-terminals.test.ts` alone in the
same container and it passes 3/3.

So the proxy's standing is narrower than run 2 suggested: **Docker is reliable for
"does this platform behave differently" and unreliable for anything timing-sensitive.**
The same rule the live-Pi batch already follows, arriving from the other direction.

It did leave one permanent improvement. Every refusal in `agentTerminals.run` is fast, so
`expect(r.ok).toBe(true)` fails as a bare *"expected false to be true"* and discards
`reason` — the only part naming which of the five rules fired. That is why the first
investigation went to the wrong rule. `expectOk()` now carries the reason into the
assertion message at all 16 call sites.

### The full gate on Linux at `d821b56`, after CI was blocked

GitHub Actions billing failed mid-round (see below), leaving the last terminal fix
committed but unverified on a runner. The container covered as much of that job as it can:

```
BUILD_EXIT=0        # all three typechecks + electron-vite, green
TEST_EXIT=1         # Test Files 3 failed | 306 passed | 20 skipped (329)
                    #      Tests 3 failed | 3968 passed | 55 skipped (4026)
```

**`terminals.test.ts` is fully green**, which is the point: the one test the last CI run
failed on (`an unspawnable shell yields an inert exited terminal`) now passes on Linux, so
the `execFailed` fix has platform evidence behind it even though no runner has seen it.

The three remaining failures are the known container artifacts —
`mcp-adapter-store` (no Electron to spawn), `model-exclusions` (root), and the
`agent-terminals` emulation flake described above. None reproduce on `ubuntu-latest`.

**Running `npm run build` in the container is worth the five seconds it costs**, and this
round did not do it consistently — only the first probe ran it, and every later iteration
dropped it to shorten the loop. Most of the build is platform-independent (the typechecks,
esbuild) so macOS covers it, but **rollup's native module and `@typescript/native` are
per-platform binaries**, which is the same class of Linux-only break `win1.md` records for
Windows. The install dominates the cycle either way.

### Net

| | Docker (root, no shell, no Electron) | `ubuntu-latest` |
| --- | --- | --- |
| Files failed | 5 | 2 |
| Tests failed | 14 | 11 → 5 → 0 |
| Of which real | 1 | **3** (one fixture, two `src/` defects) |

The container over-reported by 3 files and under-reported the interesting ones. Both were
worth running: Docker gave a 5-minute loop for the terminal files specifically once the
class of failure was known, and agreed with the runner exactly from run 2 onward.

## 7. What CI does not prove

CI proves the app builds, packages into an AppImage and a `.deb`, and passes its suite.
It proves nothing about the app running. As of this document, **no human has launched
HappyVibe on Linux.** Specifically unverified:

- the window opens, and shows our icon in the menu, the dock and the title bar;
- exactly **one** dock icon while running (`xprop WM_CLASS` should read `happyvibe`) —
  the thing §3's whole decision exists to guarantee;
- a terminal tab spawns a usable shell — the highest-risk item, because it is precisely
  what the container could not exercise;
- MCP OAuth reaches a keychain through the declared `libsecret-1-0`;
- voice: `sherpa-onnx-linux-x64` has never been loaded, and `getMediaAccessStatus` has no
  Linux implementation, so `hv:voice-mic-status` answers a blanket `granted`
  (`ipc.ts:4227`) and a denied PulseAudio/PipeWire source would surface as a dead level
  meter with nothing explaining it. Same gap `win1.md` records for Windows voice.
- the AppImage on a stock Ubuntu 24.04 **without** `libfuse2` — expected to do nothing at
  all on double-click, which is the documented behaviour and the reason a `.deb` is built
  alongside it.
