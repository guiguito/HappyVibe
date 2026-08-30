# Live-Pi gate — run record

**Why this file exists.** Nothing automates the live-Pi suite. `.github/workflows/ci.yml` runs
`npm test` with no `DEEPSEEK_API_KEY`, so all live files **skip green** — CI has never exercised
the bridge against a real model. Without a written record there is no way to answer "has the live
gate ever passed on the current `main`?" except by spending ~7 minutes and real API credit.

**Append a row after every full `npm run test:live`.** Command and triage rules are in
`CLAUDE.md` §Tests. Do not delete rows — a red run is as informative as a green one.

## Currently vendored (keep in sync with `pi-runtime/package.json`)

| package | version | note |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | **0.84.2** | bumped 2026-08-14; forced by `pi-mcp-adapter` 2.21.2+, which peers on `pi-ai ^0.84.1` |
| `pi-mcp-adapter` | **2.26.1** | 2.25.0 → 2.26.1 with the 0.58 pass; #365 added the `ctx.hasUI && ctx.mode === "tui"` panel discriminator, and #353 a second command-execution surface (`requestHeadersCommand`) |
| `pi-subagents` | **0.58.0** | the hold was lifted in stages (0.50 on 2026-08-02, 0.51, then 0.53 → 0.58 on 2026-08-28). **This table said 0.40.0 "held" until 2026-08-30** — three bumps after the fact, which is exactly the drift the header line above is meant to prevent. Re-derive from `pi-runtime/package.json`, never from this row. |

## Runs

| Date | Pi | Result | Wall | Notes |
| --- | --- | --- | --- | --- |
| 2026-08-30 | 0.84.2 | **17/18** | 506 s | §19 "On your behalf" branch (`config_page_llm_actions`). Owed because the diff changes `tests/git-message.test.ts` — `buildDraftPrompt`/`buildPrPrompt`/`draftCommitMessage`/`draftPullRequest` all gained an `append` parameter, so the live arm is what proves the new signature still drafts against a real model. **That file is green including both live calls** (`drafts a title and a description from a real diff` 4,666 ms; the unusable-model path 954 ms). The single red, `subagent-async-bridge`, is **class A and proven so, not assumed**: it failed at **136,043 ms** — the documented 3×-exhausted-`askUntil` signature — and **passed alone in 39.8 s**, a 3.4× spread on identical code, which is this file's rule 1 exactly. It is also untouched by the diff. Two notes for whoever runs this next. First, provider: no `.env` exists in a fresh worktree, so the first attempt finished in **4 seconds with 12 of 18 files skipped and reported EXIT=0** — a green-looking run that exercised no model at all. Check the skip count, not the exit code. Second, `curl` against OpenRouter returned 200 before the batch, so the balance check this file's neighbours recommend was done up front rather than after a confusing red. |
| 2026-08-14 | 0.84.2 | **15/15** | 284 s | Pin bump for the MCP keychain fix. Took three batches to get here and every red was a distinct cause, none of them the noise class. (1) `pi-subagents` 0.49.0 red 4 files in 4–8 s — a delegation rewrite, pin **held at 0.40.0**; reverting only that pin turned all four green, which is what makes it attribution rather than a guess. (2) `terminal-bridge` survived that revert and failed again in the next FULL batch on the identical tree — rule 2 of "reading a red run", and correct: `askUntil` waited on `tool_execution_start`, which fires before the handler and before `execute`, while the `hv.terminal-*` envelope is only sent inside `execute` after a permission round-trip. Latent since the file was written; all three call sites now wait on the envelope. (3) `live:why` printed NOTHING for any of this — it watched `pi-runtime/extensions/` but not the pins, so the change that swaps the Pi binary under every live test claimed no live run was needed. Fixed. |
| 2026-08-02 | 0.83.0 | **11/13** | 401 s | Pin-bump branch. Both failures class A, **proven not assumed**: `rules-bridge` baselined on pre-bump `main` went fail→pass on consecutive runs; `bridge` went fail→pass on the branch. Both burned ~136 s = 3× exhausted `askUntil`. `mcp-bridge` failed FAST (~4 s) — that one was a real bug (adapter 2.17 re-registering the proxy tool), fixed by re-applying `requireIntent` on `turn_start`. |
| 2026-08-02 | 0.80.10 | 13/14 | 159 s | Resource-gate feature. `rules-bridge` red on the deny-audit assertion; three dev servers were up — contention, not the diff. |
| 2026-08-01 | 0.80.10 | RED | 995 s | Round 10. Causes fixed rather than retried away: no vitest config (5 s default `testTimeout`, shorter than a Pi boot) and parallel live files (concurrent DeepSeek sessions). Fixes: `vitest.config.ts`, `--no-file-parallelism`, `tests/reask.ts` `askUntil`. |

## Reading a red run

1. **`model never called <tool>`** ⇒ class A, a provider flake. Not your diff. Re-run that file alone.
2. **The failing set CHANGED between two batches of the same tree** ⇒ class A. A regression fails
   the same test every time. This is the cheapest tell — cheaper than a baseline.
3. **A fast failure (~4 s) is NOT class A.** Class A burns ~136 s exhausting `askUntil`. A quick
   red is mechanical: chase it.
4. **Check contention before blaming anything**: `pgrep -fl "npm run dev"`. A live app session is a
   third concurrent DeepSeek consumer and has turned a ~360 s batch into 995 s with three spurious
   failures.
5. Only then baseline on `main` — reinstall `pi-runtime` at main's pins, run the same file twice.

## Measured 2026-08-21 — the async-delivery wait, in batch vs alone

`subagent-async-bridge.test.ts` "async delegation returns immediately, then the result is
auto-delivered on a triggered turn" is the file's slowest-to-satisfy assertion, because after the
completion notify it still waits on a WHOLE EXTRA model turn that pi-subagents triggers to fold the
result in. Two numbers from the same tree, same commit, same key:

| Run | Result |
| --- | --- |
| Inside the full 17-file serial batch | **timeout at 136 s** |
| That file alone (`--no-file-parallelism`) | **PASS in 16.8 s** |

An **8x** spread on identical code. That is the signature this doc's rule 1 describes, and it is
worth having the numbers: the failure is not our latency (16.8 s is nowhere near any bound in the
test), it is the provider degrading after ~10 minutes of continuous serial load from the other 16
files. The test's own comment already records the same thing happening at a 60 s bound.

**Practical rule this adds:** when this specific test is the ONLY red in a batch, re-run it alone
before touching anything. If it passes in seconds, it is class A. Do not raise its bound again —
raising 60 s to 120 s bought one batch, and the next one exceeded that too; the bound is not the
variable.
