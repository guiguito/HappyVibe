# Fleet Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the glanceable-fleet story on the delegation run card — a live per-child context gauge, a bundled write-capable `worker`, an honest agent inventory, per-child stop, an in-flow delegate affordance, and the child's own reasoning on request.

**Architecture:** Four of the five items ride surfaces that already exist. The context gauge and per-child stop are extra fields and one extra verb on the 500 ms `status.json` poll and the event-bus RPC helper the bridge already runs. The agent inventory is repaired by calling pi-subagents' own `discoverAgentsAll` by relative path instead of re-deriving six directories, which fixes the Agents page and the per-turn model roster from one source. `worker` is an ordinary bundled agent file that `installBuiltinAgents` already knows how to install. Only the thinking toggle adds a new main-side reader, and it is a path-confined file read of the same shape as `readSubagentStatus`.

**Tech Stack:** Electron + React + TypeScript, vitest, pi-subagents 0.58.0 (vendored in `pi-runtime/`), Pi 0.84.2.

**Spec:** the "Subagent product round — P4 analysis & ranking" Notion page, section **"Fleet round — scope and decisions (2026-08-29)"** — <https://app.notion.com/p/3cad33dfffca803f9c6dfb0a6dc89c31>. Mirrored as the **Decision (2026-08-29, the fleet round)** paragraph in `docs/prd.md` §12 and in the Notion PRD §12.

## Global Constraints

- **pi-subagents stays pinned at 0.58.0.** No pin moves in this round. Every upstream field named below was read from `pi-runtime/node_modules/pi-subagents/src/` at that version.
- **`pi-runtime/extensions/happyvibe-bridge.ts` is in NEITHER typecheck include list.** The compiler does not check it. Declaration order and undefined locals are yours to verify by reading (see CLAUDE.md).
- **Reaches into pi-subagents internals use a RELATIVE path**, never a bare specifier — the `exports` map blocks bare ones and the failure is at extension LOAD, taking ~18 tests red at once. Precedent: `happyvibe-bridge.ts:55-56`.
- **Every new upstream reach is pinned in `tests/pi-subagents-contract.test.ts`** (key-free, part of the pin-bump gate).
- **Never present an unknown number.** A missing `contextLimit` means no gauge, not a 0% and not a full bar (PRD §19 ruling 3).
- **The gate is `npm run gate`** (= `build` → both typechecks → the non-live suite, ONE command). Never run `npm run typecheck` before it. `npm run lint` / `npm run format` are scaffold leftovers — do not run them.
- **Never pipe a test run to `tail`/`grep`.** Redirect to a log file, echo the exit code, then grep the file:
  ```
  L=/tmp/vitest.log
  npx vitest run <target> > $L 2>&1; echo "EXIT=$?"
  ```
- **`npm run test:live` only when `npm run live:why` prints something**, and it diffs `main...HEAD` so it only sees COMMITTED work. Background it (`run_in_background: true`) and do not touch `pi-runtime/` or `src/` while it runs.
- **`src/main` changes need a dev-server RESTART.** A renderer reload does not rebuild main. Before claiming a main-side fix is live, grep the BUILT artifact (`out/main/index.js`), not the source.

---

### Task 1: The child's context occupancy reaches the renderer

The poller reads `status.json` but drops the two fields the gauge needs. `steps[].tokens.window` is the child's latest turn (input + cache-read, i.e. what is currently occupying its window) and `steps[].contextLimit` is that model's window size, resolved from Pi's registry. Both are rewritten on every child `message_end` (`subagent-runner.ts:3677`, `async-status.ts:287`), so the poll already ticks at the right cadence.

**Files:**
- Modify: `src/main/subagentStatus.ts` (the `SubagentStatus` interface, `readSubagentStatus`, `statusUnchanged`)
- Test: `tests/subagent-status.test.ts`
- Test: `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SubagentStatus.context?: { window: number; limit: number }` — read by Task 2 through the existing `hv:subagent-status` push. Both numbers are always present together or the field is absent entirely.

- [ ] **Step 1: Write the failing tests**

Add to `tests/subagent-status.test.ts`:

```ts
it("reads the child's live context occupancy from steps[]", () => {
  const dir = mkStatusDir({
    state: "running",
    steps: [{ agent: "worker", status: "running", contextLimit: 200_000, tokens: { input: 9_000, output: 400, total: 9_400, window: 12_800, windowPeak: 12_800 } }],
  });
  expect(readSubagentStatus(dir)?.context).toEqual({ window: 12_800, limit: 200_000 });
});

it("omits context entirely when the model has no known window", () => {
  // contextLimit is set from Pi's model registry; an unregistered model has none.
  // A percentage needs both numbers, and half of one must never render as 0%.
  const dir = mkStatusDir({
    state: "running",
    steps: [{ agent: "worker", status: "running", tokens: { input: 9_000, output: 400, total: 9_400, window: 12_800 } }],
  });
  expect(readSubagentStatus(dir)?.context).toBeUndefined();
});

it("omits context when tokens.window is absent (no turn billed yet)", () => {
  const dir = mkStatusDir({ state: "running", steps: [{ agent: "worker", status: "running", contextLimit: 200_000 }] });
  expect(readSubagentStatus(dir)?.context).toBeUndefined();
});

it("treats a moved context window as news worth pushing", () => {
  const a = { state: "running", context: { window: 10, limit: 100 } };
  const b = { state: "running", context: { window: 20, limit: 100 } };
  expect(statusUnchanged(a, b)).toBe(false);
  expect(statusUnchanged(a, { ...a })).toBe(true);
});
```

If `mkStatusDir` does not already exist in that file, add it — it writes `status.json` into a `fs.mkdtempSync(path.join(os.tmpdir(), "hv-status-"))` directory (the tmpdir prefix is load-bearing: `readSubagentStatus` refuses a path outside `os.tmpdir()`) and returns the directory:

```ts
function mkStatusDir(status: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-status-"));
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
  return dir;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-status.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL — `expected undefined to equal { window: 12800, limit: 200000 }`.

- [ ] **Step 3: Add the field to `SubagentStatus`**

In `src/main/subagentStatus.ts`, inside the interface, after `recentTools`:

```ts
  /**
   * The child's LIVE context occupancy — `steps[].tokens.window` (its latest
   * turn: input + cache-read) against `steps[].contextLimit` (that model's
   * window, resolved from Pi's own registry). pi-subagents 0.57 (#1444) added
   * this deliberately separate from cumulative spend, and rewrites both on
   * every child `message_end`, so it moves at the child's turn cadence.
   *
   * Present only when BOTH numbers are. `contextLimit` is absent whenever the
   * resolved model is not in Pi's registry, and a window with nothing to divide
   * by is not a percentage — the card must show no gauge rather than a 0%
   * (PRD §19 ruling 3, the same rule as an unknown price).
   */
  context?: { window: number; limit: number };
```

- [ ] **Step 4: Read it in `readSubagentStatus`**

In `readSubagentStatus`, after the `children` block and before the `return`:

```ts
  // First step only: a fan-out's children each have their own window, and one
  // bar cannot honestly represent several. Multi-child runs get per-child rows
  // instead (see the child-stop task).
  const limit = step?.contextLimit;
  const window = (step?.tokens as { window?: unknown } | undefined)?.window;
  const context =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0 && typeof window === "number" && Number.isFinite(window)
      ? { window, limit }
      : undefined;
```

and add `...(context ? { context } : {}),` to the returned object, beside the existing `...(children.length ? { children } : {})`.

- [ ] **Step 5: Add it to `statusUnchanged`**

`statusUnchanged` decides whether a tick is worth pushing; a field it does not compare is a field that never updates after the first tick. Add to the `&&` chain:

```ts
    a.context?.window === b.context?.window &&
    a.context?.limit === b.context?.limit &&
