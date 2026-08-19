# pi-subagents 0.40.0 → 0.50.0 Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the vendored `pi-subagents` pin from 0.40.0 to exactly 0.50.0 with every shipped subagent behavior (async cards, resync, never-block, isolation) still working, and the contract tests re-pinned so a 0.51 bump fails loudly at `npm test`.

**Architecture:** The lifecycle skeleton is unchanged (spawn → events on `pi.events` → completion via `sendMessage`); the work is shape-level fixes. Three real changes at 0.50: lifecycle events redact `task`/`goal` (`PROMPT_REDACTED`), active-run queries read a marker index instead of scanning, and a `waitTool: {enabled:false}` off-switch exists. A probe run measures the real wire shapes BEFORE any fix is written (the standing lesson: measure the boolean, don't infer it).

**Tech Stack:** Electron + vitest; vendored Pi runtime in `pi-runtime/`; DeepSeek live tests gated on `DEEPSEEK_API_KEY`.

**Spec:** Notion "Migrate to 0.50" (page `3bfd33dfffca8028be55e442e9faa1fc`, decisions folded 2026-08-17). Wire-shape ledger: `docs/validation/d1.md`.

## Global Constraints

- Pin **exact** `0.50.0`. If 0.51 lands mid-branch, finish at 0.50.
- `@earendil-works/pi-coding-agent` stays 0.84.2, `pi-mcp-adapter` stays 2.25.0 (2.26.0 seen and deferred), `typebox` stays 1.3.7, root `yaml` stays 2.9.0. If `npm ci` moves any of these, stop.
- **NEVER pipe a test run to `tail`/`grep`.** Redirect: `npx vitest run <t> > /tmp/vitest.log 2>&1; echo "EXIT=$?"` then grep the log freely.
- Live batch is REQUIRED before landing (the pin changed → `npm run live:why` prints). Canonical: `npm run test:live` (serial, ~6 min). One live failure ⇒ rerun that file in isolation before calling it a regression.
- Never run `npm run typecheck` before `gate`/`build` (build runs both typechecks first). Never run `npm run lint`/`format`.
- Locked decisions (2026-08-17 round): accept the 2.4 upgrade hole (no migrator, no release note); `waitTool: {enabled:false}` AND keep the `WAIT_TOOLS` guard; persist a `runId → task` map so resync restores card labels; migrate imports that CAN move to 0.50's public subpaths; the string `PROMPT_REDACTED` must never render in the UI.

---

### Task 1: Pin bump + red inventory (no fixes yet)

**Files:**
- Modify: `pi-runtime/package.json` (the `pi-subagents` line only)
- Modify: `pi-runtime/package-lock.json` (via `npm ci`… actually `npm install pi-subagents@0.50.0 --save-exact` inside pi-runtime, then verify)

**Interfaces:**
- Produces: the vendored 0.50.0 tree under `pi-runtime/node_modules/pi-subagents/` that every later task reads; two red inventories (non-live, live) recorded in the worktree at `/tmp/red-baseline-*.log`.

- [ ] **Step 1: Bump the pin**

```bash
cd pi-runtime && npm install pi-subagents@0.50.0 --save-exact && cd ..
grep '"pi-subagents"' pi-runtime/package.json   # expect "0.50.0"
grep '"typebox"' pi-runtime/package.json        # expect "1.3.7" — unchanged
node -e "console.log(require('./pi-runtime/node_modules/pi-subagents/package.json').version)"  # 0.50.0
node -e "console.log(require('./pi-runtime/node_modules/typebox/package.json').version)"       # 1.3.7 — the hoisted copy must not move
```

- [ ] **Step 2: Confirm the live gate arms**

```bash
git add -A pi-runtime/package.json pi-runtime/package-lock.json && npm run live:why
```
Expected: prints `pi-runtime/package.json` (and the lock). If it prints nothing, STOP — the gate script regressed.

- [ ] **Step 3: Non-live red inventory**

```bash
npm test > /tmp/red-baseline-nonlive.log 2>&1; echo "EXIT=$?"
grep -E "FAIL|✗|failed" /tmp/red-baseline-nonlive.log | head -30
```
Expected red: `tests/pi-subagents-contract.test.ts` ONLY (its "finds an active run WITHOUT any index" case is designed to go red on this bump; other cases may also red on payload shapes). **Anything red outside that file = stop and understand before touching code.** (`subagent-runs-contract` does not exist — don't look for it.)

- [ ] **Step 4: Live red baseline (background, ~6 min — do Task 2 prep meanwhile, no tree edits)**

```bash
npx vitest run tests/agents-bridge.test.ts tests/subagent-async-bridge.test.ts tests/subagent-context.test.ts tests/subagent-discovery-bridge.test.ts --no-file-parallelism > /tmp/red-baseline-live.log 2>&1; echo "EXIT=$?"
```
Record which assertions red — this is the 0.50 acceptance baseline. Do NOT commit yet (a red suite must not land on its own commit; the pin commits with Task 3's re-pins).

### Task 2: Probe the wire — measure, then write d1.md

**Files:**
- Modify: `scripts/d1-probe-ext.ts` / reuse `scripts/d1-probe.mjs` (existing probe harness — extend, don't rewrite)
- Modify: `docs/validation/d1.md` (append a "pi-subagents 0.50 wire shapes (2026-08-17)" section)

**Interfaces:**
- Produces: verbatim captures in d1.md that Tasks 3–6 argue from: (a) the spawn tool result text (the fan-out receipt), (b) every `tool_execution_update.partialResult` for one async + one foreground delegation, (c) the three event payloads (`subagent:async-started/-complete/control-event`) including `lifecycleArtifactVersion` and the redaction, (d) the completion `sendMessage` content, (e) the on-disk `<asyncDir>/status.json` — **specifically whether `task` is redacted there too** (decides whether the Task 5 fallback ever fires), (f) whether `subagent_wait` is still registered when `waitTool: {enabled:false}` is set, and what calling it returns.

- [ ] **Step 1: Run the probe** — drive one async delegation (`subagent {agent:"code-explorer", task:"say HELLO-050 and stop"}`) and one foreground (`async:false`) through `scripts/d1-probe.mjs`, logging every RPC event verbatim to a file. Also cat the run's `status.json` from `$TMPDIR/pi-subagents-uid-*/async-subagent-runs/<id>/`.
- [ ] **Step 2: Repeat once with `waitTool: {enabled:false}`** written into the probe's `PI_CODING_AGENT_DIR/extensions/subagent/config.json`, and record `get_commands`/tool list + a forced `subagent_wait` call outcome.
- [ ] **Step 3: Write the shapes into d1.md** — verbatim JSON, one subsection per capture, dated. Note explicitly which 0.49-audit claims 0.50 confirms vs moves.
- [ ] **Step 4: Commit** — `git add docs/validation/d1.md scripts/ && git commit -m "docs(d1): pi-subagents 0.50 wire shapes, measured"`

### Task 3: Re-pin the contract test (and commit the pin bump)

**Files:**
- Modify: `tests/pi-subagents-contract.test.ts`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (ONLY if an import can move to a public subpath)

**Interfaces:**
- Consumes: d1.md's measured shapes (Task 2).
- Produces: a green key-free contract suite that pins 0.50; the pin-bump commit.

- [ ] **Step 1: Update the run-inventory fixtures for the index path.** The 0.40-pinned case "finds an active run WITHOUT any index" flips: at 0.50 an active-state query with no runId reads `readActiveRunIndex(root) ?? []` with no fallback scan. Rewrite it to pin the NEW truth both ways:

```ts
it("active-state queries read the marker index — and an unindexed 0.40-era run is invisible (the accepted upgrade hole)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hv-async-idx-"));
  const runId = "run-with-marker";
  const dir = path.join(root, runId);
  mkdirSync(dir);
  writeFileSync(path.join(dir, "status.json"), JSON.stringify({
    runId, sessionId: "s", state: "running", mode: "single",
    startedAt: 1, lastUpdate: 1, steps: [{ index: 0, agent: "researcher", status: "running" }],
  }));
  // No marker → invisible (Decision 2026-08-17: accepted, no migrator).
  expect(listAsyncRuns(root, { states: ["queued", "running"], sessionId: "s" })).toHaveLength(0);
  // Marker present → found. (Adjust marker path/content to what Task 2 measured
  // in pi-subagents/src/runs/background/async-status.ts readActiveRunIndex.)
  mkdirSync(path.join(root, ".active-runs"), { recursive: true });
  writeFileSync(path.join(root, ".active-runs", runId), "");
  expect(listAsyncRuns(root, { states: ["queued", "running"], sessionId: "s" })).toHaveLength(1);
});
```

- [ ] **Step 2: Add the new payload pins** (all key-free source scans of the vendored tree, the existing style):

```ts
it("async-started emits id (not runId) + lifecycleArtifactVersion, and redacts the prompt", () => {
  const src = readVendoredSubagents("src", "runs", "background", "async-execution.ts");
  expect(src).toContain("lifecycleArtifactVersion");
  expect(src).toContain("PROMPT_REDACTED");   // the redaction the bridge/renderer must never display
});
it("waitTool.enabled is a real config key (Decision 2026-08-17: we set it false)", () => {
  const types = readVendoredSubagents("src", "shared", "types.ts");
  expect(types).toMatch(/waitTool/);
});
```
Re-derive the exports-map assertion (11 subpaths — read `Object.keys(exports)`, don't hand-list) and keep the "neither deep file is exported" assertion.

- [ ] **Step 3: Migrate imports that CAN move.** Check whether `./shared-types` re-exports `ASYNC_DIR` (`node -e "console.log(require('pi-subagents/shared-types').ASYNC_DIR)"` from pi-runtime, or read the subpath's target file). If yes, move that ONE import in `happyvibe-bridge.ts` to the bare public subpath and update the contract test's specifier pins to match; `listAsyncRuns` stays relative either way. If no, change nothing and note it in the test comment (upstream ask A stays open).
- [ ] **Step 4: Run** `npx vitest run tests/pi-subagents-contract.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"` — expect PASS.
- [ ] **Step 5: Full non-live check** `npm test > /tmp/vitest.log 2>&1; echo "EXIT=$?"` — the only remaining reds must be live-file-internal (they skip without a key, so expect green here).
- [ ] **Step 6: Commit the pin + re-pins together** — `git add -A && git commit -m "feat(pi): bump pi-subagents 0.40.0 → 0.50.0, contract test re-pinned to measured shapes"`

### Task 4: `writeSubagentConfig` gains `waitTool: {enabled: false}`

**Files:**
- Modify: `src/main/config.ts:620-637` (`writeSubagentConfig`)
- Test: `tests/subagent-config.test.ts` (create — no existing test covers this function)

**Interfaces:**
- Consumes: nothing new.
- Produces: `writeSubagentConfig()` writes `waitTool: {enabled: false}` merged into the config JSON (preserving unknown keys, its existing contract).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
// writeSubagentConfig writes under agentDir(); point PI_CODING_AGENT_DIR at a tmp dir
// BEFORE importing config.ts (it reads the env at module scope — check and mirror
// how other config tests isolate agentDir, e.g. tests/builtin-agents-uninstall.test.ts).
it("writes waitTool disabled, async-by-default, and preserves foreign keys", () => {
  const file = path.join(agentDirForTest, "extensions", "subagent", "config.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ futureKey: 42, waitTool: { enabled: true, futureSub: "x" } }));
  writeSubagentConfig();
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  expect(cfg.asyncByDefault).toBe(true);
  expect(cfg.waitTool).toEqual({ futureSub: "x", enabled: false }); // merge-write, ours wins on enabled
  expect(cfg.futureKey).toBe(42);
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/subagent-config.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"` — expect FAIL (`waitTool` undefined).
- [ ] **Step 3: Implement** — one line in `writeSubagentConfig`, matching the `completionBatch` merge idiom, with the decision comment:

```ts
// PRD §12 (2026-08-17): the wait tool is disabled at source — a blocking wait is
// never right (results always deliver as a new turn). The WAIT_TOOLS name guard
// in hv-rules.ts stays on top: a renamed config key fails silent, a renamed tool
// name fails the contract test loudly.
config.waitTool = { ...(config.waitTool as object | undefined), enabled: false };
```

- [ ] **Step 4: Run it** — expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(subagents): wait tool disabled at source (PRD §12 2026-08-17), guard stays"`

### Task 5: Bridge — `runId → task` map, persisted, enriching relay + resync

**Files:**
- Create: `pi-runtime/extensions/hv-subagent-tasks.ts` (pure module, the `hv-plan.ts` pattern)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (~line 997-1070, the relay + `/hv-subagent-list` block)
- Test: `tests/subagent-status.test.ts` or new `tests/hv-subagent-tasks.test.ts` (key-free)

**Interfaces:**
- Consumes: Task 2's measured event ordering (tool_call → async-started → tool_execution_end ordering, and whether status.json redacts task).
- Produces: `hv.subagent` `started` notifies and `/hv-subagent-list` `active` replies carry a non-redacted `task` string again. Exact pure API:

```ts
// hv-subagent-tasks.ts
export const SUBAGENT_TASKS_TYPE = "hv-subagent-tasks";
/** FIFO of subagent tool_call tasks not yet claimed by an async-started event. */
export function stashPendingTask(state: TaskMapState, task: string): void;
/** async-started(id) claims the oldest pending task; returns it (or undefined). */
export function claimTask(state: TaskMapState, runId: string): string | undefined;
export function taskFor(state: TaskMapState, runId: string): string | undefined;
export function serialize(state: TaskMapState): { runs: Record<string, string> };
export function restore(raw: unknown): TaskMapState;   // tolerant of absent/corrupt
export interface TaskMapState { pending: string[]; runs: Record<string, string> }
```

- [ ] **Step 1: Write failing tests** for the pure module: stash→claim FIFO, claim on unknown returns undefined, serialize/restore round-trip, restore of garbage yields empty state, `PROMPT_REDACTED` is never stored (guard: `stashPendingTask` ignores that literal — defense against wiring the redacted value back in).

```ts
it("never stores the redaction literal", () => {
  const s = restore(undefined);
  stashPendingTask(s, "PROMPT_REDACTED");
  claimTask(s, "r1");
  expect(taskFor(s, "r1")).toBeUndefined();
});
```

- [ ] **Step 2: Run to fail, implement the module, run to pass.** Keep it dumb: two plain fields, no classes.
- [ ] **Step 3: Wire the bridge** (follow the plan-state pattern at `happyvibe-bridge.ts:316`):
  - In the existing `tool_call` handler where `subagent` passes the gate: `stashPendingTask(state, String(input.task ?? ""))`.
  - In the `async-started` relay (line ~1006): `const task = claimTask(state, d.id) ?? undefined;` then `relay({ stage:"started", runId: d.id, agent: d.agent, task, asyncDir: d.asyncDir })` — the redacted `d.task` is no longer read. Persist: `pi.appendEntry(SUBAGENT_TASKS_TYPE, serialize(state))`.
  - On `session_start`: restore from the newest `SUBAGENT_TASKS_TYPE` entry (same restore idiom as plan state / context marks).
  - In `/hv-subagent-list` (line ~1054): `task: r.task && r.task !== "PROMPT_REDACTED" ? r.task : taskFor(state, r.id)`.
- [ ] **Step 4: Run the key-free bridge-source tests** — add a source-scan assertion to the new test file pinning that the relay no longer reads `d.task` directly (`expect(bridgeSrc).not.toMatch(/task:\s*d\.task/)`), the `tests/modal-layer.test.ts` absence-scan pattern.
- [ ] **Step 5: Full non-live** `npm test > /tmp/vitest.log 2>&1; echo "EXIT=$?"` — green.
- [ ] **Step 6: Commit** — `git commit -m "feat(subagents): the card keeps its task text — 0.50 redacts events, the bridge remembers"`

### Task 6: Renderer — label adoption + transcript per measured shapes

**Files:**
- Modify: `src/renderer/src/agents.ts` (`traceFromUpdate`/`mergeTrace` only if Task 2 shows the update shape moved)
- Modify: `src/renderer/src/App.tsx:640-685` (the `handleSubagentEvent` block)
- Test: `tests/agents-renderer.test.ts`

**Interfaces:**
- Consumes: `hv.subagent` started notify now carrying real `task` (Task 5); Task 2's `tool_execution_update.partialResult` shape.
- Produces: async cards labeled on both the live and resync paths; live child progress rendered from whatever 0.50 actually ships (or per-child status if the update carries nothing renderable — decide from Task 2's data, not preference).

- [ ] **Step 1: Failing test — the redaction never renders.** In `tests/agents-renderer.test.ts` (renderer tests are data + source scans, no DOM):

```ts
it("a redacted task never becomes a card label", () => {
  // delegationLabel and the started-notify path must both drop the literal.
  expect(delegationLabel({ task: "PROMPT_REDACTED" })).toBe("");
  const appSrc = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
  expect(appSrc).not.toMatch(/label:\s*sub\.task \?\? ""/);  // the 0.40 line — must be replaced by the guarded helper
});
```

- [ ] **Step 2: Implement.** Add to `agents.ts` a tiny guard used by every label site (`delegationLabel` already exists — extend it to drop `PROMPT_REDACTED`, one line). In `App.tsx` `handleSubagentEvent`, label via the guarded helper on `started` and on `active` resync. Adoption belt-and-braces: when `asyncResultInfo` fires (fg card discarded for the async card), copy the fg card's label onto the async card if the async card's label is empty.
- [ ] **Step 3: Transcript mapping** — if Task 2's update shape still carries `toolCalls`, `traceFromUpdate` likely needs zero or field-rename changes; if the update carries nothing renderable, the card body shows per-child status from `started`/`control` and the transcript renders at completion (`traceFromEnd` path). Update `agents-renderer.test.ts` fixtures to the VERBATIM captured shapes from d1.md — never hand-written.
- [ ] **Step 4: Run** `npx vitest run tests/agents-renderer.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"` — PASS; then full `npm test` — green.
- [ ] **Step 5: Commit** — `git commit -m "feat(agents): card labels survive 0.50's event redaction, transcript per measured shapes"`

### Task 7: Live acceptance — re-time the four 0.49 reds

**Files:**
- Modify: `tests/subagent-context.test.ts` (assert the child's answer at its measured arrival point — the completion `sendMessage` turn, not the spawn tool result)
- Modify: `tests/subagent-async-bridge.test.ts`, `tests/agents-bridge.test.ts` (payload-shape assertions per d1.md)

**Interfaces:**
- Consumes: everything above.
- Produces: the full live batch green at 0.50.

- [ ] **Step 1: Re-time `subagent-context`** — the spawn tool result is now a fan-out receipt; the answer ("HELLO") arrives in the completion turn. Keep the isolation assertions (content < 2000 chars, no `"role"`, no raw transcript) pointed at what actually enters main context — d1.md says where. Each re-timing gets one comment line naming the d1.md subsection it derives from.
- [ ] **Step 2: Run the four files batched, serial:** `npx vitest run tests/agents-bridge.test.ts tests/subagent-async-bridge.test.ts tests/subagent-context.test.ts tests/subagent-discovery-bridge.test.ts --no-file-parallelism > /tmp/live-accept.log 2>&1; echo "EXIT=$?"` — green. One failure ⇒ rerun that file alone before calling it a regression (a "model never called X" live red is usually noise — see CLAUDE.md's p-value entry before blaming the bump).
- [ ] **Step 3: Full live batch:** `npm run test:live > /tmp/live-full.log 2>&1; echo "EXIT=$?"` — green. If `terminal-bridge` re-reds, treat it as a real 0.50 interaction (the caveats-page prior), not a flake.
- [ ] **Step 4: Commit** — `git commit -m "test(live): 0.50 acceptance — the answer arrives on the completion turn"`

### Task 8: Docs, gate, GUI smoke

**Files:**
- Modify: `CLAUDE.md` (the pi-subagents entries: "Bumped 0.34.0 → 0.40.0" line → 0.50.0 + date; the `toolCalls` shape note if Task 6 changed it; the §2.4 hole gets one sentence in the async-subagents gotcha)
- Modify: `docs/validation/d1.md` (any shape that moved during implementation)

- [ ] **Step 1: Update CLAUDE.md** — every `0.40` reference in the pi-subagents entries re-checked against what shipped; do not restate what the contract test already pins, point at it.
- [ ] **Step 2: Full gate** — `npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"` — green (build + both typechecks + non-live suite).
- [ ] **Step 3: GUI smoke in the real app** (`npm run dev`; per the §9-rewind lesson, verify the BUILT artifact behavior, not the source) — the observable assertions below.
- [ ] **Step 4: Commit docs** — `git commit -m "docs: 0.50 bump folded into CLAUDE.md + d1"` — then stop for `/land`.

## GUI verification — observable assertions

All observed in the running app (`npm run dev`), chat view of a real workspace unless stated. Restart the dev server first if main changed (a renderer reload does NOT rebuild main).

**Observable claims:**
1. Delegate async ("use the code-explorer subagent to summarize src/main") → a sticky run card appears **showing the task text you typed** (sourced through the bridge map, since the event is redacted). *Chat view.*
2. While the card runs, the composer stays enabled and a new message sends normally (turn ended at dispatch). *Chat view.*
3. Completion arrives as its own assistant turn containing the child's answer; the card shows a "finished — delivering results…" notice and slides away. *Chat view.*
4. Trigger a respawn mid-run (toggle any MCP server on the MCP page, or restart the dev server) → after the session reloads, the run card **comes back with its task text**, not just the agent name. *Chat view, after the MCP page action.*
5. The delegation's audit row still shows the task/intent headline. *Audit page (Settings → Audit) — the surface that owns the record, not the one that changed.*

**Absence assertions (named, the thing this round exists to exclude):**
- The string **`PROMPT_REDACTED` appears nowhere**: not on the run card, not in the transcript, not in an audit row, not in `/hv-subagent-list` resync cards. Grep the DOM if in doubt (`document.body.innerText.includes("PROMPT_REDACTED")` via devtools).
- **No `subagent_wait` tool card ever renders** in the transcript (the guard hides it; config-off means it shouldn't even be attempted). A turn that delegates ends without any "waiting" card.

**The regression this design risks, as a performable sequence:** dispatch TWO async delegations in quick succession (parallel or back-to-back turns), then respawn. The FIFO task-map could cross the labels. Verify: each resynced card shows ITS OWN task text, interrupt one via its card control → only that card flips to interrupted, the other completes and delivers. If labels cross, the FIFO claim in `hv-subagent-tasks.ts` needs the runId correlation from `tool_execution_end.details.asyncId` instead — Task 2's measured ordering says which is safe.

## Self-review notes

- Spec coverage: §0→Task 1, §2.1→Tasks 2+7, §2.2→Tasks 2+6, §2.3→Tasks 3+5+6, §2.4→Task 3 (pinned as accepted), §2.5→Task 4 (+ contract pin in Task 3), §2.6→Task 3, Phase 4→Task 8 + already-folded PRD, Phase 5→Tasks 7+8. The §5 risk "herdr/doctor/watchdog stay inert" is covered by the existing `resource-gate-contract` test running green in Task 3 Step 5.
- Task 3's marker-path fixture and Task 5's event-ordering wiring both depend on Task 2's measurements — those steps say so explicitly rather than guessing shapes.
