# HappyVibe — project context

Electron app shipping a curated distribution of the Pi coding agent (pinned, vendored)
with permission UX + context-window visibility as the differentiators.
PRD: docs/prd.md (mirror of the Notion PRD — fold decisions in place, NEVER rewrite wholesale).

## Commands
- `npm install && (cd pi-runtime && npm ci)` — BOTH installs required (pi-runtime is a separate vendored tree; fresh worktrees fail live tests without it)
- `npm run dev` · `npm test` (= the non-live suite, see §Tests) · `npm run build`
- `npm run typecheck` (node + web; passes `--composite false` — don't hand-roll the raw `tsc` calls)
- `npm run lint` / `npm run format` are SCAFFOLD LEFTOVERS — don't run them casually.
  `eslint.config.mjs` is untouched electron-vite boilerplate from the initial commit: lint reports
  86 errors + 19,839 warnings (mostly `prettier/prettier`) and walks `release/` build output, and
  `npm run format` rewrites 281 of 329 tracked files — an 85%-of-repo diff that buries whatever
  you actually changed. Neither is in `gate` or CI. Leave them alone unless you are deliberately
  doing a formatting pass, on its own branch.
- Full gate = `npm run gate` (= `build` → non-live suite, ONE command), plus `npm run test:live`
  when `npm run live:why` prints anything. `build` runs BOTH typechecks first and fast-fails on
  them, so never run `npm run typecheck` before `gate` or `build` — that is the same check twice
  and it was ~20 of the 55 typecheck runs in this repo's history.

## Tests
- Live-Pi tests (real DeepSeek; `DEEPSEEK_API_KEY` in `.env`, skipIf-gated) — **14 files**:
  tests/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,prompt-templates-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,mcp-bridge,plan-bridge}.test.ts
  Source of truth = `grep -rl "skipIf(!KEY" tests/` — re-derive, don't trust the list above.
  Canonical invocation: `npm run test:live`
  (= `grep -rl 'skipIf(!KEY' tests/ | xargs npx vitest run --no-file-parallelism`)
  Run it only when `npm run live:why` prints something — that prints the changed files which
  are Pi-facing (`pi-runtime/extensions/`, `src/main/pi/`, or a live test file). Empty output
  means the batch is not required; SAY so, don't silently omit it.
  (`--no-file-parallelism` is load-bearing: concurrent files mean concurrent DeepSeek sessions,
  and the provider degrades under that — the residual "flakes" were turns that came back with no
  tool call at all. Serial costs ~6 min and is green.)
  (use `xargs` — zsh does NOT word-split `$(…)`, so `npx vitest run $files` passes all 14
  paths as ONE argument and vitest reports "No test files found" while echoing the filter list.)
  (`skills-contract`/`builtins-contract` also spawn Pi but with a dummy key — key-free, they stay in the non-live run.)
- **Background the live batch, not the fast one.** `test:live` is ~6 min and blocks, so run it
  with Bash `run_in_background: true` and keep working — the harness re-invokes on exit with the
  raw output. **Only alongside work that does not touch the tree**: docs, docs/prd.md, Notion,
  reading, review. `vitest run` collects files as it goes and the live files spawn real Pi
  children against `pi-runtime/`, so a mid-run edit to `pi-runtime/` or `src/` yields a result for
  a tree that never existed — wait, or discard and re-run. `npm test` (~25-40 s) is NOT worth
  backgrounding; the context switch costs more than the wait. Do NOT delegate a test run to a
  subagent: measured across 153 sessions / 781 runs, the median run returns 244 chars (~61 tokens)
  and 1.27% of all tool output, so there is no context to save — and one agent spawn costs ~45k
  tokens, i.e. 67% of what every test run in this repo's history cost combined, to hand back a
  paraphrase of the stack trace you needed verbatim.
- Non-live suite = `npm test` (= `DEEPSEEK_API_KEY=sk-REPLACE vitest run`). No exclude list:
  every live file computes `KEY` as undefined when the key starts `sk-REPLACE`, and their inline
  `.env` loader only fills vars that are UNSET — so the shell value wins and all 14 skip
  themselves. This is exactly what CI runs (CI has no key at all), and it is STRICTLY MORE than
  the old exclude glob: 9 key-free tests live inside those 14 files (context-bridge ×2,
  rules-bridge ×3, agents-bridge ×2, agents-md-bridge, subagent-discovery-bridge) and the glob
  threw them on the floor. Measured: 139 files, 1253 tests, 15 skipped, ~25-40 s (2026-08-04).
  **Never add an exclude list back — the list is the thing that drifted.**
- Run live files BATCHED in one vitest invocation — they flake under the full parallel
  suite (process + LLM contention). One live failure ⇒ rerun in isolation before calling it a regression.
