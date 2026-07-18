# Debugging HappyVibe

HappyVibe is an Electron app, so both its **renderer** (React UI at `localhost:5173`)
and **main** process can be inspected over the Chrome DevTools Protocol (CDP). The
port is opt-in and off by default.

## Enable the debug port

Set `HV_DEBUG_PORT` when launching dev:

```bash
HV_DEBUG_PORT=9222 npm run dev
```

This wires `app.commandLine.appendSwitch('remote-debugging-port', …)` in
`src/main/index.ts`. With no env var set, nothing changes — a plain `npm run dev`
never opens the port.

## Attach with Chrome DevTools

Open Chrome → `chrome://inspect` → **Configure…** → add `localhost:9222` → the
HappyVibe page appears under "Remote Target". Click **inspect** for a full DevTools
window (Console, Network, Elements, Sources) against the live app.

Or point DevTools straight at it: `http://localhost:9222/json` lists the targets and
their `devtoolsFrontendUrl`.

## Attach with the electron-debug MCP server

The [`electron-debug`](https://github.com/amafjarkasi/electron-mcp-server) MCP server
lets Claude Code drive and inspect the running app. It's registered in this project
(local scope) and its tools appear as `mcp__electron-debug__*` after a Claude Code
restart. Typical loop:

1. `discover_apps {startPort:9222,endPort:9222}` — confirm the port is live
2. `attach {debugPort:9222}` — returns a `processId`
3. `diagnose {processId}` — port health, targets, recent console errors
4. `get_console_messages {processId, level:"error"}` — buffered console/exceptions
5. `save_screenshot {processId, path:"…png"}` — capture the live window
6. `click` / `type_text` / `press_key` / `evaluate` — automate the renderer
7. `evaluate_main` — main-process state (requires launching with `--inspect`;
   the MCP `start_app` tool has an `inspectMain:true` option)

The server bundles its own Electron and needs `ELECTRON_MCP_NO_SANDBOX=1` on macOS
(already set in the registration).

## Notes

- CDP binds to `127.0.0.1` only — not exposed off-machine.
- The port is a dev convenience; production/packaged builds should not set
  `HV_DEBUG_PORT`.
- Pi runs as a separate subprocess (see the main README architecture section); this
  CDP port only reaches the Electron main + renderer, not the Pi child. Debug Pi via
  the JSONL EventLog and its stdio RPC instead.
