# Agent-Driven Terminals (§26 Part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent three gated tools — `terminal_run` · `terminal_read` · `terminal_kill` — over the PTYs part 1 already owns in main, surfaced as transcript cards, so a long-running command stops escaping the product's visibility and permission story.

**Architecture:** Part 1 built the hard half. `TerminalManager` (`src/main/terminals.ts`) already owns the PTY, the `@xterm/headless` mirror, `readText()`, `foreground()`, `list()` and `kill()`. This plan adds (a) a pure policy module the bridge and main share, (b) three registered tools in the bridge that reach main over the existing blocking `ctx.ui.input` envelope, (c) a main-side ownership map that enforces the caps and holds agent writes during user typing, and (d) a transcript card cloned from `DelegationRunCard`. No new dependency, no new persistence store, no change to `TerminalManager`'s public surface except one method.

**Tech Stack:** TypeScript · Pi extension API (`pi.registerTool`, `tool_call`, `ctx.ui.input`) · TypeBox (`typebox`, pinned — see Global Constraints) · Electron IPC · React 19 · `@xterm/xterm` (renderer) / `@xterm/headless` (main) · vitest.

## Global Constraints

- **Every decision here is already locked in `docs/prd.md` §26 Part 2.** Read that section before starting. Do not re-litigate; if the code contradicts it, the code is wrong.
- **`hv-*.ts` modules under `pi-runtime/extensions/` are PURE** — zero imports, so main and vitest can import them and the logic never forks. `hv-terminal.ts` follows `hv-rules.ts`.
- **Never add `toolChoice`** anywhere (silently discarded — `docs/validation/tc1.md`).
- **`typebox` is pinned in `pi-runtime` to what `pi-coding-agent` declares.** Use `Type.*` from the bare `typebox` specifier, exactly as the plan tools do at `happyvibe-bridge.ts:968`.
- **`src/main` changes need a dev-server RESTART.** A renderer reload does not rebuild main. Before claiming a main-side fix is live, `grep` the built artifact (`out/main/index.js`), not the source.
- **Never pipe a test run to `tail`/`grep`.** Redirect once, then grep the file:
  ```
  L=/tmp/vitest.log
  npx vitest run <target> > $L 2>&1; echo "EXIT=$?"
  tail -30 $L
  ```
- **Full gate is `npm run gate`** (= `build` → both typechecks → non-live suite, ONE command). Never run `npm run typecheck` before it. `npm run lint` / `npm run format` are scaffold leftovers — do not run them.
- **`npm run test:live` is required for this plan** — it touches `pi-runtime/extensions/` and adds a live test file, so `npm run live:why` will print. Canonical invocation only; never a bare `npx vitest` over `$(…)`.
- Tool name spellings, fixed for the whole plan: `terminal_run`, `terminal_read`, `terminal_kill`. Envelope kinds: `hv.terminal-run`, `hv.terminal-read`, `hv.terminal-kill` (blocking inputs) and `hv.terminal` (fire-and-forget notify).

---

## File Structure

**Create:**
| File | Responsibility |
|---|---|
| `pi-runtime/extensions/hv-terminal.ts` | Pure policy: newline rejection, the trailing-`&` detector, the tool-name set, the system-prompt steer line. Imported by the bridge, by main, and by tests. |
| `src/main/agentTerminals.ts` | Who owns which terminal, the soft cap of 3, the busy-reuse refusal, the interleave hold, and the open-terminals context block. Owns no PTY — it calls `TerminalManager`. |
| `src/renderer/src/components/TerminalRunCard.tsx` | The transcript card + the two-card stack cap. |
| `tests/terminal-tools.test.ts` | Pure-module unit tests (key-free). |
| `tests/agent-terminals.test.ts` | Main-side ownership/cap/hold tests (key-free, spawns a real PTY like `tests/terminals.test.ts`). |
| `tests/terminal-bridge.test.ts` | **LIVE** contract test: open → read → kill against real DeepSeek. |

**Modify:**
| File | Change |
|---|---|
| `pi-runtime/extensions/hv-builtins.ts` | `terminal: boolean` on `BuiltinToggles`. |
| `pi-runtime/extensions/hv-rules.ts:54` | `SAFE_TOOLS` += `terminal_read`. |
| `pi-runtime/extensions/hv-plan.ts:167,173` | `BLOCKED_PLAN_TOOLS` += `terminal_run`; `PLAN_PASS_TOOLS` += `terminal_read`, `terminal_kill`. |
| `pi-runtime/extensions/happyvibe-bridge.ts` | Three `registerTool`s in an `if (builtins.terminal)` block; `INTENT_TOOLS`; `summarize()`; the `&` block in the `tool_call` handler; the steer line in `before_agent_start`. |
| `src/main/config.ts:40,268,278` | `builtinTools.terminal`. |
| `src/main/ipc.ts` | Envelope routing, the open-terminals block on the prompt seam, audit, `HV_BUILTINS`. |
| `src/renderer/src/toolLabel.ts` | `terminal_run` / `terminal_kill` cases. |
| `src/renderer/src/components/PermissionModal.tsx:12` | `argsFromSummary` `terminal_run` case. |
| `src/renderer/src/components/ChatView.tsx:1143` | Mount `TerminalStack` beside `DelegationSection`. |
| `src/renderer/src/components/BuiltinToolsBlock.tsx` | The grouped "Terminal" entry. |

---

### Task 1: The pure policy module

Everything the gate decides about a terminal command, in a module with no imports, so the bridge and main cannot disagree.

**Files:**
- Create: `pi-runtime/extensions/hv-terminal.ts`
- Test: `tests/terminal-tools.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TERMINAL_TOOLS: Set<string>`, `checkCommand(cmd: unknown): { ok: true; command: string } | { ok: false; reason: string }`, `hasBackgroundAmpersand(cmd: string): boolean`, `TERMINAL_STEER_LINE: string`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/terminal-tools.test.ts
import { describe, expect, it } from "vitest";
import {
  TERMINAL_TOOLS,
  checkCommand,
  hasBackgroundAmpersand,
  TERMINAL_STEER_LINE,
} from "../pi-runtime/extensions/hv-terminal";

describe("checkCommand", () => {
  it("accepts a single command line and trims it", () => {
    expect(checkCommand("  npm run dev  ")).toEqual({ ok: true, command: "npm run dev" });
  });

  // §26: describeCommand reads only the FIRST segment, so a two-line string
  // would be SHOWN to the user as its harmless first line. That is the whole
  // reason newlines are rejected rather than merely discouraged.
  it.each(["npm run dev\nrm -rf /", "a\r\nb", "a\rb"])("rejects embedded newlines: %j", (cmd) => {
    const r = checkCommand(cmd);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/one command line/i);
  });

  it("rejects a non-string and an empty command", () => {
    expect(checkCommand(undefined).ok).toBe(false);
    expect(checkCommand("   ").ok).toBe(false);
  });
});

describe("hasBackgroundAmpersand", () => {
  it.each([
    "npm run dev &",
    "npm run dev &> /tmp/log &",
    "npm run dev & echo started",
    "( npm run dev ) &",
  ])("detects a real background operator: %j", (cmd) => {
    expect(hasBackgroundAmpersand(cmd)).toBe(true);
  });

  // The false positives that matter: && is a sequencer, not a backgrounder,
  // and an & inside a quoted string or a redirect is not an operator at all.
  it.each([
    "npm ci && npm run build",
    "a && b && c",
    "grep 'foo & bar' file",
    'echo "a & b"',
    "npm test 2>&1",
    "npm run dev &> /tmp/log",
  ])("does not fire on: %j", (cmd) => {
    expect(hasBackgroundAmpersand(cmd)).toBe(false);
  });
});