```

- [ ] **Step 6: Pin the upstream fields in the contract test**

Add to `tests/pi-subagents-contract.test.ts`. This is the pin-bump gate: if upstream renames or drops either field, this fails rather than the gauge silently disappearing.

```ts
describe("pi-subagents live child context contract (PRD §12, 2026-08-29)", () => {
  const types = readFileSync(subagentsSrc("shared", "types.ts"), "utf8");
  const projection = readFileSync(subagentsSrc("runs", "background", "async-status.ts"), "utf8");

  it("TokenUsage still carries `window` — the child's live occupancy, not its total", () => {
    expect(types).toMatch(/interface TokenUsage[\s\S]{0,400}?window\?: number/);
  });

  it("an async status step still carries `contextLimit` — the divisor", () => {
    expect(types).toMatch(/steps\?: Array<\{[\s\S]*?contextLimit\?: number/);
  });

  it("BOTH survive into the status.json projection, which is all we can read", () => {
    // The status file is our only channel for a detached run; a field that lives
    // only on the in-process type would read as permanently absent.
    expect(projection).toMatch(/contextLimit\?: number/);
    expect(projection).toMatch(/tokens\?: TokenUsage/);
  });

  it("upstream still updates the window per child turn, not only at the end", () => {
    const runner = readFileSync(subagentsSrc("runs", "background", "subagent-runner.ts"), "utf8");
    // If this moved to a completion-only write the gauge would be dead on arrival
    // while still type-checking and still passing every test above.
    expect(runner).toMatch(/message_end[\s\S]{0,1500}?step\.tokens = \{[^}]*window/);
  });
});
```

Reuse the file's existing `subagentsSrc` helper; do not add a second path helper.

- [ ] **Step 7: Run the tests to verify they pass**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-status.test.ts tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/subagentStatus.ts tests/subagent-status.test.ts tests/pi-subagents-contract.test.ts
git commit -m "feat(subagents): read the child's live context occupancy off the status poll"
```

---

### Task 2: The run card shows the gauge, and the intent moves to its own line

The card header today is one row: dot, robot, agent name + intent, then status · elapsed · tokens · cost, then STOP. Adding a fifth figure to that row makes it unreadable, so the gauge takes the header and the intent drops to a line beneath it.

**Files:**
- Modify: `src/renderer/src/agents.ts` (`DelegationRun.live`)
- Modify: `src/renderer/src/App.tsx:897-912` (the `onSubagentStatus` handler)
- Modify: `src/renderer/src/components/ChatView.tsx` (`DelegationRunCard`)
- Create: `src/renderer/src/subagentGauge.ts`
- Test: `tests/subagent-gauge.test.ts`
- Test: `tests/agents-renderer.test.ts`

**Interfaces:**
- Consumes: `SubagentStatus.context` from Task 1, arriving on the existing `hv:subagent-status` push.
- Produces: `childGauge(context?: {window:number;limit:number}): {percent:number; zone:GaugeZone; label:string} | null` from `src/renderer/src/subagentGauge.ts`. Used by Task 5's per-child rows.

- [ ] **Step 1: Write the failing test**

Create `tests/subagent-gauge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { childGauge } from "../src/renderer/src/subagentGauge";

describe("childGauge", () => {
  it("renders occupancy as a percentage in the session gauge's own zones", () => {
    // zoneOf's thresholds (context.ts): calm <35, amber 35-80, red >=80.
    expect(childGauge({ window: 12_800, limit: 200_000 })).toEqual({ percent: 6, zone: "calm", label: "13k/200k" });
    expect(childGauge({ window: 100_000, limit: 200_000 })).toMatchObject({ percent: 50, zone: "amber" });
    expect(childGauge({ window: 180_000, limit: 200_000 })).toMatchObject({ percent: 90, zone: "red" });
  });

  it("is null with no measurement — a missing window is never a 0% gauge", () => {
    expect(childGauge(undefined)).toBeNull();
  });

  it("clamps a window that exceeds its limit rather than reporting over 100%", () => {
    expect(childGauge({ window: 260_000, limit: 200_000 })).toMatchObject({ percent: 100, zone: "red" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-gauge.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL — cannot resolve `../src/renderer/src/subagentGauge`.

- [ ] **Step 3: Write the module**

Create `src/renderer/src/subagentGauge.ts`:

```ts
/**
 * §12 (2026-08-29, the fleet round): a delegation child's context occupancy,
 * as a percentage in the SAME zones as the session gauge.
 *
 * Reusing `zoneOf` rather than picking fresh thresholds is the whole point —
 * §9's gauge already taught the user what amber means, and a child's head
 * filling up should read in the colours they have learned.
 *
 * Returns null whenever there is nothing to divide, which is how the card
 * shows no gauge instead of a 0% standing in for "not measured yet"
 * (PRD §19 ruling 3, one surface over).
 */
import { zoneOf, type GaugeZone } from "./context";
import { fmtNum } from "./analytics-format";

export function childGauge(
  context?: { window: number; limit: number },
): { percent: number; zone: GaugeZone; label: string } | null {
  if (!context || !(context.limit > 0)) return null;
  const percent = Math.min(100, Math.round((context.window / context.limit) * 100));
  return { percent, zone: zoneOf(percent), label: `${fmtNum(context.window)}/${fmtNum(context.limit)}` };
}
```

If `fmtNum(12_800)` does not render `13k`, adjust the expected strings in the test to whatever `fmtNum` actually produces — `fmtNum` is the app's one number formatter and must not be forked.

- [ ] **Step 4: Run it to verify it passes**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-gauge.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 5: Carry the field through the renderer state**

In `src/renderer/src/agents.ts`, inside `DelegationRun["live"]`, after `cost`:

```ts
    /**
     * The child's live context occupancy (§12, 2026-08-29). Like `cost`, the
     * last reading is KEPT when a tick arrives without one — a finishing run
     * must freeze on what it reached, never blank back to no gauge.
     */
    context?: { window: number; limit: number };
```

In `src/renderer/src/App.tsx`, in the `onSubagentStatus` handler's `live` object (currently ending at `cost: cost ?? run.live?.cost,`), add:

```ts
          context: status.context ?? run.live?.context,
```

This object is REBUILT on every push, so a field omitted here is silently dropped on the second tick — the same trap the `cost` comment beside it already records.

- [ ] **Step 6: Restructure the card header**

In `src/renderer/src/components/ChatView.tsx`, import the helper:

```ts
import { childGauge } from "../subagentGauge";
```

Inside `DelegationRunCard`, beside `const currentTool = run.live?.currentTool;`:

```ts
  const gauge = running ? childGauge(run.live?.context) : null;
```

Then restructure the header. The expand button's inner `<span>` currently holds the agent name AND the intent; the intent moves out to a second row, and the gauge takes the space it leaves. Replace the agent-name span with the name alone:

```tsx
                <span className="flex-1 min-w-0 break-words">
                  <span className="font-black text-tangerine-deep">{run.agent}</span>
                </span>
```

Add the gauge immediately after that button and before the `running ? (...)` status span:

```tsx
              {/* §12 (2026-08-29): the child's own context gauge — §9's headline
                  differentiator, per child. Zones are the session gauge's own
                  (subagentGauge.ts). Absent when the model has no known window:
                  no bar at all, never a 0%. */}
              {gauge && (
                <span
                  title={`This subagent's context window: ${gauge.label} tokens used`}
                  className={`shrink-0 font-mono text-[10px] font-bold rounded-full border px-1.5 py-0.5 ${GAUGE_TONE[gauge.zone]}`}
                >
                  {gauge.percent}%
                </span>
              )}
```

Add the tone map beside the component (mirroring `ContextBubble`'s `ZONE`, rest state only — this pill is not a toggle):

```tsx
/** §12: the run card's context pill, in ContextBubble's own zone hues. */
const GAUGE_TONE: Record<GaugeZone, string> = {
  calm: "border-leaf/60 bg-leaf-soft text-leaf",
  amber: "border-honey/60 bg-honey-soft text-tangerine-deep",
  red: "border-berry/60 bg-berry-soft text-berry",
};
```

with `import type { GaugeZone } from "../context";` added to the imports.

Then add the intent row directly below the header `<div>` that closes after the `▾/▸` button, and above the `{running && !open && ...}` shimmer line:

```tsx
            {/* §12 (2026-08-29): the intent moved off the header row. The header
                now carries the gauge alongside elapsed/tokens/cost, and a fifth
                figure sharing a line with wrapping prose was unreadable. */}
            {run.label && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full text-left px-4 pb-2.5 -mt-1 text-sm font-medium text-ink-soft break-words cursor-pointer"
              >
                {run.label}
              </button>
            )}
```

- [ ] **Step 7: Pin the header contract as data**

The renderer suite has no DOM, so pin the mapping as data plus a source scan (the `tests/modal-layer.test.ts` pattern). Add to `tests/agents-renderer.test.ts`:

```ts
describe("the run card header (§12, 2026-08-29)", () => {
  const chat = readFileSync(new URL("../src/renderer/src/components/ChatView.tsx", import.meta.url), "utf8");

  it("renders the gauge from childGauge, never from a second threshold table", () => {
    expect(chat).toContain("childGauge(run.live?.context)");
    // A hand-rolled percentage here would drift from the session gauge silently.
    expect(chat).not.toMatch(/run\.live\?\.context\.window\s*\/\s*run\.live\?\.context\.limit/);
  });

  it("no longer puts the intent on the header row", () => {
    // The old shape was `{run.label && <span ...> — {run.label}</span>}` INSIDE the
    // agent-name span. An absence is exactly what a render test cannot fail on.
    expect(chat).not.toContain('<span className="text-ink-soft font-medium"> — {run.label}</span>');
  });
});
```

- [ ] **Step 8: Run the renderer tests**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-gauge.test.ts tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/subagentGauge.ts src/renderer/src/agents.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx tests/subagent-gauge.test.ts tests/agents-renderer.test.ts
git commit -m "feat(subagents): a live context gauge on the run card, intent on its own line"
```

