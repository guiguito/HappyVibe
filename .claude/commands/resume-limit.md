---
description: Resume after a usage-limit reset — including the subagents that were killed
---

My limit has reset. Pick up where you left off, including the subagents.

Three things, in order. **Establish what actually happened before resuming anything** — a
limit hit truncates work mid-flight and the transcript will read as if it completed.

### 1. Find the cut
- `git status --short` and `git log --oneline main..HEAD` — what landed vs what is half-done in
  the working tree.
- Read the plan doc (`docs/superpowers/plans/`) if one is driving this work and identify the
  last task whose verification step actually ran with output you can point at.
- Scan back for subagents that died mid-task — anything that returned a limit error, returned
  nothing, or whose result you never folded into the work.

### 2. Report before resuming
Tell me, in a few lines:
- **Completed and verified** — with the evidence (test output, typecheck, file:line).
- **Claimed done but unverified** — work that exists in the tree but whose gate never ran. Treat
  this as unfinished, not done. The last thing "finished" before a limit hit is the most likely
  to be partial.
- **Killed subagents** — what each was doing and whether its work survived.

### 3. Resume
Re-dispatch the killed subagents with their original scope, finish the truncated task, then run
its verification gate. Work to the same block/task boundary I set before the limit hit — do not
widen scope because you now have budget.

If you cannot tell whether something completed, say so and ask. Guessing here silently drops work.
