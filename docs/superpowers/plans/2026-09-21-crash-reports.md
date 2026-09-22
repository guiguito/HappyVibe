# §37 Crash reports — implementation plan (2026-09-21)

Spec: Notion "Crashreporting?" §12 (consolidated 2026-09-21). PRD: `docs/prd.md` §37 + the
§19 decision. Dependency: `inlet-sdk@0.1.2`, pinned exact, zero runtime deps.

Six interview answers folded in (2026-09-21): a crash report is **not** telemetry, so §6 is
untouched and §19 gains a decision · the page is **Privacy**, not "Crash reports", because a
usage-analytics toggle lands on it next · the dev test IPC exists but has **no buttons** · a Pi
child exit reports **only with an in-app frame** · `unclean-exit` ships in P1 · development does
**not** report unless `HV_CRASH_DEV=1`.

---

## Task 1 — dependency and configuration

Files: `package.json` · `src/main/feedback/config.ts` · `src/main/config.ts`

- `"inlet-sdk": "0.1.2"` exact, in `dependencies` (electron-builder packs it; pure JS, so no
  `asarUnpack`).
- `FEEDBACK_CHANNELS` gains `crashDatabase`: dev `cdb_aamshzzkjx9c`, prod `cdb_64m8jfkbxw2y`.
  `FeedbackConfig` gains the field, `resolveFeedbackConfig` returns it with an `HV_CRASH_DB`
  override. Same table, same `is.dev` resolution, same `ipk_` shape refusal — one place.
- `config.ts`: `crashReportsOff?: boolean` on the record, `getCrashReports()` /
  `setCrashReports(on)` copying `getOpenFilesContext` (`:496-504`) exactly — default on, the key
  is stored only when off.

Verify: `npx vitest run tests/feedback-config.test.ts` (extended in task 8).

## Task 2 — the pure policy modules

Files (new): `src/main/crash/policy.ts` · `src/main/crash/stderrFrames.ts` ·
`src/main/crash/sentinel.ts`

Electron-free, vitest-importable, no side effects.

- `policy.ts` — `TAG_ALLOW = ["runtime", "channel"]` and `scrubEnvelope(e)`, wired as
  **`beforeSendSync`** so it runs on the fatal path too. Drops `context` unconditionally; filters
  `tags` to `TAG_ALLOW`; returns `null` for a `child-exit` or `renderer-gone` whose `exit.reason`
  is `clean-exit` or `killed`. No `redactMessage` — 0.1.2's `defaultRedaction` already emits a
  bare `<redacted>` unless the leading token is errno-shaped, which is exactly the policy we would
  have written.
- `stderrFrames.ts` — `piFrames(lines)` keeps only `at fn (…<marker>/file:line:col)` where the
  marker is `pi-runtime`, `app.asar` or `out`; `file` is the suffix **after** the marker, so no
  absolute path survives; `inApp: true`; capped at 30. A line without a marker is dropped (a
  `.pi/extensions` frame is outside the bundle). `piErrorType(lines)` = the first
  `/^([A-Z][A-Za-z]*Error)\b/m`, else `"PiExit"`. The message line never leaves this function.
- `sentinel.ts` — `writeSentinel/touchSentinel/readSentinel/removeSentinel` over
  `<dir>/running.lock`; content is the start ms, `lastUptimeMs` is mtime − start (60 s touch
  granularity). Takes its directory as an argument; knows nothing about Electron.

Verify: `npx vitest run tests/crash-policy.test.ts tests/crash-stderr-frames.test.ts tests/crash-sentinel.test.ts`.

## Task 3 — the Electron wiring

Files (new): `src/main/crash/index.ts` · changed: `src/main/index.ts` ·
`electron.vite.config.ts`

- `installCrash(broadcast)` called from `src/main/index.ts` right after the userData migration
  (`:32-39`), so everything from there on is covered. It is `void`-called and **must not throw**:
  `init` throws on a non-`ipk_` key, and an unhandled rejection at that moment is the stock dialog
  the feature exists to replace.