- **NEVER pipe a test run to `tail`/`grep`.** Two bugs in one habit: `| tail` returns *tail's*
  exit code, so a red suite reads green; and the output is gone, so looking at a different slice
  costs a whole re-run. Those two are the WHOLE case — redirecting saves no tokens, measured:
  across 153 sessions the 95 redirected runs median 242 chars vs 244 for straight-to-stdout.
  Redirect for the exit code and the free re-grep, never to trim output. This was the single
  largest time sink in this repo's history —
  `rules-bridge.test.ts` was run 5× in one session at ~137 s each, differing only in
  `| grep -E` vs `| sed -n` vs `--reporter=verbose | tail -40`. Redirect once, then grep for free:
  ```
  L=/tmp/vitest.log
  npx vitest run <target> > $L 2>&1; echo "EXIT=$?"
  tail -30 $L        # then grep/sed $L as many times as you like — costs nothing
  ```
- `vitest.config.ts` exists for these: `testTimeout: 30_000` (vitest's 5 s default is shorter than a
  Pi boot — a test without an explicit timeout was a coin flip). Don't "fix" a live failure by
  raising a per-test timeout: a longer wait does not make a model that already finished its turn
  produce a tool call. Check whether the model simply didn't call it (re-ask via `tests/reask.ts`
  `askUntil`) and match the notify you actually mean (`tool === "bash"`, not "the first hv.audit").
  The ONE exception is a boot race, and you must prove it before invoking it: Pi emits NOTHING on
  boot in RPC mode (no session_start, no ready event) and `PiClient.start()` only spawns, so there
  is no handshake to await. An early stdin write is buffered, not lost — it just waits out the
  boot, measured 671 ms warm vs 15_667 ms cold. If the thing you await demonstrably ARRIVES, only
  late, waiting longer is the real fix (see `ui-fallback-bridge.test.ts` `waitFor`, which flaked
  2 runs in 3 on an 8 s bound). If it never arrives, it's the prose-turn class above — re-ask.
- Contract tests are the Pi upgrade gate: any pi/pi-subagents pin bump must pass them.
  Wire shapes are documented in docs/validation/d1.md — new bridge shapes go there too.
- **You cannot force a tool call by passing `toolChoice` — it is silently DISCARDED.** pi-coding-agent
  only calls `streamSimple`, whose `buildBaseOptions` allowlist (19 fields) omits it; no throw, no
  warning, and `toolChoice` IS a real typed pi-ai option elsewhere, so this looks like it works.
  There is also no CLI flag and no RPC param for it. The only route in is a `before_provider_request`
  extension hook, whose return value replaces the raw request body. Full citations + the three
  constraints (hook fails OPEN, arm-per-turn or `agent_end` hangs, keep `askUntil`) in
  docs/validation/tc1.md. Read it before re-investigating.
- **The bridge reaches two `pi-subagents` internals by RELATIVE path — never "tidy" them into
  bare specifiers.** `listAsyncRuns` (`src/runs/background/async-status.ts`) + `ASYNC_DIR`
  (`src/shared/types.ts`) feed `/hv-subagent-list`'s card resync, and from 0.35.0 the package
  ships an `exports` map (`.`, `./background-work`, `./delegation`, `./capability-ceiling`,
  `./preflight`) that lists neither file. An exports map only gates BARE specifiers, so
  `../node_modules/pi-subagents/src/...` resolves where `pi-subagents/src/...` throws
  `Missing "./src/..." specifier` — at extension LOAD, taking ~18 tests red at once (that is the
  symptom, not a mystery). No public surface can replace this: `snapshotBackgroundWork()` is the
  inverse API (other extensions declare work TO pi-subagents; it never self-registers, so the
  snapshot is empty) and the `status` RPC's structured `fleet` field withholds run identifiers by
  design (`rpc.ts:76` "never a run or async identifier") while `/hv-subagent-list` needs
  `{runId, agent, asyncDir}`. Gate: `tests/pi-subagents-contract.test.ts` (key-free) pins the
  relative form, the exports map, and the three fields. Bumped 0.34.0 → 0.40.0 on 2026-08-02.
- **Two PRD §12 invariants are enforced by matching an upstream NAME or SHAPE, and 0.40.0 broke
  both silently — no test failed.** (1) The "never block on a delegation" guard matched the literal
  `"wait"`; 0.35.0 renamed the tool `subagent_wait` with no alias. Both names now live in
  `WAIT_TOOLS`/`isWaitTool` (hv-rules.ts), imported by the bridge (blocks the call) AND the renderer
  (hides the card) — never re-inline a literal. (2) The subagent card read the child transcript from
  `tool_execution_update…results[].messages`; 0.40.0 sets it `undefined` and substitutes compact
  `toolCalls` (same commit as the deep-fan-out protocol-limit fix). Renderer maps `toolCalls` → the
  same rows and renders `finalOutput`. Both pinned in `tests/pi-subagents-contract.test.ts` +
  `agents-renderer.test.ts`; wire shapes in docs/validation/d1.md.
