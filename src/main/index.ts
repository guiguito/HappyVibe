import "dotenv/config";
import { app, shell, BrowserWindow, nativeImage, Menu, ipcMain, screen } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { loginShellPath, mergePath } from './shellPath'
import { getGitRulesSeeded, getLayoutFile, rulesFile, setGitRulesSeeded, setLayoutFile } from './config'
import { seedDefaultGitRules } from './gitRules'
import { navAction } from './navGuard'
import { parseLayoutFile, type WindowRecord } from './windowLayout'
import { insideAny } from './tearOff'
import { WindowRegistry } from './windows'
import { installCrash } from './crash'

// Force the app name so macOS shows "HappyVibe" (not "Electron") in the app menu
// AND userData resolves to .../HappyVibe — in dev the process runs inside
// Electron.app, so app.getName() would otherwise be "Electron". macOS ignores the
// first menu item's label and always uses app.getName(), so setting it here is the
// only thing that renames the bold app-menu title. Must run before getName/getPath.
app.setName('HappyVibe')

// Opt-in Chrome DevTools Protocol port for external debuggers (electron-debug MCP,
// Chrome inspector). Inert unless HV_DEBUG_PORT is set — safe to leave in.
if (process.env.HV_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.HV_DEBUG_PORT)
}

// App renamed to "HappyVibe" (was the scaffold "hv-scaffold"). Preserve existing
// data — sessions, provider keys, settings — by migrating the userData dir once,
// before anything reads it. Runs at module load (app.getPath works pre-ready).
try {
  const appData = app.getPath('appData')
  const legacy = join(appData, 'hv-scaffold')
  const current = join(appData, app.getName()) // now "HappyVibe" (package.json productName)
  if (existsSync(legacy) && !existsSync(current)) renameSync(legacy, current)
} catch {
  /* non-fatal: fall back to a fresh userData dir */
}

// §37: as early as possible, and immediately after the migration because the
// queue lives under userData. Everything from here on is covered; the imports
// above already ran, so an exception in one of those is beyond any handler.
// Deliberately not awaited — main must not wait on a network-capable module to
// start — and `installCrash` never throws, so there is no floating rejection.
void installCrash((channel, payload) => windows.broadcast(channel, payload))

/**
 * §7 round 23 — every window in the app is made here, and only here.
 *
 * `createWindow()` used to be called once and its result handed to
 * `registerIpc(win)`. Two things came of that: every renderer push went
 * through one `send()` bound to that window, and the `activate` handler below
 * could create a SECOND window that registerIpc had never seen — deaf for its
 * whole life, which is the dock-click bug this fixes on the way past.
 */
export const windows = new WindowRegistry<BrowserWindow>()

/** §37: webContents ids already reloaded after a renderer crash — one repair
    attempt each, so a view that dies on load does not loop. */
const reloadedAfterCrash = new Set<number>()

/**
 * The layout file: one record per live window, primary first. Debounced because
 * a divider drag, a window drag and a window resize all fire this per frame.
 */
let persistTimer: NodeJS.Timeout | null = null
export function persistLayout(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => setLayoutFile(windows.records() as WindowRecord[]), 300)
}

/**
 * §7 round 23 — an unsaved buffer travelling into a window that does not exist
 * yet.
 *
 * `openWindow` returns long before its renderer is alive, so pushing
 * `hv:tab-arrive` at that moment reaches nobody. The draft waits here and
 * leaves on the boot reply below, which is the first thing that renderer asks
 * for. Keyed by window id and deleted on read, so it cannot leak into a later
 * reload of the same window.
 */
const pendingDrafts = new Map<number, { tab: string; ws: string; draft: string }>()

/**
 * This window's record, handed to its renderer synchronously.
 *
 * Registered HERE, at module scope, rather than in registerIpc: preload asks
 * for it with `sendSync` at module load, so a handler that arrived later would
 * block that renderer on a message nobody answers. Main is synchronously busy
 * from window creation through registerIpc anyway, so the reply cannot be
 * served before the rest of the app is wired either way.
 */
