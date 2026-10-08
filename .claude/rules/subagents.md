---
paths:
  - "pi-runtime/extensions/{hv-tw-*,hv-child-*,hv-subagent-*,hv-agents*}.ts"
  - "pi-runtime/agents/**"
  - "scripts/{patch-tintinweb,tintinweb-hunks}.mjs"
  - "src/main/{twChildren,subagent*,stuckRun,agents,agentsMd,config}.ts"
  - "src/renderer/src/components/{AgentsView,AgentsMdPanel}.tsx"
  - "tests/{tintinweb,subagent,agents,child}*.test.ts"
---
# Sub-agents (PRD §12) — `@tintinweb/pi-subagents`, in-process, patched

## The owned patch
- Children run IN the session's own Pi process. `scripts/patch-tintinweb.mjs` applies the hunks in
  `scripts/tintinweb-hunks.mjs` at `pi-runtime` postinstall: two-pass (every anchor checked before
  anything is written), anchor-EXACT, each replacement marked `hv-patch:<id>` so a re-run is a no-op.
  A missing or ambiguous anchor FAILS `npm ci` and writes nothing.
- Parts: **P1** a child inherits the parent's project trust · **P2** no discovery for a path-only
  extension list · **P3** the host child policy, memory/session-dir clamps, exact-model-only
  resolution (refuse, never substitute) and the refusal inside `spawn()` · **P4** a project's
  `.pi/subagents.json` is ignored · **P5** a workflow's `gate:` shell command never runs; saved
  workflows come only from the agent dir · **P6** `steer`/`workflow-stop` bus verbs plus workflow
  progress/settled events.
- Gates: `tests/tintinweb-patch-apply.test.ts` (applier + markers), `tintinweb-patch-contract` and
  `tintinweb-trust` (behaviour; the latter boots real Pi key-free and is all red unpatched), and
  `tests/tintinweb-contract.test.ts` — the pin-bump gate. A bump re-anchors the hunks; never loosen
  an anchor to make one match.
- The package has no `exports` map: `loadCustomAgents` is reached by RELATIVE import of
  `src/custom-agents.ts` (the contract test fails if an exports map appears).
- A child dies with its parent Pi process (nothing is detached), so `activity.asyncRuns` in
  `isIdle` is what stops a hibernation or MCP reload from killing a run. After a respawn,
  `/hv-subagent-list` truthfully answers "nothing running".

