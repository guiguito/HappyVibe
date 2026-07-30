---
description: Generate a context-handoff prompt to paste after /clear
argument-hint: "[extra notes to carry over]"
---

Produce a handoff prompt I will paste into a fresh session after `/clear`. Output it as
one fenced block and nothing else — no preamble, no commentary.

Gather the facts yourself; do NOT rely on your summary of this session:

1. `pwd`, current branch, `git status --short`
2. `git log --oneline main..HEAD` (all commits not on main) and whether anything is pushed
   (`git log --oneline @{u}..HEAD` — note if there is no upstream)
3. `ls docs/validation/` — name the validation doc(s) relevant to the branch's work
4. Whether `.env` exists and contains `DEEPSEEK_API_KEY` — this decides whether live-Pi
   tests can run at all, so it goes in the prompt explicitly

Then write the prompt with these sections, in this order:

- **Read first, in this order, don't skip**: `CLAUDE.md`, the relevant `docs/validation/*.md`,
  `git log --oneline -8`. End with: "Treat those as truth over anything I summarize here."
- **What was just built** — one line per commit, newest last, with the real file paths touched.
  Say plainly whether it is local-only / unpushed.
- **Verified vs NOT verified — please don't claim more than this** — two labelled lists.
  GREEN gets only what was actually run in this session with output you saw (typechecks, test
  count, build, named contract tests). NOT RUN gets everything else, and names the reason
  (missing `DEEPSEEK_API_KEY`, no GUI pass, etc.). If a change was verified by
  tests/typecheck/build alone and never driven live, say exactly that.
- **Known landmines** — repo traps that bit us this session, plus the standing ones from
  CLAUDE.md that apply to this branch.
- **Deliberate deferrals** — anything skipped on purpose, so the next session doesn't "fix" it
  silently. Point at the doc that records them.
- **Open questions** — anything I asked that you did not answer.
- Close with: "Start by reading the files above and telling me the current state you find —
  don't start editing."

$ARGUMENTS

If you cannot verify a claim, it goes under NOT RUN. An over-confident handoff is worse than
a short one.
