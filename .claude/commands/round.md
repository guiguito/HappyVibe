---
description: Feedback round — read Notion doc, interview me, fold into both PRDs, plan, stop for Opus
argument-hint: <notion-url-or-doc-path>
---

Run a feedback round on: $ARGUMENTS

Five phases, strictly in order. **Do not skip ahead and do not touch code in any of them.**

### 1. Read
Read the doc ($ARGUMENTS — Notion URL via the Notion MCP, or a repo path). Then read
`docs/prd.md` and the current state of implementation (`git log --oneline -12`, the relevant
`docs/validation/*.md`) so you know what already exists before proposing anything.

### 2. Interview me — do not act yet
Invoke `superpowers:brainstorming`. List every feedback item you found, flag the ones that are
ambiguous, incomplete, or conflict with something already built, and ask me about those as a
numbered list. I answer by number. Stop and wait. Ask nothing you could answer by reading the repo.

### 3. Rewrite the feedback doc
Rewrite the source doc cleanly with my answers folded in — same doc, edited in place. It should
read as a coherent spec, not a transcript of our exchange.

### 4. Fold into the PRD — BOTH sides, same session
`docs/prd.md` is the in-repo source of truth — always update it. Then mirror the same decisions
to the maintainer's Notion PRD if you have access (ask me for the page, or take it from memory;
the id is deliberately not committed here). Use the existing "Decision (…)" convention and fold
each decision **in place, where the topic already lives**, so it reads as if it was always there.

NEVER rewrite a user-authored document wholesale. Edit the sections that change and leave the
rest byte-identical. (This rule exists because a past session swept the PRD and it had to be
recovered from Notion version history.) If a change is too small or too deep to belong in the
PRD, say so and skip it rather than padding.

Then state explicitly which sections you edited on each side.

### 5. Plan, then stop
Invoke `superpowers:writing-plans` and write the implementation plan to
`docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Every task names the files it touches and its
verification step (which typecheck, which test file, whether it needs a live-Pi run or a GUI pass).

Then **stop**. Do not implement. End your message with: "Plan is ready — switch to Opus and say
go." I will switch models and come back.
