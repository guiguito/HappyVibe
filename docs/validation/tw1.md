# tw1 — tintinweb/pi-subagents migration, Phase 0 (go/no-go)

Spec: Notion "tintinweb/pi-subagents — evaluation & migration plan" (§6 Phase 0).
Plan: `docs/superpowers/plans/2026-09-26-tintinweb-subagents.md` Tasks 1–4.

- Date: 2026-09-26
- Pins: Pi `@earendil-works/pi-coding-agent` 0.86.1 · `@tintinweb/pi-subagents` 0.19.0 (scratch install, not vendored yet) · nicobailon `pi-subagents` 0.64.0 (shipping stack) · `typebox` 1.3.27
- Model: `tests/liveModel.ts` → OpenRouter `deepseek/deepseek-v4-flash`
- Account: OpenRouter key live (`/auth/key` → 200), $10.90 remaining before the run

## Install facts

- tintinweb 0.19.0 depends on `@sinclair/typebox` ^0.34.49 (installs 0.34.52) and `typebox` ^1.3.7 (dedupes to our 1.3.27 — one copy).
- Its `@earendil-works/pi-ai` peer resolves to the top-level 0.86.1; it imports pi-ai for TYPES only (`grep -v "import type"` finds no value import), so there is no dual-package hazard.
- The package has no `exports` map: `package.json` `pi.extensions: ["./src/index.ts"]` — raw TS, loaded by Pi's own loader.

## Results