- **A subagent's `tools:` list is a STRICT allowlist from pi-subagents 0.40 — an unknown name fails
  the whole run**, with `"Agent 'x' requested unavailable child tools: …"` (its new
  `src/runs/shared/tool-availability.ts`; no such check in 0.34, which ignored unknown names).
  Pi 0.83's builtins are exactly **bash, edit, find, grep, ls, read, write** — there is NO `glob`
  and NO `list`. Both bundled agents shipped asking for `glob, list` and were silently running
  without them; at 0.40 that is fatal. Extension tools need more than a name (`subagentOnlyExtensions`
  / a path-like entry), so never just add one to `tools:`. Pinned by
  `tests/pi-subagents-contract.test.ts`, which derives the legal set from Pi's own registrations.
- **`ctx.hasUI` is TRUE in `--mode rpc` — "RPC" is not "headless".** Measured, not inferred:
  rpc-mode.js binds a real `uiContext` (`createExtensionUIContext()` — the channel the bridge's own
  permission prompts ride) and `hasUI()` is just `uiContext !== noOpUIContext`. Pi's headless mode is
  PRINT mode. This matters because upstream code and docs say "headless sessions do X" and gate X on
  `ctx.hasUI`: read that as print-mode-only, and DON'T assume a `ctx.hasUI` gate excludes us.
  The load-bearing case: pi-subagents >=0.40 ends every turn with
  `if (ctx.hasUI) return; await drainOutstandingWork(...)` (`index.ts:462`), which would block each
  turn on its own async delegation (the inverse of PRD §12) — it is dormant ONLY because hasUI is
  true, there is no opt-out, and Pi awaits handlers serially (runner.js:585). The three links are
  pinned in `tests/pi-subagents-contract.test.ts`; if that group fails, re-measure `hasUI` with a
  probe extension before believing anything else.
- **`typebox` is pinned in `pi-runtime` to exactly what `pi-coding-agent` declares — move them
  together.** The bridge does `import { Type } from "typebox"` (bare), so it resolves to whatever
  `pi-runtime/node_modules` hoists. It used not to be a direct dep at all, and the pi-subagents 0.40
  bump silently moved it 1.1.24 → 1.1.38 — every registered tool's schema built by a library nobody
  chose. The bridge BUILDS those schemas and Pi CONSUMES them, so the pin tracks Pi (1.3.7), not
  "latest" and not pi-subagents' nested 1.1.38. `tests/pi-subagents-contract.test.ts` asserts the
  RELATIONSHIP, so a Pi pin bump fails until typebox follows. (For the record: the emitted JSON
  Schema was byte-identical across 1.1.38/1.3.7 for all seven constructors we use, and typebox
  attaches no Symbol-keyed metadata, so there is no dual-package hazard — the alignment is for
  future-proofing, not a live bug.)

## Architecture (keep layer)
- src/main/pi/{spawn,codec,PiClient}.ts — spawns the pinned Pi CLI per session, `--mode rpc`,
  NDJSON over stdio. spawn.ts is electron-free (vitest-importable). We deliberately do NOT
  use Pi's in-process SDK: process isolation is load-bearing (crash isolation, hibernation).
- pi-runtime/ — vendored @earendil-works/pi-coding-agent + pi-subagents + pi-mcp-adapter (pinned exact)
  + extensions/ (happyvibe-bridge.ts + pure hv-*.ts modules shared with main and tests).
- The bridge owns ALL permission UI/enforcement (Pi's permission pkg is TUI-only in RPC —
  docs/validation/v6.md). Permission prompts never time out. They never auto-allow EXCEPT when
  a full bypass is active: session-only dangerous mode (`/hv-dangerous`) OR the persistent
  "Bypass ALL permissions" setting (global+workspace, workspace overrides global, resolved at
  spawn via `HV_BYPASS`; PRD §10 round-3 reversal). Bypass still audit-flags every call and
  shows the red banner.
- Bridge⇄main protocol: JSON envelopes `kind:"hv.*"` over extension_ui_request
  (blocking = select/input; fire-and-forget = notify); bridge slash-commands `/hv-*` via RPC prompt.
- JSONL EventLog, frozen envelope `{ts,type,sessionId?,workspaceId?,data?}` — audit + analytics. No SQLite.
- Model resolution: session → workspace → global, mirrored in ipc.ts `spawnOpts` AND
  renderer composer.ts `resolveModel` — change both or neither.

## Gotchas
- One-shot pi CLI calls hang unless stdin is closed (`stdio: ["ignore", …]`). RPC mode unaffected.
- `src/main` changes need a dev-server RESTART. A renderer reload (⌘R, `electron-debug reload`)
  re-runs the renderer only — it does NOT rebuild main, and preload is bundled at window creation
  so it doesn't reload either. Before claiming a main-side fix is live, check the BUILT artifact
  (`grep '<your change>' out/main/index.js`), not the source. Verifying the source is not
  verifying the app — this cost hours during §9 rewind: a committed, unit-tested fix looked
  broken in the GUI because main was still running a four-hour-old bundle.
