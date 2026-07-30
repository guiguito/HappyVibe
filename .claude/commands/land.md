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

### 2. Verification gate
Run the full gate and paste real output:
`npm run typecheck` · `npm test` · `npm run build`.
Live-Pi files need `DEEPSEEK_API_KEY` in `.env` — if it's absent, say so and list which test
files were therefore skipped. Do not describe an unrun test as passing.

### 3. Commit audit
Is everything committed? Untracked files that belong in the branch get committed; ones that
don't get gitignored or deleted — ask me which. Commit messages follow the existing convention
(`type(scope): imperative summary`, see `git log`).

### 4. PR + merge
Push the branch, open a PR with `gh` (body = what changed, what was verified, what was NOT
verified), then merge to `main`. Report the PR URL and the merge result.

### 5. Report
Tell me the branch is landed and whether the worktree is safe to remove. Do not remove it.
