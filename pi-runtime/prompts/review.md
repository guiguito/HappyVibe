---
description: Review the current diff for bugs, risk and drift
argument-hint: "[base-ref or path]"
---
Review the changes in this repository. Scope: `${ARGUMENTS:-everything uncommitted}`.

**1. See exactly what changed.** Run `git status --short`, then `git diff` (and `git diff --staged`). If the scope above names a ref, use `git diff <ref>...HEAD` instead; if it names a path, limit the diff to it. Never review from memory of what you were asked to write — review what is on disk.

**2. Read around each hunk.** A diff hides the bug that matters. For anything whose signature, return shape, error behaviour or invariant moved, find its callers and check they still hold. For a new branch, ask what happens on the other side of it.

**3. Report findings, most important first:**

- **Bugs** — wrong behaviour, unhandled errors, races, resource leaks, security or data-loss risk. Cite `file:line`, name the input that triggers it, and say what the user would see.
- **Risk** — correct today, easy to break tomorrow: silent fallbacks that hide failures, an invariant now enforced in two places, a new branch with no test, an error swallowed by a bare catch.
- **Nits** — naming, dead code, stale comments. Keep this section to a few lines.

For each finding propose the smallest fix that addresses the *cause*. If the same fix belongs in a shared function rather than at three call sites, say so.

**4. Verdict.** One line: ship / ship with fixes / needs rework, and the single most important reason.

Do not edit any files — this is a review. If a group is empty, say so in one line and move on.