describe("module surface", () => {
  it("names exactly the three tools", () => {
    expect([...TERMINAL_TOOLS].sort()).toEqual(["terminal_kill", "terminal_read", "terminal_run"]);
  });

  it("steers toward terminal_run by name", () => {
    expect(TERMINAL_STEER_LINE).toContain("terminal_run");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/terminal-tools.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```
Expected: FAIL — `Failed to resolve import "../pi-runtime/extensions/hv-terminal"`.

- [ ] **Step 3: Write the module**

```typescript
// pi-runtime/extensions/hv-terminal.ts
/**
 * §26 part 2 — terminal-tool policy. PURE module, zero imports.
 *
 * Same discipline as hv-rules.ts: it is imported by the bridge (inside Pi), by
 * src/main, and by vitest, so the rule the model is gated on and the rule main
 * enforces are one function rather than two that drift.
 */

export const TERMINAL_TOOLS = new Set(["terminal_run", "terminal_read", "terminal_kill"]);

export type CommandCheck = { ok: true; command: string } | { ok: false; reason: string };

/**
 * One command line per call. Newlines are rejected, and NOT for tidiness:
 * `describeCommand` (the permission modal's label) reads only the first
 * segment, so a two-line string would be approved on the strength of its
 * harmless first line. A prompt that under-describes what it approves is worse
 * than no prompt.
 */
export function checkCommand(cmd: unknown): CommandCheck {
  if (typeof cmd !== "string") return { ok: false, reason: "terminal_run requires a `command` string." };
  if (/[\r\n]/.test(cmd)) {
    return {
      ok: false,
      reason:
        "terminal_run takes one command line per call — embedded newlines are rejected. " +
        "Send each line as its own call; each is gated separately.",
    };
  }
  const command = cmd.trim();
  if (!command) return { ok: false, reason: "terminal_run requires a non-empty `command`." };
  return { ok: true, command };
}

/**
 * Does this shell command line end a segment with a REAL background operator?
 *
 * Deliberately narrow. `&&` is a sequencer and `2>&1` / `&>` are redirects —
 * firing on those would block the honest `npm ci && npm run build`, which is
 * the common case. So: scan character by character, skip quoted spans, skip a
 * `&` that is part of `&&`, `>&` or `&>`, and report the rest.
 */
export function hasBackgroundAmpersand(cmd: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "\\") { i++; continue; }
    if (c !== "&") continue;
    if (cmd[i + 1] === "&") { i++; continue; }   // &&  — a sequencer
    if (cmd[i - 1] === "&") continue;            // second half of an && already consumed
    if (cmd[i - 1] === ">") continue;            // 2>&1
    if (cmd[i + 1] === ">") { i++; continue; }   // &> /tmp/log
    return true;
  }
  return false;
}

/** Appended to the system prompt while the Terminal group is enabled. */
export const TERMINAL_STEER_LINE =
  "Long-running commands (dev servers, watchers, `docker compose up`, anything you would " +
  "background) go to `terminal_run`, never to `bash` with a trailing `&`. A backgrounded bash " +
  "process is invisible to the user and cannot be stopped by them; a terminal is a card they " +
  "can watch, type into and kill. Poll it with `terminal_read`, and clean up with `terminal_kill`.";
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/terminal-tools.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vitest.log
```
Expected: PASS, 4 describes green.

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-terminal.ts tests/terminal-tools.test.ts
git commit -m "feat(terminal): the pure policy the bridge and main both gate on"
```

---

### Task 2: Gate-table entries

Three one-line set memberships, each of which is a §26 invariant that no other code enforces. They go in their own task because a reviewer can reject the plan-mode placement while accepting everything else.

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts:54`, `pi-runtime/extensions/hv-plan.ts:167,173`
- Test: `tests/terminal-tools.test.ts` (append)

**Interfaces:**
- Consumes: `SAFE_TOOLS`, `BLOCKED_PLAN_TOOLS`, `PLAN_PASS_TOOLS`, `gatePlanCall` (existing).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/terminal-tools.test.ts
import { SAFE_TOOLS, evaluate, EMPTY_RULES } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";

describe("gate placement (§26)", () => {
  it("terminal_read is safe-default allowed — polling a log must not prompt", () => {
    expect(SAFE_TOOLS.has("terminal_read")).toBe(true);
    const v = evaluate(EMPTY_RULES, { tool: "terminal_read", input: { terminalId: "t1" }, workspace: "/ws" });
    expect(v).toEqual({ action: "allow", source: "safe-default" });
  });

  it("terminal_run and terminal_kill still ask by default", () => {
    for (const tool of ["terminal_run", "terminal_kill"]) {
      expect(evaluate(EMPTY_RULES, { tool, input: { command: "npm run dev" }, workspace: "/ws" }).action).toBe("ask");
    }
  });

  // The whole point of naming the parameter `command`: a rule written for bash
  // gates the terminal too, with no new matching code.
  it("an existing command-layer rule gates terminal_run unchanged", () => {
    const rules = { global: [{ layer: "command" as const, pattern: "rm *", action: "deny" as const }], workspaces: {} };
    expect(evaluate(rules, { tool: "terminal_run", input: { command: "rm -rf /" }, workspace: "/ws" }).action).toBe("deny");
  });

  // most-restrictive-wins: a tool-layer ask beats a command-layer allow, which
  // is how a user distinguishes `npm run dev` for a turn from forever.
  it("a tool-layer ask on terminal_run beats a command-layer allow", () => {
    const rules = {
      global: [
        { layer: "command" as const, pattern: "npm*", action: "allow" as const },
        { layer: "tool" as const, pattern: "terminal_run", action: "ask" as const },
      ],
      workspaces: {},
    };
    expect(evaluate(rules, { tool: "terminal_run", input: { command: "npm run dev" }, workspace: "/ws" }).action).toBe("ask");
  });

  it("plan mode blocks terminal_run and passes read/kill without a prompt", () => {
    expect(gatePlanCall("terminal_run", { command: "npm run dev" })).toEqual({
      kind: "block",
      reason: expect.stringContaining("terminal_run"),
    });
    // NOT floor-ask: that clamps allow→ask, so a planning agent polling a log
    // would raise a modal on every poll — the exact thing SAFE_TOOLS prevents.
    expect(gatePlanCall("terminal_read", { terminalId: "t1" })).toEqual({ kind: "pass" });
    expect(gatePlanCall("terminal_kill", { terminalId: "t1" })).toEqual({ kind: "pass" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run tests/terminal-tools.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/vitest.log
```
Expected: FAIL — `terminal_read` not in `SAFE_TOOLS`; `gatePlanCall("terminal_run", …)` returns `{kind:"floor-ask"}`.

- [ ] **Step 3: Add the three memberships**

In `pi-runtime/extensions/hv-rules.ts`, extend the `SAFE_TOOLS` line and its comment block:

```typescript
// §26 part 2: terminal_read is a POLL. The agent's only way to know a dev
// server came up is to read the buffer repeatedly, so a permission prompt here
// would fire on every poll, forever — friction that would push the model back
// to `npm run dev &> /tmp/log &`, the thing the feature exists to replace.
// terminal_run and terminal_kill are deliberately NOT here.
export const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls", "ask_user", "plan_complete", "plan_start", "plan_status_update", "use_skill", "terminal_read"]);
```

In `pi-runtime/extensions/hv-plan.ts`:

```typescript
// §26: terminal_run must be NAMED. An unrecognised tool falls to floor-ask,
// which prompts forever but never blocks — and plan mode is read-only, so a
// planning agent must not be able to start a process at all.
const BLOCKED_PLAN_TOOLS = new Set(["edit", "write", "multi_edit", "subagent", "terminal_run"]);
/** Read-only tools that pass straight through the plan gate. */
const PLAN_PASS_TOOLS = new Set([
  // use_skill only returns an ALREADY-APPROVED SKILL.md's text (spawn-time trust
  // gate, §14) — strictly a read. Without it, planning raised a permission modal
  // on every skill load.
  "read", "grep", "glob", "list", "ls", "find", "ask_user", "use_skill", "plan_complete", "plan_start", "plan_status_update",
  // §26: reading a log is a read. Killing REMOVES power rather than exercising
  // it, and a planning agent that started something before entering plan mode
  // must be able to stop it — neither is worth a modal.
  "terminal_read", "terminal_kill",
]);
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/terminal-tools.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vitest.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-rules.ts pi-runtime/extensions/hv-plan.ts tests/terminal-tools.test.ts
git commit -m "feat(terminal): name the three tools in the permission and plan gates"
```

---

### Task 3: Main-side ownership — caps, busy-reuse refusal, the interleave hold

`TerminalManager` stays ignorant of sessions. This module is the only thing that knows an agent started a terminal.

**Files:**
- Create: `src/main/agentTerminals.ts`
- Modify: `src/main/terminals.ts` (one method: `writeFromAgent` is NOT added — see below; only `sawUserInput` bookkeeping moves here)
- Test: `tests/agent-terminals.test.ts`

**Interfaces:**
- Consumes: `TerminalManager` from `./terminals` (`create`, `write`, `readText`, `foreground`, `list`, `kill`, `get`).
- Produces:
  - `class AgentTerminals` with `run(sessionId, workspaceId, cwd, settings, command, terminalId?): Promise<RunResult>`, `read(sessionId, terminalId, lines?, waitMs?): ReadResult`, `kill(sessionId, terminalId): KillResult`, `noteUserInput(terminalId, data: string): void`, `ownedBy(sessionId): string[]`, `buildOpenTerminalsBlock(sessionId): string`, `releaseSession(sessionId): string[]`.
  - `type RunResult = { ok: true; terminalId: string; title: string } | { ok: false; reason: string }`
  - `type ReadResult = { ok: true; text: string; running: boolean; exitCode: number | null; userTyped: boolean } | { ok: false; reason: string }`
  - `type KillResult = { ok: true } | { ok: false; reason: string }`
  - `const MAX_AGENT_TERMINALS = 3`
  - `const HOLD_IDLE_MS = 1500`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/agent-terminals.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { TerminalManager } from "../src/main/terminals";
import { AgentTerminals, MAX_AGENT_TERMINALS, HOLD_IDLE_MS } from "../src/main/agentTerminals";
import { DEFAULT_TERMINAL_SETTINGS } from "../src/main/terminalSettings";

const WS = "/tmp";
const S = "sess-1";

let mgr: TerminalManager;
let agent: AgentTerminals;

beforeEach(() => {
  mgr = new TerminalManager(() => {}, () => {}, () => {});
  agent = new AgentTerminals(mgr);
});
afterEach(() => mgr.killAll());

const run = (command: string, terminalId?: string) =>
  agent.run(S, WS, WS, DEFAULT_TERMINAL_SETTINGS, command, terminalId);

describe("soft cap", () => {
  it(`refuses past ${MAX_AGENT_TERMINALS} and names what is running`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_AGENT_TERMINALS; i++) {
      const r = await run("true");
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(r.terminalId);
    }
    const over = await run("true");
    expect(over.ok).toBe(false);
    // Naming them is the mechanism: the agent's next move must be to kill one,
    // not to guess which one it may reuse.
    if (!over.ok) for (const id of ids) expect(over.reason).toContain(id);
  });

  it("frees a slot when the agent kills one", async () => {
    const first = await run("true");
    expect(first.ok).toBe(true);
    for (let i = 1; i < MAX_AGENT_TERMINALS; i++) await run("true");
    if (first.ok) expect(agent.kill(S, first.terminalId)).toEqual({ ok: true });
    expect((await run("true")).ok).toBe(true);
  });
});