---

### Task 3: A bundled, write-capable `worker`

The original P4 ask. It is safe to bundle now for exactly the reasons the 2026-08-21 boundary decision sets out — the delegation modal already names `bash`/`write`/`edit` and gates under `subagent:worker`, and the capability ceiling holds the child to what was approved. No new safety machinery.

We author it rather than adopting upstream's. Agent precedence is builtin < package < user < project (`pi-subagents/src/agents/agent-selection.ts`), so a file in the app-owned agent dir shadows upstream's builtin `worker` outright — which also keeps upstream's `defaultContext: fork` and `defaultReads` out of play.

**Files:**
- Create: `pi-runtime/agents/worker.md`
- Test: `tests/pi-subagents-contract.test.ts`
- Test: `tests/builtin-agents-uninstall.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an agent named `worker`, delegatable as `subagent:worker`, installed by the existing `installBuiltinAgents(bundleDir)` (`src/main/config.ts:550`) with no code change — it copies every `.md` in the bundle dir.

- [ ] **Step 1: Write the agent file**

Create `pi-runtime/agents/worker.md`. The tool list is a STRICT allowlist from pi-subagents >=0.40 — an unknown name fails the whole run — and Pi 0.84's builtins are exactly `bash, edit, find, grep, ls, read, write`. `contact_supervisor` is deliberately omitted: it needs the intercom relay `writeSubagentConfig` disables.

```markdown
---
name: worker
description: General-purpose implementation subagent. Delegate a self-contained change to it — it reads the code, makes the edit and can run commands to check its own work. Ask for exploration instead if nothing should change.
tools: read, grep, find, ls, bash, edit, write
inheritGlobalContext: false
---

You are Worker, a general-purpose implementation subagent.

Your job is to carry out one self-contained change and report what you did. You
can read, search, edit and write files, and run shell commands.

How to work:

- Read before you write. Find the code that already does something similar and
  follow it — matching the surrounding style matters more than your preference.
- Make the smallest change that does the job. Do not refactor code you were not
  asked to touch, and do not add abstractions nobody asked for.
- Check your own work. If the project has a test or build command, run the
  narrowest one that covers what you changed, and report the real result.
- Stay inside the task. If the work turns out to need something outside it —
  a dependency, a wider change, a decision — stop and say so rather than
  guessing.

What you may not do:

- Do not `git commit`, `git push`, or otherwise change version-control state.
  The human reviews the working tree.
- Do not install packages or change dependency manifests unless the task says to.
- Do not weaken or delete a test to make something pass. A failing test is a
  finding; report it.

Report back with: what you changed (file by file), what you ran and what it
said, and anything you noticed but deliberately left alone. Be concise — your
answer is read in a chat window, not a document.

Some tools may be unavailable to you: the human approves a boundary for each
delegation and you cannot exceed it. If a tool you expected is missing, say what
you would have done with it instead of trying to work around it.
```

The last paragraph matters: the capability ceiling can narrow the tool set below the frontmatter list, and an agent that does not know that will thrash.

- [ ] **Step 2: Run the existing contract tests to verify the file is legal**

`tests/pi-subagents-contract.test.ts` already has a "bundled agent definitions declare only child tools that exist" group that scans `pi-runtime/agents/*.md` and derives the legal tool set from Pi's own registrations, plus a check that no bundled prompt tells the agent to use a tool it lacks.

```
L=/tmp/vitest.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS. If it fails, the failure names the offending tool — fix the frontmatter, not the test.

- [ ] **Step 3: Write the failing test for the shadowing guarantee**

The whole reason authoring is free is that a user-scope file beats upstream's builtin. If upstream ever reorders that merge, our `worker` silently stops being the one that runs — and the symptom would be a `worker` with `defaultContext: fork` and a different prompt, which no other test would catch.

Add to `tests/pi-subagents-contract.test.ts`:

```ts
describe("our bundled agents still shadow upstream's builtins of the same name", () => {
  const selection = readFileSync(subagentsSrc("agents", "agent-selection.ts"), "utf8");

  it("merges builtins FIRST, so later scopes overwrite them by name", () => {
    const builtinAt = selection.indexOf("of builtinAgents");
    const userAt = selection.indexOf("of userAgents");
    expect(builtinAt).toBeGreaterThan(-1);
    expect(userAt).toBeGreaterThan(builtinAt);
    expect(selection).toContain("agentMap.set(agent.name, agent)");
  });

  it("upstream ships a builtin `worker` — the name we are deliberately taking", () => {
    const names = readFileSync(subagentsSrc("agents", "builtin-names.ts"), "utf8");
    expect(names).toContain('"worker"');
  });

  it("ours declares no defaultContext, so the config's `fresh` governs it", () => {
    // Upstream's worker.md declares `defaultContext: fork`. Ours must not adopt
    // it by copy-paste: config defaultSubagentContext wins over an agent
    // defaultContext, but only for agents that leave it unset is that obvious.
    const ours = readFileSync(new URL("../pi-runtime/agents/worker.md", import.meta.url), "utf8");
    expect(ours).not.toMatch(/^defaultContext:/m);
  });
});
```

- [ ] **Step 4: Run it**

```
L=/tmp/vitest.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS (the guarantee already holds at 0.58 — this test exists so a later pin cannot remove it quietly).

- [ ] **Step 5: Check the uninstall/hash test still covers three agents**

`tests/builtin-agents-uninstall.test.ts` pins `installBuiltinAgents`' content-hash behaviour. If it hard-codes a count or a list of bundled agent names, update it to include `worker`; if it derives from the bundle dir, it needs no edit.

```
L=/tmp/vitest.log
npx vitest run tests/builtin-agents-uninstall.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pi-runtime/agents/worker.md tests/pi-subagents-contract.test.ts tests/builtin-agents-uninstall.test.ts
git commit -m "feat(agents): bundle a write-capable worker, authored not adopted"
```

---

### Task 4: The agent inventory stops under-reporting — on the page and in the model's prompt

`enumerateAgents()` in the bridge reads two directories. pi-subagents discovers from six, plus package agents, and walks UP from cwd to find the project root. The same function feeds the roster injected into the system prompt each turn, which states *"the agents above are the full, current list"* — false today.

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (`agentDirs`, `enumerateAgents`)
- Modify: `pi-runtime/extensions/hv-agents.ts` (`AgentSource`, `renderSubagentSection`)
- Modify: `src/renderer/src/agents.ts` (`AgentInfo.source`)
- Modify: `src/renderer/src/components/AgentsView.tsx` (`SOURCE_TONE`, the edit/duplicate affordances)
- Test: `tests/hv-agents.test.ts`
- Test: `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AgentDef.source` widened to `"builtin" | "bundled" | "user" | "project" | "package"`, carried unchanged through the `hv.agents` notify into `AgentInfo.source`. Task 6's `@agent` menu reads the same list.

- [ ] **Step 1: Widen the source type and write the failing test**

In `pi-runtime/extensions/hv-agents.ts`:

```ts
/**
 * Where an agent came from. Widened 2026-08-29 (the fleet round) from
 * builtin|project: pi-subagents discovers from six directories plus installed
 * packages, and the app listed two of them.
 *
 * `builtin` is UPSTREAM's packaged roster; `bundled` is ours (the app-owned
 * agent dir). They were both "builtin" before, which is why nobody noticed the
 * seven upstream ones were missing from the page.
 */
export type AgentSource = "builtin" | "bundled" | "user" | "project" | "package";
```

Add to `tests/hv-agents.test.ts`:

```ts
it("keeps every discovered source through toAgentDef", () => {
  for (const source of ["builtin", "bundled", "user", "project", "package"] as const) {
    const def = toAgentDef({ name: "a", description: "d" }, source, "/x/a.md");
    expect(def?.source).toBe(source);
  }
});
```

- [ ] **Step 2: Write the failing test for the roster copy**

The false sentence is the more serious half. Add to `tests/hv-agents.test.ts`:

```ts
it("no longer claims the injected roster is the full list", () => {
  const section = renderSubagentSection([
    { name: "worker", description: "does things", source: "bundled", path: "/x/worker.md" },
  ]);
  expect(section).toContain("worker");
  // It never was the full list, and from this round it is derived from
  // upstream's own discovery — but the model must not be told a superlative
  // that a project-local agent file can falsify between one turn and the next.
  expect(section).not.toContain("the full, current list");
});
```

- [ ] **Step 3: Run both to verify they fail**

```
L=/tmp/vitest.log
npx vitest run tests/hv-agents.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL on the roster assertion (`the full, current list` is still present).

