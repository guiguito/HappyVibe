# Changelog Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a **Changelog** page in the app showing the running version, the runtime pins and the bundled `CHANGELOG.md`, with a passive "there's something new" dot — and stamp `0.1.0` in the same change so the page is truthful the moment it exists.

**Architecture:** No router, no new dependency, no IPC round trip for the version. The version and pins become **build-time constants** injected by `electron.vite.config.ts`; `CHANGELOG.md` is `?raw`-imported into the renderer bundle; the page is one component wired into the existing `View` union / `NAV` array / `activeView === "x" && <X/>` chain. The dot is a straight clone of the `onboardingSeen` config chain with a version string instead of a boolean. One pre-existing main-process bug (relative links navigate the SPA away) is fixed at its root because the changelog is the first page to trip it.

**Tech Stack:** Electron + electron-vite, React 19, Tailwind v4, `react-markdown` + `remark-gfm` (already shipped), vitest.

**Spec:** `docs/prd.md` §30 (four `Decision (…)` blocks) · Notion "📋 Changelog" page `3ccd33dfffca80cb8f1afeec0d4f55b7`

## Global Constraints

- **`package.json`'s `version` is the single source of truth.** No `VERSION` file, no constant in `src/`, no second copy. §30.
- **The top released entry in `CHANGELOG.md` must equal `package.json`'s version.** The invariant. Asserted by `tests/changelog.test.ts`.
- **The dot is never a modal and never a toast**, and a fresh install shows none. §30 never-nag rule.
- **The dot bubbles up through collapse the user did not choose and stops at collapse they did:** it appears on the closed `Settings ›` group button, and **NOT** in the ⌘B-collapsed 48px icon rail.
- **No update check.** The page reports the version you are running and never claims to know whether a newer one exists.
- **No new npm dependency.** The markdown renderer is already in the bundle.
- Copy follows §20's locked vocabulary and §30's seven rules: plainspoken, second person, no marketing.
- `npm run lint` / `npm run format` are scaffold leftovers — **do not run them** (CLAUDE.md).
- Never pipe a test run to `tail`/`grep` — redirect to a file, then grep the file (CLAUDE.md).
- `npm run build` runs both typechecks and fast-fails, so **never run `npm run typecheck` before `gate` or `build`**.
- This work touches no Pi-facing file, so **`npm run test:live` is not required**. Confirm with `npm run live:why` — empty output means the batch is not needed; say so rather than silently omitting it.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | version `0.1.0` + the real package identity |
| `CHANGELOG.md` | `[Unreleased]` → `## [0.1.0] — 2026-08-30`; the PRD link becomes a GitHub URL |
| `electron.vite.config.ts` | inject `__APP_VERSION__` and `__RUNTIME_PINS__` into the renderer |
| `src/renderer/src/env.d.ts` | declare those two globals for TS |
| `src/main/navGuard.ts` *(new)* | the pure decision: external / block / allow, for one navigation |
| `src/main/index.ts` | use it in `will-navigate` |
| `src/main/config.ts` | `lastSeenVersion` field + get/set pair |
| `src/main/ipc.ts` | two handlers |
| `src/preload/index.ts` | two methods |
| `src/renderer/src/hv.d.ts` | their types |
| `src/renderer/src/components/ChangelogView.tsx` *(new)* | the page |
| `src/renderer/src/components/Sidebar.tsx` | `View` union, `NAV` entry, icon, the two dots |
| `src/renderer/src/App.tsx` | state, the view chain, clear-on-open |
| `tests/changelog.test.ts` *(new)* | the four §30 assertions |
| `tests/nav-guard.test.ts` *(new)* | the relative-link guard |

---

### Task 1: Stamp `0.1.0` and pin the convention with a test

The invariant test comes first: it is the thing that makes a version unable to ship with no notes, and writing it before the stamp proves it can actually fail.

**Files:**
- Test: `tests/changelog.test.ts` (create)
- Modify: `package.json` (lines 2–8)
- Modify: `CHANGELOG.md:6-7`, `CHANGELOG.md:9`, and the file's last line

**Interfaces:**
- Consumes: nothing.
- Produces: `package.json` version `0.1.0`; `CHANGELOG.md` top heading `## [0.1.0] — 2026-08-30`. Tasks 3 and 5 read both.

