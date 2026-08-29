# pi-subagents 0.53 → 0.58 Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** move the `pi-subagents` pin from 0.53.0 to 0.58.0 without letting upstream's six new external-CLI builtin agents silently punch a hole in the §12 permission boundary, and record the four verify-first probes the next round depends on.

**Architecture:** one pin moves, nothing else. The substantive change is a refusal: upstream now bundles six `runner: external-cli` builtin agents that our capability ceiling, child guard and child audit cannot see inside, so the bridge refuses a delegation naming one of them (enforcement, in the layer we own) and main writes a user-scope settings override that keeps them out of the injected roster (hygiene, so the model never proposes one). Both are needed: enforcement cannot live in upstream's settings file alone, because a project-scope `.pi/settings.json` in a cloned repo overrides the user scope outright.

**Tech Stack:** TypeScript, Electron, vitest, the vendored `pi-runtime` tree (`@earendil-works/pi-coding-agent` 0.84.2, `pi-subagents` → 0.58.0, `pi-mcp-adapter` 2.26.1, `typebox` 1.3.7).

**Spec:** the Notion page "🎛️ Subagent product round — P4 analysis & ranking" §0 *Bump round decisions (2026-08-28)* — <https://app.notion.com/p/3cad33dfffca803f9c6dfb0a6dc89c31>. Mirrored into `docs/prd.md` §12 as **Decision (2026-08-28, pi-subagents-0.58 bump round)**. Read both before starting.

## Global Constraints

- **Only `pi-subagents` moves: `0.53.0` → `0.58.0`.** Pi stays `0.84.2`, `@earendil-works/pi-tui` stays `0.84.2`, `pi-mcp-adapter` stays `2.26.1`, `typebox` stays `1.3.7`, root `yaml` stays `2.8.3`. 0.84.3 and adapter 2.30.0 exist and are deliberately NOT taken. If a task makes you want to move a second pin, stop and ask.
- **Both installs are required in a fresh worktree:** `npm install && (cd pi-runtime && npm ci)`. Live tests fail without the second one.
- **Never pipe a test run to `tail`/`grep`.** Redirect to a log file, echo the exit code, then grep the file: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- **Never run `npm run typecheck` before `npm run build` or `npm run gate`** — `build` runs both typechecks first and fast-fails on them.
- **Never run `npm run lint` or `npm run format`** — scaffold leftovers, 19,839 warnings, rewrites 85% of the repo.
- **The full gate is `npm run gate`** (build → both typechecks → non-live suite, one command). The live batch is `npm run test:live`, required here because `pi-runtime/` changes, and **it diffs `main...HEAD` so it only sees COMMITTED work** — run it after the commits, not before.
- **Before believing any live-test failure, check the provider has balance.** 0.50's bump produced four red live tests that matched the expected regression inventory precisely and all four were `402 Insufficient Balance`. One command settles it: `curl -s -o /dev/null -w '%{http_code}\n' https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'`
- **Exact agent names to refuse (six, no others):** `claude-code`, `claude-code-writer`, `codex-exec`, `codex-exec-writer`, `cursor-agent`, `cursor-agent-writer`.
- **Exact settings key is `subagents.agentOverrides`, NOT `subagents.overrides`.** The internal field pi-subagents parses *into* is called `overrides`; the key it reads *from* is `agentOverrides` (`agents.ts:1129`). Writing `overrides` parses to nothing and silently does nothing.
- **`src/main` changes need a dev-server RESTART**, not a renderer reload. Before claiming a main-side fix is live, grep the BUILT artifact: `grep '<your change>' out/main/index.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `pi-runtime/package.json` | the pin, one line |
| `pi-runtime/extensions/hv-rules.ts` | **modify** — add `EXTERNAL_CLI_AGENTS` + `isExternalCliAgent`, beside `WAIT_TOOLS` and `REDACTED_PROMPT`, for the same reason: an upstream name set the bridge and the renderer must agree on and neither can import from the vendored package |
| `pi-runtime/extensions/happyvibe-bridge.ts` | **modify** — refuse a delegation naming one of the six, in the `tool_call` handler right after `subagentName` is resolved and before `resolveBoundary` |
| `src/main/config.ts` | **modify** — new `writeSubagentSettings()` beside `writeSubagentConfig()`, writing `<agentDir>/settings.json` roster hygiene |
| `src/main/ipc.ts` | **modify** — call `writeSubagentSettings()` wherever `writeSubagentConfig()` is already called at startup |
| `pi-runtime/agents/code-explorer.md`, `pi-runtime/agents/agents-md-maker.md` | **modify** — state `inheritGlobalContext: false` |
| `tests/pi-subagents-contract.test.ts` | **modify** — pin upstream's 0.58 roster, the external-runner shape, and that our refusal set matches it exactly |
| `tests/subagent-external-agents.test.ts` | **create** — the bridge refusal + the settings write + the absence of anything wider |
| `docs/validation/d1.md` | **modify** — new `## pi-subagents 0.58 — what the bump moved (2026-08-28)` section with the four probe results |
| `CLAUDE.md` | **modify** — correct "every delegation is a WORKFLOW from 0.50" and add the external-agent entry |

---

### Task 1: Move the pin and get an honest red inventory

No code changes beyond the pin. The point of this task is to find out what actually breaks rather than to guess, and to commit a known-good baseline before touching behaviour.