- macOS Dock icons: Electron-as-node children spawned from the main Electron binary each get a
  generic "exec" Dock icon (LaunchServices registers any .app-bundled binary as Foreground, even
  with ELECTRON_RUN_AS_NODE). All Pi child spawns must use `nodeExecPath()` (spawn.ts) — routes
  through `<Bundle> Helper (Plugin).app` (LSUIElement=1) — never raw `process.execPath`.
- Built-in Pi tools cannot take extra schema params (stripped before tool_call) — `intent`
  goes on registered tools only; built-ins get derived labels (toolLabel.ts / describeCommand.ts).
- Pi has NO dequeue RPC; abort preserves the queue.
- Context removal: completed turns only (removing the in-flight pair causes a runaway
  re-execution loop); toolCall/toolResult always removed atomically.
- `contextUsage.tokens` is null right after compaction; `stats.tokens` is cumulative-since-
  session-start — never present it as live context (gauge shows "measuring…").
- pi-subagents children need `PI_SUBAGENT_PI_BINARY` (set in spawn.ts) — it points at
  `pi-runtime/bin/pi-node.sh`, which routes through the bundled Electron helper
  (ELECTRON_RUN_AS_NODE) when packaged and falls back to `node` in dev. No system Node required.
- Async subagents (PRD §12): delegations are async-by-default (`writeSubagentConfig` in
  config.ts writes `asyncByDefault` at startup). Detached runs are `unref`'d — they SURVIVE a
  parent respawn, but pi-subagents drops their completion unless the resumed session keeps the
  SAME Pi session id, so ALWAYS resume via the session file (`startClient(meta,true)`). An active
  async run must keep the session non-idle (`activity.asyncRuns`, gated in `isIdle`) or
  hibernation/MCP-reload would `manager.stop()` mid-run. Lifecycle is relayed off pi-subagents'
  in-process `pi.events` bus by the bridge as `hv.subagent` notifies (never on RPC stdout);
  `/hv-subagent-list` resyncs cards after a respawn (restoreActiveJobs does NOT re-emit started).
- `installBuiltinAgents` (config.ts) decides "did the user edit this bundled agent?" by CONTENT
  HASH, never mtime. mtime failed silently both ways: a restamp-without-change (a second install
  pass racing the post-copy stat, a copy, a sync tool) read as an edit and froze that agent
  forever, while a real edit inside the 1 ms tolerance read as unedited and got clobbered. Legacy
  `{version, installedMtime}` stamps can't prove authorship, so they are repaired towards the
  bundle leaving a one-time `<agent>.md.bak`. Pinned by `tests/builtin-agents-uninstall.test.ts`.
- **`yaml` is a ROOT dep pinned to what Pi depends on (2.8.3) — move it with the Pi pin.** Same
  relationship as pi-runtime's typebox, for a sharper reason: Pi decides what loads, and Pi's
  frontmatter reader IS `yaml.parse` (`dist/utils/frontmatter.js`). Both `parseSkillFrontmatter`
  (skills/discovery.ts) and `parsePromptTemplateFrontmatter` (promptTemplates/discovery.ts) hand-rolled
  a one-line `key: value` scan, so ANY multi-line YAML scalar read as empty — and for skills that is
  not cosmetic: empty description ⇒ `loadable:false` ⇒ the Skills page claims "SKILL.md is missing a
  description (Pi will not load it)" AND `resolveActiveSkills` refuses to pass the dir to `--skill`, so
  a skill Pi loads fine is unusable in HappyVibe. Found via Anthropic's own `math-olympiad` plugin
  (folded `description:`, scanned to zero skills). Long descriptions are idiomatic in the Agent Skills
  spec, so this is the common case, not a corner. Match Pi on types too: `disable-model-invocation`
  is `=== true` (a real boolean), and malformed YAML degrades to "no frontmatter" rather than throwing.
- **A PLUGIN's `.mcp.json` is not our `.mcp.json`.** Two shapes exist upstream — measured across the
  278-entry official marketplace: **169 wrapped** in `{mcpServers:{…}}` and **26 bare**, a straight
  `name → config` map, and the bare set is `github`, `linear`, `context7`, `playwright`, `asana`,
  `firebase`, `gitlab`, `terraform`. Read a plugin's file with `readPluginMcpServers`
  (plugins/scan.ts), never `readMcpFile`: the latter requires the wrapper and is RIGHT to, because it
  parses HappyVibe's own config (`mcp.json`, the workspace `.mcp.json` we write). Using it on a
  plugin returned zero servers for all 26, so they classified as *having* mcpServers while offering
  none and were dropped as "nothing to install" — MCP-by-import silently imported nothing for every
  first-party MCP plugin. Unit fixtures used the wrapped shape, so the suite was green; only running
  over the real marketplace caught it.
