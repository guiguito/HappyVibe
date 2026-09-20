# Linux support — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HappyVibe builds, packages and gates on Linux x64 — AppImage and deb, with a correctly rendered and correctly *associated* icon — verified by a required CI job rather than by assertion.

**Architecture:** Nothing in `src/` changes. The Windows round already routes every platform question through `src/main/platform.ts`, and its Linux arms are written and pinned. This round is the packaging config, a committed icon set, a CI tripwire, and the two test arms that are false on Linux by construction.

**Tech Stack:** electron-builder 26.15.3 (AppImage + deb via fpm), Electron 44 (used headless as the SVG rasteriser), GitHub Actions `ubuntu-latest`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-linux-support-design.md`

## Global Constraints

- **x64 only.** No `arch: [arm64]` anywhere, on any target. (Spec D2)
- **Never write a `deb.depends` key.** It replaces electron-builder's defaults rather than extending them; the defaults already carry `libsecret-1-0`. (Spec D3)
- **`npm run gate` on macOS stays green after every task.** Every change here is config, a committed asset, or a platform arm.
- **Never pipe a test run to `tail`/`grep`** — redirect to a file and grep the file (CLAUDE.md).
- The icon master is `build/icon.svg`. `build/icon.png`, `build/icon.icns`, `build/icon.ico` and `resources/icon.png` are **not** touched by this round.

---

### Task 1: Render the Linux icon set from the SVG

**Files:**
- Create: `scripts/icons.mjs`
- Create: `build/icons/{16x16,32x32,48x48,64x64,128x128,256x256,512x512}.png` (generated, committed)
- Modify: `package.json` (add the `icons` script)
- Test: `tests/linux-icons.test.ts`

**Interfaces:**
- Produces: the directory `build/icons/`, which Task 2's `linux.icon` points at. electron-builder requires each filename to contain its size (`LinuxTargetHelper`), so the `NxN.png` naming is load-bearing, not cosmetic.

**Why not let electron-builder downscale:** left unset, `linux.icon` is derived from the macOS `.icns` (`linuxOptions.d.ts:49`). The artwork is a squircle with two dots and a smile; 1024→16 is where that turns to mud.

- [ ] **Step 1: Write the failing test**

```ts
// tests/linux-icons.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §4 (Linux round): electron-builder matches an icon-set directory by
 * FILENAME — "the icon filename must contain the size (e.g. 32x32.png)"
 * (app-builder-lib/out/options/linuxOptions.d.ts:48). A renamed file is not a
 * lint error there, it is an icon silently dropped from the package.
 */
const ICONS = path.join(__dirname, "..", "build", "icons");
const SIZES = [16, 32, 48, 64, 128, 256, 512];

