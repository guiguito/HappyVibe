# Multi-window Implementation Plan

> **STATUS: IMPLEMENTED** — all four stages landed on `guiguito/multiwindow`, ten commits
> (`af26c1d`…`7041384`). Gate green at every commit; final `266 files, 3360 tests`.
> `npm run live:why` prints nothing throughout — no Pi-facing file is touched by this round.
>
> ## What the GUI pass found, and no test could
>
> Seven bugs. Every one of them was reachable only by driving the real app, and each is
> pinned now in `tests/window-single-owner.test.ts`.
>
> 1. **The tab context menu never opened on a file tab.** Round 12 gated `onContextMenu`
>    on `if (!isChat && !isTerm) return;` because the menu existed only for Rename — so
>    "Move to new window" was unreachable on exactly the kind whose move carries an
>    unsaved buffer. Right-clicking `notes.txt` did nothing at all.
> 2. **React StrictMode ate the travelling draft.** It double-invokes the mount effect, so
>    the first `load` consumed-and-deleted the draft and the second overwrote the editor
>    with the file on disk. The tab arrived clean, showing none of the text.
> 3. **`onClick={load}` passed a MouseEvent as `useDraft`** — truthy, so "Reload from disk"
>    would have resurrected the draft. The typechecker caught this one the moment `load`
>    grew a flag.
> 4. **Counting `uiOwners` counted notifies.** That map holds every ui-request, and a
>    notify is fire-and-forget so nothing deletes it — the sidebar's attention count climbed
>    with every transcript card and kept counting deleted sessions. Measured live as
>    `{sessionA: 2, deletedSession: 3, sessionB: 4}` with exactly one prompt open.
> 5. **A window arriving with a browser tab had an empty URL bar** over a page that was
>    loaded, visible and correctly re-parented: `hv:browser-state` had been pushed before
>    that window existed, and boot seeded terminals but only the browsers' alive-SET.
> 6. **One drag both moved a tab and tore off a window.** A drop that leaves
>    `dropEffect === "none"` made the gesture do two things — the worst kind of latent bug,
>    since a real drop usually sets the effect. Tear-off now keys off whether the drag was
>    CONSUMED, never off a DOM field.
> 7. **`showOpenDialog`'s window overload rejects `undefined`**, so `ownerOf` had to become
>    non-nullable rather than quietly parenting a sheet on nothing.
>
> ## Two plan corrections made while building
>
> - **`persistLayout` could not land in stage 1.** Writing the new file shape while the
>   renderer still read the legacy one would have cost the user their tabs, so bounds and
>   persistence moved into the same commit as the renderer switch.
> - **`hv:window-boot` lives in `index.ts`, not `ipc.ts`.** preload asks for it with
>   `sendSync` at module load, so a handler registered later would block that renderer on a
>   message nobody answers.
>
> ## One thing a human should still do
>
> The cross-window drag was verified with **dispatched** drag events, including the
> empty-`dataTransfer` case the OS actually delivers. What automation cannot do is perform a
> real OS drag between two windows: the design no longer depends on the dataTransfer
> surviving the hop, only on `dragover`/`drop` reaching the other window. Worth one drag by
> hand.
>
> ## Also worth knowing
>
> - Existing installs get a **one-time chrome adoption** (`ADOPTED` in `uiStore.ts`).
>   Without it every install silently lost its sidebar collapse, drawer widths and active
>   workspace, because the record starts empty and the tabs survive — which is what makes
>   that loss easy to miss.
> - `pendingCounts` was **deleted** from `permission.ts` with its test. Main owns that
>   computation now, and a tested-but-uncalled export is the dead-code shape this repo has
>   been bitten by before.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second HappyVibe window that is a full peer of the first — any tab kind, its own 2×2 grid, its own sidebar and workspace — with tabs moving between windows by menu, by drag, and by tear-off.

**Architecture:** Main grows a window registry and broadcasts every push to every window; the renderer stays the same `App.tsx` and simply renders only the sessions whose tabs it holds (the invariant: **a tab lives in exactly one window**). Per-window state that lives in `localStorage` today moves into a per-window record main persists as a list, primary first. Prompts are routed to the window holding the session's chat tab; browser views are re-parented to whichever window reports their bounds.

**Tech Stack:** Electron 44 (`BrowserWindow`, `WebContentsView`, `ipcMain`/`ipcRenderer.sendSync`), React 18 + Tailwind renderer, TypeScript main, vitest 5 with NO DOM.

**Spec:** Notion "Multi-window" page (under Feedbacks v12); `docs/prd.md` §7 round 16 (the deferral) and round 23 (the seven decisions). Code state: `a86fcdf`.

## Global Constraints

- **The renderer suite has NO DOM.** `vitest.config.ts` includes `tests/**/*.test.ts` only. A visual contract is pinned in two halves: pure exports asserted as DATA, plus a source scan for what must be ABSENT (`tests/modal-layer.test.ts` is the pattern). Tests may import pure exports from `.tsx`; they may not render.
- **Main modules that tests import must be electron-free.** `spawn.ts` is the precedent. New pure modules (`windows.ts` registry core, `windowLayout.ts`, `promptRouting.ts`, `tearOff.ts`) take structural types, never `BrowserWindow`.
- **Never run `npm run lint` / `npm run format`.** Scaffold leftovers.
- **Never run `npm run typecheck` before `build`/`gate`.** `build` runs both typechecks first.
- **Never pipe a test run to `tail`/`grep`.** Redirect once, then grep the file:
  ```
  L=/tmp/vitest.log
  npx vitest run <target> > $L 2>&1; echo "EXIT=$?"
  tail -30 $L
  ```
- **No live-Pi run is expected.** Nothing here touches `pi-runtime/extensions/`, `src/main/pi/` or a live test. After each commit, `npm run live:why` must print NOTHING; say so in the commit body rather than silently omitting the batch.
- **`src/main` changes need a dev-server RESTART**, not ⌘R. Verify a main-side change in `out/main/index.js`, not in the source.
- **Main never learns what a tab is.** Records are opaque to main; the renderer builds every `WorkspaceTabs` it ships (the `getLayout`/`setLayout` division of labour, kept).
- **The egress hook stays installed once per PARTITION** (`browsers.ts` `egressInstalled`). Never per window.
- **Tab ids:** `:chat:<sid>`, `:term:<id>`, `:browser:<id>`, else a workspace-relative path (`tabs.ts:38-62`).
- Commit after every task. Message body names the stage.

---

## File Structure

**Create**
- `src/main/windows.ts` — `WindowRegistry`: the set of live windows, `primary()`, `broadcast(channel, payload)`, `ownerOf(sender)`, per-window opaque record + holdings. Structural `WinLike` type so vitest can drive it with fakes. Electron-free.
- `src/main/windowLayout.ts` — `parseLayoutFile(raw): WindowRecord[]`, incl. the legacy `Record<wsId, WorkspaceTabs>` → one-record migration. Electron-free.
- `src/main/promptRouting.ts` — `promptWindowFor(sessionId, holders, focusedId, primaryId)`. Pure.
- `src/main/tearOff.ts` — `insideAny(point, rects)`. Pure.
- `src/renderer/src/uiStore.ts` — `uiGet(key)` / `uiSet(key, value)` over the boot record's `ui` map, replacing `localStorage` for the nine per-window keys.
- `tests/window-registry.test.ts`, `tests/window-layout.test.ts`, `tests/prompt-routing.test.ts`, `tests/tear-off.test.ts`, `tests/window-single-owner.test.ts` (source scans).

**Modify**
- `src/main/index.ts` — create through the registry; Window ▸ New Window; restore N windows at launch; bounds tracking.
- `src/main/ipc.ts:492-498` — `registerIpc(windows)`; `send` = broadcast; dialogs parent on the sender; new handlers (`hv:window-boot`, `hv:set-window-tabs`, `hv:set-window-ui`, `hv:window-holds`, `hv:new-window`, `hv:move-tab`, `hv:claim-tab`, `hv:tear-off`); prompt stamping; badge sum; `hv:pending-changed`; `hv:ui-resolved`.
- `src/main/config.ts:520-532` — `getLayout`/`setLayout` become `getLayoutFile`/`setLayoutFile` over `{windows: unknown[]}`.
- `src/main/browsers.ts` — `win` leaves the constructor; per-entry window; re-parent on bounds.
- `src/preload/index.ts` — `boot` (sync), the new invokes, the new `on*` listeners; `getLayout`/`setLayout` removed.
- `src/renderer/src/hv.d.ts` — types for the above.
- `src/renderer/src/App.tsx` — boot from `window.hv.boot`, `uiStore` for chrome, holdings declaration, prompt filter, arrive/leave handlers, draft ref, tear-off.
- `src/renderer/src/components/Sidebar.tsx:643-662` — `hv:ws-collapsed`, `hv:sidebar-split` via `uiStore`.
- `src/renderer/src/components/TabStrip.tsx` — "Move to new window" menu item; JSON drag payload; `onDragEnd` tear-off.
- `src/renderer/src/components/FileTab.tsx` — `onDirtyChange(dirty, content)`; `takeDraft`.
- `src/renderer/src/layoutPersist.ts` — unchanged API; called per record.