- [ ] **Step 4: Fix the roster copy**

In `hv-agents.ts`, `renderSubagentSection`, replace:

```
    "Do NOT call `{ action: \"list\" }` first — the agents above are the full, current list. " +
```

with:

```
    "Delegate to one of these by name rather than calling `{ action: \"list\" }` first. " +
```

- [ ] **Step 5: Replace `enumerateAgents` with upstream's own discovery**

In `pi-runtime/extensions/happyvibe-bridge.ts`, add the import beside the two existing relative reaches (`:55-56`), and extend the comment block above them to name the third:

```ts
import { discoverAgentsAll } from "../node_modules/pi-subagents/src/agents/agents.ts";
```

Delete `agentDirs()` and replace `enumerateAgents()` with:

```ts
  /**
   * The agent inventory, from pi-subagents' OWN discovery (2026-08-29).
   *
   * This used to read two directories. Upstream reads six — its packaged
   * builtins, PI_SUBAGENT_EXTRA_AGENT_DIRS, <agentDir>/agents, ~/.agents, and
   * both project agent dirs — plus agents contributed by installed packages,
   * and it finds the project root by walking UP from cwd rather than trusting
   * it. Re-deriving that list here is what produced an Agents page missing
   * upstream's seven native builtins, every `~/.agents` agent, and every
   * package agent; the same list feeds the model's per-turn roster, so the
   * drift was not merely cosmetic.
   *
   * `disabled` MUST be filtered: discoverAgentsAll applies our overrides but,
   * unlike discoverAgents, does not drop what they disable — so without this
   * the six external-CLI agents the bridge REFUSES would be advertised to the
   * model and listed on the page as available.
   */
  function enumerateAgents(): AgentDef[] {
    let all: ReturnType<typeof discoverAgentsAll>;
    try {
      all = discoverAgentsAll(process.cwd());
    } catch {
      return []; // discovery must never take the session down
    }
    const ourDir = process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "agents") : null;
    const rows: AgentDef[] = [];
    const push = (list: Array<Record<string, unknown>>, source: AgentSource): void => {
      for (const a of list) {
        if (a.disabled === true) continue;
        const name = typeof a.name === "string" ? a.name : "";
        const description = typeof a.description === "string" ? a.description : "";
        if (!name || !description) continue;
        const filePath = typeof a.filePath === "string" ? a.filePath : "";
        // Our own bundled agents arrive as upstream "user" (they live in the
        // app-owned agent dir); they are the ones the Agents page can edit.
        const resolved: AgentSource = source === "user" && ourDir && filePath.startsWith(ourDir) ? "bundled" : source;
        rows.push({
          name,
          description,
          ...(Array.isArray(a.tools) ? { tools: a.tools as string[] } : {}),
          ...(typeof a.model === "string" && a.model ? { model: a.model } : {}),
          source: resolved,
          path: filePath,
        });
      }
    };
    push(all.builtin as never, "builtin");
    push(all.package as never, "package");
    push(all.user as never, "user");
    push(all.project as never, "project");
    // Later scopes win by name, the same precedence upstream's own merge uses
    // (agent-selection.ts): builtin < package < user < project.
    const byName = new Map<string, AgentDef>();
    for (const r of rows) byName.set(r.name, r);
    return [...byName.values()];
  }