**Files:**
- Modify: `pi-runtime/package.json:8`

**Interfaces:**
- Consumes: nothing.
- Produces: `pi-runtime/node_modules/pi-subagents` at 0.58.0, and a written-down list of failing tests that Tasks 2–4 must resolve.

- [ ] **Step 1: Record the pre-bump baseline so a later failure is attributable**

```bash
# from the repo root
L=/tmp/vitest-baseline.log
npm test > $L 2>&1; echo "EXIT=$?"
tail -15 $L
```

Expected: EXIT=0. If it is not 0, STOP — you have a pre-existing failure and must not attribute it to the bump.

- [ ] **Step 2: Move the pin**

In `pi-runtime/package.json`, change only this line:

```json
    "pi-subagents": "0.53.0",
```

to:

```json
    "pi-subagents": "0.58.0",
```

Leave `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `pi-mcp-adapter` and `typebox` exactly as they are.

- [ ] **Step 3: Install and confirm what landed**

```bash
cd pi-runtime && npm install && cd ..
node -e 'console.log(require("./pi-runtime/node_modules/pi-subagents/package.json").version)'
node -e 'console.log(require("./pi-runtime/node_modules/typebox/package.json").version)'
```

Expected: `0.58.0` then `1.3.7`. If typebox moved, revert and stop — the contract test asserts it tracks Pi, not pi-subagents' nested 1.1.38.

- [ ] **Step 4: Run the contract test alone — it is the pin-bump gate**

```bash
L=/tmp/vitest-contract.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -40 $L
```

Expected: PASS. Every assertion in it re-derives rather than hard-coding a count, and all four workarounds were verified present in the 0.58 tarball during planning. If something here is red, read the failure before assuming the tarball reading was wrong — then grep the installed source to confirm which is true.

- [ ] **Step 5: Run the whole non-live suite and write down the red list**

```bash
L=/tmp/vitest-058.log
npm test > $L 2>&1; echo "EXIT=$?"
grep -E "FAIL|✗|Tests +[0-9]+ failed" $L | head -40
```

Record every failing file and the assertion text in your notes. Do not fix anything yet — a failure that Task 2, 3 or 4 resolves should be resolved there, not patched here.

- [ ] **Step 6: Commit the pin with the red list in the message**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json
git commit -m "chore(pi-subagents): move the pin 0.53.0 -> 0.58.0

Contract test green: all four workarounds survive (PROMPT_REDACTED, the
1,000-char truncation at subagent-executor.ts:4956, the subagent_wait
name, the bare ctx.hasUI drain gate) and both relative-path imports still
resolve against a 13-subpath exports map that lists neither.

Pi stays 0.84.2 and pi-mcp-adapter stays 2.26.1 deliberately: one pin
moving means one blame surface.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The bridge refuses a delegation to an external-CLI agent

This is the enforcement layer and the reason the round exists. It must be ours, not upstream's settings file, because a project-scope `.pi/settings.json` beats the user scope outright (`agents.ts:1340` returns on `projectOverride` before the user override is ever read), so a cloned repo could otherwise re-enable an external agent with `{"subagents":{"agentOverrides":{"claude-code":{"disabled":false}}}}`.

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts` (append beside `REDACTED_PROMPT`, around line 117)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:893` (the `tool_call` handler, after `subagentName` is resolved, before `resolveBoundary` on line 898)
- Create: `tests/subagent-external-agents.test.ts`

**Interfaces:**
- Consumes: `subagentName` — the `string | null` already computed at `happyvibe-bridge.ts:893` as `tool === "subagent" && typeof input.agent === "string" ? input.agent : null`.
- Produces: from `hv-rules.ts`, `export const EXTERNAL_CLI_AGENTS: ReadonlySet<string>` and `export function isExternalCliAgent(agent: unknown): boolean`. Task 3's test and the contract test both import these; the renderer may import them later for item 13's callout.

- [ ] **Step 1: Write the failing test**

Create `tests/subagent-external-agents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { EXTERNAL_CLI_AGENTS, isExternalCliAgent } from "../pi-runtime/extensions/hv-rules";

const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");

