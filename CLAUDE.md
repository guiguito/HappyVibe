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
- **Which model the live tests use is decided in ONE place: `tests/liveModel.ts`.** It loads `.env`
  and resolves, first usable key wins: `OPENROUTER_API_KEY` → `openrouter` /
  `deepseek/deepseek-v4-flash` (the floating "latest" alias; the dated snapshot is `-0731`), else
  `DEEPSEEK_API_KEY` → `deepseek` / `deepseek-v4-flash`, else `KEY` is undefined and everything
  skips. Live files import `{ KEY, MODEL, PROVIDER_ENV }` from it — never re-inline a provider, a
  model id or an `.env` loader (16 files each carried their own copy, which is how one dead account
  produced 4 failures that read as a 0.50 regression). OpenRouter is preferred because it can be
  topped up without touching a provider account. Measured 2026-08-17: Pi accepts
  `--provider openrouter --model deepseek/deepseek-v4-flash` and a bogus key returns OpenRouter's
  own `401 User not found`, so the route is proven independently of any balance. Pricing is
  ~$0.08/M in, $0.17/M out — a full serial batch costs pennies. Resolver pinned by
  `tests/live-model.test.ts`.
- Live-Pi tests (real model via the resolver above, skipIf-gated) — **17 files** as of
  2026-08-16 (was 14; browser-bridge, terminal-bridge and git-message joined since).
  Source of truth = `grep -rl "skipIf(!KEY" tests/` — RE-DERIVE IT, never trust a list in prose.
  The count in this file has drifted twice; the grep has not.
  Note git-message is the odd one out: it is the only live file that is not a BRIDGE test —
  §29's "Write it for me" is a one-shot `pi -p` call, so it exercises the print-mode path
  (`titles.ts`'s pattern) rather than the RPC one.
  Canonical invocation: `npm run test:live`
  (= `grep -rl 'skipIf(!KEY' tests/ | xargs npx vitest run --no-file-parallelism`)
  Run it only when `npm run live:why` prints something — that prints the changed files which
  are Pi-facing (`pi-runtime/extensions/`, `src/main/pi/`, or a live test file). Empty output
  means the batch is not required; SAY so, don't silently omit it.
  **It diffs `main...HEAD`, so it only sees COMMITTED work** — staging a pin bump and asking is
  silence, not a green light, and `git add` does not change that. Check it after the commit that
  carries the change, not before (this reads as "the gate script regressed" if you forget).
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
- Non-live suite = `npm test`
  (= `DEEPSEEK_API_KEY=sk-REPLACE OPENROUTER_API_KEY=sk-REPLACE vitest run`). No exclude list:
  the resolver treats an `sk-REPLACE` key as ABSENT for either provider, and its `.env` loader only
  fills vars that are UNSET — so the shell value wins and every live file skips itself.
  **BOTH vars must be neutralised.** Setting only the DeepSeek one meant that the day an
  OpenRouter key landed in `.env`, `npm test` would silently stop being the non-live suite: 25-40 s
  becomes ~6 min and starts spending money, with nothing in the output saying so. Verified in both
  directions (`tests/live-model.test.ts` plus an end-to-end check that `npm test` still skips with a
  real-looking key exported in the shell). This is exactly what CI runs (CI has no key at all), and it is STRICTLY MORE than
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
  relative form, the exports map, and the three fields. Bumped 0.34.0 → 0.40.0 on 2026-08-02,
  0.40.0 → 0.50.0 on 2026-08-17, 0.53.0 → 0.58.0 on 2026-08-28. At 0.58 the map lists **13** subpaths
  (11 at 0.50) and `./shared-types`
  looks like ASYNC_DIR's home but re-exports TYPES ONLY — re-derive, never hand-list.
- **Two PRD §12 invariants are enforced by matching an upstream NAME or SHAPE, and 0.40.0 broke
  both silently — no test failed.** (1) The "never block on a delegation" guard matched the literal
  `"wait"`; 0.35.0 renamed the tool `subagent_wait` with no alias. Both names now live in
  `WAIT_TOOLS`/`isWaitTool` (hv-rules.ts), imported by the bridge (blocks the call) AND the renderer
  (hides the card) — never re-inline a literal. (2) The subagent card read the child transcript from
  `tool_execution_update…results[].messages`; 0.40.0 sets it `undefined` and substitutes compact
  `toolCalls` (same commit as the deep-fan-out protocol-limit fix). Renderer maps `toolCalls` → the
  same rows and renders `finalOutput`. Both pinned in `tests/pi-subagents-contract.test.ts` +
  `agents-renderer.test.ts`; wire shapes in docs/validation/d1.md.
  (3) 0.50 **redacts the delegation `task`/`goal` to `"[prompt redacted]"` on every surface an
  observer reads** — the lifecycle events, `status.json`'s `steps[].description`, metadata, the
  child's input artifact — unconditionally (`statusStepDescription` ignores its own argument; no
  config, no env). The child still gets the real task, so only DISPLAY breaks. Nothing can hand a
  caption back, so `hv-subagent-tasks.ts` remembers it from the bridge's own `tool_call` and
  PERSISTS it (a respawn has no args event and no on-disk task). One slot per agent,
  last-write-wins — **not** a queue: a DENIED delegation also passes through `tool_call`, and a
  queue would caption the next same-agent run with the refused task. `REDACTED_PROMPT` lives in
  hv-rules.ts beside WAIT_TOOLS (the renderer cannot import a vendored package) and the contract
  test asserts our copy still equals upstream's constant.