- [ ] **Step 1: Write the failing test**

Create `tests/changelog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MD = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

/** Every `## [x.y.z] — YYYY-MM-DD` (or `## [Unreleased]`) heading, in file order. */
function headings(): Array<{ version: string; date: string | null }> {
  const out: Array<{ version: string; date: string | null }> = [];
  for (const line of MD.split("\n")) {
    const m = /^## \[([^\]]+)\](?:\s+[—-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (m) out.push({ version: m[1], date: m[2] ?? null });
  }
  return out;
}

const cmp = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe("CHANGELOG.md — PRD §30", () => {
  const hs = headings();

  it("has at least one entry", () => {
    expect(hs.length).toBeGreaterThan(0);
  });

  // §30's invariant: a version cannot ship with no notes.
  it("the top RELEASED entry equals package.json's version", () => {
    const released = hs.filter((h) => h.version !== "Unreleased");
    expect(released.length).toBeGreaterThan(0);
    expect(released[0].version).toBe(PKG.version);
  });

  it("every released version is valid semver and the list strictly descends", () => {
    const released = hs.filter((h) => h.version !== "Unreleased").map((h) => h.version);
    for (const v of released) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    for (let i = 1; i < released.length; i++) {
      expect(cmp(released[i - 1], released[i])).toBeGreaterThan(0);
    }
  });

  it("every released entry carries a date, and only the TOP heading may be Unreleased", () => {
    hs.forEach((h, i) => {
      if (h.version === "Unreleased") expect(i).toBe(0);
      else expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // Rule 1 of the voice, enforced mechanically: no conventional-commit prose.
  it("contains no conventional-commit prose", () => {
    const offenders = MD.split("\n").filter((l) =>
      /^\s*[-*]\s*(feat|fix|chore|docs|refactor|test|perf|style|ci)\s*[(:]/.test(l),
    );
    expect(offenders).toEqual([]);
  });

  // Rule 5: the runtime pins line is the ONE piece of technical detail that stays,
  // and it must match what is actually vendored.
  it("names the runtime pins currently vendored", () => {
    const d = JSON.parse(readFileSync(join(ROOT, "pi-runtime", "package.json"), "utf8"))
      .dependencies as Record<string, string>;
    const line =
      `Runtime: Pi ${d["@earendil-works/pi-coding-agent"]}` +
      ` · sub-agents ${d["pi-subagents"]}` +
      ` · MCP adapter ${d["pi-mcp-adapter"]}`;
    expect(MD).toContain(line);
  });
});
```

- [ ] **Step 2: Run it and watch the invariant fail**

```bash
L=/tmp/hv-changelog.log
npx vitest run tests/changelog.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: FAIL on *"the top RELEASED entry equals package.json's version"* — `released.length` is 0, because the only heading is `[Unreleased]`. This is the proof the test can fail; do not skip it.

- [ ] **Step 3: Stamp the release and fix the package identity**

In `CHANGELOG.md`, replace the heading on line 9:

```
## [Unreleased]
```

with:

```
## [0.1.0] — 2026-08-30
```

In the same file, replace lines 5–7:

```
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see
[§30 of the PRD](docs/prd.md) for what each number means here.
```

with (the relative link becomes absolute — it must work from a packaged build, where `docs/prd.md` does not ship at all):

```
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see
[§30 of the PRD](https://github.com/guiguito/HappyVibe/blob/main/docs/prd.md) for what each
number means here.
```

In `package.json`, replace lines 2–8's scaffold values:

```json
  "name": "happyvibe",
  "productName": "HappyVibe",
  "version": "0.1.0",
  "description": "Vibe coding you can actually watch.",
  "main": "./out/main/index.js",
  "author": "Guilhem Duché <guilhem.duche@gmail.com>",
  "homepage": "https://happyvibe.dev",
```

Keep every other key byte-identical. Do **not** touch `productName` — Electron derives userData from it, and changing it would move every existing user's sessions.

- [ ] **Step 4: Run the test and the skill's own checker**

```bash
L=/tmp/hv-changelog.log
npx vitest run tests/changelog.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
bash .claude/skills/changelog/scripts/changelog.sh check
```

Expected: vitest PASS (6 tests). `changelog.sh check` exits 0 and prints `ok — 0.1.0` under *Invariant*.

- [ ] **Step 5: Confirm nothing read the old package name**

```bash
grep -rn "hv-scaffold" src/ pi-runtime/extensions/ electron-builder.yml 2>/dev/null
```

Expected: only the two explanatory comments in `src/main/ipc.ts` and `src/main/index.ts` about the historic userData rename. **No code reads it.** If anything else appears, stop and report it — the rename is not safe.

- [ ] **Step 6: Commit**

```bash
git add tests/changelog.test.ts CHANGELOG.md package.json
git commit -m "chore(release): 0.1.0, and the invariant that stops a version shipping with no notes"
```

---

### Task 2: Stop a relative markdown link from destroying the app window

Pre-existing and reachable today from a chat answer, a `SKILL.md` preview (`SkillsSection.tsx:449`) or any `.md` opened in the editor (`FileTab.tsx:332`) — the changelog is simply the first page that ships one on purpose. The fix goes where all callers route through.

**Files:**
- Create: `src/main/navGuard.ts`
- Test: `tests/nav-guard.test.ts` (create)
- Modify: `src/main/index.ts:62-68`

**Interfaces:**
- Produces: `navAction(url: string, current: string): "allow" | "external" | "block"` — exported from `src/main/navGuard.ts`. Nothing else consumes it.

- [ ] **Step 1: Write the failing test**

Create `tests/nav-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { navAction } from "../src/main/navGuard";

const APP = "file:///Applications/HappyVibe.app/Contents/Resources/app.asar/out/renderer/index.html";

describe("navAction", () => {
  it("lets the renderer's own URL through", () => {
    expect(navAction(APP, APP)).toBe("allow");
  });

  it("sends http(s) and mailto to the OS browser", () => {
    expect(navAction("https://keepachangelog.com/en/1.1.0/", APP)).toBe("external");
    expect(navAction("http://localhost:5173/x", APP)).toBe("external");
    expect(navAction("mailto:hi@example.com", APP)).toBe("external");
  });

  // The whole point: a RELATIVE markdown link resolves against the renderer's
  // own URL and is neither http nor the current page, so the old guard let it
  // navigate the SPA away with no way back but restarting the app.
  it("BLOCKS a resolved relative link rather than navigating the app away", () => {
    const resolved = new URL("docs/prd.md", APP).href;
    expect(navAction(resolved, APP)).toBe("block");
  });

  it("blocks other schemes it does not understand", () => {
    expect(navAction("file:///etc/passwd", APP)).toBe("block");
    expect(navAction("javascript:alert(1)", APP)).toBe("block");
    expect(navAction("data:text/html,<h1>x", APP)).toBe("block");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/hv-nav.log
npx vitest run tests/nav-guard.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: FAIL — `Failed to resolve import "../src/main/navGuard"`.

- [ ] **Step 3: Write the module**

Create `src/main/navGuard.ts`:

```ts
/**
 * What to do with one `will-navigate` attempt.
 *
 * The old inline rule only PREVENTED navigation for `http(s)`/`mailto`, so
 * anything else — most importantly a RELATIVE markdown link, which resolves
 * against the renderer's own URL — fell through and navigated the whole SPA
 * to a dead page with no way back but restarting the app. Reachable today
 * from a chat answer, a SKILL.md preview or any .md opened in the editor,
 * so the guard belongs here, in front of every caller, rather than in the
 * one page that happens to ship such a link.
 *
 * Default is BLOCK. There is no in-app router, so the only legitimate
 * navigation is to the URL already loaded.
 */
export function navAction(url: string, current: string): "allow" | "external" | "block" {
  if (url === current) return "allow";
  return /^(https?|mailto):/i.test(url) ? "external" : "block";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
L=/tmp/hv-nav.log
npx vitest run tests/nav-guard.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into main**

In `src/main/index.ts`, add to the imports at the top of the file:

```ts
import { navAction } from './navGuard'
```

Then replace the `will-navigate` handler (currently lines 62–68):

```ts
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && /^(https?|mailto):/.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
```

with:

```ts
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const action = navAction(url, mainWindow.webContents.getURL())
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') void shell.openExternal(url)
  })
```

Leave the `setWindowOpenHandler` above it untouched — it already covers `target=_blank` / `window.open`.

- [ ] **Step 6: Verify main still builds**

```bash
L=/tmp/hv-build.log
npm run build > $L 2>&1; echo "EXIT=$?"
tail -20 $L
grep -c "navAction" out/main/index.js
```

Expected: EXIT=0, and `grep` returns ≥1 — the guard is in the **built** bundle, not just the source. A dev-server reload does not rebuild main (CLAUDE.md), so the source is not the app.

- [ ] **Step 7: Commit**

```bash
git add src/main/navGuard.ts src/main/index.ts tests/nav-guard.test.ts
git commit -m "fix(main): a relative markdown link no longer navigates the app away"
```

---

### Task 3: The version and pins as build-time constants

§30: the version is a build-time fact, and the honest representation of one is a constant — not an `app.getVersion()` IPC round trip.

**Files:**
- Modify: `electron.vite.config.ts` (the `renderer` block)
- Modify: `src/renderer/src/env.d.ts`

**Interfaces:**
- Produces: two renderer globals — `declare const __APP_VERSION__: string` (e.g. `"0.1.0"`) and `declare const __RUNTIME_PINS__: string` (e.g. `"Pi 0.84.2 · sub-agents 0.58.0 · MCP adapter 2.26.1"`). Task 5's `ChangelogView` and Task 6's dot both read them.

- [ ] **Step 1: Inject the constants**

In `electron.vite.config.ts`, add to the existing imports at the top:

```ts
import { readFileSync } from 'fs'
```

Then, immediately after the imports and before `export default defineConfig({`, add:

```ts
// §30: ONE version, and it lives in package.json. The renderer receives it as a
// build-time constant rather than an app.getVersion() IPC round trip, because it
// IS a build-time fact. The pins come from the vendored runtime's own manifest
// for the same reason — §3's promise is that the Pi inside is pinned and tested,
// so the number the page shows has to be the number that was built in.
const readJson = (p: string): Record<string, never> =>
  JSON.parse(readFileSync(resolve(__dirname, p), 'utf8'))
const pkg = readJson('package.json') as unknown as { version: string }
const pins = (readJson('pi-runtime/package.json') as unknown as {
  dependencies: Record<string, string>
}).dependencies
const runtimePins =
  `Pi ${pins['@earendil-works/pi-coding-agent']}` +
  ` · sub-agents ${pins['pi-subagents']}` +
  ` · MCP adapter ${pins['pi-mcp-adapter']}`
```

Then inside the `renderer: { ... }` object, as a sibling of `resolve`, `build` and `plugins`, add:

```ts
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __RUNTIME_PINS__: JSON.stringify(runtimePins)
    },
```

- [ ] **Step 2: Declare them for TypeScript**

Replace the whole contents of `src/renderer/src/env.d.ts` with:

```ts
/// <reference types="vite/client" />

// §30: injected by electron.vite.config.ts's `define`. Build-time constants,
// not runtime values — there is deliberately no IPC behind either of them.
declare const __APP_VERSION__: string
declare const __RUNTIME_PINS__: string
```

- [ ] **Step 3: Verify the constants reach the BUILT renderer bundle**

```bash
L=/tmp/hv-build.log
npm run build > $L 2>&1; echo "EXIT=$?"
tail -20 $L
grep -ro "0\.1\.0" out/renderer/assets/*.js | head -3
grep -ro "sub-agents 0\.58\.0" out/renderer/assets/*.js | head -3
```

Expected: EXIT=0, and both greps hit. If `__APP_VERSION__` appears literally in the bundle instead, `define` is in the wrong block — it must be inside `renderer`, not at the top level.

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts src/renderer/src/env.d.ts
git commit -m "feat(version): the running version and the runtime pins as build-time constants"
```

---

### Task 4: Remember the version the user last read

A straight clone of the `onboardingSeen` chain (`config.ts:250-258` → `ipc.ts:3158-3159` → `preload/index.ts:211-212` → `hv.d.ts:990-991`) with a version string instead of a boolean.

**Files:**
- Modify: `src/main/config.ts:24` and `:250-258`
- Modify: `src/main/ipc.ts:3156-3159`
- Modify: `src/preload/index.ts:211-212`
- Modify: `src/renderer/src/hv.d.ts:990-991`

**Interfaces:**
- Produces: `window.hv.getLastSeenVersion(): Promise<string | null>` and `window.hv.setLastSeenVersion(v: string): Promise<void>`. Task 6 consumes both. `null` means *never recorded* — which is both a fresh install and an existing install upgrading into this feature, and both must show no dot.

- [ ] **Step 1: Add the config field and accessors**

In `src/main/config.ts`, beside the existing `onboardingSeen?: boolean;` on line 24 of the `ConfigFile` interface, add:

```ts
  /**
   * §30: the app version whose changelog the user has read. `undefined` means
   * never recorded — which is a fresh install AND an existing install meeting
   * this feature for the first time. Both must show no dot, so the caller
   * seeds it silently rather than treating absence as "everything is new".
   */
  lastSeenVersion?: string;
```

Then, immediately after `setOnboardingSeen` (which ends at line 258), add:

```ts
// §30: the changelog dot's flag. Same chain as onboardingSeen, a string instead
// of a boolean, because "have you read THIS version's notes" is not a yes/no
// that survives the next release.
export function getLastSeenVersion(): string | null {
  return load().lastSeenVersion ?? null;
}

export function setLastSeenVersion(version: string): void {
  const cfg = load();
  cfg.lastSeenVersion = version;
  save(cfg);
}
```

- [ ] **Step 2: Add the IPC handlers**

In `src/main/ipc.ts`, add `getLastSeenVersion` and `setLastSeenVersion` to the existing import from `./config` that already brings in `getOnboardingSeen`/`setOnboardingSeen`. Then, immediately after line 3159 (`ipcMain.handle("hv:set-onboarding-seen", …)`), add:

```ts
  // §30: which version's changelog the user has read. See config.ts for why
  // absence is seeded rather than treated as "all of it is new".
  ipcMain.handle("hv:get-last-seen-version", () => getLastSeenVersion());
  ipcMain.handle("hv:set-last-seen-version", (_e, v: string) => setLastSeenVersion(String(v)));
```

- [ ] **Step 3: Expose them on the preload bridge**

In `src/preload/index.ts`, immediately after line 212 (`setOnboardingSeen: …`), add:

```ts
  getLastSeenVersion: () => ipcRenderer.invoke("hv:get-last-seen-version"),
  setLastSeenVersion: (version: string) => ipcRenderer.invoke("hv:set-last-seen-version", version),
```

- [ ] **Step 4: Type them**

In `src/renderer/src/hv.d.ts`, immediately after line 991 (`setOnboardingSeen(seen: boolean): Promise<void>;`), add:

```ts
  /** §30: the app version whose changelog was last read. `null` = never recorded. */
  getLastSeenVersion(): Promise<string | null>;
  setLastSeenVersion(version: string): Promise<void>;
```

- [ ] **Step 5: Verify it typechecks end to end**

```bash
L=/tmp/hv-build.log
npm run build > $L 2>&1; echo "EXIT=$?"
tail -20 $L
grep -c "hv:get-last-seen-version" out/main/index.js out/preload/index.js
```

Expected: EXIT=0, and both built files contain the channel name — main and preload are separate bundles and a missing preload line fails silently at runtime, not at build.

- [ ] **Step 6: Commit**

```bash
git add src/main/config.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(config): remember which version's changelog the user has read"
```

---

### Task 5: The Changelog page

**Files:**
- Create: `src/renderer/src/components/ChangelogView.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx:10-20` (the `View` union), the icon block near `:85`, and `NAV` at `:180-204`
- Modify: `src/renderer/src/App.tsx:2274` (the view chain)

**Interfaces:**
- Consumes: `__APP_VERSION__`, `__RUNTIME_PINS__` (Task 3).
- Produces: the `"changelog"` member of the `View` union, and `<ChangelogView onSeen={() => void} />`. Task 6 passes `onSeen`.

- [ ] **Step 1: Write the page**

Create `src/renderer/src/components/ChangelogView.tsx`:

```tsx
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// §30: the bundled notes. `?raw` inlines the file into the renderer bundle at
// build time — no new dependency, no change to what gets packaged, and no fs
// read at runtime (the packaged app has no repo to read from).
import changelog from "../../../../CHANGELOG.md?raw";

/**
 * §30: the Changelog page. Product state, like Stats and Audit log — this does
 * NOT reopen round 8's deletion of the Help nav entry (§7); a changelog is not
 * documentation.
 *
 * The header reports the version you are RUNNING and the pins that were built
 * into it. The pins deliberately also appear at the foot of each entry: those
 * two answer different questions — the header is this build, an entry is the
 * build it shipped in — and they diverge on every entry but the newest.
 *
 * Explicitly not here: any check for a newer version. That needs a publish
 * feed the app does not have, and claiming to know would be a lie.
 */
export function ChangelogView({ onSeen }: { onSeen: () => void }): React.JSX.Element {
  // Opening the page IS reading it — that is what clears the dot.
  useEffect(() => {
    onSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight">HappyVibe {__APP_VERSION__}</h1>
        <p className="text-sm text-ink-soft font-mono mt-1 mb-8">{__RUNTIME_PINS__}</p>
        <div className="md rounded-2xl bg-card border-2 border-line shadow-sticker-lg px-6 py-5 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{changelog}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the destination to the sidebar**

In `src/renderer/src/components/Sidebar.tsx`, extend the `View` union — add `"changelog"` to the line that already carries `"stats"` and `"audit"`, so it reads:

```ts
  | "models" | "permissions" | "sysprompt" | "onBehalf" | "stats" | "audit" | "changelog" | "shortcuts"
```

Then, beside the other nav icons (after `AuditIcon`'s definition, around line 85–170), add:

```tsx
/** §30: the Changelog page — a page with a turned corner. */
function ChangelogIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}
```

Then, at the very end of the `NAV` array (after the `audit` entry, which currently closes the *"Consulted, not changed"* block), add:

```ts
  // §30: product state, like the two above it — not documentation, so this does
  // not reopen round 8's deletion of the Help entry (§7).
  { view: "changelog", label: "Changelog", Icon: ChangelogIcon },
```

- [ ] **Step 3: Mount it**

In `src/renderer/src/App.tsx`, immediately after line 2274 (`{activeView === "audit" && <AuditView … />}`), add:

```tsx
        {activeView === "changelog" && <ChangelogView onSeen={markChangelogSeen} />}
```

Add the import beside the other component imports at the top of the file:

```tsx
import { ChangelogView } from "./components/ChangelogView";
```

`markChangelogSeen` is defined in Task 6. Until then, add a temporary stand-in right above the `return (` of the `App` component so this task builds on its own:

```tsx
  // Replaced by the real flag-clearing callback in the next task.
  const markChangelogSeen = (): void => {};
```

- [ ] **Step 4: Verify the markdown reached the BUILT bundle**

```bash
L=/tmp/hv-build.log
npm run build > $L 2>&1; echo "EXIT=$?"
tail -20 $L
grep -c "vibe coding you can actually watch" out/renderer/assets/*.js
```

Expected: EXIT=0 and the grep returns ≥1. If the build fails resolving `?raw`, the file is outside the renderer root (`src/renderer`) — confirm the relative depth is four levels (`../../../../CHANGELOG.md`) from `src/renderer/src/components/`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChangelogView.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat(changelog): a Changelog page, beside Stats and Audit log"
```

---

### Task 6: The passive dot

**Files:**
- Modify: `src/renderer/src/App.tsx` (state near `:135`, the stand-in from Task 5, the `<Sidebar …>` props at `:2206`)
- Modify: `src/renderer/src/components/Sidebar.tsx` (props block near `:382-426`, the `Settings ›` button at `:753-764`, the `NAV.map` at `:767-786`)

**Interfaces:**
- Consumes: `window.hv.getLastSeenVersion()` / `setLastSeenVersion()` (Task 4), `__APP_VERSION__` (Task 3).
- Produces: a `changelogUnread: boolean` prop on `Sidebar`, and `markChangelogSeen()` replacing Task 5's stand-in.

- [ ] **Step 1: Hold and seed the flag in App**

In `src/renderer/src/App.tsx`, beside the other view-level state (near line 135, next to `const [onboarding, setOnboarding] = useState(false);`), add:

```tsx
  /**
   * §30: the changelog dot. TRUE only when a version the user has actually
   * read is DIFFERENT from this one — never when nothing has been recorded,
   * because that is a fresh install (or an existing install meeting this
   * feature for the first time) and neither has been *updated*. That case is
   * seeded silently below, which is why 0.1.0 shows a dot to nobody.
   */
  const [changelogUnread, setChangelogUnread] = useState(false);

  useEffect(() => {
    void (async () => {
      const seen = await window.hv.getLastSeenVersion();
      if (seen === null) void window.hv.setLastSeenVersion(__APP_VERSION__);
      else setChangelogUnread(seen !== __APP_VERSION__);
    })();
  }, []);
```

Then replace Task 5's stand-in with the real callback:

```tsx
  const markChangelogSeen = (): void => {
    setChangelogUnread(false);
    void window.hv.setLastSeenVersion(__APP_VERSION__);
  };
```

Finally, pass the flag down — in the `<Sidebar …>` element around line 2206, beside `settingsOpen={settingsOpen}`, add:

```tsx
          changelogUnread={changelogUnread}
```

- [ ] **Step 2: Render the two dots**

In `src/renderer/src/components/Sidebar.tsx`, add to the props destructuring (beside `settingsOpen`) and to its type block:

```ts
  changelogUnread,
```

```ts
  /** §30: an unread changelog — a passive dot, never a modal. */
  changelogUnread: boolean;
```

Add the dot element itself, once, above the `SessionRow` function:

```tsx
/** §30: the unread-changelog marker. Passive by construction — no count, no
    colour that reads as an error, and nothing to dismiss but reading it. */
function UnreadDot(): React.JSX.Element {
  return <span className="size-2 rounded-full bg-tangerine shrink-0" aria-label="unread" />;
}
```

In the `Settings ›` button (currently ending with `<span className="flex-1" />` around line 763), replace that spacer line with:

```tsx
          <span className="flex-1" />
          {/* §30: the dot bubbles up through collapse the user did not choose.
              The group being closed hides the row, so it shows here — but the
              ⌘B icon rail above is an explicit "hide the sidebar" gesture and
              deliberately shows nothing. */}
          {changelogUnread && !settingsOpen && <UnreadDot />}
```

In the `NAV.map` body, replace the button's children (`<n.Icon />` and `{n.label}`) with:

```tsx
                  <n.Icon />
                  <span className="flex-1 text-left">{n.label}</span>
                  {n.view === "changelog" && changelogUnread && <UnreadDot />}
```

Leave the ⌘B collapsed rail (the `if (railCollapsed)` branch near line 508) **untouched** — that absence is the decision, not an oversight.

- [ ] **Step 3: Verify the whole thing builds and the suite is green**

```bash
L=/tmp/hv-gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: EXIT=0. The non-live suite is ~25–40 s and both typechecks run first.

- [ ] **Step 4: Confirm the live batch is not required**

```bash
npm run live:why
```

Expected: **empty output** — nothing in this change touches `pi-runtime/extensions/`, `src/main/pi/` or a live test file. If it prints anything, run `npm run test:live` in the background before continuing. Say which it was; do not silently omit it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx
git commit -m "feat(changelog): a passive dot when the version you last read is not this one"
```

---

### Task 7: GUI verification

**Not a "GUI pass".** Every line below is an assertion someone can check without re-deriving the design. Run the app with `npm run dev`. Note that `src/main` changes need a dev-server **restart**, not a ⌘R reload.

**Files:** none — this task changes nothing. It either passes or sends you back to a task.

- [ ] **Step 1: The page exists, in the right place, saying the right numbers**

- **Observed on: the sidebar, Settings group expanded.** A **Changelog** row is the **last** entry, below **Stats** and **Audit log**, in that order.
- **Observed on: the Changelog page.** The header reads exactly `HappyVibe 0.1.0`. Beneath it, in muted monospace: `Pi 0.84.2 · sub-agents 0.58.0 · MCP adapter 2.26.1`.
- **Observed on: the Changelog page.** The body's first heading is `0.1.0 — 2026-08-30`, and the version in it is the **same string** as the header's. Bullets render as bullets, bold as bold — not as raw markdown asterisks.
- **Observed on: the Changelog page.** The pins line appears **twice** — once under the title, once at the foot of the entry. This is intended; do not report it as a bug.

- [ ] **Step 2: Absence assertions — the things that must NOT be on screen**

- **`Unreleased` appears nowhere on the page.** Named absence. The stamp is what makes the page truthful, and an `Unreleased` heading is exactly what a page shipped too early would show.
- **No dot anywhere in the sidebar on a normal launch.** Named absence, and the whole point of the fresh-install rule: neither the `Settings ›` row nor the **Changelog** row carries one, because `lastSeenVersion` was unset and got seeded silently. If a dot appears here, the seeding branch is inverted.
- **Observed on: the native About panel** — a surface that owns the version but is not the surface that changed. macOS menu bar ▸ **HappyVibe** ▸ **About HappyVibe** reads `Version 0.1.0`. It read `1.0.0` before this work; if it still does, `package.json` was not stamped or the app was not rebuilt.
- **`hv-scaffold` appears nowhere in that About panel**, and the app is still named **HappyVibe**.

- [ ] **Step 3: Regression sequence — the dot's whole life**

The design risks a dot that never appears, appears forever, or appears on a fresh install. Perform this in order:

1. Quit the app.
2. Edit `~/Library/Application Support/HappyVibe/config.json` and set `"lastSeenVersion": "0.0.9"`.
3. Relaunch. **Collapse the Settings group.** → a dot sits on the `Settings ›` row.
4. Expand the Settings group. → the dot is **also** on the **Changelog** row, and still on nothing else.
5. Press **⌘B** to collapse the sidebar to the 48px icon rail. → **no dot on the gear.** This is the named absence for the bubbling rule; a dot here means the rail branch was edited when it should not have been.
6. Press **⌘B** again, then click **Changelog**. → both dots disappear immediately.
7. Navigate to **Stats**, then back to **Changelog**. → still no dot; nothing flickers back.
8. Quit and relaunch. → still no dot. (If one returns, `setLastSeenVersion` is not reaching `config.json` — check the preload line, which fails silently.)

- [ ] **Step 4: Regression sequence — links no longer destroy the window**

This is the one the design most risks, because the failure is unrecoverable from inside the app:

1. On the **Changelog** page, click **Keep a Changelog**. → it opens in your system browser, **and the app window still shows the Changelog page**.
2. Click **§30 of the PRD**. → same: system browser, app unchanged. Before Task 2 this was a relative link and would have replaced the whole app with a dead page.
3. Prove the guard did not over-fire: open a chat, ask the agent for any `https://` link, and click it in the answer. → still opens externally, app unchanged.
4. Open a `.md` file from the file tree in the editor. → renders, and any link in it behaves as above.

- [ ] **Step 5: Record the result**

If every assertion above holds, note it in the PR body as *"§30 GUI assertions 1–4 verified on `npm run dev`, <date>"*. If any fails, name **which numbered assertion** failed rather than "the GUI pass failed" — the number identifies the task to go back to.

---

## Self-Review

**Spec coverage** — every §30 decision maps to a task:

| §30 decision | Task |
|---|---|
| One number, SemVer, `0.x` until launch; the invariant test | 1 |
| Hand-written changelog, seven voice rules | already shipped (`CHANGELOG.md`, the `changelog` skill) — Task 1 only stamps it |
| A Changelog page beside Stats and Audit log | 5 |
| Version + pins in the header, as build-time constants | 3, 5 |
| The passive dot; fresh install shows none | 4, 6 |
| The bubbling rule (Settings button yes, ⌘B rail no) | 6 step 2, verified Task 7 step 3.5 |
| The pins appearing twice is intended | verified Task 7 step 1 |
| No update check | nothing built — asserted by absence in Task 7 |
| Page + identity + stamp ship together | 1 and 5–6 land on one branch, one PR |
| The `will-navigate` relative-link guard | 2 |

**Placeholders:** none. Every code step carries the actual code; every verification names the exact command and the expected output.

**Type consistency:** `navAction(url, current) → "allow" | "external" | "block"` is defined in Task 2 and used only there. `getLastSeenVersion(): Promise<string | null>` / `setLastSeenVersion(version: string)` are defined in Task 4 and consumed in Task 6 with the same names and types. `__APP_VERSION__` / `__RUNTIME_PINS__` are defined in Task 3 and read in Tasks 5 and 6. `changelogUnread: boolean` and `markChangelogSeen(): void` are introduced in Tasks 5–6 with one spelling each; Task 5's stand-in is explicitly replaced in Task 6 step 1.

**Known ordering constraint:** Task 5 does not typecheck without Task 3's `env.d.ts` declarations, and Task 6 replaces a stand-in Task 5 introduces. Run 1 → 7 in order.
