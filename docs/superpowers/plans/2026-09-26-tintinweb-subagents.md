# Sub-agents on tintinweb — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vendored nicobailon `pi-subagents` 0.64.0 with `@tintinweb/pi-subagents` 0.19.0 plus an owned patch, reach §12 parity, and ship steering (model, run card, composer), workflows (approved as code), stuck-run flagging and child permission prompts.

**Architecture:** tintinweb runs children **in-process** inside the session's Pi process. A six-part patch (`scripts/tintinweb-hunks.mjs`, applied by `scripts/patch-tintinweb.mjs` at `pi-runtime` postinstall) makes children inherit the parent's trust and obey a host **child policy** the bridge publishes on `globalThis[Symbol.for("hv:child-policy")]`: forced guard extension, approved skills, spawn refusals, boundary lookup, audit sink, and (Phase 4) a prompt channel. The two stacks coexist behind `HV_SUBAGENTS=tintinweb` until Task 20 flips the default and deletes nicobailon.

**Tech Stack:** Pi 0.86.1 (`@earendil-works/pi-coding-agent`), `@tintinweb/pi-subagents` 0.19.0 (raw TS, loaded by Pi's own loader), vitest (no DOM — pure exports + source scans), Electron/React renderer, OpenRouter via `tests/liveModel.ts` for live tests.

**Spec:** Notion "tintinweb/pi-subagents — evaluation & migration plan" (`3ccd33dfffca817f8c1ce37c51e2427b`, LOCKED 2026-09-26). PRD `docs/prd.md` §3, §7, §10, §12 (each has a 2026-09-26 "tintinweb round" decision). Read both before starting. Upstream source of truth: `pi-runtime/node_modules/@tintinweb/pi-subagents/` once Task 6 lands (before that, `npm pack @tintinweb/pi-subagents@0.19.0` into the scratchpad).

## Global Constraints

- **nicobailon stays shippable until Task 20.** `HV_SUBAGENTS` unset ⇒ today's stack, byte-for-byte. `HV_SUBAGENTS=tintinweb` ⇒ the new one. ONE stack per Pi process — never both `-e`'d at once.
- **The bridge stays the LAST `-e`** (it is the gate). tintinweb loads where `hv-owner-seed.ts` + `pi-subagents` load today.
- **The only edits to vendored code are hunks in `scripts/tintinweb-hunks.mjs`.** Each hunk replaces exact anchor text, carries a `hv-patch:<id>` marker, and has a test. A missing/ambiguous anchor fails `npm ci`. This is CLAUDE.md's named carve-out.
- **Fail closed when the host is HappyVibe:** spawn.ts sets `HV_HOST=1` on the tintinweb path. With `HV_HOST=1`, a child built with no child policy registered THROWS; project `.pi/subagents.json` and `.pi/workflows/` / `.agents/workflows/` are never read; workflow gate commands never run.
- **Rule name for a delegation stays `subagent:<agent>`** (`boundaryRuleName`, `hv-subagent-boundary.ts:49`) — existing rules/grants keep matching.
- **Settings written by the app** (global `<agentDir>/subagents.json`): `widgetMode:"off"`, `fleetView:false`, `agentMentions:"off"`, `outputTranscript:false`, `schedulingEnabled:false`, `worktreeIsolation:false`, `disableDefaultAgents:true`, `fallbackSubagent:"none"`, `reportUsage:false`, `rememberAgents:true`, `maxConcurrent:4`, `workflowsEnabled:true`.
- **Child sessions live at `<sessionDir()>/subagents/`** via `PI_CODING_AGENT_SESSION_DIR` — under the sessions root (so `readChildTrace`'s confinement holds) and in a SUBDIRECTORY (so the sidebar never lists them as sessions).
- **Choices:** a workflow prompt offers `Allow · Deny` only; a child prompt (Phase 4) offers `Allow · Allow for this run · Deny` only. The renderer must NOT expand either to the five-choice set (`PermissionModal.tsx:135-136`).
- **Tests:** `npm run gate` green after every task. Never pipe a test run: `L=/tmp/vitest.log; npx vitest run <t> > $L 2>&1; echo "EXIT=$?"`. Live batch (`npm run test:live`, backgrounded) whenever `npm run live:why` prints anything — this whole round does. **Symlink the key first** (`ln -s ~/Documents/Github/HappyVibe/.env .env`), read the wall time (~7–8 min is real, 5 s is a silent skip), and `pgrep -fl "npm run dev"` before believing any live red.
- **Commits:** `git commit -s` (DCO check) with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. Small commits per task.
- **No DOM in tests.** Visual contracts = exported data + source scans (CLAUDE.md "The renderer suite has NO DOM").
- **Any product decision that changes while building goes to BOTH `docs/prd.md` and the Notion PRD, same session**, in place, "Decision (…)" convention.

## Review Focus

1. **A cloned repo's agent file tries to reach past the policy** — `.pi/agents/worker.md` with `extensions: [./evil.ts]`, `memory: project`, `session_dir: /tmp/leak`. Expect: evil.ts never runs, no `.pi/agent-memory/`, the child session lands under `<sessionDir>/subagents/`. → Task 8 test `agent-file fields cannot reach past the policy`.
2. **Two concurrent runs of the SAME agent** — steer, stop and delivery must each hit the right run. Expect: a steer to run A never lands in run B; each `<task-id>` is repaired with its own full text. → Task 13 test `two notifications, two ids, two outputs`; Task 17 test `steer targets one run id`.
3. **A respawn while a background run is in flight** (hibernation / MCP live-reload). Expect: `activity.isIdle` is false for the whole run, so no respawn happens; after an app relaunch the stale card is gone, not spinning. → Task 12 test `a running tintinweb run keeps the session busy until complete`.
4. **A workflow naming an agent that does not exist, or one the user switched off.** Expect: the child spawn fails loud (strict dispatch + P3 refusal), the workflow reports it, nothing silently runs as `general-purpose`. → Task 10 live test (d) (a switched-off agent) and Task 16 live test (f) `an unknown agentType fails loud`.
5. **A child prompt raised while the chat pane is hidden** (user on a Settings page). Expect: the modal falls back to the viewport (`dialogHost`, `paneDialog.ts`) and stays answerable; the run waits. → Task 23: the child prompt rides the parent's `ui-request` stream (live test (a)), so `dialogHost`'s existing viewport fallback (`tests/pane-dialog.test.ts`) applies unchanged.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/tintinweb-hunks.mjs` | **new** — `HUNKS: {id, file, find, replace}[]`, every hunk verbatim |
| `scripts/patch-tintinweb.mjs` | **new** — `applyHunks(pkgRoot, hunks)`; CLI entry run from `pi-runtime` postinstall |
| `pi-runtime/package.json` | `@tintinweb/pi-subagents: 0.19.0`; postinstall chains the applier |
| `pi-runtime/extensions/hv-child-policy.ts` | **new, import-free** — the two symbols, `ChildPolicy` type, `childPolicy()` getter, `currentChildSpawn()` |
| `pi-runtime/extensions/hv-rules.ts` | `DELEGATION_TOOLS`/`isDelegationTool`; `isResultWait` |
| `pi-runtime/extensions/hv-tw-gate.ts` | **new, pure** — tintinweb tool gating helpers (boundary from agent config, workflow source + agent parse, prompt envelopes, choice sets) |
| `pi-runtime/extensions/hv-tw-relay.ts` | **new** — `registerTwRelay(pi, deps)`: `subagents:*` → `hv.subagent` notifies, running set, `/hv-subagent-*` commands on the tintinweb path |
| `pi-runtime/extensions/hv-child-guard.ts` | in-process mode (identity, boundary, audit via policy; Phase 4 ask via policy) |
| `pi-runtime/extensions/hv-subagent-delivery.ts` | `<task-notification>` repair keyed on `<task-id>` |
| `pi-runtime/extensions/hv-agents.ts` | roster variant for the `Agent` tool vocabulary |
| `pi-runtime/extensions/hv-plan.ts`, `hv-readonly.ts` | new tool names in the plan/readonly gates |
| `pi-runtime/extensions/happyvibe-bridge.ts` | publishes the child policy; wires the gate + relay on the tintinweb path; Phase 4 extracts `decide()` |
| `src/main/pi/spawn.ts` | `subagentsLib` option → `-e` set, `HV_HOST`, `PI_CODING_AGENT_SESSION_DIR`, no child launcher |
| `src/main/subagentSettings.ts`, `src/main/config.ts` | pure `tintinwebSettings()`; `writeTintinwebSettings()` |
| `src/main/twChildren.ts` | **new** — child-session discovery by `parentSession` header, live status, inspect reply, workflow progress from session entries |
| `src/main/stuckRun.ts` | **new, pure** — `isStuck(lastEntryKind, idleMs)` |
| `src/main/store.ts`, `src/main/sessionLedger.ts` | new layout in delete/sweep/ledger; old layout kept read-only |
| `src/main/activity.ts`, `src/main/ipc.ts` | delegation predicate; steer/workflow-stop IPC; poller on child session file |
| `src/preload/index.ts`, `src/renderer/src/hv.d.ts` | `subagentSteer`, `workflowStop` |
| `src/renderer/src/agents.ts`, `toolLabel.ts`, `components/ToolCard.tsx`, `App.tsx` | tool-name predicate; tintinweb result shapes; old-session compat |
| `src/renderer/src/components/ChatView.tsx`, `mentions.ts`, `Transcript.tsx` | steer box on the run card; running-run rows + chip in `@` |
| `src/renderer/src/components/PermissionModal.tsx`, `permission.ts` | workflow variant; child variant |
| `docs/validation/tw1.md` | **new** — Phase 0 measurements, GO/NO-GO |
| `docs/validation/d1.md` | new § "tintinweb wire shapes" (captured verbatim) |
| `CLAUDE.md` | subagent section rewritten at Task 20; never-patch carve-out |

---

## Phase 0 — go/no-go (spike: nothing here is kept except the measurements)

### Task 1: Bootstrap and a scratch runtime

**Files:**
- Create: `docs/validation/tw1.md`
- Scratch (never committed): `$S/tw-runtime/` where `S` = the session scratchpad

- [ ] **Step 1: Both installs + the key**

```bash
npm install && (cd pi-runtime && npm ci)
ln -s ~/Documents/Github/HappyVibe/.env .env && git check-ignore -v .env
```
Expected: `.gitignore:… .env`. Then `curl -s -o /dev/null -w '%{http_code}' https://openrouter.ai/api/v1/models -H "Authorization: Bearer $(grep OPENROUTER_API_KEY .env | cut -d= -f2)"` → `200` (the balance check CLAUDE.md asks for before any live measurement).

- [ ] **Step 2: Scratch copy of the runtime with tintinweb installed**

```bash
S=/private/tmp/claude-501/<session-scratchpad>
rsync -a --exclude node_modules pi-runtime/ $S/tw-runtime/
(cd $S/tw-runtime && npm ci && npm i --no-save @tintinweb/pi-subagents@0.19.0)
ls $S/tw-runtime/node_modules/@tintinweb/pi-subagents/src/index.ts
```

- [ ] **Step 3: Start `docs/validation/tw1.md`** with a header (date, pins: Pi 0.86.1, tintinweb 0.19.0, nicobailon 0.64.0, model from `tests/liveModel.ts`) and an empty results table whose rows are Phase 0 checks 1–9 from the spec §6.

- [ ] **Step 4: Commit**

```bash
git add docs/validation/tw1.md && git commit -s -m "docs(§12): tw1 — Phase 0 measurement log for the tintinweb migration"
```

### Task 2: The Pi and tintinweb API names the patch depends on (key-free)

**Files:** Modify: `docs/validation/tw1.md`

The hunks in Task 8/9 assume five names. Verify each against the INSTALLED `.d.ts`/source and record file:line in tw1.md. If a name differs, fix the hunk text in this task's notes before Task 7 writes it.

- [ ] **Step 1: Verify**

```bash
PI=pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist
grep -n "static create" $PI/core/settings-manager.d.ts          # (cwd, agentDir, options?) with projectTrusted?
grep -n "settingsManager\|additionalSkillPaths\|skillPaths\|noSkills" $PI/core/resource-loader.d.ts
grep -n "isProjectTrusted" $PI/core/extensions/types.d.ts
TW=$S/tw-runtime/node_modules/@tintinweb/pi-subagents/src
grep -n "resolveModel(" $TW/index.ts $TW/cross-extension-rpc.ts $TW/nested-tools.ts $TW/workflow/host.ts $TW/schedule.ts
```
Expected and recorded: `SettingsManager.create` accepts an options object carrying `projectTrusted`; `DefaultResourceLoader` accepts `settingsManager` and a skill-paths option (record its exact name — the hunk uses `additionalSkillPaths`); `ExtensionContext.isProjectTrusted()` exists; every `resolveModel` caller treats a `string` return as an error message (read each call site; record the line). **Any "no"** ⇒ write the corrected hunk text into tw1.md and use it in Task 8/9.

- [ ] **Step 2: Commit** — `git commit -s -m "docs(§12): tw1 — the Pi SDK names the child-policy patch depends on"`

### Task 3: Live checks 1–4, 6, 9 and the wire shapes

**Files:**
- Modify: `docs/validation/tw1.md`, `docs/validation/d1.md` (new § "tintinweb wire shapes")
- Scratch: `$S/probe/probe.ts` (a Pi extension), `$S/probe/run.mjs`

The probe boots the SCRATCH runtime's Pi CLI in `--mode rpc` with `-e tintinweb -e probe -e happyvibe-bridge.ts` (bridge last), `HV_HOST` unset, a rules file allowing `Agent*`/`subagent*`, and records every stdout frame + every `pi.events` payload to `$S/probe/frames.jsonl`.

- [ ] **Step 1: Write the probe extension** — listens on `subagents:created|started|completed|failed|steered|compacted|ready` and appends `{event, payload}`; on `session_start` also records `typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted()`.

- [ ] **Step 2: Capture, one prompt each** (use `askUntil` from `tests/reask.ts` semantics: re-ask up to 3× if the model makes no tool call):
  1. background `Agent` → code-explorer, "list the files in this folder" (check 1: `started`/`completed` + bridge `hv.subagent` notify; check 2: the follow-up message appears on stdout and triggers a turn — record its full JSON, including `customType` and the `<task-notification>` text).
  2. `Agent` with `run_in_background:false` (the foreground tool result shape).
  3. a rules file with NO allow for `Agent*` → the bridge prompts (select `hv.permission`) → answer `Deny` → an `hv.audit` row with `decision:"deny"` (check 3).
  4. `steer_subagent` against a running background agent; `get_subagent_result` with and without `wait`.
  5. a trivial `SubagentWorkflow` (two `agent({agentType:"code-explorer", …})` calls) — record the tool result, the `subagents:workflow` session entries, and whether any `subagents:*` event fires for its children (spec says none).
  6. six background `Agent` spawns with `maxConcurrent:4` in the scratch agent dir's `subagents.json` — record the max simultaneously `running` (check 9, #352).
  7. while (1) runs: the child session file path (from `ctx`/registry `getRecord(id).session`) and whether it grows during the run (check 6). Record WHEN the path is first knowable (at `started`? later?).

- [ ] **Step 3: Check 4, live half** — a throwaway guard extension (`$S/probe/guard.ts`) loaded into a child via agent frontmatter `extensions: [<abs path>]` that blocks `bash` in `tool_call` and, from its handler, reads a `globalThis` function the probe set and calls the PARENT's `ctx.ui.select` through it. Record: the child's bash was blocked (the child's own transcript shows the block reason) and a `select` frame appeared on the parent's stdout.

- [ ] **Step 4: Record** — tw1.md: one row per check, ✅/❌ + the evidence line. d1.md § "tintinweb wire shapes": every payload **verbatim** (pretty-printed JSON), headed by where it was captured. Later tasks use these as fixtures; they must be real frames, never hand-written.

- [ ] **Step 5: Commit** — `git commit -s -m "docs(§12): tw1 + d1 — Phase 0 live checks and the tintinweb wire shapes, captured"`

### Task 4: Gates 7 and 8, then STOP

**Files:** Modify: `docs/validation/tw1.md`; Notion spec §6 statuses

- [ ] **Step 1: Gate 7** — hand-apply P1–P4 (the hunk texts from Task 8/9, corrected per Task 2) to the SCRATCH copy, re-run §3.3 rows 6–10 key-free (bogus key, fixtures: `.pi/extensions/evil.ts` writing a marker file, `<agentDir>/extensions/planted.ts`, `.pi/settings.json` `packages:["npm:is-number@7.0.0"]`, `.pi/subagents.json {schedulingEnabled:true}`). Expected: no marker files, no `<ws>/.pi/npm/`, scheduler not started.
- [ ] **Step 2: Gate 8** — `(cd $S/tw-runtime/node_modules/@tintinweb/pi-subagents && npm i && npx vitest run > $S/tw-suite.log 2>&1; echo EXIT=$?)` against Pi 0.86.1; record pass/fail counts and a one-line triage per e2e failure (harness-side vs product-side).
- [ ] **Step 3: Verdict** — tw1.md gets a `## Verdict` line: **GO** if checks 1–4 and 7 are ✅, else **NO-GO** naming the failed check. Update the Notion spec §6 Phase 0 statuses; on NO-GO also add a dated retraction paragraph at the top of the spec page.
- [ ] **Step 4: Commit** — `git commit -s -m "docs(§12): tw1 — Phase 0 verdict"`
- [ ] **Step 5: STOP and report to Guilhem** — the verdict, the table, anything measured that contradicts the spec. **Do not start Phase 1 without an explicit go.** Delete the scratch runtime.

---

## Phase 1 — vendor, patch, guard parity

### Task 5: One predicate for "this tool is a delegation"

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts` (after `isWaitTool`, ~line 126)
- Modify: `src/renderer/src/agents.ts:254-256`, `src/renderer/src/components/ToolCard.tsx:841`, `src/renderer/src/toolLabel.ts:394`, `src/main/activity.ts:52`, `src/main/ipc.ts:1615,1638`
- Test: `tests/delegation-tools.test.ts`

**Interfaces:**
- Produces: `DELEGATION_TOOLS: ReadonlySet<string>`, `isDelegationTool(tool: unknown): boolean`, `isResultWait(tool: unknown, input: unknown): boolean` (all in `hv-rules.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/delegation-tools.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { isDelegationTool, isResultWait } from "../pi-runtime/extensions/hv-rules";

describe("isDelegationTool — both vendored stacks, one predicate", () => {
  it("names the nicobailon and tintinweb delegation tools, nothing else", () => {
    expect(isDelegationTool("subagent")).toBe(true);
    expect(isDelegationTool("Agent")).toBe(true);
    expect(isDelegationTool("agent")).toBe(false);
    expect(isDelegationTool("SubagentWorkflow")).toBe(false);
    expect(isDelegationTool(undefined)).toBe(false);
  });
  it("no call site re-spells the literal", () => {
    for (const f of [
      "src/renderer/src/agents.ts", "src/renderer/src/components/ToolCard.tsx",
      "src/main/activity.ts", "src/main/ipc.ts",
    ]) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/toolName\s*===\s*"subagent"/);
  });
});

describe("isResultWait — the never-block rule on the tintinweb path", () => {
  it("is a wait only when get_subagent_result asks to block", () => {
    expect(isResultWait("get_subagent_result", { agent_id: "a", wait: true })).toBe(true);
    expect(isResultWait("get_subagent_result", { agent_id: "a" })).toBe(false);
    expect(isResultWait("get_subagent_result", { agent_id: "a", wait: false })).toBe(false);
    expect(isResultWait("steer_subagent", { wait: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/delegation-tools.test.ts > $L 2>&1; echo EXIT=$?` → FAIL (`isDelegationTool` not exported).

- [ ] **Step 3: Implement**

```ts
// pi-runtime/extensions/hv-rules.ts — after isWaitTool
/**
 * Every tool name that STARTS a delegation, across both vendored stacks:
 * nicobailon's `subagent` and tintinweb's `Agent`. One set, because four call
 * sites (renderer card, label, activity gate, ipc correlation) each carried
 * their own literal and a rename would have missed one.
 */
export const DELEGATION_TOOLS: ReadonlySet<string> = new Set(["subagent", "Agent"]);
export const isDelegationTool = (tool: unknown): boolean =>
  typeof tool === "string" && DELEGATION_TOOLS.has(tool);

/** tintinweb's blocking wait: `get_subagent_result` with `wait: true` (PRD §12 never-block rule). */
export const isResultWait = (tool: unknown, input: unknown): boolean =>
  tool === "get_subagent_result" && (input as { wait?: unknown } | null)?.wait === true;
```
Replace the literals: `agents.ts` `isSubagentTool` body → `return isDelegationTool(toolName);` (import from `../../../pi-runtime/extensions/hv-rules`, the path `App.tsx` already uses for `isWaitTool`); `ToolCard.tsx:841` → `if (isSubagentTool(card.toolName))`; `toolLabel.ts:394` → add `case "Agent":` beside `case "subagent":` and read `a.subagent_type ?? a.agent` / `a.description ?? a.task`; `activity.ts:52` and `ipc.ts:1615,1638` → `isDelegationTool(...)`. On the `Agent` path the agent name is `args.subagent_type` — at `ipc.ts:1615` read `args.agent ?? args.subagent_type`.

- [ ] **Step 4: Run** — the new test PASSES; then `npm test > $L 2>&1; echo EXIT=$?` → EXIT=0 (nicobailon behaviour unchanged: `agents-renderer`, `session-activity`, `tool-label` green).

- [ ] **Step 5: Commit** — `git commit -s -m "refactor(§12): one isDelegationTool predicate for both sub-agent stacks"`

### Task 6: Vendor tintinweb and the patch applier

> **Phase 0 already wrote `scripts/patch-tintinweb.mjs` and `scripts/tintinweb-hunks.mjs` (18 hunks, uncommitted).** The applier is TWO-PASS — every anchor is checked before any file is written — because the first draft left a half-patched package when a later anchor failed (tw1.md, Gate 7). Treat the code block below as superseded by the file on disk; this task adds the tests, the dependency and the postinstall wiring, and commits both scripts. Add a test: `a failing anchor writes nothing` (fixture with two hunks, the second missing → the first file is byte-identical afterwards).

**Files:**
- Create: `scripts/patch-tintinweb.mjs`, `scripts/tintinweb-hunks.mjs` (with `export const HUNKS = []` for now)
- Modify: `pi-runtime/package.json` (dependency + postinstall), `pi-runtime/package-lock.json`
- Test: `tests/tintinweb-patch-apply.test.ts`

**Interfaces:**
- Produces: `applyHunks(pkgRoot: string, hunks?: Hunk[]): string[]` (ids applied this run), `type Hunk = { id: string; file: string; find: string; replace: string }`, `HUNKS: Hunk[]`, `TW_PKG = "node_modules/@tintinweb/pi-subagents"` (relative to `pi-runtime/`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tintinweb-patch-apply.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain .mjs, no types
import { applyHunks } from "../scripts/patch-tintinweb.mjs";
// @ts-expect-error
import { HUNKS } from "../scripts/tintinweb-hunks.mjs";

const fixture = (body: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twpatch-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.ts"), body);
  return root;
};
const hunk = { id: "T1", file: "src/a.ts", find: "const x = 1;", replace: "const x = 2; // hv-patch:T1 $& stays literal" };

describe("applyHunks", () => {
  it("applies once, then is a no-op (npm ci re-runs postinstall)", () => {
    const root = fixture("const x = 1;\n");
    expect(applyHunks(root, [hunk])).toEqual(["T1"]);
    expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("const x = 2; // hv-patch:T1 $& stays literal\n");
    expect(applyHunks(root, [hunk])).toEqual([]);
  });
  it("fails the install on a missing anchor", () => {
    expect(() => applyHunks(fixture("const y = 1;\n"), [hunk])).toThrow(/T1: anchor missing/);
  });
  it("fails the install on an ambiguous anchor", () => {
    expect(() => applyHunks(fixture("const x = 1;\nconst x = 1;\n"), [hunk])).toThrow(/T1: anchor found 2×/);
  });
  it("refuses a replacement without its marker", () => {
    expect(() => applyHunks(fixture("const x = 1;\n"), [{ ...hunk, replace: "const x = 2;" }])).toThrow(/marker/);
  });
});

describe("the vendored package carries every hunk", () => {
  const PKG = path.join(process.cwd(), "pi-runtime/node_modules/@tintinweb/pi-subagents");
  it("is pinned exactly and installed", () => {
    const pkg = JSON.parse(fs.readFileSync("pi-runtime/package.json", "utf8"));
    expect(pkg.dependencies["@tintinweb/pi-subagents"]).toBe("0.19.0");
    expect(fs.existsSync(path.join(PKG, "src/index.ts"))).toBe(true);
  });
  for (const h of HUNKS as Array<{ id: string; file: string }>) {
    it(`carries hv-patch:${h.id}`, () => {
      expect(fs.readFileSync(path.join(PKG, h.file), "utf8")).toContain(`hv-patch:${h.id}`);
    });
  }
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// scripts/patch-tintinweb.mjs
/**
 * HappyVibe's owned patch to the vendored @tintinweb/pi-subagents (PRD §3, 2026-09-26).
 * Each hunk replaces EXACT anchor text. A missing or ambiguous anchor fails the
 * install: a patch that silently stops applying is the security hole it closes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HUNKS } from "./tintinweb-hunks.mjs";

export const TW_PKG = "node_modules/@tintinweb/pi-subagents";

export function applyHunks(pkgRoot, hunks = HUNKS) {
  const applied = [];
  for (const h of hunks) {
    const mark = `hv-patch:${h.id}`;
    if (!h.replace.includes(mark)) throw new Error(`hv-patch ${h.id}: replacement must carry its marker`);
    const file = path.join(pkgRoot, h.file);
    const src = fs.readFileSync(file, "utf8");
    if (src.includes(mark)) continue;
    const n = src.split(h.find).length - 1;
    if (n !== 1) throw new Error(`hv-patch ${h.id}: anchor ${n === 0 ? "missing" : `found ${n}×`} in ${h.file} — re-derive the hunk against this version`);
    fs.writeFileSync(file, src.replace(h.find, () => h.replace)); // fn form: `$&` in a hunk stays literal
    applied.push(h.id);
  }
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pi-runtime", TW_PKG);
  if (!fs.existsSync(root)) throw new Error(`[patch-tintinweb] ${root} is missing — pi-runtime install is broken`);
  const done = applyHunks(root);
  console.log(`[patch-tintinweb] ${done.length ? `applied ${done.join(", ")}` : "already patched"}`);
}
```
`pi-runtime/package.json`: add `"@tintinweb/pi-subagents": "0.19.0"` (keep `pi-subagents` for now) and `"postinstall": "node ../scripts/build-mcp-oauth-bridge.mjs && node ../scripts/patch-tintinweb.mjs"`. Then `(cd pi-runtime && npm install @tintinweb/pi-subagents@0.19.0 --save-exact)` and check `typebox` did not move (`npm ls typebox` — still 1.3.27, one copy); `@sinclair/typebox` arrives as tintinweb's own dep, recorded in tw1.md.

- [ ] **Step 4: Run** the test → PASS; `npm run gate > $L 2>&1; echo EXIT=$?` → 0. `npm run typecheck:ext` output lists any vendored tintinweb diagnostics by count (expected: printed, not failing).

- [ ] **Step 5: Commit** — `git commit -s -m "build(§3): vendor @tintinweb/pi-subagents 0.19.0 with an anchor-exact patch applier"`

### Task 7: Spawn toggle, session dir, settings writer

**Files:**
- Modify: `src/main/pi/spawn.ts` (`PiSpawnOptions`, `-e` list `:199-204`, env `:282-338`)
- Modify: `src/main/subagentSettings.ts`, `src/main/config.ts` (`writeTintinwebSettings` beside `writeSubagentConfig` `:801`), `src/main/ipc.ts:809` (startup call), `:954-1020` (`spawnOpts`)
- Test: `tests/tw-spawn.test.ts`, `tests/tw-settings.test.ts`

**Interfaces:**
- Produces: `PiSpawnOptions.subagentsLib?: "nicobailon" | "tintinweb"`; `TW_RELPATH = "node_modules/@tintinweb/pi-subagents/src/index.ts"`; `subagentsLibFromEnv(env): "nicobailon" | "tintinweb"`; `tintinwebSettings(existing: Record<string, unknown>): Record<string, unknown>`; `writeTintinwebSettings(): void`; env `HV_SUBAGENTS_LIB` for the bridge.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tw-spawn.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolvePiSpawn, TW_RELPATH, subagentsLibFromEnv } from "../src/main/pi/spawn";

const rt = "/rt";
const argsOf = (lib?: "nicobailon" | "tintinweb") =>
  resolvePiSpawn("/ws", "/sessions", rt, { subagentsLib: lib, agentDir: "/agent", sessionId: "s1" });

describe("one sub-agent stack per Pi process", () => {
  it("default is today's stack, untouched", () => {
    const s = argsOf();
    expect(s.args.join(" ")).toContain("node_modules/pi-subagents/src/extension/index.ts");
    expect(s.args.join(" ")).not.toContain(TW_RELPATH);
    expect(s.env.PI_SUBAGENT_PI_BINARY).toBeDefined();
    expect(s.env.HV_HOST).toBeUndefined();
  });
  it("tintinweb: its extension, the host flag, the child session dir — and no child launcher", () => {
    const s = argsOf("tintinweb");
    const e = s.args.flatMap((a, i) => (s.args[i - 1] === "-e" ? [a] : []));
    expect(e).toContain(path.join(rt, TW_RELPATH));
    expect(e.some((p) => p.includes("pi-subagents/src/extension") || p.includes("hv-owner-seed"))).toBe(false);
    expect(e.at(-1)).toBe(path.join(rt, "extensions/happyvibe-bridge.ts"));
    expect(s.env.HV_HOST).toBe("1");
    expect(s.env.HV_SUBAGENTS_LIB).toBe("tintinweb");
    expect(s.env.PI_CODING_AGENT_SESSION_DIR).toBe(path.join("/sessions", "subagents"));
    expect(s.env.PI_SUBAGENT_PI_BINARY).toBeUndefined();
    expect(s.env.HV_SUBAGENT_OWNER).toBeUndefined();
    expect(s.env.PI_MODEL_EXCLUSIONS_PATH).toBeUndefined();
  });
  it("the toggle is an env var, and anything else means today's stack", () => {
    expect(subagentsLibFromEnv({ HV_SUBAGENTS: "tintinweb" })).toBe("tintinweb");
    expect(subagentsLibFromEnv({})).toBe("nicobailon");
    expect(subagentsLibFromEnv({ HV_SUBAGENTS: "yes" })).toBe("nicobailon");
  });
});
```

```ts
// tests/tw-settings.test.ts
import { describe, expect, it } from "vitest";
import { tintinwebSettings } from "../src/main/subagentSettings";

describe("tintinwebSettings — every value stated, none inherited", () => {
  const s = tintinwebSettings({ someUserKey: 1, maxConcurrent: 10, workflowsEnabled: false });
  it("writes the locked set", () => {
    expect(s).toMatchObject({
      widgetMode: "off", fleetView: false, agentMentions: "off", outputTranscript: false,
      schedulingEnabled: false, worktreeIsolation: false, disableDefaultAgents: true,
      fallbackSubagent: "none", reportUsage: false, rememberAgents: true, maxConcurrent: 4,
      workflowsEnabled: true,
    });
  });
  it("keeps keys it does not own", () => expect(s.someUserKey).toBe(1));
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `spawn.ts`: export `TW_RELPATH` and `subagentsLibFromEnv(env) => env.HV_SUBAGENTS === "tintinweb" ? "tintinweb" : "nicobailon"`; in the argv builder, `opts.subagentsLib === "tintinweb"` replaces the two `-e` at `:199-200` with `"-e", path.join(runtimeDir, TW_RELPATH)`; in env, the tintinweb branch omits `HV_SUBAGENT_OWNER`, `PI_SUBAGENT_PI_BINARY`, `PI_MODEL_EXCLUSIONS_PATH`, `HV_CHILD_AUDIT_DIR`, `HV_ARTIFACTS_DIR` and adds `HV_HOST: "1"`, `HV_SUBAGENTS_LIB: "tintinweb"`, `PI_CODING_AGENT_SESSION_DIR: path.join(sessionDir, "subagents")`. `subagentSettings.ts`: `export function tintinwebSettings(existing) { return { ...existing, widgetMode: "off", …exact set above… }; }`. `config.ts`: `writeTintinwebSettings()` merge-writes `path.join(agentDir(), "subagents.json")` (same read-merge-write shape as `writeSubagentConfig`). `ipc.ts`: call it at startup beside `:809`; `spawnOpts` passes `subagentsLib: subagentsLibFromEnv(process.env)` (the utility client too — it must match what sessions load).

- [ ] **Step 4: Run** → both PASS; `tests/mcp-spawn.test.ts` still green (default path unchanged); `npm run gate` → 0.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): HV_SUBAGENTS=tintinweb boots the new stack; the app writes its settings"`

### Task 8: Patch P1–P3 (trust, discovery, host child policy, run identity)

**Files:**
- Create: `pi-runtime/extensions/hv-child-policy.ts`
- Modify: `scripts/tintinweb-hunks.mjs`
- Test: `tests/tintinweb-trust.test.ts` (key-free, boots real Pi with a bogus key — the §3.3 method)

**Interfaces:**
- Produces (`hv-child-policy.ts`, import-free — the renderer and the guard may both import it):

```ts
export const CHILD_POLICY = Symbol.for("hv:child-policy");
export const CHILD_SPAWN = Symbol.for("pi-subagents:child-spawn");
export interface ChildSpawnInfo { agentId?: string; type?: string }
export interface PolicyAuditRow { tool: string; decision: "allow" | "deny"; wouldHave: "allow" | "ask" | "deny"; summary: string; agentId?: string; type?: string; reason?: string }
export type ChildAsk = { agentId?: string; type?: string; tool: string; permTool: string; summary: string };
export interface ChildPolicy {
  extensionPaths(): string[];                 // absolute; the guard
  skillPaths(): string[];                     // approved ∩ enabled ∩ active skill dirs
  refuseSpawn(type: string): string | undefined;  // reason, or undefined to allow
  boundaryFor(type: string | undefined): readonly string[];  // approved tools; read-only when none
  audit(row: PolicyAuditRow): void;
  hasSessionGrant?(permTool: string): boolean;              // Phase 4
  ask?(req: ChildAsk): Promise<"allow" | "allow-run" | "deny">; // Phase 4
}
export const childPolicy = (): ChildPolicy | undefined =>
  (globalThis as Record<symbol, unknown>)[CHILD_POLICY] as ChildPolicy | undefined;
export const currentChildSpawn = (): ChildSpawnInfo | undefined =>
  ((globalThis as Record<symbol, unknown>)[CHILD_SPAWN] as (() => ChildSpawnInfo | undefined) | undefined)?.();
```

- [ ] **Step 1: Write the failing test** — boots `resolvePiSpawn(ws, sessionDir, runtime, { subagentsLib: "tintinweb", agentDir, providerEnv: { OPENROUTER_API_KEY: "sk-bogus" }, model: "openrouter/deepseek/deepseek-v4-flash" })` (Task 7) with one extra `-e tests/fixtures/tw-probe.ts` inserted before the bridge. It spawns via `subagents:rpc:spawn` from a tiny probe extension in `tests/fixtures/tw-probe.ts` (the probe publishes a minimal `CHILD_POLICY` with `extensionPaths: () => [markerGuard]`), and asserts:

```ts
test("an untrusted repo's extensions and packages never load in a child", async () => {
  // fixtures planted before boot:
  //  <ws>/.pi/extensions/evil.ts           → writes <tmp>/evil-ran
  //  <agentDir>/extensions/planted.ts      → writes <tmp>/planted-ran
  //  <ws>/.pi/settings.json                → { packages: ["npm:is-number@7.0.0"] }
  //  <ws>/.pi/subagents.json               → { schedulingEnabled: true }
  await spawnChildAndWaitForFailure(); // the 401 arrives AFTER the loader ran
  expect(fs.existsSync(path.join(tmp, "evil-ran")), "row 6").toBe(false);
  expect(fs.existsSync(path.join(tmp, "planted-ran")), "rows 7–8").toBe(false);
  expect(fs.existsSync(path.join(ws, ".pi", "npm")), "row 9").toBe(false);
  expect(fs.existsSync(path.join(tmp, "guard-ran")), "the host-forced guard DID load").toBe(true);
}, 120_000);

test("agent-file fields cannot reach past the policy", async () => {
  // <ws>/.pi/agents/sneaky.md: tools: read; extensions: [./evil.ts]; memory: project; session_dir: <tmp>/leak
  await spawnChildAndWaitForFailure("sneaky");
  expect(fs.existsSync(path.join(tmp, "evil-ran"))).toBe(false);
  expect(fs.existsSync(path.join(ws, ".pi", "agent-memory"))).toBe(false);
  expect(fs.existsSync(path.join(tmp, "leak"))).toBe(false);
}, 120_000);

test("the guard knows which run it is guarding", async () => {
  await spawnChildAndWaitForFailure();
  // markerGuard writes JSON.stringify(currentChildSpawn()) at factory time
  const info = JSON.parse(fs.readFileSync(path.join(tmp, "guard-ran"), "utf8"));
  expect(typeof info.agentId).toBe("string");
  expect(info.type).toBe("code-explorer");
}, 120_000);

test("HV_HOST=1 with no policy registered refuses to build a child", async () => {
  await bootWithoutPolicy();
  const reply = await rpcSpawn();
  expect(reply.success === false || lifecycle.some((e) => e.event === "subagents:failed")).toBe(true);
  expect(lastError()).toMatch(/child policy missing/);
}, 120_000);
```
(`spawnChildAndWaitForFailure`, `bootWithoutPolicy`, `rpcSpawn`, `lastError` are local helpers in the file; they drive the probe over `PiClient` exactly like `tests/child-guard-bridge.test.ts` drives the bridge.)

- [ ] **Step 2: Run** → FAIL (evil-ran exists — the §3.3 regression reproduced; that failure is the proof the test tests something).

- [ ] **Step 3: Implement the hunks** (append to `HUNKS`, anchors verbatim from 0.19.0; option names as verified in Task 2):

```js
// scripts/tintinweb-hunks.mjs
export const HUNKS = [
  {
    id: "P3-context",
    file: "src/child-context.ts",
    find: `const childSessionContext = new AsyncLocalStorage<boolean>();

export function inChildSessionContext(): boolean {
  return childSessionContext.getStore() === true;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>): Promise<T> {
  return childSessionContext.run(true, fn);
}`,
    replace: `// hv-patch:P3-context — the store names the child being built, so a host guard loaded into it knows its run.
export interface ChildSpawnInfo { agentId?: string; type?: string }
const childSessionContext = new AsyncLocalStorage<ChildSpawnInfo>();
(globalThis as any)[Symbol.for("pi-subagents:child-spawn")] = (): ChildSpawnInfo | undefined => childSessionContext.getStore();

export function inChildSessionContext(): boolean {
  return childSessionContext.getStore() !== undefined;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>, info: ChildSpawnInfo = {}): Promise<T> {
  return childSessionContext.run(info, fn);
}`,
  },
  {
    id: "P3-helper",
    file: "src/agent-runner.ts",
    find: `import { runInChildSessionContext } from "./child-context.js";`,
    replace: `import { runInChildSessionContext } from "./child-context.js";
// hv-patch:P3-helper — HappyVibe's host child policy. Under HV_HOST=1 a missing policy fails closed.
const hvChildPolicy = (): undefined | { extensionPaths(): string[]; skillPaths(): string[] } => {
  const p = (globalThis as any)[Symbol.for("hv:child-policy")];
  if (!p && process.env.HV_HOST === "1") throw new Error("HappyVibe: child policy missing — refusing to build a sub-agent without its guard");
  return p;
};`,
  },
  {
    id: "P1-loader",
    file: "src/agent-runner.ts",
    find: `  const loader = new DefaultResourceLoader({
    cwd: configCwd,
    agentDir,
    noExtensions,
    additionalExtensionPaths,
    extensionsOverride,
    noSkills,
`,
    replace: `  // hv-patch:P1-loader — P1 inherit the parent's trust; P2 no discovery for path lists; P3 the host decides what loads.
  const hvPolicy = hvChildPolicy();
  const hvSettings = SettingsManager.create(configCwd, agentDir, { projectTrusted: ctx.isProjectTrusted?.() ?? false });
  const loader = new DefaultResourceLoader({
    cwd: configCwd,
    agentDir,
    settingsManager: hvSettings,
    noExtensions: hvPolicy ? true : noExtensions || (!!additionalExtensionPaths && keepNames.size === 0 && !loadAll),
    additionalExtensionPaths: hvPolicy ? hvPolicy.extensionPaths() : additionalExtensionPaths,
    extensionsOverride: hvPolicy ? undefined : extensionsOverride,
    noSkills: hvPolicy ? true : noSkills,
    ...(hvPolicy ? { additionalSkillPaths: hvPolicy.skillPaths() } : {}),
`,
  },
  {
    id: "P3-identity",
    file: "src/agent-runner.ts",
    find: `  await runInChildSessionContext(() => loader.reload());`,
    replace: `  await runInChildSessionContext(() => loader.reload(), { agentId: options.agentId, type }); // hv-patch:P3-identity`,
  },
  {
    id: "P1-settings",
    file: "src/agent-runner.ts",
    find: `  const settingsManager = SettingsManager.create(configCwd, agentDir);`,
    replace: `  const settingsManager = hvSettings; // hv-patch:P1-settings — one trust-inheriting manager for loader AND session`,
  },
  {
    id: "P3-memory",
    file: "src/agent-runner.ts",
    find: `  if (agentConfig?.memory) {`,
    replace: `  if (agentConfig?.memory && !hvChildPolicy()) { // hv-patch:P3-memory — agent memory is §33's, never an agent file's`,
  },
  {
    id: "P3-sessiondir",
    file: "src/agent-runner.ts",
    find: `  const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);`,
    replace: `  const configuredSessionDir = hvChildPolicy() ? undefined : resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd); // hv-patch:P3-sessiondir`,
  },
];
```
Note the ordering hazard: `hvSettings` is declared in `P1-loader` (line ~747) and consumed by `P1-settings` (line ~955, later in the same function) — correct order. `P3-memory` runs BEFORE the loader (line ~654) and therefore calls `hvChildPolicy()` itself rather than reading `hvPolicy`.

- [ ] **Step 4: Re-install and run** — `(cd pi-runtime && npm ci) && npx vitest run tests/tintinweb-trust.test.ts tests/tintinweb-patch-apply.test.ts > $L 2>&1; echo EXIT=$?` → 0.

- [ ] **Step 5: Commit** — `git commit -s -m "fix(§3): tintinweb children inherit trust and load only what the host forces (P1–P3)"`

### Task 9: Patch P3(d), P4, P5, P6 (refusals, settings lock, workflow hardening, host control verbs)

> **Phase 0 corrections:** the hunks are already in `scripts/tintinweb-hunks.mjs`. `P3-refuse` is anchored on `spawn()`'s preceding comment line, because `assertValidSpawnCwd(options.cwd);` occurs twice in `agent-manager.ts` (`:499` spawn, `:674` queued re-check). A new hunk **`P6-progress`** (`src/index.ts:2358`) forwards the workflow runtime's `onProgress(entries)` as `pi.events.emit("subagents:workflow-progress", { runId, entries })` — measured: a `SubagentWorkflow` tool call writes NO session entry while it runs and its children emit no bus events, so this is the only live progress source. Add its source-scan pin beside P6's.

**Files:**
- Modify: `scripts/tintinweb-hunks.mjs`
- Test: `tests/tintinweb-patch-contract.test.ts` (unit, imports the PATCHED vendored modules directly — the deep-import pattern `tests/subagent-preflight-shape.test.ts` already uses)

- [ ] **Step 1: Write the failing test**

```ts
// tests/tintinweb-patch-contract.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveModel } from "../pi-runtime/node_modules/@tintinweb/pi-subagents/src/model-resolver";
import { loadSettings } from "../pi-runtime/node_modules/@tintinweb/pi-subagents/src/settings";

const POLICY = Symbol.for("hv:child-policy");
const registry = {
  getAvailable: () => [{ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
  getAll: () => [], find: (p: string, id: string) => ({ provider: p, id }),
};

describe("P3(d) — only an exact provider/modelId under HappyVibe", () => {
  afterEach(() => { delete (globalThis as any)[POLICY]; });
  it("exact still resolves", () => {
    (globalThis as any)[POLICY] = {};
    expect(resolveModel("openrouter/deepseek/deepseek-v4-flash", registry as any)).toMatchObject({ provider: "openrouter" });
  });
  it("fuzzy is refused with a sentence, not substituted", () => {
    (globalThis as any)[POLICY] = {};
    const r = resolveModel("deepseek", registry as any);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/not an exact provider\/modelId/);
  });
  it("upstream behaviour without the host is untouched", () => {
    expect(typeof resolveModel("deepseek", registry as any)).toBe("object");
  });
});

describe("P4 — a project's subagents.json never overrides the host", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-p4-"));
    fs.mkdirSync(path.join(cwd, ".pi"));
    fs.writeFileSync(path.join(cwd, ".pi", "subagents.json"), JSON.stringify({ schedulingEnabled: true }));
  });
  afterEach(() => { delete process.env.HV_HOST; });
  it("HV_HOST=1 reads global only", () => {
    process.env.HV_HOST = "1";
    expect(loadSettings(cwd).schedulingEnabled).toBeUndefined();
  });
  it("without the host, upstream still merges", () => {
    expect(loadSettings(cwd).schedulingEnabled).toBe(true);
  });
});

describe("P5 + P6 — by source, because they sit behind a worker and the bus", () => {
  const src = (f: string) => fs.readFileSync(path.join("pi-runtime/node_modules/@tintinweb/pi-subagents/src", f), "utf8");
  it("P5a: executeGate returns a refusal before pi.exec under HV_HOST", () => {
    const s = src("workflow/host.ts");
    const i = s.indexOf("async function executeGate");
    expect(s.indexOf("hv-patch:P5-gate", i)).toBeGreaterThan(i);
    expect(s.indexOf("hv-patch:P5-gate", i)).toBeLessThan(s.indexOf("pi.exec(", i));
  });
  it("P5b: saved workflows come from the agent dir only under HV_HOST", () => {
    expect(src("workflow/saved.ts")).toMatch(/hv-patch:P5-saved/);
  });
  it("P6: steer and workflow-stop are on the bus and torn down on shutdown", () => {
    expect(src("cross-extension-rpc.ts")).toMatch(/"subagents:rpc:steer"/);
    expect(src("cross-extension-rpc.ts")).toMatch(/"subagents:rpc:workflow-stop"/);
    expect(src("index.ts")).toMatch(/rpcHandle\?\.unsubSteer\(\)/);
    expect(src("index.ts")).toMatch(/rpcHandle\?\.unsubWorkflowStop\(\)/);
  });
  it("P3(d): every spawn path passes the refusal", () => {
    const s = src("agent-manager.ts");
    const spawn = s.indexOf("  spawn(\n");
    expect(s.indexOf("hv-patch:P3-refuse", spawn)).toBeGreaterThan(spawn);
    expect(s.indexOf("hv-patch:P3-refuse", spawn)).toBeLessThan(s.indexOf("randomUUID()", spawn));
  });
});
```
Plus a behavioural test for P5a + P6 + refusal in `tests/tw-workflow-bridge.test.ts` (Task 16) and `tests/tw-lifecycle-bridge.test.ts` (Task 12) — the source scans here pin placement; those pin behaviour.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — append:

```js
  {
    id: "P3-model",
    file: "src/model-resolver.ts",
    find: `  // 2. Fuzzy match against available models.`,
    replace: `  // hv-patch:P3-model — under HappyVibe only an exact, usable provider/modelId is accepted (PRD §16: refuse, never substitute).
  if ((globalThis as any)[Symbol.for("hv:child-policy")]) return \`Model "\${input}" is not an exact provider/modelId HappyVibe can use. Name it exactly as provider/model, or omit it to use the agent's default.\`;
  // 2. Fuzzy match against available models.`,
  },
  {
    id: "P3-refuse",
    file: "src/agent-manager.ts",
    find: `    assertValidSpawnCwd(options.cwd);
`,
    replace: `    assertValidSpawnCwd(options.cwd);
    { const hvRefusal = (globalThis as any)[Symbol.for("hv:child-policy")]?.refuseSpawn?.(type); if (hvRefusal) throw new Error(hvRefusal); } // hv-patch:P3-refuse
`,
  },
  {
    id: "P4-settings",
    file: "src/settings.ts",
    find: `  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };`,
    replace: `  // hv-patch:P4-settings — under HappyVibe a project's own subagents.json is never read (the project is untrusted by construction).
  if (process.env.HV_HOST === "1") return readSettingsFile(globalPath());
  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };`,
  },
  {
    id: "P5-gate",
    file: "src/workflow/host.ts",
    find: `  async function executeGate(command: string, cwd: string): Promise<WorkflowGateResult> {
`,
    replace: `  async function executeGate(command: string, cwd: string): Promise<WorkflowGateResult> {
    // hv-patch:P5-gate — a gate is a shell command that would never reach HappyVibe's bash rules.
    if (process.env.HV_HOST === "1") return { ok: false, output: \`HappyVibe does not run workflow gate commands — run the check with the bash tool instead: \${command}\` };
`,
  },
  {
    id: "P5-saved",
    file: "src/workflow/saved.ts",
    find: `    join(cwd, ".pi", "workflows"),
    join(cwd, ".agents", "workflows"),
`,
    replace: `    ...(process.env.HV_HOST === "1" ? [] : [join(cwd, ".pi", "workflows"), join(cwd, ".agents", "workflows")]), // hv-patch:P5-saved
`,
  },
  {
    id: "P6-types",
    file: "src/cross-extension-rpc.ts",
    find: `  consumeResult(id: string): boolean;
}`,
    replace: `  consumeResult(id: string): boolean;
  /** hv-patch:P6-types — host control verbs. */
  steer?(id: string, message: string): boolean;
  stopWorkflow?(runId: string): boolean;
}`,
  },
  {
    id: "P6-handle",
    file: "src/cross-extension-rpc.ts",
    find: `  unsubConsume: () => void;
}`,
    replace: `  unsubConsume: () => void;
  unsubSteer: () => void; // hv-patch:P6-handle
  unsubWorkflowStop: () => void;
}`,
  },
  {
    id: "P6-control",
    file: "src/cross-extension-rpc.ts",
    find: `  return { unsubPing, unsubSpawn, unsubStop, unsubConsume };`,
    replace: `  // hv-patch:P6-control — steer a running top-level agent; stop a workflow run (the TUI menu was the only way).
  const unsubSteer = handleRpc<{ requestId: string; agentId: string; message: string }>(
    events, "subagents:rpc:steer", ({ agentId, message }) => {
      const record = manager.getRecord(agentId);
      if (!record) throw new Error("Agent not found");
      if (!isTopLevelAgent(record)) throw new Error("Agent is owned by another agent or workflow");
      if (!manager.steer?.(agentId, message)) throw new Error("Agent is not running");
    },
  );
  const unsubWorkflowStop = handleRpc<{ requestId: string; runId: string }>(
    events, "subagents:rpc:workflow-stop", ({ runId }) => {
      if (!manager.stopWorkflow?.(runId)) throw new Error("Workflow is not running");
    },
  );
  return { unsubPing, unsubSpawn, unsubStop, unsubConsume, unsubSteer, unsubWorkflowStop };`,
  },
  {
    id: "P6-facade",
    file: "src/index.ts",
    find: `          abort: (id) => manager.abort(id),
`,
    replace: `          abort: (id) => manager.abort(id),
          // hv-patch:P6-facade — same semantics as the @handle steer path (un-consume so the reply is relayed).
          steer: (id: string, message: string) => {
            const rec = manager.getRecord(id) as any;
            if (rec) rec.resultConsumed = false;
            const ok = manager.steer(id, message);
            if (ok) pi.events.emit("subagents:steered", { id, message });
            return ok;
          },
          stopWorkflow: (runId: string) => {
            const t = workflowTasks.get(runId);
            if (!t || t.abortController.signal.aborted) return false;
            t.abortController.abort();
            return true;
          },
`,
  },
  {
    id: "P6-teardown",
    file: "src/index.ts",
    find: `    rpcHandle?.unsubConsume();
`,
    replace: `    rpcHandle?.unsubConsume();
    rpcHandle?.unsubSteer(); // hv-patch:P6-teardown
    rpcHandle?.unsubWorkflowStop();
`,
  },
```
Confirm by reading, before running: `workflowTasks` (index.ts:2312) is the map the TUI's `onKill` aborts (`ui/workflow-menu.ts:93`) and is keyed by the same run id the `subagents:workflow` entries carry (Task 3 captured it) — if not, key by what the entries carry.

- [ ] **Step 4: Re-install and run** → `(cd pi-runtime && npm ci)`; the contract test + `tests/tintinweb-patch-apply.test.ts` PASS; `npm run gate` → 0.

- [ ] **Step 5: Commit** — `git commit -s -m "fix(§3): tintinweb patch P3(d)–P6 — refusals, settings lock, gate refusal, steer + workflow-stop verbs"`

### Task 10: The bridge gates the four tintinweb tools

**Files:**
- Create: `pi-runtime/extensions/hv-tw-gate.ts`
- Modify: `pi-runtime/extensions/hv-plan.ts:174-176,298-304`, `pi-runtime/extensions/hv-readonly.ts:36`, `pi-runtime/extensions/hv-rules.ts:98` (`SAFE_TOOLS`), `pi-runtime/extensions/happyvibe-bridge.ts:1078-1197` (the subagent branch)
- Test: `tests/hv-tw-gate.test.ts`, `tests/hv-plan.test.ts` (extend), `tests/tw-gate-bridge.test.ts` (LIVE)

**Interfaces:**
- Consumes: `boundaryRuleName`, `summarizeBoundary`, `BoundarySummary` (`hv-subagent-boundary.ts`); `isResultWait` (Task 5).
- Produces (`hv-tw-gate.ts`, pure):
  - `twAgentOf(tool: string, input: Record<string, unknown>): string | null` — `Agent` → `input.subagent_type` (string) else null.
  - `twBoundary(agent: string, cfg: { builtinToolNames?: string[] } | undefined, input: Record<string, unknown>): BoundarySummary` — `explicitAllowlist = !!cfg?.builtinToolNames`, tools from the config, `context: input.inherit_context === true ? "fork" : "fresh"`; an unknown agent (`cfg` undefined) is summarised read-only with `declared:false`.
  - `WORKFLOW_TOOL = "SubagentWorkflow"`, `STEER_TOOL = "steer_subagent"`, `RESULT_TOOL = "get_subagent_result"`.
- Bridge-local: `approvedBoundaries: Map<string, string[]>` keyed by agent type — last approved tools per type (identical per type, because they come from the same agent file).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hv-tw-gate.test.ts
import { describe, expect, it } from "vitest";
import { twAgentOf, twBoundary } from "../pi-runtime/extensions/hv-tw-gate";
import { boundaryRuleName } from "../pi-runtime/extensions/hv-subagent-boundary";

describe("tintinweb delegation gating keeps the rule vocabulary", () => {
  it("an Agent call gates as subagent:<type>", () => {
    const agent = twAgentOf("Agent", { subagent_type: "worker", prompt: "x", description: "y" });
    expect(agent).toBe("worker");
    expect(boundaryRuleName(agent!)).toBe("subagent:worker");
  });
  it("only Agent is a delegation for the boundary", () => {
    expect(twAgentOf("SubagentWorkflow", { script: "…" })).toBeNull();
    expect(twAgentOf("Agent", { prompt: "no type" })).toBeNull();
  });
  it("a declared write-capable toolset is named on the boundary", () => {
    const b = twBoundary("worker", { builtinToolNames: ["read", "bash", "write"] }, {});
    expect(b.declared).toBe(true);
    expect(b.writeCapable).toEqual(expect.arrayContaining(["bash", "write"]));
    expect(b.context).toBe("fresh");
  });
  it("inherit_context is shown, not clamped", () => {
    expect(twBoundary("code-explorer", { builtinToolNames: ["read"] }, { inherit_context: true }).context).toBe("fork");
  });
  it("an agent with no tools: line is read-only", () => {
    const b = twBoundary("x", {}, {});
    expect(b.declared).toBe(false);
    expect(b.writeCapable).toEqual([]);
  });
});
```
Extend `tests/hv-plan.test.ts`:
```ts
it("tintinweb names: Agent needs a boundary, a workflow is blocked, steer/result pass", () => {
  expect(gatePlanCall("Agent", { subagent_type: "code-explorer" })).toEqual({ kind: "needs-boundary" });
  expect(gatePlanCall("SubagentWorkflow", { script: "x" }).kind).toBe("block");
  expect(gatePlanCall("steer_subagent", { agent_id: "a", message: "m" })).toEqual({ kind: "pass" });
  expect(gatePlanCall("get_subagent_result", { agent_id: "a" })).toEqual({ kind: "pass" });
});
```
`tests/tw-gate-bridge.test.ts` (LIVE, `skipIf(!KEY)`, `subagentsLib:"tintinweb"`): (a) rules deny `subagent:worker` → prompt never shows, `hv.audit` row `{tool:"subagent:worker", decision:"deny", source:"rule"}`; (b) no rule → a `select` whose title parses to `{kind:"hv.permission", tool:"subagent:code-explorer", boundary:{agent:"code-explorer", …}}`, answered `Deny` → audit `source:"user"`; (c) the model calls `get_subagent_result` with `wait:true` → `{block:true}` whose reason contains "End your turn"; (d) a switched-off agent (`agentsEnabled.worker=false`) → refused with "switched off" before any prompt. Use `askUntil` for each model-dependent step.

- [ ] **Step 2: Run** the key-free ones → FAIL.

- [ ] **Step 3: Implement**
  - `hv-plan.ts`: add `"SubagentWorkflow"` to `BLOCKED_PLAN_TOOLS` (a workflow is code — spec decision 7), `"steer_subagent"` and `"get_subagent_result"` to `PLAN_PASS_TOOLS`, and at `:304` `if (isDelegationTool(toolName)) return { kind: "needs-boundary" };`.
  - `hv-readonly.ts`: nothing to add — `gateReadonlyCall` passes through `gatePlanCall`, so the workflow block holds for `HV_READONLY` runs; assert it in `tests/hv-readonly.test.ts`: `expect(gateReadonlyCall("SubagentWorkflow", {}).kind).toBe("block")`.
  - `hv-rules.ts` `SAFE_TOOLS`: add `"steer_subagent"` (cannot widen a boundary — spec §4.3) and `"get_subagent_result"`.
  - Bridge, tintinweb branch (guard every new line with `const TW = process.env.HV_SUBAGENTS_LIB === "tintinweb";`): at the wait intercept `:1078`, also `if (TW && isResultWait(tool, input)) return { block: true, reason: <same guidance text> };`; subagent name `:1116` → `TW ? twAgentOf(tool, input) : (tool === "subagent" && …)`; external-CLI refusal `:1142` stays nicobailon-only; boundary `:1156` → `TW ? twBoundary(name, twAgents().get(name), input) : await resolveBoundary(name)`, where `twAgents()` calls tintinweb's `loadCustomAgents(process.cwd())` via the relative import `../node_modules/@tintinweb/pi-subagents/src/custom-agents.ts` (pinned by the contract test in Task 20 — never a bare specifier; the package has no exports map); disabled check before the prompt: `if (TW && name && disabledAgents().has(name)) return block("'<name>' is switched off on the Agents page.")` where `disabledAgents()` reads `HV_DISABLED_AGENTS` (comma list spawn.ts sets from `load().agentsEnabled`); `grantBoundary` on TW → `approvedBoundaries.set(name, boundary.tools)` instead of widening the nicobailon ceiling.
  - `spawn.ts`: set `HV_DISABLED_AGENTS` on the tintinweb path (`Object.entries(agentsEnabled).filter(([,on]) => !on).map(([n]) => n).join(",")`); `spawnOpts` passes `agentsEnabled: load().agentsEnabled ?? {}`.

- [ ] **Step 4: Run** key-free tests → PASS; `npm run gate` → 0; run `tests/tw-gate-bridge.test.ts` live (after `live:why`) → PASS, wall time > 60 s.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): the bridge gates Agent / SubagentWorkflow / steer / result under the existing rule names"`

### Task 11: The in-process child guard (parity: boundary, ask→deny, confinement, audit)

**Files:**
- Modify: `pi-runtime/extensions/hv-child-guard.ts` (factory `:188`; keep the env-mode path for nicobailon until Task 20)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (publish the policy in the factory, right after `builtins` at `:734`)
- Test: `tests/child-guard-inproc.test.ts` (pure), `tests/tw-child-guard-bridge.test.ts` (LIVE)

**Interfaces:**
- Consumes: `childPolicy()`, `currentChildSpawn()` (Task 8), `childDecision` (`hv-child-rules.ts:56`), `escapesWorkspace(tool, input, workspace, alsoAllowed)` (`hv-child-guard.ts:147`), `approvedBoundaries` (Task 10).
- Produces: `guardDecision(args: { tool: string; input: Record<string, unknown>; boundary: readonly string[]; rules: RulesFile; rulesReadable: boolean; bypass: boolean; workspace: string }): { action: "allow" | "deny"; reason?: string; wouldHave: RuleAction }` exported from `hv-child-guard.ts`.

- [ ] **Step 1: Write the failing pure test**

```ts
// tests/child-guard-inproc.test.ts
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { guardDecision } from "../pi-runtime/extensions/hv-child-guard";
import { parseRulesFile } from "../pi-runtime/extensions/hv-rules";

const ws = path.join(os.tmpdir(), "hv-guard-ws");
const rules = parseRulesFile(JSON.stringify({ global: [], workspaces: {} }));
const base = { rules, rulesReadable: true, bypass: false, workspace: ws };

describe("guardDecision — the three §12 layers, composed in one place", () => {
  it("a tool outside the approved boundary is denied, naming the boundary", () => {
    const d = guardDecision({ ...base, tool: "bash", input: { command: "ls" }, boundary: ["read", "grep", "find", "ls"] });
    expect(d.action).toBe("deny");
    expect(d.reason).toMatch(/outside the boundary/);
  });
  it("inside the boundary, an ask is still denied (Phase 1: nobody to ask)", () => {
    const d = guardDecision({ ...base, tool: "write", input: { path: path.join(ws, "a.txt"), content: "x" }, boundary: ["read", "write"] });
    expect(d).toMatchObject({ action: "deny", wouldHave: "ask" });
  });
  it("an allowed write outside the workspace is still refused", () => {
    const allow = parseRulesFile(JSON.stringify({ global: [{ layer: "tool", pattern: "write", action: "allow" }], workspaces: {} }));
    const d = guardDecision({ ...base, rules: allow, tool: "write", input: { path: "/etc/x", content: "x" }, boundary: ["write"] });
    expect(d.action).toBe("deny");
  });
  it("bypass extends to children, and still reports what the rules would have said", () => {
    const d = guardDecision({ ...base, bypass: true, tool: "bash", input: { command: "ls" }, boundary: ["bash"] });
    expect(d.action).toBe("allow");
  });
  it("unreadable rules fail closed for anything not safe", () => {
    expect(guardDecision({ ...base, rulesReadable: false, tool: "bash", input: { command: "ls" }, boundary: ["bash"] }).action).toBe("deny");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `hv-child-guard.ts`: extract the body of the `tool_call` handler (`:230-282`) into `guardDecision` (boundary check first: `tool ∉ boundary && !SAFE_TOOLS.has(tool)` ⇒ deny `"'<tool>' is outside the boundary approved for this sub-agent — ask the parent to delegate with a wider agent."`; then `childDecision`; then `escapesWorkspace`). The factory branches: `const policy = childPolicy(); if (policy) { inProcess(pi, policy); return; }` — `inProcess` captures `const who = currentChildSpawn()` at FACTORY time (the only moment the P3-context store is set), reads rules from `HV_RULES_FILE` exactly as today (same process env), and on each `tool_call` calls `guardDecision({ …, boundary: policy.boundaryFor(who?.type) })`, then `policy.audit({ tool, decision, wouldHave, summary: summarise(input), agentId: who?.agentId, type: who?.type, reason })`. The env-mode path (`PI_SUBAGENT_RUN_ID`, `HV_CHILD_AUDIT_DIR`, `taskFileFromArgv`) is untouched.
  - Bridge (TW only): 
```ts
(globalThis as Record<symbol, unknown>)[CHILD_POLICY] = {
  extensionPaths: () => [path.join(path.dirname(fileURLToPath(import.meta.url)), "hv-child-guard.ts")],
  skillPaths: () => approvedSkillDirs(),          // the dirs main put in HV_SKILLS_FILE's manifest
  refuseSpawn: (type: string) => (disabledAgents().has(type) ? `'${type}' is switched off on the Agents page.` : undefined),
  boundaryFor: (type?: string) => (type && approvedBoundaries.get(type)) || READ_ONLY_CHILD_TOOLS,
  audit: (row: PolicyAuditRow) => busUi && audit(busUi, { tool: row.tool, summary: row.summary, decision: row.decision, source: "subagent" as AuditSource, wouldHave: row.wouldHave, agent: row.type, runId: row.agentId }),
} satisfies ChildPolicy;
```
    Add `"subagent"` to `AuditSource` (`:680`) and `agent?`/`runId?` to the row (AuditView already renders both — `AuditView.tsx:26-31,300`). `approvedSkillDirs()` reuses the bridge's existing manifest read (`hv-skills.ts`). If `import.meta.url` is not available under Pi's loader, use `process.env.HV_CHILD_GUARD` (set by spawn.ts to the absolute path) — decide by running Step 4.

- [ ] **Step 4: Run** the pure test → PASS. `tests/tw-child-guard-bridge.test.ts` (LIVE) mirrors `tests/child-guard-bridge.test.ts` on the tintinweb path and asserts on **audit envelopes on the parent's stdout** (the honest witness — `tool_execution_start` fires before handlers): (a) `writer` approved with `write` + no write rule ⇒ a `hv.audit` `{source:"subagent", tool:"write", decision:"deny", wouldHave:"ask"}` and `note.txt` absent; (b) with a write allow rule ⇒ the file exists; (c) `code-explorer` (read-only) tries `bash` ⇒ deny row with the boundary reason. Wall time sanity-checked.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): the child guard runs in-process — boundary, ask→deny, confinement, native audit rows"`

### Task 12: Lifecycle relay, busy gate, stop, resync

**Files:**
- Create: `pi-runtime/extensions/hv-tw-relay.ts`
- Modify: `happyvibe-bridge.ts:1670-1767` (register the relay instead of the nicobailon listeners when TW), `src/main/ipc.ts:1638-1665,1759-1842` (use `runId` from notifies; no `asyncDir` on TW)
- Test: `tests/hv-tw-relay.test.ts` (pure mapping), `tests/tw-lifecycle-bridge.test.ts` (LIVE)

**Interfaces:**
- Produces: `twNotify(event: string, payload: Record<string, unknown>): SubagentNotify | null` — `subagents:started` → `{stage:"started", runId: id, agent: type, task: description}`; `subagents:completed` → `{stage:"complete", runId: id, agent: type, status:"success", summary: String(result).slice(0,500)}`; `subagents:failed` → `status: payload.status === "stopped" || payload.status === "aborted" ? "interrupted" : "error"` (exact status strings from Task 3's capture); other events → null. `registerTwRelay(pi, { notify, running: Set<string> })`. Commands on TW: `/hv-subagent-interrupt <runId>` → `subagents:rpc:stop {agentId: runId}`; `/hv-subagent-list` → `{stage:"active", runs: [...running].map(runId => ({runId}))}` (children die with the process, so after a respawn this is `[]`).

- [ ] **Step 1: Failing test** — `tests/hv-tw-relay.test.ts` feeds the Task 3 captured payloads (pasted verbatim as fixtures) through `twNotify` and asserts the three stages and the status mapping, plus `summary.length <= 500`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the pure mapper + `registerTwRelay` (listens on `pi.events`, keeps `running`, relays via `busUi.notify(JSON.stringify({kind:"hv.subagent", ...n}))` — the same envelope `subEnvelope` builds today, so main and the renderer need no new parser). `ipc.ts`: on TW a `started` notify has no `asyncDir`, so `startSubagentPoll` is not called there (Task 14 adds the TW poller); `activity.asyncStarted/asyncEnded` fire exactly as today off `started`/`complete`.
- [ ] **Step 4: Run** pure → PASS; LIVE `tests/tw-lifecycle-bridge.test.ts`: a background `Agent` run produces `started` then `complete` notifies with the same `runId`; **between them** a probe `/hv-subagent-list` answers `runs` containing it (the busy-gate input); `/hv-subagent-interrupt <runId>` on a second long run yields `complete` with `status:"interrupted"`. `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): relay tintinweb lifecycle as hv.subagent — busy gate, stop and resync unchanged for main"`

---

## Phase 2 — GUI parity and the new controls

### Task 13: Full-result delivery keyed on `<task-id>`

**Files:**
- Modify: `pi-runtime/extensions/hv-subagent-delivery.ts`, `happyvibe-bridge.ts:973-982` (context hook) and the relay (remember full results)
- Test: `tests/hv-subagent-delivery.test.ts` (extend), `tests/tw-lifecycle-bridge.test.ts` (extend)

**Interfaces:**
- Produces: `rememberTwResult(store: ChildOutputStore, id: string, agent: string | undefined, result: string): void`; `substituteTwNotification(content: string, store: ChildOutputStore): string | null`; `substituteDeliveries` gains the TW branch keyed on the message shape Task 3 captured (`customType` + `<task-notification>` text).

- [ ] **Step 1: Failing tests** (fixture = the captured notification, verbatim):

```ts
it("repairs a truncated <task-notification> with the full result for its own <task-id>", () => {
  const store = createChildOutputStore();
  rememberTwResult(store, "a1", "worker", "FULL-A ".repeat(200));
  rememberTwResult(store, "b2", "worker", "FULL-B ".repeat(200));
  const outA = substituteTwNotification(CAPTURED_NOTIFICATION.replace("<ID>", "a1"), store)!;
  const outB = substituteTwNotification(CAPTURED_NOTIFICATION.replace("<ID>", "b2"), store)!;
  expect(outA).toContain("FULL-A ".repeat(200).trim());
  expect(outA).not.toContain("FULL-B");                 // Review Focus #2
  expect(outB).toContain("FULL-B ".repeat(200).trim());
});
it("refuses what it does not recognise", () => {
  const store = createChildOutputStore();
  expect(substituteTwNotification("<task-notification><task-id>zz</task-id></task-notification>", store)).toBeNull();
  rememberTwResult(store, "big", "w", "x".repeat(40_000));
  expect(substituteTwNotification(CAPTURED_NOTIFICATION.replace("<ID>", "big"), store)).toBeNull(); // > MAX_INLINE_DELIVERY
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — reuse `MAX_INLINE_DELIVERY`, `MAX_REMEMBERED`; substitute only the `<result>…</result>` body inside the matching `<task-notification>`, leaving the rest byte-identical; the relay calls `rememberTwResult` from `subagents:completed.result` (the untruncated text, spec decision 4).
- [ ] **Step 4: Run** → PASS; LIVE extension: a child asked to produce a ~3,000-char report → the parent's next turn quotes its LAST line without calling `get_subagent_result` (assert zero `get_subagent_result` tool calls in that turn — the "4 calls → 1" measurement, re-taken; record in d1.md).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): the parent receives the child's full answer on the tintinweb path"`

### Task 14: Child sessions — discovery, live status, inspect, thinking, cost, delete, sweep

**Files:**
- Create: `src/main/twChildren.ts`
- Modify: `src/main/store.ts` (`deleteSessionChildren` `:430`, `sweepOrphanedSubagentData` `:463`), `src/main/sessionLedger.ts:31` (`sessionCalls`), `src/main/ipc.ts` (poller on TW `started`; `hv:subagent-inspect` on TW)
- Test: `tests/tw-children.test.ts`

**Interfaces:**
- Produces:
  - `TW_CHILD_DIR = "subagents"`
  - `twChildSessionFiles(sessionDirPath: string, parentSessionFile: string): string[]` — scans `<sessionDir>/subagents/*.jsonl`, keeps those whose FIRST line's header has `parentSession === parentSessionFile`. `// ponytail: O(n) header scan per call; index by parent in a sidecar file if sessions ever number in the thousands.`
  - `twChildStatus(file: string): SubagentStatus` — the same shape `readSubagentStatus` returns (`turnCount`, `toolCount`, `currentTool`, `recentTools`, `context: {window, limit?}` from the last assistant `usage`), so `hv:subagent-status` and the card are unchanged.
  - `twInspect(sessionDirPath: string, file: string): InspectReply` — `messages` + `finalOutput` from the file, the `InspectReply` shape `subagentInspect.ts:40` already defines; path must resolve under `<sessionDir>/subagents` or it answers `{error:{code:"outside"}}`.
- **Temp workflow files (measured, tw1.md finding 2):** workflows write their script and journal to `<os.tmpdir()>/pi-subagents-<uid>/<cwd-slug>/<parent Pi session id>/tasks/`. `deleteSessionChildren` also removes `<os.tmpdir()>/pi-subagents-<process.getuid()>/*/<parent session id>/` (the id is the parent file's header `id`; match the directory NAME exactly, never a prefix), and the sweep removes such a directory whose session id no longer exists. Test with a fixture tree under a fake tmpdir root passed as a parameter.
- ipc: map `runId → childSessionFile` filled from the notify's `sessionFile` (Task 12 adds `sessionFile` to `started`, or to a follow-up `{stage:"control", runId, sessionFile}` if Task 3 showed the path is only known later); the TW poller = `setInterval(500)` over `twChildStatus`, emitting through the existing `send("hv:subagent-status", …)` with `runCostNow`.

- [ ] **Step 1: Failing test** — writes two fixture child files under a temp `sessions/subagents/` (headers with `parentSession` = parent A and parent B; one assistant message with `usage` each), then:

```ts
expect(twChildSessionFiles(dir, parentA)).toEqual([childA]);
expect(sessionCalls(dir, parentA, new Set())!.filter((c) => c.agent !== undefined)).toHaveLength(1); // counted once (reportUsage:false)
deleteSessionChildren(dir, parentA);
expect(fs.existsSync(childA)).toBe(false);
expect(fs.existsSync(childB)).toBe(true);
fs.rmSync(parentB); // orphan
expect(sweepOrphanedSubagentData(dir).dirs + /* files */ 0).toBeGreaterThanOrEqual(0);
expect(fs.existsSync(childB)).toBe(false);          // swept by header reference, not by name
expect(twInspect(dir, "/etc/passwd").error?.code).toBe("outside");
```
plus the old-layout cases already in `tests/session-delete-children.test.ts` and `tests/session-ledger.test.ts` must stay green UNCHANGED (read-only compat, spec §4.7).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `sessionCalls` = old `childSessionFiles` ∪ `twChildSessionFiles`; `deleteSessionChildren` also removes `twChildSessionFiles(...)`; the sweep removes a `subagents/*.jsonl` whose `parentSession` file no longer exists (and, like today, abandons that pass if any session file is unreadable). `readChildTrace` needs no change (the files are under `sessionDir()`).
- [ ] **Step 4: Run** → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): tintinweb child sessions — live status, inspect, cost counted once, delete and sweep"`

### Task 15: Cards for `Agent` results, and old sessions still read

**Files:**
- Modify: `src/renderer/src/agents.ts` (`asyncResultInfo` `:490`, `delegationLabel` `:508`, `traceFromEnd` `:198`), `src/renderer/src/toolLabel.ts` (cases `Agent`, `get_subagent_result`, `steer_subagent`, `SubagentWorkflow`), `src/renderer/src/App.tsx:1560-1584`, `src/main/restore.ts:299`
- Test: `tests/agents-renderer.test.ts`, `tests/tool-label.test.ts`, `tests/restore-map.test.ts` (extend each)

**Interfaces:**
- `asyncResultInfo(result)` → reads the tintinweb background id field (name as captured in Task 3, e.g. `details.agentId`) **or** `details.asyncId`; returns `{ asyncId }` either way so every consumer stays keyed on one field name.
- `delegationLabel(args)` → `intent ?? description ?? prompt ?? task`.

- [ ] **Step 1: Failing tests** — fixtures = Task 3's captured `tool_execution_end` for background and foreground `Agent`:

```ts
it("a background Agent result is recognised as async and keyed by its id", () => {
  expect(asyncResultInfo(CAPTURED_AGENT_BG_END.result)).toEqual({ asyncId: CAPTURED_AGENT_BG_ID });
});
it("a foreground Agent result is not async", () => {
  expect(asyncResultInfo(CAPTURED_AGENT_FG_END.result)).toBeNull();
});
it("an old nicobailon card still reads (read-only compat)", () => {
  expect(asyncResultInfo({ details: { asyncId: "r1" } })).toEqual({ asyncId: "r1" });
  expect(isSubagentTool("subagent")).toBe(true);
});
it("labels", () => {
  expect(toolLabel("Agent", { subagent_type: "worker", description: "Fix the parser" }).text).toBe("Fix the parser");
  expect(toolLabel("steer_subagent", { agent_id: "worker", message: "focus on tests" }).text).toMatch(/Message to worker/);
  expect(toolLabel("SubagentWorkflow", { script: "export const meta = { name: 'review' }" }).text).toMatch(/workflow/i);
});
```
`restore.ts:299` also reads the tintinweb id field from `details`, so a reopened TW session's card can inspect.
- [ ] **Step 2–4:** implement; run → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): delegation cards read tintinweb results; pre-switch sessions still render"`

### Task 16: Workflows — approved as code, carded from the session file, stopped whole

**Files:**
- Modify: `pi-runtime/extensions/hv-tw-gate.ts` (`workflowSource`, `workflowAgents`), `happyvibe-bridge.ts` (workflow prompt branch), `src/renderer/src/permission.ts:12-79`, `src/renderer/src/components/PermissionModal.tsx:135-238`, `src/main/twChildren.ts` (`workflowProgress`), `src/main/ipc.ts` (poller + `hv:workflow-stop`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/components/ChatView.tsx` (card STOP)
- Test: `tests/hv-tw-gate.test.ts` (extend), `tests/permission-workflow.test.ts`, `tests/tw-workflow-bridge.test.ts` (LIVE)

**Interfaces:**
- `workflowSource(input, deps: { cwd: string; agentDir: string; read(p: string): string | null }): { script: string; origin: "inline" | "path" | "saved" } | { error: string }` — `scriptPath` wins over `script` wins over `name` (upstream's precedence); `name` resolves ONLY `<agentDir>/workflows/<name>.js` (P5b).
- `workflowAgents(script: string): { types: string[]; unparsed: boolean }` — `agentType:\s*["'\`]([\w-]+)["'\`]` literals; `unparsed = /agent\s*\(/.test(script) && some call has no literal agentType`.
- Envelope `{kind:"hv.permission", tool:"workflow", summary:<meta name>, workflow:{script, origin, agents:[{type, tools, writeCapable}], unparsed}}`, choices `["Allow","Deny"]`.
- Rules: a `deny` rule on `workflow` denies; nothing else skips the prompt (no allow rule, no session grant); bypass allows.
- `PermissionInfo.workflow?` AND `PermissionInfo.child?` (the latter unused until Task 23, declared now so the modal's one condition is written once) in `permission.ts`; `PermissionModal` renders the script in a scrolling `<pre>` and writes `const shown = info.workflow || info.child ? wire : (wire.includes("Allow") && wire.includes("Deny") ? EXPANDED_CHOICES : wire);`.
- Progress (corrected by Phase 0): the relay listens on `subagents:workflow-progress` (P6-progress) and sends `hv.subagent` `{stage:"workflow-progress", runId, entries}`; the renderer card folds entries by `index`. The run id is `details.taskId` on the tool result (`wf_…`, d1.md § tintinweb wire shapes). There is no session-file source — `subagents:workflow` entries are written only by the `--subagents-workflow-file` start-up path. IPC `hv:workflow-stop(sessionId, runId)` → prompt `/hv-workflow-stop <runId>` → relay → `subagents:rpc:workflow-stop`.

- [ ] **Step 1: Failing tests**

```ts
// tests/hv-tw-gate.test.ts (extend)
it("a saved workflow is read from the agent dir only", () => {
  const read = (p: string) => (p === "/agent/workflows/review.js" ? "S" : null);
  expect(workflowSource({ name: "review" }, { cwd: "/ws", agentDir: "/agent", read })).toEqual({ script: "S", origin: "saved" });
  expect(workflowSource({ name: "evil" }, { cwd: "/ws", agentDir: "/agent", read: (p) => (p.startsWith("/ws/.pi") ? "X" : null) })).toHaveProperty("error");
});
it("scriptPath beats script beats name", () => {
  const read = () => "FROM-PATH";
  expect(workflowSource({ scriptPath: "a.js", script: "INLINE", name: "n" }, { cwd: "/ws", agentDir: "/a", read })).toMatchObject({ origin: "path", script: "FROM-PATH" });
});
it("lists the agents it can name and says when it cannot", () => {
  expect(workflowAgents(`agent({ agentType: "code-explorer", prompt: "a" }); agent({ agentType: 'worker' })`)).toEqual({ types: ["code-explorer", "worker"], unparsed: false });
  expect(workflowAgents(`const t = pick(); agent({ agentType: t })`).unparsed).toBe(true);
});
```
```ts
// tests/permission-workflow.test.ts — the absence is the point
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parsePermission } from "../src/renderer/src/permission";
it("a workflow prompt parses with its script", () => {
  const info = parsePermission({ method: "select", title: JSON.stringify({ kind: "hv.permission", tool: "workflow", summary: "review", workflow: { script: "S", origin: "inline", agents: [], unparsed: false } }), options: ["Allow", "Deny"] })!;
  expect(info.workflow?.script).toBe("S");
});
it("the modal never expands a workflow or child prompt to the five-choice set", () => {
  const src = fs.readFileSync("src/renderer/src/components/PermissionModal.tsx", "utf8");
  expect(src).toMatch(/info\.workflow\s*\|\|\s*info\.child\s*\?\s*wire/);
});
```
LIVE `tests/tw-workflow-bridge.test.ts`: (a) a workflow call raises a `select` with `options` exactly `["Allow","Deny"]` and the script in the title; (b) `Deny` ⇒ audit deny, no child session files created; (c) plan mode on ⇒ blocked with no prompt; (d) a script with `gate: "touch <tmp>/gate-ran"` ⇒ approved ⇒ `<tmp>/gate-ran` never exists and the tool result contains "does not run workflow gate commands"; (e) `/hv-workflow-stop <runId>` mid-run ⇒ the workflow ends, its completion notification reads stopped/aborted, and no further `subagents:workflow-progress` events arrive; (f) `an unknown agentType fails loud` — a script calling `agent({ agentType: "nope" })` ⇒ the workflow's result names the failed spawn and lists the available types (`fallbackSubagent:"none"`), and no child session file is created for it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (bridge branch runs before the rule-engine allow path so no allow can skip it; on Allow, `approvedBoundaries.set(type, tools)` for each parsed type).
- [ ] **Step 4: Run** → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): workflows are approved as code, carded from the session file, and stopped whole"`

### Task 17: Steering — run card box, composer running-run rows, model tool

**Files:**
- Modify: `happyvibe-bridge.ts` / `hv-tw-relay.ts` (command `/hv-subagent-steer <runId> <base64>`), `src/main/ipc.ts` (`hv:subagent-steer`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/components/ChatView.tsx` (`DelegationRunCard` `:2325`; `@` menu `:1697-1731`; `pickAgentMention` `:419`; `submit` `:816`), `src/renderer/src/mentions.ts` (new pure helpers), `src/renderer/src/App.tsx` (`send` `:2662` routes a steer)
- Test: `tests/steer-mentions.test.ts`, `tests/tw-steer-bridge.test.ts` (LIVE)

**Interfaces:**
- `window.hv.subagentSteer(sessionId: string, runId: string, message: string): Promise<{ ok: boolean; error?: string }>`
- `mentions.ts`: `runMentionItems(runs: Array<{ id: string; runId?: string; agent: string; status: string }>, query: string, limit = 3): Array<{ runId: string; agent: string; label: string }>` — running runs only, label `"Message <agent> · run <n>"` (n = 1-based order among same-agent running runs); `steerTarget(text: string, picked: { runId: string; agent: string } | null): { runId: string; message: string } | null` — non-null only when `picked` is set AND `text` starts with `@<agent> ` AND the rest is non-empty.

- [ ] **Step 1: Failing tests**

```ts
// tests/steer-mentions.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { runMentionItems, steerTarget } from "../src/renderer/src/mentions";

const runs = [
  { id: "t1", runId: "r1", agent: "worker", status: "running" },
  { id: "t2", runId: "r2", agent: "worker", status: "running" },
  { id: "t3", runId: "r3", agent: "code-explorer", status: "done" },
];
describe("running-run rows", () => {
  it("offers running runs only, numbered per agent", () => {
    expect(runMentionItems(runs, "wor").map((r) => r.label)).toEqual(["Message worker · run 1", "Message worker · run 2"]);
    expect(runMentionItems(runs, "code")).toEqual([]);     // finished runs are not offered
  });
});
describe("steerTarget — a pick, never a parse", () => {
  it("routes only a picked run at the start of the prompt", () => {
    expect(steerTarget("@worker focus on the tests", { runId: "r2", agent: "worker" })).toEqual({ runId: "r2", message: "focus on the tests" });
  });
  it("hand-typed @worker is NOT a steer (roster mention or file)", () => {
    expect(steerTarget("@worker focus on the tests", null)).toBeNull();
  });
  it("mid-prompt or empty message is not a steer", () => {
    expect(steerTarget("please @worker focus", { runId: "r2", agent: "worker" })).toBeNull();
    expect(steerTarget("@worker ", { runId: "r2", agent: "worker" })).toBeNull();
  });
  it("targets exactly one run id", () => {                  // Review Focus #2
    expect(steerTarget("@worker x", { runId: "r1", agent: "worker" })!.runId).toBe("r1");
  });
});
describe("the roster pick is unchanged", () => {
  it("pickAgentMention still inserts plain text and never touches mentionMap", () => {
    const src = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
    const body = src.slice(src.indexOf("const pickAgentMention"), src.indexOf("};", src.indexOf("const pickAgentMention")));
    expect(body).not.toMatch(/mentionMap/);
    expect(body).not.toMatch(/subagentSteer/);
  });
});
```
LIVE `tests/tw-steer-bridge.test.ts`: two background `worker` runs; `/hv-subagent-steer <r1> <b64("reply with the word STEERED")>` ⇒ `subagents:steered` for r1 only; r1's child session file gains a user message with that text; r2's does not.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — menu shows run rows ABOVE roster rows (both above files), distinct styling; picking one sets `pickedRun` state and inserts `@<agent> `; `submit` computes `steerTarget(input, pickedRun)`; if non-null, `window.hv.subagentSteer(...)` instead of `onSend`, clears the composer, and shows the notice "Sent to <agent>" through the existing composer notice line; `pickedRun` clears on any edit that removes the leading token. Run card: an input + "Send" under the header while `run.status === "running"`, calling the same IPC. The steer text is sent as typed (no `@file` expansion — `// ponytail: add mention expansion if users ask to hand a child a file mid-run`).
- [ ] **Step 4: Run** → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): steer a running sub-agent from its card or by picking it in @"`

### Task 18: Stuck runs are flagged

**Files:**
- Create: `src/main/stuckRun.ts`
- Modify: `src/main/ipc.ts` (TW poller from Task 14)
- Test: `tests/stuck-run.test.ts`

**Interfaces:** `STUCK_MS = 10 * 60_000`; `lastEntryKind(file: string): "awaiting-model" | "in-tool" | "other"`; `isStuck(kind, idleMs: number): boolean` — true only for `"awaiting-model"` and `idleMs >= STUCK_MS`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { isStuck, STUCK_MS } from "../src/main/stuckRun";
describe("isStuck", () => {
  it("waiting on the model for 10 min is stuck", () => expect(isStuck("awaiting-model", STUCK_MS)).toBe(true));
  it("a long tool call never is", () => expect(isStuck("in-tool", 60 * 60_000)).toBe(false));
  it("9 minutes is not", () => expect(isStuck("awaiting-model", STUCK_MS - 1)).toBe(false));
});
```
plus `lastEntryKind` over three fixture files: last line a `toolResult` ⇒ `awaiting-model`; last line an assistant message carrying a `toolCall` with no result ⇒ `in-tool`; last line a user message ⇒ `awaiting-model`.
- [ ] **Step 2–3:** implement; the poller computes `idleMs = now - mtime` and, when stuck, pushes the same `hv:ui-request`-borne `hv.subagent` `{stage:"control", runId, activityState:"needs_attention", reason:"no-activity"}` the renderer already promotes (`runRail.ts:98`, `promotedKeys` `:143`); the card's attention line reads "No activity for 10 min — Stop?" when `reason === "no-activity"`. It never stops the run.
- [ ] **Step 4:** run → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): a run waiting on the model with no activity for 10 min turns amber"`

### Task 19: Roster, discovery and the Agents page on tintinweb

**Files:**
- Modify: `pi-runtime/extensions/hv-agents.ts` (`renderSubagentSection` `:138`), `happyvibe-bridge.ts:1580-1658` (`enumerateAgents` on TW via `loadCustomAgents`), `src/main/config.ts:919` (`setAgentEnabled` on TW writes only `agentsEnabled` — the policy enforces it)
- Test: `tests/hv-agents.test.ts` (extend), `tests/subagent-discovery-bridge.test.ts` (tintinweb variant, LIVE)

- [ ] **Step 1: Failing tests**

```ts
it("the tintinweb roster names the Agent tool and no list step", () => {
  const s = renderSubagentSection(AGENTS, { tool: "Agent" });
  expect(s).toContain("`Agent`");
  expect(s).toContain("subagent_type");
  expect(s).not.toContain('action: "list"');
  expect(s).toContain("Delegate when the work spans many files"); // the 2026-09-10 threshold survives
});
```
LIVE: the Agents page inventory (`/hv-agents`) on TW lists exactly our three bundled agents + a planted project agent, and NOT `general-purpose`, `Explore`, `Plan`.
- [ ] **Step 2–4:** implement (`source` mapping: `<agentDir>/agents` ⇒ `bundled`, `.pi/agents` and `.agents/agents` ⇒ `project`); run → PASS; `npm run gate` → 0.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§12): roster and Agents page read tintinweb's discovery"`

---

## Phase 3 — the switch

### Task 20: Flip the default, delete the old stack, rewrite the contract

**Files:**
- Modify: `src/main/pi/spawn.ts` (default `tintinweb`; then remove the option and every nicobailon branch), `pi-runtime/package.json` (drop `pi-subagents`), `happyvibe-bridge.ts` (drop the nicobailon imports `:36-37,59-60,67`, ceiling, preflight, external-CLI refusal, owner seed wiring, v1 bus relay), `src/main/platform.ts:111-117`, `CLAUDE.md`
- Delete: `pi-runtime/extensions/hv-owner-seed.ts`, `pi-runtime/bin/pi-node.sh`, `pi-runtime/bin/pi-child.mjs`, `src/main/modelExclusions.ts`, `src/main/subagentStatus.ts` (after confirming `twChildStatus` replaced every caller), the caption half of `hv-subagent-tasks.ts`, `EXTERNAL_CLI_AGENTS`/`isExternalCliAgent`/`REDACTED_PROMPT` in `hv-rules.ts` (keep `displayableTask` if old-session rendering still needs it — grep first), `writeSubagentConfig`/`writeSubagentSettings`/`agentOverrides`
- Delete tests: `tests/pi-subagents-contract.test.ts`, `subagent-external-agents`, `model-exclusions`, `pi-child-launcher`, `child-task-file`, `subagent-preflight-shape`, `subagent-adversarial` (its FR10 cases re-homed into `tests/tintinweb-trust.test.ts`), `subagent-status`, `subagent-inspect`, the nicobailon halves of `mcp-spawn`, `pi-cli-entry`, `platform`, `subagent-config`
- Create: `tests/tintinweb-contract.test.ts`

- [ ] **Step 1: Write `tests/tintinweb-contract.test.ts`** (key-free; the pin-bump gate) — asserts against the INSTALLED package: `package.json` version `0.19.0`; the four tool names registered (`Agent`, `SubagentWorkflow`, `get_subagent_result`, `steer_subagent`) by scanning `registerTool` sites; lifecycle event names and that they are top-level only (`isTopLevelAgent` gate on emit); `subagents:record` and `subagents:workflow` entry type literals; every settings key `tintinwebSettings()` writes exists in `SubagentsSettings` (`settings.ts`); `loadCustomAgents(cwd, strict?)` still exported from `src/custom-agents.ts` (the bridge's relative import); `resource-loader.js` still loads `additionalExtensionPaths` under `noExtensions` (P2/P3 depend on it); every hunk marker present (reuse `HUNKS`); `package.json` has no `exports` map (if one appears, the relative import may break — fail loudly).
- [ ] **Step 2: Flip, delete, fix imports** — iterate `npm run gate > $L 2>&1; echo EXIT=$?` until 0. Every deleted test must have its surviving intent either moved to a `tw-*`/`tintinweb-*` test or recorded as obsolete in the commit body with the reason.
- [ ] **Step 3: CLAUDE.md** — replace the pi-subagents entries (from "The bridge reaches two `pi-subagents` internals" through "A sub-agent's task arrives as a FILE on macOS") with a tintinweb section: the child policy seam + fail-closed `HV_HOST`, the patch applier + hunks + the named never-patch carve-out, the relative `custom-agents.ts` import, `<sessionDir>/subagents/` + header discovery, `reportUsage:false`, workflow approval as code, steering by pick, the stuck-run rule, how to debug a child (its session file). Keep every non-subagent entry byte-identical.
- [ ] **Step 4: docs** — d1.md § "tintinweb wire shapes" final; tw1.md final measurements. **Do not write the CHANGELOG entry** (the `changelog` skill does that at release time) — but put the Heads-up facts in the commit body so `/release` finds them: `~/.agents` and package agents no longer discovered; external-CLI agents gone; grants keep working.
- [ ] **Step 5: Commit** — `git commit -s -m "refactor(§12)!: sub-agents run on tintinweb; the nicobailon stack and its workarounds are gone"`

### Task 21: Full gate, live batch, GUI pass (Phases 0–3)

- [ ] **Step 1:** `npm run gate > $L 2>&1; echo EXIT=$?` → 0. Record file/test counts.
- [ ] **Step 2:** `npm run live:why` (after committing) → non-empty ⇒ `npm run test:live` in the BACKGROUND; while it runs, only docs work. Expected wall time ≥ 7 min; any red ⇒ `pgrep -fl "npm run dev"`, then isolation re-run.
- [ ] **Step 3:** GUI pass — every assertion in **§ GUI verification** A–F below, driven over CDP (`electron-debug` MCP) with screenshots saved to the scratchpad. A claim without its picture is not verified.
- [ ] **Step 4:** Update Notion spec §6 phase statuses; commit anything the pass changed.

---

## Phase 4 — a child's `ask` reaches the human

### Task 22: Extract the gate decision (refactor, no behaviour change)

**Files:** Modify: `pi-runtime/extensions/happyvibe-bridge.ts:1068-1432`

**Interfaces:** Produces (factory-local): `async function decide(call: { tool: string; permTool: string; input: Record<string, unknown>; summary: string; boundary?: BoundarySummary }, ui: ExtensionUIContext, opts: { child?: { agent?: string; runId?: string; runGrants: Set<string> } }): Promise<{ block: true; reason: string } | undefined>` — everything from the bypass branch `:1318` through the choice handling `:1431`, parameterised by `opts.child`. The `tool_call` handler keeps the pre-gate branches (wait intercept, readonly/plan clamps, workflow branch) and ends with `return decide(...)`.

- [ ] **Step 1:** No new test — the existing bridge suites ARE the test. Run the full live batch + `npm test` BEFORE the refactor; record the counts.
- [ ] **Step 2:** Move the code; the only diff inside the moved block is `ctx.ui` → `ui` and reads of `sessionGrants` now go through `hasGrant(permTool, opts.child)` (parent: `sessionGrants.has`; child: `sessionGrants.has || runGrants.has`).
- [ ] **Step 3:** `npm test` + live batch → identical counts, all green.
- [ ] **Step 4: Commit** — `git commit -s -m "refactor(§10): lift the permission decision out of the tool_call handler"`

### Task 23: Child prompts on the parent's channel

**Files:**
- Modify: `happyvibe-bridge.ts` (policy `ask` + `hasSessionGrant`), `pi-runtime/extensions/hv-child-guard.ts` (in-process `ask` path), `src/renderer/src/permission.ts`, `src/renderer/src/components/PermissionModal.tsx`, `src/renderer/src/App.tsx:2746-2780` (child answers never call `addPermissionRule`)
- Test: `tests/child-prompt.test.ts`, `tests/tw-child-prompt-bridge.test.ts` (LIVE)

**Interfaces:**
- `CHILD_CHOICES = ["Allow", "Allow for this run", "Deny"] as const` (in `hv-tw-gate.ts`).
- Envelope adds `child: { agent: string; runLabel: string; runId: string }`; `parsePermission` exposes `info.child`; the headline reads `` `${child.agent}${child.runLabel ? ` · ${child.runLabel}` : ""} wants to ${toolLabel(...).text}` ``.
- Guard, in-process: when `guardDecision` says `wouldHave:"ask"` and it is inside the boundary and not bypass and not `HV_READONLY` ⇒ `await policy.ask({...})`: `"allow"` ⇒ allow; `"allow-run"` ⇒ add to the factory-local `runGrants` and allow; `"deny"` ⇒ block with the user-denied reason. Before asking: `policy.hasSessionGrant(permTool)` ⇒ allow without prompting (inheritance, decision 10).
- While the prompt is open the relay sends `{stage:"control", runId, activityState:"needs_attention"}` and on answer `{stage:"control", runId}` (clears it).

- [ ] **Step 1: Failing tests**

```ts
// tests/child-prompt.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parsePermission } from "../src/renderer/src/permission";
import { CHILD_CHOICES } from "../pi-runtime/extensions/hv-tw-gate";

it("a child prompt offers exactly three choices", () => {
  expect([...CHILD_CHOICES]).toEqual(["Allow", "Allow for this run", "Deny"]);
});
it("parses the child's identity", () => {
  const info = parsePermission({ method: "select", options: [...CHILD_CHOICES], title: JSON.stringify({ kind: "hv.permission", tool: "bash", summary: "npm test", child: { agent: "worker", runLabel: "run 2", runId: "r2" } }) })!;
  expect(info.child).toEqual({ agent: "worker", runLabel: "run 2", runId: "r2" });
});
it("a child answer never writes a persistent rule", () => {
  const src = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
  const fn = src.slice(src.indexOf("respondPermission"), src.indexOf("respondPermission") + 1500);
  expect(fn).toMatch(/if\s*\(\s*!\s*info\.child\s*&&[^)]*Allow for workspace/);
});
```
Review Focus #5 needs no new renderer code and is pinned where it is decided: the child's prompt is raised through the PARENT's `ctx.ui`, so it arrives on the parent's `PiClient` `ui-request` stream, and main stamps every such request with the parent's `sessionId` (`ipc.ts:1840` `stampPrompt({...r, sessionId})`) — which is what `dialogHost` (`paneDialog.ts`, pinned by `tests/pane-dialog.test.ts`) scopes and falls back on. The live test's (a) asserts that stream.

LIVE `tests/tw-child-prompt-bridge.test.ts`: (a) `writer` approved, no write rule ⇒ a SECOND `select` arrives **on the parent's client** whose title has `child.agent === "writer"` and `options` exactly `CHILD_CHOICES`; answer `Allow for this run` ⇒ `note.txt` created; the same child's second write proceeds with no prompt; (b) a new `writer` run ⇒ prompts again (run grant died); (c) parent session grant for `write` given first ⇒ the child writes with no prompt (inheritance); (d) `HV_READONLY=1` ⇒ no child prompt, a deny row.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `PermissionModal`: `const shown = info.workflow || info.child ? wire : (wire.includes("Allow") && wire.includes("Deny") ? EXPANDED_CHOICES : wire);`; child headline; `App.respondPermission`: the workspace/always branch requires `!info.child`. Bridge `ask` = `decide({...}, busUi, { child: {...} })` with the three-choice `select`; mark the prompt with the PARENT's session so `pendingPrompts` retains/replays it and `dialogHost` scopes it (both key on the session, not the tool).
- [ ] **Step 4: Run** → PASS; `npm run gate` → 0; live batch → green.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(§10): a sub-agent's ask prompts you on the parent's pane, scoped to its run"`

### Task 24: Phase 4 gate and GUI pass

- [ ] `npm run gate`, live batch (background), GUI assertions **G** below with screenshots; update `CLAUDE.md` (the child-prompt path, `decide()`), d1.md (child envelope verbatim), Notion spec §6 "Phase 4 done"; commit.

---

## GUI verification (observable, per page — write the screenshot path beside each when checked)

Setup for every pass: `HV_CRASH_DEV` unset, a fresh workspace cloned from a fixture repo that contains `.pi/extensions/evil.ts` (writes `/tmp/hv-evil-ran`), `.pi/agents/sneaky.md` (`extensions: [./evil.ts]`, `memory: project`), `.pi/subagents.json` (`{"schedulingEnabled":true}`), `.pi/workflows/evil.js`, and one old session copied in from a pre-switch build that has a finished `worker` delegation.

**A. Chat pane — delegation cards (Tasks 12–15)**
- Ask "delegate listing the files to code-explorer". The boundary modal appears over the chat pane, headline "Sub-agent: code-explorer", boundary block lists `find, grep, ls, read`, no write callout.
- After Allow: a circle appears in the run rail within 2 s; its hover shows elapsed, tokens, a ◼ Stop; the context gauge renders (or is absent, never 0%).
- On completion: the transcript card for that call reads the child's final answer when expanded (not "Waiting…"), and the main agent's reply quotes the child's last line **without** a `get_subagent_result` card appearing in between.
- **Absence:** `/tmp/hv-evil-ran` does not exist; `ls <ws>/.pi` shows no `agent-memory` and no `npm`; `ls $TMPDIR | grep -i "pi-subagent\|\.output"` finds no transcript copies; no `general-purpose`/`Explore`/`Plan` string anywhere in the chat.
- **Regression sequence:** start two background `worker` runs; hover run 1 → ◼ Stop; run 2's circle keeps pulsing and later completes with its own answer in its own card; run 1's card reads "stopped".

**B. Chat pane — steering (Task 17)**
- Expand a running `worker` card: a "Message this agent" box is present; send "reply with the word STEERED"; the box clears; within one child turn the card's transcript shows that message as a user row and a reply containing STEERED.
- Composer: type `@work` → the menu shows "Message worker · run 1" rows ABOVE the roster row "worker", both above files. Pick the run row → the chip is visibly distinct from a file chip; send "focus on tests" → notice "Sent to worker"; **absence:** no new user bubble in the parent transcript, and the main model does not start a turn.
- Pick the ROSTER row "worker" instead → plain `@worker` text, send → the main model delegates (today's behaviour).
- **Regression sequence:** open the run card, send a message, ✕ close, reopen from the circle → the message is still in its transcript; the run is still running.
- A finished run is **absent** from the `@` run rows.

**C. Permission modal — workflows (Task 16)**
- Ask for a two-agent workflow. The modal shows the script in a scrolling block, lists `code-explorer` (and any other parsed type) with its tools, and offers exactly **Allow** and **Deny**. **Absence:** no "Allow for session", no "Allow for workspace", no "Always allow".
- Turn Plan mode on and ask again → no modal; a plan-blocked card names the workflow.
- Ask for `.pi/workflows/evil.js` by name → refused as not found (absence of any prompt showing its source).
- Workflow card: progress rows appear while it runs; ◼ Stop ends the whole workflow; **absence:** no per-child ◼ on workflow children.

**D. Chat pane — stuck runs (Task 18)**
- With a model endpoint that hangs (point the fixture at a black-hole proxy), a background run's circle turns amber after 10 min and the card promotes inline reading "No activity for 10 min — Stop?", with **no ✕** (promoted cards are not dismissible). Stop → the card reads stopped; the session hibernates normally afterwards.

**E. Settings → Agents, Settings → Audit, Stats, sidebar (Tasks 11, 14, 19)**
- Agents page lists exactly `agents-md-maker`, `code-explorer`, `worker` + `sneaky` (project). **Absence:** `general-purpose`, `Explore`, `Plan`, and any `claude-code*`/`codex-exec*`/`cursor-agent*`.
- Switch `worker` off on the Agents page; ask for a worker delegation → refused before any modal with "'worker' is switched off on the Agents page."
- Audit page, after A: rows with source "sub-agent" naming `code-explorer` and the run, one per child tool call.
- Stats page: the old session's cost still includes its child spend (compare against the number the pre-switch build showed); the new session's child spend appears once (compare the delegation row total against the child session file's own `usage.cost.total` sum).
- Sidebar: **absence** — no session row for any file under `<sessions>/subagents/`.
- Delete the old session → its `<stem>/` child dir is gone; delete a new session → its `subagents/*.jsonl` children are gone.

**F. Old sessions (Task 15)**
- Open the pre-switch session: its `subagent` card renders with its result and cost; expanding shows its transcript; no error toast.

**G. Child prompts (Phase 4, Task 23)**
- Approve `worker` with no write rule; ask it to create a file. A second modal appears **over the chat pane**, headline "worker · run 1 wants to …", choices exactly **Allow · Allow for this run · Deny**. **Absence:** no "Allow for workspace", no "Always allow".
- While it is open: the worker circle is amber and promoted. Answer "Allow for this run" → the file appears; its next write does not prompt.
- **Regression sequence:** open Settings → Agents while a child prompt is pending → the modal is still visible (viewport fallback) and answerable; answer it; return to the chat → the run continued.
- Start a new `worker` run → it prompts again for the same write (run grant did not survive).

---

## Self-review notes (done while writing)

- Spec coverage: decisions 1–10 → Tasks 6, 8, 9 (1, 2), 7 (3 settings), 13 (4), 17 (5), 8–9 + 16 (6), 16 (7), 18 (8), 7 (9), 22–23 (10). §4.6 settings → Task 7. §4.7 → Tasks 14–15. R7 → Task 18; R8 → Tasks 7, 9; R9 → Task 8; R10 → Task 7.
- Deviations from the spec's wording, both recorded in the spec: P5a refuses inside `executeGate` (unevadable) rather than by parsing the script; `consume` is not used (substitution keeps the one notification).
- `subagent.audit_rollup` is produced only by `drainChildAudit` (`ipc.ts:2591,2629`) and read nowhere in `src/` — it is not rebuilt for the tintinweb path. Re-add it if a consumer appears.
