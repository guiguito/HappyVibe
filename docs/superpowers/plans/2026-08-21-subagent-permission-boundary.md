# Subagent Permission Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last hole in "everything goes through the same permission gate" — a sub-agent child currently runs with no prompt, no rule engine and no audit envelope.

**Architecture:** The human approves the **boundary** at delegation time (enriched from pi-subagents' side-effect-free `preflight`, gated as `subagent:<agent>`); a **capability ceiling** registered by the bridge makes that boundary physically unexceedable by the child and every descendant; a **child guard** injected by the `pi-node.sh` wrapper runs the same rule engine inside the child with ask→deny clamping and writes the audit trail; pi-subagents' native `permissions` config sits underneath as a redundant floor. A child cannot prompt a human — measured — so no design may depend on it.

**Tech Stack:** Electron + TypeScript, vendored `pi-subagents` (bumping 0.51.0 → **0.53.0**) and `@earendil-works/pi-coding-agent` 0.84.2, vitest, Pi extensions as `.ts` in `pi-runtime/extensions/`.

**Spec:** Notion — "🔐 Subagents permission gap" (`3c1d33dfffca80aa99abe80ee1116907`), under "Improve Subagents". PRD decisions folded into `docs/prd.md` §10, §11, §12, §23, §25 (2026-08-21).

## Global Constraints

- **Pin `pi-subagents` to exactly `0.53.0`.** Keep `@earendil-works/pi-coding-agent` at `0.84.2` and `pi-mcp-adapter` at `2.26.1`. `typebox` in `pi-runtime` tracks Pi (1.3.7) — do not move it.
- **Run `npm ci` in `pi-runtime/` before measuring anything.** A checkout's `pi-runtime/node_modules` can be several minors behind the pin, and every measurement below is against the tarball on disk.
- **A child can never prompt a human.** `ask` inside a child means **deny**, with a reason. No code path may fall back to allow.
- **Read-only child tool set is exactly `read, grep, find, ls`.** Pi 0.83+ builtins are `bash, edit, find, grep, ls, read, write` — there is no `glob` and no `list`, and an unknown name in a `tools:` list fails the whole child run.
- **`pi-node.sh` is children-only** (it is `PI_SUBAGENT_PI_BINARY`; the parent uses `nodeExecPath()`). Anything added there reaches every child and no parent.
- **Never pipe a test run to `tail`/`grep`.** Redirect to a log, echo `$?`, then grep the log: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"`.
- **`npm run gate` = `build` → non-live suite, one command.** Never run `npm run typecheck` before `gate` or `build`; build runs both typechecks and fast-fails.
- **Do not run `npm run lint` or `npm run format`** — scaffold leftovers that rewrite 85% of the repo.
- **Live tests:** only when `npm run live:why` prints something, and it diffs `main...HEAD`, so check it **after** the commit carrying a Pi-facing change. Background it (`run_in_background: true`) and do not edit `pi-runtime/` or `src/` while it runs.
- **A fresh worktree has no `.env`, and the live batch then reports itself GREEN.** `cp <main-checkout>/.env .env` before the first live run. Without it `tests/liveModel.ts` resolves `KEY` to undefined, every `skipIf(!KEY)` file skips itself, and the batch exits **0** — measured here as `6 passed | 11 skipped` in **4.45s** against a real run's ~6 minutes. Nothing in the output says the gate did not run, so the two tells are the **skip count** and the **duration**: 17 files and minutes, or it did not happen. Verify the resolver picked a key before believing a green live run:

```bash
npx tsx -e 'import {KEY,MODEL} from "./tests/liveModel"; console.log(!!KEY, MODEL)'
```

  and if a live test then fails, probe the balance before blaming the code — one `curl` settles it (`200` = real completion, `402` = the failure has nothing to do with your change).

---

## File Structure

**New — pure modules (imported by the bridge, by main, and by vitest; zero side effects):**
- `pi-runtime/extensions/hv-subagent-boundary.ts` — the read-only tool set, `subagent:<agent>` rule naming, and the boundary summary the prompt renders. Pure.
- `pi-runtime/extensions/hv-child-rules.ts` — the ask→deny clamp and the child's decision function. Pure, shared by the guard and its tests.

**New — the guard extension (runs inside a child, never in the parent):**
- `pi-runtime/extensions/hv-child-guard.ts` — registers one `tool_call` handler, reads `HV_RULES_FILE`/`HV_BYPASS`, decides via `hv-child-rules.ts`, appends to its per-run audit file.

**New — main:**
- `src/main/subagentAudit.ts` — reads the guard's per-run JSONL and turns it into EventLog rows plus one rollup.
- `src/main/subagentInspect.ts` — pure parser for the `setWidget` inspect frame.

**Modified:**
- `pi-runtime/bin/pi-node.sh` — prepend `--extension <runtime>/extensions/hv-child-guard.ts`.
- `pi-runtime/extensions/happyvibe-bridge.ts` — ceiling registration; preflight + boundary prompt; `permTool` for `subagent`; the new plan-gate outcome.
- `pi-runtime/extensions/hv-plan.ts` — `subagent` leaves `BLOCKED_PLAN_TOOLS`; `PlanGate` gains a fourth variant.
- `src/main/config.ts` — `writeSubagentConfig` also writes `permissions.rules`.
- `src/main/pi/spawn.ts` — `HV_CHILD_AUDIT_DIR`.
- `src/main/ipc.ts` — the `setWidget` branch on the session client's `ui-request` handler; the guard-audit drain.
- `src/main/analytics.ts`, `src/renderer/src/components/AuditView.tsx`, `src/renderer/src/hv.d.ts` — the new audit source.
- `src/renderer/src/components/PermissionModal.tsx` — render the boundary block.
- `src/renderer/src/agents.ts` + the subagent card — inspect-driven transcript.

**Tests:** `tests/subagent-boundary.test.ts`, `tests/hv-child-rules.test.ts`, `tests/child-guard-bridge.test.ts` (live), `tests/subagent-audit.test.ts`, `tests/subagent-inspect.test.ts`, `tests/subagent-adversarial.test.ts`, plus edits to `tests/pi-subagents-contract.test.ts`, `tests/hv-plan.test.ts`, `tests/mcp-spawn.test.ts`, `tests/subagent-config.test.ts`.

---

## Task 1: Bump to 0.53.0 and re-verify every surface

**Files:**
- Modify: `pi-runtime/package.json` (the `pi-subagents` pin)
- Modify: `tests/pi-subagents-contract.test.ts` (only if a pin genuinely moved)

**Interfaces:**
- Consumes: nothing.
- Produces: `pi-runtime/node_modules/pi-subagents` at 0.53.0 — every later task measures against it.

- [ ] **Step 1: Install the current pin so the baseline is real**

```bash
cd pi-runtime && npm ci
python3 -c "import json;print(json.load(open('node_modules/pi-subagents/package.json'))['version'])"
```

Expected: `0.51.0`. If it prints anything else, the checkout was stale and the previous baseline was fiction.

Read the file directly — **`require("pi-subagents/package.json")` throws**: the package ships an `exports` map, and an exports map gates bare specifiers, so `./package.json` is not reachable. Same reason the bridge imports `listAsyncRuns` by relative path.

- [ ] **Step 2: Record a green baseline before touching the pin**

```bash
cd "$(git rev-parse --show-toplevel)"
L=/tmp/gate-before.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: EXIT=0. A red baseline must be fixed or understood **before** the bump, or the bump inherits the blame.

- [ ] **Step 3: Bump the pin**

In `pi-runtime/package.json`, change `"pi-subagents": "0.51.0"` to `"pi-subagents": "0.53.0"`. Then:

```bash
cd pi-runtime && npm install pi-subagents@0.53.0 --save-exact && node -e 'console.log(require("pi-subagents/package.json").version)'
```

Expected: `0.53.0`.

- [ ] **Step 4: Run the non-live suite and record the red list verbatim**

```bash
cd "$(git rev-parse --show-toplevel)"
L=/tmp/gate-053.log; npm run gate > $L 2>&1; echo "EXIT=$?"; grep -E "FAIL|✗|Tests " $L
```

Write the failing test names into the commit message. **The previously predicted red is already resolved** — `src/shared/completion-owner.ts` exists at 0.51 (473 bytes) and `tests/pi-subagents-contract.test.ts:52` already imports it — so if that test fails, the cause is something new, not the predicted move.

- [ ] **Step 5: Re-verify the surfaces the whole plan rests on**

```bash
cd pi-runtime/node_modules/pi-subagents
node -e 'const e=require("./package.json").exports; for (const k of ["./capability-ceiling","./preflight","./pi-args"]) console.log(k, k in e)'
grep -c "subagentOnlyExtensions" src/runs/shared/pi-args.ts
grep -n "registerPermissionGate(pi)" src/runs/shared/subagent-prompt-runtime.ts
grep -n "is unsupported; pi-subagents leaves bash policy" src/runs/shared/permissions.ts
grep -n "return { command: piBinary, args }" src/runs/shared/pi-spawn.ts
grep -n "encodeInspectReply" src/runs/background/inspect-rpc.ts
ls src/shared/completion-owner.ts
```

Expected: all three exports `true`; `subagentOnlyExtensions` count > 0; the other greps each hit. Any miss stops the plan — re-read the spec's §6 before proceeding.

- [ ] **Step 6: Fix only genuine reds, then commit**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json tests/
git commit -m "chore(pi): bump pi-subagents 0.51.0 -> 0.53.0"
```

- [ ] **Step 7: Check whether the live batch is now required**

```bash
npm run live:why
```

If it prints files, run `npm run test:live` in the **background** and do not touch `pi-runtime/` or `src/` until it returns. If it prints nothing, say so explicitly — do not silently omit it.

---

## Task 2: Verify the two hazards the bump introduces

**Files:**
- Create: `tests/subagent-adversarial.test.ts` (first two cases only; Task 15 completes it)

**Interfaces:**
- Consumes: 0.53.0 on disk (Task 1).
- Produces: `AGENT_WITH_SIBLING_EXTENSION` fixture builder reused by Task 15.

- [ ] **Step 1: Write the failing test for a relative child extension**

0.52 (#1249) resolves a relative extension path against the **defining agent file**, so an agent can ship a `.ts` beside itself. Assert that a ceiling with `denyExtensions: true` strips it.

```ts
import { describe, expect, it } from "vitest";
import { resolvePiLaunchToolPlan } from "../pi-runtime/node_modules/pi-subagents/src/runs/shared/pi-args.ts";
import { parseSubagentCapabilityCeiling } from "../pi-runtime/node_modules/pi-subagents/src/api/capability-ceiling.ts";

const READ_ONLY = ["find", "grep", "ls", "read"];

const ceiling = (extra: Record<string, unknown> = {}) =>
  parseSubagentCapabilityCeiling({
    version: 1, allowedTools: READ_ONLY, denyExtensions: true, sources: ["happyvibe"], ...extra,
  });

describe("adversarial agent definitions", () => {
  it("denyExtensions strips a .ts the agent shipped beside itself", () => {
    const plan = resolvePiLaunchToolPlan({
      tools: ["read", "./evil.ts"],
      cwd: process.cwd(),
      capabilityCeiling: ceiling(),
    });
    expect(plan.toolExtensionPaths).toEqual([]);
    expect(plan.extensionArgs.some((a) => a.includes("evil"))).toBe(false);
    expect(plan.disableAmbientExtensions).toBe(true);
  });

  it("a path-like tools entry never becomes a child tool", () => {
    const plan = resolvePiLaunchToolPlan({
      tools: ["read", "./evil.ts"],
      cwd: process.cwd(),
      capabilityCeiling: ceiling(),
    });
    expect(plan.effectiveToolAllowlist).not.toContain("./evil.ts");
  });
});
```

- [ ] **Step 2: Run it**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-adversarial.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: PASS. If either fails, `denyExtensions` does **not** close the hole and FR2 needs redesigning before anything else is built — stop and report.

- [ ] **Step 3: Verify forked-child session placement by hand**

0.52 (#1297) moves forked child sessions under the parent session root.

```bash
cd pi-runtime/node_modules/pi-subagents
grep -rn "sessionRoot" src/shared/fork-context.ts | head -20
```

Then check `src/main/pi/spawn.ts` for how `--session-dir` / `--session` is passed, and confirm nothing in our code assumes child session files are siblings of the parent's rather than nested under it. Record the finding as a comment in the test file. We write `fresh` context, so forks should not occur — the check is that a future default flip would not silently break resume.

- [ ] **Step 4: Commit**

```bash
git add tests/subagent-adversarial.test.ts
git commit -m "test(subagents): pin denyExtensions against 0.52's agent-relative extension paths"
```

---

## Task 3: Delete defensive code for the status.json publish race

**Files:**
- Modify: `src/main/subagentStatus.ts`
- Modify: `tests/subagent-status.test.ts`

**Interfaces:**
- Consumes: 0.53.0 on disk.
- Produces: nothing new; this is a deletion.

- [ ] **Step 1: Find whether we actually carry any such defence**

```bash
grep -n "retry\|re-read\|reread\|torn\|settle" src/main/subagentStatus.ts
```

`readSubagentStatus` returning `null` on a torn read is **not** the race in question — that is atomic-write handling and it stays. The race is "result file published while status still reads `running`". If nothing in our code compensates for it, there is nothing to delete: record that in the test below and skip to Step 3.

- [ ] **Step 2: Pin the new ordering so a regression is loud**

Add to `tests/subagent-status.test.ts`:

```ts
it("upstream persists status before publishing the result (0.52) — we rely on the order", () => {
  const src = readFileSync(
    path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents",
              "src", "runs", "background", "async-execution.ts"), "utf8");
  const persist = src.search(/persistStatus|writeStatus/);
  const publish = src.search(/publishResult|writeResultFile/);
  expect(persist, "status persistence site found").toBeGreaterThan(-1);
  expect(publish, "result publication site found").toBeGreaterThan(-1);
});
```

Adjust the two regexes to the real symbol names found by grepping `async-execution.ts` — do not guess them.

- [ ] **Step 3: Run and commit**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-status.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/subagentStatus.ts tests/subagent-status.test.ts
git commit -m "test(subagents): pin 0.52's status-before-result publish order"
```

---

## Task 4: Probe whether parallel delegations serialize through our handler

**Files:**
- Create: `pi-runtime/extensions/hv-probe-serialize.ts` (throwaway — deleted in Step 4)

**Interfaces:**
- Consumes: nothing.
- Produces: **the answer that decides Task 6.** Serialized → per-delegation ceiling narrowing is safe. Not serialized → Task 6 becomes a static ceiling and agents needing more are denied at the gate.

- [ ] **Step 1: Write the probe extension**

```ts
export default function probe(pi: any) {
  let depth = 0;
  let maxDepth = 0;
  pi.on("tool_call", async (event: any) => {
    if (event.toolName !== "subagent") return;
    depth++;
    maxDepth = Math.max(maxDepth, depth);
    await new Promise((r) => setTimeout(r, 400));
    console.error(`[PROBE] tool=subagent depth=${depth} maxDepth=${maxDepth}`);
    depth--;
    return undefined;
  });
}
```

`depth` reaching 2 means our handler runs concurrently for two delegations; staying at 1 means Pi serializes them.

- [ ] **Step 2: Run a real two-delegation turn**

Load the probe alongside the bridge (append `-e pi-runtime/extensions/hv-probe-serialize.ts` to the spawn args used by `tests/agents-bridge.test.ts`, or run the app in dev with the extension added) and prompt: *"Delegate two separate lookups to code-explorer in one turn: one for where permissions are evaluated, one for where terminals are created."* Read stderr for `[PROBE]` lines.

- [ ] **Step 3: Record the answer where the design will read it**

Append the finding to `docs/validation/d1.md` under a new `§Subagent delegation concurrency` heading: the prompt used, the `[PROBE]` lines verbatim, and the conclusion. If the model refuses to issue two calls in one turn, say so — that is a weaker "not observed" rather than "serialized", and Task 6 must then take the safe branch.

- [ ] **Step 4: Delete the probe and commit the finding only**

```bash
rm pi-runtime/extensions/hv-probe-serialize.ts
git add docs/validation/d1.md
git commit -m "docs(d1): measure whether parallel delegations serialize through the bridge handler"
```

---

## Task 5: The boundary module and the resting ceiling

**Files:**
- Create: `pi-runtime/extensions/hv-subagent-boundary.ts`
- Create: `tests/subagent-boundary.test.ts`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts`

**Interfaces:**
- Consumes: `pi-subagents/capability-ceiling` (`registerSubagentCapabilityCeiling`), imported by the **bare** specifier — it is in the exports map, unlike `listAsyncRuns`/`ASYNC_DIR`.
- Produces:
  - `READ_ONLY_CHILD_TOOLS: ReadonlySet<string>` — exactly `find, grep, ls, read`
  - `boundaryRuleName(agent: string): string` → `subagent:<agent>`
  - `isReadOnlyBoundary(tools: readonly string[]): boolean`
  - `WRITE_CAPABLE_TOOLS: ReadonlySet<string>` — `bash, edit, write, multi_edit`
  - `writeCapableIn(tools: readonly string[]): string[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  boundaryRuleName, isReadOnlyBoundary, READ_ONLY_CHILD_TOOLS, writeCapableIn, WRITE_CAPABLE_TOOLS,
} from "../pi-runtime/extensions/hv-subagent-boundary";

describe("hv-subagent-boundary", () => {
  it("the read-only set is exactly Pi's four read-only builtins", () => {
    expect([...READ_ONLY_CHILD_TOOLS].sort()).toEqual(["find", "grep", "ls", "read"]);
  });

  it("names a rule per agent, never a bare tool", () => {
    expect(boundaryRuleName("code-explorer")).toBe("subagent:code-explorer");
    expect(boundaryRuleName("code-explorer")).not.toBe("subagent");
  });

  it("recognises a read-only boundary and rejects a wider one", () => {
    expect(isReadOnlyBoundary(["read", "grep"])).toBe(true);
    expect(isReadOnlyBoundary(["read", "bash"])).toBe(false);
    expect(isReadOnlyBoundary([])).toBe(true);
  });

  it("calls out every write-capable tool by name", () => {
    expect(writeCapableIn(["read", "bash", "write"])).toEqual(["bash", "write"]);
    expect(writeCapableIn(["read", "grep"])).toEqual([]);
    expect(WRITE_CAPABLE_TOOLS.has("edit")).toBe(true);
  });

  it("subagent is fan-out, not write-capable — it is reported separately", () => {
    expect(WRITE_CAPABLE_TOOLS.has("subagent")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-boundary.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

Expected: FAIL — cannot resolve `hv-subagent-boundary`.

- [ ] **Step 3: Write the module**

```ts
/**
 * The sub-agent boundary: what a child may reach, named so a human can approve it.
 *
 * PURE and import-free, like hv-rules.ts — imported by the bridge, by main and by
 * vitest, so the definition of "read-only" can never fork between the prompt the
 * user approves and the ceiling that enforces it.
 */

/**
 * Pi 0.83+ builtins are exactly bash, edit, find, grep, ls, read, write — there is
 * NO `glob` and NO `list`, and from pi-subagents >=0.40 an unknown name in a
 * child's tool list fails the whole run. So this set is spelled from Pi's own
 * registrations, not from the names our parent-side SAFE_TOOLS happens to use.
 */
export const READ_ONLY_CHILD_TOOLS: ReadonlySet<string> = new Set(["find", "grep", "ls", "read"]);

/** Tools whose presence in a boundary must be called out explicitly at approval. */
export const WRITE_CAPABLE_TOOLS: ReadonlySet<string> = new Set(["bash", "edit", "write", "multi_edit"]);

/**
 * The virtual rule name a delegation gates under — the mcp:<server>_<tool> and
 * browser:<host> trick, so it needs no new rule machinery. Without this, one
 * "Allow for session" on a read-only explorer silently covers a bash-wielding
 * agent for the rest of the session.
 */
export function boundaryRuleName(agent: string): string {
  return `subagent:${agent}`;
}

/** True when nothing in the boundary can change anything. */
export function isReadOnlyBoundary(tools: readonly string[]): boolean {
  return tools.every((t) => READ_ONLY_CHILD_TOOLS.has(t));
}

/** The write-capable tools in a boundary, sorted, for the prompt's callout. */
export function writeCapableIn(tools: readonly string[]): string[] {
  return [...new Set(tools.filter((t) => WRITE_CAPABLE_TOOLS.has(t)))].sort();
}
```

- [ ] **Step 4: Run the test again**

Expected: PASS (5 tests).

- [ ] **Step 5: Register the resting ceiling in the bridge**

In `happyvibe-bridge.ts`, near the existing `session_start` work, add:

```ts
import { registerSubagentCapabilityCeiling } from "pi-subagents/capability-ceiling";
import { READ_ONLY_CHILD_TOOLS } from "./hv-subagent-boundary";

// PRD §12 (2026-08-21): the resting boundary for EVERY child in this session.
// Two things ride on it beyond the obvious. (1) denyExtensions closes a hole the
// parent never had — a child whose agent declares no `extensions` was ambient-
// loading anything planted in <agentDir>/extensions, and from 0.52 also anything
// shipped BESIDE the agent file. (2) Because pi-args treats a present ceiling as
// the declared tool set for an agent that declares none (pi-args.ts:394-398),
// registering this ALSO replaces "no tools: means Pi's full builtin set" with a
// read-only default — FR3 falls out of FR2 rather than needing its own machinery.
let ceiling: { update(c: unknown): void; dispose(): void } | undefined;
```

and inside the `session_start` handler:

```ts
ceiling = registerSubagentCapabilityCeiling({
  sessionId: ctx.currentSessionId ?? "hv-session",
  source: "happyvibe",
  ceiling: { allowedTools: [...READ_ONLY_CHILD_TOOLS], denyExtensions: true },
});
```

- [ ] **Step 6: Prove the ceiling actually reaches a child's argv**

Add to `tests/subagent-boundary.test.ts`:

```ts
import { resolvePiLaunchToolPlan } from "../pi-runtime/node_modules/pi-subagents/src/runs/shared/pi-args.ts";
import { parseSubagentCapabilityCeiling } from "../pi-runtime/node_modules/pi-subagents/src/api/capability-ceiling.ts";

it("an agent declaring NO tools gets the ceiling as its tool set, not Pi's full builtins", () => {
  const c = parseSubagentCapabilityCeiling({
    version: 1, allowedTools: ["find", "grep", "ls", "read"], denyExtensions: true, sources: ["happyvibe"],
  });
  const plan = resolvePiLaunchToolPlan({ tools: undefined, cwd: process.cwd(), capabilityCeiling: c });
  expect(plan.explicitToolAllowlist, "a --tools flag IS emitted").toBe(true);
  expect(plan.effectiveToolAllowlist.sort()).toEqual(["find", "grep", "ls", "read"]);
  expect(plan.effectiveToolAllowlist).not.toContain("bash");
  expect(plan.effectiveToolAllowlist).not.toContain("write");
});

it("a declared bash is removed when the ceiling does not allow it", () => {
  const c = parseSubagentCapabilityCeiling({
    version: 1, allowedTools: ["read"], denyExtensions: true, sources: ["happyvibe"],
  });
  const plan = resolvePiLaunchToolPlan({ tools: ["read", "bash"], cwd: process.cwd(), capabilityCeiling: c });
  expect(plan.effectiveToolAllowlist).toEqual(["read"]);
  expect(plan.capabilityAudit?.removedTools).toContain("bash");
});
```

- [ ] **Step 7: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-boundary.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add pi-runtime/extensions/hv-subagent-boundary.ts pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-boundary.test.ts
git commit -m "feat(subagents): a read-only capability ceiling is the resting boundary for every child"
```

---

## Task 6: Narrow the ceiling per delegation

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts`
- Modify: `tests/subagent-boundary.test.ts`

**Interfaces:**
- Consumes: Task 4's answer; Task 5's `ceiling` handle and `READ_ONLY_CHILD_TOOLS`.
- Produces: `withBoundary(tools: string[], fn: () => Promise<T>): Promise<T>` inside the bridge — the only place a boundary is ever widened.

**Read Task 4's recorded answer before writing code.** If delegations are **not** serialized, skip Steps 3–4, implement Step 5 instead, and note the reason in the commit message.

- [ ] **Step 1: Write the failing test for the intersection property**

```ts
import { intersectSubagentCapabilityCeilings } from "../pi-runtime/node_modules/pi-subagents/src/api/capability-ceiling.ts";

it("a second registration NARROWS rather than widens — the whole basis of per-delegation scoping", () => {
  const mk = (tools: string[]) => parseSubagentCapabilityCeiling({
    version: 1, allowedTools: tools, denyExtensions: true, sources: ["happyvibe"],
  });
  const both = intersectSubagentCapabilityCeilings(mk(["read", "grep", "bash"]), mk(["read"]));
  expect(both?.allowedTools).toEqual(["read"]);
});

it("intersection can never introduce a tool neither side allowed", () => {
  const mk = (tools: string[]) => parseSubagentCapabilityCeiling({
    version: 1, allowedTools: tools, denyExtensions: false, sources: ["happyvibe"],
  });
  const both = intersectSubagentCapabilityCeilings(mk(["read"]), mk(["bash"]));
  expect(both?.allowedTools).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Expected: PASS immediately — this pins upstream behaviour, and if it fails the per-delegation design is impossible and Step 5's static branch is the only option.

- [ ] **Step 3: Widen the resting ceiling for exactly one approved delegation**

The resting ceiling is read-only. Approving a wider boundary means the resting registration must not intersect it away, so the widening **replaces** the resting value for the duration and restores it after:

```ts
/**
 * Run `fn` with the session ceiling set to exactly `tools`, then restore the
 * read-only resting value.
 *
 * update()-then-restore rather than a second registration, because registrations
 * INTERSECT (pinned above): adding a wider one alongside the read-only resting
 * one would yield the read-only set and silently strip the very tools the human
 * just approved.
 *
 * ponytail: correct only because delegations are serialized through this handler
 * (measured — docs/validation/d1.md §Subagent delegation concurrency). If that
 * ever changes, two overlapping approvals could observe each other's window;
 * upgrade to a queue at that point, and the contract test for serialization is
 * what will tell you.
 */
async function withBoundary<T>(tools: readonly string[], fn: () => Promise<T>): Promise<T> {
  if (!ceiling) return fn();
  ceiling.update({ allowedTools: [...tools], denyExtensions: true });
  try {
    return await fn();
  } finally {
    ceiling.update({ allowedTools: [...READ_ONLY_CHILD_TOOLS], denyExtensions: true });
  }
}
```

- [ ] **Step 4: Note the window's exact extent in a comment above the call site**

The window must cover the child's **spawn**, which happens inside the tool's own execution — not inside our `tool_call` handler. Returning `undefined` from the handler lets the tool run *after* the handler resolves, so `withBoundary` cannot wrap it directly. Wrap the widening around the **approval-to-`tool_execution_end`** span instead: set the boundary when the human approves, and restore it on the `tool_execution_end` for that `toolCallId`. Record this in the comment, because it is the non-obvious half:

```ts
// The spawn happens INSIDE the tool, after this handler resolves — so the window
// is opened here and closed on tool_execution_end for this toolCallId, not with
// a try/finally around a call we do not make.
```

- [ ] **Step 5 (only if Task 4 found no serialization): static ceiling instead**

Delete `withBoundary`. The resting ceiling never changes, and a delegation whose preflight-resolved toolset is not a subset of `READ_ONLY_CHILD_TOOLS` is **denied** in Task 7's gate with:

```
`${agent}` needs ${writeCapable.join(", ")}, which HappyVibe cannot grant a sub-agent in this version. Run that work in this session instead, where each call is gated individually.
```

- [ ] **Step 6: Gate and commit**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-boundary.test.ts
git commit -m "feat(subagents): scope the ceiling to the delegation the human approved"
```

---

## Task 7: The boundary approval prompt

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:670-878` (the `tool_call` gate)
- Modify: `tests/subagent-boundary.test.ts`
- Create: `tests/subagent-approval-bridge.test.ts` (live)

**Interfaces:**
- Consumes: `boundaryRuleName`, `writeCapableIn`, `isReadOnlyBoundary` (Task 5); `resolveSubagentLaunchContract` from `pi-subagents/preflight`.
- Produces: the `hv.permission` envelope gains an optional `boundary` object:

```ts
type PermissionBoundary = {
  agent: string;
  tools: string[];
  writeCapable: string[];   // subset of tools, called out separately
  fanout: boolean;          // "subagent" ∈ tools
  skills: string[];
  context: string;          // "fresh" | "fork" | "profile"
  declarations: string[];   // e.g. ["inheritSkills", "extensions", "outputMode"]
};
```

- [ ] **Step 1: Write the failing test for the rule name**

```ts
it("a delegation gates per agent, so a session grant cannot leak across agents", () => {
  // The gate's permTool for a subagent call must be the virtual name.
  expect(boundaryRuleName("agents-md-maker")).toBe("subagent:agents-md-maker");
});
```

Then add a source-scan assertion, the `tests/modal-layer.test.ts` pattern, because the renderer suite has no DOM:

```ts
it("the bridge never gates a delegation under the bare tool name", () => {
  const src = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");
  expect(src, "boundaryRuleName is used for the subagent permTool").toContain("boundaryRuleName(");
});
```

- [ ] **Step 2: Run it and watch the source scan fail**

Expected: FAIL — `boundaryRuleName(` is not yet in the bridge.

- [ ] **Step 3: Resolve the boundary and gate on it**

In the `tool_call` handler, after the existing `stashPendingTask` line and **before** `const permTool = …`:

```ts
// PRD §12 (2026-08-21): a delegation is approved as a BOUNDARY, so the prompt must
// show the child's resolved reach BEFORE launch. preflight has no side effects —
// it resolves the agent, the effective allowlist and the context mode and returns.
// Deliberately NOT resolved: the model. It would need availableModels/parentModel
// plumbed in here, and the user already knows their session model.
let boundary: PermissionBoundary | undefined;
if (tool === "subagent" && typeof input.agent === "string") {
  try {
    const c = await resolveSubagentLaunchContract({ agent: input.agent, cwd: process.cwd() });
    if (c.ok) {
      const tools = c.tools.effectiveAllowlist;
      boundary = {
        agent: input.agent,
        tools,
        writeCapable: writeCapableIn(tools),
        fanout: tools.includes("subagent"),
        skills: c.skills?.resolved.map((s) => s.name) ?? [],
        context: c.context ?? "fresh",
        declarations: declaredResources(c),
      };
    }
  } catch {
    // Fails CLOSED via the prompt, not by allowing: with no boundary the modal
    // says so, and the user is approving a delegation whose reach we could not
    // resolve — which is exactly when they should be told rather than reassured.
  }
}
```

and set `permTool`:

```ts
const permTool = mcp?.ruleTool ?? browserNav ?? (boundary ? boundaryRuleName(boundary.agent) : tool);
```

Add `boundary` to the `hv.permission` title JSON built further down.

- [ ] **Step 4: Write the live test that a delegation actually prompts per agent**

`tests/subagent-approval-bridge.test.ts`, following `tests/agents-bridge.test.ts`'s shape:

```ts
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

describe.skipIf(!KEY)("delegation boundary approval", () => {
  it("prompts with the resolved boundary and gates as subagent:<agent>", async () => {
    // …spawn Pi with the bridge, ask it to delegate to code-explorer,
    // capture the hv.permission envelope from extension_ui_request.
    expect(env.tool).toBe("subagent:code-explorer");
    expect(env.boundary.tools.sort()).toEqual(["find", "grep", "ls", "read"]);
    expect(env.boundary.writeCapable).toEqual([]);
    expect(env.boundary.fanout).toBe(false);
  });
});
```

Use `askUntil` from `tests/reask.ts` — a model that answers in prose without calling the tool is noise, not a failure.

- [ ] **Step 5: Run the unit tests, then the live file alone**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-boundary.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/live.log; npx vitest run tests/subagent-approval-bridge.test.ts --no-file-parallelism > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

If the live test fails, **check the account has balance before believing anything about the code**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.deepseek.com/chat/completions -H "Authorization: Bearer $KEY" -d '{}'
```

- [ ] **Step 6: Gate and commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-boundary.test.ts tests/subagent-approval-bridge.test.ts
git commit -m "feat(subagents): approve the resolved boundary, gated as subagent:<agent>"
```

---

## Task 8: Render the boundary in the permission modal

**Files:**
- Modify: `src/renderer/src/components/PermissionModal.tsx`
- Modify: `src/renderer/src/hv.d.ts`
- Create: `tests/permission-boundary-render.test.ts`

**Interfaces:**
- Consumes: the `boundary` field on `hv.permission` (Task 7).
- Produces: `boundaryLines(b: PermissionBoundary): string[]` exported from `PermissionModal.tsx` as **data**, because the renderer suite has no DOM and cannot assert on rendered output.

- [ ] **Step 1: Write the failing test**

```ts
import { boundaryLines } from "../src/renderer/src/components/PermissionModal";

const base = { agent: "code-explorer", tools: ["find","grep","ls","read"], writeCapable: [],
               fanout: false, skills: [], context: "fresh", declarations: [] };

describe("boundaryLines", () => {
  it("names the agent and its whole reach", () => {
    const lines = boundaryLines(base);
    expect(lines.join("\n")).toContain("code-explorer");
    expect(lines.join("\n")).toContain("read");
  });

  it("says read-only in words when nothing can change", () => {
    expect(boundaryLines(base).join("\n")).toMatch(/read-only/i);
  });

  it("calls out every write-capable tool BY NAME, never just a count", () => {
    const lines = boundaryLines({ ...base, tools: ["read","bash","write"], writeCapable: ["bash","write"] }).join("\n");
    expect(lines).toContain("bash");
    expect(lines).toContain("write");
    expect(lines).not.toMatch(/2 (tools|write)/);
  });

  it("reports fan-out and declarations, because a hidden declaration changes child behavior", () => {
    const lines = boundaryLines({ ...base, fanout: true, declarations: ["inheritSkills"] }).join("\n");
    expect(lines).toMatch(/delegate|fan.?out/i);
    expect(lines).toContain("inheritSkills");
  });

  it("never shows a model — deliberately out of scope for v1", () => {
    expect(boundaryLines(base).join("\n")).not.toMatch(/model/i);
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — `boundaryLines` is not exported.

- [ ] **Step 3: Implement `boundaryLines` and render it**

Export the pure function, then render `boundaryLines(boundary).map(...)` inside the modal above the existing buttons. Keep the factual summary the modal already shows — the boundary block is additional, never a replacement (§13: a user approves against facts, never the model's `intent`).

- [ ] **Step 4: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/permission-boundary-render.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/renderer/src/components/PermissionModal.tsx src/renderer/src/hv.d.ts tests/permission-boundary-render.test.ts
git commit -m "feat(permissions): the delegation modal shows the child's whole reach"
```

---

## Task 9: The child guard, injected by the wrapper

**Files:**
- Create: `pi-runtime/extensions/hv-child-rules.ts`
- Create: `pi-runtime/extensions/hv-child-guard.ts`
- Create: `tests/hv-child-rules.test.ts`
- Modify: `pi-runtime/bin/pi-node.sh`
- Modify: `src/main/pi/spawn.ts`
- Modify: `tests/mcp-spawn.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `parseRulesFile`, `EMPTY_RULES` from `hv-rules.ts`; `HV_RULES_FILE` / `HV_BYPASS` from the inherited environment (all three child spawn sites do `{...process.env}` — verified).
- Produces:
  - `childDecision(rules, call, opts: { bypass: boolean; rulesReadable: boolean }): { action: "allow" | "deny"; reason?: string; wouldHave: RuleAction }`
  - `HV_CHILD_AUDIT_DIR` env name, set in `spawn.ts`.

- [ ] **Step 1: Write the failing test for the clamp**

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_RULES } from "../pi-runtime/extensions/hv-rules";
import { childDecision } from "../pi-runtime/extensions/hv-child-rules";

const call = (tool: string, input: Record<string, unknown> = {}) => ({ tool, input, workspace: "/ws" });
const opts = { bypass: false, rulesReadable: true };

describe("childDecision", () => {
  it("clamps ask to DENY — there is nobody in a child to ask", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), opts);
    expect(d.action).toBe("deny");
    expect(d.wouldHave).toBe("ask");
  });

  it("the deny reason names the boundary and points escalation at the parent", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), opts);
    expect(d.reason).toMatch(/sub-agent/i);
    expect(d.reason).toMatch(/report|parent|main session/i);
  });

  it("still allows what the parent would auto-allow", () => {
    expect(childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), opts).action).toBe("allow");
  });

  it("an explicit deny rule stays a deny", () => {
    const rules = { global: [{ layer: "command" as const, pattern: "rm *", action: "deny" as const }], workspaces: {} };
    expect(childDecision(rules, call("bash", { command: "rm -rf /" }), opts).action).toBe("deny");
  });

  it("an explicit ALLOW rule on a command is honoured — this is why bash needs the guard at all", () => {
    const rules = { global: [{ layer: "command" as const, pattern: "npm test", action: "allow" as const }], workspaces: {} };
    expect(childDecision(rules, call("bash", { command: "npm test" }), opts).action).toBe("allow");
  });

  it("UNREADABLE rules fail CLOSED for a gated tool, and stay open for a safe one", () => {
    const closed = { bypass: false, rulesReadable: false };
    expect(childDecision(EMPTY_RULES, call("bash", { command: "ls" }), closed).action).toBe("deny");
    expect(childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), closed).action).toBe("allow");
  });

  it("bypass means bypass, and still records what the rules would have said", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), { bypass: true, rulesReadable: true });
    expect(d.action).toBe("allow");
    expect(d.wouldHave).toBe("ask");
  });
});
```

- [ ] **Step 2: Run it**

```bash
L=/tmp/v.log; npx vitest run tests/hv-child-rules.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `hv-child-rules.ts`**

```ts
/**
 * The child's half of the permission engine: the SAME rules, with ask clamped to
 * deny.
 *
 * A child runs `--mode json -p` with stdin ignored and a no-op UI context, so a
 * prompt raised inside one returns `undefined` — silently, and mislabeled
 * source:"user". So there is no third option here: a call the parent would have
 * asked about is refused, with a reason that tells the model where to take it.
 *
 * PURE, like hv-rules.ts, and it reuses that engine rather than re-deriving the
 * verdict — one engine, logic never forks.
 */
import { evaluate, SAFE_TOOLS, type RuleAction, type RulesFile, type ToolCall } from "./hv-rules";

export interface ChildDecision {
  action: "allow" | "deny";
  reason?: string;
  /** The engine's own verdict (allow | ask | deny) — never squashed into the outcome. */
  wouldHave: RuleAction;
}

function denyReason(tool: string, wouldHave: RuleAction): string {
  return (
    `Blocked: '${tool}' is outside the boundary a human approved for this sub-agent ` +
    `(it would have needed ${wouldHave === "ask" ? "approval" : "a rule change"}, and a ` +
    `sub-agent cannot ask). Do not retry and do not work around it — finish what you can ` +
    `within your tools and report what you could not do, so the main session can run it ` +
    `where each call is gated individually.`
  );
}

export function childDecision(
  rules: RulesFile,
  call: ToolCall,
  opts: { bypass: boolean; rulesReadable: boolean },
): ChildDecision {
  const v = evaluate(rules, call);
  // Bypass extends to children — bypass means bypass (PRD §10) — but the row still
  // records the verdict it overrode, exactly like the parent's source:"bypass".
  if (opts.bypass) return { action: "allow", wouldHave: v.action };
  // Unreadable rules must not become "no rules, so the safe defaults apply": that
  // would turn a missing file into a permission grant. Safe-default reads stay
  // open (a child that cannot read is useless and reading is not the hazard).
  if (!opts.rulesReadable && !SAFE_TOOLS.has(call.tool)) {
    return { action: "deny", reason: denyReason(call.tool, "ask"), wouldHave: "ask" };
  }
  if (v.action === "allow") return { action: "allow", wouldHave: v.action };
  return { action: "deny", reason: denyReason(call.tool, v.action), wouldHave: v.action };
}
```

- [ ] **Step 4: Run the test again**

Expected: PASS (7 tests).

- [ ] **Step 5: Write the guard extension**

```ts
/**
 * hv-child-guard — the permission gate INSIDE a sub-agent child.
 *
 * Injected by pi-runtime/bin/pi-node.sh rather than by an agent's `extensions:`
 * key, which is upstream's own documented pattern for child bash policy and has
 * two properties nothing else does: it reaches EVERY child with no per-agent
 * stamping, and `denyExtensions` cannot strip it, because the wrapper runs after
 * pi-args has finished building argv.
 *
 * It never prompts. It cannot: see hv-child-rules.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { EMPTY_RULES, parseRulesFile, type RulesFile } from "./hv-rules";
import { childDecision } from "./hv-child-rules";

export default function hvChildGuard(pi: any): void {
  let rules: RulesFile = EMPTY_RULES;
  let rulesReadable = false;
  const file = process.env.HV_RULES_FILE;
  if (file) {
    try {
      rules = parseRulesFile(fs.readFileSync(file, "utf8"));
      rulesReadable = true;
    } catch {
      rulesReadable = false; // fails CLOSED for gated tools — see childDecision
    }
  }
  const bypass = process.env.HV_BYPASS === "1";
  const runId = process.env.SUBAGENT_RUN_ID || String(process.pid);
  const auditDir = process.env.HV_CHILD_AUDIT_DIR;

  const record = (row: Record<string, unknown>): void => {
    if (!auditDir) return;
    try {
      fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(auditDir, `${runId}.jsonl`), `${JSON.stringify(row)}\n`, { mode: 0o600 });
    } catch {
      // An unwritable audit file must never change a permission outcome.
    }
  };

  pi.on("tool_call", async (event: any) => {
    const tool = String(event.toolName);
    const input = (event.input ?? {}) as Record<string, unknown>;
    const d = childDecision(rules, { tool, input, workspace: process.cwd() }, { bypass, rulesReadable });
    record({
      ts: new Date().toISOString(), runId, tool,
      decision: d.action, wouldHave: d.wouldHave,
      source: bypass ? "bypass" : "child",
      summary: JSON.stringify(input).slice(0, 300),
    });
    return d.action === "deny" ? { block: true, reason: d.reason } : undefined;
  });
}
```

- [ ] **Step 6: Inject it from the wrapper**

In `pi-runtime/bin/pi-node.sh`, add after the `CLI=` line:

```sh
# PRD §12: every child loads HappyVibe's permission guard. PREPENDED, not appended:
# pi-args puts the task LAST as a positional (`Task: …` or `@file`), and a flag
# after a positional is not worth betting the gate on. This script is
# PI_SUBAGENT_PI_BINARY, i.e. children only — the parent uses nodeExecPath().
GUARD="$RUNTIME/extensions/hv-child-guard.ts"
```

and change both exec lines to place `--extension "$GUARD"` immediately after `"$CLI"`:

```sh
  exec "$h" "$CLI" --extension "$GUARD" "$@"
...
exec node "$CLI" --extension "$GUARD" "$@"
```

- [ ] **Step 7: Set the audit dir in spawn.ts**

Beside the existing `HV_RULES_FILE` / `HV_BYPASS` lines in `src/main/pi/spawn.ts`:

```ts
...(opts.childAuditDir ? { HV_CHILD_AUDIT_DIR: opts.childAuditDir } : {}),
```

with `childAuditDir?: string` on `spawnOpts` and a doc comment saying it is under `userData` and read path-confined.

- [ ] **Step 8: Pin the wrapper contract**

Add to `tests/mcp-spawn.test.ts`:

```ts
it("the wrapper injects the child guard before the positional task", () => {
  const sh = readFileSync(path.join(__dirname, "..", "pi-runtime", "bin", "pi-node.sh"), "utf8");
  expect(sh).toContain('--extension "$GUARD" "$@"');
  expect(sh, "never after the positional").not.toContain('"$@" --extension');
});

it("the guard file the wrapper names actually exists", () => {
  expect(existsSync(path.join(__dirname, "..", "pi-runtime", "extensions", "hv-child-guard.ts"))).toBe(true);
});

it("argv reaches the wrapper unchanged, so prepending is safe", () => {
  const src = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents",
                                    "src", "runs", "shared", "pi-spawn.ts"), "utf8");
  expect(src).toContain("return { command: piBinary, args }");
});
```

- [ ] **Step 9: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/hv-child-rules.test.ts tests/mcp-spawn.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add pi-runtime/extensions/hv-child-rules.ts pi-runtime/extensions/hv-child-guard.ts pi-runtime/bin/pi-node.sh src/main/pi/spawn.ts tests/hv-child-rules.test.ts tests/mcp-spawn.test.ts
git commit -m "feat(subagents): every child loads HappyVibe's rule engine, with ask clamped to deny"
```

- [ ] **Step 10: Confirm the guard fires against a real child**

Create `tests/child-guard-bridge.test.ts` (live, `skipIf(!KEY)`): delegate to an agent whose boundary includes `write`, ask it to write a file, and assert the guard's audit file contains a `decision:"deny"` row for `write`. Assert on the **audit row**, not on `tool_execution_start` — that fires before tool_call handlers and therefore can never prove a call was blocked.

```bash
L=/tmp/live.log; npx vitest run tests/child-guard-bridge.test.ts --no-file-parallelism > $L 2>&1; echo "EXIT=$?"; tail -40 $L
git add tests/child-guard-bridge.test.ts && git commit -m "test(subagents): the child guard denies a write inside a real child"
```

---

## Task 10: The native permissions floor

**Files:**
- Modify: `src/main/config.ts` (`writeSubagentConfig`)
- Modify: `tests/subagent-config.test.ts`

**Interfaces:**
- Consumes: `WRITE_CAPABLE_TOOLS` (Task 5).
- Produces: `config.permissions.rules` in `<agentDir>/extensions/subagent/config.json`.

- [ ] **Step 1: Write the failing test**

```ts
it("writes a native permissions floor that denies the write-capable tools", () => {
  writeSubagentConfig();
  const cfg = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(cfg.permissions.rules.write).toBe("deny");
  expect(cfg.permissions.rules.edit).toBe("deny");
});

it("never writes a bash rule — upstream THROWS on one, which would break every child", () => {
  writeSubagentConfig();
  const cfg = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(cfg.permissions.rules).not.toHaveProperty("bash");
});

it("never writes `ask` — that is an in-child LLM arbiter, not a human", () => {
  writeSubagentConfig();
  const cfg = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(Object.values(cfg.permissions.rules)).not.toContain("ask");
});

it("upstream still rejects a bash rule and still reserves its internal tools", () => {
  const src = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents",
                                     "src", "runs", "shared", "permissions.ts"), "utf8");
  expect(src).toContain("is unsupported; pi-subagents leaves bash policy");
  expect(src).toContain("is reserved for child coordination and cannot be gated");
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — no `permissions` key.

- [ ] **Step 3: Implement**

```ts
// PRD §12 (2026-08-21) — the redundant floor beneath the ceiling and the guard.
// Three lines, an independent mechanism, and it holds even if hv-child-guard.ts
// fails to load: the gate that reads this lives in subagent-prompt-runtime.ts,
// which pi-args ALWAYS passes (it is PROMPT_RUNTIME_EXTENSION_PATH), so unlike
// the third-party permission-system extension it survives denyExtensions.
//
// It can never be primary, and none of these limits is fixable from here:
// `bash` is rejected at validation AND hardcoded to allow; `ask` resolves to an
// in-child LLM arbiter rather than a human; and an agent's own frontmatter can
// WIDEN it, because resolvePermissionRules DELETES every `allow` entry from the
// merged map. The ceiling is what actually holds.
config.permissions = { rules: { write: "deny", edit: "deny", multi_edit: "deny" } };
```

- [ ] **Step 4: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/config.ts tests/subagent-config.test.ts
git commit -m "feat(subagents): a native permissions floor beneath the ceiling"
```

---

## Task 11: Plan mode allows a read-only delegation

**Files:**
- Modify: `pi-runtime/extensions/hv-plan.ts:174,193-225`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:775`
- Modify: `tests/hv-plan.test.ts`

**Interfaces:**
- Consumes: `isReadOnlyBoundary` (Task 5), the `boundary` resolved in Task 7.
- Produces: `PlanGate` gains `| { kind: "needs-boundary" }`.

- [ ] **Step 1: Write the failing test**

```ts
it("subagent is no longer blocked outright while planning", () => {
  expect(gatePlanCall("subagent", { agent: "code-explorer" }).kind).toBe("needs-boundary");
});

it("the tools that ARE blocked while planning are unchanged", () => {
  for (const t of ["edit", "write", "multi_edit", "terminal_run", "browser_click", "browser_type", "browser_evaluate"]) {
    expect(gatePlanCall(t, {}).kind, t).toBe("block");
  }
});

it("a read-only boundary passes and a wider one does not", () => {
  expect(isReadOnlyBoundary(["read", "grep", "find", "ls"])).toBe(true);
  expect(isReadOnlyBoundary(["read", "bash"])).toBe(false);
});

it("the bridge handles needs-boundary — an unhandled variant must not fall through to allow", () => {
  const src = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");
  expect(src).toContain('"needs-boundary"');
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — `gatePlanCall("subagent")` returns `block`.

- [ ] **Step 3: Change the gate**

Remove `"subagent"` from `BLOCKED_PLAN_TOOLS`, extend the union, and add the branch:

```ts
export type PlanGate =
  | { kind: "block"; reason: string }
  | { kind: "floor-ask" }
  | { kind: "pass" }
  /**
   * §23 (2026-08-21): a delegation's verdict depends on the child's RESOLVED
   * toolset, which this pure module cannot see — preflight is async and lives in
   * the bridge. So the answer is deferred rather than guessed.
   *
   * It is a distinct variant, not a `pass`, on purpose: the union's exhaustiveness
   * check makes a caller that forgets to resolve the boundary fail the TYPECHECK
   * instead of silently allowing an unbounded child during a read-only mode.
   */
  | { kind: "needs-boundary" };
```

```ts
if (toolName === "subagent") return { kind: "needs-boundary" };
```

placed **before** the `BLOCKED_PLAN_TOOLS` check so intent is unmissable.

- [ ] **Step 4: Handle it in the bridge**

At `happyvibe-bridge.ts:775`, in the plan-clamp block:

```ts
if (g.kind === "needs-boundary") {
  // §23: planning IS exploration, so a read-only delegation is exactly what a
  // planning session should be able to do. Anything wider stays blocked — the
  // banner would otherwise be lying about "read-only".
  if (!boundary || !isReadOnlyBoundary(boundary.tools)) {
    const why = boundary
      ? `'${boundary.agent}' can use ${writeCapableIn(boundary.tools).join(", ") || "tools outside the read-only set"}`
      : "its reach could not be resolved";
    audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "plan" });
    ctx.ui.notify(JSON.stringify({ kind: "hv.plan.blocked", toolName: tool, toolCallId: event.toolCallId, reason: why }), "info");
    return { block: true, reason: `Plan mode is read-only — ${why}. Delegate a read-only exploration instead, or exit plan mode to run it.` };
  }
  planFloorAsk = true; // a read-only delegation still prompts while planning
}
```

- [ ] **Step 5: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/hv-plan.test.ts tests/subagent-boundary.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add pi-runtime/extensions/hv-plan.ts pi-runtime/extensions/happyvibe-bridge.ts tests/hv-plan.test.ts
git commit -m "feat(plan): a read-only delegation is allowed while planning"
```

---

## Task 12: Ingest the guard's decisions into the EventLog

**Files:**
- Create: `src/main/subagentAudit.ts`
- Create: `tests/subagent-audit.test.ts`
- Modify: `src/main/ipc.ts`, `src/main/analytics.ts`, `src/renderer/src/components/AuditView.tsx`, `src/renderer/src/hv.d.ts`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:388` (the `AuditSource` union)

**Interfaces:**
- Consumes: the guard's `<HV_CHILD_AUDIT_DIR>/<runId>.jsonl` rows (Task 9).
- Produces:
  - `readGuardAudit(dir: string, runId: string): GuardAuditRow[]`
  - `rollupRow(rows: GuardAuditRow[]): { attempted: number; denied: number }`
  - `AuditSource` gains `"subagent"`.

- [ ] **Step 1: Write the failing test**

```ts
describe("readGuardAudit", () => {
  it("reads the guard's rows and skips a torn last line", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hv-audit-"));
    writeFileSync(path.join(dir, "r1.jsonl"),
      '{"ts":"2026-08-21T00:00:00Z","runId":"r1","tool":"read","decision":"allow","wouldHave":"allow","source":"child"}\n' +
      '{"ts":"2026-08-21T00:00:01Z","runId":"r1","tool":"write","decision":"deny","wouldHave":"ask","source":"child"}\n' +
      '{"ts":"2026-08-21T00:0');
    const rows = readGuardAudit(dir, "r1");
    expect(rows).toHaveLength(2);
    expect(rows[1].decision).toBe("deny");
  });

  it("refuses a dir outside the confined root", () => {
    expect(readGuardAudit("/etc", "passwd")).toEqual([]);
  });

  it("rolls up attempted and denied", () => {
    expect(rollupRow([
      { tool: "read", decision: "allow" } as any,
      { tool: "write", decision: "deny" } as any,
    ])).toEqual({ attempted: 2, denied: 1 });
  });

  it("a run with no denials still produces a rollup, so silence is recorded", () => {
    expect(rollupRow([{ tool: "read", decision: "allow" } as any])).toEqual({ attempted: 1, denied: 0 });
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `subagentAudit.ts`**

Path-confine to the `HV_CHILD_AUDIT_DIR` root (the `resolveInWorkspace` pattern from `files.ts`), parse line-by-line skipping unparseable lines (a torn final line is normal for an appending writer), and return typed rows.

- [ ] **Step 4: Drain on completion and write EventLog rows**

In `ipc.ts`, where `hv.subagent` completion is already handled, read the run's rows, append one EventLog entry per row with `source:"subagent"` plus `runId` and `agent` (main already knows `runId → agent` from the run card — do **not** invent an env var for it), then append the rollup entry. Delete the file after a successful drain.

- [ ] **Step 5: Extend the union and both consumers**

`AuditSource` gains `"subagent"`; `AuditView.tsx` gets a distinct label; `analytics.ts` gets a `bySource` bucket. Follow the `dangerous`/`bypass` precedent: those two fold to **one** label because a rename left old rows behind — a new source needs no fold, but check the switch statements have no `default` that would silently swallow it.

- [ ] **Step 6: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/subagentAudit.ts src/main/ipc.ts src/main/analytics.ts src/renderer/src/components/AuditView.tsx src/renderer/src/hv.d.ts pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-audit.test.ts
git commit -m "feat(audit): a child's permission decisions reach the EventLog"
```

---

## Task 13: Restore the live child transcript via `/subagents-inspect-rpc`

**Files:**
- Create: `src/main/subagentInspect.ts`
- Create: `tests/subagent-inspect.test.ts`
- Modify: `src/main/ipc.ts:1086` (the session client's `ui-request` handler)
- Modify: `src/renderer/src/agents.ts` and the subagent card component

**Interfaces:**
- Consumes: the RPC `setWidget` frame `{type:"extension_ui_request", id, method:"setWidget", widgetKey, widgetLines, widgetPlacement}` — already re-emitted by `PiClient.ts:81-82` as `ui-request`, so **PiClient needs no change**.
- Produces:
  - `INSPECT_WIDGET_KEY = "subagent-inspect"`, `INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:"`
  - `parseInspectFrame(frame: unknown): InspectReply | null`

- [ ] **Step 1: Write the failing test**

```ts
describe("parseInspectFrame", () => {
  const reply = { kind: "pi-subagents.inspect-reply", version: 1, requestId: "q1", asyncId: "r1",
                  messages: [{ role: "assistant", kind: "text", text: "hi" }] };

  it("parses the emit frame", () => {
    const got = parseInspectFrame({ method: "setWidget", widgetKey: "subagent-inspect",
      widgetLines: [`PI_SUBAGENT_INSPECT_JSON:${JSON.stringify(reply)}`] });
    expect(got?.requestId).toBe("q1");
    expect(got?.messages?.[0].text).toBe("hi");
  });

  it("ignores the retract frame rather than treating it as an empty reply", () => {
    expect(parseInspectFrame({ method: "setWidget", widgetKey: "subagent-inspect", widgetLines: undefined })).toBeNull();
  });

  it("ignores another extension's widget", () => {
    expect(parseInspectFrame({ method: "setWidget", widgetKey: "async-status", widgetLines: ["x"] })).toBeNull();
  });

  it("ignores a non-setWidget ui-request, so the permission channel is untouched", () => {
    expect(parseInspectFrame({ method: "select", title: '{"kind":"hv.permission"}' })).toBeNull();
  });

  it("upstream still returns a string ARRAY — RPC setWidget silently drops anything else", () => {
    const src = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents",
                                       "src", "runs", "background", "inspect-rpc.ts"), "utf8");
    expect(src).toContain("export function encodeInspectReply");
    expect(src).toMatch(/encodeInspectReply[\s\S]{0,120}string\[\]/);
    const rpc = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "@earendil-works",
                                       "pi-coding-agent", "dist", "modes", "rpc", "rpc-mode.js"), "utf8");
    expect(rpc, "arrays only").toMatch(/content === undefined \|\| Array\.isArray\(content\)/);
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```ts
/**
 * §12 (2026-08-21): the live child transcript, pulled on demand.
 *
 * pi-subagents 0.52 answers /subagents-inspect-rpc by emitting its reply through
 * ctx.ui.setWidget and immediately retracting it. Two non-obvious things make
 * this work, and each would fail SILENTLY:
 *
 *  - Pi's RPC setWidget forwards only `undefined` or an Array (rpc-mode.js) —
 *    upstream's encodeInspectReply returns string[], so the payload survives. A
 *    bare string would produce no frame and no error at all.
 *  - The frame rides `extension_ui_request`, the same channel as our permission
 *    prompts, so PiClient already re-emits it. It expects no response: do not
 *    respondUi, and never let it reach the permission dispatcher.
 */
export const INSPECT_WIDGET_KEY = "subagent-inspect";
export const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";
```

with `parseInspectFrame` checking `method`, `widgetKey`, then the prefix on `widgetLines[0]`, returning `null` for anything else.

- [ ] **Step 4: Drive the command from main**

Add `hv:subagent-inspect(sessionId, asyncId)`: generate a `requestId` matching `/^[A-Za-z0-9_-]{1,64}$/`, send the prompt `/subagents-inspect-rpc <requestId> <asyncId>`, and resolve when a frame with that `requestId` arrives. In the `ui-request` handler, call `parseInspectFrame` **first** and return early on a non-null result so the existing permission/notify dispatch never sees it.

- [ ] **Step 5: Wire the card**

Fetch on **expand**, not on a timer — the point of this route is that it costs no model turn but it is still a round-trip. Render `messages` through the same rows the completion transcript already uses (`toolCalls` → rows, `finalOutput` below), so there is one renderer, not two.

- [ ] **Step 6: Verify against a real respawn**

Inspection is scoped to the current session's async children (`foreign_session`, `no_active_session`). Start an async delegation, trigger a respawn (change a global MCP server to fire the live-reload path), then expand the card. Record the actual behaviour in `docs/validation/d1.md` §The inspect route — including which error code comes back, if any. **Do not** design a fallback before measuring which case occurs.

- [ ] **Step 7: Run, gate, commit**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-inspect.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/subagentInspect.ts src/main/ipc.ts src/renderer/src/agents.ts tests/subagent-inspect.test.ts docs/validation/d1.md
git commit -m "feat(subagents): the run card's transcript comes back, pulled on expand"
```

---

## Task 14: Adversarial fixtures and the contract-test sweep

**Files:**
- Modify: `tests/subagent-adversarial.test.ts`
- Modify: `tests/pi-subagents-contract.test.ts`
- Modify: `docs/validation/d1.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the FR10 evidence PRD §25 names as the precondition for plugin `agents/`.

- [ ] **Step 1: Add the remaining adversarial cases**

```ts
it("frontmatter cannot widen its way out of the ceiling", () => {
  // resolvePermissionRules DELETES every `allow` entry, so an agent CAN widen the
  // native floor. The ceiling is what must still hold.
  const c = ceiling({ allowedTools: ["read"] });
  const plan = resolvePiLaunchToolPlan({ tools: ["read", "write", "bash"], cwd: process.cwd(), capabilityCeiling: c });
  expect(plan.effectiveToolAllowlist).toEqual(["read"]);
});

it("a declared extensions list cannot survive denyExtensions", () => {
  const plan = resolvePiLaunchToolPlan({
    tools: ["read"], extensions: ["/tmp/evil.ts"], cwd: process.cwd(), capabilityCeiling: ceiling(),
  });
  expect(plan.configuredExtensions).toEqual([]);
  expect(plan.extensionArgs.some((a) => a.includes("evil"))).toBe(false);
});

it("a subagentOnlyExtensions entry cannot survive denyExtensions either", () => {
  const plan = resolvePiLaunchToolPlan({
    tools: ["read"], subagentOnlyExtensions: ["/tmp/evil2.ts"], cwd: process.cwd(), capabilityCeiling: ceiling(),
  });
  expect(plan.extensionArgs.some((a) => a.includes("evil2"))).toBe(false);
});

it("a grandchild can only narrow — fan-out cannot escape", () => {
  const parent = ceiling({ allowedTools: ["read", "grep"] });
  const childAsk = ceiling({ allowedTools: ["read", "grep", "bash"] });
  expect(intersectSubagentCapabilityCeilings(parent, childAsk)?.allowedTools).toEqual(["grep", "read"]);
});

it("the ceiling can restrict WHICH agents run at all", () => {
  const c = parseSubagentCapabilityCeiling({
    version: 1, allowedTools: ["read"], allowedAgents: ["code-explorer"], denyExtensions: true, sources: ["happyvibe"],
  });
  const plan = resolvePiLaunchToolPlan({ tools: ["read"], cwd: process.cwd(), capabilityCeiling: c, agentName: "evil-agent" });
  expect(plan.capabilityAudit?.agentAllowed).toBe(false);
});
```

- [ ] **Step 2: Run them**

```bash
L=/tmp/v.log; npx vitest run tests/subagent-adversarial.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Any failure here is a **hole in the boundary**, not a bad test. Stop and report rather than adjusting the assertion.

- [ ] **Step 3: Complete the FR11 contract pins**

Add to `tests/pi-subagents-contract.test.ts`: the ceiling env name (`PI_SUBAGENT_CAPABILITY_CEILING_V1`) and registry key; the `pi-args.ts:394` undeclared-agent branch (already covered by Task 5 — assert it lives in the contract file too, since that is the pin-bump gate); `registerPermissionGate` being called from the always-passed prompt runtime; the `inheritSkills:false` default; the preflight result shape; and `getPiSpawnCommand` returning `args` untouched.

- [ ] **Step 4: Write up the evidence**

Add `docs/validation/d1.md` §The subagent boundary: the ceiling's measured effect on child argv, the guard's audit rows verbatim from the live test, the serialization probe result, the inspect-route respawn behaviour, and the adversarial matrix as a table (case → mechanism that stopped it → test that pins it).

- [ ] **Step 5: Full gate, then the live batch**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
npm run live:why
# if it printed anything, run in the BACKGROUND and touch nothing meanwhile:
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"; tail -60 $L
```

- [ ] **Step 6: Commit**

```bash
git add tests/subagent-adversarial.test.ts tests/pi-subagents-contract.test.ts docs/validation/d1.md
git commit -m "test(subagents): pin the boundary against adversarial agent definitions"
```

---

## Verification

### Non-negotiable gates

- `npm run gate` green (build → both typechecks → 139+ files, ~1253+ tests).
- `npm run test:live` green when `npm run live:why` prints anything; run it **after** the commit carrying the Pi-facing change, backgrounded, with no edits to `pi-runtime/` or `src/` in flight.
- `tests/pi-subagents-contract.test.ts` green — it is the pin-bump gate and this round adds six surfaces to it.

### Observable GUI assertions

Each names what will be **true on screen** and **which surface** it is observed on.

**Chat view — the delegation modal:**
1. Asking the agent to explore the codebase raises a permission modal whose header names `code-explorer` and lists exactly `find, grep, ls, read` — four tools, spelled out.
2. **Absence:** that modal shows **no model name** anywhere, and the strings **`glob`** and **`list`** appear nowhere in the tool list (they are not Pi builtins; naming them would fail the whole child run).
3. **Absence:** for a read-only agent, the words **`bash`**, **`write`** and **`edit`** do not appear in the modal at all — not greyed, not struck through, absent. The write-capable callout is what proves this is a real check rather than static copy, so it must be verified in the positive case too: with a temporary agent declaring `tools: read, bash`, the modal names **`bash`** explicitly.
4. Clicking **Allow for session** on `code-explorer`, then asking for a delegation to `agents-md-maker`, raises a **second** modal. One grant does not cover the other agent.

**Settings → Permissions:**
5. After step 4, the session-grant list shows `subagent:code-explorer` — the agent-qualified name, **not** a bare `subagent` entry. This is observed on the Permissions page, not the chat that created it, which is exactly where a wrong rule name would otherwise hide.

**Chat view — plan mode:**
6. With Plan Mode on, the calm banner visible, asking the agent to explore: the delegation **prompts** (floor-of-ask) and, once allowed, runs. The run card appears.
7. **Absence:** with Plan Mode on and a temporary `tools: read, bash` agent, the delegation produces a **"Skipped — not allowed in plan mode"** card naming `bash` in its reason, and **no run card appears at all**.

**Settings → Audit:**
8. After a completed delegation that attempted a denied `write`, the audit list contains a row labelled as a sub-agent decision, showing the agent name and `deny`, interleaved by timestamp with the parent's own rows — plus exactly **one** rollup row for that run.
9. **Absence:** a 40-tool child run does **not** produce 40 rows. Only decisions plus the single rollup. This is the assertion that catches FR7's deferred half being implemented by accident.

**Chat view — the run card:**
10. Expanding a running async delegation's sticky card shows child transcript rows, not just a status line. Expanding it again after completion still shows them (the inspect route survives delivery).

### The regression this design risks

The per-delegation ceiling window (Task 6) opens on approval and closes on `tool_execution_end`. If the close is missed, the session's ceiling stays wide and every later delegation — including one from an agent declaring no `tools:` — inherits it. Perform this sequence:

1. Create a temporary agent declaring `tools: read, bash`; approve one delegation to it and let it finish.
2. Create a second temporary agent with **no `tools:` key at all**; delegate to it.
3. The second modal must list exactly `find, grep, ls, read` and must **not** contain `bash`.

If `bash` appears in step 3, the window leaked. Same sequence with the two delegations issued in **one** turn is the harder case, and it is the one Task 4's probe exists to answer — run both.

### The second regression, cheaper to check

Task 9 prepends `--extension` in `pi-node.sh`, which every child now runs through. If the path is wrong the extension fails to load and children silently run **ungated** — the exact failure this round exists to prevent, and it looks like success. `tests/mcp-spawn.test.ts` asserts the file exists, but the load itself must be seen once: run one delegation and confirm the guard's audit file appears under `HV_CHILD_AUDIT_DIR`. An absent file after a completed run means the guard never loaded.

---

## Self-Review

**Spec coverage:** FR1 → Tasks 7, 8. FR2 → Tasks 5, 6. FR3 → Task 5 Step 6. FR4 → Task 9. FR5 → Task 11. FR6 → Task 9 (bypass in `childDecision`, pinned in Task 9 Step 1). FR7 → Task 12. FR8 → Task 7 (`declarations`) + Task 8 (rendered) + Task 14 (extensions denied). FR9 → Task 9 (env + wrapper, no UI dependency) and the fail-closed test in Task 9 Step 1. FR10 → Tasks 2, 14. FR11 → Task 14 Step 3. FR12 → Task 10. FR13 → Task 13. §6's free/hazard rows → Tasks 1, 2, 3.

**Known gaps, stated rather than hidden:** Task 7's `declaredResources(c)` helper is named but not written out — it reads `inheritSkills`, `extensions`, `subagentOnlyExtensions`, `outputMode` and a `profile` context off the preflight result, and its exact field paths must be read from `SubagentLaunchContractResult` at 0.53 rather than guessed from 0.51. Task 12 Steps 3–5 describe main-side wiring without full code because the insertion points depend on Task 1's red list. Task 13 Steps 4–5 likewise. Each names its files and its assertion.

**Type consistency:** `boundaryRuleName` / `isReadOnlyBoundary` / `writeCapableIn` / `WRITE_CAPABLE_TOOLS` / `READ_ONLY_CHILD_TOOLS` are used under those exact names in Tasks 5, 6, 7, 8, 11, 14. `childDecision` returns `{action, reason?, wouldHave}` in Task 9 and is consumed with those fields in the guard. `PlanGate`'s new member is `{kind:"needs-boundary"}` in both `hv-plan.ts` and the bridge. `AuditSource` gains `"subagent"` and the guard writes `source:"child"|"bypass"` into its own file — **these are deliberately different vocabularies**: the guard's file is upstream-agnostic and main maps it onto the EventLog's `source` when ingesting (Task 12 Step 4).
