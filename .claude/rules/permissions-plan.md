---
paths:
  - "pi-runtime/extensions/{happyvibe-bridge,hv-rules,hv-plan,hv-readonly,hv-builtins}.ts"
  - "src/main/{plans,bypass,analytics}.ts"
  - "src/renderer/src/permission.ts"
  - "src/renderer/src/components/{AuditView,PlanCard,PermissionModal,PermissionRulesSection,PermissionsView,BuiltinTools*}.tsx"
  - "tests/{plan,permission,rules,audit,bypass}*.test.ts"
---
# Permissions, plan mode, audit

## Tool lists
- Every new registered tool must be NAMED where it belongs: `SAFE_TOOLS` (hv-rules.ts) for
  app-internal control tools that must never prompt, and `gatePlanCall` for plan mode. The
  `floor-ask` default clamps allow→ask, so a read tool that is polled must be in `PLAN_PASS_TOOLS`
  or it prompts on every poll.
- Session grants and dangerous mode are in-memory: any respawn (MCP reload, hibernation wake) resets
  them to safe defaults.

## Plan mode (§23, `hv-plan.ts` + bridge + `src/main/plans.ts`)
- Per-session read-only mode. `gatePlanCall` runs BEFORE the bypass check and the rule engine —
  plan mode beats bypass.
- `plan_complete`/`plan_start`/`plan_status_update` are in `SAFE_TOOLS`; without that,
  `plan_complete` hangs on a permission modal.
- The plan is a workspace file `.agents/plans/NNN-slug.md` written by MAIN (path-confined,
  numbering serialized). The bridge gets the path back through the BLOCKING `hv.plan-write` input
  round-trip, so main must always answer (an error string on failure).
- Plan state `{enabled, planPath}` persists via `appendEntry` and is restored and re-emitted
  (`hv.plan` notify) on `session_start` — it survives a respawn, unlike dangerous mode.
- `.agents` is in files.ts `DOTFILE_ALLOW`, so plans show in the tree and the watcher pushes
  `hv:plan-changed` for live checklist progress.
- Implement / exit / reopen are human-only IPC — there is no `plan_off` tool. Security invariant.
- `/hv-plan` is registered only when the Plan-mode builtin is on; with it off, the literal text
  reaches the model at FULL permissions (why schedules use `HV_READONLY` — `schedules.md`).
- `buildPlanPrompt`'s text is pinned against `BLOCKED_PLAN_TOOLS` and `gatePlanCall` by
  `tests/how-it-works.test.ts`.

## Audit
- `wouldHave` on an audit row is the engine's `RuleAction` (allow/ask/deny), not an
  `AuditDecision` (allow/allow-session/deny) — never map `ask` onto `allow-session`.
- Old rows keep `source:"dangerous"` (renamed `bypass`; history is never rewritten): `AuditView`
  maps both to one label and `analytics.ts` folds them into one `bySource` bucket.
