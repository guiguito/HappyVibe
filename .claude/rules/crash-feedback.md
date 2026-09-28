---
paths:
  - "src/main/crash/**"
  - "src/main/feedback/**"
  - "src/preload/**"
  - "src/renderer/src/{crashProbe.tsx,feedbackForm.ts}"
  - "src/renderer/src/components/{FeedbackDialog,PrivacyView,feedbackCopy}.*"
  - "scripts/{crash-probe,catalog-crash-messages}.mjs"
  - "tests/{crash,feedback,pi-crash}*.test.ts"
  - "src/main/usage/**"
  - "src/main/remoteConfig/**"
  - "src/renderer/src/{usage,usageUi,remoteConfig}.ts"
  - "tests/{usage,remote-config}*.test.ts"
---
# Crash reports (§37) and feedback (§34) — both via `inlet-sdk`

## Crash: wiring
- `src/main/crash/client.ts` is the import-free seam (`captureCrash`, `attachCrashAudit`,
  `recordCrashSent`). The five `hv:crash-*` handlers live inside `crash/index.ts`
  (`registerCrashIpc`, called before every gate so the Privacy page opens with reporting off).
  `ipc.ts` never imports `./crash` (`tests/crash-wiring.test.ts`).
- The renderer uses `inlet-sdk/crash/electron-renderer` (node-free), never `inlet-sdk/crash/electron`
  (imports `node:fs` — only `npm run build` fails). It reaches main through
  `globalThis.inletCrash.send` — the preload's `exposeInMainWorld("inletCrash", …)` is a contract.
- OFF in development unless `HV_CRASH_DEV=1`, checked FIRST — a dev launch creates no client, no
  handlers, no queue dir.

## Crash: policy — upstream defaults are the policy
- Don't re-add exit-reason filtering, and don't pass `ignoreRendererReasons`/`ignoreChildReasons`/
  `appRoots`/`redaction`. Upstream drops `clean-exit` for renderers and `clean-exit`+`killed` for
  children — a renderer reporting `killed` is an OS/OOM kill, the crash most worth hearing about.
  Overriding main's `appRoots` is how the developer's repo path starts travelling.
- `tests/crash-sdk-contract.test.ts` asserts upstream BEHAVIOUR through its `deps: { electron }` seam
  (prefer behaviour over source scans — a scan false-passed once when a literal moved into a const).
  It also captures a real `Error` through the real `CrashClient` and asserts named, root-relative
  in-app frames, with a nonsense-`appRoots` case so it can't pass vacuously. Faked Electron events:
  `render-process-gone` is `(event, webContents, details)`, `child-process-gone` is `(event, details)`.
- `defaultRedaction` is pinned in `crash-policy.test.ts`, not reimplemented.
  `redactMessage` (crash/policy.ts) EXTENDS it with an exact match against
  `SAFE_MESSAGES` — generated (`npm run catalog:crash-messages`) from plain string literals only, so an
  interpolated message stays redacted. Never `keepMessages`.
- `{ exitCode: false }` is spelled out on purpose: main exiting takes every live Pi session with it.
- A Pi child exit is reported only when `piFrames` finds a frame inside our bundle — Pi dies for user
  reasons (bad key, `402`, killed terminal) constantly, and those would all collapse onto one
  fingerprint. The stderr tail never travels: it stays in the local `session.crash` row.

## Crash: testing and reading back
- There is deliberately NO Electron end-to-end test (no key in CI, 24 h dedupe, undeletable rows, no
  harness). Judge frame quality with `scripts/crash-probe.mjs` (fires `nested`, `renderer`, `render`,
  `reject`, `crash` from real modules; exits non-zero on failure — don't pipe it) — never from a
  CDP-eval'd throw, whose frames all read `{line: 1, inApp: false}`. A `render-error` groups by the
  throwing component; a `renderer-gone` has no frames by nature.
- The SDK dedupes 24 h per fingerprint (`<userData>/inlet-crash/dedupe.json`), and a deduped report
  raises no banner. Re-test with a unique message, or delete `dedupe.json` with the app stopped.
- `hv:crash-test` acts on `event.sender`: `BrowserWindow.getFocusedWindow()` is null whenever the app
  isn't frontmost — always, under CDP.
- Read crashes back with the Inlet MCP crash tools, from the Dev project for dev builds (since
  inlet-sdk 0.5.0 there is no `environment`: dev and prod are separate projects). Over REST there's no `/reports`
  collection route: list groups, then `…/groups/<groupId>/reports`. `docs/validation/d1.md` §37.

## Feedback
- `inlet-sdk/feedback`, driven from MAIN; `src/main/feedback/client.ts` is the seam. One
  `FeedbackClient` per database, each with a `FileStore` queue under
  `<userData>/inlet-feedback/<general|session>`; the constructor starts the replay (no flush-on-quit).
  Never the SDK's Electron adapter (one database, fixed channel, pulls `node:fs` into the renderer).
- A `pending` outcome is a SUCCESS: the dialog shows the queued copy; the audit row gets
  `status:"pending"` and no submission id. Submissions and crash reports carry the SDK's rotating
  session id; `setUser` is never called.
- Only PUBLISHABLE `ipk_` keys are in `src/`, one per channel — a publishable key is refused on
  reading submissions (`tests/feedback-live.test.ts` asserts it), which is why it may be committed.
  `isk_` server keys live in `.env` only (`FEEDBACK_API_KEY`, `FEEDBACK_API_KEY_PROD`);
  `tests/feedback-secrets.test.ts` scans `src/` for both, and `resolveFeedbackConfig` refuses a
  non-`ipk_` key by shape. A null key means no icon and no pulse (`hv:feedback-info` → `available:false`).
- The 20-second pulse is `HV_FEEDBACK_FAST_PULSE=1`, never `import.meta.env.DEV` — every dev session
  would pulse, and every tap writes a REAL row.
- The live test writes to its own Smoke tests database and deletes the row; it skips on no `.env` or
  an unreachable server.

## Usage statistics and remote config (§39)

- Modules are `src/main/usage/` and `src/main/remoteConfig/` — never `src/main/analytics/`: `analytics.ts` is the local Stats aggregator and never sends.
- The §37 split twice: import-free `client.ts` facades; `index.ts` is Electron-only and `ipc.ts` never imports it (vitest's `electron` stub).
- `usage/events.ts` is the ONLY list of events. `track()` and `usageBeforeSend` refuse anything else; `HOWTO_COPY.usageStats` stays crash-report short and reads its event count from it.
- Every param is an enum, number, boolean, or a shipped id / `custom`. Never spread an EventLog row's `data` into params — `fromLog.ts` names each field.
- A skill is sent by its bundled NAME: its id is an absolute path.
- `feature_used` goes through `trackFeature` (main dedupes per session or workspace), never `trackUi` — two windows send one.
- Opt-out is `setEnabled(false, { forget: true })` only; never `setUserId`, `setUser`, `setInstallationIdEnabled(false` (source-scanned).
- `existing_user` keys on `<userData>/inlet/analytics-state.json` — config writes `installation-id.json` itself.
- Dev builds send to the Dev project's databases. inlet-sdk 0.5.0 has no `environment` option and its server REFUSES an envelope carrying one (`unknown_field`) — never add it back (`tests/usage-wiring.test.ts` scans for it). The crash half of the one-ID check needs `HV_CRASH_DEV=1`.
- `web_default_service` fails open (default `true`), is read per web call, and pausing it never removes the tools.
