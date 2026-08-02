# HappyVibe — project context

Electron app shipping a curated distribution of the Pi coding agent (pinned, vendored)
with permission UX + context-window visibility as the differentiators.
PRD: docs/prd.md (mirror of the Notion PRD — fold decisions in place, NEVER rewrite wholesale).

## Commands
- `npm install && (cd pi-runtime && npm ci)` — BOTH installs required (pi-runtime is a separate vendored tree; fresh worktrees fail live tests without it)
- `npm run dev` · `npm test` (= the non-live suite, see §Tests) · `npm run build`
- `npm run typecheck` (node + web; passes `--composite false` — don't hand-roll the raw `tsc` calls)
- Full gate = `npm run gate` (= `build` → non-live suite, ONE command), plus `npm run test:live`
  when `npm run live:why` prints anything. `build` runs BOTH typechecks first and fast-fails on
  them, so never run `npm run typecheck` before `gate` or `build` — that is the same check twice
  and it was ~20 of the 55 typecheck runs in this repo's history.

## Tests
- Live-Pi tests (real DeepSeek; `DEEPSEEK_API_KEY` in `.env`, skipIf-gated):
  tests/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts
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
- Non-live suite = `npm test` (= `DEEPSEEK_API_KEY=sk-REPLACE vitest run`). No exclude list:
  every live file computes `KEY` as undefined when the key starts `sk-REPLACE`, and their inline
  `.env` loader only fills vars that are UNSET — so the shell value wins and all 14 skip
  themselves. This is exactly what CI runs (CI has no key at all), and it is STRICTLY MORE than
  the old exclude glob: 9 key-free tests live inside those 14 files (context-bridge ×2,
  rules-bridge ×3, agents-bridge ×2, agents-md-bridge, subagent-discovery-bridge) and the glob
  threw them on the floor. Measured: 107 files, 908 tests, 15 skipped, ~20-33 s.
  **Never add an exclude list back — the list is the thing that drifted.**
- Run live files BATCHED in one vitest invocation — they flake under the full parallel
  suite (process + LLM contention). One live failure ⇒ rerun in isolation before calling it a regression.
- **NEVER pipe a test run to `tail`/`grep`.** Two bugs in one habit: `| tail` returns *tail's*
  exit code, so a red suite reads green; and the output is gone, so looking at a different slice
  costs a whole re-run. This was the single largest time sink in this repo's history —
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
- Every fs writer must be path-confined (pattern: agentsMd.ts / files.ts `resolveInWorkspace`).
- Workspace paths are normalized inside WorkspaceRegistry — never compare raw path strings.
- Renderer perf invariants: streaming text stays OUT of the transcripts array
  (streamRef + rAF batching in App.tsx); tool cards update via the toolIndex map, never a full .map().
- MCP: the adapter's proxy tool is `mcp`; the bridge unwraps it (hv-mcp.ts) to a virtual rule name `mcp:<serverKey>_<toolName>` (e.g. `mcp:github_create_issue`) for rules/grants/prompts/audit; discovery calls (search/describe/connect) are safe-default-allowed. Config is read at spawn; changes are applied live by respawning affected sessions (see MCP live-reload below). stdio servers configured with `node`/`npx` need a runtime in the packaged app (same class as the pi-subagents shebang item). See docs/validation/m1.md.
- MCP management (connect/list-tools/status) lives in main (`src/main/mcp*.ts`, `@modelcontextprotocol/sdk`), NOT the adapter — the adapter's OAuth is hard-gated on `ctx.hasUI` (no-op in RPC), and its structured headless actions are tool-only (no tool-exec verb in Pi RPC, so neither main nor the bridge can call them). Main and adapter share only the on-disk token store `<agentDir>/mcp-oauth/sha256-<sha256hex(serverName)>/tokens.json` (AuthEntry). A non-blocking startup sweep probes all configured servers.
- MCP OAuth is host-driven in main (`src/main/mcpOAuth.ts`): `OAuthClientProvider` + loopback callback + `shell.openExternal` + `state` CSRF check + `transport.finishAuth` + fresh transport reconnect. Tokens written as `AuthEntry` (stamped `serverUrl`) so the adapter reads them at runtime. IPC: `hv:mcp-authenticate` / `hv:mcp-logout`. Add-time confirm-with-tools modal; per-server Authenticate / Log out; startup status sweep. Contract test `tests/mcp-adapter-authformat.test.ts` must pass on any pi-mcp-adapter pin bump. See docs/validation/m1.md.
- MCP intent: `mcp` is in `INTENT_TOOLS` (happyvibe-bridge.ts) — `requireIntent` injects a required `intent` into the adapter's proxy schema, so the model authors a customer-facing headline per MCP call (toolLabel.ts mcp case = `intent ?? unwrapMcpCall().display`). Proxy mode: the proxy `execute` ignores the top-level intent (not forwarded to the server). DIRECT MODE: the direct executor forwards params VERBATIM, so `requireIntent` also injects intent into every adapter-registered direct tool (`sourceInfo.path` contains pi-mcp-adapter) and the bridge's `tool_call` handler STRIPS `input.intent` for those tools before anything reads input (Pi's mutable-input hook; `strippedIntentTools` set). UI still sees intent — `tool_execution_start` fires with original args BEFORE tool_call handlers. Server tools with their own `intent` param: no injection, no strip. The permission prompt uses the FACTUAL `unwrapMcpCall().display` (now enriched with a key arg like url/query), NOT the model's intent (safety). `unwrapMcpCall` is the single source for that factual display (gate + renderer). Unit contract: tests/intent-direct-tools.test.ts.
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
