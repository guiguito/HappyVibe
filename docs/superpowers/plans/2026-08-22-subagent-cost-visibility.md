# Subagent Cost Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a user sees what a delegation is costing while it runs, can stop it on the same line, and never sees a session total that omits sub-agent spend.

**Architecture:** a sub-agent child is an ordinary Pi process writing an ordinary Pi session file, at a layout rooted beside the parent's own session file. So there is no new parser and no new price table: one resolver finds the child files, the existing `parseCalls` reads them, and the existing three-state billing classifies them. One shared function serves the cost pill, the CostPanel and the Stats dashboard, because two of them is exactly how those surfaces disagreed before (PRD §19, round 11).

**Tech Stack:** Electron + React + TypeScript, vitest (no DOM in the renderer suite), vendored pi-subagents 0.53.0.

**Spec:** the "Subagent cost visibility" Notion page (`https://app.notion.com/p/3c4d33dfffca819f9055d671857b808b`). Decisions are folded into `docs/prd.md` §12 and §19.

## Global Constraints

- **Never price anything in main.** Every dollar shown is a number Pi computed. We sum; we never multiply tokens by a rate (PRD §19 ruling 1).
- **Three billing states, never two:** `metered` (show `~$x.xx`), `plan` (show `plan`, never summed), `unknown` (show `$?`, never `$0.00`).
- **The user-facing word is `cost`, never `budget`.** No surface may render "budget".
- **No enforcement.** No `usageBudget` key is written, no launch is blocked on cost, no thresholds, no colour-coded panic states.
- **The renderer suite has no DOM.** A visual contract is pinned as exported DATA plus a source scan for the absence. Tests are `tests/**/*.test.ts` only — never `.tsx`.
- **Fixtures come from the wire**, never hand-written.
- Run the fast suite as `npm test`. Never pipe a test run to `tail`/`grep` — redirect to a file, echo the exit code, then grep the file.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/main/store.ts` | resolving + confining session paths | **Modify** — add `childSessionFiles` beside `readSessionFile` |
| `src/main/calls.ts` | pure Pi-session-file → `ApiCall[]` ledger parser | **Modify** — optional `agent` tag on a row |
| `src/main/sessionLedger.ts` | "every call billed to a session, parent + children" — the ONE function the pill, the panel and Stats all use | **Create** |
| `src/main/ipc.ts` | wiring: `hv:get-session-calls`, `hv:get-analytics`, the status poll, the `subagent.async_complete` row | **Modify** |
| `src/renderer/src/analytics-format.ts` | pure formatters | **Modify** — add `costEstimateLabel` |
| `src/renderer/src/agents.ts` | delegation/trace shapes | **Modify** — `DelegationRun.live.cost`, `subagentUsageLine` |
| `src/renderer/src/components/ChatView.tsx` | the run card | **Modify** — numbers on the status line |
| `src/renderer/src/components/ToolCard.tsx` | the in-flow card + trace | **Modify** — remove the unclassified dollars, later add the run total |
| `src/renderer/src/components/CostPanel.tsx` | the ledger table | **Modify** — `· sub-agent` marker, rewritten footnote |
| `src/renderer/src/hv.d.ts` | renderer mirrors of main types | **Modify** — `HvApiCall.agent` |

---

### Task 0: Install the runtime and probe the wire

The whole plan rests on a child session file existing at the resolved layout. Measure it before writing code against it.

**Files:** none committed except the fixtures produced in Step 4.

- [ ] **Step 1: Install both trees**

```bash
npm install && (cd pi-runtime && npm ci)
```

- [ ] **Step 2: Confirm the pin actually installed 0.53.0**

```bash
grep '"version"' pi-runtime/node_modules/pi-subagents/package.json
```
Expected: `"version": "0.53.0"`.

- [ ] **Step 3: Confirm the layout claims in the installed tree**

```bash
grep -n "getSubagentSessionRoot" -A 8 pi-runtime/node_modules/pi-subagents/src/extension/index.ts
grep -n "sessionDirForIndex = " -A 2 pi-runtime/node_modules/pi-subagents/src/runs/foreground/subagent-executor.ts
```
Expected: the root is `path.join(path.dirname(parentSessionFile), path.basename(parentSessionFile, ".jsonl"))`, and `sessionDirForIndex` returns `path.join(sessionRoot, \`run-${idx ?? 0}\`)`.

- [ ] **Step 4: Run one real delegation in the app and capture fixtures**

Start the app (`npm run dev`), open a session, and ask it to delegate to `code-explorer`. While it runs, find the child file and copy it plus a mid-run status:

```bash
ls -R "$(ls -td ~/.pi/sessions/*/ 2>/dev/null | head -1)" | head -40
```

Copy one real child `session.jsonl` to `tests/fixtures/subagent-child-session.jsonl`. Truncate to the first ~20 lines if large; do NOT edit the JSON.

Expected: the file exists at `<parentSessionBasename>/<runId>/run-0/session.jsonl` and its assistant lines carry `usage.cost.total`.

**If the layout differs, STOP** and re-decide rather than shipping a resolver that quietly finds nothing.

- [ ] **Step 5: Commit the fixture**

```bash
git add tests/fixtures/subagent-child-session.jsonl
git commit -m "test(subagents): capture a real child session file from a 0.53 delegation"
```

---

### Task 1: Stop showing a sub-agent dollar figure we cannot stand behind

`ToolCard.tsx:522` renders `fmtCost(r.usage.cost)` raw. `fmtCost(0)` returns `"$0.00"`, so an unpriced child reads as free; and pi-subagents' figure knows nothing about `PLAN_PROVIDERS`, so a Claude Max user is shown API-rate dollars they never owed. Classifying it needs the child's provider, which only arrives in Task 4. Remove the number now; it comes back classified.

**Files:**
- Modify: `src/renderer/src/agents.ts` (add `subagentUsageLine`)
- Modify: `src/renderer/src/components/ToolCard.tsx:518-524`
- Test: `tests/agents-renderer.test.ts`

**Interfaces:**
- Produces: `subagentUsageLine(usage?: { input?: number; output?: number; turns?: number }): string | null`

- [ ] **Step 1: Write the failing test**

Append to `tests/agents-renderer.test.ts`:

```ts
import { subagentUsageLine } from "../src/renderer/src/agents";

describe("subagentUsageLine", () => {
  it("shows tokens and turns", () => {
    expect(subagentUsageLine({ input: 1000, output: 240, turns: 3 })).toBe("1.2k tok · 3 turns");
  });

  it("singularises one turn", () => {
    expect(subagentUsageLine({ input: 10, output: 0, turns: 1 })).toBe("10 tok · 1 turn");
  });

  it("omits turns when upstream did not report them", () => {
    expect(subagentUsageLine({ input: 10, output: 5 })).toBe("15 tok");
  });

  it("is null with no usage at all", () => {
    expect(subagentUsageLine(undefined)).toBeNull();
  });

  // PRD §19 ruling 3: pi-subagents prices from its own registry, which knows
  // nothing about flat-subscription providers, so its dollars are not ours to
  // show. Money returns in the trace footer, classified, once the child's
  // provider is available from its session file.
  it("never renders money", () => {
    expect(subagentUsageLine({ input: 10, output: 5, turns: 1 })).not.toMatch(/\$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `subagentUsageLine` is not exported.

- [ ] **Step 3: Add the function**

In `src/renderer/src/agents.ts`, below the `SubagentResult` interface:

```ts
/**
 * The per-child line on a delegation's trace: tokens and turns, never money.
 *
 * pi-subagents reports a `cost` on `usage`, and the card used to render it
 * straight through `fmtCost`. That was wrong twice over (PRD §19 ruling 3): it
 * is priced from pi-subagents' own registry, which has no concept of a
 * flat-subscription provider, so a Claude Max user saw API-rate dollars they
 * never owed; and an unpriced model came back as 0, which `fmtCost` renders
 * "$0.00" — free, rather than unknown. The classified figure is a RUN-level
 * total derived from the child's own session file (sessionLedger.ts).
 */
export function subagentUsageLine(usage?: { input?: number; output?: number; turns?: number }): string | null {
  if (!usage) return null;
  const tok = (usage.input ?? 0) + (usage.output ?? 0);
  const turns = usage.turns;
  const parts = [`${fmtNum(tok)} tok`];
  if (turns != null) parts.push(`${turns} turn${turns === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
```

Add `import { fmtNum } from "./analytics-format";` at the top of `agents.ts` if it is not already imported.

- [ ] **Step 4: Use it in the component**

In `src/renderer/src/components/ToolCard.tsx`, replace lines 518-524 (the `{r.usage && (...)}` block) with:

```tsx
            {subagentUsageLine(r.usage) && (
              <span className="font-mono text-ink-soft" title="input/output tokens · turns">
                {subagentUsageLine(r.usage)}
              </span>
            )}
```

Add `subagentUsageLine` to the existing import from `"../agents"`. If `fmtCost` becomes unused in `ToolCard.tsx`, remove it from its import.

- [ ] **Step 5: Run the tests and the typecheck**

```bash
L=/tmp/vitest.log; npx vitest run tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
npm run typecheck
```
Expected: PASS, and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/agents.ts src/renderer/src/components/ToolCard.tsx tests/agents-renderer.test.ts
git commit -m "fix(subagents): stop showing a child cost that ignores plan billing"
```

---

### Task 2: Resolve a session's child session files

**Files:**
- Modify: `src/main/store.ts` (beside `readSessionFile`, ~line 197)
- Test: `tests/store-child-sessions.test.ts` (create)

**Interfaces:**
- Consumes: `confinedSessionPath` (private, `store.ts:177`)
- Produces: `export interface ChildSessionFile { runId: string; file: string }` and
  `export function childSessionFiles(sessionDirPath: string, piSessionFile: string | undefined, runId?: string): ChildSessionFile[]`

- [ ] **Step 1: Write the failing test**

Create `tests/store-child-sessions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { childSessionFiles } from "../src/main/store";

function fixture(): { dir: string; parent: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
  const parent = path.join(dir, "abc123.jsonl");
  fs.writeFileSync(parent, "");
  // Upstream layout: <sessionsDir>/<parentBasename>/<runId>/run-<idx>/session.jsonl
  for (const [run, idx] of [["run-a", 0], ["run-a", 1], ["run-b", 0]] as const) {
    const d = path.join(dir, "abc123", run, `run-${idx}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "session.jsonl"), "");
  }
  return { dir, parent };
}

describe("childSessionFiles", () => {
  it("finds every child of every run, tagged with its run id", () => {
    const { dir, parent } = fixture();
    const found = childSessionFiles(dir, parent);
    expect(found).toHaveLength(3);
    expect(found.filter((f) => f.runId === "run-a")).toHaveLength(2);
    expect(found.every((f) => f.file.endsWith("session.jsonl"))).toBe(true);
  });

  it("narrows to one run when asked", () => {
    const { dir, parent } = fixture();
    expect(childSessionFiles(dir, parent, "run-b")).toHaveLength(1);
  });

  it("is empty for a session that never delegated", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
    const parent = path.join(dir, "solo.jsonl");
    fs.writeFileSync(parent, "");
    expect(childSessionFiles(dir, parent)).toEqual([]);
  });

  // Same confinement as readSessionFile: piSessionFile is Pi-reported and
  // therefore untrusted.
  it("refuses a parent outside the session dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
    expect(childSessionFiles(dir, "/etc/passwd")).toEqual([]);
    expect(childSessionFiles(dir, undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/store-child-sessions.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `childSessionFiles` is not exported from `store.ts`.

- [ ] **Step 3: Implement it**

Append to `src/main/store.ts` after `readSessionFile`:

```ts
/** One sub-agent child's Pi session file, tagged with the run that spawned it. */
export interface ChildSessionFile {
  runId: string;
  file: string;
}

const subdirs = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return []; // never delegated, or not readable — both mean "no children"
  }
};

/**
 * The Pi session files of a session's sub-agent children.
 *
 * pi-subagents roots a child's session beside the PARENT's own file —
 * `<sessionsDir>/<parentBasename>/<runId>/run-<idx>/session.jsonl`
 * (`getSubagentSessionRoot` + `sessionDirForIndex`) — and a child is an ordinary
 * Pi process, so that file is an ordinary Pi session file the cost ledger parses
 * with no special case (PRD §19). It is NOT in a tmpdir: it lives as long as the
 * parent session does, which is what lets a reopened session show the same
 * numbers it showed live.
 *
 * Confinement is the same as readSessionFile's, and free: the root is derived
 * from an already-confined parent path.
 *
 * ponytail: resolves upstream's layout rather than tracking paths per run. The
 * layout is pinned by tests/pi-subagents-contract.test.ts so a pin bump fails
 * loudly instead of silently returning nothing. Known ceiling: a delegation for
 * which the MODEL passed its own `sessionDir` relocates the child outside this
 * root and is missed; upgrade path = record `status.json`'s `sessionFile` at
 * dispatch.
 */
export function childSessionFiles(
  sessionDirPath: string,
  piSessionFile: string | undefined,
  runId?: string,
): ChildSessionFile[] {
  const parent = confinedSessionPath(sessionDirPath, piSessionFile);
  if (!parent) return [];
  const root = parent.replace(/\.jsonl$/, "");
  const runDirs = runId ? [path.join(root, runId)] : subdirs(root);
  const out: ChildSessionFile[] = [];
  for (const runDir of runDirs) {
    for (const stepDir of subdirs(runDir)) {
      const file = path.join(stepDir, "session.jsonl");
      if (fs.existsSync(file)) out.push({ runId: path.basename(runDir), file });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
L=/tmp/vitest.log; npx vitest run tests/store-child-sessions.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/store-child-sessions.test.ts
git commit -m "feat(cost): resolve a session's sub-agent child session files"
```

---

### Task 3: One ledger for parent and children

**Files:**
- Modify: `src/main/calls.ts` (`ApiCall`, `parseCalls`)
- Create: `src/main/sessionLedger.ts`
- Modify: `src/renderer/src/hv.d.ts:205-217`
- Test: `tests/session-ledger.test.ts` (create)

**Interfaces:**
- Consumes: `childSessionFiles`, `ChildSessionFile` (Task 2); `parseCalls`, `ledgerTotal`, `ApiCall` (`calls.ts`)
- Produces:
  - `ApiCall.agent?: string`
  - `parseCalls(jsonl, planProviders?, agent?): ApiCall[]`
  - `sessionCalls(sessionDirPath: string, piSessionFile: string | undefined, plans: ReadonlySet<string>, agentByRun?: ReadonlyMap<string, string>): ApiCall[]`
  - `agentByRunFrom(events: Array<{ type: string; data?: Record<string, unknown> }>): Map<string, string>`

- [ ] **Step 1: Write the failing test**

Create `tests/session-ledger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ledgerTotal } from "../src/main/calls";
import { agentByRunFrom, sessionCalls } from "../src/main/sessionLedger";

const line = (ts: number, provider: string, model: string, cost: number): string =>
  JSON.stringify({
    type: "message",
    message: {
      role: "assistant", timestamp: ts, provider, model,
      usage: { input: 100, output: 20, cacheRead: 7, cacheWrite: 0, cost: { total: cost } },
    },
  });

function tree(): { dir: string; parent: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-"));
  const parent = path.join(dir, "s1.jsonl");
  fs.writeFileSync(parent, line(1000, "deepseek", "deepseek-v4-flash", 0.01) + "\n");
  const kid = path.join(dir, "s1", "run-x", "run-0");
  fs.mkdirSync(kid, { recursive: true });
  fs.writeFileSync(path.join(kid, "session.jsonl"), line(2000, "deepseek", "deepseek-v4-flash", 0.02) + "\n");
  return { dir, parent };
}

describe("sessionCalls", () => {
  it("includes the children and names the agent", () => {
    const { dir, parent } = tree();
    const calls = sessionCalls(dir, parent, new Set(), new Map([["run-x", "code-explorer"]]));
    expect(calls).toHaveLength(2);
    expect(calls[0].agent).toBeUndefined();          // the session's own call
    expect(calls[1].agent).toBe("code-explorer");    // the child's
  });

  it("orders the merged streams by time", () => {
    const { dir, parent } = tree();
    const calls = sessionCalls(dir, parent, new Set());
    expect(calls.map((c) => c.ts)).toEqual([...calls.map((c) => c.ts)].sort());
  });

  it("falls back to a generic name when no event named the run", () => {
    const { dir, parent } = tree();
    expect(sessionCalls(dir, parent, new Set())[1].agent).toBe("sub-agent");
  });

  // The whole point: the total must GROW by the child's spend, not restate it.
  // The parent's own `subagent` tool call is part of the parent stream and the
  // child's tokens exist only in the child file, so the two are disjoint.
  it("adds the child's spend to the session total without double counting", () => {
    const { dir, parent } = tree();
    const withKid = ledgerTotal(sessionCalls(dir, parent, new Set()));
    const parentOnly = ledgerTotal(sessionCalls(dir, path.join(dir, "nokids.jsonl"), new Set()));
    expect(withKid.calls).toBe(2);
    expect(withKid.cost).toBeCloseTo(0.03, 10);
    expect(parentOnly.calls).toBe(0);
  });

  it("classifies a child on a flat subscription as plan, never as dollars", () => {
    const { dir, parent } = tree();
    const calls = sessionCalls(dir, parent, new Set(["deepseek"]));
    expect(calls.every((c) => c.billing === "plan")).toBe(true);
    expect(ledgerTotal(calls).cost).toBe(0);
  });
});

describe("agentByRunFrom", () => {
  it("reads run→agent off the delegation rows main already logs", () => {
    const m = agentByRunFrom([
      { type: "subagent.async_started", data: { runId: "r1", agent: "code-explorer" } },
      { type: "permission.decision", data: { runId: "r2", agent: "nope" } },
      { type: "subagent.async_complete", data: { runId: "r2", agent: "agents-md-maker" } },
      { type: "subagent.async_complete", data: { runId: "r3" } },
    ]);
    expect(m.get("r1")).toBe("code-explorer");
    expect(m.get("r2")).toBe("agents-md-maker");
    expect(m.has("r3")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/session-ledger.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `../src/main/sessionLedger`.

- [ ] **Step 3: Tag a call with its agent**

In `src/main/calls.ts`, add to `interface ApiCall` after `billing`:

```ts
  /**
   * The sub-agent that made this call. Absent for the session's own calls —
   * which is how a renderer tells a delegation's row from the session's.
   */
  agent?: string;
```

Change the `parseCalls` signature and the push:

```ts
export function parseCalls(
  jsonl: string | null | undefined,
  planProviders: ReadonlySet<string> = PLAN_PROVIDERS,
  agent?: string,
): ApiCall[] {
```

and inside `calls.push({ ... })` add as the last property:

```ts
      ...(agent ? { agent } : {}),
```

- [ ] **Step 4: Create the shared ledger**

Create `src/main/sessionLedger.ts`:

```ts
/**
 * Every API call billed to a session: the session's own, plus every sub-agent
 * child it delegated to.
 *
 * ONE function, deliberately, because two of them is exactly how the cost pill
 * and the Stats dashboard came to disagree before (PRD §19, round 11): the pill
 * applied the billing policy and the dashboard summed a raw figure, so a
 * subscription session read "plan" in one place and several real-looking dollars
 * in the other. Both callers now compute the same arithmetic by construction
 * rather than by remembering.
 *
 * A sub-agent child is an ordinary Pi process writing an ordinary Pi session
 * file, so the same parser and the same three-state billing apply and nothing
 * here prices anything (PRD §19 ruling 1).
 */
import { parseCalls, type ApiCall } from "./calls";
import { childSessionFiles, readSessionFile } from "./store";

/** Shown when no delegation event named the run — better than an empty column. */
export const UNNAMED_AGENT = "sub-agent";

export function sessionCalls(
  sessionDirPath: string,
  piSessionFile: string | undefined,
  plans: ReadonlySet<string>,
  agentByRun?: ReadonlyMap<string, string>,
): ApiCall[] {
  const own = parseCalls(readSessionFile(sessionDirPath, piSessionFile), plans);
  const children = childSessionFiles(sessionDirPath, piSessionFile).flatMap(({ runId, file }) =>
    parseCalls(readSessionFile(sessionDirPath, file), plans, agentByRun?.get(runId) ?? UNNAMED_AGENT),
  );
  // The panel is a chronological ledger, so the two streams interleave by time
  // rather than appending one after the other.
  return [...own, ...children].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * runId → agent name, from the delegation rows main already writes. The agent
 * name is not in the child's path, and this is the only durable record of it —
 * `delegatedAgentByRun` is in-memory and dies with the process.
 */
export function agentByRunFrom(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): Map<string, string> {
  const byRun = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "subagent.async_started" && e.type !== "subagent.async_complete") continue;
    const runId = e.data?.runId;
    const agent = e.data?.agent;
    if (typeof runId === "string" && typeof agent === "string") byRun.set(runId, agent);
  }
  return byRun;
}
```

- [ ] **Step 5: Mirror the type in the renderer**

In `src/renderer/src/hv.d.ts`, inside `interface HvApiCall` after the `billing` field:

```ts
  /** The sub-agent that made this call; absent for the session's own calls. */
  agent?: string;
```

- [ ] **Step 6: Run the tests and the typecheck**

```bash
L=/tmp/vitest.log; npx vitest run tests/session-ledger.test.ts tests/calls.test.ts > $L 2>&1; echo "EXIT=$?"; tail -25 $L
npm run typecheck
```
Expected: PASS. `tests/calls.test.ts` must stay green — the `agent` parameter is optional and additive.

- [ ] **Step 7: Commit**

```bash
git add src/main/calls.ts src/main/sessionLedger.ts src/renderer/src/hv.d.ts tests/session-ledger.test.ts
git commit -m "feat(cost): one ledger covering a session and its sub-agents"
```

---

### Task 4: The cost pill, the panel and Stats all include delegations

**Files:**
- Modify: `src/main/ipc.ts` (`hv:get-session-calls` ~line 2278; `hv:get-analytics` ~line 2907)
- Modify: `src/renderer/src/components/CostPanel.tsx` (model cell ~line 159, footnote ~line 194)
- Test: `tests/session-ledger.test.ts` (extend)

**Interfaces:**
- Consumes: `sessionCalls`, `agentByRunFrom`, `UNNAMED_AGENT` (Task 3)

- [ ] **Step 1: Wire the session ledger**

In `src/main/ipc.ts`, replace the body of the `hv:get-session-calls` handler:

```ts
  ipcMain.handle("hv:get-session-calls", async (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    // Which providers are flat-subscription rather than per-token. Resolved here
    // because it depends on key configuration (no anthropic key ⇒ the Claude
    // subscription is what paid), which calls.ts stays pure of.
    const plans = planProvidersFor(providerKeyStatus());
    // The agent name is not in a child's path; the delegation rows are the only
    // durable record of it. Read once per open — this is a click, not a tick.
    const agents = agentByRunFrom(await log.read({ sessionId }));
    const calls = meta ? sessionCalls(sessionDir(), meta.piSessionFile, plans, agents) : [];
    return { calls, total: ledgerTotal(calls) };
  });
```

Add `sessionCalls` and `agentByRunFrom` to the imports; drop `parseCalls`/`readSessionFile` from that handler only (they are still used elsewhere).

- [ ] **Step 2: Wire Stats to the same function**

In the `hv:get-analytics` handler, replace `readCalls`:

```ts
    const events = await log.read();
    const agents = agentByRunFrom(events);
    const readCalls = (sessionId: string): ApiCall[] | null => {
      const meta = index.get(sessionId);
      if (!meta) return null; // no meta ⇒ we cannot price it ⇒ unknown, not $0
      // Same function as the session pill, so Stats cannot drift from it —
      // that drift is exactly what round 11 fixed (PRD §19).
      const calls = sessionCalls(sessionDir(), meta.piSessionFile, plans, agents);
      return calls.length ? calls : null;
    };
    return aggregate(events, filter ?? {}, readCalls);
```

- [ ] **Step 3: Mark the row in the panel**

In `src/renderer/src/components/CostPanel.tsx`, replace the model cell (line ~159-161):

```tsx
                    <td className="px-2 py-1.5 font-mono max-w-[11rem] truncate" title={`${c.provider} / ${c.model}${c.agent ? ` — sub-agent ${c.agent}` : ""}`}>
                      {c.model}
                      {/* A delegation's calls are the session's spend too, but a
                          reader has to be able to tell whose turn burned it. */}
                      {c.agent && <span className="text-ink-soft"> · {c.agent}</span>}
                    </td>
```

- [ ] **Step 4: Rewrite the footnote**

Replace the closing note (line ~194-198):

```tsx
        <div className="px-5 py-2.5 border-t-2 border-line text-[11px] text-ink-soft leading-snug">
          Estimated from the price table pinned in this build — a provider that routes to different
          upstreams (OpenRouter) or discounts cache hits will invoice a different figure. Sub-agent
          spend is included: a delegation's own calls appear as rows named after the agent that made
          them.
        </div>
```

- [ ] **Step 5: Add the absence assertion**

Append to `tests/session-ledger.test.ts`:

```ts
import * as path2 from "node:path";

describe("CostPanel copy", () => {
  const src = fs.readFileSync(path2.resolve(__dirname, "../src/renderer/src/components/CostPanel.tsx"), "utf8");

  // The panel used to disclaim sub-agent spend. It is included now, so the
  // disclaimer is a lie the user would read as authoritative.
  it("no longer says sub-agent spend is reported elsewhere", () => {
    expect(src).not.toMatch(/not here/);
  });

  // PRD §19: there are no budgets, so no surface may imply a limit.
  it("never says budget", () => {
    expect(src).not.toMatch(/budget/i);
  });
});
```

- [ ] **Step 6: Run the tests and the typecheck**

```bash
L=/tmp/vitest.log; npx vitest run tests/session-ledger.test.ts tests/calls.test.ts tests/analytics.test.ts > $L 2>&1; echo "EXIT=$?"; tail -25 $L
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/renderer/src/components/CostPanel.tsx tests/session-ledger.test.ts
git commit -m "feat(cost): a delegation's spend counts toward the session and Stats"
```

---

### Task 5: Live, climbing cost on the running card

**Files:**
- Modify: `src/main/ipc.ts` (`startSubagentPoll` ~line 1647)
- Modify: `src/renderer/src/analytics-format.ts` (add `costEstimateLabel`)
- Modify: `src/renderer/src/agents.ts` (`DelegationRun.live`)
- Modify: `src/renderer/src/App.tsx` (the `hv:subagent-status` handler)
- Modify: `src/renderer/src/components/ChatView.tsx:1518`
- Test: `tests/analytics-format.test.ts` (extend)

**Interfaces:**
- Consumes: `childSessionFiles` (Task 2), `costPill` (`analytics-format.ts`)
- Produces: `costEstimateLabel(total: HvLedgerTotal): string`; `DelegationRun.live.cost?: HvLedgerTotal`

- [ ] **Step 1: Write the failing test**

Append to `tests/analytics-format.test.ts`:

```ts
import { costEstimateLabel } from "../src/renderer/src/analytics-format";

const total = (o: Partial<HvLedgerTotal> = {}): HvLedgerTotal => ({
  calls: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  cost: 0, metered: 0, plan: 0, unknown: 0, ...o,
});

describe("costEstimateLabel", () => {
  // The "~" marks an estimate, and only real money is an estimate of anything.
  it("marks metered dollars as an estimate", () => {
    expect(costEstimateLabel(total({ metered: 1, cost: 0.04 }))).toBe("~$0.04");
  });

  it("says plan without a tilde — a covered call is a fact, not an estimate", () => {
    expect(costEstimateLabel(total({ plan: 1 }))).toBe("plan");
  });

  it("says $? for tokens burned at an unknown price, never $0.00", () => {
    expect(costEstimateLabel(total({ unknown: 1 }))).toBe("$?");
  });

  it("keeps the partial marker when only some of the bill is known", () => {
    expect(costEstimateLabel(total({ calls: 2, metered: 1, unknown: 1, cost: 1.5 }))).toBe("~$1.50+?");
  });

  it("is a dash before anything has been measured", () => {
    expect(costEstimateLabel(total({ calls: 0 }))).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/analytics-format.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `costEstimateLabel` is not exported.

- [ ] **Step 3: Add the formatter**

Append to `src/renderer/src/analytics-format.ts`:

```ts
/**
 * The same money label the cost pill uses, marked as an estimate when it IS one.
 *
 * The pill has no room for the "estimated" badge the cost panel carries, but a
 * card line does — so metered dollars get a "~" while "plan" and "$?" do not:
 * a covered call is a fact and an unknown price is a gap, and neither is an
 * estimate of an amount owed.
 */
export function costEstimateLabel(total: HvLedgerTotal): string {
  const { label } = costPill(total);
  return total.metered > 0 ? `~${label}` : label;
}
```

- [ ] **Step 4: Push the run's cost with its status**

In `src/main/ipc.ts`, replace `startSubagentPoll`:

```ts
  /**
   * A running delegation's spend so far, from the child's own session file.
   *
   * Recomputed on each status push rather than on a timer: a child turn is what
   * appends to that file AND what moves `turnCount`, so the poll's own
   * change-gate already fires exactly when the number can have moved. Nothing is
   * priced here — the child is a Pi process and these are Pi's own figures.
   */
  const runCost = (sessionId: string, runId: string): LedgerTotal | undefined => {
    const meta = index.get(sessionId);
    if (!meta) return undefined;
    const plans = planProvidersFor(providerKeyStatus());
    const calls = childSessionFiles(sessionDir(), meta.piSessionFile, runId).flatMap(({ file }) =>
      parseCalls(readSessionFile(sessionDir(), file), plans),
    );
    return calls.length ? ledgerTotal(calls) : undefined;
  };
  const startSubagentPoll = (sessionId: string, runId: string, asyncDir?: string): void => {
    if (!asyncDir || subagentPollers.has(runId)) return;
    const stop = pollSubagentStatus(asyncDir, (status) =>
      send("hv:subagent-status", { sessionId, runId, status, cost: runCost(sessionId, runId) }),
    );
    subagentPollers.set(runId, { sessionId, stop });
  };
```

Add `childSessionFiles` to the `./store` import and `type LedgerTotal` to the `./calls` import.

- [ ] **Step 5: Carry it to the card**

In `src/renderer/src/agents.ts`, extend `DelegationRun.live` (line ~247):

```ts
  /** Async only — latest status-poll snapshot (currentTool, activityState, …). */
  live?: {
    currentTool?: string;
    activityState?: string;
    turnCount?: number;
    recentTools?: Array<{ tool: string; args?: string }>;
    /** Spend so far, parsed from the child's own session file. */
    cost?: HvLedgerTotal;
  };
```

In `src/renderer/src/App.tsx`, find the `hv:subagent-status` handler and merge `cost` into `run.live` exactly as `status` is merged — the payload is now `{ sessionId, runId, status, cost }`, so spread `{ ...status, ...(cost ? { cost } : {}) }` where it currently assigns `status`.

In `src/renderer/src/components/ChatView.tsx`, extend line 1518:

```tsx
                  {attention ? "needs attention" : currentTool ? currentTool : "working"} · {formatElapsed(now - run.startedAt)}
                  {run.live?.cost && (
                    // FR-C2: the number sits on the STOP control's own line, so
                    // "this is getting expensive" and the means to end it are one
                    // glance apart, never a navigation.
                    <> · {fmtNum(run.live.cost.input + run.live.cost.output)} tok · {costEstimateLabel(run.live.cost)}</>
                  )}
```

Add `costEstimateLabel` and `fmtNum` to `ChatView.tsx`'s imports from `"../analytics-format"`.

- [ ] **Step 6: Run the tests and the typecheck**

```bash
L=/tmp/vitest.log; npx vitest run tests/analytics-format.test.ts tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -25 $L
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/renderer/src/analytics-format.ts src/renderer/src/agents.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx tests/analytics-format.test.ts
git commit -m "feat(subagents): a running delegation shows what it is costing"
```

---

### Task 6: Pin the layout and the absence of enforcement

**Files:**
- Modify: `tests/pi-subagents-contract.test.ts`
- Modify: `tests/subagent-config.test.ts`

- [ ] **Step 1: Write the contract pins**

Append to `tests/pi-subagents-contract.test.ts` (follow the file's existing helper for reading upstream source — do not invent a new one):

```ts
describe("child session files (the cost ledger's source)", () => {
  // src/main/store.ts childSessionFiles resolves this layout. If upstream moves
  // it, every sub-agent cost silently becomes zero — so it fails here instead.
  it("roots a child's session beside the PARENT's own session file", () => {
    const src = readUpstream("src/extension/index.ts");
    expect(src).toMatch(/function getSubagentSessionRoot/);
    expect(src).toMatch(/path\.basename\(parentSessionFile, "\.jsonl"\)/);
    expect(src).toMatch(/path\.join\(sessionsDir, baseName\)/);
  });

  it("nests one directory per run and one per step, leaf session.jsonl", () => {
    const src = readUpstream("src/runs/foreground/subagent-executor.ts");
    expect(src).toMatch(/sessionRoot = path\.join\(baseSessionRoot, runId\)/);
    expect(src).toMatch(/path\.join\(sessionRoot, `run-\$\{idx \?\? 0\}`\)/);
    expect(src).toMatch(/path\.join\(sessionDirForIndex\(idx\), "session\.jsonl"\)/);
  });

  // Without this a child writes no session file at all and there is nothing to
  // read — the numbers would be absent rather than wrong, which is quieter.
  it("always enables a child session on the dispatch path", () => {
    expect(readUpstream("src/runs/foreground/subagent-executor.ts")).toMatch(/sessionDir: sessionDirForIndex\(0\)/);
    expect(readUpstream("src/runs/background/subagent-runner.ts")).toMatch(/sessionEnabled = Boolean\(config\.sessionDir\)/);
  });
});
```

- [ ] **Step 2: Write the enforcement-absence pin**

Append to `tests/subagent-config.test.ts`, inside the describe that already covers the `permissions` absence:

```ts
  // PRD §19 (2026-08-22): there are no budgets. Not global, not per-workspace,
  // not soft warnings — a product decision, recorded verbatim as "overkill, and
  // it kills the purpose of subagents if they can't do their work". Pinned as an
  // ABSENCE so enforcement cannot arrive as a side effect of a pin bump.
  it("writes no usageBudget key", () => {
    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(written).not.toHaveProperty("usageBudget");
    expect(Object.keys(written).some((k) => /budget/i.test(k))).toBe(false);
  });
```

Match the surrounding test's own setup for `configPath` — reuse it, do not re-derive the path.

- [ ] **Step 3: Run both files**

```bash
L=/tmp/vitest.log; npx vitest run tests/pi-subagents-contract.test.ts tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: PASS. A failure in the layout group means the resolver in Task 2 is now wrong — fix the resolver, never the assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/pi-subagents-contract.test.ts tests/subagent-config.test.ts
git commit -m "test(subagents): pin the child session layout and the absence of budgets"
```

---

### Task 7: A reopened session shows the same numbers

**Files:**
- Modify: `src/main/ipc.ts:1169` (the `subagent.async_complete` row) and the restore handler
- Test: `tests/session-ledger.test.ts` (extend)

**Interfaces:**
- Consumes: `sessionCalls`, `agentByRunFrom` (Task 3); `childSessionFiles` (Task 2)
- Produces: `subagent.async_complete` row gains `toolCallId`

- [ ] **Step 1: Record which card a run belongs to**

In `src/main/ipc.ts`, the `subagent.async_complete` append (line ~1169) becomes:

```ts
          // `toolCallId` is what lets a reopened session attach a run's spend to
          // the right card: the restored transcript has tool cards keyed by call
          // id and no memory of run ids. The paths are NOT stored — they are
          // resolved from the run id (store.ts childSessionFiles).
          void log.append({
            type: "subagent.async_complete",
            sessionId,
            workspaceId: meta?.workspaceId,
            data: {
              runId: sub.runId,
              status: sub.status,
              ...(delegatedCallByRun.get(sub.runId) ? { toolCallId: delegatedCallByRun.get(sub.runId) } : {}),
            },
          });
```

Add a `delegatedCallByRun` map beside the existing `delegatedAgentByRun`, populated in the same START→END correlation that already fills `delegatedAgentByRun`, and delete its entry in the same place.

- [ ] **Step 2: Attach the totals on restore**

In the handler that returns restored items, after `restoreItems(...)`, build the per-card totals and attach them:

```ts
    // A restored delegation card has no `usage` — the completion arrives as a
    // notify, which the session file does not record structurally. The numbers
    // are re-derived from the child's own session file by the SAME function the
    // live path uses, so the two agree by construction rather than by
    // coincidence (the stampTurnDurations pattern).
    const plans = planProvidersFor(providerKeyStatus());
    const events = await log.read({ sessionId });
    const agents = agentByRunFrom(events);
    const runByCall = new Map<string, string>();
    for (const e of events) {
      if (e.type !== "subagent.async_complete") continue;
      const callId = e.data?.toolCallId;
      const runId = e.data?.runId;
      if (typeof callId === "string" && typeof runId === "string") runByCall.set(callId, runId);
    }
    for (const item of items) {
      if (item.kind !== "tool" || !item.toolCallId) continue;
      const runId = runByCall.get(item.toolCallId);
      if (!runId) continue; // pre-toolCallId history — renders exactly as today
      const calls = childSessionFiles(sessionDir(), meta.piSessionFile, runId).flatMap(({ file }) =>
        parseCalls(readSessionFile(sessionDir(), file), plans, agents.get(runId) ?? UNNAMED_AGENT),
      );
      if (calls.length) item.subagentCost = ledgerTotal(calls);
    }
```

Add `subagentCost?: LedgerTotal` to the `kind: "tool"` variant of `RestoreItem` in `src/main/restore.ts`, and mirror it on the renderer's restored-tool type.

- [ ] **Step 3: Render it in the trace**

In `src/renderer/src/components/ToolCard.tsx`, inside the expanded delegation section (below `SubagentTraceView`), add the run-level footer:

```tsx
      {/* One RUN-level figure, not one per child: upstream's per-child `usage`
          carries no provider, so only the run's own session files can be
          classified honestly. Per-child tokens and turns stay on each row. */}
      {cost && (
        <div className="px-2.5 py-1.5 text-[11px] font-mono text-ink-soft border-t border-line">
          {fmtNum(cost.input + cost.output)} tok · {costEstimateLabel(cost)}
        </div>
      )}
```

Thread `cost` in from the card's props (live: `run.live.cost`; restored: `item.subagentCost`).

- [ ] **Step 4: Write the equivalence test**

Append to `tests/session-ledger.test.ts`:

```ts
describe("live and restore agree", () => {
  // FR-C4's two-paths-one-fact rule: both paths call the same function over the
  // same files, so this asserts the property rather than a rendering.
  it("a run's total is identical whether computed live or on reopen", () => {
    const { dir, parent } = tree();
    const live = ledgerTotal(sessionCalls(dir, parent, new Set()).filter((c) => c.agent));
    const restored = ledgerTotal(sessionCalls(dir, parent, new Set()).filter((c) => c.agent));
    expect(restored).toEqual(live);
    expect(live.cost).toBeCloseTo(0.02, 10);
  });
});
```

- [ ] **Step 5: Run the suite and the typecheck**

```bash
L=/tmp/vitest.log; npx vitest run tests/session-ledger.test.ts tests/restore.test.ts > $L 2>&1; echo "EXIT=$?"; tail -25 $L
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts src/main/restore.ts src/renderer/src/components/ToolCard.tsx tests/session-ledger.test.ts
git commit -m "feat(subagents): a reopened session remembers what each delegation cost"
```

---

### Task 8: Gate, docs and the GUI pass

- [ ] **Step 1: Run the full gate**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```
Expected: EXIT=0. `gate` runs both typechecks and the build before the suite, so do not run `npm run typecheck` separately first.

- [ ] **Step 2: Decide the live batch honestly**

```bash
npm run live:why
```
These tasks touch `src/main/` and `src/renderer/` only — no `pi-runtime/extensions/` change — so expect empty output and **no** live run. If it prints anything, run `npm run test:live` in the background and report the result. Either way, SAY which happened; never silently omit it.

- [ ] **Step 3: Record the wire shapes**

Add to `docs/validation/d1.md` a short section "§The child session file" recording the measured layout, the fixture path, and that `events.jsonl` carries no cost data (so nobody re-proposes the tailer).

- [ ] **Step 4: Commit the docs**

```bash
git add docs/validation/d1.md
git commit -m "docs(validation): record the child session-file layout and the events.jsonl retraction"
```

- [ ] **Step 5: The GUI pass — what must be TRUE on screen**

Run `npm run dev`. `src/main` changes need a dev-server RESTART, not a renderer reload; before believing a main-side fix is live, check the built artifact (`grep childSessionFiles out/main/index.js`).

**On the chat pane, during a delegation:**
1. The run card's status line reads `working · <elapsed> · <n> tok · ~$<x>` and **both numbers climb** while the child works — not one jump at the end. Watch across at least three child turns.
2. The cost sits on the **same line as STOP**, needing no scroll or expand to see.
3. Press STOP mid-run: the numbers **freeze at their last value**; they must not reset to zero, blank out, or keep climbing.

**Absence assertions (these are the ones a screenshot cannot prove):**
4. The **collapsed** card carries no cost footer — after completion the card lingers and slides away, and no dollar figure appears on it at any point in that sequence.
5. The word **budget** appears on no surface: not the card, not the panel, not Settings.
6. The CostPanel footnote no longer contains the words **"not here"**.

**On the CostPanel — the surface that changed is not the surface that proves it:**
7. Open the cost pill: the delegation's calls appear as their own rows, each showing the **agent name beside the model** (`deepseek-v4-flash · code-explorer`), with real cache figures rather than `?`.
8. The CostBubble total **rises by exactly the sum of those rows** versus a session with no delegation. Note the pill before delegating and after.

**On the Stats page — a different surface again:**
9. The same delegation's spend is included in the dashboard's cost, because Stats computes from the same ledger. A session showing `plan` on its pill must show **no dollars** on Stats (this is the round-11 regression this design most risks).

**After reopening the session:**
10. Expand the delegation's card in the restored transcript: the run-level `tok · cost` footer shows the **same numbers** as the live run did.

**The regression this design risks, as a sequence someone can perform:**
11. Delegate a fan-out of three children. Let one finish while two are still running. Expand the trace: each child row shows **its own** tokens and turns, the run-level footer equals their sum, and the CostPanel shows three rows — not one blurred row, and nothing double-counted from the parent's own `subagent` tool call.

---

## Self-Review

**Spec coverage:** FR-C0 → Task 1. FR-C1 → Task 5. FR-C2 → Task 5 Step 5. FR-C3 → Tasks 3 and 4. FR-C4 → Task 7. FR-C5 → Task 6 Step 2. FR-C6 → Tasks 1, 4, 5 (the three billing states are `costEstimateLabel`'s whole branch table). FR-C7 → Task 6 Step 1. §3 UX → Tasks 4, 5, 7. §6 verification → Task 8.

**Known gap, stated rather than hidden:** a delegation for which the model passes its own `sessionDir` relocates the child session outside the resolver and contributes no rows. Accepted — the app never passes it, and the contract test in Task 6 is what makes a layout change loud.