---

## Stage 1 — a window registry in main

### Task 1: `WindowRegistry` (pure)

**Files:**
- Create: `src/main/windows.ts`
- Test: `tests/window-registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WinLike {
    id: number;
    isDestroyed(): boolean;
    webContents: { id: number; isDestroyed(): boolean; send(channel: string, payload?: unknown): void };
    on(event: "closed", cb: () => void): unknown;
  }
  export interface Holdings { sessions: string[]; terminals: string[]; browsers: string[] }
  export class WindowRegistry<W extends WinLike = WinLike> {
    setOnClosed(cb: (id: number, record: unknown, holds: Holdings) => void): void; // late-bound: ipc.ts sets it
    add(win: W, record: unknown): W;            // registers, wires `closed`
    primary(): W | null;                        // oldest live window
    all(): W[];                                 // live, creation order
    byId(id: number): W | null;
    bySender(wc: { id: number }): W | null;     // BrowserWindow.fromWebContents without electron
    broadcast(channel: string, payload?: unknown): void;
    record(id: number): unknown;                // opaque per-window record
    setRecord(id: number, r: unknown): void;
    records(): unknown[];                       // live windows' records, creation order
    holds(id: number): Holdings;
    setHolds(id: number, h: Holdings): void;
    holderOf(sessionId: string): number | null; // first window whose holdings name the session
  }
  ```

- [x] **Step 1: Write the failing test**

```ts
// tests/window-registry.test.ts
import { describe, expect, it, vi } from "vitest";
import { WindowRegistry, type WinLike } from "../src/main/windows";

function fakeWin(id: number): WinLike & { sent: [string, unknown][]; close(): void; destroyed: boolean } {
  let onClosed: (() => void) | null = null;
  const w = {
    id,
    destroyed: false,
    sent: [] as [string, unknown][],
    isDestroyed() { return w.destroyed; },
    webContents: { id: id * 10, isDestroyed() { return w.destroyed; }, send(c: string, p?: unknown) { w.sent.push([c, p]); } },
    on(_e: "closed", cb: () => void) { onClosed = cb; return w; },
    close() { w.destroyed = true; onClosed?.(); },
  };
  return w;
}

describe("WindowRegistry", () => {
  it("broadcasts to every live window and skips destroyed ones", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    a.destroyed = true; // destroyed but `closed` not yet delivered
    reg.broadcast("hv:x", 1);
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([["hv:x", 1]]);
  });

  it("primary is the oldest live window, and moves on when it closes", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    expect(reg.primary()).toBe(a);
    a.close();
    expect(reg.primary()).toBe(b);
    expect(reg.all()).toEqual([b]);
  });

  it("resolves a window from its webContents (the ipc sender)", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {});
    expect(reg.bySender({ id: 10 })).toBe(a);
    expect(reg.bySender({ id: 99 })).toBeNull();
  });

  it("keeps an opaque record per window, in creation order, and forgets it on close", () => {
    const onClosed = vi.fn();
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), { n: 1 });
    reg.setOnClosed(onClosed); // bound AFTER add — ipc.ts binds it after index.ts made the windows
    reg.add(fakeWin(2), { n: 2 });
    reg.setRecord(a.id, { n: "one" });
    expect(reg.records()).toEqual([{ n: "one" }, { n: 2 }]);
    reg.setHolds(a.id, { sessions: ["s1"], terminals: ["t1"], browsers: [] });
    a.close();
    expect(reg.records()).toEqual([{ n: 2 }]);
    expect(onClosed).toHaveBeenCalledWith(1, { n: "one" }, { sessions: ["s1"], terminals: ["t1"], browsers: [] });
  });

  it("names the window holding a session, or null", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    reg.setHolds(b.id, { sessions: ["s9"], terminals: [], browsers: [] });
    expect(reg.holderOf("s9")).toBe(b.id);
    expect(reg.holderOf("nope")).toBeNull();
    void a;
  });
});
```

- [x] **Step 2: Run it — expect FAIL (module not found)**

```
L=/tmp/vitest.log; npx vitest run tests/window-registry.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 3: Implement**

```ts
// src/main/windows.ts
/**
 * §7 round 23 — the set of app windows. Electron-free so the suite can drive
 * it with fakes; index.ts hands it real BrowserWindows.
 *
 * The record is OPAQUE: the renderer builds it (tabs, ui chrome), main only
 * stores and persists it — the getLayout/setLayout division of labour, kept.
 */
export interface WinLike {
  id: number;
  isDestroyed(): boolean;
  webContents: { id: number; isDestroyed(): boolean; send(channel: string, payload?: unknown): void };
  on(event: "closed", cb: () => void): unknown;
}

export interface Holdings { sessions: string[]; terminals: string[]; browsers: string[] }
const NO_HOLDS: Holdings = { sessions: [], terminals: [], browsers: [] };

export class WindowRegistry<W extends WinLike = WinLike> {
  private readonly wins: W[] = [];
  private readonly recs = new Map<number, unknown>();
  private readonly held = new Map<number, Holdings>();
  private onClosed: ((id: number, record: unknown, holds: Holdings) => void) | null = null;

  /** Late-bound on purpose: index.ts makes windows before ipc.ts has the managers the hook needs. */
  setOnClosed(cb: (id: number, record: unknown, holds: Holdings) => void): void { this.onClosed = cb; }

  add(win: W, record: unknown): W {
    this.wins.push(win);
    this.recs.set(win.id, record);
    win.on("closed", () => {
      const i = this.wins.indexOf(win);
      if (i >= 0) this.wins.splice(i, 1);
      const rec = this.recs.get(win.id);
      const holds = this.held.get(win.id) ?? NO_HOLDS;
      this.recs.delete(win.id);
      this.held.delete(win.id);
      this.onClosed?.(win.id, rec, holds);
    });
    return win;
  }

  all(): W[] { return this.wins.filter((w) => !w.isDestroyed()); }
  primary(): W | null { return this.all()[0] ?? null; }
  byId(id: number): W | null { return this.all().find((w) => w.id === id) ?? null; }
  bySender(wc: { id: number }): W | null { return this.all().find((w) => w.webContents.id === wc.id) ?? null; }

