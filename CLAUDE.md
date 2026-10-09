# HappyVibe — project context

Electron app shipping a curated distribution of the Pi coding agent (pinned, vendored), with
permission UX and context-window visibility as the differentiators.
- PRD: `docs/prd.md`, a mirror of the Notion PRD — fold decisions in place, NEVER rewrite it wholesale.
- Evidence, measurements and bridge wire shapes: `docs/validation/*.md` (`d1.md` for wire shapes).
- Subsystem rules live in `.claude/rules/*.md` and load automatically when you touch matching
  files (index at the bottom).

## Commands
- Install: `npm install && (cd pi-runtime && npm ci)` — BOTH. `pi-runtime/` is a separate vendored
  tree; its postinstall applies the two owned patches (tintinweb, Pi's OAuth page). A fresh worktree
  without it fails the live tests.
- `npm run dev` · `npm test` (non-live suite, ~50 s) · `npm run build`
- **Gate = `npm run gate`** (build → non-live suite). `build` runs all three typechecks first and
  fast-fails, so never run `npm run typecheck` before `gate` or `build` — that's the same check twice.
- Plus `npm run test:live` when `npm run live:why` prints anything. If it prints nothing, say the
  live batch isn't required — don't silently omit it.
- `npm run lint` / `npm run format`: don't run. Lint refuses TypeScript 7 outright (by decision);
  format rewrites ~85% of the repo. Neither is in the gate or CI.
- User guide: `docs/guide/`, its own npm project — see `.claude/rules/docs.md`.
- Commits need `git commit -s` (DCO check in `.github/workflows/dco.yml`). CI runs on `main` pushes
  and pull requests only — a branch push runs nothing, so platform work needs a (draft) PR.
- Generated files — re-run the generator in the same change that invalidates it; each has a test
  that re-derives the output and fails if you forget:

  | Output | Command | Re-run after |
  |---|---|---|
  | `src/main/providerCatalog.generated.ts` | `npm run catalog:providers` | a Pi pin bump |
  | `src/main/plugins/catalog.generated.ts` | `npm run catalog:plugins` | any change to `plugins/classify.ts` or `plugins/scan.ts` |
  | `src/main/crash/safeMessages.generated.ts` | `npm run catalog:crash-messages` | adding a `throw new Error("…")` |
  | `build/icons/` | `npm run icons` | editing `build/icon.svg` (never hand-edit a PNG) |

## Tests
- `npm test` = `node scripts/test.mjs` = the non-live suite, exactly what CI runs. It forces BOTH
  `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` to `sk-REPLACE`, which `tests/liveModel.ts` treats as
  ABSENT (its `.env` loader only fills UNSET vars), so every live file skips itself. Neutralise only
  one and the day the other key lands in `.env`, `npm test` silently becomes the paid ~8-min live
  suite. Never add an exclude list back — the list is what drifted.
- **Never pipe a test run to `tail`/`grep`.** The pipe returns tail's exit code (a red suite reads
  green) and the output is gone. Redirect once, then grep the file for free:
  ```
  L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L
  ```
- Don't delegate a test run to a subagent: the output is tiny and you need the stack trace verbatim.
- **Live tests** are the files matching `grep -rl "skipIf(!KEY" tests/` — re-derive the list, never
  write a count down. Which provider/model they use is decided ONLY in `tests/liveModel.ts`
  (OpenRouter `deepseek/deepseek-v4-flash` first, DeepSeek direct second); import
  `{ KEY, MODEL, PROVIDER_ENV }` from it, never re-inline a provider, model id or `.env` loader.
- `npm run test:live` runs them serially — `--no-file-parallelism` is load-bearing (concurrent
  sessions degrade the provider). It takes ~7–8 min: run it with `run_in_background`, and only
  alongside work that doesn't touch `src/` or `pi-runtime/` (the run reads the tree as it goes).
- `npm run live:why` diffs `main...HEAD` — it only sees COMMITTED work. Ask it after the commit.
- **A worktree has no `.env`** (gitignored), so the live batch skips everything and exits 0 in
  seconds. Symlink it first: `ln -s ~/Documents/Github/HappyVibe/.env .env`. The tell of a fake
  green is the wall time.