```

Check that `path` is already imported in the bridge (it is — `agentDirs` used it). **The bridge is in neither typecheck include list**, so read the surrounding declaration order yourself: `enumerateAgents` must be declared before `registerCommand("hv-agents", …)` uses it, and `agentDirs` must have no other callers (grep before deleting).

- [ ] **Step 6: Check `agentDirs`' other consumer in main**

`src/main/ipc.ts:3190` calls `agentDirs()` from `src/main/agents.ts` for path-confined agent read/write — that is a DIFFERENT function in a different file, and it stays. Confirm with:

```bash
grep -rn "agentDirs" src/ pi-runtime/extensions/ | grep -v node_modules
```

Expected: hits only in `src/main/agents.ts` and `src/main/ipc.ts`. If the bridge still references it, the delete was incomplete.

- [ ] **Step 7: Pin the third reach in the contract test**

```ts
describe("the agent inventory comes from upstream's own discovery (2026-08-29)", () => {
  it("reaches discoverAgentsAll by relative path — the exports map blocks the bare one", () => {
    const bridge = readFileSync(new URL("../pi-runtime/extensions/happyvibe-bridge.ts", import.meta.url), "utf8");
    expect(bridge).toContain('from "../node_modules/pi-subagents/src/agents/agents.ts"');
    expect(bridge).not.toMatch(/from "pi-subagents\/src\//);
  });

  it("upstream still exports discoverAgentsAll with the four scopes we render", () => {
    const src = readFileSync(subagentsSrc("agents", "agents.ts"), "utf8");
    expect(src).toMatch(/export function discoverAgentsAll\(cwd: string\)/);
    for (const scope of ["builtin", "package", "user", "project"]) {
      expect(src).toMatch(new RegExp(`${scope}: AgentConfig\\[\\]`));
    }
  });

  it("discoverAgentsAll does NOT drop disabled agents, which is why we filter", () => {
    // discoverAgents (singular) filters; discoverAgentsAll does not. Without our
    // own filter the six refused external-CLI agents would be listed as available.
    const src = readFileSync(subagentsSrc("agents", "agents.ts"), "utf8");
    const all = src.slice(src.indexOf("export function discoverAgentsAll"));
    expect(all.slice(0, all.indexOf("export function", 10))).not.toContain("agent.disabled !== true");
    const bridge = readFileSync(new URL("../pi-runtime/extensions/happyvibe-bridge.ts", import.meta.url), "utf8");
    expect(bridge).toContain("a.disabled === true) continue");
  });

  it("upstream still discovers from the dirs our old two-dir scan missed", () => {
    const src = readFileSync(subagentsSrc("agents", "agents.ts"), "utf8");
    expect(src).toContain('path.join(os.homedir(), ".agents")');
    expect(src).toContain("collectPackageSubagentPaths");
    expect(src).toContain("findConfiguredProjectRoot");
  });
});
```

- [ ] **Step 8: Widen the renderer type and the page's tones**

In `src/renderer/src/agents.ts`, `AgentInfo.source`:

```ts
  source: "builtin" | "bundled" | "user" | "project" | "package";
```

In `src/renderer/src/components/AgentsView.tsx`, replace `SOURCE_TONE`:

```tsx
/**
 * §12 (2026-08-29): five sources, because there are five. `bundled` is ours
 * (editable); `builtin` is upstream's packaged roster, which the page hid
 * entirely until this round.
 */
const SOURCE_TONE: Record<string, string> = {
  bundled: "bg-honey-soft text-tangerine-deep border-honey/60",
  builtin: "bg-paper-deep text-ink-soft border-line-strong",
  project: "bg-leaf-soft text-leaf border-leaf/50",
  user: "bg-plum-soft text-plum border-plum/50",
  package: "bg-sky-soft text-sky border-sky/50",
};
```

If any of `plum-soft`/`sky-soft` is not a real token, grep `src/renderer/src/index.css` or `tailwind.config` for the palette and pick from what exists — do not invent a colour.

Update the page subtitle so the list is described honestly:

```tsx
        <p className="text-sm text-ink-soft mb-8">Every subagent this workspace can delegate to — yours, this project's, and the ones your Pi runtime and installed packages provide.</p>
```

and the Section subtitle:

```tsx
        <Section icon="agents" title="Agents" subtitle="Bundled, built-in, project, user and package subagents you can delegate to.">
```

- [ ] **Step 9: Gate Edit/Duplicate on a writable path**

`hv:write-agent` is path-confined to `agentDirs()` in `src/main/agents.ts`. An upstream builtin or package agent lives outside those, so Edit would fail. Duplicate reads the source path and writes into our dir, so it still works everywhere.

In `AgentsView.tsx`, wrap the Edit button:

```tsx
                  {(a.source === "bundled" || a.source === "project") && (
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
```

Showing a disabled Edit on an agent we cannot write is exactly the "don't show what cannot work" pattern the project already applies — omit it, and let Duplicate be the route to a copy the user CAN edit.

- [ ] **Step 10: Run the tests**

```
L=/tmp/vitest.log
npx vitest run tests/hv-agents.test.ts tests/pi-subagents-contract.test.ts tests/agents-bridge.test.ts tests/subagent-discovery-bridge.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS. `subagent-discovery-bridge.test.ts` exercises the roster injection and may assert the old copy — if it does, update the assertion to match the new sentence, not the other way round.

- [ ] **Step 11: Commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts pi-runtime/extensions/hv-agents.ts src/renderer/src/agents.ts src/renderer/src/components/AgentsView.tsx tests/hv-agents.test.ts tests/pi-subagents-contract.test.ts
git commit -m "fix(agents): list every agent that exists, and stop telling the model the list is complete"
```

---

### Task 5: Per-child stop on a fan-out card

Upstream 0.55 (#1367) added a child-scoped stop. It is a distinct RPC method from the `interrupt` the bridge wires today, and it rides the same event-bus request helper.

**Files:**
- Modify: `src/main/subagentStatus.ts` (`SubagentStatus.children`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (a `hv-subagent-stop-child` command)
- Modify: `src/main/ipc.ts` (a `hv:subagent-stop-child` handler beside `hv:subagent-interrupt`)
- Modify: `src/preload/index.ts:241`, `src/renderer/src/hv.d.ts:704`
- Modify: `src/renderer/src/agents.ts` (`DelegationRun.live.children`), `src/renderer/src/App.tsx`, `src/renderer/src/components/ChatView.tsx`
- Test: `tests/subagent-status.test.ts`, `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: `SubagentStatus` from Task 1; `childGauge` from Task 2.
- Produces: `window.hv.subagentStopChild(sessionId: string, runId: string, childId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test for child identity on the poll**

Add to `tests/subagent-status.test.ts`:

```ts
it("carries each child's stoppable identity and its own context", () => {
  const dir = mkStatusDir({
    state: "running",
    steps: [
      { childId: "c0", agent: "worker", status: "running", contextLimit: 200_000, tokens: { window: 20_000 } },
      { childId: "c1", agent: "reviewer", status: "complete", contextLimit: 200_000, tokens: { window: 5_000 } },
    ],
  });
  expect(readSubagentStatus(dir)?.children).toEqual([
    { childId: "c0", agent: "worker", status: "running", context: { window: 20_000, limit: 200_000 } },
    { childId: "c1", agent: "reviewer", status: "complete", context: { window: 5_000, limit: 200_000 } },
  ]);
});
```

Note this CHANGES the existing `children` shape, which today is `{sessionFile, agent}` and feeds the cost readout (`childSessionsByRun` in `ipc.ts:1746`). Keep `sessionFile` on the row — add fields, never replace them — and update the existing `children` test in the same file to expect the extra keys.

- [ ] **Step 2: Run it to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-status.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL — `childId`, `status` and `context` missing from the rows.

- [ ] **Step 3: Extend the children mapping**

In `src/main/subagentStatus.ts`, widen the interface:

```ts
  children?: Array<{
    sessionFile?: string;
    agent?: string;
    /**
     * Upstream's stable caller-facing child identity — the id its `stop` RPC
     * accepts (`child-identity.ts`). Absent on older rows, which is why the
     * per-child STOP renders only when it is present.
     */
    childId?: string;
    status?: string;
    context?: { window: number; limit: number };
  }>;
```

and build every step (not only those with a `sessionFile` — a child that has not written one yet is still stoppable):

```ts
  const stepContext = (st: Record<string, unknown>): { window: number; limit: number } | undefined => {
    const l = st.contextLimit;
    const w = (st.tokens as { window?: unknown } | undefined)?.window;
    return typeof l === "number" && l > 0 && typeof w === "number" && Number.isFinite(w) ? { window: w, limit: l } : undefined;
  };
  const children = steps.map((st) => {
    const ctx = stepContext(st);
    return {
      ...(typeof st.sessionFile === "string" ? { sessionFile: st.sessionFile } : {}),
      ...(typeof st.agent === "string" ? { agent: st.agent } : {}),
      ...(typeof st.childId === "string" ? { childId: st.childId } : {}),
      ...(typeof st.status === "string" ? { status: st.status } : {}),
      ...(ctx ? { context: ctx } : {}),
    };
  });
```

Reuse `stepContext` for the run-level `context` added in Task 1 (`stepContext(step)`), so there is one derivation, not two.

`childSessionsByRun` in `ipc.ts` maps `children` to `{sessionFile, agent}` for cost — it reads `.sessionFile` off each row and now sees rows where it is undefined. Check `runCostNow` and `sessionLedger` skip rows without one; if they do not, filter at the call site:

```ts
      if (status.children?.length) childSessionsByRun.set(runId, status.children.filter((c) => c.sessionFile));
```

- [ ] **Step 4: Add the bridge command**

In `pi-runtime/extensions/happyvibe-bridge.ts`, beside `hv-subagent-interrupt`:

```ts
  /**
   * §12 (2026-08-29): stop ONE child of a fan-out without killing the run
   * (upstream 0.55 / #1367). `stop` is a DIFFERENT RPC method from `interrupt`
   * — it takes a childId, and upstream rejects a malformed one rather than
   * widening to a run-level stop, which is the behaviour we want: a failed
   * per-child stop must never silently kill the siblings.
   */
  pi.registerCommand("hv-subagent-stop-child", {
    description: "HappyVibe: stop one child of a running fan-out. Usage: /hv-subagent-stop-child <runId> <childId>",
    handler: async (args, ctx) => {
      const [runId, childId] = args.trim().split(/\s+/);
      if (!runId || !childId) return;
      const { ok } = await rpcRequest("stop", { runId, childId });
      ctx.ui.notify(subEnvelope({ stage: ok ? "interrupt-sent" : "interrupt-error", runId }), ok ? "info" : "warning");
    },
  });
```

`rpcRequest` and `subEnvelope` are already in scope there. Reusing the existing `interrupt-sent`/`interrupt-error` stages means no renderer parser change — `SubagentEvent.stage` is unchanged.

- [ ] **Step 5: Wire main → preload → renderer**

`src/main/ipc.ts`, beside the `hv:subagent-interrupt` handler:

```ts
  ipcMain.handle("hv:subagent-stop-child", (_e, sessionId: string, runId: string, childId: string) => {
    void (manager.get(sessionId) as PiClient | null)?.send({ type: "prompt", message: `/hv-subagent-stop-child ${runId} ${childId}` }).catch(() => {});
  });
```

`src/preload/index.ts`, beside line 241:

```ts
  subagentStopChild: (sessionId: string, runId: string, childId: string) => ipcRenderer.invoke("hv:subagent-stop-child", sessionId, runId, childId),
```

`src/renderer/src/hv.d.ts`, beside line 704:

```ts
  subagentStopChild(sessionId: string, runId: string, childId: string): Promise<void>;
```

- [ ] **Step 6: Carry children into renderer state**

`src/renderer/src/agents.ts`, in `DelegationRun["live"]`:

```ts
    /** Per-child rows for a fan-out (§12, 2026-08-29). One entry per step. */
    children?: Array<{ childId?: string; agent?: string; status?: string; context?: { window: number; limit: number } }>;
```

`src/renderer/src/App.tsx`, in the `onSubagentStatus` `live` object:

```ts
          children: status.children ?? run.live?.children,
```

- [ ] **Step 7: Render the per-child rows**

In `ChatView.tsx`, `DelegationRunCard` takes a second callback:

```tsx
function DelegationRunCard({ run, trace, onStopRun, onStopChild }: { run: DelegationRun; trace?: SubagentTrace; onStopRun?: (runId: string) => void; onStopChild?: (runId: string, childId: string) => void }): React.JSX.Element {
```

threaded from `DelegationSection` and from `ChatView`'s props exactly as `onStopRun` already is. Inside the async branch of the expansion, above the `recentTools` list:

```tsx
                    {/* §12 (2026-08-29): a fan-out lists its children, each with
                        its own gauge and its own STOP. Only rendered above one
                        child — for a single delegation this would be the run's
                        own STOP wearing a second name. */}
                    {(run.live?.children?.length ?? 0) > 1 &&
                      run.live!.children!.map((c, i) => {
                        const g = childGauge(c.context);
                        const stoppable = running && c.childId && (c.status === "running" || c.status === "pending") && onStopChild;
                        return (
                          <div key={c.childId ?? i} className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 truncate font-semibold text-ink">{c.agent ?? "agent"}</span>
                            {g && <span className={`font-mono text-[10px] font-bold rounded-full border px-1.5 py-0.5 ${GAUGE_TONE[g.zone]}`}>{g.percent}%</span>}
                            <span className="text-[10px] uppercase tracking-wide">{c.status ?? "running"}</span>
                            {stoppable && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onStopChild!(run.id, c.childId!); }}
                                title={`Stop just ${c.agent ?? "this child"}`}
                                className="shrink-0 rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-berry/10 cursor-pointer"
                              >
                                ◼
                              </button>
                            )}
                          </div>
                        );
                      })}
```

In `App.tsx`, pass `onStopChild={(runId, childId) => void window.hv.subagentStopChild(selectedId!, runId, childId)}` wherever `onStopRun` is already passed to `ChatView`.

- [ ] **Step 8: Pin the upstream verb**

Add to `tests/pi-subagents-contract.test.ts`:

```ts
describe("child-scoped stop contract (PRD §12, 2026-08-29)", () => {
  const rpc = readFileSync(subagentsSrc("extension", "rpc.ts"), "utf8");

  it("`stop` is a real RPC method, distinct from `interrupt`", () => {
    expect(rpc).toMatch(/SUBAGENT_RPC_METHODS = \[[^\]]*"interrupt"[^\]]*"stop"/);
  });

  it("`stop` accepts a childId and rejects a malformed one instead of widening", () => {
    // The failure direction matters: a bad childId must not become a run stop
    // that kills the siblings the user was keeping.
    expect(rpc).toContain("RPC stop childId must be a non-empty string");
  });

  it("only pending/running children are stoppable — what the button gates on", () => {
    const id = readFileSync(subagentsSrc("runs", "shared", "child-identity.ts"), "utf8");
    expect(id).toMatch(/isStoppableAsyncStatusStep[\s\S]{0,200}?"pending"[\s\S]{0,40}?"running"/);
  });

  it("a status step still carries the childId that stop resolves", () => {
    expect(readFileSync(subagentsSrc("shared", "types.ts"), "utf8")).toMatch(/steps\?: Array<\{[\s\S]*?childId\?: string/);
  });
});
```

- [ ] **Step 9: Run the tests**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-status.test.ts tests/pi-subagents-contract.test.ts tests/subagent-async-bridge.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/main/subagentStatus.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/agents.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-status.test.ts tests/pi-subagents-contract.test.ts
git commit -m "feat(subagents): stop one child of a fan-out without killing the run"
```

---

### Task 6: `@agent` in the composer, and a roster chip

Nothing in the chat flow suggests the agents exist; discovery is a settings page. Two affordances: `@agent` for the user who types, a chip for the user who looks.

**Files:**
- Modify: `src/renderer/src/mentions.ts`
- Modify: `src/renderer/src/components/ChatView.tsx` (the `@` menu, a new `AgentsChip`)
- Modify: `src/renderer/src/App.tsx` (pass `agents` to `ChatView`)
- Test: `tests/mentions.test.ts` (create if absent)

**Interfaces:**
- Consumes: `AgentInfo[]` from Task 4's widened list, already held in `App.tsx:123`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `tests/mentions.test.ts`:

```ts
import { agentMentionItems } from "../src/renderer/src/mentions";

describe("agentMentionItems", () => {
  const agents = [
    { name: "worker", description: "implements", source: "bundled" as const, path: "/a/worker.md" },
    { name: "code-explorer", description: "reads", source: "bundled" as const, path: "/a/ce.md" },
  ];

  it("matches on a name substring, case-insensitively", () => {
    expect(agentMentionItems(agents, "work").map((a) => a.name)).toEqual(["worker"]);
    expect(agentMentionItems(agents, "EXPLOR").map((a) => a.name)).toEqual(["code-explorer"]);
  });

  it("returns everything for an empty query, so a bare @ shows the roster", () => {
    expect(agentMentionItems(agents, "")).toHaveLength(2);
  });

  it("caps the list so the agent rows never bury the file rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...agents[0], name: `a${i}`, path: `/a/a${i}.md` }));
    expect(agentMentionItems(many, "a").length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/mentions.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL — `agentMentionItems` is not exported.

- [ ] **Step 3: Implement it**

In `src/renderer/src/mentions.ts`:

```ts
/**
 * §12 (2026-08-29): agents in the `@` menu, so delegation is discoverable from
 * the flow rather than only from the Agents page.
 *
 * An agent pick inserts PLAIN TEXT and is deliberately NOT added to the
 * label→relPath map, so `extractMentions` never sees it and it can never be
 * resolved as a file. The model already receives the roster in its system
 * prompt each turn, so "@worker" in the prose is enough for it to delegate.
 *
 * Capped at 5: the `@` menu's job is files, and an unbounded agent list on a
 * one-character query would push every file row off the visible menu.
 */
export function agentMentionItems<T extends { name: string }>(agents: T[], query: string, limit = 5): T[] {
  const q = query.toLowerCase();
  return agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, limit);
}
```

- [ ] **Step 4: Run it to verify it passes**

```
L=/tmp/vitest.log
npx vitest run tests/mentions.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 5: Show agents in the `@` menu**