## Child policy — `HV_HOST=1` makes its absence FATAL
- The bridge publishes it at load on `globalThis[Symbol.for("hv:child-policy")]`
  (`hv-child-policy.ts`, import-free). The patch asks it for: `extensionPaths` (exactly
  `HV_CHILD_GUARD`, throws if unset), `skillPaths` (this session's approved manifest), `refuseSpawn`
  (the Agents page switch), `boundaryFor` (what the user approved for that agent TYPE, else the
  read-only floor) and `audit` (→ `hv.audit`, `source:"subagent"`, with agent and run id).
- No policy under `HV_HOST` → *"HappyVibe: child policy missing"*; the guard with no policy refuses
  every call.
- The guard reads WHO the child is (`Symbol.for("pi-subagents:child-spawn")`) and its boundary at
  FACTORY time — a later approval never widens a running child.
- A child's `ask` prompts on the PARENT's channel (`policy.ask` via the parent's `ctx.ui`), with
  exactly `CHILD_CHOICES` = Allow · Allow for this run · Deny. "Allow for this run" lives in the
  guard's per-child `runGrants` and dies with the run. A parent session grant is inherited only for
  `default`/`outside-workspace` asks, never over an ask RULE, and a child answer never writes a rule
  (`tests/child-prompt.test.ts`). Under `HV_READONLY` it stays a deny. While the prompt is open the
  bridge sends `{stage:"control", activityState:"needs_attention"}` (amber circle).

## Gating and discovery
- An `Agent` call gates as `subagent:<type>`. Declared tools come from the agent FILE's frontmatter
  (`hv-tw-gate.ts`), because tintinweb hands an agent with no `tools:` EVERY builtin — an undeclared
  agent is shown, approved and held as the read-only floor.
- A core tool switched off on Built-in tools (`HV_BUILTINS` `coreOff`) is refused by `guardDecision`
  FIRST — before the boundary, under bypass too, never as an ask — and `twBoundary` doesn't list it.
  The Sub-agents switch off means tintinweb isn't loaded and the bridge injects no roster.
- Discovery: `<agentDir>/agents`, `.pi/agents`, `.agents/agents` only. Upstream defaults are off:
  `disableDefaultAgents`, `fallbackSubagent: "none"` (an unknown type FAILS). Locked settings:
  `TINTINWEB_SETTINGS` (`subagentSettings.ts` → `<agentDir>/subagents.json`). The per-agent switch is
  `<agentDir>/settings.json` `agentOverrides`, read LIVE by the bridge.
- Plan mode routes `subagent` to `needs-boundary`, not blocked — a read-only explorer is the most
  useful thing a planning session can run.

## Workflows — approved as CODE
- `SubagentWorkflow` always prompts: full script, Allow · Deny, no session grant, no allow rule
  skips it (a deny rule still refuses; bypass still runs it). Blocked outright in plan mode and
  read-only runs.
- Run id `wf_…` comes from `tool_result` `details.taskId`; the patched settled event ends it; STOP
  drives `workflow-stop` and ends it WHOLE.
- `foldWorkflowProgress` yields `working`/`done`/`failed` — never `running`, because the card offers
  a per-child STOP for a running child and upstream refuses to stop a workflow's children singly.
- Scripts/journals: `os.tmpdir()/pi-subagents-<uid>/<cwd-slug>/<parent session id>/`. Delete removes
  that dir by EXACT session id; the sweep never touches the shared root (other tools use it).

## Children on disk
- Children persist FLAT under `<sessionsDir>/subagents/`; the header's `parentSession` is the ONE
  link to the parent (`twChildren.ts`) — status poll, card, cost ledger, delete and orphan sweep all
  join on it. Debug a child by reading its session file (the whole transcript). Resume goes through
  the session file (`startClient(meta,true)`), which keeps the Pi session id — and the link — stable.
- Pre-switch sessions are READ-ONLY history: their `subagent` cards restore and their old layout
  (`<sessionsDir>/<stem>/`, `<sessionsDir>/subagent-artifacts/`) is still counted, deleted and swept,
  but nothing writes it. `deleteSessionChildren` (store.ts) must run BEFORE `deleteSessionFile` —
  an artifact's `_meta.json` never names its parent; only the parent `.jsonl` holds the link.
  `sweepOrphanedSubagentData` matches dirs by NAME and artifacts by REFERENCE, and abandons the
  artifact pass if any session file is unreadable. A CLOSED session is not an orphan (§19
  re-parses its children on reopen); a filename with no underscore (`.last-cleanup`) is not an
  artifact. tintinweb's half: `twDeleteChildren` / `twSweepOrphans`.

## Delivery, relay, steering
- The parent gets the child's FULL answer because `hv-subagent-delivery.ts` puts it back: upstream
  truncates the notification's `<result>`; the full text rides the `subagents:completed` bus payload
  and the context hook swaps it in (XML-escaped, keyed by `<task-id>`; not persisted). A blocking
  `get_subagent_result({wait:true})` is intercepted (`isResultWait`) — the result arrives as its own
  turn. `reportUsage` is off (§19 counts each child's session file).
- Relay: bus events → `hv.subagent` notifies (`hv-tw-relay.ts`), never RPC stdout.
- `/hv-subagent-steer <runId> <base64>` drives the patched `subagents:rpc:steer` (base64 so any
  sentence survives a one-line command), from the run card or a run PICKED in the `@` menu — typed
  text never addresses a run (`steerTarget`). Workflows are not steerable.
- A run whose last entry is a tool result or user message, with a file quiet for 10 min, turns amber
  (`needs_attention`/`no-activity`, `stuckRun.ts`) — flagged, never killed.

## AGENTS.md draft
- A normal delegation to the `agents-md-maker` sub-agent (prompted from `AgentsMdPanel.tsx`), gated
  and audited like any other. MAIN writes the draft in ipc.ts's `stage === "complete"` branch — the
  one moment it holds both `delegatedAgentByRun` and `childSessionsByRun` — reading the answer from
  the child's SESSION FILE (the only untruncated source). It must run BEFORE
  `childSessionsByRun.delete`. An async dispatch receipt carries no `results`, which is why a
  dialog-side listener can't work. `tests/agents-md-capture.test.ts`.

## Bundled agents
- `installBuiltinAgents` (config.ts) decides "did the user edit this bundled agent?" by CONTENT HASH,
  never mtime (mtime misfires both ways). Legacy `{version, installedMtime}` stamps are repaired
  toward the bundle, leaving a one-time `<agent>.md.bak`. `tests/builtin-agents-uninstall.test.ts`.