ipcMain.on('hv:window-boot', (e) => {
  const w = windows.bySender(e.sender)
  const record = (w && (windows.record(w.id) as WindowRecord | undefined)) ?? { tabsByWs: {}, ui: {} }
  const draft = w ? pendingDrafts.get(w.id) : undefined
  if (w) pendingDrafts.delete(w.id)
  e.returnValue = { windowId: w?.id ?? -1, record, ...(draft ? { draft } : {}) }
})

/**
 * §7 round 23 — the other windows a tab can be sent to, by NAME.
 *
 * This is the route that does not depend on a drag at all — a drag is a
 * gesture not everyone can perform, and "move this tab to that window" should
 * not require one. Ordinals, because a window has no title of its own; primary
 * is Window 1.
 */
function windowList(): Array<{ id: number; label: string }> {
  // Sentence case: the menu reads "To new window" / "To window 2".
  return windows.all().map((w, i) => ({ id: w.id, label: `window ${i + 1}` }))
}

ipcMain.handle('hv:list-windows', () => windowList())

/** Every window's menu has to change when the SET of windows does. */
export function windowsChanged(): void {
  windows.broadcast('hv:windows-changed', windowList())
}

/**
 * §7 round 23 — the drag in flight, parked where BOTH windows can reach it.
 *
 * The `dataTransfer` MIME does cross windows intact, but it can only be read
 * from a DROP — and a TEAR-OFF has no drop to read it from, since it lands over
 * no window at all. The destination there does not exist yet either. So the
 * payload is left here at `dragstart` and handed to whichever window ends up
 * taking the tab. Cleared on `dragend`, so an abandoned drag leaves nothing for
 * the next one to pick up.
 */
let dragging: { tab: string; ws: string; windowId: number; draft?: string } | null = null

ipcMain.on('hv:drag-begin', (e, d: { tab: string; ws: string; draft?: string }) => {
  const w = windows.bySender(e.sender)
  if (!w) return
  dragging = { ...d, windowId: w.id }
})

ipcMain.on('hv:drag-end', () => {
  dragging = null
})

/**
 * §7 round 23 — where a tab drag was RELEASED, decided from the source window.
 *
 * This is the whole cross-window story, and it is here rather than in the
 * target's drop handler because a drop is not always what ends a drag: a
 * TEAR-OFF is released over no window at all, and no drop handler anywhere can
 * see that. `dragstart` and `dragend` fire in the SOURCE window, so this path
 * covers every ending. Main takes the release POINT and answers the whole
 * question itself, because it is the only side that knows where every window
 * is:
 *
 *   - over another window  → hand the tab to it;
 *   - over no window       → tear off a new one there;
 *   - over its own window  → nothing (a missed drop, or an Escape cancel).
 *
 * A CONSUMED drag is already null here — a same-window drop clears it — so a
 * drop between panes cannot also move or tear off. `dropEffect` is never
 * consulted: a synthetic drop leaves it "none", and trusting it once made one
 * gesture both move a tab and spawn a window holding it.
 */
ipcMain.handle('hv:drag-release', (e, _at: { x: number; y: number }, record: unknown): boolean => {
  const w = windows.bySender(e.sender)
  const d = dragging
  if (!w || !d || d.windowId !== w.id) return false

  /**
   * The POINTER, asked of the OS, not the `dragend` event's `screenX/screenY`.
   *
   * Those coordinates were never verified against a real drag — only against
   * synthetic events where the test supplied the numbers — and a wrong or zero
   * point fails in a way that LOOKS like the feature working: it lands outside
   * every window, so the tab tears off instead of moving, and a tear-off is
   * indistinguishable from "I meant to do that". `screen.getCursorScreenPoint`
   * is the OS's own answer and cannot drift from it.
   */
  const at = screen.getCursorScreenPoint()

  /**
   * Which window is under the pointer. Creation order is NOT z-order and
   * Electron exposes no way to ask, so overlapping windows tie-break to the
   * most recently created — the one you most likely just made. Accepted, and
   * cheap to revisit if it ever bites.
   */
  const under = windows.all().filter((win) => insideAny(at, [win.getBounds()]))
  const target = under.filter((win) => win.id !== w.id).at(-1) ?? null
  // Released over its own window with nothing accepting it: the tab stays.
  if (!target && under.some((win) => win.id === w.id)) return false

  if (target) {
    dragging = null
    target.webContents.send('hv:tab-arrive', { tab: d.tab, ws: d.ws, draft: d.draft })
    return true
  }

  const rec = record as WindowRecord | undefined
  if (!rec) return false
  dragging = null
  const opened = openWindow(rec, at)
  if (d.draft !== undefined) pendingDrafts.set(opened.id, { tab: d.tab, ws: d.ws, draft: d.draft })
  return true
})