In `ChatView.tsx`, add `agents` to the props interface (`agents?: AgentInfo[] | null`) and pass it from `App.tsx` (`agents={agents}` on the `<ChatView …>` element).

In the `@file` dropdown block at `ChatView.tsx:1244`, render agent rows above the file rows:

```tsx
                {agentMentionItems(agents ?? [], mention.query ?? "").map((a) => (
                  <button
                    key={`agent:${a.name}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickAgentMention(a.name)}
                    className="w-full text-left px-3 py-1.5 cursor-pointer hover:bg-paper-deep/40"
                  >
                    <span className="font-semibold">🤖 @{a.name}</span>
                    <span className="block truncate text-[11px] font-medium text-ink-soft">{a.description}</span>
                  </button>
                ))}
```

`mention` state currently holds `{start, items, sel}` — add `query` to it where `refreshMention` sets it, taking it from `activeMentionQuery`'s return, which already computes it.

`pickAgentMention` mirrors `pickMention` but skips the map write:

```tsx
  const pickAgentMention = (name: string): void => {
    const el = taRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? input.length;
    // Plain text, NOT registered in mentionMap — an agent is not a file, and a
    // stray entry there would make `extractMentions` try to resolve a path.
    const next = `${input.slice(0, mention.start)}@${name} ${input.slice(caret)}`;
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => { el.focus(); const p = mention.start + name.length + 2; el.setSelectionRange(p, p); });
  };
```

Keyboard nav (`ArrowDown`/`Tab`/`Enter` at `ChatView.tsx:1304`) indexes `mention.items`. Leave it indexing files only — the agent rows are mouse-picked. That is the lazy correct split: it keeps the existing keyboard contract byte-identical rather than re-deriving a combined index.

- [ ] **Step 6: Add the roster chip**

Beside `SkillsChip` in `ChatView.tsx`, and rendered wherever `SkillsChip` is:

```tsx
/**
 * §12 (2026-08-29): the delegate-this affordance. The agents exist and nothing
 * in the flow said so; this is the version a first-time user finds, where
 * `@agent` is the version a hundredth-session user types.
 */
