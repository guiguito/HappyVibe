---
description: Small feature, end to end — branch, TDD, automated gate, UI pass, commit, stop for /land
argument-hint: <short feature description>
---

Build this small feature: $ARGUMENTS

Seven phases, in order. **Stop at the first failure** — report it, don't work around it. This
command owns the sequencing and the gates only; the details live where they already live
(`CLAUDE.md`, `.claude/commands/uicheck.md`, `.claude/commands/devdoctor.md`). Read them rather
than trusting a copy — a duplicated test list already drifted across four worktrees once.

### 0. Read, scope-check, THEN branch
Read before you create anything — no branch, no files, until this passes. Read the code the
feature would touch, plus `docs/prd.md` and the existing tests for that area.

Two things come out of that reading:

**(a) Is there anything to do at all?** With `file:line` evidence: **already built** → say so,
show the code, stop. **Already decided the other way** → escape hatch below. **A recorded
deferral in `docs/validation/*.md`** → not a gap; say who deferred it and why before touching
it. Wider than the immediate area? Run `/prd-audit` instead of eyeballing it.

**(b) Enough knowledge to ask good questions in Phase 1.** The existing patterns, the adjacent
decisions, the invariants — these are what turn a vague question into a sharp one. Come out of
this phase knowing which options are actually available in this codebase, not just that a
choice exists.

**Scope escape hatch — stop and say "this wants `/round`, not `/feature`" if any of these hold:**
- a `Decision (…)` in `docs/prd.md` already covers this area and the feature would **reverse**
  it (grep the PRD for the feature's nouns before anything else);
- a test exists whose purpose is to hold that decision in place (e.g. a `"…only — no X in V1"`
  assertion). Such a test can only be deleted by a product decision, and Phase 3 forbids
  bending tests to fit new code — so this is a `/round`, not a TDD loop;
- it needs a new subsystem, a new persisted-secret shape, or touches more than ~4 files.

Report the evidence (file:line) when you stop. Do not quietly grow into a worse `/round`.

Only once it passes:
- On `main`? Create `feat/<slug-from-description>` and switch to it. Never commit to `main`.
  If the branch already exists, stop and ask.
- Both installs present? (`node_modules/`, `pi-runtime/node_modules/` — see `devdoctor.md` for
  why either being absent produces unrelated-looking failures.) Run only what's missing.

### 1. Clarify — briefly, from what Phase 0 taught you
List only what is genuinely ambiguous, as a numbered list; I answer by number. Each question
carries the constraint that makes it a real question and the 2–3 options you found in the code —
not an open-ended "how should this work?". Ask nothing you could answer by reading the repo.
If nothing is ambiguous, say so in one line and continue — no interview for a one-file change.

### 2. Task list
An inline task list (todos), each task naming the files it touches and its verification step
(which typecheck, which test file, whether it needs a live-Pi run or a UI pass). No plan
document — that is `/round`'s job.

### 3. TDD loop, one task at a time
Per task, in this order, no exceptions:
1. Write the failing test. Name the file. **Run that file ALONE and show it red:**
   `npm test -- tests/<name>.test.ts`. One file is seconds; the whole suite in the inner loop is
   pure waste — §4 runs it once at the end and that is the run that counts.
2. Write the minimum implementation that passes.
3. Run that same file green.

Redirect to a log rather than piping to `tail` (CLAUDE.md §Tests) — otherwise wanting a
different slice of the output costs you the whole run again.

Never edit a test to make it pass. If a test looks wrong, stop and say so — a test bent to fit
the implementation verifies nothing. Follow the layer rules in `CLAUDE.md` (pure `hv-*.ts`
modules stay electron-free and vitest-importable; mirrored logic like `resolveModel` changes on
both sides or neither).

### 4. Automated gate — paste real output, never a summary
**`npm run gate`** — one command: typecheck (via `build`, which runs it first and fast-fails),
then the bundle, then the non-live suite. Do NOT run `npm run typecheck` before it — `build`
already did, and running both is the same check twice.

The 14 live-Pi files cost real DeepSeek calls, so they are conditional. The condition is
mechanical, not a judgement call — run it:
`npm run live:why`
- prints anything ⇒ `npm run test:live` (batched, serial, list derived at the shell).
- prints nothing ⇒ say "no Pi-facing changes, live batch not required" and move on. Say it;
  never just omit it.

Run it **once**. A green live batch stays green while the tree is unchanged — do not re-run it
to "check", and do not re-run it in `/land`.
If `DEEPSEEK_API_KEY` is absent say so and name the files that therefore skipped. **A skip is
not a pass.** One live failure ⇒ rerun that file in isolation before calling it a regression.

### 5. UI pass — only if `src/renderer/` was touched
Follow `uicheck.md` exactly: `attach {debugPort: 9222}`, **never `start_app`** (it has hung for
30 minutes here). If the attach fails, print the launch line and **stop** — I launch it, you
attach:

```
HV_DEBUG_PORT=9222 npm run dev
```

Then: screenshot the window, `get_console_messages` with `level: error`, and show me the after
picture. The feature is not done because the types pass and the tests are green — it is done
when the screenshot shows it.

### 6. Commit and hand off
- One commit on the branch, existing convention (`type(scope): imperative summary`, see
  `git log`). **Do not push.**
- Does this change user-visible behaviour? Then fold a `Decision (…)` line into `docs/prd.md`
  in this same session — in place, where the topic already lives, never a wholesale rewrite.
  Mirror it to the maintainer's Notion PRD if you have access (page id not committed here).
  Internal-only change? Say so and skip it.
- Final report: what changed, what was verified **with what output**, and what was **not**
  verified (skipped live tests, no UI pass, untested edge case). Then end with:
  "Run `/land` when you're happy."

Do not open a PR and do not merge. `/land` is the human close-out gate and it stays that way.