| # | Check (spec §6) | Hard gate | Result | Evidence |
|---|---|---|---|---|
| 1 | ping → protocol 2; bridge relays started/completed for a real background `Agent` run | yes | ✅ | `subagents:ready` → `started` → `created` → `completed` for one id; the bridge gated the call (`hv.audit` allow, rule `Agent*`); tool result `details.agentId`, `status:"background"` (scenario bg) |
| 2 | completion arrives as a follow-up message, triggers a parent turn, rewritable by the `context` hook | yes | ✅ | `custom` message `customType:"subagent-notification"`, a `<task-notification>` string with `<task-id>` = the agent id; a second `agent_end` follows (triggered turn). Rewriting it in the `context` hook reached the model: the reply ended "PINEAPPLE" (scenario rewrite) |
| 3 | `Agent` call gated by the bridge (prompt → deny, audit row) | yes | ✅ | no allow rule ⇒ `select` `{kind:"hv.permission", tool:"Agent"}` with `[Allow, Allow for session, Deny]`; answered Deny ⇒ `hv.audit` `decision:"deny", source:"user"`; no child started (scenario deny) |
| 4 | a guard in a child blocks a real child tool call and raises a prompt on the parent's UI channel | yes | ✅ | guard loaded in the child (`parentUi: true` — it reached the parent's `ctx.ui` through `globalThis`), blocked `bash`, and its `select` arrived **on the parent's stdout** (`probe.child-ask`); answered Deny; the child reported "blocked by PROBE-GUARD" (scenario guard) |
| 5 | TUI surfaces silent; nothing hangs | no | ✅ | across all 8 scenarios the only UI frames were `hv.audit` notifies (18), the MCP adapter's `setStatus` (8) and permission `select`s (4) — no widget, no FleetView |
| 6 | child session file appears during the run and is readable live | no | ✅ | `PI_CODING_AGENT_SESSION_DIR=<sessionDir>/subagents` is honoured (flat, one `.jsonl` per child); the path is reachable from the registry (`getRecord(id).session.sessionManager.getSessionFile()`) ~2 s after `started` and the file grows during the run (32,744 → 33,704 B, scenario bg) |
| 7 | with P1–P4 applied, §3.3 rows 6–10 turn ✅ | yes | ✅ | see § Gate 7 |
| 8 | their unit suite green at Pi 0.86.1; e2e failures triaged | no | ✅ (triaged) | see § Gate 8 |
| 9 | `maxConcurrent: 4` holds with 6 spawns (#352) | no | ✅ | peak 4 running; the 5th and 6th started as slots freed (t=24.4 s, 24.9 s); all 6 completed — #352 does not reproduce for background spawns, so no P7 (scenario concurrency) |

## Task 2 — the SDK names the patch depends on (key-free, verified against the installed 0.86.1)

| Name the hunks use | Verdict | Where |
|---|---|---|
| `SettingsManager.create(cwd, agentDir, { projectTrusted })` | ✅ | `dist/core/settings-manager.d.ts:133-135,173` (`SettingsManagerCreateOptions`) |
| `DefaultResourceLoader({ settingsManager })` | ✅ — and it matters: without it the loader builds its own **default-trusted** manager (`resource-loader.js:158`) and hands it to the `DefaultPackageManager` (`:160-164`), which is what `npm install`ed row 9's package | `resource-loader.d.ts:70` |
| `additionalSkillPaths` | ✅ — still loaded under `noSkills` (`resource-loader.js:330-332`), so P3(b)'s "noSkills + our manifest" holds | `resource-loader.d.ts:73` |
| `noExtensions` still loads `additionalExtensionPaths` | ✅ `resource-loader.js:316-320` | |
| `ExtensionContext.isProjectTrusted()` | ✅ | `dist/core/extensions/types.d.ts:235` |
| every `resolveModel` caller treats a `string` as an error | ✅ for tool params (`index.ts:1815` returns it as the tool result), RPC (`cross-extension-rpc.ts:131` throws), workflow (`workflow/host.ts:209`), nested (`nested-tools.ts:234`), scheduler (`schedule.ts:238`, off) | |

**Finding (accepted, not patched):** a model named in an agent FILE's frontmatter that does not resolve falls back silently to the parent's model (`index.ts:1816` "config-specified: silent fallback to parent"). Under P3-model a fuzzy name there therefore runs on the session's own model — the one the user chose — never on a cross-provider guess. Our bundled agents declare no model.

**Finding (no new surface):** `packageManager.resolve()` runs even with `noExtensions`; with the trust flag false it reads GLOBAL settings packages only — `<agentDir>/settings.json`, the same file the parent's own loader already resolves at every spawn.

## Gate 7 — the patch, measured (key-free, bogus key; harness `$S/g7/`)

Fixtures in the workspace: `.pi/extensions/evil.ts` and `<agentDir>/extensions/planted.ts` (each appends the PID to a marker file), `.pi/settings.json` `packages: ["npm:is-number@7.0.0"]`, `.pi/subagents.json` `{schedulingEnabled:true}` against our global `false`, and `.pi/agents/sneaky.md` (`extensions: [./.pi/extensions/evil.ts]`, `memory: project`, `session_dir: <tmp>/leak`). Six spawns over `subagents:rpc:spawn`: `code-explorer`, a guard-only agent, a locked agent (`extensions:false`, `skills:false`), `sneaky`, a `switched-off` agent, and `code-explorer` with the fuzzy model `deepseek`. All 17 hunks applied in one pass and a second run was a no-op.

| | unpatched | patched (`HV_HOST=1` + policy) | patched, no policy registered |
|---|---|---|---|
| evil.ts ran in the app's Pi process (row 6, 8) | ❌ 5 of 5 spawns, same PID | ✅ never | ✅ never |
| planted.ts ran (row 7) | ❌ 5 of 5 | ✅ never | ✅ never |
| `<ws>/.pi/npm/` created (row 9) | ❌ yes | ✅ no | ✅ no |
| project `schedulingEnabled` won (row 10: `schedule` param on `Agent`) | ❌ yes | ✅ no | ✅ no |
| `sneaky`'s `session_dir` honoured | ❌ yes (`leak/` created) | ✅ no | ✅ no |
| host guard loaded, knew its run | — | ✅ 4 of 4, `{agentId, type}` correct | — |
| switched-off agent refused | — | ✅ `'switched-off' is switched off on the Agents page.` | — |
| fuzzy model refused | — | ✅ `Model "deepseek" is not an exact provider/modelId…` | — |
| fail closed with no policy | — | — | ✅ every spawn `failed`: "HappyVibe: child policy missing — refusing to build a sub-agent without its guard"; zero child session files |

The parent reported `isProjectTrusted() === false` in this workspace (it has `.pi/` config and RPC has no one to ask) — and `true` in the probe workspaces, which have no `.pi/` at all. P1 inherits whichever it is; P4/P5 key on `HV_HOST`, so they never read project config either way (spec decision 6).

**One applier defect found and fixed before any commit:** the P3-refuse anchor (`assertValidSpawnCwd(options.cwd);`) occurs twice in `agent-manager.ts` (`spawn()` and the queued-start re-check at :674); the applier refused it as ambiguous, as designed — and also revealed that hunks before the failing one had already been written. The applier is now two-pass (every anchor checked before any write) and the hunk is anchored on `spawn()`'s own comment.

## Findings that change the plan

1. **Workflow progress is not in the parent session file.** A `SubagentWorkflow` tool call never appends a `subagents:workflow` entry (only the `--subagents-workflow-file` start-up path does, `index.ts:2719`). Live progress exists in memory (`onProgress`) and as a thin journal in the temp dir (`{index, key, ok, text}` per settled `agent()`). ⇒ Task 16: P6 forwards workflow progress on the bus (`subagents:workflow-progress`), and the card reads that; the journal is not a UI source.
2. **Workflow scripts and journals are written to `<os.tmpdir()>/pi-subagents-<uid>/<cwd-slug>/<parent Pi session id>/tasks/`** — outside app data, so "delete session" (§17) would leave them. ⇒ Task 14's delete/sweep also removes that directory (its path is derivable from the parent's session id).
3. **The model iterates on a workflow by `read`/`edit`-ing that temp script and re-running it with `scriptPath`.** Both edits prompted (outside-workspace ask) — the gate holds — and decision 7 already shows the full script on every run.
4. **The model's first script used the wrong `agent()` shape** (`agent({agentType, prompt})`; the API is `agent(prompt, {agentType})`) and failed fast with a clear error; it self-corrected. `workflowAgents()`'s `agentType:` literal scan matches both shapes.
5. `get_subagent_result` without `wait` returns a status block while running — harmless, no card needed beyond its label.