  broadcast(channel: string, payload?: unknown): void {
    for (const w of this.all()) {
      if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  record(id: number): unknown { return this.recs.get(id); }
  setRecord(id: number, r: unknown): void { if (this.recs.has(id)) this.recs.set(id, r); }
  records(): unknown[] { return this.all().map((w) => this.recs.get(w.id)); }

  holds(id: number): Holdings { return this.held.get(id) ?? NO_HOLDS; }
  setHolds(id: number, h: Holdings): void { this.held.set(id, h); }
  holderOf(sessionId: string): number | null {
    for (const w of this.all()) if (this.held.get(w.id)?.sessions.includes(sessionId)) return w.id;
    return null;
  }
}
```

- [x] **Step 4: Run — expect PASS.** Same command.

- [x] **Step 5: Commit**

```
git add src/main/windows.ts tests/window-registry.test.ts
git commit -m "feat(windows): a window registry in main — stage 1 of multi-window, nothing wired yet"
```

---

### Task 2: `registerIpc` takes the registry; every push fans out; dialogs parent on the sender

**Files:**
- Modify: `src/main/index.ts:38-81` (createWindow), `:143-172` (whenReady tail)
- Modify: `src/main/ipc.ts:492-498` (signature + `send`), `:548` (BrowserManager arg), the 7 `dialog.showOpenDialog(win, …)` sites (`:2538, :4112, :4133, :5075, :5105, :5461, :5508`)
- Test: `tests/window-single-owner.test.ts` (source scan)

**Interfaces:**
- Produces: `registerIpc(windows: WindowRegistry<BrowserWindow>): void`; in index.ts `export function openWindow(record: unknown, at?: {x:number;y:number}): BrowserWindow` (later tasks use it).
- BrowserManager still gets ONE window this stage: `windows.primary()!` — Task 10 removes it.

- [x] **Step 1: Write the failing source scan**

```ts
// tests/window-single-owner.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ipc = readFileSync("src/main/ipc.ts", "utf8");
const index = readFileSync("src/main/index.ts", "utf8");

describe("main is no longer bound to one window (round 23)", () => {
  it("registerIpc receives the registry, not a BrowserWindow", () => {
    expect(ipc).toMatch(/export function registerIpc\(windows: WindowRegistry<BrowserWindow>\)/);
    expect(ipc).not.toMatch(/export function registerIpc\(win: BrowserWindow\)/);
  });
  it("the one push helper is a broadcast", () => {
    expect(ipc).toMatch(/const send = \(channel: string, payload\?: unknown\): void => windows\.broadcast\(channel, payload\)/);
    expect(ipc).not.toMatch(/win\.webContents\.send\(/);
  });
  it("no dialog parents on a captured window", () => {
    expect(ipc).not.toMatch(/showOpenDialog\(win,/);
    expect(ipc.match(/showOpenDialog\(ownerOf\(e\)/g)?.length).toBe(7);
  });
  it("the dock-click window goes through the registry too", () => {
    expect(index).not.toMatch(/length === 0\) createWindow\(\)/);
    expect(index).toMatch(/if \(windows\.all\(\)\.length === 0\) openWindow\(/);
  });
});
```

- [x] **Step 2: Run — expect FAIL on all four.**

- [x] **Step 3: Implement in `index.ts`**

Replace `function createWindow(): BrowserWindow { … }` with:

```ts
import { WindowRegistry } from './windows'

export const windows = new WindowRegistry<BrowserWindow>()

/** Round 23: every window — first or fortieth — is made here and only here. */
export function openWindow(record: unknown, at?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    ...(at ? { x: at.x, y: at.y } : {}),
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  windows.add(win, record)
  win.on('ready-to-show', () => { win.show() })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const action = navAction(url, win.webContents.getURL())
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') void shell.openExternal(url)
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
```

In `whenReady`: replace `const mainWindow = createWindow()` with `openWindow({})`, `registerIpc(mainWindow)` with `registerIpc(windows)`, and the activate body with `if (windows.all().length === 0) openWindow({})`.

- [x] **Step 4: Implement in `ipc.ts`**

```ts
import type { WindowRegistry } from "./windows";
// ...
export function registerIpc(windows: WindowRegistry<BrowserWindow>): void {
  // Round 23: ONE push helper, and it fans out. Every window runs the same
  // reducer over the same stream and renders only the sessions it holds.
  const send = (channel: string, payload?: unknown): void => windows.broadcast(channel, payload);
  /** The window an ipc call came from — dialogs parent on it, never on "the" window. */
  const ownerOf = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): BrowserWindow | undefined =>
    windows.bySender(e.sender) ?? windows.primary() ?? undefined;
```

Then each of the 7 dialog handlers: change `async () =>` to `async (e) =>` and `showOpenDialog(win, {` to `showOpenDialog(ownerOf(e), {`. (`hv:skills-import-local` and `hv:prompt-templates-import-local` have two calls each in the grep — check `:5105/:5508` and the `if (!picked)` sites; the count must come to 7.) `new BrowserManager(win,` → `new BrowserManager(windows.primary()!,` for this stage.

- [x] **Step 5: Gate**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/gate.log
```
Expected: typecheck clean, suite green including the new scan.

- [x] **Step 6: GUI check (dev server RESTART)** — the app boots and behaves identically. Then on macOS: close the window (⌘⇧W), click the dock icon: the new window shows the session list (a push landed). Before this task that window was deaf.

- [x] **Step 7: Commit**

```
git commit -am "refactor(main): registerIpc takes the window registry; send() broadcasts; dialogs parent on the sender — stage 1"
```

---

## Stage 2 — a second window, every kind but browser

### Task 3: the layout file becomes a list of window records

**Files:**
- Create: `src/main/windowLayout.ts`
- Modify: `src/main/config.ts:85-90, 520-532`
- Test: `tests/window-layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WindowRecord {
    bounds?: { x: number; y: number; width: number; height: number };
    /** Opaque to main: Record<workspaceId, WorkspaceTabs>, validated by layoutPersist.ts in the renderer. */
    tabsByWs: unknown;
    /** Opaque to main: the per-window chrome the renderer used to keep in localStorage. */
    ui: Record<string, string>;
  }
  export function parseLayoutFile(raw: unknown): WindowRecord[];
  ```
  `config.ts`: `getLayoutFile(): unknown` and `setLayoutFile(records: WindowRecord[]): void` (writes `{windows: records}`; deletes the key when the list is empty).

- [x] **Step 1: Failing test**

```ts
// tests/window-layout.test.ts
import { describe, expect, it } from "vitest";
import { parseLayoutFile } from "../src/main/windowLayout";

const tabs = { ws1: { panes: [{ tabs: ["a.ts"], active: "a.ts" }, null, null, null], split: null, subSplit: [false, false], focused: 0, sizes: { main: 0.5, cross: 0.5 } } };

describe("parseLayoutFile", () => {
  it("reads the new shape: a list of window records", () => {
    const recs = parseLayoutFile({ windows: [{ bounds: { x: 1, y: 2, width: 300, height: 200 }, tabsByWs: tabs, ui: { "hv:active-ws": "ws1" } }] });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.bounds).toEqual({ x: 1, y: 2, width: 300, height: 200 });
    expect(recs[0]!.tabsByWs).toEqual(tabs);
    expect(recs[0]!.ui).toEqual({ "hv:active-ws": "ws1" });
  });
  it("migrates the legacy shape (Record<workspaceId, tabs>) to one primary record with empty ui", () => {
    const recs = parseLayoutFile(tabs);
    expect(recs).toEqual([{ tabsByWs: tabs, ui: {} }]);
  });
  it("drops junk records, non-string ui values and impossible bounds instead of throwing", () => {
    const recs = parseLayoutFile({ windows: [null, 3, { tabsByWs: {}, ui: { a: 1, b: "x" }, bounds: { x: "no" } }] });
    expect(recs).toEqual([{ tabsByWs: {}, ui: { b: "x" } }]);
  });
  it("junk or absent → no records (the caller opens one default window)", () => {
    expect(parseLayoutFile(undefined)).toEqual([]);
    expect(parseLayoutFile("nope")).toEqual([]);
    expect(parseLayoutFile({ windows: "x" })).toEqual([]);
  });
});
```

- [x] **Step 2: Run — FAIL (module not found).**

- [x] **Step 3: Implement**

```ts
// src/main/windowLayout.ts
/**
 * §7 round 23 — the persisted layout is a LIST of window records, primary
 * first. Two windows writing one `layout` key was last-write-wins.
 *
 * Main stays ignorant of what a tab is: `tabsByWs` and `ui` are stored and
 * handed back opaquely; the renderer validates and prunes (layoutPersist.ts).
 * Records are positional — a window has no identity across launches.
 */
export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowRecord { bounds?: Bounds; tabsByWs: unknown; ui: Record<string, string> }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseBounds(raw: unknown): Bounds | undefined {
  if (!isRecord(raw)) return undefined;
  const n = (k: string): number | null => (typeof raw[k] === "number" && Number.isFinite(raw[k]) ? (raw[k] as number) : null);
  const x = n("x"), y = n("y"), width = n("width"), height = n("height");
  if (x === null || y === null || width === null || height === null || width < 200 || height < 150) return undefined;
  return { x, y, width, height };
}

function parseRecord(raw: unknown): WindowRecord | null {
  if (!isRecord(raw) || !("tabsByWs" in raw)) return null;
  const ui: Record<string, string> = {};
  if (isRecord(raw.ui)) for (const [k, v] of Object.entries(raw.ui)) if (typeof v === "string") ui[k] = v;
  const bounds = parseBounds(raw.bounds);
  return { ...(bounds ? { bounds } : {}), tabsByWs: raw.tabsByWs ?? {}, ui };
}

export function parseLayoutFile(raw: unknown): WindowRecord[] {
  if (!isRecord(raw)) return [];
  if ("windows" in raw) {
    return Array.isArray(raw.windows) ? raw.windows.map(parseRecord).filter((r): r is WindowRecord => r !== null) : [];
  }
  // Legacy: the whole value was Record<workspaceId, WorkspaceTabs>.
  return [{ tabsByWs: raw, ui: {} }];
}
```

`config.ts`: keep the `layout?: Record<string, unknown>` field comment but note it now holds `{windows: WindowRecord[]}`; replace `getLayout`/`setLayout`:

```ts
export function getLayoutFile(): unknown { return load().layout; }
export function setLayoutFile(records: WindowRecord[]): void {
  const cfg = load();
  if (records.length > 0) cfg.layout = { windows: records };
  else delete cfg.layout;
  save(cfg);
}
```
(`import type { WindowRecord } from "./windowLayout"`.) The `hv:get-layout`/`hv:set-layout` handlers at `ipc.ts:3689-3690` are deleted in Task 4; leave them compiling for now by pointing them at the new functions, or delete both handler and preload lines together in Task 4 — the gate must stay green at every commit.

- [x] **Step 4: Run — PASS. Commit** `feat(windows): the layout file is a list of window records, legacy shape migrated — stage 2`

---

### Task 4: each renderer boots from its own record, and per-window chrome leaves `localStorage`

**Files:**
- Create: `src/renderer/src/uiStore.ts`
- Modify: `src/preload/index.ts:26` (add `boot`), `:360-361` (replace `getLayout`/`setLayout` with `setWindowTabs`/`setWindowUi`)
- Modify: `src/renderer/src/hv.d.ts`
- Modify: `src/main/ipc.ts` (`hv:window-boot` sync, `hv:set-window-tabs`, `hv:set-window-ui`; delete `hv:get-layout`/`hv:set-layout`)
- Modify: `src/main/index.ts` (open N windows from the file at launch; write the file on any record change and on `resize`/`move`)
- Modify: `src/renderer/src/App.tsx:231-311` (seven `localStorage` keys), `:703-745` (boot), `:1649-1661` (writer)
- Modify: `src/renderer/src/components/Sidebar.tsx:643-662` (two keys)
- Test: extend `tests/window-single-owner.test.ts`

**Interfaces:**
- Preload:
  ```ts
  boot: { windowId: number; record: { tabsByWs: unknown; ui: Record<string, string> } }  // ipcRenderer.sendSync("hv:window-boot")
  setWindowTabs: (tabsByWs: Record<string, unknown>) => Promise<void>   // invoke "hv:set-window-tabs"
  setWindowUi: (ui: Record<string, string>) => Promise<void>            // invoke "hv:set-window-ui"
  ```
- `uiStore.ts`:
  ```ts
  export function uiGet(key: string): string | null;
  export function uiSet(key: string, value: string | null): void;  // null deletes; every set pushes the whole map via setWindowUi
  ```
- Main: `windows.record(id)` is a `WindowRecord`; `persistLayout()` = `setLayoutFile(windows.records() as WindowRecord[])`, debounced 300 ms, called on `hv:set-window-tabs`, `hv:set-window-ui`, window `resize`/`move`, and window `closed` (so a closed window's record is forgotten on disk too — decision 5).

- [x] **Step 1: Extend the source scan (failing)**

```ts
// append to tests/window-single-owner.test.ts
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const sidebar = readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");

describe("per-window chrome is per window (round 23)", () => {
  const PER_WINDOW_KEYS = [
    "hv:active-ws", "hv:drawer-panel", "hv:drawer-width:", "hv:sidebar-collapsed",
    "hv:settings-open", "hv:settings-groups", "hv:ws-collapsed", "hv:sidebar-split",
  ];
  it("none of the nine per-window keys is read or written through localStorage any more", () => {
    for (const k of PER_WINDOW_KEYS) {
      expect(app + sidebar, k).not.toMatch(new RegExp(`localStorage\\.[gs]etItem\\([\`"']${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });
  it("the layout is read synchronously from the boot record and written per window", () => {
    expect(preload).toMatch(/boot: ipcRenderer\.sendSync\("hv:window-boot"\)/);
    expect(preload).not.toMatch(/hv:get-layout|hv:set-layout/);
    expect(ipc).not.toMatch(/hv:get-layout|hv:set-layout/);
    expect(app).toMatch(/window\.hv\.boot\.record\.tabsByWs/);
    expect(app).toMatch(/window\.hv\.setWindowTabs\(/);
  });
});
```

- [x] **Step 2: Run — FAIL.**

- [x] **Step 3: `uiStore.ts`**

```ts
// src/renderer/src/uiStore.ts
/**
 * §7 round 23 — per-window chrome (active workspace, sidebar collapse, drawer,
 * settings group…) used to live in localStorage, which every renderer of one
 * origin SHARES: a second window silently mirrored the first one's chrome.
 * It now lives in this window's record, seeded synchronously at preload time
 * so useState initialisers can read it exactly as they read localStorage.
 */
const ui: Record<string, string> = { ...window.hv.boot.record.ui };

export function uiGet(key: string): string | null {
  return key in ui ? ui[key]! : null;
}

export function uiSet(key: string, value: string | null): void {
  if (value === null) delete ui[key];
  else ui[key] = value;
  void window.hv.setWindowUi({ ...ui }).catch(() => {});
}
```

- [x] **Step 4: Preload + types**

`src/preload/index.ts` inside `exposeInMainWorld("hv", {`: add `boot: ipcRenderer.sendSync("hv:window-boot"),` and replace lines 360-361 with
```ts
  setWindowTabs: (t: Record<string, unknown>) => ipcRenderer.invoke("hv:set-window-tabs", t),
  setWindowUi: (ui: Record<string, string>) => ipcRenderer.invoke("hv:set-window-ui", ui),
```
`hv.d.ts`: mirror them (`boot: { windowId: number; record: { tabsByWs: unknown; ui: Record<string, string> } }`).

- [x] **Step 5: Main — boot and record writes**

In `ipc.ts`, replace the `hv:get-layout`/`hv:set-layout` handlers with:
```ts
  // Round 23: a window's record, handed over synchronously at preload so the
  // renderer's useState initialisers read it the way they read localStorage.
  ipcMain.on("hv:window-boot", (e) => {
    const w = windows.bySender(e.sender);
    const record = (w && (windows.record(w.id) as WindowRecord | undefined)) ?? { tabsByWs: {}, ui: {} };
    e.returnValue = { windowId: w?.id ?? -1, record };
  });
  ipcMain.handle("hv:set-window-tabs", (e, tabsByWs: Record<string, unknown>) => {
    const w = windows.bySender(e.sender); if (!w) return;
    const rec = windows.record(w.id) as WindowRecord;
    windows.setRecord(w.id, { ...rec, tabsByWs: tabsByWs ?? {} });
    persistLayout();
  });
  ipcMain.handle("hv:set-window-ui", (e, ui: Record<string, string>) => {
    const w = windows.bySender(e.sender); if (!w) return;
    const rec = windows.record(w.id) as WindowRecord;
    windows.setRecord(w.id, { ...rec, ui: ui ?? {} });
    persistLayout();
  });
```
with, near the top of `registerIpc`:
```ts
  let persistTimer: NodeJS.Timeout | null = null;
  const persistLayout = (): void => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => setLayoutFile(windows.records() as WindowRecord[]), 300);
  };
```
In `index.ts` `openWindow`: after `windows.add(win, record)` add
```ts
  const stamp = (): void => {
    const rec = windows.record(win.id) as WindowRecord | undefined
    if (rec) windows.setRecord(win.id, { ...rec, bounds: win.getBounds() })
  }
  win.on('resize', stamp); win.on('move', stamp)
  if ((record as WindowRecord).bounds) win.setBounds((record as WindowRecord).bounds!)
```
and in `registerIpc` bind `windows.setOnClosed(() => persistLayout())` for now (Task 8 widens that hook to kill the closed window's terminals and panes). Persisting `bounds` from `resize`/`move` needs the same debounced writer — export `persistLayout` from ipc.ts or move it into index.ts and import it in ipc.ts; pick index.ts (`export function persistLayout()`), since index.ts owns both the registry and the file.

In `whenReady`: replace `openWindow({})` with
```ts
  const records = parseLayoutFile(getLayoutFile())
  if (records.length === 0) openWindow({ tabsByWs: {}, ui: {} })
  else for (const r of records) openWindow(r)
```
`registerIpc(windows)` must still run BEFORE the renderers ask for boot — `whenReady` is synchronous up to `loadURL`, and `sendSync` from preload arrives after the first `await`, so the order `open…; registerIpc(windows)` is safe. Keep it that way and add a comment saying so.

- [x] **Step 6: Renderer — boot and writer**

`App.tsx:703-745`: drop `window.hv.getLayout()` from the `Promise.all`, use `const raw = window.hv.boot.record.tabsByWs;`. Replace `localStorage.getItem("hv:active-ws")` at `:729` with `uiGet("hv:active-ws")`. `:1658`: `window.hv.setLayout(…)` → `window.hv.setWindowTabs(…)`.

`App.tsx:231-311`: every `localStorage.getItem("hv:…")` → `uiGet("hv:…")`, every `localStorage.setItem("hv:…", v)` → `uiSet("hv:…", v)`, for exactly: `hv:active-ws`, `hv:drawer-panel`, `hv:drawer-width:files`, `hv:drawer-width:changes`, `hv:sidebar-collapsed`, `hv:settings-open`, `hv:settings-groups`. `Sidebar.tsx:643-662`: `hv:ws-collapsed`, `hv:sidebar-split`. Import `{ uiGet, uiSet } from "../uiStore"` / `"./uiStore"`. Leave every other `localStorage` use alone (dismissals, red-zone, sysprompt cache are app-level and should stay shared).

- [x] **Step 7: Gate; then GUI**

Dev-server restart. Observable: (1) the app restores exactly the tabs it had before this task — the legacy record migrated; `config.json` now reads `"layout": {"windows": [ { "bounds": …, "tabsByWs": …, "ui": {…} } ]}`. (2) Resize and move the window, quit, relaunch: it comes back at the same place and size — bounds were never persisted before. (3) Collapse the sidebar, ⌘R: still collapsed (the record round-trips through main).

- [x] **Step 8: Commit** `feat(windows): each renderer boots from its own record; chrome state leaves localStorage — stage 2`

---

### Task 5: Window ▸ New Window (⌘⇧N) opens an empty peer, sidebar collapsed

**Files:**
- Modify: `src/main/index.ts:104-135` (menu template)
- Test: extend `tests/window-single-owner.test.ts`

- [x] **Step 1: Failing scan**

```ts
  it("Window ▸ New Window exists with ⌘⇧N and opens a collapsed-sidebar peer on the focused window's workspace", () => {
    expect(index).toMatch(/label: 'New Window'/);
    expect(index).toMatch(/accelerator: 'CmdOrCtrl\+Shift\+N'/);
    expect(index).toMatch(/"hv:sidebar-collapsed": "1"/);
  });
```

- [x] **Step 2: Implement.** In the `Window` submenu, first entry:

```ts
            {
              label: 'New Window',
              accelerator: 'CmdOrCtrl+Shift+N',
              click: () => {
                // Opened to hold a tab, not to browse: sidebar starts collapsed.
                // Same workspace as the window you pressed it in.
                const from = BrowserWindow.getFocusedWindow()
                const ui = from ? (windows.record(from.id) as WindowRecord | undefined)?.ui : undefined
                openWindow({ tabsByWs: {}, ui: { ...(ui?.['hv:active-ws'] ? { 'hv:active-ws': ui['hv:active-ws'] } : {}), 'hv:sidebar-collapsed': '1' } })
              },
            },
            { type: 'separator' },
```
The menu is macOS-only today (`if (process.platform === 'darwin')`); that is pre-existing and stays.

- [x] **Step 3: Gate; GUI:** ⌘⇧N → a second window appears, sidebar collapsed to the icon rail, on the same workspace, centre area empty. Quit with both open, relaunch: two windows come back. Close the second, relaunch: one.

- [x] **Step 4: Commit** `feat(windows): Window ▸ New Window opens an empty peer — stage 2`

---

### Task 6: "Move to new window", and the tab arrives — with a dirty draft travelling

**Files:**
- Modify: `src/renderer/src/components/TabStrip.tsx:273-300` (menu), props
- Modify: `src/renderer/src/components/FileTab.tsx:54, 112-117, 118-132`
- Modify: `src/renderer/src/App.tsx` (`hv:tab-arrive` listener, `moveTabToWindow`, draft ref, FileTab props at `:2960-2977`)
- Modify: `src/main/ipc.ts` (`hv:move-tab`), `src/preload/index.ts`, `hv.d.ts`
- Test: extend `tests/window-single-owner.test.ts`; `tests/tabs.test.ts` (pure detach)

**Interfaces:**
- Renderer → main: `moveTab(req: { tab: string; ws: string; draft?: string; record?: unknown; target: "new" | number; at?: {x:number;y:number} }): Promise<boolean>`. For `"new"`, `record` is the destination `WindowRecord` the SOURCE renderer built (`{tabsByWs: {[ws]: openX(emptyTabs, …)}, ui: {"hv:active-ws": ws, "hv:sidebar-collapsed": "1"}}`); main stays ignorant of tabs. For a window id, main pushes `hv:tab-arrive {tab, ws, draft}` to that window only (targeted send: `windows.byId(id)?.webContents.send(...)`) and returns true; false if the window is gone.
- FileTab: `onDirtyChange: (dirty: boolean, content: string) => void`, `takeDraft?: () => string | undefined`.
- App: `draftsRef = useRef<Record<string, string>>({})` (dirty content by `bufferKey`), `arrivedDrafts = useRef<Record<string, string>>({})`.
- **Detach is the PURE `closeTab` from tabs.ts**, never App's `closeTerminalTab`/`closeBrowserTab` wrappers: those kill the PTY / destroy the pane, and a moved tab's subject must survive the move.

- [x] **Step 1: Failing scan**

```ts
describe("a tab lives in exactly one window (round 23)", () => {
  const tabstrip = readFileSync("src/renderer/src/components/TabStrip.tsx", "utf8");
  const filetab = readFileSync("src/renderer/src/components/FileTab.tsx", "utf8");
  it("the tab menu offers Move to new window", () => {
    expect(tabstrip).toMatch(/Move to new window/);
  });
  it("a dirty draft is reported with the dirty flag, and an arriving tab can take one", () => {
    expect(filetab).toMatch(/onDirtyChange: \(dirty: boolean, content: string\) => void/);
    expect(filetab).toMatch(/takeDraft\?: \(\) => string \| undefined/);
  });
  it("detaching uses the pure closeTab, so a moved terminal keeps its PTY and a moved browser its pane", () => {
    const detach = app.slice(app.indexOf("const detachTab"), app.indexOf("const detachTab") + 600);
    expect(detach).toMatch(/closeTab\(/);
    expect(detach).not.toMatch(/closeTerminalTab|closeBrowserTab|termKill|browserDestroy/);
  });
});
```

- [x] **Step 2: FileTab.** `:54` type as above. `:113-117`:
```ts
  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyChange(dirty, content);
  }, [dirty, content, onDirtyChange]);
```
(`content` is state, so App gets the current text on every change; App stores it in a REF — no re-render.) In `load()` after `setContent(r.content);`:
```ts
          // Round 23: a tab that arrived from another window brings its unsaved
          // text with it — still dirty against the on-disk copy just loaded.
          const draft = takeDraft?.();
          if (draft !== undefined) setContent(draft);
```

- [x] **Step 3: App.** Near `dirtyMap` (`:390`):
```ts
  /** Round 23: the unsaved text per open file, so a cross-window move can carry it. Ref: never re-renders. */
  const draftsRef = useRef<Record<string, string>>({});
  const arrivedDrafts = useRef<Record<string, string>>({});
```
FileTab props (`:2977`): `onDirtyChange={(d, text) => { setDirtyFlag(bufferKey(w, f), d); if (d) draftsRef.current[bufferKey(w, f)] = text; else delete draftsRef.current[bufferKey(w, f)]; }}` and `takeDraft={() => { const k = bufferKey(w, f); const d = arrivedDrafts.current[k]; delete arrivedDrafts.current[k]; return d; }}`. (`setDirtyFlag` is whatever `:2977` calls today — keep it.)

Detach + move:
```ts
  /** Round 23: remove a tab from THIS window's layout with no side effect on its subject. */
  const detachTab = (ws: string, tab: TabId): void =>
    setTabsByWs((p) => {
      const t = p[ws]; if (!t) return p;
      const slot = paneOf(t, tab);
      return slot < 0 ? p : { ...p, [ws]: closeTab(t, slot, tab) };
    });

  const openInto = (t: WorkspaceTabs, tab: TabId): WorkspaceTabs => {
    const sid = sessionOf(tab), tid = terminalOf(tab), bid = browserOf(tab);
    if (sid) return openChat(t, sid);
    if (tid) return openTerminal(t, tid);
    if (bid) return openBrowserTab(t, bid);
    return openFile(t, tab);
  };

  const moveTabToWindow = async (ws: string, tab: TabId, target: "new" | number, at?: { x: number; y: number }): Promise<void> => {
    const draft = isChatTab(tab) || isTermTab(tab) || isBrowserTab(tab) ? undefined : draftsRef.current[bufferKey(ws, tab)];
    const record = target === "new"
      ? { tabsByWs: { [ws]: openInto(emptyTabs, tab) }, ui: { "hv:active-ws": ws, "hv:sidebar-collapsed": "1" } }
      : undefined;
    const ok = await window.hv.moveTab({ tab, ws, draft, record, target, at }).catch(() => false);
    if (ok) detachTab(ws, tab);
  };
```
Arrive listener beside `onBrowserClosed` (`:344`):
```ts
    const offArrive = window.hv.onTabArrive(({ tab, ws, draft }) => {
      if (draft !== undefined) arrivedDrafts.current[bufferKey(ws, tab)] = draft;
      setTabsByWs((p) => ({ ...p, [ws]: openInto(p[ws] ?? emptyTabs, tab) }));
      setActiveWs(ws);
      const sid = sessionOf(tab); if (sid) setSelectedId(sid);
    });
```
(and its `off` in the cleanup). Browser tabs are accepted here already; they do not RENDER correctly in a second window until Task 10, so `TabStrip`'s menu item is disabled for `:browser:` tabs until then — pass `canMove={!isBrowserTab(id)}` and remove that gate in Task 10.

TabStrip menu (`:290-300`): add an entry after Rename:
```tsx
              <button type="button" disabled={!canMoveToWindow(menu.tab)} onMouseDown={(e) => { e.preventDefault(); onMoveToWindow(menu.tab); setMenu(null); }} …>Move to new window</button>
```
New props: `onMoveToWindow: (tab: TabId) => void; canMoveToWindow: (tab: TabId) => boolean`. (`onMouseDown` + `preventDefault`, the `tests/tabstrip-menu.test.ts` rule.) App: `onMoveToWindow={(tab) => void moveTabToWindow(wsId, tab, "new")}`.

- [x] **Step 4: Main.**
```ts
  ipcMain.handle("hv:move-tab", (e, req: { tab: string; ws: string; draft?: string; record?: unknown; target: "new" | number; at?: { x: number; y: number } }) => {
    if (req.target === "new") {
      const rec = req.record as WindowRecord | undefined;
      if (!rec) return false;
      const w = openWindow(rec, req.at);
      if (req.draft !== undefined) pendingDrafts.set(w.id, { tab: req.tab, ws: req.ws, draft: req.draft });
      return true;
    }
    const w = windows.byId(req.target);
    if (!w || w.webContents.id === e.sender.id) return false;
    w.webContents.send("hv:tab-arrive", { tab: req.tab, ws: req.ws, draft: req.draft });
    return true;
  });
```
A NEW window has no listener yet when it is created, so its draft rides the boot: `pendingDrafts = new Map<number, {tab, ws, draft}>()`; `hv:window-boot` returns `{ windowId, record, draft: pendingDrafts.get(id) }` and deletes it; `uiStore`-adjacent in App boot: `if (window.hv.boot.draft) arrivedDrafts.current[bufferKey(draft.ws, draft.tab)] = draft.draft`. Preload: `moveTab: (r) => ipcRenderer.invoke("hv:move-tab", r)`, `onTabArrive: (h) => { const l = (_e, p) => h(p); ipcRenderer.on("hv:tab-arrive", l); return () => ipcRenderer.off("hv:tab-arrive", l); }`.

- [x] **Step 5: Gate; GUI.** (a) Open `README.md`, type a line, do NOT save, right-click → Move to new window: the new window shows the file with your line and the unsaved dot; the source window no longer has the tab; Save in the new window writes it. (b) Move a terminal running `sleep 60`: the new window's terminal shows the same scrollback and `sleep` is still running (`pgrep sleep`). (c) Move a chat mid-stream: the new window's chat continues streaming; the source window's sidebar still shows the session busy. (d) The menu item is greyed for a browser tab.

- [x] **Step 6: Commit** `feat(windows): Move to new window — the tab leaves here and arrives there, unsaved text included — stage 2`

---

### Task 7: prompts appear in the holding window; badge and pending counts sum across windows

**Files:**
- Create: `src/main/promptRouting.ts`; Test: `tests/prompt-routing.test.ts`
- Modify: `src/main/ipc.ts:1391-1400, 1497, 1518, 1605, 2162, 2184` (the relayed `hv:ui-request` sends), `:3265-3282` (respond handlers), `:3814` (badge)
- Modify: `src/renderer/src/App.tsx:863-870` (enqueue filter), `:2166` (badge), `:1649-1661` (holdings alongside the layout writer), `:2429` (sidebar pending)
- Modify: `src/preload/index.ts`, `hv.d.ts`

**Interfaces:**
- `promptWindowFor(sessionId: string | undefined, holderOf: (sid: string) => number | null, focusedId: number | null, primaryId: number | null): number | null`.
- Renderer → main: `windowHolds({sessions, terminals, browsers})` on every `tabsByWs` change (all workspaces of this window: `Object.values(tabsByWs).flatMap(allChats)` etc.).
- Main → renderer: `hv:ui-request` payload gains `promptWindowId?: number`; `hv:ui-resolved {id}` broadcast; `hv:pending-changed Record<sessionId, number>` broadcast.
- Badge: `hv:set-badge-count` keeps a `Map<windowId, number>`; `app.setBadgeCount(sum)`.

- [x] **Step 1: Failing test**

```ts
// tests/prompt-routing.test.ts
import { describe, expect, it } from "vitest";
import { promptWindowFor } from "../src/main/promptRouting";

describe("promptWindowFor", () => {
  const holder = (m: Record<string, number>) => (sid: string): number | null => m[sid] ?? null;
  it("the window holding the session's chat tab", () => {
    expect(promptWindowFor("s1", holder({ s1: 2 }), 1, 1)).toBe(2);
  });
  it("no holder → the focused window", () => {
    expect(promptWindowFor("s1", holder({}), 3, 1)).toBe(3);
  });
  it("no holder, no focus → primary; no session (utility) → primary", () => {
    expect(promptWindowFor("s1", holder({}), null, 1)).toBe(1);
    expect(promptWindowFor(undefined, holder({ s1: 2 }), 3, 1)).toBe(1);
  });
  it("nothing at all → null (caller broadcasts unstamped)", () => {
    expect(promptWindowFor("s1", holder({}), null, null)).toBeNull();
  });
});
```

- [x] **Step 2: Implement**

```ts
// src/main/promptRouting.ts
/** §7 round 23 — a blocking prompt is shown in ONE window: the one holding the
 *  session's chat tab; else the focused one; else the primary. Pure. */
export function promptWindowFor(
  sessionId: string | undefined,
  holderOf: (sid: string) => number | null,
  focusedId: number | null,
  primaryId: number | null,
): number | null {
  if (sessionId === undefined) return primaryId;
  return holderOf(sessionId) ?? focusedId ?? primaryId;
}
```
In `ipc.ts`, one helper: 
```ts
  const stampPrompt = <T extends { sessionId?: string }>(r: T): T & { promptWindowId?: number } => {
    const id = promptWindowFor(r.sessionId === UTILITY ? undefined : r.sessionId, (s) => windows.holderOf(s),
      BrowserWindow.getFocusedWindow()?.id ?? null, windows.primary()?.id ?? null);
    return id === null ? r : { ...r, promptWindowId: id };
  };
```
and every `send("hv:ui-request", { ...r, … })` becomes `send("hv:ui-request", stampPrompt({ ...r, … }))`. Both respond handlers add `send("hv:ui-resolved", { id });` after `uiOwners.delete(id)`, and both `uiOwners.set(...)` sites and both deletes call `pendingChanged()`:
```ts
  const pendingChanged = (): void => {
    const counts: Record<string, number> = {};
    for (const sid of uiOwners.values()) if (sid !== UTILITY) counts[sid] = (counts[sid] ?? 0) + 1;
    send("hv:pending-changed", counts);
  };
```
Holdings: `ipcMain.on("hv:window-holds", (e, h: Holdings) => { const w = windows.bySender(e.sender); if (w) windows.setHolds(w.id, h); });`. Badge: `const badgeByWindow = new Map<number, number>(); ipcMain.on("hv:set-badge-count", (e, n) => { const w = windows.bySender(e.sender); if (w) badgeByWindow.set(w.id, Number.isInteger(n) && n > 0 ? n : 0); let sum = 0; for (const id of windows.all().map((x) => x.id)) sum += badgeByWindow.get(id) ?? 0; app.setBadgeCount(sum); });`.

- [x] **Step 3: Renderer.** `:863`:
```ts
    const offUiRequest = window.hv.onUiRequest((r) => {
      // Round 23: a blocking prompt is shown in ONE window, named by main.
      const mine = r.promptWindowId === undefined || r.promptWindowId === window.hv.boot.windowId;
      const info = parsePermission(r);
      if (info && mine) setUiQueue((q) => [...q, { kind: "permission", req: r, info }]);
      const ask = parseAskUser(r);
      if (ask && mine) setUiQueue((q) => [...q, { kind: "askUser", req: r, ask }]);
```
(everything else in the handler — dangerous, plan, inventories — stays unconditional: that is state every window needs). Add `window.hv.onUiResolved(({ id }) => setUiQueue((q) => q.filter((p) => p.req.id !== id)))`. Holdings, inside the `:1649` layout-writer effect (same trigger, no debounce): `window.hv.windowHolds({ sessions: Object.values(tabsByWs).flatMap(allChats), terminals: Object.values(tabsByWs).flatMap(allTerminals), browsers: Object.values(tabsByWs).flatMap((t) => liveSlots(t).flatMap((s) => t.panes[s]!.tabs.map(browserOf).filter((b): b is string => b !== null))) })`. Sidebar pending (`:2429`): `pending={pendingBySession}` where `const [pendingBySession, setPendingBySession] = useState<Record<string, number>>({})` fed by `window.hv.onPendingChanged`. Keep `pendingCounts` exported (its test), but App no longer calls it — delete the import if unused.

- [x] **Step 4: Gate; GUI.** Two windows, a chat in each. Ask the window-2 session to run a shell command: the permission modal appears **inside window 2's chat pane only**; window 1 shows the session with a pending badge in its sidebar and the dock badge is 1; approving in window 2 clears both. Then move the window-2 chat to window 1 while idle, ask again: the prompt appears in window 1. Then close every chat tab of a session (both windows) and prompt it from the sidebar's session row: the modal appears in the FOCUSED window, viewport-centred (paneDialog's fallback).

- [x] **Step 5: Commit** `feat(windows): prompts route to the holding window; badge and pending counts sum in main — stage 2`

---

### Task 8: closing a window closes its tabs; every window open at quit comes back

**Files:**
- Modify: `src/main/index.ts` (registry `onClosed`), `src/main/ipc.ts` (expose kill hooks to index or handle `onClosed` inside registerIpc)
- Test: extend `tests/window-single-owner.test.ts`

**Interfaces:**
- Registry `onClosed(id, record, holds)`: for each `holds.terminals` not agent-claimed (`agentTerminals` has the claims — use its existing "is claimed" query; if none exists, add `isClaimed(id): boolean`), `terminals.kill(id)`; for each `holds.browsers`, `browsers.destroy(id)`. Sessions: nothing (they keep running). Then `persistLayout()` — the record is already gone from `windows.records()`.
- The hook is Task 1's `setOnClosed`, already bound in Task 4 to `persistLayout()`; this task widens that one callback body in `registerIpc`, where `terminals`/`browsers`/`agentTerminals` are in scope.

- [x] **Step 1: Failing scan**
```ts
  it("closing a window kills its unclaimed terminals and destroys its browser panes, and forgets its record", () => {
    expect(ipc).toMatch(/windows\.setOnClosed\(\(_id, _record, holds\) => \{/);
    expect(ipc).toMatch(/for \(const t of holds\.terminals\) if \(!agentTerminals\.isClaimed\(t\)\) terminals\.kill\(t\)/);
    expect(ipc).toMatch(/for \(const b of holds\.browsers\) browsers\.destroy\(b\)/);
  });
```
- [x] **Step 2: Implement** per the interface. Check `terminals.ts` for the kill method's real name (`kill`/`close`/`dispose`) and `agentTerminals.ts` for a claim query BEFORE writing the regex; adjust the scan to the real names, never the code to the regex.
- [x] **Step 3: Gate; GUI.** Window 2 holds a terminal (`sleep 600`), a chat and a browser-less file. Close window 2 (⌘⇧W): `pgrep -f "sleep 600"` is empty within a second; the chat session is still listed in window 1's sidebar and still busy if it was; `config.json` `layout.windows` has one record. Quit and relaunch with two windows open: both return, each with its tabs. Absence: no ghost tab for the closed window's terminal appears anywhere on relaunch.
- [x] **Step 4: Commit** `feat(windows): closing a window closes its tabs, ⌘W-style; all windows restore at launch — stage 2`

---

## Stage 3 — browser panes move

### Task 9: `BrowserManager` resolves the owning window per pane and re-parents on bounds

**Files:**
- Modify: `src/main/browsers.ts:70-84, 122-124, 455-464, 485-495`
- Modify: `src/main/ipc.ts:548, 3466-3472`
- Modify: `src/renderer/src/App.tsx` (drop the `:browser:` gate from Task 6), `TabStrip.tsx` (`canMoveToWindow` always true)
- Test: extend `tests/window-single-owner.test.ts`; `tests/browser-*.test.ts` stay green (they are pure)

**Interfaces:**
- `constructor(onState, onRequest)` — no window.
- `create(workspaceId: string, win: BrowserWindow): BrowserInfo` — attaches to `win`.
- `setBounds(id, bounds, win: BrowserWindow): void` — if `entry.win !== win`: `entry.win.contentView.removeChildView(view)`, `win.contentView.addChildView(view)`, `entry.win = win`; then `view.setBounds`.
- `destroy(id)` uses `entry.win`.
- The egress hook is untouched: still `installEgress()` once per partition, `byWebContentsId` unchanged.

- [x] **Step 1: Failing scan**
```ts
describe("a browser pane belongs to the window that reports its bounds (round 23)", () => {
  const browsers = readFileSync("src/main/browsers.ts", "utf8");
  it("no window is captured by the manager", () => {
    expect(browsers).not.toMatch(/private readonly win: BrowserWindow/);
    expect(browsers).toMatch(/setBounds\(id: string, bounds: Rectangle, win: BrowserWindow\)/);
    expect(browsers).toMatch(/entry\.win\.contentView\.removeChildView\(entry\.view\);\s*win\.contentView\.addChildView\(entry\.view\)/);
  });
  it("the egress hook is still installed once per partition", () => {
    expect(browsers).toMatch(/private egressInstalled = false/);
    expect((browsers.match(/onBeforeRequest\(/g) ?? []).length).toBe(1);
  });
  it("ipc hands the sender's window to create and to bounds", () => {
    expect(ipc).toMatch(/browsers\.create\(workspaceId, ownerOf\(e\)!\)/);
    expect(ipc).toMatch(/browsers\.setBounds\(id, \{[\s\S]{0,200}\}, ownerOf\(e\)!\)/);
  });
});
```
- [x] **Step 2: Implement.** `Entry` gains `win: BrowserWindow`. `create` sets `entry.win = win` and `win.contentView.addChildView(view)`. `setBounds` re-parents as above. `destroy`: `entry.win.contentView.removeChildView(entry.view)`. ipc `:3466`: `(e, workspaceId) => browsers.create(workspaceId, ownerOf(e)!)`; `:3467-3472`: pass `ownerOf(e)!` as the third argument. `:548`: drop the window argument. Renderer: remove the `isBrowserTab` gate on `canMoveToWindow`.
- [x] **Step 3: Gate; GUI.** Open a browser tab on `https://example.org`, Move to new window: the page appears in the new window at the pane's rectangle, the source window shows no browser tab and no stray white rectangle. Navigate in the new window to a host not yet allowed: the "Allow …" gate still fires (egress is still armed after the re-parent — this is the trap the `once per partition` note exists for). Open a SECOND browser in window 1: both gates still fire. Resize window 2: the page follows. Absence: `hv:browser-closed` is NOT emitted by the move (the pane survives).
- [x] **Step 4: Commit** `feat(browser): a pane re-parents to whichever window reports its bounds; egress stays per partition — stage 3`

---

## Stage 4 — drag between windows, and tear-off

### Task 10: a tab dropped on another window's strip moves there

**Files:**
- Modify: `src/renderer/src/components/TabStrip.tsx:24, 113-119, 175-176`
- Modify: `src/renderer/src/App.tsx` (`hv:tab-left` listener; `claimTab`)
- Modify: `src/main/ipc.ts` (`hv:claim-tab`), preload, `hv.d.ts`
- Test: extend `tests/window-single-owner.test.ts`

**Interfaces:**
- Drag payload, second MIME `application/x-hv-tab+json`: `{ tab, ws, windowId, draft? }` (set at `dragstart` from `onDragPayload(tab): {ws, draft?}`, a new TabStrip prop App fills from `wsId` + `draftsRef`).
- Drop: if `payload.windowId === window.hv.boot.windowId` → existing `onMoveTab` (same window). Else `window.hv.claimTab({ ...payload, pane: paneIndex })` → main pushes `hv:tab-left {tab, ws}` to `windows.byId(payload.windowId)` and returns true; target then opens locally via `openInto` into `pane` (Task 6's `openInto`, made pane-aware with `moveTab` after `openInto`), `arrivedDrafts` set if a draft came.
- Source on `hv:tab-left`: `detachTab(ws, tab)`.
- HTML5 DnD crosses Electron windows of one app on macOS; `getData` works on drop. Verify in the GUI step before relying on it — if the `dataTransfer` arrives empty cross-window, fall back to stashing the payload in main at `dragstart` (`hv:drag-begin`) and reading it back on drop; note which route shipped in the commit body.

- [x] **Step 1: Failing scan**
```ts
  it("the strip carries a JSON payload for cross-window drops and claims a foreign tab through main", () => {
    expect(tabstrip).toMatch(/const DRAG_JSON = "application\/x-hv-tab\+json"/);
    expect(tabstrip).toMatch(/windowId: window\.hv\.boot\.windowId/);
    expect(app).toMatch(/window\.hv\.claimTab\(/);
    expect(app).toMatch(/window\.hv\.onTabLeft\(/);
  });
```
- [x] **Step 2: Implement** per the interfaces. `onDrop`: parse `DRAG_JSON` first; fall back to `DRAG_MIME` for the same-window path so `tests/tabstrip-menu.test.ts` and the existing behaviour are untouched.
- [x] **Step 3: Gate; GUI.** Drag a file tab from window 1's strip onto window 2's strip: it lands in the pane you dropped on, disappears from window 1, keeps an unsaved draft. Drag a chat the other way. Regression sequence: drag a tab within ONE window between two panes — still works (the old path). Drag and press Escape over the source window — nothing moves.
- [x] **Step 4: Commit** `feat(windows): drag a tab onto another window's strip — stage 4`

---

### Task 11: tear-off — a drop that lands on nothing opens a window there

**Files:**
- Create: `src/main/tearOff.ts`; Test: `tests/tear-off.test.ts`
- Modify: `TabStrip.tsx` (`onDragEnd`), `App.tsx` (`tearOff`), `ipc.ts` (`hv:tear-off`), preload, `hv.d.ts`

**Interfaces:**
- `insideAny(pt: {x:number;y:number}, rects: Bounds[]): boolean` (inclusive left/top, exclusive right/bottom).
- Renderer: `onDragEnd={(e) => { if (e.dataTransfer.dropEffect === "none") onTearOff(id, { x: e.screenX, y: e.screenY }); }}` → App `moveTabToWindow(ws, tab, "new", at)` BUT through `hv:tear-off` so main can refuse: `tearOff(req: same as moveTab + at)` → main: `if (insideAny(req.at, windows.all().map((w) => w.getBounds()))) return false;` (a cancelled drag, or a drop that missed a strip inside a window) else `openWindow(record, at)` (+ pending draft, Task 6's map) and `return true`; the source detaches only on true.
- `e.screenX/Y` are CSS pixels in the renderer's screen space; `getBounds()` is DIP — the same unit on macOS. Verify on a Retina display in the GUI step.

- [x] **Step 1: Failing test**
```ts
// tests/tear-off.test.ts
import { describe, expect, it } from "vitest";
import { insideAny } from "../src/main/tearOff";
const r = { x: 100, y: 100, width: 200, height: 100 };
describe("insideAny", () => {
  it("inside one rect", () => { expect(insideAny({ x: 150, y: 150 }, [r])).toBe(true); });
  it("edges: left/top inclusive, right/bottom exclusive", () => {
    expect(insideAny({ x: 100, y: 100 }, [r])).toBe(true);
    expect(insideAny({ x: 300, y: 150 }, [r])).toBe(false);
    expect(insideAny({ x: 150, y: 200 }, [r])).toBe(false);
  });
  it("outside every rect, and no rects at all", () => {
    expect(insideAny({ x: 50, y: 50 }, [r, { x: 400, y: 400, width: 10, height: 10 }])).toBe(false);
    expect(insideAny({ x: 0, y: 0 }, [])).toBe(false);
  });
});
```
- [x] **Step 2: Implement**
```ts
// src/main/tearOff.ts
/** §7 round 23 — a drag that ended outside every window is a tear-off. Pure. */
export interface Rect { x: number; y: number; width: number; height: number }
export const insideAny = (pt: { x: number; y: number }, rects: Rect[]): boolean =>
  rects.some((r) => pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + r.height);
```
plus the handler and the strip wiring per the interfaces.
- [x] **Step 3: Gate; GUI.** Drag a tab out onto the desktop and release: a new window appears with its top-left at the pointer, holding that tab, sidebar collapsed; the source no longer has it. Drag and release over the source window's own chat area (not a strip): nothing happens, the tab stays. Press Escape mid-drag: nothing happens. On a Retina display the new window's corner is at the pointer, not at half/double the distance.
- [x] **Step 4: Commit** `feat(windows): tear a tab off onto the desktop — stage 4, multi-window complete`

---

## Verification

### Automated (every task)
- `npm run gate` — `build` (both typechecks) then the non-live suite. New files: `tests/window-registry.test.ts`, `tests/window-layout.test.ts`, `tests/prompt-routing.test.ts`, `tests/tear-off.test.ts`, `tests/window-single-owner.test.ts`. Existing pins that must stay green: `tests/layout-persist.test.ts`, `tests/tabs.test.ts`, `tests/tabstrip-menu.test.ts`, `tests/pane-dialog.test.ts`, `tests/browser-coverage.test.ts`, `tests/browser-egress.test.ts`, `tests/modal-layer.test.ts`.
- `npm run live:why` after each commit: **expected empty** (no Pi-facing file changes). State that in the commit body.

### GUI assertions (observable; each names its surface)

**Stage 1**
- Main window, after a dev-server restart: identical behaviour; sessions list, streaming, prompts all arrive.
- macOS: ⌘⇧W then dock click: the recreated window LISTS SESSIONS (before: blank forever).

**Stage 2**
- `config.json` (Finder/`cat`): `layout.windows` is a list; after a legacy launch it has exactly one record with the previous tabs.
- Main window: quit/relaunch restores position and size (never did before).
- ⌘⇧N: window 2 appears **sidebar collapsed**, same workspace, empty centre. Window 1's sidebar is unchanged (absence: it did not collapse too).
- Right-click a tab → **Move to new window** (window 1 strip): tab leaves window 1's strip, appears in window 2. For a dirty file: the unsaved text and the dot are in window 2; window 1's strip has no such tab.
- Moved terminal running `sleep 60`: scrollback intact in window 2, `pgrep sleep` non-empty (absence: not killed by the move).
- Moved chat mid-stream: continues streaming in window 2; window 1's sidebar row is still busy.
- Permission prompt for a window-2 session: modal **inside window 2's chat pane**; window 1 shows ONLY the sidebar pending badge; dock badge = 1 (absence: no modal in window 1). Approve in window 2: window 1's badge clears.
- Session with no chat tab anywhere, prompted from the sidebar: modal in the **focused** window, viewport-centred.
- Close window 2 holding `sleep 600` + chat: `pgrep -f "sleep 600"` empty; session still in window 1's sidebar; `layout.windows` length 1.
- Two windows open at quit → two windows at relaunch, each with its tabs, bounds and collapse state. Absence: no ghost tab from a window that was closed before quit.
- Regression sequence: open three windows, close the middle one, quit, relaunch → exactly two, the right two.

**Stage 3**
- Browser tab moved to window 2: page renders inside window 2's pane; window 1 shows no leftover white rectangle. Navigate to a new host in window 2: the **Allow** gate fires (egress survived re-parent). A second browser in window 1 also gates.
- Absence: the move emits no `hv:browser-closed` (the tab in window 2 keeps its id).

**Stage 4**
- Drag file tab window 1 → window 2 strip: lands in the dropped pane, gone from window 1, draft intact. Same-window pane drag still works.
- Drag out to the desktop: new window at the pointer with the tab, sidebar collapsed. Escape mid-drag / release over non-strip chrome: nothing moves.
- Retina: the new window's corner is at the pointer.

### Known limits (state, do not fix here)
- A pending prompt does not follow a chat tab moved mid-prompt; it stays in the queue of the window that showed it (the dock badge and sidebar counts still say pending). Re-stamping on holdings change is a follow-up if it bites.
- The Window menu (and so ⌘⇧N) is macOS-only, as the whole custom menu already is.
