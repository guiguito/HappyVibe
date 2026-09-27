---
paths:
  - "src/main/{schedules,scheduleStore,scheduler,scheduleEnvelopes,pendingPrompts}.ts"
  - "pi-runtime/extensions/hv-readonly.ts"
  - "src/renderer/src/schedulesCopy.ts"
  - "src/renderer/src/components/{ScheduleDrawer,SchedulesView,MissedRunsDialog}.tsx"
  - "tests/{schedule,readonly,pending-prompts}*.test.ts"
---
# Schedules (§35)

- A scheduled READ-ONLY run is `HV_READONLY=1`, not plan mode: `/hv-plan` only exists when the
  Plan-mode builtin is on (otherwise its literal text reaches the model at FULL permissions), and plan
  mode ends in `plan_complete`, which would commit a plan file into the repo on every run.
- `hv-readonly.ts` REUSES `gatePlanCall` (same `resolvePlanVerdict`, same `hv.plan.blocked` card) and
  adds `READONLY_BLOCKED` — the plan tools plus the three schedule writers — blocked outright, since
  a prompt nobody is present to answer is a hang. The clamp runs FIRST of all gates; bypass yields
  to it. It is re-derived from the schedule at every spawn (`readonlyForSession`, ipc.ts), never
  persisted, and `const` in the bridge.
- `src/main/schedules.ts` imports NOTHING — the renderer imports it via `schedulesCopy.ts`. Anything
  filesystem-shaped lives in `scheduleStore.ts`.
- `hv:ui-request` envelopes are RETAINED for replay (`pendingPrompts.ts`): a scheduled Full run can
  raise a prompt with every window closed. A new blocking method must be in `BLOCKING_UI_METHODS`;
  only BLOCKING ones may be retained (notifies are never deleted, so the badge would climb forever).
  Replays are re-stamped via `stampPrompt` (the original window may no longer exist).
- `schedule_create`/`schedule_update` are in `SAFE_TOOLS`: their only effect is opening the drawer,
  and main refuses to write a schedule without it. `schedule_delete` is NOT safe (no second dialog).
- A schedule prompting its own run must not `index.touch` — `lastUsedAt` means "a human touched this",
  and `archivePreviousRun` reads it. Use `promptSession(..., { source: "schedule" })`.