/** Hand a tab to another window. Returns false when there is nobody to hand it to. */
ipcMain.handle(
  'hv:move-tab',
  (
    e,
    req: {
      tab: string
      ws: string
      draft?: string
      record?: unknown
      target: 'new' | number
      at?: { x: number; y: number }
    },
  ): boolean => {
    if (req.target === 'new') {
      const record = req.record as WindowRecord | undefined
      if (!record) return false
      const w = openWindow(record, req.at)
      if (req.draft !== undefined) pendingDrafts.set(w.id, { tab: req.tab, ws: req.ws, draft: req.draft })
      return true
    }
    const w = windows.byId(req.target)
    // Refusing a move to the sender's OWN window matters: that path is
    // `moveTab` within a layout, and doing both would duplicate the tab.
    if (!w || w.webContents.id === e.sender.id) return false
    w.webContents.send('hv:tab-arrive', { tab: req.tab, ws: req.ws, draft: req.draft })
    return true
  },
)

/** The record is opaque here — main stores it and hands it back; see windows.ts. */
export function openWindow(record: WindowRecord, at?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: record.bounds?.width ?? 900,
    height: record.bounds?.height ?? 670,
    // A torn-off window opens at the pointer, a restored one where it was.
    // Omitting both is what "centred by the platform" means, and is right for
    // a first launch and for ⌘⇧N.
    ...(at ? { x: at.x, y: at.y } : record.bounds ? { x: record.bounds.x, y: record.bounds.y } : {}),
    show: false,
    autoHideMenuBar: true,
    // macOS IGNORES the window icon — there the Dock is the surface, set below
    // via app.dock.setIcon. Windows and Linux both read this option, and in DEV
    // it is the only thing that sets the window and taskbar icon: the packaged
    // icon is written into the exe by electron-builder's `win.icon` at pack time,
    // which never runs here. Gated to linux, a Windows dev window therefore showed
    // Electron's own icon — the same gap the dock line below already closed for
    // macOS, one platform over (PRD §4, Windows round).
    ...(process.platform === 'darwin' ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  windows.add(win, record)
  // The list is broadcast on SHOW rather than here: at this point the new
  // window's own renderer does not exist yet, and it fetches the list itself.
  win.on('ready-to-show', () => {
    win.show()
    windowsChanged()
  })
  win.on('closed', () => windowsChanged())

  // Bounds ride the window's own record, so a relaunch puts it back where the
  // user left it — never persisted before round 23.
  const stamp = (): void => {
    const rec = windows.record(win.id) as WindowRecord | undefined
    if (!rec) return
    windows.setRecord(win.id, { ...rec, bounds: win.getBounds() })
    persistLayout()
  }
  win.on('resize', stamp)
  win.on('move', stamp)

  // Open links in the OS browser, not inside the app window.
  // setWindowOpenHandler covers target=_blank / window.open; will-navigate
  // covers a plain <a href> click (e.g. links in chat answers), which would
  // otherwise navigate the whole SPA away from the app.
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // The rule is deny-by-default and lives in navGuard.ts — see there for why an
  // un-prevented relative link could replace the whole app with a dead page.
  win.webContents.on('will-navigate', (event, url) => {
    const action = navAction(url, win.webContents.getURL())
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') void shell.openExternal(url)
  })

  // §37: the repair, not the report — the SDK's own `render-process-gone`
  // handler on `app` files that. Once per window, because a view that crashes
  // on load would otherwise reload forever; and never for `clean-exit`, which
  // is what a normal close looks like from here.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    if (reloadedAfterCrash.has(win.webContents.id)) return
    reloadedAfterCrash.add(win.webContents.id)
    win.webContents.reload()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.happyvibe.app')

  // Dev dock icon: packaged builds use build/icon.icns (electron-builder), but
  // in dev the dock would show the default Electron icon — set ours explicitly.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  // macOS menu-bar app name: in dev the app runs inside Electron.app, so the
  // bold app-menu title is read from that bundle ("Electron") regardless of
  // productName. Install an explicit menu whose first item is "HappyVibe";
  // keep the standard Edit/View/Window roles so shortcuts (copy/paste, quit,
  // devtools) still work.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'HappyVibe',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        // F6: free ⌘W for the renderer (close the active file tab); window close
        // moves to ⌘⇧W. Otherwise the default windowMenu's ⌘W closes the window.
        {
          label: 'Window',
          submenu: [
            // §7 round 23: a full peer, opened empty. ⌘N and ⌘T are the session
            // and terminal bindings (shortcuts.ts), so a new WINDOW gets ⌘⇧N.
            {
              label: 'New Window',
              accelerator: 'CmdOrCtrl+Shift+N',
              click: () => {
                // Same workspace as the window you pressed it in — a window you
                // open to hold a tab should not also make you re-pick a project
                // — but with the sidebar COLLAPSED, because it was opened to
                // hold a tab, not to browse.
                const from = BrowserWindow.getFocusedWindow()
                const ui = from ? (windows.record(from.id) as WindowRecord | undefined)?.ui : undefined
                const ws = ui?.['hv:active-ws']
                openWindow({
                  tabsByWs: {},
                  ui: { ...(ws ? { 'hv:active-ws': ws } : {}), 'hv:sidebar-collapsed': '1' },
                })
              },
            },
            { type: 'separator' },
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
          ],
        },
      ]),
    )
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // §7 round 23: every window that was open at quit comes back, with its own
  // tabs, workspace, chrome and bounds. No records (first launch, or a corrupt
  // file) means exactly one default window — never zero.
  const restored = parseLayoutFile(getLayoutFile())
  if (restored.length === 0) openWindow({ tabsByWs: {}, ui: {} })
  else for (const record of restored) openWindow(record)

  // A GUI-launched app inherits launchd's minimal PATH, so nvm node, uv and
  // /opt/homebrew are invisible to every child we spawn (Pi, the agent's bash
  // tool, npx stdio MCP servers) and to nodePreflight's "needs Node" probe.
  // Ask the login shell once and merge. See shellPath.ts.
  //
  // Placed AFTER createWindow and BEFORE registerIpc deliberately: the shell
  // spawn is synchronous and costs ~1.0-1.2s with a real .zshrc, so doing it at
  // module scope would delay first paint. Every consumer runs inside
  // registerIpc — sweepOrphans, the MCP startup sweep, and hasNodeRuntime
  // (which reads PATH lazily, on renderer demand) — so this still beats all of
  // them. Mutating process.env is enough: spawn.ts and every other child site
  // spread ...process.env, so nothing needs explicit PATH plumbing.
  process.env.PATH = mergePath(process.env.PATH, loginShellPath())

  // §29: write the shipped git permission rules once, as ordinary user rules.
  // After PATH for no reason of its own, but before registerIpc so the first
  // spawn already hands the bridge a rules file containing them.
  if (!getGitRulesSeeded()) {
    if (seedDefaultGitRules(rulesFile(), false)) setGitRulesSeeded(true)
  }

  registerIpc(windows, persistLayout, () => openWindow({ tabsByWs: {}, ui: {} }))

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open. Through the
    // registry, so it receives pushes — before round 23 this window was made
    // by createWindow() and never handed to registerIpc, i.e. deaf for life.
    if (windows.all().length === 0) openWindow({ tabsByWs: {}, ui: {} })
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