function AgentsChip({ agents, onPick }: { agents: AgentInfo[]; onPick: (name: string) => void }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (agents.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${agents.length} subagent${agents.length === 1 ? "" : "s"} you can delegate to`}
        className="flex items-center gap-1 rounded-full bg-honey-soft text-tangerine-deep text-[11px] font-bold px-2 py-0.5 cursor-pointer hover:brightness-105"
      >
        <span aria-hidden>🤖</span> {agents.length} agents
      </button>
      {open && <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 w-72 max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1.5 text-sm">
          {agents.map((a) => (
            <button
              key={a.path}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(a.name); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 cursor-pointer hover:bg-paper-deep/40"
            >
              <span className="font-bold">{a.name}</span>
              <span className="block text-[11px] text-ink-soft line-clamp-2">{a.description}</span>
            </button>
          ))}
          <p className="px-3 pt-1 text-[10px] text-ink-soft">Or type <span className="font-mono">@</span> in the message box.</p>
        </div>
      )}
    </div>
  );
}
```

`onPick` appends `Ask <name> to ` to the composer and focuses it. Use `onMouseDown` + `preventDefault`, never `onClick` with a blur-dismiss — CLAUDE.md records that a blur-dismissed menu loses its own clicks, reported twice as "none of this menu is clickable".

- [ ] **Step 7: Run the renderer tests**

```
L=/tmp/vitest.log
npx vitest run tests/mentions.test.ts tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/mentions.ts src/renderer/src/components/ChatView.tsx src/renderer/src/App.tsx tests/mentions.test.ts
git commit -m "feat(subagents): delegate from the flow — @agent in the composer and a roster chip"
```

---

### Task 7: The child's reasoning, on request

0.58 exposes the child's own transcript path on both routes. That transcript carries real `type: "thinking"` blocks (measured, `docs/validation/d1.md` Probe 2). A toggle reads it on demand.

**The confinement root is the app's SESSIONS directory, not `os.tmpdir()`.** pi-subagents writes `subagent-artifacts/` flat into our session dir (`src/main/store.ts:268`), so reusing `readSubagentStatus`' tmpdir guard returns nothing at all, silently.

**Files:**
- Create: `src/main/subagentThinking.ts`
- Modify: `src/main/subagentStatus.ts` (`children[].transcriptPath`)
- Modify: `src/main/ipc.ts` (a `hv:subagent-thinking` handler)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Modify: `src/renderer/src/agents.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/ChatView.tsx`
- Test: `tests/subagent-thinking.test.ts`
- Test: `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: `SubagentStatus.children` from Task 5.
- Produces: `window.hv.subagentThinking(transcriptPath: string): Promise<string[]>` — the child's thinking blocks in order, empty on any failure.

- [ ] **Step 1: Write the failing test**

Create `tests/subagent-thinking.test.ts`:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readChildThinking } from "../src/main/subagentThinking";

function mkTranscript(root: string, lines: unknown[]): string {
  const dir = path.join(root, "subagent-artifacts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "run_worker_0_transcript.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

describe("readChildThinking", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));

  it("returns the child's thinking blocks in order", () => {
    const file = mkTranscript(root, [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "first I read the file" }, { type: "text", text: "reading" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "now I write the report" }] },
    ]);
    expect(readChildThinking(root, file)).toEqual(["first I read the file", "now I write the report"]);
  });

  it("refuses a path outside the sessions root", () => {
    // The path arrives from an upstream payload; it is confined on principle,
    // like readSubagentStatus — but against the SESSIONS dir, not tmpdir.
    expect(readChildThinking(root, "/etc/passwd")).toEqual([]);
    expect(readChildThinking(root, path.join(root, "..", "elsewhere.jsonl"))).toEqual([]);
  });

  it("returns empty rather than throwing on a missing or torn file", () => {
    expect(readChildThinking(root, path.join(root, "subagent-artifacts", "nope.jsonl"))).toEqual([]);
    const torn = mkTranscript(root, []);
    fs.writeFileSync(torn, '{"role":"assistant","content":[{"type":"thi');
    expect(readChildThinking(root, torn)).toEqual([]);
  });

  it("survives a transcript with no thinking at all", () => {
    const file = mkTranscript(root, [{ role: "assistant", content: [{ type: "text", text: "done" }] }]);
    expect(readChildThinking(root, file)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-thinking.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: FAIL — cannot resolve `../src/main/subagentThinking`.

- [ ] **Step 3: Write the reader**

Create `src/main/subagentThinking.ts`:

```ts
/**
 * §12 (2026-08-29): a sub-agent's own reasoning, read on demand.
 *
 * pi-subagents 0.58 exposes the child's transcript path on both routes
 * (`results[].transcriptPath` on a foreground delegation, `steps[].transcriptPath`
 * in status.json for a detached one), and that JSONL carries real
 * `type: "thinking"` content blocks — the child's own reasoning, not a copy of
 * the parent's (measured: docs/validation/d1.md, Probe 2). The compact
 * `toolCalls` projection the card already renders does NOT include them, so
 * this file read is the only route.
 *
 * ponytail: read the whole file per expand. A child transcript is a handful of
 * records; stream it only if a run ever produces one big enough to notice.
 *
 * CONFINEMENT: against the app's SESSIONS dir, NOT os.tmpdir(). pi-subagents
 * writes `subagent-artifacts/` flat into our own session directory
 * (store.ts ARTIFACT_DIR), which is a different root from the one
 * subagentStatus.ts guards — reusing that guard here returns nothing, silently.
 *
 * Electron-free so vitest can import it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function readChildThinking(sessionsRoot: string, transcriptPath: string): string[] {
  const root = path.resolve(sessionsRoot);
  const file = path.resolve(transcriptPath);
  if (file !== root && !file.startsWith(root + path.sep)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: { content?: unknown; message?: { content?: unknown } };
    try {
      rec = JSON.parse(line) as typeof rec;
    } catch {
      continue; // a torn last line is normal while the child is still writing
    }
    const content = rec.message?.content ?? rec.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const block = b as { type?: unknown; thinking?: unknown; text?: unknown };
      if (block.type !== "thinking") continue;
      const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
      if (text.trim()) out.push(text);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-thinking.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 5: Carry `transcriptPath` on the poll**

In `src/main/subagentStatus.ts`, add to the `children` row type and to the mapping built in Task 5:

```ts
    /** The child's own transcript JSONL (0.58). Its thinking blocks live here. */
    transcriptPath?: string;
```
```ts
      ...(typeof st.transcriptPath === "string" ? { transcriptPath: st.transcriptPath } : {}),
```

Add `transcriptPath` to the renderer's `DelegationRun.live.children` row type in `src/renderer/src/agents.ts` too.

- [ ] **Step 6: Wire main → preload → renderer**

`src/main/ipc.ts`, beside `hv:subagent-inspect`. Use the SAME sessions-dir accessor `store.ts` uses for `ARTIFACT_DIR` — grep for it rather than re-deriving a path:

```ts
  ipcMain.handle("hv:subagent-thinking", (_e, transcriptPath: string) => readChildThinking(sessionsDir(), transcriptPath));
```

`src/preload/index.ts`:

```ts
  subagentThinking: (transcriptPath: string) => ipcRenderer.invoke("hv:subagent-thinking", transcriptPath),
```

`src/renderer/src/hv.d.ts`:

```ts
  subagentThinking(transcriptPath: string): Promise<string[]>;
```

- [ ] **Step 7: Add the toggle to the card**

In `ChatView.tsx`, inside `DelegationRunCard`:

```tsx
  // §12 (2026-08-29): the child's reasoning, fetched only when asked. This is
  // the app's FIRST thinking surface — the main agent's own reasoning is not
  // rendered anywhere — so it is off by default and costs nothing until opened.
  const [thinking, setThinking] = useState<string[] | null>(null);
  const transcriptPath = run.live?.children?.[0]?.transcriptPath;
  const toggleThinking = (): void => {
    if (thinking) { setThinking(null); return; }
    if (!transcriptPath) return;
    void window.hv.subagentThinking(transcriptPath).then(setThinking);
  };
```

and inside the expansion, above the status rows:

```tsx
                    {transcriptPath && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleThinking(); }}
                        className="self-start text-[11px] font-bold text-plum hover:underline cursor-pointer"
                      >
                        {thinking ? "Hide thinking" : "Show thinking"}
                      </button>
                    )}
                    {thinking?.map((t, i) => (
                      <p key={i} className="text-xs text-ink-soft italic border-l-2 border-plum/40 pl-2 whitespace-pre-wrap">{t}</p>
                    ))}
                    {thinking?.length === 0 && <p className="text-xs text-ink-soft">No reasoning recorded for this run.</p>}
