---
description: Small feature, end to end — branch, TDD, automated gate, UI pass, commit, stop for /land
argument-hint: <short feature description>
---

Build this small feature: $ARGUMENTS

Seven phases, in order. **Stop at the first failure** — report it, don't work around it. This
command owns the sequencing and the gates only; the details live where they already live
(`CLAUDE.md`, `.claude/commands/uicheck.md`, `.claude/commands/devdoctor.md`). Read them rather
than trusting a copy — a duplicated test list already drifted across four worktrees once.

### 0. Guard and branch
- On `main`? Create `feat/<slug-from-description>` and switch to it. Never commit to `main`.
  If the branch already exists, stop and ask.
- Both installs present? (`node_modules/`, `pi-runtime/node_modules/` — see `devdoctor.md` for
  why either being absent produces unrelated-looking failures.) Run only what's missing.

**Scope escape hatch:** if this turns out not to be small — a new subsystem, decisions that
belong in the PRD, more than ~4 files — **stop** and say "this wants `/round`, not `/feature`."
Do not quietly grow into a worse `/round`.

### 1. Clarify — briefly
List only what is genuinely ambiguous, as a numbered list; I answer by number. Ask nothing you
could answer by reading the repo. If nothing is ambiguous, say so in one line and continue —
no interview for a one-file change.

### 2. Task list
An inline task list (todos), each task naming the files it touches and its verification step
(which typecheck, which test file, whether it needs a live-Pi run or a UI pass). No plan
document — that is `/round`'s job.

### 3. TDD loop, one task at a time
Per task, in this order, no exceptions:
1. Write the failing test. Name the file. **Run it and show it red.**
2. Write the minimum implementation that passes.
3. Run it green.

Never edit a test to make it pass. If a test looks wrong, stop and say so — a test bent to fit
the implementation verifies nothing. Follow the layer rules in `CLAUDE.md` (pure `hv-*.ts`
modules stay electron-free and vitest-importable; mirrored logic like `resolveModel` changes on
both sides or neither).

### 4. Automated gate — paste real output, never a summary
In order: `npm run typecheck` · the non-live suite · `npm run build`
(both commands are in `CLAUDE.md` §Commands/§Tests — use them verbatim).

The 14 live-Pi files run **only if** the diff touches `pi-runtime/extensions/`, `src/main/pi/`,
or one of those test files. They cost real DeepSeek calls, so they are conditional, not
automatic. Derive the list with `grep -rl "skipIf(!KEY" tests/`, run them batched in ONE vitest
invocation, and if `DEEPSEEK_API_KEY` is absent say so and name the files that therefore
skipped. **A skip is not a pass.** One live failure ⇒ rerun that file in isolation before
calling it a regression.

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
  **and** the Notion PRD in this same session, in place, where the topic already lives — never
  rewrite either document wholesale. Internal-only change? Say so and skip it.
- Final report: what changed, what was verified **with what output**, and what was **not**
  verified (skipped live tests, no UI pass, untested edge case). Then end with:
  "Run `/land` when you're happy."

Do not open a PR and do not merge. `/land` is the human close-out gate and it stays that way.
