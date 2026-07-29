---
description: Audit what the PRD promises against what is actually built, with file:line evidence
argument-hint: "[PRD section, e.g. §14 skills — default: everything on this branch]"
---

Audit implementation against the PRD. Scope: $ARGUMENTS (default: the sections this branch's
commits touch — derive them from `git log --oneline main..HEAD`).

### How
Read `docs/prd.md` for the in-scope sections and pull out every discrete, checkable requirement
— including the "Decision (…)" clauses, which are requirements too. Then dispatch one agent per
PRD section to verify its requirements against the code in parallel. Each agent reads the actual
source; nobody reports from the PRD's own wording.

### Output — one table, no prose
| Requirement | Verdict | Evidence |

- **Requirement** — one line, quoted or tightly paraphrased from the PRD, with its § number.
- **Verdict** — `BUILT` · `PARTIAL` · `MISSING` · `DRIFTED` (built, then changed away from spec)
  · `UNVERIFIABLE` (needs a live-Pi or GUI run that cannot be done here — say which).
- **Evidence** — `path/file.ts:123` pointing at the code that satisfies it, or the specific
  absence you confirmed. A test name alone is not evidence that a feature works; a passing test
  you did not run is not evidence at all.

`BUILT` requires a file:line. If you cannot produce one, the verdict is `UNVERIFIABLE`, not
`BUILT`. Never infer a verdict from a commit message or a validation doc's own claims.

### After the table
Three short sections:
- **Drift** — where the code is right and the PRD is stale (the PRD needs the edit, not the code).
- **Gaps** — MISSING/PARTIAL ranked by whether they break a stated invariant (security and
  permission-gate requirements rank first, always).
- **Deferrals** — anything already recorded as a deliberate deferral in `docs/validation/*.md`.
  These are not gaps; list them so nobody "fixes" them silently.

Change nothing. This is a read-only pass.