- Reporting is refused outright — no `init`, no handlers, no `crashReporter` — when
  `is.dev && process.env.HV_CRASH_DEV !== "1"`. That is the §37 dev rule and it is the FIRST gate,
  before the setting.
- `await installElectronMain({ baseUrl, publishableKey, crashDatabaseId, channel, environment:
  dev ? "development" : "production", enabled: getCrashReports(), tags: { runtime:
  __RUNTIME_PINS__, channel }, tagAllowlist: [...TAG_ALLOW], beforeSendSync: scrubEnvelope, onSent,
  onDrop, timeoutMs: 20_000, debug: dev ? console.warn : undefined }, { exitCode: false })`.
  No `redaction`, no `fetch`, no `appRoots` — `release` defaults to `app.getVersion()` and
  `appRoots` to `app.getAppPath()`, which is what makes every frame root-relative.
- `{ exitCode: false }` stays explicit though it is now the default: main exiting takes every Pi
  session with it, and a silent upstream flip must not be able to do that.
- A second uncaught exception within 10 s → `app.exit(1)`.
- `crashReporter.start({ uploadToServer: false, submitURL: "" })` — local minidumps only.
- Sentinel only when `app.isPackaged`: read at boot → `captureReport({ kind: "unclean-exit", exit:
  { lastUptimeMs } })`; written on ready; touched every 60 s (unref'd); removed on `will-quit`
  (the repo's first `will-quit` handler).
- `onSent(sent, envelope)` → remember the last 5 envelopes for "Show the last report"; write the
  `crash.sent` audit row `{reportId, groupId, isNewGroup, kind, bytes, channel}`;
  `broadcast("hv:crash-sent", row)`. `attachCrashAudit(log)` is called from `registerIpc`, rows
  buffered until then — no import cycle with `index.ts`.
- `electron.vite.config.ts`: `__RUNTIME_PINS__` is currently defined for the **renderer only**;
  add the same `define` to `main` and declare the const in `crash/index.ts`.

Verify: `npm run typecheck` is folded into `build`; use `npx vitest run tests/crash-wiring.test.ts`.

## Task 4 — audit plumbing

Files: `src/main/analytics.ts` · `src/main/ipc.ts`

- `analytics.ts` after the `feedback.sent` case: `case "crash.sent": break;` with the same comment
  shape — the switch is an inventory of every type main writes.
- `ipc.ts` `hv:read-audit` (`:4504`): a second `log.read({ type: "crash.sent", ...scoped })`
  spread into the merge beside `feedback`.
- `ipc.ts` beside `:4226`: `hv:get-crash-reports` · `hv:set-crash-reports` →
  `setCrashReports(on)` **and** `setEnabled(on, { dropQueue: !on })` · `hv:crash-info` →
  `{enabled, lastSent?, lastReport?, queueDir, dumpsDir}` · `hv:crash-reveal` →
  `shell.showItemInFolder` · `hv:crash-test` (dev-only, `throw|reject|crash|message`) — the
  handler exists, no button does.

Verify: `npx vitest run tests/crash-audit.test.ts`.

## Task 5 — preload and the renderer bridge

Files: `src/preload/index.ts` · `src/renderer/src/hv.d.ts` · `src/renderer/src/main.tsx` ·
`src/renderer/src/crashRoot.ts` (new)

- Preload: the five one-liners plus `onCrashSent(cb)` on the `onPiExit` shape (`:699-704`), and
  **outside** the `hv` object `contextBridge.exposeInMainWorld("inletCrash", { send: (_ch, env) =>
  ipcRenderer.send("inlet:crash", env) })` — the channel is a literal, never forwarded from the
  renderer. That name is what `inlet-sdk/crash/electron-renderer` looks for
  (`globalThis.inletCrash.send`, verified in the tarball).
- `crashRoot.ts` (pure): `rendererAppRoot({origin, pathname})` → under `file:` return `pathname`
  minus `/index.html`, else `origin`. Without it every packaged frame is `<external>`, because the
  SDK's browser default is `location.origin`, which is `file://`.
- `main.tsx`: `installElectronRenderer({ appRoots: [rendererAppRoot(location)] })` from
  **`inlet-sdk/crash/electron-renderer`** (node-free and build-enforced — the main entry statically
  imports `node:fs`/`node:os`/`node:crypto`/`node:path` and Vite cannot bundle it), then
  `createErrorBoundary(React, r => capture.captureReport(r), { appRoots })` from
  `inlet-sdk/crash/react`, wrapping `<App/>` with a `fallback` reading "This view broke." and a
  Reload calling `location.reload()`.

Verify: `npx vitest run tests/crash-root.test.ts tests/crash-wiring.test.ts` and `npm run build`
(the renderer bundling is the real assertion — a `node:` import fails there, not in vitest).

## Task 6 — the Privacy page and the audit row

Files: `src/renderer/src/components/PrivacyView.tsx` (new) ·
`src/renderer/src/components/Sidebar.tsx` · `src/renderer/src/components/HowItWorks.tsx` ·
`src/renderer/src/components/AuditView.tsx` · `src/renderer/src/App.tsx`

- `View` gains `"privacy"`; `NAV` gains `{ view: "privacy", label: "Privacy", Icon: PrivacyIcon,
  group: "app" }` **after Shortcuts** — it closes the App-features group, the set-once end.
  `tests/sidebar-groups.test.ts` order array and the label count 18 → 19.
- `PrivacyView.tsx`: a "Crash reports" block — the On/Off toggle copied from
  `SystemPromptView.tsx:150-179` `OpenFilesToggle`, `<HowItWorks copy="crashReports" />`, "Show the
  last report" rendering `crashInfo().lastReport` in a `<pre>`, and "Reveal crash reports"
  (`shell.showItemInFolder` on the dumps dir). Page prose says the page is where sending is
  decided, so a second block has an obvious home.
- `HOWTO_COPY` gains `crashReports` — title matching `/^(How|What) /`, body over 200 chars — and
  the key is added to `tests/how-it-works.test.ts`.
- `AuditView.tsx`: `Row` gains `({ row: "crash" } & CrashEvent)`; `toAuditRow` branches on
  `e.type === "crash.sent"` (never on `data.kind`); exported `crashText(r)` = `Sent a crash report
  · <kind>[ · new]`; a `crash` filter arm and `<option value="crash">Crash reports</option>`; the
  row render copied from the feedback block (`:482-500`). No message, no frames, ever.
- `App.tsx`: route `privacy` beside `changelog` (`:3384`); a one-time `<Banner tone="info"
  onDismiss>` beside `errorBanner` (`:3021`, slot `:3307`) raised by `hv:crash-sent` or by
  `crashInfo().lastSent` at mount — "A crash report was sent to HappyVibe", with *What was sent*
  navigating to the page and *Turn off* calling `setCrashReports(false)`. Once per window load,
  not persisted.

Verify: `npx vitest run tests/sidebar-groups.test.ts tests/how-it-works.test.ts` + the GUI pass.

## Task 7 — Pi and sidecar hooks

Files: `src/main/pi/PiClient.ts` · `src/main/SessionManager.ts` · `src/main/ipc.ts` ·
`src/main/documents.ts` · `src/main/mcpAdapterStore.ts`

- `PiClient.ts:74` emits `stderrLines: [...this.stderrLines]` beside the existing `stderr`
  (`stderrTail` is 8 lines and cuts frames; the ring is 40). `SessionManager.ts:156` forwards it on
  `SessionExit`; the type gains the field.
- `ipc.ts:2662`, inside `if (!intentional)`: compute `frames = piFrames(lines)` and report **only
  when `frames.length > 0`** — `captureReport({ kind: "child-exit", exit: { code, name: "pi" },
  exception: { type: piErrorType(lines), message: "", handled: false, frames } })`. The stderr
  message tail stays in the local `session.crash` row, unchanged.
- `documents.ts:147` (the anydoc crash branch) and `mcpAdapterStore.ts:145` (the no-output branch):
  `captureReport({ kind: "child-exit", exit: { code, name: "anydoc-bridge" | "mcp-oauth-bridge" },
  fingerprint: ["{{ default }}", String(code)] })` — never `detail`, never `absPath`.
- `voice/host.ts`: no change. The SDK's `child-process-gone` covers the `utilityProcess` and its
  intentional `kill()` is dropped by `scrubEnvelope`.

Verify: `npx vitest run tests/crash-wiring.test.ts` (pins that `session-exit` passes `stderrLines`
to `piFrames` and never passes `stderr` to `captureReport`).

## Task 8 — build knobs and tests

Files: `electron.vite.config.ts` · `electron-builder.yml` · `tests/crash-*.test.ts` ·
`tests/feedback-config.test.ts` · `tests/feedback-secrets.test.ts`

- Renderer `build.sourcemap: 'hidden'` (the renderer is minified; main is not).
- `electron-builder.yml` `files: ["out/**", "!out/**/*.map"]` — maps stay out of the DMG and are
  symbolicated locally against the release's `out/`.
- New, key-free, in the non-live suite: `crash-policy` · `crash-stderr-frames` · `crash-sentinel` ·
  `crash-root` · `crash-optout` · `crash-audit` · `crash-wiring`. Extend `feedback-config`
  (crashDatabase per channel, `cdb_` prefix, the two differ) and `feedback-secrets` (no `isk_`
  under `src/main/crash`).
- `crash-policy` also **pins upstream's redaction**, because we now depend on it rather than
  implement it: a safe-list message survives, `ENOENT: … '/Users/x'` → `ENOENT: <redacted>`,
  `alice@x.com is not valid` → a bare `<redacted>`. A bump that reintroduces the 0.1.0 leak fails
  here rather than in production.
- `crash-live.test.ts` on the `feedback-live` shape (`.env`, `/v1/health` capabilities includes
  `crash`, `describe.skipIf(!LIVE)`): init against the DEV database with a tmp `queueDir`,
  `captureMessage`, `flush`, assert `onSent` fired with a `reportId`. Cleanup is impossible with an
  `ipk_` — the dev database is the sink, by design.

Verify: `npm run gate`.

## Task 9 — docs

Files: `docs/prd.md` (done) · `docs/validation/d1.md` · `CLAUDE.md` · Notion (PRD + the
Crashreporting page).

- `d1.md` gains `§37 — Crash reports` after §34: the envelope on the wire, the `201`/`207`/`429`
  shapes, the `inlet:crash` IPC payload, the `crash.sent` row, and the measured
  `render-process-gone` reasons.
- `CLAUDE.md` Gotchas — only what is still true at 0.1.2: the renderer **cannot** import
  `crash/electron`; `clean-exit` and `killed` still arrive and must be filtered; `{ exitCode:
  false }` is deliberate, not inherited; `tags` and `context` travel verbatim so the allowlist is
  the content control; a Pi exit with no in-app frame is not reported. The "two singletons" and
  "`beforeSend` skips the fatal path" traps are **obsolete at 0.1.2** and must not be written down.

---

# Verification

## Automated

1. `npm run gate` (build → the non-live suite). The build arm is load-bearing here and not
   ceremony: the renderer's `inlet-sdk/crash/electron-renderer` import is only proven to bundle by
   `npm run build`, and a wrong entry fails there while passing every vitest file.
2. `npm run live:why` — expected to print **nothing**; no `pi-runtime/`, `src/main/pi/` or live test
   file changes. Say so rather than silently omitting the batch. `src/main/pi/PiClient.ts` **is**
   Pi-facing, so if it prints, run `npm run test:live` backgrounded and read the wall time (a real
   batch is ~7-8 min; 5 s means every file skipped).
3. `npx vitest run tests/crash-live.test.ts` alone, with `.env` symlinked.
4. `npm run build:unpack` → no `*.map` under `release/`, maps present under `out/renderer/assets/`.
   **Run 2026-09-21 and it passes, but read the number carefully:** `find release -name '*.map'`
   answers **6,833**, which looks like a failure and is not. Scoped to what the exclusion covers,
   `find release -path '*out/*' -name '*.map'` is **0** — no HappyVibe source map ships. The 6,833
   are **pre-existing and not ours**: 6,814 under `Resources/pi-runtime` (vendored, shipped as
   `extraResources`, so `files:` never touches them) and 19 under `app.asar.unpacked` (native
   dependencies). Whether the vendored runtime's maps should ship at all is a separate question
   that predates §37 and is not decided here. `out/` keeps 112 maps for local symbolication, and
   `inlet-sdk` is packed into the asar.
5. Read one dev report back. **There is no `/reports` collection route** — measured
   2026-09-21, it 404s; the server groups first. Two calls, with the `isk_` server key:
   `…/v1/crash-databases/cdb_aamshzzkjx9c/groups` then
   `…/groups/<groupId>/reports`, each report carrying its whole `envelope`. Check: frames
   root-relative, no `/Users/` anywhere, message `<redacted>`/errno/safe-list only, tags exactly
   `{runtime, channel}`, no `context` key. **Done 2026-09-21 and all five held** on a live
   `captureMessage` through the app's own `scrubEnvelope`.

## GUI — what will be TRUE on screen

Driven with electron-debug against a dev server started with **`HV_CRASH_DEV=1`** (without it the
feature is correctly inert, which is itself the first assertion). The test IPC has no buttons; call
it with `window.hv.crashTest('throw')` from `evaluate`.

**Presence, on the Privacy page** (sidebar → App features, last row, under Keyboard shortcuts):

- The sidebar's App-features group reads, top to bottom: Terminal · Voice · AI autofill · Keyboard
  shortcuts · **Privacy**. Privacy is last.
- The Crash reports toggle reads **ON** on a fresh profile, with no "takes effect on next launch"
  caveat anywhere on the page — the toggle is live in both directions and the page must not claim
  otherwise.
- "Show the last report" is **empty or disabled before any crash**, and after
  `crashTest('message')` shows a JSON envelope whose `tags` object has exactly two keys,
  `runtime` and `channel`.

**Presence, on the Audit log page** (the surface that owns the record, which is not the surface
that changed it — this is where a wrong default hides):

- After `crashTest('message')`: a row under the **Crash reports** filter reading
  `Sent a crash report · message · new`, and the `<option value="crash">` exists in the filter
  select.
- After `crashTest('throw')`: the app is **still running**, every open Pi session still answers
  (send a prompt in one and get a reply), and a second row appears.
- After `crashTest('reject')`: a third row.
- After `crashTest('crash')`: the window reloads exactly **once** and a `renderer-gone` row appears.

**Absence assertions — the thing the feature exists to exclude, by name:**

- **Closing a second window produces NO audit row.** That is `renderer-gone` with reason
  `clean-exit`, which the SDK reports and `scrubEnvelope` drops; if a row appears, the filter is
  dead and every normal window close is being filed as a crash. Observed on the **Audit log** page.
- **No row's text contains a message, a file path or a frame.** Every crash row is
  `Sent a crash report · <kind>` and nothing else — grep the rendered rows for `/Users/` and for
  `Error:` and get nothing. Observed on the **Audit log** page.
- **A Pi child killed by the user produces NO crash row.** Stop a running session from the UI
  (intentional) and then kill a Pi child from outside with `kill -9` (unintentional, but its
  stderr carries no in-app frame): a local `session.crash` entry exists, and **no `crash.sent`
  row does**. This is the frames-only filter, and it is the one that keeps an empty provider
  account from filing a report a day forever.
- **With crash reports OFF, `crashTest('throw')` produces no network request and no row**, and
  `<userData>/inlet-crash/queue.json` does not grow — the queue was dropped, so turning the switch
  back on later cannot send what was captured while off. Observed in the **network log** and on the
  **Audit log** page.
- **Without `HV_CRASH_DEV=1`, a dev launch initialises nothing**: no `inlet-crash` directory is
  created under userData at all.

**The one regression the design risks, as a sequence:**

The banner is raised by both `hv:crash-sent` and by `crashInfo().lastSent` at mount, and it is
"once per window load, not persisted" — so the risk is a banner that reappears forever, or one
that never appears again. Perform: (1) `crashTest('message')` → banner appears; (2) dismiss it;
(3) `crashTest('message')` again → **no second banner this window**; (4) ⌘R to reload the renderer
→ the banner appears once more (there is a `lastSent` and this is a new window load), dismiss it;
(5) open a **second** window → that window shows it once too, independently. If step 3 raises a
banner the dismissal is not held; if step 4 raises none the mount read is dead and a user who
crashes while the window is closed is never told.

---

# GUI pass — RUN 2026-09-21, and what it changed

Driven over CDP against `HV_DEBUG_PORT=9223 HV_CRASH_DEV=1 npm run dev`. Every assertion above
was executed. Results, including the two that were wrong as written.

**Held as specified.** The App-features group reads Terminal · Voice · AI autofill · Keyboard
shortcuts · **Privacy**, in that order. The toggle reads **On** on the page, with no "next
launch" caveat anywhere. "Show the last report" is disabled before any crash ("Nothing has been
sent from this computer yet.") and afterwards renders the whole 683-character envelope: `tags`
exactly `{runtime, channel}` with the real pin string, **no `context` key**, `message:
"<redacted>"`, and no `/Users/` anywhere. The Audit log shows one row under the **Crash reports**
filter reading `Sent a crash report · message · new` with `crp_… · 1 KB` beneath it — ids and a
size, no message and no frames. `throw` left the app **alive with all 66 sessions intact**
(`{ exitCode: false }` proven, not assumed); `reject` filed `unhandled-rejection`. An uncaught
**renderer** error reached main over `inlet:crash` and sent as `exception`, which exercises the
whole `crash/electron-renderer` → preload → `sanitizeRendererReport` path. With the toggle
**OFF**, a fatal main exception sent nothing **and left `queue.json` as `[]`** — the 0.1.0 hole,
verified closed on the fatal path. Turning it back ON reported immediately, no relaunch.

**Two bugs found, both invisible to every test.**

1. **`BrowserWindow.getFocusedWindow()` is null when the app is not frontmost**, which is always
   under CDP. The `crash` branch of `hv:crash-test` used it with `?.`, so it did nothing and
   still returned `true`. The tell was two registered `render-process-gone` listeners and zero
   events. Now takes `event.sender`.
2. **The `killed` filter was too broad and silently dropped every renderer death.** Measured: a
   forcefully crashed renderer reports `reason: "killed"`, not `"crashed"`. The first version
   dropped `killed` for `renderer-gone` as well as `child-exit`, so the server received **zero**
   `renderer-gone` reports. `killed` is now dropped only for `child-exit` (the voice host's own
   `kill()`); for a renderer it is the OS, and an OOM kill is exactly what we want to hear about.

**Two expectations in this plan were wrong, and are corrected here rather than quietly dropped.**

- *"Closing a second window produces NO audit row … if a row appears the filter is dead."* The
  outcome holds — a normal `window.close()` files nothing, and the server's `reportCount` was
  identical before and after — but **not for the stated reason**: no `render-process-gone` is
  emitted for that path at all, on either `app` or the `webContents`. The `clean-exit` arm of the
  filter is therefore unobserved defence, covered by `crash-policy.test.ts` and **not** something
  to cite as measured.
- *"Send a `message`, dismiss, send another and confirm no second banner this window."* The
  implementation re-raises the banner on every SEND, and that is the better behaviour: a second
  crash ten minutes later is a new fact the user should be told. The observed "no banner" was the
  SDK's 24-hour per-fingerprint dedupe — the second capture never became a send. Re-tested with a
  unique fingerprint: dismissed, then a fresh renderer throw, and the banner **came back**, as it
  should. Test the banner with a unique message or you will chase a bug that is not there.

**Not exercised:** `unclean-exit` (the sentinel is `app.isPackaged`-only by design, so it needs a
packaged build, not a dev run) and the minidump reveal path beyond the button existing.
