---
description: Close out this worktree — hygiene gate, commit audit, PR, merge to main
---

Land this branch. Run the gates in order and **stop at the first failure** — report it, don't
work around it.

### 1. Hygiene gate (runs before anything is pushed)
Nothing leaves this machine until this passes.

- `git status --short` and `git log --oneline main..HEAD --stat` — review what is actually in
  the diff, not what you remember putting there.
- Scan every added/modified file in `main..HEAD` for: API keys and tokens (`DEEPSEEK_API_KEY`,
  any `sk-`/`ghp_`-shaped literal, `.env` content), local-only tooling artifacts (`.tokensave/`,
  editor state, scratch files), and absolute `/Users/...` paths that should be relative.
- Anything found: **stop**, name the file and commit, and propose either a `.gitignore` entry +
  removal from the commit, or a rewrite. Ask me before rewriting history.

This gate exists because leaked keys and `tokensave` files have gotten into commits three times
and I caught them, not you.

### 2. Verification gate — run only what CI cannot
Do **not** re-run the gate here. CI (`.github/workflows/ci.yml`) runs `npm test` + `npm run build`
from a clean `npm ci` in both trees, which is a better gate than this machine, and `/feature` §4
already ran `npm run gate` on this exact tree. §4 below does not merge until CI is green, so
nothing lands unverified. Running it a third time locally is what made testing feel endless.

CI has **no** `DEEPSEEK_API_KEY`, so the 14 live-Pi files skip there and **a skip is not a pass**.
That is the one thing only this machine can do. Check whether it applies:

`npm run live:why`

- prints anything ⇒ run `npm run test:live` and paste real output.
- prints nothing ⇒ say "no Pi-facing changes, live batch not required" and move on.

If `/feature` already ran the live batch green on this same tree, cite that run instead of
repeating it. If `DEEPSEEK_API_KEY` is absent, say so and name the files that therefore skipped.
Do not describe an unrun test as passing.

### 3. Commit audit
Is everything committed? Untracked files that belong in the branch get committed; ones that
don't get gitignored or deleted — ask me which. Commit messages follow the existing convention
(`type(scope): imperative summary`, see `git log`).

### 4. PR + merge — CI is the gate, so actually read it
Push the branch, open a PR with `gh` (body = what changed, what was verified, what was NOT
verified). Then **wait for CI and paste the result**:

`gh pr checks --watch`

**Green CI is the merge precondition.** Red ⇒ stop, paste the failing test, and report. Do not
merge, do not work around it, do not re-run it locally hoping for green.

This step exists because CI was already running and nobody looked: 11 of 30 recent runs failed,
and run `30691026840` was a *push to `main`* that went red unnoticed. Results live at
`https://github.com/guiguito/HappyVibe/actions` and on the PR.

Only then merge to `main`. Report the PR URL, the CI conclusion, and the merge result.

### 5. Report
Tell me the branch is landed and whether the worktree is safe to remove. Do not remove it.