describe("external-CLI sub-agents are refused at the boundary", () => {
  it("names exactly the six upstream external-CLI builtins", () => {
    expect([...EXTERNAL_CLI_AGENTS].sort()).toEqual([
      "claude-code",
      "claude-code-writer",
      "codex-exec",
      "codex-exec-writer",
      "cursor-agent",
      "cursor-agent-writer",
    ]);
  });

  it("matches by exact name and never by prefix", () => {
    expect(isExternalCliAgent("claude-code")).toBe(true);
    expect(isExternalCliAgent("cursor-agent-writer")).toBe(true);
    // A user's OWN agent whose name merely contains one of ours is not refused:
    // the six are upstream builtin names, and shadowing is the user's business.
    expect(isExternalCliAgent("claude-code-review-helper")).toBe(false);
    expect(isExternalCliAgent("my-codex-exec")).toBe(false);
    expect(isExternalCliAgent("code-explorer")).toBe(false);
    expect(isExternalCliAgent(undefined)).toBe(false);
    expect(isExternalCliAgent(42)).toBe(false);
  });

  it("the bridge refuses via isExternalCliAgent, never an inlined literal", () => {
    // Same discipline as WAIT_TOOLS: a literal in the bridge drifts silently
    // when upstream renames or adds an adapter. The name set is the one place.
    const src = readFileSync(BRIDGE, "utf8");
    expect(src).toMatch(/isExternalCliAgent\(subagentName\)/);
    for (const name of EXTERNAL_CLI_AGENTS) {
      expect(src, `bridge must not inline "${name}"`).not.toContain(`"${name}"`);
    }
  });

  it("refuses BEFORE the boundary is resolved, so no ceiling is ever widened", () => {
    // resolveBoundary widens the session ceiling for an approved boundary. An
    // external agent must never reach that call: the ceiling cannot bound it,
    // so widening for it would be a real grant with nothing enforcing it.
    const src = readFileSync(BRIDGE, "utf8");
    const refusal = src.indexOf("isExternalCliAgent(subagentName)");
    const resolve = src.indexOf("await resolveBoundary(subagentName)");
    expect(refusal).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(-1);
    expect(refusal, "refusal precedes resolveBoundary").toBeLessThan(resolve);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest-ext.log
npx vitest run tests/subagent-external-agents.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: FAIL — `EXTERNAL_CLI_AGENTS` is not exported from `hv-rules.ts`.

- [ ] **Step 3: Add the name set to `hv-rules.ts`**

Append after `displayableTask` (currently ending at line 117):

```ts
/**
 * pi-subagents >=0.58's external-CLI builtin agents, which HappyVibe refuses.
 *
 * 0.58 grew upstream's builtin roster from 7 agents to 13, and these six run a
 * third-party CLI in its own process (`runner: {type: "external-cli"}`). The
 * capability ceiling cannot bound one, the child guard cannot run inside one,
 * and its tool calls never reach the audit log — upstream refuses ask/deny
 * rules for external runners by design and withholds extension authority from
 * them. So PRD §12's three-layer guarantee simply does not reach inside them,
 * and a delegation the model can pick on its own must not be the way one runs.
 *
 * Refusing here rather than only through upstream's settings file is
 * deliberate: a PROJECT-scope `.pi/settings.json` override beats the user
 * scope outright (pi-subagents agents.ts returns on the project override
 * before it ever reads the user one), so a cloned repo could re-enable one
 * with `{"subagents":{"agentOverrides":{"claude-code":{"disabled":false}}}}`.
 * Main owns the rules; upstream's roster is hygiene, not enforcement.
 *
 * Exact names only. A user's own agent called `claude-code-review-helper` is
 * theirs, and shadowing a builtin name is their business.
 *
 * Running an external agent is a PRODUCT decision (P4 item 13: an explicitly
 * marked boundary exception in the delegation modal), never a side effect of a
 * pin bump. tests/pi-subagents-contract.test.ts asserts this set still equals
 * exactly the external-runner builtins upstream ships.
 */
export const EXTERNAL_CLI_AGENTS: ReadonlySet<string> = new Set([
  "claude-code",
  "claude-code-writer",
  "codex-exec",
  "codex-exec-writer",
  "cursor-agent",
  "cursor-agent-writer",
]);

/** True for an upstream external-CLI builtin agent — one we will not launch. */
export function isExternalCliAgent(agent: unknown): boolean {
  return typeof agent === "string" && EXTERNAL_CLI_AGENTS.has(agent);
}
```

- [ ] **Step 4: Import it and refuse in the bridge**

In `happyvibe-bridge.ts` line 6, add `isExternalCliAgent` to the existing `hv-rules` import:

```ts
import { EMPTY_RULES, displayableTask, evaluate, isExternalCliAgent, isWaitTool, parseRulesFile, type RuleAction, type RulesFile, type Verdict } from "./hv-rules";
```

Then, immediately after line 893 (`const subagentName = …`) and BEFORE line 894's `permTool` and line 898's `resolveBoundary`, insert:

```ts
    // §12 (2026-08-28): upstream's external-CLI builtins run a third-party CLI
    // in their own process, so the ceiling, the child guard and the child audit
    // all stop at their boundary. Refuse before resolveBoundary, which would
    // otherwise WIDEN the session ceiling for an agent nothing can hold to it.
    if (isExternalCliAgent(subagentName)) {
      return {
        block: true,
        reason:
          `HappyVibe does not run '${subagentName}': it launches a separate ${subagentName} CLI ` +
          "process, so this app's permission boundary, its capability ceiling and its audit log " +
          "cannot see or govern anything it does. Delegate to one of this session's own sub-agents " +
          "instead, or do the work in this session where every tool call goes through the gate.",
      };
    }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
L=/tmp/vitest-ext.log
npx vitest run tests/subagent-external-agents.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Confirm the refusal is audited like any other denial**

The refusal returns `{block: true}` from the `tool_call` handler, the same shape the wait-tool guard uses. Check whether it should also leave an `hv.audit` row. The wait guard deliberately does not (`// No audit — this is a behavioral guard, not a permission decision`), but this one IS a permission decision — the user should be able to see that the model tried. Add the audit emission the same way the surrounding denials do, then assert it:

```bash
grep -n "hv.audit" pi-runtime/extensions/happyvibe-bridge.ts | head -20
```

Add to `tests/subagent-external-agents.test.ts`:

```ts
  it("leaves an audit row, because a refused delegation is a permission decision", () => {
    // Unlike the wait-tool guard (a behavioural nudge), this one denies work the
    // model asked for. §6 says the audit log records permission denials, and a
    // silent refusal would leave the user wondering why nothing happened.
    const src = readFileSync(BRIDGE, "utf8");
    const refusal = src.indexOf("isExternalCliAgent(subagentName)");
    const window = src.slice(refusal, refusal + 1400);
    expect(window, "the refusal block emits an audit row").toContain("hv.audit");
  });
```

- [ ] **Step 7: Run the full non-live suite**

```bash
L=/tmp/vitest-t2.log
npm test > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: EXIT=0, or only failures already on Task 1's red list that Tasks 3–4 own.

- [ ] **Step 8: Commit**

```bash
git add pi-runtime/extensions/hv-rules.ts pi-runtime/extensions/happyvibe-bridge.ts tests/subagent-external-agents.test.ts
git commit -m "feat(subagents): refuse a delegation to an external-CLI agent

0.58 grows upstream's builtin roster 7 -> 13, and the six new ones run a
third-party CLI in their own process: the capability ceiling cannot bound
one, the child guard cannot run inside one, and its tool calls never reach
the audit log. Without this, PRD §12's three-layer guarantee would stop
being true for six agents the model can pick on its own, the -writer
variants writing to the tree under no boundary at all.

The refusal is ours rather than upstream's settings file because a
project-scope .pi/settings.json override beats the user scope outright, so
a cloned repo could otherwise re-enable one.

Refused before resolveBoundary, which would widen the session ceiling for
an agent nothing can hold to it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Keep the six out of the injected roster

Hygiene, not enforcement. Task 2 stops a delegation; this stops the model from proposing one and wasting a turn, and stops the six appearing wherever we later surface the upstream roster.

**Files:**
- Modify: `src/main/config.ts` (new export beside `writeSubagentConfig`, which starts at line 634)
- Modify: `src/main/ipc.ts:13` (import) and the startup call site of `writeSubagentConfig()`
- Modify: `tests/subagent-external-agents.test.ts`

**Interfaces:**
- Consumes: `agentDir()` from `src/main/config.ts:484`, and `EXTERNAL_CLI_AGENTS` from Task 2.
- Produces: `export function writeSubagentSettings(): void` — writes `<agentDir>/settings.json`, merging rather than replacing.

- [ ] **Step 1: Write the failing test**

Append to `tests/subagent-external-agents.test.ts`:

```ts
describe("the upstream roster is trimmed at source too", () => {
  it("writes agentOverrides, the key pi-subagents actually reads", () => {
    // NOT `overrides`. pi-subagents parses settings.subagents.agentOverrides INTO
    // an internal field called `overrides`; writing `overrides` parses to nothing
    // and silently does nothing at all.
    const src = readFileSync(path.join(__dirname, "..", "src", "main", "config.ts"), "utf8");
    expect(src).toContain("agentOverrides");
    expect(src).toMatch(/writeSubagentSettings/);
  });

  it("disables exactly the six, and never reaches for disableBuiltins", () => {
    // disableBuiltins is all-or-nothing and would also remove worker and
    // reviewer — the two the fleet round wants to adopt. Absence-tested so a
    // later "simplification" cannot quietly take out the seven native ones.
    const src = readFileSync(path.join(__dirname, "..", "src", "main", "config.ts"), "utf8");
    expect(src, "no blunt instrument").not.toContain("disableBuiltins");
  });
});
```

Then add a behavioural test that runs the real writer against a temp `PI_CODING_AGENT_DIR`. Follow the existing pattern in `tests/subagent-config.test.ts` for how that suite stubs `agentDir()` — read it first and mirror it exactly rather than inventing a second mechanism:

```bash
sed -n '1,60p' tests/subagent-config.test.ts
```

The behavioural assertions to write, in that file's own idiom:
1. calling `writeSubagentSettings()` on an absent `settings.json` creates `{subagents:{agentOverrides:{<six>:{disabled:true}}}}`;
2. calling it on a `settings.json` that already has an unrelated top-level key **preserves that key** (merge, not replace) — this is the one that matters, because Pi reads this file for its own settings;
3. calling it twice is idempotent;
4. a user's own `agentOverrides` entry for a DIFFERENT agent survives.

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest-ext.log
npx vitest run tests/subagent-external-agents.test.ts tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"
tail -25 $L
```

Expected: FAIL — `writeSubagentSettings` does not exist.

- [ ] **Step 3: Implement the writer**

Add to `src/main/config.ts`, immediately after `writeSubagentConfig()`:

```ts
/**
 * Keep upstream's external-CLI builtin agents out of the injected roster.
 *
 * PRD §12 (2026-08-28): pi-subagents 0.58 ships 13 builtin agents, six of them
 * `runner: external-cli`. hv-rules.ts's EXTERNAL_CLI_AGENTS refusal is the
 * ENFORCEMENT — it has to be, because a project-scope `.pi/settings.json`
 * beats this user-scope file outright. This is hygiene: with them disabled
 * here, the model is never told they exist, so it cannot spend a turn
 * proposing one and being refused.
 *
 * The key is `agentOverrides`. pi-subagents parses it into a field it calls
 * `overrides`, so `overrides` here would parse to nothing and do nothing.
 *
 * MERGES rather than replaces: Pi reads `<agentDir>/settings.json` for its own
 * settings, and this file is the first thing in the app to write it.
 * Deliberately NOT `disableBuiltins: true` — that is all-or-nothing and would
 * also remove `worker` and `reviewer`.
 */
export function writeSubagentSettings(): void {
  const file = path.join(agentDir(), "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* absent or corrupt — start fresh */
  }
  const subagents = { ...((settings.subagents as Record<string, unknown> | undefined) ?? {}) };
  const overrides = { ...((subagents.agentOverrides as Record<string, unknown> | undefined) ?? {}) };
  for (const name of EXTERNAL_CLI_AGENTS) {
    overrides[name] = { ...((overrides[name] as Record<string, unknown> | undefined) ?? {}), disabled: true };
  }
  subagents.agentOverrides = overrides;
  settings.subagents = subagents;
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
```

Add the import at the top of `src/main/config.ts` (match the file's existing relative-path idiom for reaching `pi-runtime/extensions`; check how `hv-rules` is already imported elsewhere in `src/main/` first):

```bash
grep -rn 'from ".*hv-rules"' src/main/ | head -5
```

- [ ] **Step 4: Call it at startup**

Find where `writeSubagentConfig()` is called and add `writeSubagentSettings()` beside it:

```bash
grep -n "writeSubagentConfig()" src/main/*.ts
```

Add `writeSubagentSettings` to the `./config` import list at `src/main/ipc.ts:13`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
L=/tmp/vitest-t3.log
npx vitest run tests/subagent-external-agents.test.ts tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"
tail -25 $L
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/config.ts src/main/ipc.ts tests/subagent-external-agents.test.ts tests/subagent-config.test.ts
git commit -m "feat(subagents): keep upstream's external-CLI agents out of the roster

Hygiene beside Task 2's enforcement: with the six disabled in
<agentDir>/settings.json the model is never told they exist, so it cannot
spend a turn proposing one and being refused.

The key is agentOverrides, not overrides — pi-subagents parses the former
INTO a field it calls the latter, so the obvious spelling silently does
nothing. Merges rather than replaces, because Pi reads this file for its
own settings and this is the first thing in the app to write it. Not
disableBuiltins, which would also remove worker and reviewer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: State `inheritGlobalContext: false` on both bundled agents

0.58 flips the default so a child no longer inherits the operator's global context file. Upstream and §12 already agree, so this changes nothing today — it makes a future flip back loud instead of silent, exactly as `defaultSubagentContext: "fresh"` does.

**Files:**
- Modify: `pi-runtime/agents/code-explorer.md` (frontmatter)
- Modify: `pi-runtime/agents/agents-md-maker.md` (frontmatter)
- Modify: `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/pi-subagents-contract.test.ts`, in the existing `describe("bundled agent definitions declare only child tools that exist")` block or a new sibling describe:

```ts
describe("the isolation contract is stated, not inherited", () => {
  const agentsDir = path.join(__dirname, "..", "pi-runtime", "agents");

  it("every bundled agent states inheritGlobalContext explicitly", () => {
    // PRD §12 (2026-08-28): 0.58 flipped the default to false, which is what
    // §12 has always assumed. Stating it costs one line; inheriting it means a
    // future flip back hands every child the operator's global context with no
    // user-visible symptom and no failing test to announce it.
    const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(agents.length, "bundled agents present").toBeGreaterThan(0);
    for (const file of agents) {
      const src = readFileSync(path.join(agentsDir, file), "utf8");
      expect(src, `${file} states inheritGlobalContext`).toMatch(/^inheritGlobalContext:\s*false$/m);
    }
  });

  it("upstream still defaults it to false, so our value changes nothing today", () => {
    // If this fails, upstream flipped back and our explicit false is now doing
    // real work — which is the whole point of writing it down.
    const src = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "agents", "agents.ts"),
      "utf8",
    );
    expect(src).toMatch(/inheritGlobalContext/);
  });
});
```

Before writing the second assertion, confirm the real default in the installed source and tighten the regex to pin the actual default rather than merely the key's presence:

```bash
grep -rn "inheritGlobalContext" pi-runtime/node_modules/pi-subagents/src/ | head -10
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest-contract.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -25 $L
```

Expected: FAIL — neither bundled agent states the key.

- [ ] **Step 3: Add the line to both agents**

`pi-runtime/agents/code-explorer.md` frontmatter becomes:

```
---
name: code-explorer
description: Read-only codebase investigator. Delegate to it to map architecture, trace how a feature works across files, or answer "where/how is X done" — it reads, greps and searches but never edits.
tools: read, grep, find, ls
inheritGlobalContext: false
---
```

`pi-runtime/agents/agents-md-maker.md` frontmatter gains the same `inheritGlobalContext: false` line after `tools:`.

Note: `hv-agents.ts`'s `parseAgentFile` is a flat `key: value` parser, so a plain boolean-looking string is read as the string `"false"` on our side and as a real boolean by Pi's own YAML reader. Confirm the round-trip does not corrupt the file:

```bash
L=/tmp/vitest-agents.log
npx vitest run tests/hv-agents.test.ts tests/builtin-agents-uninstall.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS. `installBuiltinAgents` decides "did the user edit this?" by CONTENT HASH, so changing the bundle re-approves both agents while keeping the user's on/off — that is the designed behaviour, not a regression.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
L=/tmp/vitest-contract.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/agents/code-explorer.md pi-runtime/agents/agents-md-maker.md tests/pi-subagents-contract.test.ts
git commit -m "feat(subagents): state inheritGlobalContext on both bundled agents

0.58 flips the default so a child no longer inherits the operator's global
context file, which is what §12 has always assumed — so this changes
nothing today. Same reasoning as defaultSubagentContext: \"fresh\": a
future flip back would hand every sub-agent the operator's global context
with no user-visible symptom and no failing test to announce it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pin upstream's 0.58 roster, so our refusal set cannot drift

Our six names are a hand-written copy of an upstream fact. If 0.59 adds a seventh external adapter, nothing so far notices.

**Files:**
- Modify: `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: `EXTERNAL_CLI_AGENTS` from `hv-rules.ts` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/pi-subagents-contract.test.ts`:

```ts
describe("our external-agent refusal set still equals upstream's, exactly", () => {
  const pkgSrc = (...p: string[]) =>
    path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...p);

  /** Every builtin agent upstream ships, derived from its own bundled files. */
  const builtinAgentFiles = (): Array<{ name: string; src: string }> =>
    readdirSync(pkgSrc("agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ name: f.replace(/\.md$/, ""), src: readFileSync(pkgSrc("agents", f), "utf8") }));

  it("upstream still ships a builtin roster we have accounted for", () => {
    // 7 at 0.53, 13 at 0.58. A CHANGE here is the signal to re-audit, because a
    // new builtin arrives delegatable with no decision from us.
    const names = builtinAgentFiles().map((a) => a.name).sort();
    expect(names).toEqual([
      "claude-code",
      "claude-code-writer",
      "codex-exec",
      "codex-exec-writer",
      "cursor-agent",
      "cursor-agent-writer",
      "delegate",
      "oracle",
      "researcher",
      "reviewer",
      "scout",
      "worker",
    ]);
  });

  it("we refuse exactly the external-runner ones, no more and no fewer", () => {
    // Derived from upstream's own frontmatter rather than hand-listed: a new
    // external adapter in a future pin fails HERE, loudly, instead of arriving
    // as an ungoverned agent the model can delegate to.
    const external = builtinAgentFiles()
      .filter((a) => /^\s*type:\s*external-(cli|job)\s*$/m.test(a.src))
      .map((a) => a.name)
      .sort();
    expect(external.length, "upstream ships external runners").toBeGreaterThan(0);
    expect([...EXTERNAL_CLI_AGENTS].sort()).toEqual(external);
  });

  it("the seven we keep are native Pi children the ceiling governs", () => {
    const native = builtinAgentFiles()
      .filter((a) => !/^\s*type:\s*external-(cli|job)\s*$/m.test(a.src))
      .map((a) => a.name);
    for (const name of native) expect(EXTERNAL_CLI_AGENTS.has(name), `${name} is kept`).toBe(false);
    expect(native).toContain("worker");
    expect(native).toContain("reviewer");
  });
});
```

Note the `advisor` alias: `BUILTIN_AGENT_NAMES` lists 13 including `advisor`, but the bundled `agents/` dir ships 12 files — 0.57 resolves `advisor` through `oracle`. Derive from the files, as above, and if the roster assertion surprises you, reconcile against `pi-runtime/node_modules/pi-subagents/src/agents/builtin-names.ts` before changing the expectation.

- [ ] **Step 2: Run it to verify it fails, then passes**

```bash
L=/tmp/vitest-contract.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

If the first assertion fails on `advisor`, fix the EXPECTATION to match the derived truth — never the derivation.

- [ ] **Step 3: Commit**

```bash
git add tests/pi-subagents-contract.test.ts
git commit -m "test(subagents): pin upstream's builtin roster and the external set

Our six refused names are a hand-written copy of an upstream fact. Derived
from upstream's own agent frontmatter here, so a seventh external adapter
in a future pin fails loudly instead of arriving as an ungoverned agent
the model can delegate to.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Run the four probes and write them down

Probe 4 was answered from the 0.58 source during planning and must be re-confirmed on the wire — a bump audit read from source alone is what missed 0.50's worst regression.

**Files:**
- Modify: `docs/validation/d1.md` (new top-level section, following the `## pi-subagents 0.51 …` heading style at line 1415)
- Modify: `scripts/probe-050.ts` if a probe needs a new mode (read it first — it already has a `respawn` mode)

**Interfaces:**
- Consumes: the pin from Task 1, the refusal from Task 2.
- Produces: `docs/validation/d1.md` §`pi-subagents 0.58` — the section the PRD decision cites as its evidence.

- [ ] **Step 1: Check the provider has balance before running anything live**

```bash
set -a; . ./.env 2>/dev/null; set +a
curl -s -o /dev/null -w '%{http_code}\n' https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

Expected: `200`. A `402` means every probe result below is meaningless — top up first.

- [ ] **Step 2: Probe 1 — which builtins are discoverable, and does one launch**

Read `scripts/probe-050.ts` for the existing harness, then run a session and ask the agent for `subagent {action:"list"}`, capturing the full reply. Record:
- the exact agent names the roster reports (ours + project + however many upstream builtins);
- whether the six external ones are absent AFTER Task 3's settings write (they must be);
- what happens when a delegation names `claude-code` anyway (Task 2's refusal text must come back).

This is the probe that proves both halves of the fix work in a real session rather than in a unit test.

- [ ] **Step 3: Probe 2 — does the child transcript carry thinking blocks**

Delegate to `code-explorer` on a session model that emits thinking, then read the child's transcript through both routes and grep each for a thinking block:
- the `/subagents-inspect-rpc` reply (`src/main/subagentInspect.ts`, `inspectCommand(requestId, asyncId)`);
- the run's own `events.jsonl` under the run's `asyncDir`.

Record a plain yes/no per route. This gates P4 item 6 entirely: yes ⇒ a card-render toggle; no ⇒ an upstream ask, not our build.

- [ ] **Step 4: Probe 3 — `systemPromptMode` for our bundled agents**

Confirm what our two agents resolve to (upstream's bundled agents state `systemPromptMode: replace` explicitly in their frontmatter; ours state nothing, so they take the default). Record the resolved value and where the default comes from in the installed source. This closes P4 item 5 — "the child never thinks it is Pi" — or turns it into a real task.

- [ ] **Step 5: Probe 4 — re-confirm the unwrap on the wire**

Instrument the bridge's own `tool_execution_end` handler with a `console.error` of `details`, run one async delegation, and record verbatim:
- `details.mode` (expect `"single"`, not `"workflow"`);
- that `details.asyncId` is present and equals `details.runId`;
- that `subagent:async-started` still never fires (a `console.error` inside the bridge's own handler for it — measured absent twice at 0.50/0.51);
- that the delivery repair still fires: `substitution fired=true`, the store keyed by the child `runId`, and `results[].output` longer than 1,000 chars.

- [ ] **Step 6: Write the section**

Add `## pi-subagents 0.58 — what the bump moved (2026-08-28)` to `docs/validation/d1.md`, following the 0.51 section's shape: what was expected to break, what actually broke, the four probe results with verbatim payloads, and an explicit "unchanged, and pinned because their absence would be silent" list. State the measured envelope cost of a blocking delegation (it was ~4.9 KB at 0.50 and ~14.8 KB at 0.51) — `tests/subagent-context.test.ts` watches the envelope separately from the child's answer, so if that test is red, the number belongs here before the bound is changed.

- [ ] **Step 7: Commit**

```bash
git add docs/validation/d1.md scripts/probe-050.ts
git commit -m "docs(validation): record the 0.58 probes and the measured wire

Probes 1-4 from the P4 doc, run against the real pin. Probe 4 re-confirms
on the wire what planning read from source: details.mode is \"single\" with
asyncId === runId, async-started still never fires, and the delivery
repair still substitutes the child's full output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Correct CLAUDE.md

Two claims in CLAUDE.md are now false, and one of them is load-bearing for whoever debugs the run card next.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 6's measurements.
- Produces: nothing.

- [ ] **Step 1: Correct the workflow claim**

The entry beginning **"Every delegation is a WORKFLOW from 0.50, and that silently removed the run card"** is false from 0.55. Rewrite it in place to say: a single-child delegation returns `mode: "single"` with `asyncId === runId` (`async-execution.ts:1967`) and only a real multi-child `workflowScript` is `mode: "workflow"` with a `missionId`; the card survived because it was already re-keyed off `details.asyncId`; and `subagent:async-started` is STILL declared and never emitted, so the re-key remains load-bearing rather than becoming redundant. Keep the rest of the entry — the reasoning about why the re-key exists is still exactly right.

- [ ] **Step 2: Add the external-agent entry**

Add a new bullet in the pi-subagents block: 0.58 ships 13 builtins, six `external-cli`; `EXTERNAL_CLI_AGENTS`/`isExternalCliAgent` in `hv-rules.ts` is the enforcement and the bridge refuses BEFORE `resolveBoundary` (which would widen the ceiling); `writeSubagentSettings()` writes `subagents.agentOverrides` — **not** `overrides` — as roster hygiene only; and the reason enforcement cannot live in that file: a project `.pi/settings.json` beats the user scope outright.

- [ ] **Step 3: Update the pin references**

```bash
grep -n "0\.53\|0\.51\|0\.50" CLAUDE.md | head -20
```

Update version references that name the current pin. Leave the historical ones ("0.40 broke both silently", "bumped 0.34.0 → 0.40.0 on …") alone — they are the record, not a claim about today.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct the workflow claim and record the external-agent refusal

\"Every delegation is a WORKFLOW from 0.50\" is false from 0.55: a
single-child delegation is mode:\"single\" with asyncId === runId. The card
survived because it was already keyed off asyncId, and async-started is
still never emitted, so that re-key stays load-bearing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Both gates, then the GUI pass

**Files:** none — verification only.

- [ ] **Step 1: The full gate**

```bash
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: EXIT=0. `gate` = build (both typechecks first, fast-fail) → non-live suite. Do not run `npm run typecheck` separately.

- [ ] **Step 2: Confirm the live batch is required, then run it in the background**

```bash
npm run live:why
```

It diffs `main...HEAD` and prints the Pi-facing changed files. `pi-runtime/` moved, so this will print something. If it prints nothing, say so rather than silently skipping.

```bash
L=/tmp/live.log
npm run test:live > $L 2>&1; echo "EXIT=$?"
```

Run this with Bash `run_in_background: true` — it takes ~6 minutes and the harness re-invokes on exit. **While it runs, touch nothing under `pi-runtime/` or `src/`**: vitest collects files as it goes and the live files spawn real Pi children, so a mid-run edit yields a result for a tree that never existed. Docs and Notion work is fine.

Expected: 17 files green. One failure ⇒ re-run that file in isolation before calling it a regression, and check the provider balance first.

- [ ] **Step 3: Restart the dev server and verify the BUILT artifact**

`src/main` changed in Task 3, so a renderer reload is not enough.

```bash
grep -c "writeSubagentSettings" out/main/index.js
grep -c "EXTERNAL_CLI_AGENTS\|isExternalCliAgent" out/main/index.js
```

Expected: non-zero for the first. Verifying the source is not verifying the app.

- [ ] **Step 4: The GUI pass — observable assertions**

Each claim below is a thing that must be TRUE on screen, on the named surface. An absence cannot be screenshotted, so the absence assertions are named explicitly.

**On the Agents page (the surface that OWNS the roster, and not the surface Task 3 changed):**
- The list shows exactly our two bundled agents (`code-explorer`, `agents-md-maker`) plus any project agents in the open workspace — the same count as before the bump.
- **Absence, by name:** `claude-code`, `claude-code-writer`, `codex-exec`, `codex-exec-writer`, `cursor-agent` and `cursor-agent-writer` appear nowhere on this page.
- Both bundled agents still show as installed-and-unedited, not as user-edited. Task 4 changed the bundle, and `installBuiltinAgents` hashes content — a re-approval that keeps the user's on/off is correct; a `.md.bak` file appearing beside them is NOT, and means the legacy-stamp repair path ran when it should not have.

**In Chat (where a delegation is observed):**
- Ask the agent to explore something. The run card appears, captioned with the **real task text** — not `[prompt redacted]` — and names `code-explorer`, not `workflow`. This is the whole 0.55-unwrap risk, visible in one glance.
- The status line reads `working · <elapsed> · <n>k tok · ~$<cost>` with the numbers climbing, and the STOP control sits on that same line.
- The card **slides away** on completion and the answer arrives in ONE turn.
- **Absence, by name:** the rendered transcript contains no `subagent_wait`, no status poll, no `_output.md`, and none of `truncat` / `let me fetch` / `incomplete` / `prompt redacted` / `workflow`.
- Now ask it explicitly to delegate to `claude-code`. The refusal text from Task 2 appears in the flow, naming `claude-code` and saying HappyVibe's boundary cannot govern it. **Absence:** no permission modal appears — this is a refusal, not an ask.

**On the Audit page (the surface that owns the permission record, and not where the refusal happened):**
- The refused delegation appears as a row under rule name `subagent:claude-code` with a denial decision, interleaved by timestamp with the session's other rows.

**The one regression this design risks, as a sequence to perform:**
Task 2 refuses before `resolveBoundary`, which is also the call that widens the session ceiling. If the early return is placed wrongly it could skip state the *next* delegation depends on. So: (1) delegate to `code-explorer` and let it finish; (2) ask for `claude-code` and get refused; (3) delegate to `code-explorer` again in the same session. The third delegation must raise its boundary modal and run exactly like the first — same tool list, same card, same cost readout. If the third one launches with no modal, or with a wider tool list than the first, the refusal leaked ceiling state and the placement is wrong.

Second sequence, for the re-keyed card under `mode:"single"`: dispatch two delegations, STOP one, and confirm the other keeps its own live cost and finishes normally while the stopped card leaves the flow. Two cards keyed off `asyncId` must not collide.

- [ ] **Step 5: Report honestly**

State which gates ran, their exit codes, and which GUI assertions you personally observed versus which you could not reach. A GUI pass that was not performed is not a passing GUI pass — say so.

---

## Self-Review

**Spec coverage.** Scope (subagents only) → Task 1. External-CLI refusal → Tasks 2, 3, 5. `inheritGlobalContext` → Task 4. Probes 1–4 → Task 6. The "every delegation is a workflow" correction → Task 7. The known gap (native builtins invisible in AgentsView) is explicitly NOT a task — it is recorded in the PRD as belonging to the fleet round, and Task 6's probe 1 captures the inventory that round needs. No spec requirement is unassigned.

**Placeholders.** None. Two steps deliberately require reading an existing file before writing code (Task 3's temp-dir idiom from `tests/subagent-config.test.ts`, Task 6's harness from `scripts/probe-050.ts`) rather than inventing a second mechanism — that is a reuse instruction with a named source, not a TBD.

**Type consistency.** `EXTERNAL_CLI_AGENTS: ReadonlySet<string>` and `isExternalCliAgent(agent: unknown): boolean` are defined in Task 2 and consumed under those exact names in Tasks 3 and 5. `writeSubagentSettings(): void` is defined in Task 3 and referenced under that name in Tasks 3, 7 and 8. `subagentName` is the existing bridge local at `happyvibe-bridge.ts:893`.

**One risk the plan carries knowingly.** Task 2's placement — before `resolveBoundary` — is asserted by a source-order test and by a GUI sequence, not by a unit test of the handler, because the bridge's `tool_call` handler is not independently invocable in the non-live suite. If that placement is wrong the failure is a leaked ceiling, which is exactly why the three-delegation sequence in Task 8 Step 4 exists and must actually be performed.
