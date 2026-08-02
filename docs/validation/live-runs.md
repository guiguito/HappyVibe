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
| `@earendil-works/pi-coding-agent` | 0.83.0 | ships `pi-ai@0.83.0` (single copy since 2026-08-02) |
| `pi-mcp-adapter` | 2.17.0 | |
| `pi-subagents` | **0.34.0** | pinned — 0.35.0's exports map breaks the bridge's deep imports. See CLAUDE.md §Tests. |

## Runs

| Date | Pi | Result | Wall | Notes |
| --- | --- | --- | --- | --- |
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