## Gate 8 — their shipped suite at our Pi 0.86.1

Source: `git clone --branch v0.19.0 tintinweb/pi-subagents` (the npm tarball ships no `test/`), `npm ci`, then Pi / pi-ai / pi-tui forced to 0.86.1.

| run | files | tests |
|---|---|---|
| unpatched | 6 failed / 99 passed | 16 failed / 2,112 passed / 7 skipped |
| with our 17 hunks | 7 failed / 98 passed | 17 failed / 2,111 passed / 7 skipped |

- **The 16 are the spike's 16, all harness-side:** every failing file (`e2e/workflow.e2e`, `foreground-concurrency-print-mode-e2e`, `nested-delegation-e2e`, `subagent-error-status-e2e`, `subagents-nested-print-mode-e2e`, `subagents-print-mode-e2e`) drives the real-Pi faux-model harness, whose backend decides "am I the parent?" from `context.tools` (`test/helpers/print-mode-runner.ts:213`) — and pi-ai 0.86 carries tool declarations in the transcript, so that list is empty. No product assertion is involved. Fixing the harness is ours to do if we want their e2e in our pin gate (upstream is idle); their 2,112 unit tests are usable today.
- **The one extra failure is the patch doing its job:** `agent-runner.test.ts` "passes effective cwd and agentDir to the loader and settings manager" pins `SettingsManager.create` to exactly `(cwd, agentDir)`; P1 adds `{ projectTrusted }`. The upstream PR must update that assertion. Everything else — 2,111 tests, with `HV_HOST` unset and no policy — is unaffected, i.e. **the patch is inert outside HappyVibe**, which is what makes it upstreamable.
- For the upstream PR: P1's fallback when `ctx.isProjectTrusted` is absent is `false` (fail closed, right for us); upstream may prefer Pi's own default (`true`) for pre-0.79 hosts.

## Verdict

**GO.** Hard gates 1, 2, 3, 4 and 7 are ✅; 5, 6, 8 and 9 are ✅ (8 triaged, harness-side). Nothing measured contradicts the spec; the five findings above are design corrections to Tasks 14 and 16, folded into the plan.