- **"Signs in and lists tools on the MCP page, but unusable in a session" = the adapter skipped OAuth
  because of a NON-AUTH header.** `supportsOAuth` (adapter `mcp-auth-flow.ts`) returns false the moment
  a remote server has ANY custom header — right for `Authorization: Bearer …`, where the header IS the
  credential, wrong for a telemetry tag. The Miro plugin ships `X-AI-Source: claude-code-plugin`, so the
  adapter built no auth provider, never read the tokens main had stored, and connected unauthenticated.
  The split symptom is the diagnostic: **main does OAuth explicitly (`mcpOAuth.ts`) while the adapter
  auto-detects**, so the page can look perfectly healthy while sessions fail. `normalizePluginMcpServer`
  (plugins/mcpImport.ts) sets `auth:"oauth"` when no header looks credential-shaped;
  `tests/mcp-plugin-import-auth.test.ts` pins the upstream heuristic as a pin-bump gate, so when the
  adapter learns to tell auth headers apart, delete the workaround. Debug this class by running the
  vendored `supportsOAuth` over the real `mcp.json` rather than reading its comments.
- **§25's plugin store is GENERATED, not fetched** — `npm run catalog:plugins` writes
  `src/main/plugins/catalog.generated.ts`, and only plugins that pass are listed. Re-run it after ANY
  change to `plugins/classify.ts` or `plugins/scan.ts`, because the classifier is what the catalog
  encodes; `tests/plugin-catalog.test.ts` guards the committed data but cannot re-verify a plugin.
  The generator reuses the app's own `scanPluginDir` on purpose — a second classifier would drift,
  and the drift shows up as a refusal in front of the user. Read its run summary: the reject-reason
  histogram is what surfaced both bugs above, and a benign new manifest key shows up there as
  `declares "x", which HappyVibe does not recognise` rather than as a silently missing plugin.
- **`node-pty`'s `spawn-helper` arrives from npm WITHOUT its executable bit**, and every `pty.spawn`
  then fails with the entirely unhelpful `posix_spawnp failed.` — in DEV, before packaging, and on
  every fresh clone. `scripts/fix-pty-helper.mjs` chmods it from `postinstall`; the first test in
  `tests/terminals.test.ts` pins it so nobody deletes the script as mysterious. Corollary worth
  knowing: node-pty 1.1.0 ships **N-API prebuilds**, so the same binary serves vitest's Node and
  Electron — there is no `electron-rebuild` step, and tests CAN spawn a real PTY.
- Terminals (§26, `src/main/terminals.ts` + `TerminalTab.tsx`): PTYs are owned by MAIN, so they
  outlive a renderer reload. The scrollback buffer is an **`@xterm/headless` mirror**, not a byte
  ring — one buffer, three readers: the live renderer (raw bytes), a re-attaching renderer
  (`addon-serialize`, correct even mid-TUI), and part 2's agent read (`readText`, the rendered grid
  as plain text). The tab title MUST be polled (`TITLE_POLL_MS`): `pty.process` changes with **no
  data event**, so `sleep 30` — which prints nothing — leaves an onData-driven title reading `zsh`
  forever. And a bad shell path does **not** throw from `pty.spawn`: node-pty's helper spawns fine
  and the exec fails inside it, arriving as an immediate non-zero exit, so both routes land on one
  inert state via `fail()`.
- **The terminal font field is a measured picker (`monospaceFonts.ts`), and `SF Mono` is the reason.**
  `queryLocalFonts()` works in Electron with no permission prompt but **throws `SecurityError:
  Page needs to be visible` on a backgrounded window** — hence the probed `PROBE_FAMILIES` fallback,
  and why enumeration runs from the settings page rather than at boot. It reports style but NOT
  advance width, so monospace-ness is measured (`i`/`l`/`W`), and presence is measured by comparing
  a family against TWO fallbacks. Measured on a stock Mac: 180 families → 7 monospace. `SF Mono`
  does **not** resolve from a web context at all (Apple restricts it), which is what made the old
  free-text field fail silently. Metrics cannot exclude `Wingdings 2` (genuinely fixed-width, ASCII
  as pictograms) — that is what `SYMBOL_FAMILIES` is for, and relying on the per-row preview to make
  it "obviously wrong on sight" was tried first and rejected by the user. The preview itself stays:
  it is how you choose among the fonts that DO belong, so never "simplify" the picker to a plain
  list. `fontFamily` stores a family NAME; `normalizeFamily` in the merge is the whole migration
  from the old CSS-stack value, and `fontStack` appends `ui-monospace, monospace` so an uninstalled
  font degrades to a monospace rather than to a proportional one.
- **`allFiles` (tabs.ts) means "not a chat AND not a terminal" — never loosen it to "not a chat".**
  It feeds THREE consumers: the mounted `FileTab` list, the fs watch targets (`watchTargets.ts`),
  and §9's open-files block injected into the agent's context. When it meant merely "not a chat", a
  `:term:` tab reached all three and the model was told a file named `:term:t1` was open. Pinned by
  `tests/tabs.test.ts`. Any FOURTH tab prefix must be excluded here in the same commit that adds it.
