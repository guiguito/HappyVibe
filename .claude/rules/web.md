---
paths:
  - "src/main/web/**"
  - "src/main/windows.ts"
  - "src/renderer/web/**"
  - "src/renderer/web.html"
  - "electron.vite.config.ts"
  - "tests/web-*.test.ts"
---
# Web mode (`HV_SERVE`)

- **A browser tab is a window.** `HV_SERVE=<port>` makes main serve the built renderer and register
  each tab as a `WebWindow` (`src/main/web/webWindow.ts`) in the SAME `WindowRegistry` as the
  BrowserWindows. Broadcasts, `bySender`, per-window records and holdings need no web branch; only code
  that needs a real BrowserWindow narrows with `instanceof WebWindow` (dialogs, the browser view,
  the feedback capture, drag geometry, tear-off). A new BrowserWindow-only call does the same.
- **The preload is compiled twice.** web.html loads `src/preload/index.ts` against
  `src/renderer/web/electron.ts` (the `webPreload` plugin in `electron.vite.config.ts`), so a tab's
  `window.hv` IS the desktop one. Never hand-write a second copy of a preload method; the shim
  overrides only what depends on where the PERSON is (`openExternal`, the microphone permission).
  It implements the four calls the preload makes (`invoke`, `send`, `on`, the boot `sendSync`);
  `tests/web-shim.test.ts` derives the list from the preload and fails when a new one appears.
- The preload's one Node global, `process.platform`, is rewritten to the SERVER's platform (paths are
  the server's). Any other `process.` in the preload is undefined in a page — the shim test pins it.
- **Handlers are reached through the tap** (`ipcTap.ts`): `handle()` registrations are recorded as
  they happen, `on()` listeners are reached with `emit`. Installed at index.ts module scope, before the
  first `ipcMain.handle`, and only when serving — a desktop run never has it, nor loads the server
  (dynamic import) or `ws`.
- One WebSocket per tab carries invoke/send/push IN ORDER (a terminal's keystrokes); never move a
  call to separate HTTP requests. An answer goes back on the socket that asked, never "the window's
  current one" (a reloaded page restarts its invoke ids). Values cross through `codec.ts`, which
  imports nothing because the shim uses it.
- **Security is the token, never a cookie.** Cookies are not scoped by port, so one would reach every
  service on the host. The token arrives in the link's fragment, lives in the page's localStorage
  (origin = host + port) and is presented as the `X-HV-Token` header (hello, sync) or the second
  WebSocket subprotocol. Requests that act must also be same-origin, and on loopback name this Host.
  `tests/web-server.test.ts` pins all of it; don't relax one to make a client work. The page and its
  assets are the public bundle and need no token.
- **A tab going away never closes its window.** It goes DORMANT (`WinLike.isDormant`): out of
  `all()` — no pushes, not a move target, not a prompt's holder — but still in `bySender` and
  `records()`, terminals and panes running. A new tab claims the most recently dormant window first.
  Only the server stopping closes a web window. A page whose socket drops RELOADS once the server
  answers (pushes in the gap are gone); a heartbeat drops half-open sockets.
- **Close codes say what the tab does next**: 4001 another tab took the window (offer it back), 4004
  the server doesn't know the window (it restarted and answers: reload at once), 4010 the server is
  stopping (WAIT for it — never reload into a server that is going). Anything else: the card that says
  why and since when, a backoff probe, then the reload. The count lives in the tab's sessionStorage
  across those reloads, so a server that answers while its socket keeps failing backs off instead of
  reloading four times a second. A kept token refused at hello means a new link (`RESTARTED`).
- web.html carries index.html's CSP unchanged (pinned). The page has no native view: the browser pane
  shows `WEB_ONLY_NOTE` and sends no bounds; "To new window" is hidden.
- It serves `out/renderer` — `npm start` or an installed app, never `npm run dev` (Vite keeps that
  renderer in memory). Serving turns the self-updater off (its relaunch would drop `HV_SERVE`).