describe("busy-reuse refusal", () => {
  it("refuses to reuse a terminal whose foreground is non-null, naming the process", async () => {
    const r = await run("sleep 30");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The foreground process is POLLED by node-pty, not evented — give it a beat.
    await vi.waitFor(() => expect(mgr.foreground(r.terminalId)).toBe("sleep"), { timeout: 5000 });
    const reuse = await run("npm test", r.terminalId);
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.reason).toContain("sleep");
  });

  it("allows reuse of an idle terminal", async () => {
    const r = await run("true");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await vi.waitFor(() => expect(mgr.foreground(r.terminalId)).toBeNull(), { timeout: 5000 });
    const again = await run("echo hello", r.terminalId);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.terminalId).toBe(r.terminalId);
  });
});

describe("ownership", () => {
  it("refuses a terminal another session owns", async () => {
    const r = await run("true");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(agent.kill("sess-2", r.terminalId).ok).toBe(false);
    expect(agent.read("sess-2", r.terminalId).ok).toBe(false);
  });

  it("releaseSession returns the ids it owned and forgets them", async () => {
    const r = await run("sleep 30");
    if (!r.ok) return;
    expect(agent.releaseSession(S)).toEqual([r.terminalId]);
    expect(agent.ownedBy(S)).toEqual([]);
    // The PTY is NOT killed — the caller decides Stop them / Keep them.
    expect(mgr.get(r.terminalId)?.running).toBe(true);
  });
});