- **Agent terminals (§26 part 2): three tools over ONE blocking envelope, and main owns every rule.**
  `terminal_run`/`terminal_read`/`terminal_kill` are thin shells over `ctx.ui.input`
  (`hv.terminal-*`, payload in **`title`**); `agentTerminals.ts` holds the session→terminal claims,
  the soft cap of 3, the busy-reuse refusal and the interleave hold. `TerminalManager` stays
  session-ignorant, which is why ending a session releases a claim rather than killing a PTY.
  Three things bite in order: a **notify** carries its payload in `message`, not `title` (get this
  wrong and the card silently never appears); `tool_execution_start` fires **before** tool_call
  handlers, so it can NEVER prove a call was blocked — assert on the `hv.audit`
  `source:"terminal"` envelope instead, or the test passes either way; and all three tools must be
  **named** in `SAFE_TOOLS`/`gatePlanCall` (`terminal_read` in `PLAN_PASS_TOOLS`, because the
  `floor-ask` default clamps allow→ask and would prompt on every poll). Wire shapes: d1.md.
- **A live test failing "model never called X" is usually NOISE, not your change — and 5 trials
  cannot tell you which.** This entry used to claim §26's three terminal tools made the model stop
  calling `bash` (3/5 → 0/5). That was wrong. The comparison was five trials per cell run
  sequentially in differing app states; **3/5 vs 0/5 is p = 0.167**, never significant, and the
  tidy monotone table was binomial noise sorted by the story. Two interleaved re-runs killed it:
  with only a probe extension varying the tool list (n=8), 0 tools gave 1/8 `bash` and the three
  real tools gave **7/8** — the one significant result (p = 0.010) and it runs the OPPOSITE way;
  in the shipped config with just `builtins.terminal` toggled (n=12), off 4/12 vs on 6/12
  (p = 0.68, no effect). The model calls `bash` on roughly half of attempts at baseline, which is
  the whole reason `askUntil` exists. So: before recording any behavioural claim about a model,
  **interleave the arms and compute a p-value** — both are cheap and neither was done the first
  time. Full retraction, tables and method in docs/validation/d1.md.
- The centre tab layout is **persisted** (`config.json` `layout`, validated + pruned on restore by
  `layoutPersist.ts` — main never learns what a tab is, same division of labour as `shortcuts`).
  `activeWs` persists in localStorage beside `hv:sidebar-collapsed`: without it the layout restores
  into state and the app still renders the WELCOME screen, because `wsId` resolves through `activeWs`.
- **The renderer's CSP is `script-src 'self'`, which covers neither `blob:` NOR `data:` — so an
  AudioWorklet/Worker script must be a REAL emitted file, and Vite will silently inline it into a
  `data:` URL if it is under 4 kB.** §27's worklet hit both halves. A blob URL fails in dev *and*
  prod (`AbortError: Unable to load a worklet's module.`, with the CSP refusal only in the console);
  switching to Vite's `?url` fixes dev but a 2,171-byte file then gets inlined as
  `data:text/javascript;base64,…`, which is blocked **only in the built app** — works-in-dev,
  broken-in-release, invisible unless you read the emitted bundle. Fix is a targeted
  `assetsInlineLimit` predicate in `electron.vite.config.ts` (`false` for `voice-worklet`,
  `undefined` otherwise); the built bundle must read
  `new URL("voice-worklet-<hash>.js", import.meta.url)`. **Never widen the CSP to `blob:`/`data:`
  to make a script load** — that trades the only-bundled-code-executes guarantee for a bundling
  convenience. `tests/voice-worklet-csp.test.ts` pins the CSP, the real file, the config exclusion
  and the BUILT output (gate builds before it tests, so that arm actually runs). Corollary that cost
  the most time: the failure surfaced as a generic "Could not start recording." because the handler
  collapsed non-`CaptureError`s and threw away the message that named the problem — always surface
  the underlying `err.message`.
- Every fs writer must be path-confined (pattern: agentsMd.ts / files.ts `resolveInWorkspace`).
- Workspace paths are normalized inside WorkspaceRegistry — never compare raw path strings.
- Renderer perf invariants: streaming text stays OUT of the transcripts array
  (streamRef + rAF batching in App.tsx); tool cards update via the toolIndex map, never a full .map().