- **A delegation was a WORKFLOW at 0.50-0.53 and is `mode:"single"` again from 0.55 — the card
  survived both because it is keyed off `asyncId`, not off the mode.** At 0.50 `details.mode` was
  `"workflow"` with a `missionId` even for one child, and that silently removed the run card:
  the workflow path emits `subagent:async-complete` but **NEVER `subagent:async-started`**
  (measured twice with a `console.error` inside the bridge's own handler), and the sticky card was
  raised by that notify — so an async delegation showed the user NOTHING for its whole life and
  then dropped a result in, the inverse of PRD §12 and with no test covering it. The card is
  RE-KEYED from the foreground one at `tool_execution_end` (`details.asyncId`, measured
  `=== details.runId === the complete notify's runId`), which needs no notify.
  **0.55 then unwrapped single-child launches again** ("run public single-child launches directly…
  so async external-job agents do not show a completed workflow"), so at 0.58 an async
  `{agent, task}` delegation returns `details: {mode:"single", runId, asyncId, asyncDir, …}`
  (`async-execution.ts:1967`) and only a real multi-child `workflowScript` is `mode:"workflow"`.
  **The re-key stays load-bearing, but not for the reason first recorded.** `subagent:async-started`
  IS emitted at 0.58 (`async-execution.ts:1413`, `:1940`) — an earlier note here claimed nothing
  emits it, from a grep for the literal string that only matched the constant's definition while
  every emitter references `SUBAGENT_ASYNC_STARTED_EVENT`. What was measured behaviourally at 0.50
  was narrower and still true: the WORKFLOW path never emitted it. 0.55's single-child unwrap put
  delegations back on the direct async path, which does. The re-key still matters because the
  notify cannot caption a card correctly — it carries no `toolCallId`, so two same-agent
  delegations in one turn are indistinguishable there (see the caption entry below).
  `agent` on the completion event was the literal `"workflow"` at 0.50 (the bridge drops it, or the
  hand-off notice names a pipeline the user never chose); the drop is harmless now that the real
  name comes through. **Async is upstream's own default** — a run with no `asyncByDefault` config
  still detaches.
- **Upstream ships 13 builtin agents from 0.58 (was 7), and SIX of them are opaque — we refuse
  them.** `claude-code`, `claude-code-writer`, `codex-exec`, `codex-exec-writer`, `cursor-agent`,
  `cursor-agent-writer` are all `runner: {type: external-cli}`: a third-party CLI in its own
  process, so the capability ceiling cannot bound it, the child guard cannot run inside it, and its
  tool calls never reach the audit log (upstream refuses ask/deny for external runners by design).
  They arrive DELEGATABLE with the pin, `-writer` variants included, so §12's three layers would
  have quietly stopped being true for six agents the model can pick itself.
  **Enforcement is `EXTERNAL_CLI_AGENTS`/`isExternalCliAgent` (hv-rules.ts), checked by the bridge
  BEFORE `resolveBoundary`** — that call also WIDENS the session ceiling, and a grant for an agent
  nothing can hold to it is worse than no grant. It cannot live in upstream's settings file
  instead: a PROJECT-scope `.pi/settings.json` override beats the user scope OUTRIGHT
  (`agents.ts:1340` returns on the project override before it ever reads the user one), so a cloned
  repo could re-enable one. `writeSubagentSettings()` (config.ts + the pure `subagentSettings.ts`)
  is HYGIENE only, keeping them out of the injected roster — and its key is **`agentOverrides`,
  NOT `overrides`**: pi-subagents parses the former INTO a field it calls the latter, so the obvious
  spelling is a silent no-op. Never `disableBuiltins: true` — all-or-nothing, and it would also
  remove `worker`/`reviewer`. The refusal set is DERIVED from upstream's own frontmatter in
  `tests/pi-subagents-contract.test.ts`, so a seventh adapter fails there rather than arriving
  ungoverned. Turning any of them on is a product decision (an explicitly marked boundary
  exception in the delegation modal), never a side effect of a pin.
- **`happyvibe-bridge.ts` is in NEITHER typecheck include list, and that hid a real bug.**
  `tsconfig.node.json` lists only the pure `hv-*.ts` modules, so TS never checks the bridge — which
  is how `const summary` came to sit AFTER three §12 refusal paths that audit with it, a
  temporal-dead-zone `ReferenceError` TS would normally reject outright. It failed CLOSED (Pi's
  `beforeToolCall` re-throws as *"Extension failed, blocking execution"*, and `emitToolCall` has no
  try/catch of its own — unlike `emitUserBash`/`emitContext` right beside it), so the boundary held;
  but a refusal surfaced as an extension crash with NO `hv.audit` row instead of a clean denial
  naming its reason. Fixed 2026-08-28 by hoisting one line, pinned by source order in
  `tests/subagent-external-agents.test.ts`. **When editing the bridge, assume the compiler is not
  watching** — declaration order and undefined locals are yours to check.
- **A respawned session is a STRANGER to its own detached runs from 0.51 — unless we claim the
  owner id first.** #1225 scopes async completion delivery to the launching Pi PROCESS:
  `notify.ts:279` refuses any `source !== "foreground"` completion whose `completionOwnerId`
  differs from the current process's, with **no config off-switch** and — unlike
  `result-watcher.ts`'s `shouldProcessResult`, which falls back to a mission-binding file when
  deciding whether to READ a result — **no fallback on the delivery path at all**. The id is a
  `randomUUID()` cached on `globalThis` under `Symbol.for("pi-subagents.completion-owner-id")`
  and minted inside pi-subagents' own registration (`index.ts:422`). At 0.50 the guard was
  session-id only, so a respawn resuming the same session file still delivered.
  `pi-runtime/extensions/hv-owner-seed.ts` claims that symbol from `HV_SUBAGENT_OWNER`
  (= `hv-<HappyVibe session id>`), and `??=` is what makes it work — upstream never overwrites a
  value already in the registry. **It must be the FIRST `-e`, which is why it is its OWN
  extension**: Pi loads extensions strictly sequentially in argv order, import + factory one at a
  time (`core/extensions/loader.js:440`), and the bridge is pinned LAST for the gate. It registers
  no tools and no `tool_call` handler, so being first cannot change what the gate sees; it is
  import-free, and `loadExtension` catches a throw rather than crashing the session. Fails OPEN
  (no env var ⇒ upstream's own id), which is right for the utility client. Measured: the refusal
  is real and the claim propagates (`status.json` reads `ownerId=hv-<id>` instead of a uuid).
  **The refusal IS reachable, and a first pass at scoping it got this wrong — the path is a FILE
  on disk, not a live process.** An async run does die with its parent Pi (see the async entry
  below), so no *process* survives a respawn to be refused. But a child that finished and wrote
  its result before the parent went away leaves that result behind, and the next session start
  scans it: `index.ts` calls `primeExistingResults()`, which routes through the same
  `scheduleResult → handleResult → notifier.deliver` path as a live completion, and therefore
  through the same owner check. Without a claimed id the resumed process never matches, and
  because a refused delivery is **retried rather than discarded** (`if (!accepted)
  scheduleResult(…, RETRY_DELAY_MS)`, with the file left un-marked) no future process delivers it
  either — every one of them mints a different random uuid. That is permanent, silent loss of a
  completed sub-agent's answer, plus a result file that never clears. So the seed is load-bearing
  for the quit-or-reload-in-the-delivery-window case, not speculative insurance. Pinned as a ROUTE
  assertion in the contract test, because the behavioural test alone would keep passing if
  upstream stopped priming on-disk results at session start. Pinned by `tests/pi-subagents-contract.test.ts` (a
  behavioural harness over upstream's real `notify.ts`, not a source scan) and
  `tests/mcp-spawn.test.ts` (load order + both env cases).
- **0.51 fixed NONE of the four things that hurt, and made one of them permanent.** The
  1,000-char completion truncation survives (`subagent-executor.ts:4194`), so the delivery repair
  stays load-bearing — re-measured working at 0.51 by instrumenting the bridge's own handlers
  (`substitution fired=true`, store keyed by the child `runId`, `results[].output` 4,098 chars).
  `PROMPT_REDACTED` is unchanged, nothing restores `subagent:async-started` for the workflow path,
  and "async workflows do not have inline `live-card` projection" was **documented as intended**
  (#1229/#1230) rather than a bug awaiting a fix — which read at the time as "the missing live
  child transcript is permanent". **That conclusion was wrong, and 0.58 disproved it**: streaming
  is back for the blocking path (see the `tool_execution_update` entry below). Read #1229/#1230 as
  scoped to ASYNC workflows, not to delegations in general. Every workaround stays. Also measured
  at 0.51: `tool_execution_update` still zero, `details.asyncId` still on the async dispatch result and
  still absent on the foreground one, `tool_execution_start` still the only event carrying `args`.
  **A blocking delegation now costs ~14.8 KB** (was 4,947–5,532 at 0.50), of which the child's own
  answer was 4,569 — the envelope alone roughly doubled; `subagent-context.test.ts` watches the
  envelope separately for exactly this reason. `defaultSubagentContext` is new and still defaults
  to `"fresh"`, and `writeSubagentConfig` now states it explicitly. `repairScan: true` is new and
  deliberately NOT adopted — the `.active-runs` upgrade hole and the stale markers remain the
  accepted decision, and #1162 exists to stop scanning. 30-day retention runs in a
  `worker_threads` worker (unref'd, 60 s after activation), so it is NOT a child process and
  carries no Dock-icon hazard.
- **`tool_execution_update` came BACK at 0.58, and the wait-for-a-pin bet paid off.** It was not
  emitted at all for a subagent at 0.50-0.53 (zero on a blocking run, zero on an async one), so
  there was no live child transcript, expanding a card showed nothing until the run ended, and
  `traceFromUpdate` was dead weight. `tests/agents-bridge.test.ts` asserted the ABSENCE so the
  restoration would be loud — and it was the single red test of the 0.58 live batch (38 updates
  where 0 were expected; 53 on the probe). **`traceFromUpdate` is live code again, unchanged:**
  the payload is still `partialResult.details.results[]`, `messages` is still absent and
  `toolCalls` is still the transcript source, so only the DELIVERY was restored, not the shape —
  the renderer needed no edit. Never assert an exact update COUNT; it tracks how chatty the child
  is. 0.58 also adds `results[].progress`, `progressSummary` (`{toolCount, tokens, durationMs}`)
  and **`transcriptPath`** — the child's own JSONL, which is where its THINKING blocks live
  (measured: real `type:"thinking"` blocks carrying the child's reasoning, so P4 item 6 is
  feasible and needs no upstream ask). Fixture in `tests/agents-renderer.test.ts`. Related trap in
  the same family: **`tool_execution_end` carries no `args`** — they are on `tool_execution_start` only, so a
  delegation must be found by correlating START→END on `toolCallId`. That one had been hiding a
  VACUOUS assertion (`undefined?.result?.details?.asyncId` is falsy, so "foreground has no asyncId"
  passed for a delegation the test never found).
- **The parent gets its child's whole answer because WE put it back — `hv-subagent-delivery.ts`.**
  Upstream truncates the completion payload at a hardcoded 1,000 chars
  (`subagent-executor.ts`, `formatWorkflowValue(v).slice(0, 1_000)`; unchanged at 0.58, no config),
  so a 4,107-char report arrived as 1,108 chars of JSON cut mid-string and the model spent FOUR
  tool calls recovering it (`subagent`, `subagent_wait`, `status`, `read`). The bridge remembers
  `results[].output` from `subagent:async-complete` and substitutes it into the injected message
  from the `context` hook — measured after: ONE tool call. Three things make it work and would
  each break it silently: the notify IS rewritable in the context hook
  (`{role:"custom", customType:"subagent-notify", content:<string>}` — probe before trusting);
  the id in that message is the **child's** run id, NOT the workflow async UUID we key everything
  else by (`results[].runId` is the join); and the message's own `details` is EMPTY, so the output
  must be captured at completion. It is NOT persisted and does NOT rewrite the session file — the
  record keeps what upstream sent, we repair what the model sees. Never "simplify" the refusals:
  an unknown header, a message naming several children, or >32 KB must all fall through untouched.
  Wire shapes + the measurements: docs/validation/d1.md §The delivery repair.
- **A blocking delegation now costs ~5 KB of context; the async one costs 1.2 KB.** Measured
  `toolResult.content`: 4,947–5,532 chars for `async:false` (the whole workflow return JSON inlined
  — launch-contract digest, extension hashes, artifact paths, usage, acceptance scaffolding,
  `childReport`) versus 1,255 for async (a `Run fan-out: n/64 used` receipt; the answer arrives on
  the triggered turn). The child TRANSCRIPT still stays out, so isolation holds — but PRD §12's
  "only the call and the final result enter the main context" is now ~5 KB a delegation on the
  blocking path. `subagent-context.test.ts` branches on the path, because **the model picks `async`
  itself and picked differently on consecutive identical runs** — never assert a bound that depends
  on which it chose.
- **Before believing ANY live-test failure at a new pin, check the account has balance.** 0.50's
  bump produced four red live tests that matched the expected inventory precisely — transcript
  gone, `asyncId` missing, no `tool_execution_update` — and all four were `402 Insufficient
  Balance`. The tells were in the assertions (`expected 0 to be greater than 0`; `a real
  delegation ran: expected undefined`): **no delegation ran at all**, so nothing about 0.50 was
  being measured. All three shapes are in fact unchanged at 0.50 and are now pinned by key-free
  source scans for exactly this reason. `curl -s -o /dev/null -w '%{http_code}'
  https://api.deepseek.com/chat/completions -H "Authorization: Bearer $KEY" -d '{...}'` costs one
  second and settles it. Full retraction: docs/validation/d1.md §pi-subagents 0.50.
- **A subagent's `tools:` list is a STRICT allowlist from pi-subagents >=0.40 — an unknown name fails
  the whole run**, with `"Agent 'x' requested unavailable child tools: …"` (its new
  `src/runs/shared/tool-availability.ts`; no such check in 0.34, which ignored unknown names).
  Pi 0.83's builtins are exactly **bash, edit, find, grep, ls, read, write** — there is NO `glob`
  and NO `list`. Both bundled agents shipped asking for `glob, list` and were silently running
  without them; from 0.40 that is fatal. Extension tools need more than a name (`subagentOnlyExtensions`
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
  Sharpened 2026-08-19, measured in Pi's own dist: the RPC uiContext is real PER METHOD, not
  wholesale. `input`/`select`/`setTitle`/`setEditorText` emit `extension_ui_request` (the bridge's
  channel), but `rpc-mode.js:152` is `async custom() { return undefined; }` — so an awaited
  `ctx.ui.custom()` panel never settles. pi-mcp-adapter 2.26.1 (#365) fixed exactly that class of
  hang by adding its own discriminator, `ctx.hasUI && ctx.mode === "tui"` (`isTuiMode` in init.ts,
  `canRenderPanel` in commands.ts) — i.e. upstream now agrees with this entry. That makes the
  pi-subagents hazard sharper, not softer: its drain still gates on BARE `ctx.hasUI`
  (`index.ts:689`), which is the only thing keeping it dormant for us, so if it ever adopts
  `ctx.mode` the drain arms and blocks every turn on its own async delegation.
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
  config.ts writes `asyncByDefault` at startup). **An async run does NOT survive its parent —
  measured in the running app at 0.51, and the opposite of what this entry used to claim.** A
  delegation's `status.json` records `pid` = **the session's own Pi process** (verified: the pid in a
  live run's status file was a direct child of the Electron main, in the app's own process group),
  and the child agent runs as an ordinary non-detached child of it. There was no detached process
  group anywhere on the machine while a real delegation ran. `async-execution.ts:521` does spawn
  with `detached: true`, so the code path exists — it is simply not the one a top-level
  workflow-mode delegation takes. Consequence: **`activity.asyncRuns` (gated in `isIdle`) is
  LOAD-BEARING, not belt-and-braces** — it is the only thing standing between an in-flight
  delegation and a hibernation/MCP-reload `manager.stop()` that would destroy it outright. Still
  resume via the session file (`startClient(meta,true)`): that is what keeps the Pi session id
  stable, which the completion path also keys on. Lifecycle is relayed off pi-subagents'
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
- **`allFiles` (tabs.ts) means "not a chat, not a terminal AND not a browser" — never loosen it.**
  It feeds THREE consumers: the mounted `FileTab` list, the fs watch targets (`watchTargets.ts`),
  and §9's open-files block injected into the agent's context. When it meant merely "not a chat", a
  `:term:` tab reached all three and the model was told a file named `:term:t1` was open. Pinned by
  `tests/tabs.test.ts`. §28's `:browser:` was excluded in the commit that added it — do the same for
  any FIFTH prefix, in the same commit, or all three consumers inherit the bug.
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
- **Embedded browser (§28): the egress gate is on the PARTITION, not on the tool call.**
  `browser_navigate` gating alone is bypassable by the page — one `location.href` from injected JS
  and the gated tool never ran. The enforcement point is
  `session.fromPartition("persist:hv-browser").webRequest.onBeforeRequest` (`browsers.ts`), deciding
  through the pure `EgressState` (`browserEgress.ts`). Main-frame navigations gate as the virtual
  rule name **`browser:<host>`** (the `mcp:<server>_<tool>` trick, so it needs no new rule
  machinery); subresources of an allowed page run silently but are all recorded for
  `browser_read_network`; redirects inherit the approval that started them, or every IdP bounce
  breaks. Three things bite: Electron **replaces** `onBeforeRequest` rather than stacking it, so it
  is installed ONCE per partition with a `webContents.id → pane` map (per-pane installation silently
  disarms every pane but the newest); `localhost` is an exact-hostname safe-default, because
  `localhost.evil.com` is a real remote host; and a gate-cancelled main frame reports
  **ERR_BLOCKED_BY_CLIENT (-20)**, NOT ERR_ABORTED (-3) — measured in the running app, after
  guessing -3 shipped a pane that said "Try again" where it should have said "Allow example.org".
  `did-fail-load` skips both codes AND re-checks `state === "blocked"`, because the state is the
  guard that survives whatever code a future Chromium picks. Honest limit, stated in §28 and not to be
  over-claimed: in-page `fetch` still reaches anything the page can — the headline is "only
  NAVIGATES where you allow", which is why `browser_evaluate` carries its own stricter rule.
- **A `WebContentsView` has no z-index relative to the DOM — hiding it IS the z-order, and the
  rule that decides when must be GEOMETRIC.** It composites over the whole renderer, so anything
  drawn "above" it is really drawn under it and swallows its own clicks. The first version matched
  `.hv-overlay`, believing every overlay carried it: **4 components do, out of ~35 floating
  surfaces** — every dropdown, the `@file` autocomplete, the file drawer, ~20 hand-rolled confirms
  and the pane divider were all dead, reported as "none of this menu is clickable". No selector
  would have saved it either: the pane `+` menu shares neither the class nor the styling nor the
  dismissal idiom of the other menus. `BrowserTab.tsx` now hit-tests a 3×3 grid inside its own rect
  (`document.elementFromPoint`, rAF-coalesced off a body MutationObserver) and hides whenever the
  topmost element at any sample is not itself — no marker to remember, and it hides ONLY when the
  thing actually overlaps this pane. The view also insets itself by `DIVIDER_INSET` on every side
  that touches another pane, which is what keeps the divider's drag strip grabbable *and* keeps
  that transparent strip out of the samples. Bounds come from a measured placeholder; the guest has
  **no preload at all** (the agent drives from main, outside the sandbox), which is also why the
  element picker is *injected* via `executeJavaScript` rather than preloaded.
- **A menu dismissed by `onBlur` loses its own clicks — act on `mousedown`.** Reported twice as
  "none of this item menu is clickable" (the pane `+` menu, `TabStrip.tsx` `NewTabButton`). The
  first cause was real — the composited browser view was over it — and fixing that did not fix the
  symptom, which is the giveaway: pressing a `<button>` does not focus it, so the wrapper's blur
  fires with `relatedTarget === null`, its `contains(relatedTarget)` guard cannot tell the pointer
  is still inside, and the menu unmounts BETWEEN mousedown and mouseup. The click lands on nothing.
  Measured with real CDP input: after `mousePressed` the menu was already gone and `activeElement`
  had fallen to BODY. Note the trap for anyone debugging this — a *synthetic* `.click()` works
  perfectly, because it never moves focus, so the handler looks fine in isolation. Items now use
  `onMouseDown` + `preventDefault()`. Every OTHER menu in the app (composer attach, ModelSelect,
  the tab context menu, FileTree) dismisses with a `fixed inset-0` click-catcher, which closes on
  CLICK and is therefore immune — this was the only blur-dismissed menu. Pinned by
  `tests/tabstrip-menu.test.ts`.
- **Portalling a dialog to the end of `<body>` does NOT put it on top.** Among POSITIONED elements
  an explicit z-index beats document order, so every `z-20`…`z-50` in the app painted above a Radix
  dialog whose z-index was `auto` — `.hv-overlay`/`.hv-dialog` were animation-only classes with no
  layer at all. Seen as the agent-terminal card (`sticky top-0 z-20`, ChatView) sitting bright and
  clickable on top of the ask-user modal's dimming scrim. Both classes now declare `z-index: 100`,
  clear of the app's scale, which tops out at z-50. `tests/modal-layer.test.ts` pins the rule AND
  scans the renderer for anything climbing to 100 — that second half is the one that rots, because a
  future `z-[200]` on some popover silently takes the crown back. Anything that must sit above a
  dialog has to BE a dialog.
- **§28 round 2 (2026-08-16): coverage is decided by RECTANGLE for EVERY floating
  surface, and the 3×3 point sample is gone.** The gaps were not an edge case, they
  were the common case: the onboarding card fell between the nine points, so did the
  pane `+` menu dropping in from the top edge (reported as a menu rendering *clipped*
  at the page's top, because the view never moved), and `elementFromPoint` is blind to
  `pointer-events: none` outright. Candidates are found with **no marker list** —
  this app is styled entirely with Tailwind, so every floating surface carries
  `absolute` or `fixed` as a literal class word, and `[class~="absolute"]` finds them
  all including the one nobody remembered to mark. `paneIsCovered` (browserCoverage.ts)
  holds the policy; the component only gathers rects. Measured at rest on a real
  window: **zero** candidates over a pane-sized rect, so it does not hide spuriously.
  The hazard it accepts, recorded because it bit once: a candidate is judged by its
  BOX, so a positioned wrapper that centres small content in a full-width box blanks
  the page (the voice pill did exactly this — `fixed inset-x-0 … justify-center`). The
  fix for that is to shrink the box, not to loosen the check.
- **"Open a pull request" creates nothing, and the `draft` flag is why it is cheap.**
  It opens the FORGE's own prefilled form in the user's EXTERNAL browser — no token, no
  auth UI, no API call, which is the only reason it clears §5/§6's GitHub fence. It
  cannot use the §28 embedded pane: that runs on `persist:hv-browser`, its own cookie
  jar, so the user is not signed in there. `hv:git-pr-url(ws, draft)` serves two
  callers and the flag is load-bearing: `false` is the ELIGIBILITY probe the renderer
  runs on every status push to decide whether the button exists, so it must never read
  a diff or call the model — without the split, publishing a branch would cost a model
  call. `true` is the click. Body is capped at 4000 chars because GitHub answers
  `414 URI Too Long` past a limit it does not document, and Bitbucket gets no
  description param because it documents none (a key that silently does nothing is
  worse than an absent one). Unrecognised host → `null` → no button, never a guessed
  URL that 404s. Shapes pinned in `tests/git-forge.test.ts`.
- **The drawer is the ONE overlay a browser pane makes ROOM for instead of hiding
  under** (§7 round 13). Nothing in the DOM can ever paint above a `WebContentsView`
  — but the view can be made SMALLER, and the drawer is a stable rectangle pinned to
  the right edge, so `paneViewRect` insets the view to end where the drawer begins and
  both stay on screen. Hiding stays right for menus and dialogs, which are transient
  and land anywhere. The inset and the coverage check MUST use the same rect
  (`effectiveRect`) or the page hides for an overlay it no longer reaches.
- **Hit-testing's old blind spots, kept because the geometry still explains them.** `document.elementFromPoint`
  ignores `pointer-events: none`, so the voice recording pill (which sets it so it never swallows a
  click) was invisible to the browser's coverage check; and nine sample points have gaps, so the
  onboarding card — bottom-right, inset 24px — sat entirely between them. Both were drawn UNDER the
  page. `BrowserTab` therefore also checks a small declared set by RECTANGLE (`.hv-overlay`,
  `.hv-dialog`, and anything portalled to `<body>`), which has no gaps and does not care about
  pointer-events. That set is not a marker every future menu must remember — the hit test still
  covers those, including ones nobody thought to mark. Geometry is pinned by
  `tests/browser-coverage.test.ts`; `data-covered` on the placeholder exposes the live decision,
  because the page is not in the DOM and there is otherwise no way to ask from outside.
  Related trap when measuring it: the check is coalesced, and **rAF is PAUSED while the window is
  occluded**, so a probe can read a state one commit stale. It now races rAF with a 200 ms timer —
  a correctness decision must not hang on a clock the platform can stop.
- **Every tab prefix must be pruned on layout restore, or it comes back as a ghost.**
  `layoutPersist.ts` drops a restored tab whose subject is gone, and `AliveSubjects` is the list of
  what "gone" is checked against. `:browser:` was missing from it, so after a restart the strip
  showed browser tabs for panes that had died with the app — two "Browser" tabs over one pane.
  Panes never survive the app (unlike a PTY, which main keeps across a renderer reload), so that
  set is normally empty at boot and every restored browser tab is pruned. Pinned by
  `tests/layout-persist.test.ts`.
- **A tool result CAN carry an image — measured, not assumed.** `AgentToolResult.content` is
  `(TextContent | ImageContent)[]` (`pi-agent-core/dist/types.d.ts:316`), so `browser_screenshot`
  hands a vision model the actual PNG. It is gated on the session model advertising
  `input: ["image"]` in Pi's registry (resolved in `ipc.ts` off `resolveSpawnModel`, never a second
  capability table); a non-vision session still gets a useful text result pointing at
  `browser_get_text`, and **the user sees the screenshot either way** via the `hv.browser` notify.
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
- **A URL in a card's `path` slot is not a path, and `resolveCardPath` is where that is decided.**
  Round 15 moved the browser URL into the same `path` field edit/write use, so ToolCard's existing
  chip renders it. The segment walk then turned `http://localhost:8000/x.html` into
  `http:/localhost:8000/x.html` — **non-null**, so the chip became a clickable "open this web page
  in the code editor" link. The guard (`/^[a-z][a-z0-9+.-]*:\/\//i` → null) lives in
  `resolveCardPath` (tabs.ts), not in the card: that function is the single place that answers "is
  this a file of ours", and every caller routes through it. Pinned in `tests/tabs.test.ts`.
- **The renderer suite has NO DOM — assert on exported data plus a source scan.** `vitest.config.ts`
  includes `tests/**/*.test.ts` only (no `.tsx`), there is no jsdom environment and
  `@testing-library/react` is not a dependency. Tests DO import from `.tsx` components
  (`tests/plan-pill.test.ts`, `tests/brand-mark.test.ts`), but only pure exports. So a visual
  contract is pinned in two halves: the mapping is exported as DATA (`STATUS_MARK`, `BADGE_MARKS`
  in ToolCard.tsx) and the ABSENCE — the words that must no longer render — is a source scan, the
  `tests/modal-layer.test.ts` pattern. This is the better shape anyway: an absence is exactly what
  a render test does not fail on.
- **"Scroll to the bottom on open" cannot be a mount effect.** Restore is async, so at mount `items`
  is empty and there is nothing to scroll past; and once a long transcript paints, the stream's
  `isNearBottom` guard is false — which is *why* reopening landed at the top. `Transcript` fires it
  once on the first NON-EMPTY render (a `landed` ref), and separately on a `scrollNonce` the
  composer bumps on send. Never widen the stream guard to fix this: that guard is what lets a user
  read back during a response.
- **A turn's duration must be measured to the last STAMPED item, not the last bubble.** Round 15
  gave `RestoreItem` tool cards a `ts` that nothing renders, taken from the tool RESULT (when it
  finished) rather than the call. Without it, a turn where the agent says "editing now" and then
  edits for 30 s reports 2 s. Live path (`App.stampTurnEnd`) and restore path
  (`restore.ts stampTurnDurations`) compute the same number two ways, because a reopened session
  has only the file. Pinned in `tests/restore.test.ts`.
- **`wouldHave` on an audit row is the ENGINE's `RuleAction`, not an `AuditDecision`.** The engine
  answers allow/**ask**/deny; a decision is allow/allow-session/deny. The first implementation
  mapped `ask` onto `allow-session` because the type had nowhere else to put it — the exact
  misreport the field exists to prevent. Related: **old audit rows keep `source:"dangerous"`**
  (round 15 renamed it `bypass` and nothing rewrites history), so `AuditView` maps both to one
  label and `analytics.ts` folds them into one `bySource` bucket. Forget the fold and one fact
  shows as two half-sized buckets either side of the rename.
- **The app's own model calls are TOKENS, never dollars (`src/main/oneShotLog.ts`).** The four
  one-shot `pi -p --no-session` callers (session titles, the AGENTS.md draft, the commit message,
  the PR draft) carry no usage record at all, so a dollar figure would have to come from a price
  table main does not have and must not grow a second copy of — §19 ruling 3's "unknown price
  rendered as a number", one surface over. They log `assistant.oneshot` (estimated tokens), appear
  as audit rows interleaved by timestamp, and sit BESIDE the Stats cost, never inside it. A test
  asserts the payload has no cost key.
- **Git (§29): the panel renders GIT's hunks, and that is not a style preference.** The tool cards
  use the js `diff` library (`diffs.ts`) and keep it — they render an edit's own before/after,
  which git never saw. But git and that library split the same change into DIFFERENT hunks, so a
  panel rendering js-diff hunks while undoing through `git apply -R` would undo a hunk the user
  never saw. `gitParse.ts` parses git's unified output, `hunk.raw` is fed back verbatim, and
  `git apply -R --check` runs first — that check IS the stale-check, not a second mechanism beside
  it. Two parser traps, both found by tests rather than by reading: the trailing `""` from
  `split("\n")` becomes a phantom context line on the LAST hunk of every diff (so its patch stops
  describing the file and every last-hunk undo refuses as "stale" — a test that undoes `hunks[0]`
  never sees it), and a porcelain-v2 rename line lists the NEW path first with the original after
  a tab. Fixtures in `tests/git-parse.test.ts` are captured from a real git, never hand-written.
- **The `.git` watch fingerprints; it cannot filter by filename.** Measured on macOS: writing one
  file under `.git/objects/ab/` reports `change ".git"`, `rename "objects"` AND `rename "HEAD"` —
  that third event is a lie, and it is exactly the one a name filter lets through, so a commit's
  object churn would run one `git status` per object. `gitWatch.ts` therefore debounces every event
  down to one comparison of HEAD's contents plus the index's mtime+size. The watch exists at all
  because `watch.ts` deliberately filters `.git` (`isVisibleEntry`), so nothing else in the app can
  see a branch switched in an outside terminal.
- **Git's idle gate covers the WORKING TREE, not "git".** Switch, stash, sync, undo, discard and
  init are blocked while any session in the workspace is busy (`activity.isIdle`, the gate MCP
  live-reload already uses) because sessions share one tree; commit, push, fetch and stage are NOT
  gated — they change history or the remote picture, never the files under the agent. A refusal
  returns `{ok:false, busy:[titles]}`, so the renderer never decides what is safe. Turn end pushes
  `hv:git-changed` with `force`, because the session is still marked busy at that instant and a
  gated push would drop the one refresh the user is waiting for.
- **The git probe caches a repo but re-asks a non-repo.** A cached "no-repo" would leave the panel
  saying "isn't tracking versions yet" forever after the user runs `git init` in their own
  terminal. Also realpath BOTH sides of the root comparison: macOS answers `/private/var` to a
  `/var` question, and a string compare calls every temp-dir repo a subdirectory of itself.
- **`tests/git-remote.test.ts` pushes to a REAL GitHub repo** (`guiguito/TestHappyVibeGit`) to
  cover what a local temp repo cannot: `publish` setting an upstream, `sync` fast-forwarding
  without a merge commit, and a diverged branch coming back `nonFF` having merged NOTHING. It
  clones to a temp dir, only ever pushes `hv-test-*` branches, deletes them in `afterAll`, and
  skips itself when that folder is absent — so CI never sees it and the user's own checkout is
  never touched.
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
- MCP management (connect/list-tools/status) lives in main (`src/main/mcp*.ts`, `@modelcontextprotocol/sdk`), NOT the adapter — the adapter's OAuth is hard-gated on `ctx.hasUI` (no-op in RPC), and its structured headless actions are tool-only (no tool-exec verb in Pi RPC, so neither main nor the bridge can call them). A non-blocking startup sweep probes all configured servers.
- **MCP credentials live in the OS KEYCHAIN, not in a file we share — main reaches them through a
  SIDECAR, and must never mirror the format.** From pi-mcp-adapter 2.17.0 the store is the OS
  keychain (service `pi-mcp-adapter.oauth`, account `sha256-<hex>`, payload chunked at 1000 chars
  behind a private manifest key, plus a Linux keyring-recovery subprocess) and
  `<agentDir>/mcp-oauth/…/tokens.json` is a **legacy artefact the adapter imports and DELETES on
  first read**. There is no opt-out. Mirroring it broke THREE ways and none were loud: the badge
  answered from a store the agent does not read (measured on a live install — `miro` fresh in our
  file, expired ten days in the keychain, so the page said `connected` about a server the session
  could not use); re-authenticating wrote a file the adapter deleted unread; and **Log out left the
  keychain credential alive, so the session stayed signed in** — as did *removing* a server.
  Main now runs the adapter's own code in a one-shot sidecar
  (`pi-runtime/bin/mcp-oauth-bridge.mjs`, spawned via `nodeExecPath()`, ops batched so the startup
  sweep costs ONE spawn). It **must be an esbuild bundle** built by `postinstall`: Node refuses to
  type-strip files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) and the
  adapter ships `.ts`; Pi has its own loader, a bare Node child does not. Reads use
  `inspectAuthForUrl` (relative import), NOT the `pi-mcp-adapter/oauth` subpath's
  `inspectMcpOAuthTokensForUrl` — the subpath narrows the entry to `tokens` and the provider also
  needs `clientInfo`, without which refresh and the stale-DCR-client guard (Notion "Client ID
  mismatch") break. `src/main/mcpAuthStore.ts` keeps PKCE + CSRF state ONLY, in **`flow.json` not
  `tokens.json`** — put it in `tokens.json` and the adapter imports and deletes the code verifier
  mid-authorization. `tests/mcp-adapter-authformat.test.ts` gates the pin bump in both directions
  and MUST set `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory`: the keychain is global to the OS user and
  `PI_CODING_AGENT_DIR` does not scope it, so an unforced test reads whatever the developer last
  signed into and writes fixtures into their login keychain.
- **Keychain access PROMPTS, and "Always Allow" only sticks for a properly signed binary — so
  nothing reads a credential at boot.** Measured (docs/validation/m1.md): `node` (the Pi child in
  dev, since `pi-node.sh` falls back off-bundle) is granted once and then reads in ~1 s silently;
  the **ad-hoc-signed dev Electron helper** — what main's sidecar runs as — re-prompts on *every*
  access, because macOS has no stable identity to record. Two intuitions that are false and cost
  hours: the binary that CREATED an item still gets prompted, and making the sidecar use the same
  executable as the Pi child fixes nothing (identity is not the variable, the signature is). So the
  startup sweep probes **stdio servers only**; remote servers sweep when the MCP page mounts
  (`hv:mcp-sweep-remote`, latched per app run) — an app must not open behind a password dialog.
  The **agent prompts too** on its first MCP call per grant, and has since 2.17.0; main was never
  in that path, so that one is a property of the pin. All of it should collapse to one prompt ever
  once the app is signed — untested, and the first thing to check when signing lands.
- MCP OAuth is host-driven in main (`src/main/mcpOAuth.ts`): `OAuthClientProvider` + loopback callback + `shell.openExternal` + `state` CSRF check + `transport.finishAuth` + fresh transport reconnect. Tokens written as `AuthEntry` (stamped `serverUrl`) so the adapter reads them at runtime. IPC: `hv:mcp-authenticate` / `hv:mcp-logout`. Add-time confirm-with-tools modal; per-server Authenticate / Log out; startup status sweep. Contract test `tests/mcp-adapter-authformat.test.ts` must pass on any pi-mcp-adapter pin bump. See docs/validation/m1.md.
- MCP intent: `mcp` is in `INTENT_TOOLS` (happyvibe-bridge.ts) — `requireIntent` injects a required `intent` into the adapter's proxy schema, so the model authors a customer-facing headline per MCP call (toolLabel.ts mcp case = `intent ?? unwrapMcpCall().display`). Proxy mode: the proxy `execute` ignores the top-level intent (not forwarded to the server). DIRECT MODE: the direct executor forwards params VERBATIM, so `requireIntent` also injects intent into every adapter-registered direct tool (`sourceInfo.path` contains pi-mcp-adapter) and the bridge's `tool_call` handler STRIPS `input.intent` for those tools before anything reads input (Pi's mutable-input hook; `strippedIntentTools` set). UI still sees intent — `tool_execution_start` fires with original args BEFORE tool_call handlers. Server tools with their own `intent` param: no injection, no strip. The permission prompt uses the FACTUAL `unwrapMcpCall().display` (now enriched with a key arg like url/query), NOT the model's intent (safety). `unwrapMcpCall` is the single source for that factual display (gate + renderer). Unit contract: tests/intent-direct-tools.test.ts. **`requireIntent` also runs on `turn_start`, not only `session_start`** — pi-mcp-adapter >=2.17.0 re-registers the `mcp` proxy tool whenever its DESCRIPTION changes (`syncProxyTool` → `registerProxyTool`), and each registration builds a FRESH `Type.Object`, silently discarding the injected `intent`. Symptom when this regresses: `tool_execution_start.args.intent === undefined` and `mcp-bridge.test.ts` fails FAST (~4 s, not the ~136 s askUntil signature). Re-applying per turn is free because requireIntent early-continues on already-wired tools.
- MCP secrets can EXECUTE: pi-mcp-adapter >=2.17.0 resolves any env/header value in mcp.json via `resolveCommandSecret` — a leading `!` means "run this as a shell command and use stdout as the secret" (`spawnSync(..., {shell:true})`), `!!` escapes to a literal `!`, and anything else is plain `${VAR}` interpolation (our catalog's path). This is a code-execution surface reachable from a WORKSPACE `.mcp.json`, i.e. from a cloned repo. From 2.26.0 there is a SECOND one: per-server `requestHeadersCommand` (#353) `spawn`s a command on every outbound Streamable-HTTP/SSE call and uses its output as headers. Both are pinned by tests/mcp-adapter-interpolation.test.ts, which also asserts HappyVibe never authors either key on a user's behalf.
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