```

Refetch on each open so a running child's reasoning is current — that is why `toggleThinking` clears to `null` rather than caching.

- [ ] **Step 8: Pin the upstream field and the shape**

Add to `tests/pi-subagents-contract.test.ts`:

```ts
describe("child thinking contract (PRD §12, 2026-08-29)", () => {
  it("a status step still carries transcriptPath — our only route to the child's reasoning", () => {
    expect(readFileSync(subagentsSrc("shared", "types.ts"), "utf8")).toMatch(/steps\?: Array<\{[\s\S]*?transcriptPath\?: string/);
  });

  it("the projection keeps it, so a detached run is not blind", () => {
    expect(readFileSync(subagentsSrc("runs", "background", "async-status.ts"), "utf8")).toContain("transcriptPath?: string");
  });

  it("we confine against the sessions dir, never tmpdir", () => {
    // subagent-artifacts lives in OUR session dir. A tmpdir guard here returns
    // nothing at all, and nothing is exactly what a passing test looks like.
    const src = readFileSync(new URL("../src/main/subagentThinking.ts", import.meta.url), "utf8");
    expect(src).not.toContain("os.tmpdir()");
    expect(src).toContain("sessionsRoot");
  });
});
```

- [ ] **Step 9: Run the tests**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-thinking.test.ts tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/main/subagentThinking.ts src/main/subagentStatus.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/agents.ts src/renderer/src/components/ChatView.tsx tests/subagent-thinking.test.ts tests/pi-subagents-contract.test.ts
git commit -m "feat(subagents): show a child's own reasoning, on request"
```

---

### Task 8: Full gate, live batch, and the documented record

- [ ] **Step 1: Run the full gate**

```
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -40 $L
```
Expected: EXIT=0. `gate` runs both typechecks first and fast-fails on them — do not run `npm run typecheck` separately.

Note that `happyvibe-bridge.ts` is in **neither** typecheck include list, so a green typecheck says nothing about Task 4's and Task 5's bridge edits. Read them for declaration order and undefined locals before believing them.

- [ ] **Step 2: Check whether the live batch is required**

```bash
npm run live:why
```

It diffs `main...HEAD`, so run this AFTER the commits above, not before. This round edits `pi-runtime/extensions/` and `src/main/pi/`-adjacent code, so it will almost certainly print something. If it prints nothing, say so explicitly rather than silently skipping.

- [ ] **Step 3: Run the live batch in the background**

```bash
npm run test:live
```
with `run_in_background: true`. It takes ~6 minutes and blocks. Do NOT edit `pi-runtime/` or `src/` while it runs — vitest collects files as it goes and the live files spawn real Pi children, so a mid-run edit yields a result for a tree that never existed.

Before believing ANY red result, check the account has balance:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.deepseek.com/chat/completions -H "Authorization: Bearer $DEEPSEEK_API_KEY" -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}'
```
A `402` means nothing about 0.58 was measured. One live failure ⇒ rerun that file in isolation before calling it a regression.

- [ ] **Step 4: Record the measured wire shapes**

Add a `### The fleet round` section to `docs/validation/d1.md` with, verbatim from a real run: a `status.json` `steps[]` entry showing `contextLimit` and `tokens.window`/`windowPeak`; the `children[]` rows the poll produced for a multi-child run including `childId` and `status`; the `stop` RPC request and its reply; and a `transcriptPath` with two real thinking blocks. An unrecorded measurement gets re-measured.

- [ ] **Step 5: Commit**

```bash
git add docs/validation/d1.md
git commit -m "docs(validation): the fleet round's measured wire shapes"
```

---

## GUI verification

`npm run gate` passing proves none of this. The renderer suite has no DOM, so every claim below is observed by hand or with `mcp__electron-debug`. **Restart the dev server first** — `src/main` changed, and a renderer reload does not rebuild it. Before believing a main-side fix is live: `grep -c "readChildThinking" out/main/index.js`.

### What must be TRUE on screen

**On the chat view, while an async delegation runs** (delegate something long, e.g. "ask code-explorer to map how the permission gate works"):

1. The run card header shows the agent name, a **coloured percentage pill**, then `working · <elapsed> · <n>k tok · ~$<cost>`, then STOP. The delegation's intent is on a **second line beneath the header**, not sharing the header row.
2. The pill's number **climbs as the child takes turns** and its colour follows the session gauge's zones — green under 35%, amber 35–80%, red at 80% and above. Compare against the session's own context bubble in the tab strip: the same percentage on both would mean the child gauge is reading the parent's numbers, which is a bug, not a coincidence.
3. **Absence assertion:** delegate with a model that is not in Pi's registry (any custom/unlisted model id) — the pill **does not render at all**. There must be **no `0%` pill, no `—%` pill and no empty grey bar**. A gauge that appears at zero is the failure this design exists to prevent, and it cannot be screenshotted, so check it deliberately.
4. Expanding the card shows a **"Show thinking"** link. Clicking it renders the child's own reasoning as italic quoted paragraphs. Clicking again hides it. **Absence assertion:** with the card collapsed, and before the link is clicked, **no thinking text is on screen and no file read has happened** — verify with `mcp__electron-debug__get_console_messages` or by confirming the link still reads "Show thinking".

**On the chat view, with a multi-child fan-out** (ask for something that makes the model write a `workflowScript` with `runs.all`, e.g. "review this file with two independent reviewers in parallel"):

5. The expanded card lists **one row per child**, each with the child's agent name, its own percentage pill, its status, and a `◼` button.
6. Clicking one child's `◼` stops **only that child** — the card stays, the sibling keeps working and its elapsed time keeps climbing, and the run does not report `stopped`.
7. **Absence assertion:** on an ordinary single-agent delegation, **no per-child rows and no `◼` appear** in the expansion at all. One child would make the per-child stop a duplicate of the header's STOP.

**On the Agents page** (Sidebar → Agents) — this is the surface that owns the inventory, and it is not the surface Task 4 changed, which is exactly where a wrong default would hide:

8. The list shows **more than the two bundled agents**: `worker`, `code-explorer` and `agents-md-maker` tagged **bundled**, plus upstream's `reviewer`, `scout`, `researcher`, `oracle`, `delegate` and `advisor` tagged **builtin**. Any `~/.agents` agent appears tagged **user** (on this machine, `10x` is one).
9. **Absence assertion, named:** `claude-code`, `claude-code-writer`, `codex-exec`, `codex-exec-writer`, `cursor-agent` and `cursor-agent-writer` are **absent from the list**. All six are `disabled` by our startup write, and `discoverAgentsAll` does *not* filter disabled agents — so if the bridge's filter was dropped, they appear here as available agents the app refuses at delegation time, which is worse than not listing them at all. Check by name, all six.
10. **Edit** appears on `bundled` and `project` rows only. `builtin`, `user` and `package` rows show **Duplicate** but no Edit — `hv:write-agent` is path-confined and Edit would fail on them.

**On the composer:**

11. Typing `@` shows agent rows (🤖 prefixed) above the file rows. Picking one inserts `@worker ` as plain text. Typing `@wor` narrows to `worker`.
12. **Absence assertion:** send a message containing `@worker` and open the transcript's context breakdown — **no file-context block was attached for it**, and the message is not rendered with a file chip. An agent mention that leaked into `mentionMap` would try to resolve a path.
13. A **`🤖 N agents`** chip sits beside the skills chip. Clicking it opens the roster; clicking an entry appends `Ask worker to ` to the composer.

### The regression this design risks

**The `@` menu's keyboard contract.** Agent rows were added above the file rows but the arrow-key/Tab index still addresses `mention.items` (files only). Perform this exactly:

1. Type `@` then a letter that matches **both** an agent and a file (e.g. `@w` with a `worker` agent and a `watch.ts` file present).
2. Press `ArrowDown` twice, then `Tab`.
3. **The completion must be a FILE** — the same file the second row selected before this round — not an agent, and not nothing.
4. Then press `Escape`, retype `@w`, and click the agent row with the mouse.
5. **The completion must be `@worker `**, and the composer must not lose focus between mousedown and mouseup.

Step 5 is the one that breaks: the menu dismisses on blur (`ChatView.tsx:1292`), and CLAUDE.md records that pressing a `<button>` does not focus it, so a blur-dismissed menu unmounts between mousedown and mouseup and the click lands on nothing. The agent rows use `onMouseDown` + `preventDefault()` for that reason. A synthetic `.click()` works even when this is broken, so **test it with a real pointer or with `mcp__electron-debug__click`**, never with `evaluate`.

**Second regression to check:** the run card's collapse-and-slide-away on completion. The header restructure added a second row inside the `grid-rows-[1fr]→[0fr]` height transition. Delegate, let it finish, and watch: the card must show `done` briefly and then collapse to zero height **including the intent row**, with no leftover sliver and no jump.

---

## Self-review

**Spec coverage.** Item 1 → Tasks 1–2. Item 2 → Tasks 3–4 (both halves: the authored agent and the honest inventory, including the false roster sentence). Item 3 → Task 5. Item 4 → Task 6. Item 6 → Task 7. Item 5 was closed in the bump and is deliberately absent. The spec's "package agents are listed, not refused" is Task 4 Step 5's `push(all.package, "package")` plus GUI check 8; its `context: "fork"` non-decision correctly produces no task.

**Type consistency.** `SubagentStatus.context` (Task 1) is read by `childGauge` (Task 2) and reused per child in Task 5's `stepContext`. `AgentSource`'s five values are declared once in `hv-agents.ts` (Task 4 Step 1) and mirrored in `AgentInfo.source` (Step 8) and `SOURCE_TONE` (Step 8). `GAUGE_TONE` is declared in Task 2 Step 6 and used again in Task 5 Step 7. `readChildThinking(sessionsRoot, transcriptPath)` keeps that argument order everywhere.

**Known soft spot.** Task 2 Step 3's expected `fmtNum` output (`13k`) is asserted from the formatter's likely behaviour, not from a run. If it differs, the instruction is to fix the test's expectation, never to fork `fmtNum`.
