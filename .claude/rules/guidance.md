---
paths:
  - "src/renderer/src/components/{EmptyState,Banner,GoTo,HowItWorks,Sidebar,OnboardingDialog,OnboardingDoors}.tsx"
  - "src/renderer/src/onboarding.ts"
  - "tests/{how-it-works,empty-state,guidance,banner,goto,onboarding}*.test.ts"
---
# Guidance components (§20)

- Four shared components; each one's copy is a record with a no-dead-copy test:
  - `EmptyState` — one visual tier, the dashed box.
  - `Banner` — three tones; plan mode may not use it (it's a pill).
  - `GoTo` — labels derived from the sidebar's `NAV`, asserted against Sidebar's SOURCE.
  - `HowItWorks` — a native `<details>`, never a modal, never a nav entry.
- An `EMPTY_COPY`/`HOWTO_COPY` key with no `copy="key"` call site fails its test — don't add copy
  without a home.
- Deliberate exceptions: the sidebar session list keeps inline prose (its slot also shows "No matching
  sessions.", a search result); the global MCP page's workspace pointer stays prose (no single
  destination to link).
- `GoTo` can't be a bare `setView`: App's `navigate()` expands the Settings group and must call
  `setWsSettings` BEFORE `setView("workspace")`.
- Copy describing a gate is derived from it. `tests/how-it-works.test.ts` pins the plan-mode text
  against `BLOCKED_PLAN_TOOLS` and `buildPlanPrompt`, and the instruction-file order against Pi's
  `dist/core/resource-loader.js`: first match per directory wins (a `CLAUDE.md` beside an `AGENTS.md`
  is never read), the global file comes first, and the project's own folder is read LAST. Re-derive
  on a Pi bump — the test tells you.