describe("the Linux icon set", () => {
  it("ships one PNG per size, named the way electron-builder matches", () => {
    for (const s of SIZES) {
      const f = path.join(ICONS, `${s}x${s}.png`);
      expect(fs.existsSync(f), `missing ${s}x${s}.png`).toBe(true);
    }
  });

  it("carries an alpha channel — a black square is the failure mode here", () => {
    // PNG IHDR: bytes 0-7 signature, 8-15 length+type, 16-23 w/h, 24 bit depth,
    // 25 COLOUR TYPE. 6 = truecolour with alpha. A capture that lost transparency
    // comes back as type 2 and looks correct in every listing.
    for (const s of SIZES) {
      const head = fs.readFileSync(path.join(ICONS, `${s}x${s}.png`)).subarray(0, 26);
      expect(head.readUInt32BE(16), `${s}: width`).toBe(s);
      expect(head.readUInt32BE(20), `${s}: height`).toBe(s);
      expect(head[25], `${s}: colour type should be 6 (RGBA)`).toBe(6);
    }
  });

  it("is generated, not hand-made — the script that made it is committed", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "icons.mjs"), "utf8");
    expect(src).toContain("build/icon.svg".split("/").pop());
    for (const s of SIZES) expect(src).toMatch(new RegExp(`\\b${s}\\b`));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/linux-icons.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `missing 16x16.png`.

- [ ] **Step 3: Write the generator**

`scripts/icons.mjs`. Electron is already a devDependency and Chromium is the one SVG rasteriser this repo already has — no new dependency, and rendering each size from the vector beats downscaling a raster.

```js
/**
 * Renders build/icon.svg into build/icons/<N>x<N>.png for the Linux package
 * (PRD §4, Linux round). Committed output — run it only when the icon changes:
 *
 *   npm run icons
 *
 * Chromium is the rasteriser because it is the one this repo already ships;
 * every size is rendered from the vector rather than downscaled from the 1024
 * PNG, which is the whole point at 16px.
 */
import { app, BrowserWindow } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 32, 48, 64, 128, 256, 512];
const OUT = path.join(ROOT, "build", "icons");

await app.whenReady();
mkdirSync(OUT, { recursive: true });
const svg = readFileSync(path.join(ROOT, "build", "icon.svg"), "utf8");

for (const size of SIZES) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
  });
  const html =
    `<!doctype html><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
    `svg{display:block;width:${size}px;height:${size}px}</style>` +
    svg;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  const img = await win.webContents.capturePage();

  // Self-check: a capture that lost the alpha channel comes back as an opaque
  // square and looks plausible in a file listing. getBitmap() is BGRA, so byte
  // 3 of pixel (0,0) is the corner's alpha — and the corner is outside the
  // squircle, so it MUST be transparent.
  const bmp = img.getBitmap();
  if (bmp[3] !== 0) {
    throw new Error(`${size}x${size}: corner alpha is ${bmp[3]}, expected 0 — capture lost transparency`);
  }
  writeFileSync(path.join(OUT, `${size}x${size}.png`), img.toPNG());
  console.log(`[icons] ${size}x${size}.png`);
  win.destroy();
}

