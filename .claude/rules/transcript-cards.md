---
paths:
  - "src/renderer/src/App.tsx"
  - "src/renderer/src/components/{ChatView,ToolCard,Transcript,TerminalRunCard}.tsx"
  - "src/renderer/src/{restoreMap,runRail,agents,toolLabel,streaming,subagentGauge}.ts"
  - "src/main/{restore,subagentInspect}.ts"
  - "tests/{restore,run-rail,run-rail-layout,delegation-card-outcome,subagent-inspect-card,agents-renderer}.test.ts"
---
# Transcript and tool cards

## Async delegation cards
- An async dispatch's `tool_execution_end` carries a receipt (`details.asyncId`, no `results`). The
  run finishes later on an `hv.subagent` `complete` notify with the runId and NO toolCallId.
  `App.tsx`'s `asyncCards` (`asyncId → toolCallId`, per session) is captured at that end event —
  nothing else ever holds both ids again. The notify's `summary` (capped at 500 chars in the bridge)
  is the collapsed line.
- The expanded card reads `window.hv.subagentInspect` — no model turn, works after delivery, and
  answers `foreign_session` after a respawn, which the card must NAME rather than spin on.
- A RESTORED card needs the id as a structured FIELD: it's read from the message's `details` sibling
  and carried `restore.ts` → `restoreMap.ts` → `ToolCardData.asyncId`. Never parse it back out of the
  flattened text. `asyncResultInfo` stays structured-only (teaching it the restore shape re-opens the
  frozen "running in the background" card).
- `restoreMap.ts` drops, silently, any field main sends that isn't NAMED there.
- Pre-switch `subagent` cards: `isSubagentQuery` asks one bounded question — does the call carry
  `agent`/`task`/`workflowScript`/`workflowScriptPath`/`chain`/`tasks`? If not, it's machinery and
  draws no card. Empty/absent args must stay NOT-a-query (end events carry no args). The fallback
  copy is "a subagent". `tests/agents-renderer.test.ts`.

## Run rail
- The overlay is `absolute` inside a `sticky` wrapper that carries `relative`; it stays z-20; no
  `fixed inset-0` click-catcher (dismiss = toggle the same avatar + Escape); the hover readout has NO
  gap between circle and panel, or the STOP inside is unreachable. Avatar hue is an inline `style`.
- A card the rail opens is ALREADY EXPANDED, with ✕ instead of a chevron: `DelegationRunCard` has
  `const open = true`; the terminal card mounts `LiveTerminal` unconditionally; header titles are
  inert `<span>`s. ✕ calls `onClose` (back to the circle) — NOT a stop. A promoted
  (`needs_attention`) card gets no `onClose`: it has no circle to return to.
- Policy in `runRail.ts` (`tests/run-rail.test.ts`); geometry and absences in
  `tests/run-rail-layout.test.ts`.

## Transcript
- Scroll-to-bottom on open fires on the first NON-EMPTY render (a `landed` ref) and on the composer's
  `scrollNonce` — never a mount effect (restore is async), and never by widening the stream's
  `isNearBottom` guard (that guard lets the user read back mid-response).
- A turn's duration runs to the last STAMPED item (tool cards carry the result's `ts`), computed live
  (`App.stampTurnEnd`) and on restore (`restore.ts stampTurnDurations`). `tests/restore.test.ts`.
- ToolCard's visual mapping is exported data (`STATUS_MARK`, `BADGE_MARKS`) so tests can pin it.
