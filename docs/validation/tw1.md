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
| 1 | ping → protocol 2; bridge relays started/completed for a real background `Agent` run | yes | | |
| 2 | completion arrives as a follow-up message, triggers a parent turn, rewritable by the `context` hook | yes | | |
| 3 | `Agent` call gated by the bridge (prompt → deny, audit row) | yes | | |
| 4 | a guard in a child blocks a real child tool call and raises a prompt on the parent's UI channel | yes | | |
| 5 | TUI surfaces silent; nothing hangs | no | | |
| 6 | child session file appears during the run and is readable live | no | | |
| 7 | with P1–P4 applied, §3.3 rows 6–10 turn ✅ | yes | | |
| 8 | their unit suite green at Pi 0.86.1; e2e failures triaged | no | | |
| 9 | `maxConcurrent: 4` holds with 6 spawns (#352) | no | | |

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