app.quit();
```

- [ ] **Step 4: Add the script and run it**

In `package.json` `scripts`, beside the other catalog generators:

```json
"icons": "electron scripts/icons.mjs",
```

```bash
npm run icons
```
Expected: seven `[icons] NxN.png` lines and no throw. If it throws on corner alpha, drop `transparent: true` and instead set the window `backgroundColor` to `"#00000000"` alone — but do not commit an opaque set; the test rejects it.

- [ ] **Step 5: Run the test to verify it passes**

```bash
L=/tmp/vitest.log; npx vitest run tests/linux-icons.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/icons.mjs build/icons package.json tests/linux-icons.test.ts
git commit -m "feat(§4): render the Linux icon set from the SVG master"
```

---

### Task 2: The `linux:` block, and the desktop association that is the actual icon bug

**Files:**
- Modify: `electron-builder.yml`
- Modify: `package.json` (add `desktopName`)
- Test: `tests/linux-package.test.ts`

**Interfaces:**
- Consumes: `build/icons/` from Task 1.
- Produces: the packaging config Task 4's CI job builds.

**This is the task whose design changed after reading electron-builder's source.** The plan was to hardcode `linux.desktop.entry.StartupWMClass`. That is wrong. `LinuxTargetHelper.js:250-276` derives `StartupWMClass` from **`desktopName` in `package.json`**, falling back to `productName` — and `getDesktopFileName` (`:203-215`) derives the installed `.desktop` *filename* from the same field when `syncDesktopName` is true. Electron reads that same field for its `app_id`. So `desktopName` is the single source of truth and hardcoding `StartupWMClass` beside it creates a second one that can drift.

Our current values make the mismatch inevitable: `productName` is `HappyVibe`, so `StartupWMClass` would be `HappyVibe`, while `executableName` defaults to `appInfo.sanitizedName.toLowerCase()` (`linuxPackager.js:16`) — `happyvibe`. Different strings, so the running window does not associate with its launcher and a second generic icon appears in the dock. electron-builder even logs a warning about it, which nobody reads in CI.

- [ ] **Step 1: Write the failing test**

```ts
// tests/linux-package.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const ROOT = path.join(__dirname, "..");
const CONFIG = parse(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("the Linux package", () => {
  it("builds AppImage and deb, x64 only", () => {
    const targets = CONFIG.linux.target as Array<{ target: string; arch: string[] }>;
    expect(targets.map((t) => t.target).sort()).toEqual(["AppImage", "deb"]);
    // PRD §4: linux-arm64 is EXCLUDED because nothing tests it — not because no
    // build exists (sherpa-onnx and anydoc both publish it). Different reason
    // than Windows, different unblock condition.
    for (const t of targets) expect(t.arch, `${t.target} arch`).toEqual(["x64"]);
  });

  it("points at the rendered icon set, not the icns downscale", () => {
    expect(CONFIG.linux.icon).toBe("build/icons");
    expect(fs.existsSync(path.join(ROOT, "build", "icons", "512x512.png"))).toBe(true);
  });

  /**
   * The double-icon-in-the-dock bug. electron-builder derives BOTH the installed
   * .desktop filename (LinuxTargetHelper.js:203) and StartupWMClass (:276) from
   * package.json's `desktopName`, and Electron derives its app_id from the same
   * field. Without it, StartupWMClass falls back to productName ("HappyVibe")
   * while the filename falls back to executableName ("happyvibe") — and a running
   * window stops associating with its launcher.
   */
  it("names the desktop entry once, in package.json, and syncs to it", () => {
    expect(PKG.desktopName).toBe("happyvibe.desktop");
    expect(CONFIG.linux.syncDesktopName).toBe(true);
    // Derived, so there must be no second copy to drift from it.
    expect(CONFIG.linux.desktop?.entry?.StartupWMClass).toBeUndefined();
  });

  /**
   * DO NOT "fix" this by adding the dependency it names. `depends` REPLACES
   * electron-builder's defaults rather than extending them (FpmTarget.js:185-194
   * assigns straight to customDepends), and the default list already carries
   * libsecret-1-0 — the one MCP OAuth needs — alongside libgtk-3-0, libnss3,
   * libxss1, libxtst6, xdg-utils, libatspi2.0-0 and libuuid1 (FpmTarget.js:315).
   * Writing `depends: [libsecret-1-0]` ships a deb that installs and won't launch.
   */
  it("declares NO deb.depends, because the defaults already carry libsecret", () => {
    expect(CONFIG.deb?.depends).toBeUndefined();
    const fpm = fs.readFileSync(
      path.join(ROOT, "node_modules", "app-builder-lib", "out", "targets", "FpmTarget.js"),
      "utf8",
    );
    // Pin bump gate: if upstream drops libsecret from its defaults, we must
    // start declaring the whole list — and this is where that shows up.
    expect(fpm).toContain('"libsecret-1-0"');
  });

  it("gives the menu entry a category and a one-line synopsis", () => {
    expect(CONFIG.linux.category).toBe("Development");
    expect(typeof CONFIG.linux.synopsis).toBe("string");
    expect(CONFIG.linux.synopsis.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/linux-package.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: FAIL — `Cannot read properties of undefined (reading 'target')`.

- [ ] **Step 3: Add `desktopName` to `package.json`**

Beside `productName`:

```json
"desktopName": "happyvibe.desktop",
```

Electron reads this only on Linux (`app.setDesktopName`), so macOS and Windows are unaffected.

- [ ] **Step 4: Add the `linux:` block to `electron-builder.yml`**

Insert after the `win:`/`nsis:` blocks and before `asarUnpack:`:

```yaml
# §4 Linux round (2026-09-20). x64 ONLY — and for a DIFFERENT reason than win:
# above. sherpa-onnx and @firecrawl/anydoc both publish linux-arm64, so arm64 is
# available here; it is excluded because nothing tests it. Windows arm64 unblocks
# when upstream ships a binary, Linux arm64 when we add a runner.
#
# Two targets because neither alone is honest: AppImage runs anywhere but needs
# libfuse2, absent by default on Ubuntu 22.04+, where a double-click does nothing
# with no error to read; the deb works out of the box and is the only one of the
# two that can declare its dependencies.
#
# There is deliberately NO `deb:` block. `deb.depends` REPLACES electron-builder's
# defaults instead of extending them, and those defaults already include
# libsecret-1-0 — which is what MCP OAuth's keychain needs. Adding the one line
# that looks like it fixes that would drop libgtk-3-0 and libnss3 and ship a
# package that installs cleanly and will not launch. Pinned by
# tests/linux-package.test.ts.
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  # A rendered set (scripts/icons.mjs), not electron-builder's downscale of the
  # macOS .icns — the artwork is a squircle with a face and 1024→16 muddies it.
  icon: build/icons
  category: Development
  synopsis: A desktop home for the Pi coding agent, with permissions you can see
  # THE double-icon-in-the-dock fix. Electron derives its app_id from
  # `desktopName` in package.json; with this true, electron-builder names the
  # installed .desktop file and StartupWMClass from the same field, so a running
  # window associates with its launcher. Its own default flips to true in v27
  # (electron-builder #9103). StartupWMClass is deliberately NOT set by hand —
  # it is derived from desktopName, and a second copy would drift.
  syncDesktopName: true
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
L=/tmp/vitest.log; npx vitest run tests/linux-package.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add electron-builder.yml package.json tests/linux-package.test.ts
git commit -m "feat(§4): the Linux package, and the desktop association behind its icon"
```

---

### Task 3: Teach `native-modules.test.ts` that Linux compiles node-pty

**Files:**
- Modify: `tests/native-modules.test.ts:44-53`

**Interfaces:**
- Consumes: nothing. Produces: nothing. This is a test arm.

`node-pty@1.1.0` ships `prebuilds/` for `darwin-arm64`, `darwin-x64`, `win32-arm64` and `win32-x64` — **and nothing for Linux.** The existing assertion is therefore false on Linux by construction. It must keep meaning *"this native module works here with no manual step"*, which on Linux is satisfied by a node-gyp build the install already performed.

- [ ] **Step 1: Read the current assertion**

```bash
sed -n '44,56p' tests/native-modules.test.ts
```

- [ ] **Step 2: Replace it with a two-armed version**

```ts
  it("node-pty is usable here with no manual build step", () => {
    const lib = path.dirname(require_.resolve("node-pty"));
    const mine = `${process.platform}-${process.arch}`;

    // node-pty 1.1.0 ships NO Linux prebuild — verified: prebuilds/ holds
    // darwin-arm64, darwin-x64, win32-arm64, win32-x64 and nothing else. So on
    // Linux it compiles through node-gyp at install time, which makes
    // build-essential + python3 a DEVELOPER prerequisite there (PRD §4, Linux
    // round). Users are unaffected: node-pty is N-API, so the build the CI
    // machine performs is ABI-stable across Node and Electron exactly as a
    // prebuild would be, the packaged artifact carries it, and §3's
    // self-sufficiency promise is untouched.
    //
    // The assertion that matters is the same on every platform — the module
    // loads and can spawn — so this arm checks the BUILT binary exists rather
    // than weakening the test to "skip on Linux".
    if (process.platform === "linux") {
      const built = path.join(lib, "..", "build", "Release", "pty.node");
      expect(fs.existsSync(built), `no built pty.node at ${built}`).toBe(true);
      return;
    }

    const prebuilds = path.join(lib, "..", "prebuilds");
    expect(fs.readdirSync(prebuilds), `no prebuild for ${mine}`).toContain(mine);
  });
```

- [ ] **Step 3: Verify macOS is still green**

```bash
L=/tmp/vitest.log; npx vitest run tests/native-modules.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS — the darwin arm is unchanged.

- [ ] **Step 4: Register the platform arm in the skip ledger**

`tests/windows-skips.test.ts` exists so a platform gate is a written decision. This new branch is a platform gate. Extend that file's header comment with one line naming it — it is not a `skipIf`, so `SKIP_RE` will not match it and `EXPECTED` must not gain an entry:

```
 * Not a skip, listed so the sweep is complete: native-modules.test.ts BRANCHES on
 * linux (node-pty has no Linux prebuild and is compiled at install) rather than
 * skipping — both arms assert, which is the shape the foreground-process tests use.
```

- [ ] **Step 5: Run the ledger test**

```bash
L=/tmp/vitest.log; npx vitest run tests/windows-skips.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS — the comment changes nothing the detector reads.

- [ ] **Step 6: Commit**

```bash
git add tests/native-modules.test.ts tests/windows-skips.test.ts
git commit -m "test(§4): node-pty is compiled, not prebuilt, on Linux"
```

---

### Task 4: The required `ubuntu-latest` job

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify + rename: `tests/ci-windows-required.test.ts` → `tests/ci-platforms-required.test.ts`

**Interfaces:**
- Consumes: Task 2's `linux:` block (the job builds it).
- Produces: the run artifacts and the real Linux red list that Task 5 triages.

The rename is the point: the existing file's lesson — `continue-on-error: true` once let a red Windows job report a green tick on a PR — is not Windows-specific, and a file named for one platform invites a fourth platform to re-learn it.

- [ ] **Step 1: Rename the test and generalise it over the job table**

```bash
git mv tests/ci-windows-required.test.ts tests/ci-platforms-required.test.ts
```

Replace the `describe` block (keep the file's existing header comment verbatim — it carries the 8.3 short-name story — and add the Linux line to it):

```ts
/** job name → the runner it must use. Adding a platform means adding a row. */
const JOBS: Record<string, RegExp> = {
  test: /runs-on:\s*macos-latest/,
  "test-windows": /runs-on:\s*windows-latest/,
  "test-linux": /runs-on:\s*ubuntu-latest/,
};

describe("every platform CI job gates", () => {
  for (const [name, runner] of Object.entries(JOBS)) {
    describe(name, () => {
      it("exists and runs on the right runner", () => {
        expect(jobBlock(name)).toMatch(runner);
      });

      it("does NOT continue on error — that flag hid a red job once already", () => {
        expect(jobBlock(name)).not.toMatch(/continue-on-error/);
      });

      it("runs both halves of the gate, and installs both trees", () => {
        const block = jobBlock(name);
        expect(block).toMatch(/run:\s*npm test/);
        expect(block).toMatch(/run:\s*npm run build/);
        // Both trees install, or pi-runtime is missing and every Pi-spawning
        // test skips itself while the job still reports green.
        expect(block).toMatch(/npm ci/);
        expect(block).toMatch(/cd pi-runtime && npm ci/);
      });
    });
  }

  it("the Linux job packages, because building is not packaging", () => {
    // `npm run build` is electron-vite only. The linux: block, the icon set and
    // the afterPack copy are exercised only by electron-builder, so the job that
    // would catch a broken package must actually run one.
    expect(jobBlock("test-linux")).toMatch(/electron-builder --linux/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/ci-platforms-required.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: FAIL — `job test-linux not found in ci.yml`.

- [ ] **Step 3: Add the job to `.github/workflows/ci.yml`**

Append after `test-windows`:

```yaml
  # §4 Linux round (2026-09-20). REQUIRED for the same recorded reason as the
  # Windows job above: an advisory job is a green tick over a red suite.
  #
  # This one also PACKAGES. `npm run build` is electron-vite only, so the linux:
  # block, the rendered icon set and the afterPack pi-runtime copy are exercised
  # by nothing else — and a broken package is exactly the failure that would
  # otherwise reach a user instead of a runner.
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: actions/cache@v4
        with:
          path: ~/.cache/electron
          key: electron-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      # node-pty ships no Linux prebuild and is compiled through node-gyp here.
      # ubuntu-latest carries build-essential and python3 already; this line is
      # the one that tells a reader why that matters.
      - run: node -e "console.log(process.version)"
      - run: npm ci
      - run: cd pi-runtime && npm ci
      - run: npm test
      - run: npm run build
      - run: npx electron-builder --linux --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: happyvibe-linux-x64
          path: |
            release/*.AppImage
            release/*.deb
          if-no-files-found: error
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
L=/tmp/vitest.log; npx vitest run tests/ci-platforms-required.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite on macOS**

```bash
L=/tmp/vitest.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: EXIT=0. If `ci-windows-required` is reported missing, a stale reference to the old filename survives — grep for it.

- [ ] **Step 6: Commit and push the branch so CI runs**

```bash
git add .github/workflows/ci.yml tests/ci-platforms-required.test.ts
git commit -m "ci(§4): a required Linux job that packages, not just builds"
git push -u origin HEAD
```

---

### Task 5: Triage the real red list from the runner

**Files:**
- Modify: whichever test files the run names
- Modify: `tests/windows-skips.test.ts` (rename to `tests/platform-skips.test.ts` if any new skip is added)

**Interfaces:**
- Consumes: Task 4's CI run.

**Do not start this task from the Docker numbers.** The container run (2026-09-20) reported `14 failed | 3943 passed | 55 skipped` across five files, and at least three of those files fail for reasons belonging to the container: `model-exclusions` ran as **root**, where `chmod 000` cannot deny the owner a read; `mcp-adapter-store` had no Electron binary to spawn; the eleven pty failures reported `execvp(3) failed.`, a shell the image does not have. `ubuntu-latest` runs as the non-root `runner` with a real shell, so the true list is expected to be shorter and may be empty.

- [ ] **Step 1: Read the actual failures**

```bash
gh run list --branch "$(git branch --show-current)" --limit 3
gh run view <run-id> --log-failed > /tmp/linux-ci.log 2>&1
grep -E "^ FAIL " /tmp/linux-ci.log | sort -u
```

- [ ] **Step 2: Apply the Windows round's triage rule to each failure**

The rule, verbatim from `tests/windows-skips.test.ts`: *make the test portable when the CODE under test is portable, and skip only where the platform genuinely cannot host the case.* It took the Windows suite from 59 failures to 0 while adding eleven skips, not fifty. Prefer, in order:

1. **The code is wrong** — fix the code. A Linux-only defect in `src/` is the most valuable thing this round can surface.
2. **The fixture is POSIX/macOS-shaped** — make the fixture portable (build paths with `path.join`, read the shell from `terminalShell()`, never spell `/bin/zsh`).
3. **Both arms are assertable** — assert both, the way the foreground-process tests already do for Windows, rather than skipping.
4. **A capability is genuinely absent** — a `CAN_*` probe, never a platform check, so a machine that has the capability still runs it.
5. **The platform cannot host the case at all** — `skipIf(process.platform === "linux")`, and it goes in the ledger with a reason.

- [ ] **Step 3: If any skip was added, generalise the ledger**

```bash
git mv tests/windows-skips.test.ts tests/platform-skips.test.ts
```

Widen `SKIP_RE` to match `process.platform === "linux"` alongside `"win32"`, and change `EXPECTED` from `file → reason` to `file → { win32?: string; linux?: string }` so a file skipped on one platform cannot silently acquire a skip on the other.

- [ ] **Step 4: Verify on macOS, then on the runner**

```bash
L=/tmp/vitest.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git push
gh run watch
```
Expected: all three jobs green.

- [ ] **Step 5: Commit**

```bash
git add -A tests/
git commit -m "test(§4): the Linux suite is green, and every skip is a written decision"
```

---

### Task 6: Record the measurements and the developer prerequisite

**Files:**
- Create: `docs/validation/lin1.md`
- Modify: `CLAUDE.md` (a Linux sub-section under §Commands, mirroring the Windows one)
- Modify: `README.md` (the build prerequisites, if it names any)

**Interfaces:**
- Consumes: Task 5's green run.

- [ ] **Step 1: Write `docs/validation/lin1.md`**

Mirror `docs/validation/win1.md`'s shape. It must record, with numbers rather than adjectives:

- the CI run URL and the three jobs' wall times;
- `npm test` on `ubuntu-latest`: files / tests / skipped, and the same three numbers from the Docker run beside them, labelled as the container's so the difference is legible;
- the AppImage and deb byte sizes from the uploaded artifact;
- the verbatim `prebuilds/` listing proving node-pty ships nothing for Linux;
- the `FpmTarget.js:315` default-depends list, copied verbatim, since the whole no-`deb.depends` decision rests on it;
- every failure Task 5 fixed, one line each: symptom → cause → fix;
- **explicitly, the things CI does not prove**: nobody has launched the app, opened a terminal tab, dictated into the composer, or signed into an MCP server on Linux.

- [ ] **Step 2: Add the Linux sub-section to `CLAUDE.md`**

Under `## Commands`, after the `### Windows` block:

```markdown
### Linux (PRD §4, round 2026-09-20)
- **`npm ci` COMPILES node-pty** — it ships prebuilds for darwin and win32 only, so a
  Linux checkout needs `build-essential` and `python3`. Users are unaffected: node-pty
  is N-API, the CI machine's build serves both Node and Electron, and the packaged
  artifact carries it. `npmRebuild: false` stays correct.
- **Never add a `deb:` block with `depends`.** It REPLACES electron-builder's defaults
  rather than extending them, and those defaults already carry `libsecret-1-0` (what MCP
  OAuth's keychain needs) plus `libgtk-3-0` and `libnss3`. The obvious one-line "fix"
  ships a deb that installs and will not launch. Pinned by `tests/linux-package.test.ts`.
- **The icon bug is an ASSOCIATION bug, not an image bug.** `desktopName` in
  `package.json` is the single source of truth: electron-builder derives the installed
  `.desktop` filename and `StartupWMClass` from it, and Electron derives its `app_id`
  from it. Never hardcode `StartupWMClass` beside it. Without the pair
  (`desktopName` + `linux.syncDesktopName: true`) a running window does not group with
  its launcher and a second generic icon appears in the dock.
- **The file tree does not live-refresh** — recursive `fs.watch` does not exist on Linux
  (`src/main/watch.ts:10`), so `watchWorkspace` returns early and the renderer keeps its
  manual path. Accepted ceiling, not a bug to re-report.
- `build/icons/` is GENERATED by `npm run icons` from `build/icon.svg`. Re-run it when
  the icon changes; never hand-edit a PNG in there.
- Measurements: `docs/validation/lin1.md`.
```

- [ ] **Step 3: Verify the gate**

```bash
L=/tmp/vitest.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add docs/validation/lin1.md CLAUDE.md README.md
git commit -m "docs(§4): what the Linux round measured, and what it did not"
```

---

## Verification

### Automated

| Claim | Check |
| --- | --- |
| The icon set exists, is the right sizes, and kept its alpha | `tests/linux-icons.test.ts` |
| AppImage + deb, x64 only | `tests/linux-package.test.ts` |
| No `deb.depends`, and upstream still defaults to `libsecret-1-0` | `tests/linux-package.test.ts` |
| `desktopName` + `syncDesktopName`, with no hand-written `StartupWMClass` | `tests/linux-package.test.ts` |
| node-pty is usable on all three platforms | `tests/native-modules.test.ts` |
| All three CI jobs gate, and the Linux one packages | `tests/ci-platforms-required.test.ts` |
| The suite passes on Linux | the `test-linux` job itself |
| The package actually builds | `npx electron-builder --linux` in that job |

### GUI pass — on real Linux hardware, and NOT part of this round's green tick

CI proves the app builds, packages and passes its suite. It does not prove the app runs. These are the observable claims to check on a real Ubuntu desktop, each named with the surface it is observed on:

1. **The deb installs and launches.** `sudo apt install ./HappyVibe_*.deb`, then launch from the **applications menu** (not a terminal). The window opens.
2. **The icon is ours, in three places** — the applications menu entry, the dock/taskbar while running, and the window's own title bar. All three show the tangerine squircle, not Electron's default.
3. **Absence assertion:** while the app is running, the dock shows **exactly one** HappyVibe icon. A **second, generic icon appearing beside the launcher** is the `syncDesktopName` failure, and it is the specific thing Task 2 exists to prevent. Confirm the class matches with `xprop WM_CLASS` on the window — it must read `happyvibe`.
4. **The menu entry is categorised.** It appears under **Development**, not under "Other".
5. **A terminal tab spawns a usable shell** — observed on a **chat pane's terminal tab**: open one, run `echo $0`, get `/bin/bash`. This is the surface the Docker run could not exercise at all (`execvp(3) failed.`), so it is the highest-risk item here.
6. **Absence assertion:** the **file tree does not auto-refresh**. On the **file drawer**, create a file from an outside terminal — the tree does **not** update until a manual refresh. This is D4's accepted ceiling; seeing it is confirmation, not a bug report.
7. **MCP OAuth reaches a keychain.** On the **MCP settings page**, authenticate one remote server and confirm it reports `connected`; then restart the app and confirm it still does. A failure here on the deb means libsecret is missing despite the declared dependency.
8. **The regression this design risks**, as a sequence: launch from the menu, open a second window (⌘⇧N equivalent — Ctrl+Shift+N), close the first, and confirm the dock still shows one icon and the remaining window is still associated with it. Window association is per-`app_id`, and a torn-off window is the path most likely to lose it.

The AppImage gets items 1–3 only, and item 1 is expected to fail on a stock Ubuntu 24.04 without `libfuse2` — **that failure is the documented behaviour**, not a defect, and confirming it is what makes the two-format decision honest.