- Before believing a live failure: (1) `pgrep -fl electron-vite` — a running app is a third
  provider consumer and reproduces "failures" even in isolation (`"npm run dev"` misses the main
  checkout's app, which runs as `electron-vite dev --remoteDebuggingPort=9333`); (2) check the account has
  balance (a `402` looks exactly like a regression); (3) rerun that file alone. A batch far slower
  than ~7–8 min is the contention tell.
- Never fix a live failure by raising a timeout: a model that finished its turn without a tool
  call won't produce one later — re-ask with `askUntil` (`tests/reask.ts`) and match the notify you
  actually mean. Only exception: something that demonstrably ARRIVES, late (Pi has no boot
  handshake in RPC mode; an early stdin write just waits out the boot, up to ~16 s cold) — then
  wait for it properly, like `waitFor` in `tests/ui-fallback-bridge.test.ts`.
- A behavioural claim about the model ("tool X makes it stop calling bash") needs interleaved arms
  and a p-value before it's recorded — the model calls `bash` on ~half of attempts at baseline.
- `vitest.config.ts`: `testTimeout: 30_000` (a Pi boot outlasts vitest's 5 s default). Includes
  `tests/**/*.test.ts` only — no DOM, no jsdom, no testing-library. Pin a UI contract as exported
  DATA (e.g. `STATUS_MARK` in `ToolCard.tsx`) plus a source scan for what must NOT render.
- Contract tests are the pin-bump gate (`/pi-bump`). New bridge wire shapes go in `docs/validation/d1.md`.

## Architecture
- `src/main/pi/{spawn,codec,PiClient}.ts` spawn the pinned Pi CLI per session, `--mode rpc`, NDJSON
  over stdio. `spawn.ts` is electron-free (vitest-importable). We deliberately don't use Pi's
  in-process SDK: process isolation gives crash isolation and hibernation.
- `pi-runtime/`: vendored `@earendil-works/pi-coding-agent`, `@tintinweb/pi-subagents` (patched at
  install), `@firecrawl/anydoc`, all pinned exact — plus `extensions/`
  (`happyvibe-bridge.ts` + pure `hv-*.ts` modules shared with main and tests).
- **The bridge owns ALL permission UI and enforcement** (Pi's permission package is TUI-only in RPC,
  `docs/validation/v6.md`). Prompts never time out and never auto-allow, except under a full bypass
  (the persistent "Bypass ALL permissions" setting, workspace over global, resolved at spawn via
  `HV_BYPASS` — the only way on; main's slash guard, `slashGuard.ts`, refuses a typed reserved
  command except `/hv-dangerous off`). Bypass still audit-flags every call and shows the red
  banner. Gate order in `tool_call`: read-only clamp → plan clamp → bypass → rule engine.
- Bridge⇄main protocol: JSON envelopes `kind:"hv.*"` over `extension_ui_request`. Blocking =
  `select`/`input` with the payload in **`title`**; fire-and-forget = `notify` with the payload in
  **`message`**. Main must ALWAYS answer a blocking envelope (an error string on failure) or the
  bridge hangs. Bridge slash commands `/hv-*` are sent as RPC prompts.
- EventLog: JSONL, frozen envelope `{ts,type,sessionId?,workspaceId?,data?}` — audit + analytics. No SQLite.
- **Resource gate:** spawn passes `--no-extensions --no-skills --no-prompt-templates --no-themes`, so
  all four Pi auto-discovery tiers are deny-by-default — `bash` isn't path-confined and could plant
  an extension that loads on every future session. All four are ADDITIVE (`-e`, `--skill`,
  `--prompt-template` still load); `tests/resource-gate-contract.test.ts` pins that. `--no-context-files`
  is deliberately NOT passed (AGENTS.md loading is wanted). `--no-extensions` also keeps Pi's BUILT-IN
  extensions off (mcp, codemode, tool-search, llama.cpp); loading one is `-e builtin:<name>`, a decision.
  Chat sessions load `builtin:mcp` + `builtin:tool-search` (`mcp: true`, PRD §13 2026-10-05) unless the
  MCP switch is off — never the utility client or one-shots: Pi has no lazy start, so any Pi with MCP
  starts every server.
- **Tool switches** (PRD §13 round 26) ride `HV_BUILTINS`, whose keys spawn.ts lists EXPLICITLY — a key
  missing there never reaches the bridge. A family off isn't loaded (no `-e`/`--skill`); core tools and
  `SubagentWorkflow` go to ONE `--exclude-tools`. The child guard reads the same `coreOff` (children
  run in-process), so off holds in sub-agents and under bypass.
- Model resolution is session → workspace → global, in TWO places that change together: `ipc.ts`
  `spawnOpts` and renderer `composer.ts` `resolveModel`. When nothing resolves the app REFUSES (the
  SessionManager `spawn` callback throws, ChatView disables send) — it never invents a model. The
  refusal is not in `resolvePiSpawn`, because the utility client must spawn model-less for `/hv-login`.
- Every fs writer is path-confined (`resolveInWorkspace` pattern, `files.ts`). Workspace identity is
  `normPath` (store.ts, via `WorkspaceRegistry`) — never compare raw path strings. Separators and
  case: `hv-paths.ts` (import-free, shared by bridge, child guard, main and renderer).
- Renderer perf: streaming text stays OUT of the transcripts array (streamRef + rAF batching in
  `App.tsx`); tool cards update via the `toolIndex` map, never a full `.map()`.
- `src/main/platform.ts` is the OS seam; `process.platform` anywhere else in `src/main` is a review red.
- Guidance copy that describes a gate is DERIVED from that gate, never re-typed beside it
  (`tests/how-it-works.test.ts`).

## Pins
- Versions live in `pi-runtime/package.json` (and `inlet-sdk` in the root) — read them there, never
  from prose. Every release carries the `Runtime:` pins line (the `changelog` skill writes it).
- Move these WITH the Pi pin, to exactly what Pi declares: `typebox` in `pi-runtime` (the bridge
  builds tool schemas, Pi consumes them), `@earendil-works/pi-tui`, and `yaml` in the root (our
  frontmatter parsers must read files exactly as Pi does). `tests/tintinweb-contract.test.ts`
  asserts the relationship.
- The Pi CLI entry is `dist/bundle/cli.js` (Pi's own `bin.pi`), in `PI_CLI_RELPATH` (spawn.ts), the
  one copy. `tests/pi-cli-entry.test.ts` boots it and asserts nothing under `dist/` imports a
  package Pi doesn't declare.
- Two owned patches, the only exceptions to "never patch vendored code", both applied by
  `pi-runtime`'s postinstall and failing the install when an anchor moves: tintinweb
  (`.claude/rules/subagents.md`) and Pi's OAuth sign-in page (`.claude/rules/providers.md`).
- A bump: `/pi-bump`, contract tests green, `npm run catalog:providers`, and re-derive any guidance
  copy the tests flag.

## Import hygiene — each of these typechecks, runs in dev, and fails later
- **Anything the renderer imports must not reach Node.** `schedules.ts`, `hv-paths.ts`,
  `update/state.ts`, `usage/events.ts`, `remoteConfig/defaults.ts`, `providerError.ts`, `docsBase.ts`, `privacySwitches.ts` and `hv-images.ts` import nothing; `terminalSettings.ts` imports the platform seam TYPE-only. A
  runtime import puts `node:*` in the browser bundle and only `npm run build` fails — *"X is not
  exported by __vite-browser-external"*, naming a file one hop from the real cause.
- **Anything vitest imports must not reach `electron`.** `ipc.ts` never imports `./crash`, `./update`
  or `@electron-toolkit/utils` (use `!app.isPackaged` for is-dev). Under vitest `electron` is a CJS
  stub, and the whole test FILE dies with *"Named export 'BrowserWindow' not found"* naming the wrong line.
- Tests are not in `tsconfig.node.json`'s include: a bad call in a test fails at runtime, not typecheck.
- Dynamic imports of absolute paths use `pathToFileURL(p).href` — Windows rejects `c:` as a protocol.
- The renderer CSP is `script-src 'self'`: a Worker/Worklet must be a real emitted file. Never widen
  the CSP to `blob:`/`data:` (`.claude/rules/voice-documents.md`).

## Gotchas
- `src/main` changes need a dev-server RESTART — ⌘R reloads only the renderer, and preload is
  bundled at window creation. Before claiming a main-side fix is live, grep the built
  `out/main/index.js`, not the source.
- One-shot `pi` CLI calls hang unless stdin is closed (`stdio: ["ignore", …]`). RPC mode is unaffected.
- Every Pi child spawn uses `nodeExecPath()` (platform seam), never raw `process.execPath` — on macOS
  each raw child gets its own generic "exec" Dock icon.
- `ctx.hasUI` is TRUE in `--mode rpc`; Pi's headless mode is PRINT mode, so an upstream "headless"
  gate does not exclude us (`.claude/rules/pi-runtime.md`).
- Built-in Pi tools can't take extra schema params (stripped before `tool_call`): `intent` goes on
  registered tools only; built-ins get derived labels (`toolLabel.ts`, `describeCommand.ts`).
- Context removal: completed turns only (removing the in-flight pair causes a runaway re-execution
  loop), and toolCall/toolResult are removed together. `contextUsage.tokens` is null right after
  compaction and `stats.tokens` is cumulative — show neither as live context (gauge says "measuring…").

## Platforms
- **Windows:** ONE checkout, installed only from Windows. Claude Code edits from WSL; the app,
  `npm test`, `npm run build` and `build:win` run natively via
  `cmd.exe /c "cd /d C:\...\HappyVibe && npm test"`. One `node_modules` can't serve both OSes — a Linux
  `electron` (not `electron.exe`) in `node_modules/electron/dist` means someone installed from WSL:
  delete both trees and reinstall. Never pipe `cmd.exe` output (you get the pipe's exit code), and
  put anything with inner quotes in a `.bat`/`.mjs` (WSL→cmd mangles nested quotes).
- **Linux:** `npm ci` compiles node-pty (no linux prebuild) — needs `build-essential` + `python3`.
  Users are unaffected: the N-API binary rides in the artifact.
- Copy: no `⌘`, no "your Mac" — `formatBinding`, `MOD` and `platformCopy.ts` carry it
  (`tests/mod-key-copy.test.ts`).

## Releasing (PRD §30, §38)
- `package.json` `version` is the ONLY version (Info.plist, the renderer constant and tag `v<version>`
  derive from it).
- SemVer in user terms: PATCH = fixes · MINOR = anything new to see or do (the normal release) ·
  MAJOR = the user has to do something. `0.x` until the public launch (`1.0.0` = launch); a
  MAJOR-class change ships as MINOR with a **Heads up** block. A pin bump is MINOR if the user sees it, PATCH if not.
- `CHANGELOG.md` is hand-written at the functional level — the `changelog` skill owns the how, at
  release time only. The top released entry must equal `package.json`'s version
  (`tests/changelog.test.ts`).
- `/release <patch|minor|major>` cuts it and stops before pushing; `/ship` pushes and builds; a human
  presses Publish (`.claude/rules/release.md`).

## Docs workflow
- Locked product decisions go to BOTH the Notion PRD and `docs/prd.md` in the same session, folded in
  place with the "Decision (…)" convention. Never rewrite user-authored documents wholesale.
- A change to a screen's behaviour or copy updates its user-guide page (`docs/guide/src/content/docs/<slug>.md`) in the same commit.
- **Keep this file and `.claude/rules/` current-state.** When something changes, REPLACE the entry —
  don't append a dated paragraph. No counts that drift, no "used to", no incident stories: a rule
  plus a one-line why. Evidence goes to `docs/validation/`.

## Rules index (`.claude/rules/`)
`pi-runtime` (Pi/RPC facts, one-shots, system prompt) · `subagents` (tintinweb, child policy,
workflows) · `permissions-plan` (rules, plan mode, audit) · `mcp` · `plugins` · `skills-prompts` ·
`memory` · `schedules` · `terminals` · `browser` · `renderer-layers` (overlays, z-index, menus) ·
`transcript-cards` · `tabs-layout` · `guidance` · `git-worktrees` · `crash-feedback` · `release`
(signing, updater) · `voice-documents` · `providers` · `typescript` · `windows` · `linux` · `docs` (user guide)
