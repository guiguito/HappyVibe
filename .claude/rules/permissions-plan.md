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
- Typed `/hv-dangerous on` is refused by `slashGuard.ts`; only main's `client.send` (`applyBypassLive`) and the banner's `/hv-dangerous off` reach the bridge command.
- Session grants live in the bridge but MAIN keeps a copy (`sessionGrants.ts`, fed by
  `allow-session` audit rows) and hands it back as `HV_GRANTS` on every respawn of the same session
  id; an MCP-config reload drops only `mcp:` grants; a fork/duplicate (new id) and an app quit start empty.
- The engine's safe defaults beyond `SAFE_TOOLS` (round 29): `write`/`edit` inside the workspace
  unless a path part starts with `.` or it is `AGENTS.md`/`CLAUDE.md` (`isProtectedPath`), resolved
  through symlinks via `realPath`, and only while Rewind keeps a copy of the files (`call.fileRewind`,
  `HV_FILE_REWIND=0` when the user turned it off — globally or for the workspace; a change respawns the
  workspace's sessions when idle); `bash` when `isReadOnlyShellCommand` (`hv-shell.ts` — plan mode's
  ported classifier, wrapped, never edited; refuses anything that runs project code); and, in the
  bridge, a delegation whose boundary `isReadOnlyBoundary`.
- Command rules: deny/ask match ANY part (`commandPositions`, permissive); allow needs EVERY part
  covered (`allowByParts`, strict split) — an exact no-wildcard allow is the one whole-string match.
  One-click grants go through `grantRules` (escaped); on a shell prompt `commandGrantPatterns`.

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