- MCP: the adapter's proxy tool is `mcp`; the bridge unwraps it (hv-mcp.ts) to a virtual rule name `mcp:<serverKey>_<toolName>` (e.g. `mcp:github_create_issue`) for rules/grants/prompts/audit; discovery calls (search/describe/connect) are safe-default-allowed. Config is read at spawn; changes are applied live by respawning affected sessions (see MCP live-reload below). stdio servers configured with `node`/`npx` need a runtime in the packaged app (same class as the pi-subagents shebang item). See docs/validation/m1.md.
- MCP management (connect/list-tools/status) lives in main (`src/main/mcp*.ts`, `@modelcontextprotocol/sdk`), NOT the adapter — the adapter's OAuth is hard-gated on `ctx.hasUI` (no-op in RPC), and its structured headless actions are tool-only (no tool-exec verb in Pi RPC, so neither main nor the bridge can call them). Main and adapter share only the on-disk token store `<agentDir>/mcp-oauth/sha256-<sha256hex(serverName)>/tokens.json` (AuthEntry). A non-blocking startup sweep probes all configured servers.
- MCP OAuth is host-driven in main (`src/main/mcpOAuth.ts`): `OAuthClientProvider` + loopback callback + `shell.openExternal` + `state` CSRF check + `transport.finishAuth` + fresh transport reconnect. Tokens written as `AuthEntry` (stamped `serverUrl`) so the adapter reads them at runtime. IPC: `hv:mcp-authenticate` / `hv:mcp-logout`. Add-time confirm-with-tools modal; per-server Authenticate / Log out; startup status sweep. Contract test `tests/mcp-adapter-authformat.test.ts` must pass on any pi-mcp-adapter pin bump. See docs/validation/m1.md.
- MCP intent: `mcp` is in `INTENT_TOOLS` (happyvibe-bridge.ts) — `requireIntent` injects a required `intent` into the adapter's proxy schema, so the model authors a customer-facing headline per MCP call (toolLabel.ts mcp case = `intent ?? unwrapMcpCall().display`). Proxy mode: the proxy `execute` ignores the top-level intent (not forwarded to the server). DIRECT MODE: the direct executor forwards params VERBATIM, so `requireIntent` also injects intent into every adapter-registered direct tool (`sourceInfo.path` contains pi-mcp-adapter) and the bridge's `tool_call` handler STRIPS `input.intent` for those tools before anything reads input (Pi's mutable-input hook; `strippedIntentTools` set). UI still sees intent — `tool_execution_start` fires with original args BEFORE tool_call handlers. Server tools with their own `intent` param: no injection, no strip. The permission prompt uses the FACTUAL `unwrapMcpCall().display` (now enriched with a key arg like url/query), NOT the model's intent (safety). `unwrapMcpCall` is the single source for that factual display (gate + renderer). Unit contract: tests/intent-direct-tools.test.ts. **`requireIntent` also runs on `turn_start`, not only `session_start`** — pi-mcp-adapter >=2.17.0 re-registers the `mcp` proxy tool whenever its DESCRIPTION changes (`syncProxyTool` → `registerProxyTool`), and each registration builds a FRESH `Type.Object`, silently discarding the injected `intent`. Symptom when this regresses: `tool_execution_start.args.intent === undefined` and `mcp-bridge.test.ts` fails FAST (~4 s, not the ~136 s askUntil signature). Re-applying per turn is free because requireIntent early-continues on already-wired tools.
- MCP secrets can EXECUTE: pi-mcp-adapter >=2.17.0 resolves any env/header value in mcp.json via `resolveCommandSecret` — a leading `!` means "run this as a shell command and use stdout as the secret" (`spawnSync(..., {shell:true})`), `!!` escapes to a literal `!`, and anything else is plain `${VAR}` interpolation (our catalog's path). This is a code-execution surface reachable from a WORKSPACE `.mcp.json`, i.e. from a cloned repo. Pinned by tests/mcp-adapter-interpolation.test.ts.
- MCP live-reload: Pi/the adapter read MCP config only at spawn (no live tool-reload API). So `hv:mcp-set-server`/`hv:mcp-authenticate`/`hv:mcp-logout` call `scheduleMcpReload` (debounced, coalesces add+auth) → respawn affected live sessions RESUMED (`startClient(meta,true)` — the hibernation path; conversation preserved via the session file). Scope: global change → all live sessions, workspace change → that workspace's (`affectedSessionIds`, `mcpReloadScope.ts`). Only IDLE sessions (`activity.isIdle`) reload immediately; busy ones defer via `pendingMcpReload`, drained on `agent_end` / permission-prompt close. A respawn RESETS that session's in-memory `sessionGrants` + dangerous mode to safe defaults (`hv:session-reloading` → renderer notice). After respawn, main fires `/hv-tools` to refresh the displayed tool list.

- Plan Mode (§23, `hv-plan.ts` + bridge + `src/main/plans.ts`): per-session read-only mode. The
  `gatePlanCall` clamp runs in the tool_call handler BEFORE the dangerous/bypass check and the rule
  engine — plan mode wins over bypass. plan_complete/plan_start/plan_status_update are in `SAFE_TOOLS`
  (hv-rules.ts) so they never raise a permission prompt (they're app-internal control tools, not
  side effects) — forgetting this makes plan_complete hang on a permission modal that auto-denies.
  The plan is a workspace file `.agents/plans/NNN-slug.md` written by MAIN (path-confined, numbering
  serialized) — the bridge only gets the path back via the BLOCKING hv.plan-write input round-trip
  (main must ALWAYS respondUi, error string on failure, else the bridge hangs). Plan state
  `{enabled,planPath}` persists via appendEntry and is restored + re-emitted (hv.plan notify) on
  session_start — SURVIVES respawn, unlike dangerous mode. `.agents` is in files.ts DOTFILE_ALLOW so
  plans show in the tree + the watcher pushes hv:plan-changed for live n/m checklist progress. Implement/
  exit/reopen are human-only IPC (no plan_off tool) — the security invariant.
- Skills (§14, `src/main/skills/` + `hv-skills.ts` + bridge): trust gate = spawn with `--no-skills`
  (kills Pi's own discovery) + `--skill <dir>` per approved skill (additive — the ONE Pi behavior the
  whole model rests on; pinned by `tests/skills-contract.test.ts`, part of the pin-bump gate, see
  docs/validation/sk1.md). Main resolves approved ∩ enabled ∩ active-for-workspace and writes the
  per-session manifest to `HV_SKILLS_FILE`; the bridge only REFLECTS it (never re-derives trust) to
  serve `use_skill`, detect raw SKILL.md reads (fallback path), and report context weight. Bundled
  starter skills are pre-approved but `enabled:false`; a bundle hash bump re-approves while KEEPING
  the user's on/off. Scopes: `<agentDir>/skills` (managed) + `<runtimeDir>/skills` (bundled) + linked
  dirs (global), `<workspace>/.agents/skills` (workspace).
- Prompt templates (§24, `src/main/promptTemplates/` + `hv-prompt-templates.ts` + bridge): the skills
  model one axis simpler — a prompt template is one `.md` FILE, so approval is per file
  (`--prompt-template <file>`, never a directory: Pi accepts a dir but then approving a folder
  would approve whatever lands in it later). `--no-prompt-templates` already ships unconditionally.
  Two skills concepts are deliberately ABSENT: `scriptCount` (replaced by a `` !`bash` `` risk pill,
  the CC feature Pi silently drops) and `loadable`/`error` — **a description-less prompt template still
  loads**, Pi falls back to the first body line at 60 chars. **The bridge does no gating and there
  is NO manifest** — Pi expands templates itself, so resting context cost is zero and prompt templates are
  excluded from the gauge. Scopes: `<agentDir>/prompts` + `<runtimeDir>/prompts` + linked dirs
  (global), `<workspace>/.agents/prompts` (workspace) — exactly one workspace root, mirroring
  `.agents/skills`. `.claude/commands` is NEVER auto-scanned in either scope (2026-08-03): the app
  does not reach into another tool's directory unasked, so a user imports or links it. Evidence:
  docs/validation/pt1.md.
- **A prompt template whose name collides with a `/hv-*` command is silently unreachable.** Pi matches
  extension commands and RETURNS before template expansion (`agent-session.js:799-806`), yet the
  file still appears in `get_commands` as `source:"prompt"` — so it looks installed and never runs.
  Hence the `shadowed` status and the import refusal. `RESERVED_SLASH_COMMANDS` is pinned by
  `tests/prompt-templates-reserved.test.ts`, which DERIVES the truth by scanning the bridge's own
  `registerCommand` literals — add a new `/hv-*` command and that test tells you.
- **The bridge's `input` hook sits in front of EVERY user prompt and must fail OPEN.** It exists
  only to capture the typed text before Pi expands a template over it (Pi keeps the expansion alone,
  `agent-session.js:867-875`, so the transcript otherwise shows the typed text when idle and the
  expansion after a reload — same keystrokes, different history). Pi already wraps input handlers
  (`runner.js:933-955`) and `undefined` continues; only `{action:"handled"}` swallows a prompt. The
  bridge wraps its own body too. `tests/prompt-templates-bridge.test.ts` asserts a plain non-slash prompt
  still completes BEFORE it asserts the feature — if that is red, revert the hook, not the test.
- Resource gate: spawn passes `--no-extensions --no-prompt-templates --no-themes` beside
  `--no-skills` — ALL FOUR of Pi's auto-discovery tiers are deny-by-default, because `bash` is the
  one fs writer that is not path-confined, so an approved bash command can plant a bare `.ts` in
  `<agentDir>/extensions/` that loads with full extension privileges (tool_call handlers — the
  gate's own surface) on every future session. All four flags are ADDITIVE: `-e`, `--skill` and
  `--prompt-template` still load, which is what keeps the bridge/adapter/subagents alive — if a pin
  bump made `--no-extensions` absolute the app would silently lose its whole permission layer at
  spawn. Pinned by `tests/resource-gate-contract.test.ts` (pin-bump gate, key-free; its UNGATED arm
  exists so the negative assertions can't pass vacuously). `--no-context-files` is deliberately NOT
  passed (AGENTS.md loading is wanted). See docs/validation/sk1.md.

## Docs workflow
Locked product decisions go to BOTH the Notion PRD and docs/prd.md in the same session,
folded in place with the "Decision (…)" convention. Never rewrite user-authored documents wholesale.