describe("interleave hold", () => {
  it("holds the agent's write while the user is mid-line and releases on idle", async () => {
    vi.useFakeTimers();
    try {
      const r = await run("true");
      if (!r.ok) return;
      const spy = vi.spyOn(mgr, "write");
      agent.noteUserInput(r.terminalId, "npm ls");   // user typed, no Enter yet
      spy.mockClear();
      const pending = run("echo queued", r.terminalId);
      expect(spy).not.toHaveBeenCalled();            // held
      await vi.advanceTimersByTimeAsync(HOLD_IDLE_MS + 50);
      const res = await pending;
      expect(spy).toHaveBeenCalled();                // released
      expect(res.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hold once the user's line is ended", async () => {
    const r = await run("true");
    if (!r.ok) return;
    agent.noteUserInput(r.terminalId, "npm ls\r");   // Enter — the line is gone
    const spy = vi.spyOn(mgr, "write");
    await run("echo now", r.terminalId);
    expect(spy).toHaveBeenCalled();
  });

  it("reports userTyped on the next read, then clears it", async () => {
    const r = await run("true");
    if (!r.ok) return;
    agent.noteUserInput(r.terminalId, "x");
    const first = agent.read(S, r.terminalId);
    expect(first.ok && first.userTyped).toBe(true);
    const second = agent.read(S, r.terminalId);
    expect(second.ok && second.userTyped).toBe(false);
  });
});

describe("open-terminals context block", () => {
  it("is empty with no terminals and lists one line each otherwise", async () => {
    expect(agent.buildOpenTerminalsBlock(S)).toBe("");
    const r = await run("sleep 30");
    if (!r.ok) return;
    const block = agent.buildOpenTerminalsBlock(S);
    expect(block).toContain("<open-terminals>");
    expect(block).toContain(r.terminalId);
    expect(block).toContain("running");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run tests/agent-terminals.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/vitest.log
```
Expected: FAIL — cannot resolve `../src/main/agentTerminals`.

- [ ] **Step 3: Write the module**

```typescript
// src/main/agentTerminals.ts
/**
 * §26 part 2 — which terminals an agent session owns, and the three rules that
 * make handing a PTY to a model safe.
 *
 * TerminalManager stays session-ignorant: a terminal belongs to a WORKSPACE
 * (part 1's locked decision), and this module is the only thing that also knows
 * a session started one. Killing a session therefore never has to kill a PTY —
 * it releases a claim.
 */
import type { TerminalManager, TerminalInfo } from "./terminals";
import type { TerminalSettings } from "./terminalSettings";

/** §26: unbounded is how you end up with eleven dev servers on eleven ports. */
export const MAX_AGENT_TERMINALS = 3;

/**
 * How long the agent's held write waits for the user to stop typing.
 *
 * ponytail: an approximation, and §26 says so. Nothing in the app can see the
 * user's input line — part 1's `foreground()` comment records that knowing you
 * are at a prompt is unsolvable without shell integration. What we CAN see is
 * who wrote last. Upgrade path: OSC 133 prompt markers.
 */
export const HOLD_IDLE_MS = 1500;

export type RunResult = { ok: true; terminalId: string; title: string } | { ok: false; reason: string };
export type ReadResult =
  | { ok: true; text: string; running: boolean; exitCode: number | null; userTyped: boolean }
  | { ok: false; reason: string };
export type KillResult = { ok: true } | { ok: false; reason: string };

interface Claim {
  sessionId: string;
  /** Set when the user types, cleared on a line ending. Drives the hold. */
  userMidLine: boolean;
  /** Set when the user types, cleared by the next terminal_read. */
  userTypedSinceRead: boolean;
  /** When the user last typed — the debounce is measured from here. */
  lastUserInputAt: number;
}

const LINE_ENDERS = /[\r\n\x03\x15]/; // Enter, Ctrl-C, Ctrl-U — the line is gone

export class AgentTerminals {
  private readonly claims = new Map<string, Claim>();

  constructor(private readonly mgr: TerminalManager) {}

  ownedBy(sessionId: string): string[] {
    return [...this.claims.entries()]
      .filter(([id, c]) => c.sessionId === sessionId && this.mgr.get(id))
      .map(([id]) => id);
  }

  async run(
    sessionId: string,
    workspaceId: string,
    cwd: string,
    settings: TerminalSettings,
    command: string,
    terminalId?: string,
  ): Promise<RunResult> {
    let id = terminalId;
    if (id) {
      const claim = this.claims.get(id);
      if (!claim || claim.sessionId !== sessionId) {
        return { ok: false, reason: `No terminal '${id}' belongs to this session.` };
      }
      const info = this.mgr.get(id);
      if (!info?.running) return { ok: false, reason: `Terminal '${id}' has exited. Start a new one.` };
      // The §2 hazard arriving through the parameter that was meant to be safe:
      // `npm test` sent into a terminal running `npm run dev` is keystrokes into
      // Vite, not a command. foreground() is the only thing that can tell.
      const fg = this.mgr.foreground(id);
      if (fg) {
        return {
          ok: false,
          reason:
            `Terminal '${id}' is busy running '${fg}' — sending a command there would type into ` +
            `that process, not the shell. Start a new terminal, or terminal_kill this one first.`,
        };
      }
    } else {
      const owned = this.ownedBy(sessionId);
      if (owned.length >= MAX_AGENT_TERMINALS) {
        const running = owned.map((t) => `${t} (${this.mgr.get(t)?.title ?? "?"})`).join(", ");
        return {
          ok: false,
          reason:
            `This session already has ${owned.length} terminals open, the maximum. ` +
            `Running: ${running}. terminal_kill one before starting another.`,
        };
      }
      const info = this.mgr.create(workspaceId, cwd, settings);
      if (!info.running) return { ok: false, reason: `The terminal could not start (exit ${info.exitCode}).` };
      id = info.id;
      this.claims.set(id, { sessionId, userMidLine: false, userTypedSinceRead: false, lastUserInputAt: 0 });
    }

    await this.waitForUserIdle(id);
    this.mgr.write(id, command + "\r");
    return { ok: true, terminalId: id, title: this.mgr.get(id)?.title ?? "" };
  }

  read(sessionId: string, terminalId: string, lines?: number, waitMs?: number): ReadResult {
    const claim = this.claims.get(terminalId);
    if (!claim || claim.sessionId !== sessionId) {
      return { ok: false, reason: `No terminal '${terminalId}' belongs to this session.` };
    }
    const info = this.mgr.get(terminalId);
    if (!info) return { ok: false, reason: `Terminal '${terminalId}' no longer exists.` };
    const text = this.mgr.readText(terminalId, lines) ?? "";
    const userTyped = claim.userTypedSinceRead;
    claim.userTypedSinceRead = false;
    void waitMs; // the caller awaits quiet before calling — see ipc.ts
    return { ok: true, text, running: info.running, exitCode: info.exitCode, userTyped };
  }

  kill(sessionId: string, terminalId: string): KillResult {
    const claim = this.claims.get(terminalId);
    if (!claim || claim.sessionId !== sessionId) {
      return { ok: false, reason: `No terminal '${terminalId}' belongs to this session.` };
    }
    this.mgr.kill(terminalId);
    this.claims.delete(terminalId);
    return { ok: true };
  }

  /** Every byte the USER typed, so the hold and the userTyped flag can be honest. */
  noteUserInput(terminalId: string, data: string): void {
    const claim = this.claims.get(terminalId);
    if (!claim) return;
    claim.userTypedSinceRead = true;
    claim.lastUserInputAt = Date.now();
    claim.userMidLine = !LINE_ENDERS.test(data);
  }

  /** Drop this session's claims WITHOUT killing anything — the caller decides. */
  releaseSession(sessionId: string): string[] {
    const owned = this.ownedBy(sessionId);
    for (const id of owned) this.claims.delete(id);
    return owned;
  }

  /**
   * §9's seam, for terminals. Paths-only in spirit: id, title, state — one line
   * each, a few dozen tokens, so the agent can find a dev server it started
   * three compactions ago.
   */
  buildOpenTerminalsBlock(sessionId: string): string {
    const rows = this.ownedBy(sessionId)
      .map((id) => this.mgr.get(id))
      .filter((i): i is TerminalInfo => !!i)
      .map((i) => `${i.id}\t${i.title}\t${i.running ? "running" : `exited ${i.exitCode}`}`);
    if (!rows.length) return "";
    return `<open-terminals>\n${rows.sort().join("\n")}\n</open-terminals>`;
  }

  private waitForUserIdle(terminalId: string): Promise<void> {
    const claim = this.claims.get(terminalId);
    if (!claim?.userMidLine) return Promise.resolve();
    const waited = Date.now() - claim.lastUserInputAt;
    const remaining = Math.max(0, HOLD_IDLE_MS - waited);
    if (remaining === 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/agent-terminals.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/vitest.log
```
Expected: PASS. If the busy-reuse test flakes, it is the title poll (`TITLE_POLL_MS = 500`) — the `vi.waitFor` bound is there for exactly that; raise it before suspecting the logic.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentTerminals.ts tests/agent-terminals.test.ts
git commit -m "feat(terminal): session ownership, the cap, and the busy-reuse refusal"
```

---

### Task 4: The three tools in the bridge

**Files:**
- Modify: `pi-runtime/extensions/hv-builtins.ts`, `pi-runtime/extensions/happyvibe-bridge.ts`, `src/main/config.ts:40,268,278`
- Test: `tests/terminal-tools.test.ts` (append — the `parseBuiltins` arm only; the wire is Task 7's live test)

**Interfaces:**
- Consumes: `checkCommand`, `hasBackgroundAmpersand`, `TERMINAL_STEER_LINE` (Task 1); `builtins` (`happyvibe-bridge.ts:261`).
- Produces: three registered tools; envelope kinds `hv.terminal-run` / `hv.terminal-read` / `hv.terminal-kill` on `ctx.ui.input`, each answering with a JSON string.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/terminal-tools.test.ts
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("builtins.terminal", () => {
  it("defaults on and fails open on garbage", () => {
    expect(parseBuiltins(undefined).terminal).toBe(true);
    expect(parseBuiltins("{{{not json").terminal).toBe(true);
  });

  it("turns off only on an explicit false", () => {
    expect(parseBuiltins(JSON.stringify({ terminal: false })).terminal).toBe(false);
    expect(parseBuiltins(JSON.stringify({ terminal: "no" })).terminal).toBe(true);
  });

  // Unlike plan/askUser there is no coupling to repair: the three terminal
  // tools are one group, and nothing outside it depends on them.
  it("does not disturb the plan/askUser coupling", () => {
    const b = parseBuiltins(JSON.stringify({ terminal: false, plan: true, askUser: false }));
    expect(b.askUser).toBe(true);
    expect(b.plan).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run tests/terminal-tools.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vitest.log
```
Expected: FAIL — `parseBuiltins(undefined).terminal` is `undefined`, not `true`.

- [ ] **Step 3: Extend `BuiltinToggles`**

In `pi-runtime/extensions/hv-builtins.ts`:

```typescript
export interface BuiltinToggles {
  plan: boolean;
  askUser: boolean;
  planAppend: string;
  /** §26 part 2: the grouped "Terminal" entry — all three tools or none. */
  terminal: boolean;
}

export function parseBuiltins(raw: string | undefined): BuiltinToggles {
  const out: BuiltinToggles = { plan: true, askUser: true, planAppend: "", terminal: true };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<{ plan: boolean; askUser: boolean; planAppend: string; terminal: boolean }>;
    if (p.plan === false) out.plan = false;
    if (p.askUser === false) out.askUser = false;
    if (p.terminal === false) out.terminal = false;
    if (typeof p.planAppend === "string") out.planAppend = p.planAppend;
    // (existing plan/askUser coupling comment and line stay exactly as they are)
    if (out.plan) out.askUser = true;
  } catch {
    /* fail open */
  }
  return out;
}
```

In `src/main/config.ts`, mirror it at all three sites:

```typescript
// line ~40
builtinTools?: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean };

// getBuiltinTools() return — append, keeping the existing plan/askUser line intact:
return { plan, askUser: plan ? true : (t?.askUser ?? true), planAppend: t?.planAppend ?? "", terminal: t?.terminal ?? true };
```

and widen `setBuiltinTools`'s parameter type identically.

- [ ] **Step 4: Register the tools**

In `happyvibe-bridge.ts`, add the import beside the other pure modules:

```typescript
import { checkCommand, hasBackgroundAmpersand, TERMINAL_STEER_LINE } from "./hv-terminal";
```

Add `terminal_run` and `terminal_kill` to `INTENT_TOOLS` (`:68`):

```typescript
// §26: terminal_run/terminal_kill take the REQUIRED intent, per the standing
// rule. `subagent`'s demotion to optional is deliberately NOT copied — a
// terminal that starts is a card in someone's transcript and must say why.
const INTENT_TOOLS = ["ask_user", "mcp", "use_skill", "terminal_run", "terminal_kill"];
```

Extend `summarize()` (`:40`) so the permission modal gets the factual command, never the intent:

```typescript
function summarize(toolName: string, input: Record<string, unknown>): string {
  // §26 + §13's MCP rule: the prompt shows what will RUN. `intent` is the
  // model's own words and must never be what a user approves against.
  if ((toolName === "bash" || toolName === "terminal_run") && typeof input.command === "string") {
    return input.command.slice(0, 300);
  }
  return JSON.stringify(input).slice(0, 300);
}
```

Add the tool block, modelled on the plan block at `:956`:

```typescript
  // ── §26 part 2: agent terminals ──────────────────────────────────────────
  // Gated as ONE group: an agent that can run but not read starts processes it
  // cannot observe, and one that cannot kill cannot clean up. Those are not
  // configurations anyone wants, so they are not reachable.
  if (builtins.terminal) {
  pi.registerTool({
    name: "terminal_run",
    label: "Run in terminal",
    description:
      "Run ONE command line in a persistent terminal the user can see, type into and stop. " +
      "Use this for anything long-running (dev servers, watchers, `docker compose up`) instead of " +
      "backgrounding a bash command. Omit terminalId to open a new terminal; pass one to reuse an " +
      "idle terminal you already own. Exactly one command line per call — newlines are rejected, " +
      "and each call is permission-gated separately. Poll the output with terminal_read.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you are running and why." }),
      command: Type.String({ description: "One command line. No embedded newlines." }),
      terminalId: Type.Optional(Type.String({ description: "Reuse this terminal instead of opening a new one. It must be idle." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { command, terminalId } = params as { command?: unknown; terminalId?: string };
      // Belt and braces: the tool_call handler already refused a multi-line
      // command before the permission prompt (that ordering is the point), so
      // this arm only catches a call that reached execute some other way.
      const checked = checkCommand(command);
      if (!checked.ok) return { content: [{ type: "text", text: checked.reason }], details: {} };
      const raw = await ctx.ui.input(
        JSON.stringify({ kind: "hv.terminal-run", command: checked.command, terminalId }),
        "",
      );
      return terminalReply(raw);
    },
  });

  pi.registerTool({
    name: "terminal_read",
    label: "Read terminal",
    description:
      "Read the most recent output of one of your terminals, as plain text. Defaults to the last " +
      "200 lines. Pass waitMs to wait (up to 15s) for output to go quiet before reading, instead of " +
      "sleeping in bash. Tells you whether the terminal is still running and whether the USER has " +
      "typed into it since your last read — if they have, re-read before assuming you know its state.",
    parameters: Type.Object({
      terminalId: Type.String({ description: "The terminal to read." }),
      lines: Type.Optional(Type.Number({ description: "How many trailing lines. Default 200, capped at 200." })),
      waitMs: Type.Optional(Type.Number({ description: "Wait up to this many ms for output to go quiet first. Capped at 15000." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { terminalId, lines, waitMs } = params as { terminalId?: string; lines?: number; waitMs?: number };
      const raw = await ctx.ui.input(
        JSON.stringify({ kind: "hv.terminal-read", terminalId, lines, waitMs }),
        "",
      );
      return terminalReply(raw);
    },
  });

  pi.registerTool({
    name: "terminal_kill",
    label: "Stop terminal",
    description: "Stop one of your terminals and the process running in it. Clean up when you are done with it.",
    parameters: Type.Object({
      intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you are stopping and why." }),
      terminalId: Type.String({ description: "The terminal to stop." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { terminalId } = params as { terminalId?: string };
      const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.terminal-kill", terminalId }), "");
      return terminalReply(raw);
    },
  });
  } // builtins.terminal
```

Add the shared reply helper near `summarize()`:

```typescript
/**
 * Main ALWAYS answers a hv.terminal-* input, with an error string on failure —
 * same contract as hv.plan-write, and for the same reason: a bridge left
 * waiting on ctx.ui.input hangs the turn with no way out.
 */
function terminalReply(raw: unknown): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  if (typeof raw !== "string" || !raw) {
    return { content: [{ type: "text", text: "The terminal request failed. Try again or start a new terminal." }], details: {} };
  }
  try {
    const p = JSON.parse(raw) as { ok?: boolean; reason?: string; text?: string } & Record<string, unknown>;
    if (p.ok === false) return { content: [{ type: "text", text: p.reason ?? "The terminal request was refused." }], details: {} };
    return { content: [{ type: "text", text: p.text ?? JSON.stringify(p) }], details: p };
  } catch {
    return { content: [{ type: "text", text: raw }], details: {} };
  }
}
```

- [ ] **Step 5: Add the newline refusal and the `&` block to the `tool_call` handler**

Both go where the plan clamp already runs, BEFORE the permission prompt — a modal must never be raised for a call that is going to be refused anyway, and must never show a command line it is only half describing.

```typescript
// inside the existing tool_call handler, beside the gatePlanCall clamp:

// §26: refuse a multi-line command BEFORE the permission prompt. describeCommand
// shows only the first segment, so prompting here would ask the user to approve
// a string they are only being shown part of.
if (event.toolName === "terminal_run") {
  const checked = checkCommand((event.input as Record<string, unknown>)?.command);
  if (!checked.ok) return { block: true, reason: checked.reason };
}

// §26: once terminals exist, `npm run dev &` is the model reaching for the
// broken thing with the working thing beside it. Only fires while the group is
// ENABLED — with it off there is nowhere to redirect to, and blocking `&` would
// turn a context-saving setting into a capability removal it never advertised.
if (builtins.terminal && event.toolName === "bash") {
  const cmd = (event.input as Record<string, unknown>)?.command;
  if (typeof cmd === "string" && hasBackgroundAmpersand(cmd)) {
    return {
      block: true,
      reason:
        "Backgrounding with `&` hides the process from the user and leaves them unable to stop it. " +
        "Use terminal_run instead — it gives the same long-running command a card they can watch, " +
        "type into and kill.",
    };
  }
}
```

- [ ] **Step 6: Add the steer line to the system prompt**

Beside the existing `planSection` at `:390`:

```typescript
const terminalSection = builtins.terminal ? "\n\n" + TERMINAL_STEER_LINE : "";
```
and append it to the same system-prompt string the plan section joins.

- [ ] **Step 7: Run the gate**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/gate.log
```
Expected: PASS — both typechecks, build, and the non-live suite.

- [ ] **Step 8: Commit**

```bash
git add pi-runtime/extensions/hv-builtins.ts pi-runtime/extensions/happyvibe-bridge.ts src/main/config.ts tests/terminal-tools.test.ts
git commit -m "feat(terminal): three gated tools, and bash loses its trailing &"
```

---

### Task 5: Main-side envelope routing, audit, and the context block

**Files:**
- Modify: `src/main/ipc.ts`
- Test: covered by Task 3's unit tests plus Task 7's live test; no new test file (the routing is a thin adapter over already-tested logic).

**Interfaces:**
- Consumes: `AgentTerminals` (Task 3), `checkCommand` (Task 1), the existing `client.on("ui-request")` chain at `:703`, `buildOpenFilesBlock` / `getOpenFilesContext` at `:1342`.
- Produces: `hv.terminal` notify to the renderer (`{kind:"hv.terminal", stage:"started"|"exited"|"killed", terminalId, title, sessionId}`); EventLog entries `terminal.run` and `terminal.kill`.

- [ ] **Step 1: Add the parser and the router**

Beside `parsePlanWrite` at `:182`:

```typescript
/** §26 part 2: the blocking agent-terminal inputs. Main always answers. */
function parseTerminalReq(r: { method?: string; title?: string }):
  | { kind: "run"; command: string; terminalId?: string }
  | { kind: "read"; terminalId: string; lines?: number; waitMs?: number }
  | { kind: "kill"; terminalId: string }
  | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    if (p.kind === "hv.terminal-run" && typeof p.command === "string") {
      return { kind: "run", command: p.command, terminalId: typeof p.terminalId === "string" ? p.terminalId : undefined };
    }
    if (p.kind === "hv.terminal-read" && typeof p.terminalId === "string") {
      return {
        kind: "read",
        terminalId: p.terminalId,
        lines: typeof p.lines === "number" ? p.lines : undefined,
        waitMs: typeof p.waitMs === "number" ? p.waitMs : undefined,
      };
    }
    if (p.kind === "hv.terminal-kill" && typeof p.terminalId === "string") {
      return { kind: "kill", terminalId: p.terminalId };
    }
    return null;
  } catch {
    return null;
  }
}
```

In the `client.on("ui-request")` chain, immediately after the `parsePlanWrite` branch (so it sits with the other blocking inputs):

```typescript
// §26 part 2: blocking terminal inputs. Main ALWAYS respondUi — an error is a
// JSON {ok:false,reason}, never a dropped response, or the turn hangs.
const term = parseTerminalReq(r as { method?: string; title?: string });
if (term) {
  void (async () => {
    const rid = r.id;
    const reply = (v: unknown): void => client.respondUi(rid, { value: JSON.stringify(v) });
    try {
      const wsId = meta?.workspaceId;
      if (!wsId) throw new Error("No workspace for this session");
      if (term.kind === "run") {
        const res = await agentTerminals.run(sessionId, wsId, wsId, getTerminalSettings(), term.command, term.terminalId);
        if (res.ok) {
          // §26: every terminal_run is audited with its command — the thing
          // `npm run dev &` gives you nothing of.
          void log.append({
            type: "terminal.run",
            sessionId,
            workspaceId: wsId,
            data: { terminalId: res.terminalId, command: term.command },
          });
          send("hv:ui-request", {
            id: `term-${res.terminalId}`,
            method: "notify",
            title: JSON.stringify({ kind: "hv.terminal", stage: "started", terminalId: res.terminalId, title: res.title }),
            sessionId,
          });
        }
        reply(res);
      } else if (term.kind === "read") {
        // waitMs: settle for quiet rather than sleeping in bash. Capped, and the
        // agent gets whatever is there when the cap expires.
        if (term.waitMs) await settleQuiet(term.terminalId, Math.min(term.waitMs, 15_000));
        reply(agentTerminals.read(sessionId, term.terminalId, Math.min(term.lines ?? 200, 200)));
      } else {
        const res = agentTerminals.kill(sessionId, term.terminalId);
        if (res.ok) {
          void log.append({ type: "terminal.kill", sessionId, workspaceId: wsId, data: { terminalId: term.terminalId } });
          send("hv:ui-request", {
            id: `term-${term.terminalId}`,
            method: "notify",
            title: JSON.stringify({ kind: "hv.terminal", stage: "killed", terminalId: term.terminalId }),
            sessionId,
          });
        }
        reply(res);
      }
    } catch (e) {
      reply({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  })();
  return;
}
```

- [ ] **Step 2: Construct `AgentTerminals` and feed it user input**

Beside the `TerminalManager` construction at `:214`:

```typescript
const agentTerminals = new AgentTerminals(terminals);
```

and in the `hv:term-input` handler at `:1839`, so the hold and the `userTyped` flag see every keystroke the human makes — whether they typed into a card or into a tab:

```typescript
ipcMain.handle("hv:term-input", (_e, id: string, data: string) => {
  const d = String(data);
  // §26: main is the only place that sees BOTH writers, which is what makes the
  // interleave hold possible at all. Card and tab route through here alike.
  agentTerminals.noteUserInput(id, d);
  terminals.write(id, d);
});
```

Add `settleQuiet` beside the manager:

```typescript
/**
 * Resolve when the terminal has produced no bytes for ~400ms, or when the cap
 * expires. §26: without this the agent's only way to wait is bash("sleep 3"),
 * a second gated tool call per poll, forever.
 */
function settleQuiet(terminalId: string, capMs: number): Promise<void> {
  const QUIET_MS = 400;
  return new Promise((resolve) => {
    let last = Date.now();
    const off = onTerminalData(terminalId, () => { last = Date.now(); });
    const started = Date.now();
    const tick = setInterval(() => {
      if (Date.now() - last >= QUIET_MS || Date.now() - started >= capMs) {
        clearInterval(tick);
        off();
        resolve();
      }
    }, 100);
  });
}
```

`onTerminalData` is a small subscription added to the existing `send("hv:term-data", …)` callback at `:215` — a `Map<string, Set<() => void>>` notified there, returning an unsubscribe. Keep it in `ipc.ts` beside the manager; it is four lines and has no other consumer.

- [ ] **Step 3: Put the open-terminals block on the prompt seam**

At `:1342`, extend the existing branch. §26: one setting governs both, and the setting's description says so.

```typescript
// Round 11 + §26: the files the user has open AND the terminals this session
// started, on one seam under one toggle. The terminals block is what lets an
// agent find a dev server it started three compactions ago.
if (getOpenFilesContext()) {
  if (openFiles && openFilesChanged(lastOpenFiles.get(sessionId), openFiles)) {
    const block = buildOpenFilesBlock(openFiles);
    /* …existing append… */
    lastOpenFiles.set(sessionId, [...openFiles]);
  }
  const terms = agentTerminals.buildOpenTerminalsBlock(sessionId);
  if (terms && terms !== lastOpenTerminals.get(sessionId)) {
    /* …append `terms` exactly as the open-files block is appended… */
    lastOpenTerminals.set(sessionId, terms);
  }
}
```
with `const lastOpenTerminals = new Map<string, string>();` beside `lastOpenFiles`. Comparing the rendered block string is the whole change-detector — the block is sorted, so an unchanged set renders byte-identically (same trick as `openFilesChanged`).

- [ ] **Step 4: Pass the flag at spawn**

Wherever `HV_BUILTINS` is composed for `spawnOpts`, it already serialises `getBuiltinTools()`; the new `terminal` key rides along with no change. Verify by grepping the built artifact after a restart:

```
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"
grep -c "hv.terminal-run" out/main/index.js
```
Expected: `EXIT=0` and a non-zero count.

- [ ] **Step 5: Run the gate**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/gate.log
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(terminal): route the agent's terminal calls, audit them, and tell it what it owns"
```

---

### Task 6: The transcript card

**Files:**
- Create: `src/renderer/src/components/TerminalRunCard.tsx`
- Modify: `src/renderer/src/components/ChatView.tsx:1143`, `src/renderer/src/toolLabel.ts`, `src/renderer/src/components/PermissionModal.tsx:12`
- Test: `tests/terminal-card.test.ts`

**Interfaces:**
- Consumes: `hv.terminal` notifies (Task 5); `window.hv.termSnapshot` / `termInput` / `termClose` (existing preload); `openTerminal(t, terminalId)` from `src/renderer/src/tabs.ts:277`.
- Produces: `<TerminalStack runs={…} onStop={…} onOpenAsTab={…} />`; `STACK_CAP = 2`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/terminal-card.test.ts
import { describe, expect, it } from "vitest";
import { visibleRuns, STACK_CAP, summaryLabel } from "../src/renderer/src/components/TerminalRunCard";

const t = (id: string, title: string) => ({ terminalId: id, title, running: true, intent: `run ${id}` });

describe("stack cap", () => {
  it("shows up to two cards in full", () => {
    const runs = [t("a", "vite"), t("b", "vitest")];
    expect(visibleRuns(runs)).toEqual({ cards: runs, collapsed: [] });
  });

  // §26: a terminal card pins INDEFINITELY, unlike a delegation card which
  // assumes termination — so without a cap three dev servers eat the chat.
  it("collapses everything beyond two into a summary strip", () => {
    const runs = [t("a", "vite"), t("b", "vitest"), t("c", "docker")];
    const v = visibleRuns(runs);
    expect(v.cards).toHaveLength(0);
    expect(v.collapsed).toHaveLength(3);
    expect(summaryLabel(v.collapsed)).toBe("3 running · vite, vitest, docker");
  });

  it("drops exited terminals from the stack", () => {
    const runs = [t("a", "vite"), { ...t("b", "vitest"), running: false }];
    expect(visibleRuns(runs).cards.map((r) => r.terminalId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run tests/terminal-card.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vitest.log
```
Expected: FAIL — cannot resolve `TerminalRunCard`.

- [ ] **Step 3: Write the card**

Clone the anatomy of `DelegationRunCard` (`ChatView.tsx:1171`): status dot, tool icon, the model's `intent` as the headline, elapsed time right-aligned, a **Stop** button, a disclosure caret, and `hv-shimmer` while collapsed. Three deliberate differences, each of which the test above or the GUI assertions below pin:

```typescript
// src/renderer/src/components/TerminalRunCard.tsx (pure helpers shown; the JSX
// mirrors DelegationRunCard and is not repeated here)

export interface TerminalRun {
  terminalId: string;
  title: string;
  running: boolean;
  intent: string;
}

/**
 * §26: two cards, then a strip. A terminal card does NOT end on its own — the
 * delegation card's slide-away-on-completion is exactly what a dev server never
 * does — so the cap is what keeps a sticky stack from eating the transcript.
 *
 * Terminal-only, NOT shared with delegation cards: a shared cap would change
 * how subagent cards behave, which is outside this feature.
 */
export const STACK_CAP = 2;

export function visibleRuns(runs: TerminalRun[]): { cards: TerminalRun[]; collapsed: TerminalRun[] } {
  const live = runs.filter((r) => r.running);
  return live.length > STACK_CAP ? { cards: [], collapsed: live } : { cards: live, collapsed: [] };
}

export function summaryLabel(runs: TerminalRun[]): string {
  return `${runs.length} running · ${runs.map((r) => r.title).join(", ")}`;
}
```

The card body:
- **Collapsed** renders a cheap last-3-lines DOM tail from the `hv:term-data` stream — plain text in a `<pre>`, the same treatment as tool-card output. **No emulator.**
- **Expanded** mounts one `TerminalTab`-style emulator, disposed on collapse, repainting from `window.hv.termSnapshot(terminalId)` on mount. Only one expanded card at a time: expanding a second collapses the first. This is affordable only because the buffer lives in main.
- **Typing is ungated** — the emulator's `onData` goes straight to `window.hv.termInput`, exactly as `TerminalTab` does. No permission path, no confirmation.
- **Stop** calls `window.hv.termClose(terminalId)` with no prompt (§26: the human can always kill an agent terminal).
- **Open as tab** dispatches the existing `openTerminal(tabs, terminalId)` and collapses the card to a one-line pointer.

- [ ] **Step 4: Mount it and label the tools**

In `ChatView.tsx`, render `<TerminalStack …/>` inside the same `sticky top-0 z-20 px-6` container as `DelegationSection` (`:1145`), *below* the delegation cards so the two stacks do not fight for the pin.

In `toolLabel.ts`, beside the existing `bash` case:

```typescript
case "terminal_run":
  // The CARD leads with the model's intent (§7); the permission MODAL never does.
  return { icon: "terminal", label: intent ?? describeCommand(String(args?.command ?? "")).label };
case "terminal_kill":
  return { icon: "terminal", label: intent ?? "Stopping a terminal" };
case "terminal_read":
  return { icon: "terminal", label: "Reading terminal output" };
```

In `PermissionModal.tsx:12`:

```typescript
function argsFromSummary(tool: string, summary: string): unknown {
  // §26: the bridge summarises terminal_run AS its command, exactly like bash,
  // so the modal shows what will run rather than the model's own description.
  if (tool === "bash" || tool === "terminal_run") return { command: summary };
  try {
    return JSON.parse(summary);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run the gate**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/gate.log
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/TerminalRunCard.tsx src/renderer/src/components/ChatView.tsx src/renderer/src/toolLabel.ts src/renderer/src/components/PermissionModal.tsx tests/terminal-card.test.ts
git commit -m "feat(terminal): an agent terminal is a card you can type into"
```

---

### Task 7: The grouped built-in entry, the session-end confirm, and the live contract test

**Files:**
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx`, `src/renderer/src/App.tsx` (session-end confirm)
- Create: `tests/terminal-bridge.test.ts` (**LIVE**)

**Interfaces:**
- Consumes: everything above; `hv:builtins-get` / `hv:builtins-set`; `releaseSession` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Add the grouped entry**

One row — **"Terminal"** — beside Plan mode and ask_user, enabled by default, global scope, showing the three tool prompts read-only in full with an append box, following the Plan-mode row exactly. Its description must state the trade honestly:

> Lets the agent run long-running commands in terminals you can watch, type into and stop. Turning this off does not stop it wanting to — it goes back to backgrounding commands in `bash`, where you cannot see or stop them. Saves the context cost of three tool schemas.

**No promotion path.** `HV_BUILTINS` resolves at spawn and `hv:builtins-set` respawns nothing, so this toggle cannot take tools from a running session. On a later unrelated respawn, `builtins.terminal` is false, the tools do not register, and the card simply stops being fed — the PTY keeps running and stays in the terminal list, openable as a tab. Nothing to build; add a comment saying so where the toggle is handled, or the next reader will build it.

- [ ] **Step 2: Add the session-end confirm**

Where a session is ended or deleted, call `agentTerminals.releaseSession(sessionId)` first. If it returns any ids whose terminals are still running, show the two-named-outcomes confirm the workspace-removal flow already uses:

> **2 processes started by this session are still running.**
> [ Stop them ] [ Keep them as terminals ]

*Stop them* → `terminals.kill(id)` for each. *Keep them as terminals* → `openTerminal(tabs, id)` for each, and nothing dies. Never silently kill, never silently leak.

- [ ] **Step 3: Write the live contract test**

```typescript
// tests/terminal-bridge.test.ts
// LIVE — real DeepSeek. Runs only via `npm run test:live`.
import { describe, expect, it } from "vitest";
// (import the same harness the other *-bridge tests use: the .env loader that
//  only fills UNSET vars, KEY, startBridge/askUntil from tests/reask.ts)

const KEY = /* the shared computation used by every live test */ undefined as string | undefined;

describe.skipIf(!KEY)("agent terminals (live)", () => {
  it("opens a terminal, reads it, and kills it", async () => {
    // askUntil, not a single ask: a prose turn with no tool call is the known
    // failure mode of this suite, and a longer timeout does not fix a model
    // that already finished its turn (see CLAUDE.md).
    const started = await askUntil(
      "Start a long-running process with terminal_run: `sleep 20`. Then stop.",
      (n) => n.tool === "terminal_run",
    );
    expect(started.input.command).toBe("sleep 20");
    // §26: intent is REQUIRED on terminal_run.
    expect(typeof started.input.intent).toBe("string");
    const terminalId = started.result.details.terminalId as string;
    expect(terminalId).toBeTruthy();

    const read = await askUntil(
      `Read terminal ${terminalId} with terminal_read and tell me what it shows.`,
      (n) => n.tool === "terminal_read",
    );
    // The rendered grid, not ANSI: the whole reason main mirrors into
    // @xterm/headless rather than keeping a byte ring.
    expect(read.result.details.running).toBe(true);
    expect(String(read.result.details.text)).not.toContain("\x1b[");

    const killed = await askUntil(
      `Stop terminal ${terminalId} with terminal_kill.`,
      (n) => n.tool === "terminal_kill",
    );
    expect(killed.result.details.ok).toBe(true);
  }, 180_000);

  it("refuses a multi-line command before any permission prompt", async () => {
    // Direct tool_call injection, not a model ask — the point is the ORDER
    // (blocked before the modal), which a model cannot be relied on to produce.
    const res = await callToolDirectly("terminal_run", { intent: "x", command: "echo a\nrm -rf /" });
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/one command line/i);
    expect(res.sawPermissionPrompt).toBe(false);
  }, 60_000);
});
```

Match the exact harness helpers the neighbouring `*-bridge.test.ts` files use — read `tests/plan-bridge.test.ts` first and copy its setup verbatim rather than inventing one.

- [ ] **Step 4: Run the full gate plus the live batch**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/gate.log
npm run live:why
npm run test:live > /tmp/live.log 2>&1; echo "EXIT=$?"
tail -60 /tmp/live.log
```
Expected: gate PASS; `live:why` prints (this branch touches `pi-runtime/extensions/`), and the live batch is green — now 15 files, ~6 min serial. One live failure ⇒ rerun that file in isolation before calling it a regression.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/BuiltinToolsBlock.tsx src/renderer/src/App.tsx tests/terminal-bridge.test.ts
git commit -m "feat(terminal): one grouped toggle, a session-end confirm, and the live contract"
```

---

## Verification

### Automated

| Check | Command | Expected |
|---|---|---|
| Pure policy | `npx vitest run tests/terminal-tools.test.ts` | PASS — newlines rejected, `&&` never fires, gate placements pinned |
| Ownership | `npx vitest run tests/agent-terminals.test.ts` | PASS — cap of 3, busy-reuse refused by name, hold released on idle |
| Card | `npx vitest run tests/terminal-card.test.ts` | PASS — third card collapses to a strip |
| Full gate | `npm run gate` | PASS — both typechecks, build, ~1265 non-live tests |
| Live | `npm run test:live` | PASS — 15 files serial, ~6 min |
| Main is actually rebuilt | `grep -c "hv.terminal-run" out/main/index.js` | non-zero, **after** a dev-server restart |

### GUI — what will be TRUE on screen

Run `npm run dev`, open a workspace, and check each of these. Every one names the surface it is observed on, because the surface that owns a resource is rarely the surface that changed it.

**On the chat transcript:**
1. Ask the agent to start a dev server. A permission modal appears showing **the command** (`npm run dev`) — **not** the model's intent sentence. Approve it.
2. A card pins at the top of the transcript with the terminal glyph, the model's intent as its headline, a running elapsed timer, and a shimmer bar. It **does not slide away** while the process runs — leave it a minute and confirm it is still pinned.
3. Expand the card. A live terminal appears and shows the dev server's output. **Type into it** — the keystrokes appear, and **no permission modal is raised**. This is the ungated-human rule made visible.
4. Click **Stop**. The process dies with **no confirmation prompt** — the human never asks permission to kill.

**Absence assertions** (an absence cannot be screenshotted, so check each by name):
5. **No terminal tab appears** in any tab strip when the agent starts a terminal. The tab strip's contents must be byte-identical before and after — the agent never creates a tab.
6. With **three** terminals running, **zero full cards** are on screen: exactly one summary strip reading `3 running · <title>, <title>, <title>`. The individual cards are absent, not merely small.
7. Expand card A, then expand card B: **card A's emulator is gone** (collapsed to its three-line tail). Two live emulators are never mounted at once.
8. Ask for a fourth terminal: the agent reports a refusal naming the three running terminals, and **no fourth card appears**.

**On the All Tools page (not the chat — this is the surface that owns the setting):**
9. A single **"Terminal"** row sits beside Plan mode and ask_user, **enabled**, showing a token weight for **three** tools. There are **no separate `terminal_run` / `terminal_read` / `terminal_kill` rows** — that is the grouping, and three rows would mean it failed.
10. Its description says turning it off sends the agent back to backgrounding in `bash`. Toggle it off, start a **new** session, and ask for a dev server: the agent uses `bash` and **is not blocked** for the trailing `&` — the detector is correctly gated on the group.

**On the Settings → Context page (the surface that owns the toggle, not the chat where the effect shows):**
11. Its open-files-context description now also mentions terminals. Turn it off and confirm — via the context panel's breakdown — that **no `<open-terminals>` block** is present in the next prompt.

**On the audit log (Settings → Audit):**
12. Every approved `terminal_run` has an entry **with its command**. A `bash` call blocked for a trailing `&` appears too. Neither is silent.

**On the plan-mode chat:**
13. Enter Plan Mode and ask for a dev server: `terminal_run` is **blocked**, with the plan-mode reason — not merely prompted. Then ask it to read an existing terminal: it reads with **no modal at all**. A modal here is the `floor-ask` regression this plan exists to prevent.

**The regression this design risks, as a sequence to perform:**
14. Start three terminals (collapsed to a strip) → expand the strip → expand one card → **Open as tab** → close that tab. Expected: the tab closes and kills that PTY (part 1's rule — a terminal tab *is* its terminal), the card for it disappears, and the remaining two terminals return to **two full cards**, not a stale strip still claiming three. The stack must be driven by live state, not by a count captured when the strip was built.
15. Then reload the renderer (⌘R). The two remaining terminals are still running, their cards are **rebuilt from the session's `hv.terminal` state**, and typing into one still works. A card that comes back empty means the resync reads the wrong source.

---

## Notes for the implementer

- **Read `docs/prd.md` §26 and the Notion page `3b5d33dfffca8118a09ac7553a59502b` first.** Every decision here has a recorded reason; the reasons are what stop a "simplification" from re-opening a hazard.
- **`TerminalManager` needs no new public method.** If you find yourself adding one, check first — `readText`, `foreground`, `list`, `get` and `kill` were all built in part 1 specifically for this.
- **The one ordering that matters:** newline refusal and the plan clamp run in the `tool_call` handler *before* the permission prompt. A modal must never be shown for a call that will be refused, and never for a command it can only half describe.
- **Do not add a `cursor` to `terminal_read`.** It was specced, examined and removed — `readText` reads the rendered grid, where scrollback trims from the top, so a cursor silently skips lines. `docs/prd.md` §26 records why.
- **`docs/validation/d1.md` gets the new wire shapes** (`hv.terminal-*` inputs, the `hv.terminal` notify) in the same commit as Task 5, per the standing rule that new bridge shapes are documented there.
