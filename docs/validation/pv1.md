# PV1 — Privacy round: what leaves the machine on its own (measured 2026-10-09)

The facts the Privacy round (PRD §16, §32, §34, §37–§39, "Privacy round, 2026-10-09") rests on.
Pinned where they can drift by `tests/pi-privacy-contract.test.ts`.

## Pi 1.0.2 — calls by mode (read from `pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist`)

| Call | Where it runs | Reaches HappyVibe? |
|---|---|---|
| Version check (`checkForNewPiVersion` → `getLatestPiRelease`) | `modes/interactive/interactive-mode.js`; `pi update` (`package-manager-cli.js`) | No: HappyVibe runs RPC and print modes only |
| Install telemetry (`reportInstallTelemetry`, `https://pi.dev/api/report-install`) | `modes/interactive/interactive-mode.js` only | No |
| Model-list refresh (`https://pi.dev/api/models/providers/<id>?types=…`) | `main.js`: `if (!offlineMode && appMode === "rpc")` at every RPC start; throttled by `REMOTE_CATALOG_REFRESH_INTERVAL_MS` = 4 h (`core/remote-catalog-provider.js`) | Yes: every session, the utility client and MCP probes (all through `spawnOpts`) |
| `fd` / `rg` download from GitHub | `utils/tools-manager.js` `ensureTool`, on the first `find`/`grep` when neither `<agentDir>/bin` nor `PATH` has them | Yes, once |

- `PI_OFFLINE` stops the last two, but not by one rule: the model runtime goes offline when it is set at all
  (`core/model-runtime.js`: `process.env.PI_OFFLINE === undefined`, so `0` counts), while `ensureTool` and
  `main.js` read it as 1/true/yes. The Model list lock follows the model runtime: any value locks it. Offline with the tool missing, `grep` fails with
  *"ripgrep (rg) is not available and could not be downloaded"*. A cached catalog overlay still applies.
- One-shots (titles, commit message, PR draft) are print mode with `--no-tools`: no refresh, no tools.
  `--export` and `pi mcp` make no Pi call home.
- The built-in terminal inherits `process.env` (`src/main/terminals.ts` `resolveSpawn`), which is
  why only `HV_NO_PHONE_HOME` writes `PI_OFFLINE` there and the Model list switch sets it per spawn.

## inlet-sdk 0.5.0 remote config

`ConfigClient.close()` stops every timer and listener and clears the one-client slot
(`holder[CLIENT_SLOT] = null`); a second `init()` while a client exists warns *"init() was called
again … Call close() on it first"* and returns the old one. So off = `uninstall()` + `close()`, on = a
fresh `installElectronMain`.

## macOS environment

A Dock/Finder-launched app gets launchd's environment, not a shell's. HappyVibe imports only `PATH`
from the login shell (`src/main/index.ts`, `mergePath(…, loginShellPath())`), after `installCrash`
(module scope) and `installRemoteConfig`/`installUsage` (`whenReady`) have run. Routes that work:
`launchctl setenv` (from a LaunchAgent for persistence) and `open -a HappyVibe --env NAME=VALUE`
(`man open`: `--env VAR`).
