# Pi 1.0 surfacing (round 27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A message typed mid-run always says what happened to it, a priced `generate_image` tool, a cost ledger that counts every request Pi bills, and Workflows off by default.

**Architecture:** Main stops guessing: every composer send goes to Pi with `streamingBehavior:"steer"`, and Pi's `disposition` answer (or its `success:false` refusal) drives the transcript. `clear_queue` backs a *Take back* control. The image tool is registered by the bridge only when main names a priced OpenRouter image model (`HV_IMAGE_MODEL`); main writes the file through a blocking envelope, exactly like memory and documents. The ledger (`calls.ts`) learns the three other shapes Pi's `getSessionStats` sums.

**Tech Stack:** Electron + React/TS renderer, Pi 1.0.2 over RPC (NDJSON), bridge extension in `pi-runtime/extensions/`, vitest (no DOM).

**Spec:** Notion "✨ Pi 1.0 — features worth surfacing in HappyVibe" (`3f0d33dfffca81e58f9bcde6f5ff3317`, sections A–D) and `docs/prd.md` — the five **Decision (Feedback round 27, 2026-10-08)** paragraphs in §7, §9, §13 (×2) and §19. Read both before starting.

## Global Constraints

- Pi pin stays `@earendil-works/pi-coding-agent@1.0.2`; nothing vendored is patched.
- Commits: `git commit -s`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test runs: never pipe to `tail`/`grep`. Use `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- Never run `npm run typecheck`, `npm run lint` or `npm run format`. Typecheck runs inside `npm run gate` (final task).
- Anything the renderer imports must not reach Node: `pi-runtime/extensions/hv-images.ts` and `src/main/providerError.ts` import NOTHING at runtime.
- The permission prompt shows facts, never the model's `intent` (`summarize()` strips it).
- Every fs writer is path-confined through `resolveInWorkspace` (`src/main/files.ts`).
- Main ALWAYS answers a blocking `hv.*` envelope, with an error string on failure, or the bridge hangs.
- The image tool offers ONLY image models with an input AND an output rate > 0 in Pi's catalogue — derived by `isPricedImageModel`, never hand-listed. 14 at Pi 1.0.2.
- Exact copy (tests pin these strings):
  - Take back button: `Take back`; its tooltip: `Puts every queued message back in the message box. Images attached to a queued message aren't kept.`
  - Refusal notices: see `describePromptRefusal` in Task 3.
  - Images row title: `Images — 1 tool`.
  - Ledger labels: `Image`, `Cache refresh`, `Compaction`, `Tool`.
- A screen whose behaviour or copy changes updates its guide page in the same commit, then the `docs-reviewer` agent runs on it (`.claude/rules/docs.md`).

## Review Focus

1. **A message the user typed is never silently lost.** A send that Pi refuses, queues, or starts on its own ends as exactly one of: a bubble, a chip, or text back in the box plus a notice. Pinned by `tests/send-outcome.test.ts` (Task 4) and `tests/prompt-outcome.test.ts` (Task 3).
2. **Take back while Pi delivers one of the queued messages at the same moment.** The delivered one becomes a bubble; only the ones Pi actually cleared go back to the box, whatever order the `queue_update` event and the `clear_queue` response arrive in. Pinned by the `takeCleared` tests (Task 5).
3. **Removing a taken-back bubble must not shift tool-card positions.** Live tool updates keep landing on the right card. Pinned by the `indexTools` test (Task 4).
4. **`generate_image` never overwrites a file and never writes outside the workspace.** Pinned by the `writeNewFile` tests (Task 7).
5. **A user who never touched Workflows gets it off; one who turned it on keeps it.** Pinned in `tests/workflows-default.test.ts` (Task 2).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/main/calls.ts` | ledger parses 3 more shapes, `kind` on a row | 1 |
| `src/renderer/src/components/CostPanel.tsx`, `src/renderer/src/hv.d.ts` | show the row's kind | 1 |
| `src/main/config.ts`, `src/main/pi/spawn.ts`, `pi-runtime/extensions/hv-builtins.ts` | Workflows default off | 2 |
| `src/renderer/src/components/BuiltinToolsBlock.tsx`, `BuiltinToolsView.tsx` | "on by default" copy | 2, 9 |
| `src/main/pi/promptOutcome.ts` (new) | pure: read Pi's prompt/clear answers | 3, 5 |
| `src/main/providerError.ts` | pure: `describePromptRefusal` | 3 |
| `src/main/activity.ts` | busy on `agent_start`, `isBusy`, `restoreBusy` | 3 |
| `src/main/snapshots.ts` | `discardSnapshot` | 3 |
| `src/main/ipc.ts` | promptSession reads disposition; `hv:clear-queue`; image settings + envelope | 3, 5, 7 |
| `src/renderer/src/sendOutcome.ts` (new) | pure: what the screen does with a send's answer | 4 |
| `src/renderer/src/streaming.ts` | `indexTools` (one rebuild, three callers) | 4 |
| `src/renderer/src/App.tsx` | send/refusal/take-back wiring | 4, 5 |
| `src/renderer/src/queue.ts` | pure: `takeCleared` | 5 |
| `src/renderer/src/components/ChatView.tsx` | Take back button, chip copy | 5 |
| `pi-runtime/extensions/hv-images.ts` (new) | pure: pricing rule, model choice, tool runner, envelope parse | 6, 8 |
| `tools/provider-catalog/build.ts` → `src/main/providerCatalog.generated.ts` | `IMAGE_MODELS` | 6 |
| `tools/image-cost-check.mjs` (new) + `docs/validation/im1.md` (new) | one paid cost check, a STOP gate | 7 |
| `src/main/files.ts` | `writeNewFile` (binary, no-clobber) | 7 |
| `pi-runtime/extensions/happyvibe-bridge.ts`, `hv-plan.ts` | register + gate `generate_image` | 8 |
| `src/renderer/src/components/PermissionModal.tsx`, `src/renderer/src/toolLabel.ts`, `src/renderer/src/toolSwitches.ts` | prompt panel, card label, all-off | 9 |
| guide pages, `docs/validation/d1.md`, `.claude/rules/pi-runtime.md`, `CLAUDE.md` | docs | 2, 5, 9, 10 |

---

### Task 0: Worktree setup

- [ ] **Step 1: Install both trees and link the key file**

```bash
cd /Users/guilhemduche/orca/workspaces/HappyVibe/surface_more
npm install && (cd pi-runtime && npm ci)
ln -s ~/Documents/Github/HappyVibe/.env .env
node -e "console.log(require('./pi-runtime/node_modules/@earendil-works/pi-coding-agent/package.json').version)"
```
Expected: last line prints `1.0.2`.

- [ ] **Step 2: Baseline suite**

Run: `L=/tmp/vitest.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`. If red, stop and report before changing anything.

---

### Task 1: The ledger counts every shape Pi bills (§19 round 27)

**Files:**
- Modify: `src/main/calls.ts` (types near line 121, `parseCalls` 182–245)
- Modify: `src/renderer/src/hv.d.ts:407-423` (`HvApiCall`)
- Modify: `src/renderer/src/components/CostPanel.tsx:257-265`
- Test: `tests/calls.test.ts`

**Interfaces:**
- Produces: `export type CallKind = "image" | "cache-refresh" | "compaction" | "tool"`; `ApiCall.kind?: CallKind`. `parseCalls` signature unchanged.
- Consumes: Task 8's tool result shape — `toolName: "generate_image"`, `usage`, `details: { provider: "openrouter", model: <id> }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/calls.test.ts`:

```ts
describe("round 27 — the three other shapes Pi's getSessionStats sums", () => {
  const usage = { input: 10, output: 1290, cacheRead: 0, cacheWrite: 0, totalTokens: 1300, cost: { input: 0.0000025, output: 0.001935, cacheRead: 0, cacheWrite: 0, total: 0.0019375 } };

  test("a tool result carrying usage is an Image row, named by its details", () => {
    const jsonl = [
      assistant(),
      line({ type: "message", message: { role: "toolResult", timestamp: 1785395100000, toolName: "generate_image", usage, details: { provider: "openrouter", model: "google/gemini-3.1-flash-lite-image" } } }),
    ].join("\n");
    const calls = parseCalls(jsonl);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ provider: "openrouter", model: "google/gemini-3.1-flash-lite-image", output: 1290, cost: 0.0019375, billing: "metered", kind: "image" });
  });

  test("a tool result WITHOUT usage is still skipped", () => {
    expect(parseCalls(line({ type: "message", message: { role: "toolResult", timestamp: 2, toolName: "read" } }))).toEqual([]);
  });

  test("a cache_warm usage entry is a Cache refresh row with an ISO timestamp", () => {
    const calls = parseCalls(line({ type: "usage", timestamp: "2026-10-08T10:00:00.000Z", kind: "cache_warm", provider: "anthropic", model: "claude-sonnet-4-5", usage }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ ts: "2026-10-08T10:00:00.000Z", provider: "anthropic", kind: "cache-refresh" });
  });

  test("a compaction entry with usage is a Compaction row, priced under the session's last model", () => {
    const jsonl = [assistant(), line({ type: "compaction", timestamp: "2026-10-08T11:00:00.000Z", summary: "…", usage })].join("\n");
    const calls = parseCalls(jsonl);
    expect(calls[1]).toMatchObject({ provider: "openrouter", model: "z-ai/glm-5.2", kind: "compaction" });
  });

  test("a pre-1.0 compaction entry (no usage) adds nothing", () => {
    expect(parseCalls(line({ type: "compaction", timestamp: "2026-07-05T00:00:00.000Z", summary: "…" }))).toEqual([]);
  });

  test("a plan provider's refresh is plan, not dollars", () => {
    const calls = parseCalls(line({ type: "usage", timestamp: "2026-10-08T10:00:00.000Z", kind: "cache_warm", provider: "openai-codex", model: "gpt-5.5", usage }));
    expect(calls[0].billing).toBe("plan");
  });
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/calls.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=1`; the new tests fail (`kind` undefined, length 1 instead of 2).

- [ ] **Step 3: Implement** — in `src/main/calls.ts`:

Add after `COST_COMPONENTS`:
```ts
/**
 * Round 27: what a row is when it is not the model answering. Pi 1.0's getSessionStats sums
 * these too; the ledger read only assistant messages, so the pill stopped agreeing with Pi.
 */
export type CallKind = "image" | "cache-refresh" | "compaction" | "tool";
```
Add to `ApiCall` after `agent?`:
```ts
  /** Absent for a model reply. Set for a tool's own spend, a cache refresh or a compaction summary. */
  kind?: CallKind;
```
Replace the loop head in `parseCalls` (from `let entry: …` through `const usage = …`) with:
```ts
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue; // torn tail or a line Pi wrote in a shape we don't know
    }
    const b = billedOf(entry, last);
    if (!b) continue;
    if (!b.kind) last = { provider: b.provider, model: b.model };
    const usage = b.usage;
```
Declare before the loop: `let last = { provider: "?", model: "?" };`. Then replace `m.provider`/`m.model`/`m.timestamp` reads with `b.provider`, `b.model`, `b.ts`, and add `...(b.kind ? { kind: b.kind } : {}),` to the pushed object. Add the helper above `parseCalls`:
```ts
const tsOf = (v: unknown): number => (typeof v === "string" ? Date.parse(v) || 0 : num(v));
const strOr = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

/**
 * The four shapes a Pi 1.0 session file bills in. A compaction entry names no model, so it is
 * priced under the session's last model — Pi summarises with the session model.
 * ponytail: an extension-driven compaction on another model would be mislabelled; Pi records
 * nothing better.
 */
function billedOf(
  entry: Record<string, unknown>,
  last: { provider: string; model: string },
): { ts: number; provider: string; model: string; usage: Record<string, unknown>; kind?: CallKind } | null {
  const m = entry.type === "message" ? (entry.message as Record<string, unknown> | undefined) : undefined;
  if (m?.role === "assistant") {
    return { ts: num(m.timestamp), provider: strOr(m.provider, "?"), model: strOr(m.model, "?"), usage: (m.usage ?? {}) as Record<string, unknown> };
  }
  if (m?.role === "toolResult" && m.usage) {
    const d = (m.details ?? {}) as Record<string, unknown>;
    return {
      ts: num(m.timestamp), provider: strOr(d.provider, "?"), model: strOr(d.model, strOr(m.toolName, "?")),
      usage: m.usage as Record<string, unknown>, kind: m.toolName === "generate_image" ? "image" : "tool",
    };
  }
  if (entry.type === "usage" && entry.usage) {
    return {
      ts: tsOf(entry.timestamp), provider: strOr(entry.provider, "?"), model: strOr(entry.model, "?"),
      usage: entry.usage as Record<string, unknown>, kind: entry.kind === "cache_warm" ? "cache-refresh" : "tool",
    };
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
    return { ts: tsOf(entry.timestamp), ...last, usage: entry.usage as Record<string, unknown>, kind: "compaction" };
  }
  return null;
}
```
Update the file's header comment: the entry-shape paragraph now lists the four shapes, and "user/toolResult messages are not billed calls" becomes "user messages, and tool results without `usage`, are skipped".

- [ ] **Step 4: Show the kind** — `src/renderer/src/hv.d.ts`, in `HvApiCall` after `agent?: string;`:
```ts
  /** Round 27: absent for a model reply. */
  kind?: "image" | "cache-refresh" | "compaction" | "tool";
```
`src/renderer/src/components/CostPanel.tsx` — above the component add:
```ts
/** Round 27: a row that is not the model answering says what it is (§19). */
export const CALL_KIND_LABEL: Record<NonNullable<HvApiCall["kind"]>, string> = {
  image: "Image", "cache-refresh": "Cache refresh", compaction: "Compaction", tool: "Tool",
};
```
and inside the model `<td>` after the `c.agent` span:
```tsx
{c.kind && <span className="block truncate text-[10px] text-ink-soft">{CALL_KIND_LABEL[c.kind]}</span>}
```

- [ ] **Step 5: Run the ledger tests — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/calls.test.ts tests/session-ledger.test.ts tests/cost-audit-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`.

- [ ] **Step 6: Guide** — `docs/guide/src/content/docs/session-view.md`, in the cost pill bullet (line ~56), add one sentence after the breakdown sentence: `A row that isn't the agent answering says what it is underneath: **Image** for a picture the agent made, **Cache refresh** when the provider's cache was kept warm, **Compaction** for the summary a compaction wrote.` Run the `docs-reviewer` agent on the page; fix every finding.

- [ ] **Step 7: Commit**

```bash
git add src/main/calls.ts src/renderer/src/hv.d.ts src/renderer/src/components/CostPanel.tsx tests/calls.test.ts docs/guide/src/content/docs/session-view.md
git commit -s -m "feat(cost): the ledger counts tool spend, cache refreshes and compaction summaries, so it agrees with Pi again" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Workflows off by default (§13 round 27)

**Files:**
- Modify: `src/main/config.ts:420` (`getBuiltinTools`)
- Modify: `src/main/pi/spawn.ts:171`
- Modify: `pi-runtime/extensions/hv-builtins.ts:108,123` (`parseBuiltins`)
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx:647` (subtitle), `src/renderer/src/components/BuiltinToolsView.tsx:36` (intro)
- Modify: `tests/hv-builtins.test.ts` (expected objects), `tests/tool-switches-spawn.test.ts:13` (fixture keeps `workflows: true`, no change needed)
- Create: `tests/workflows-default.test.ts`
- Modify: `docs/guide/src/content/docs/built-in-tools.md:16,89-91`

**Interfaces:**
- Produces: `getBuiltinTools().workflows` is `false` when the stored config has no `workflows` key.

- [ ] **Step 1: Write the failing test** — `tests/workflows-default.test.ts`:

```ts
/**
 * §13 round 27 — Workflows ships off. The switches store only what the user touched
 * (BuiltinToolsBlock sends partial patches), so an absent key is a user who never chose.
 * Key-free: pure fs + a mocked electron userData, like assistant-tasks.test.ts.
 */
import { beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-workflows-default-"));
  vi.resetModules();
});

test("a user who never touched the switch gets Workflows off", async () => {
  const { getBuiltinTools } = await import("../src/main/config");
  expect(getBuiltinTools().workflows).toBe(false);
});

test("a user who switched it on keeps it on", async () => {
  const { getBuiltinTools, setBuiltinTools } = await import("../src/main/config");
  setBuiltinTools({ workflows: true });
  expect(getBuiltinTools().workflows).toBe(true);
});

test("touching another switch does not turn Workflows on", async () => {
  const { getBuiltinTools, setBuiltinTools } = await import("../src/main/config");
  setBuiltinTools({ browser: false });
  expect(getBuiltinTools().workflows).toBe(false);
});

test("the bridge's own fallback agrees: no HV_BUILTINS, or a corrupt one, means off", () => {
  expect(parseBuiltins(undefined).workflows).toBe(false);
  expect(parseBuiltins("{not json").workflows).toBe(false);
  expect(parseBuiltins(JSON.stringify({ workflows: true })).workflows).toBe(true);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/workflows-default.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=1` (three tests expect `false`, get `true`).

- [ ] **Step 3: Implement**
- `src/main/config.ts:420`: `workflows: t?.workflows ?? true` → `workflows: t?.workflows ?? false` and add above the return: `// §13 round 27: Workflows ships off (≈5.5k tok/request); an absent key is a user who never chose.`
- `src/main/pi/spawn.ts:171`: `workflows: sw.workflows ?? true` → `workflows: sw.workflows ?? false`.
- `pi-runtime/extensions/hv-builtins.ts:108`: in the `out` literal, `workflows: true` → `workflows: false`; line 123 `if (p.workflows === false) out.workflows = false;` → `if (p.workflows === true) out.workflows = true;`.
- `tests/hv-builtins.test.ts`: in every `toEqual({...})` that spells out the full object (lines 6–29), change `workflows: true` to `workflows: false`.
- `BuiltinToolsBlock.tsx:647` subtitle: `All are on by default — turn any of them off if you don't want the agent to have it.` → `All are on by default except Workflows — turn any of them off if you don't want the agent to have it.`
- `BuiltinToolsView.tsx:36`: `Abilities HappyVibe gives the agent itself, on by default.` → `Abilities HappyVibe gives the agent itself, on by default except Workflows.`
- `WorkflowsRow` copy (`BuiltinToolsBlock.tsx:51-53`): append ` It is off until you turn it on.` after `…drops the cost.`

- [ ] **Step 4: Run — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/workflows-default.test.ts tests/hv-builtins.test.ts tests/tool-switches-spawn.test.ts tests/tool-switches-ui.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`.

- [ ] **Step 5: Guide** — `docs/guide/src/content/docs/built-in-tools.md`: update the quoted intro on line 16 to the new string exactly, and in `### Workflows — 1 tool` add after the first sentence: `It's off until you turn it on.` and quote the row's new sentence. Run `docs-reviewer`; fix findings.

- [ ] **Step 6: Commit**

```bash
git add src/main/config.ts src/main/pi/spawn.ts pi-runtime/extensions/hv-builtins.ts src/renderer/src/components/BuiltinToolsBlock.tsx src/renderer/src/components/BuiltinToolsView.tsx tests/workflows-default.test.ts tests/hv-builtins.test.ts docs/guide/src/content/docs/built-in-tools.md
git commit -s -m "feat(tools): Workflows ships off, saving ≈5.5k tokens on every request for users who never chose it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Main reads Pi's answer to a prompt (§7 round 27, points 1–3)

**Files:**
- Create: `src/main/pi/promptOutcome.ts`
- Modify: `src/main/providerError.ts` (add `describePromptRefusal`)
- Modify: `src/main/activity.ts` (busy on `agent_start`, `isBusy`, `restoreBusy`)
- Modify: `src/main/snapshots.ts` (add `discardSnapshot` after `stampSnapshot`, ~line 224)
- Modify: `src/main/ipc.ts` — `promptSession` (3552–3757): `wasBusy` before `activity.prompted` (3588), snapshot condition (3715), send + outcome (3735–3757)
- Test: `tests/prompt-outcome.test.ts` (new), `tests/provider-error.test.ts`, `tests/session-activity.test.ts`, `tests/snapshots.test.ts`

**Interfaces:**
- Produces: `promptOutcome(res: PiResponse): PromptOutcome` with `type PromptDisposition = "started" | "queued" | "handled"` and `type PromptOutcome = { ok: true; disposition: PromptDisposition } | { ok: false; error: string }`.
- Produces: `describePromptRefusal(raw: string): string`.
- Produces: IPC `hv:prompt-session` now resolves `{ warnings: string[]; disposition: PromptDisposition }`, and REJECTS with the refusal sentence when Pi refuses.
- Produces: `SessionActivity.isBusy(id): boolean`, `SessionActivity.restoreBusy(id, busy): void`; `discardSnapshot(root, sessionId, seq): void`.

- [ ] **Step 1: Write the failing tests**

`tests/prompt-outcome.test.ts`:
```ts
import { expect, test } from "vitest";
import { promptOutcome } from "../src/main/pi/promptOutcome";

const ok = (data?: unknown) => ({ type: "response" as const, command: "prompt", success: true, data });

test("Pi's disposition is read off the response (Pi 0.99+)", () => {
  expect(promptOutcome(ok({ disposition: "started" }))).toEqual({ ok: true, disposition: "started" });
  expect(promptOutcome(ok({ disposition: "queued" }))).toEqual({ ok: true, disposition: "queued" });
  expect(promptOutcome(ok({ disposition: "handled" }))).toEqual({ ok: true, disposition: "handled" });
});

test("a response without a disposition is a started turn (the pre-0.99 meaning)", () => {
  expect(promptOutcome(ok())).toEqual({ ok: true, disposition: "started" });
});

test("success:false is a refusal carrying Pi's text — never silently a success", () => {
  expect(promptOutcome({ type: "response", command: "prompt", success: false, error: "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry." }))
    .toEqual({ ok: false, error: "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry." });
  expect(promptOutcome({ type: "response", command: "prompt", success: false })).toEqual({ ok: false, error: "" });
});
```
Append to `tests/provider-error.test.ts`:
```ts
import { describePromptRefusal } from "../src/main/providerError";

describe("round 27 — a refused prompt, in the app's words", () => {
  test("compaction", () => {
    expect(describePromptRefusal("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry."))
      .toBe("The agent is compacting its context. Send your message again when it finishes.");
  });
  test("an expired sign-in never repeats Pi's /login advice", () => {
    const s = describePromptRefusal(`Authentication failed for "openrouter". Credentials may have expired or network is unavailable. Run '/login openrouter' to re-authenticate.`);
    expect(s).toBe("Your sign-in for openrouter has expired or can't be reached. Sign in again on Models, then send your message again.");
    expect(s).not.toContain("/login");
  });
  test("a missing key", () => {
    expect(describePromptRefusal("No API key found for deepseek.\n\nUse /login …")).toBe("There's no key or sign-in for deepseek. Add one on Models, then send your message again.");
  });
  test("no model", () => {
    expect(describePromptRefusal("No model selected.\n\n…\n\nThen use /model to select a model.")).toBe("This session has no model. Pick one in the model menu, then send your message again.");
  });
  test("anything else keeps only Pi's first line, and never an empty sentence", () => {
    expect(describePromptRefusal("Something odd\nRun /foo")).toBe("The agent didn't take your message (Something odd). Send it again.");
    expect(describePromptRefusal("")).toBe("The agent didn't take your message. Send it again.");
  });
});
```
(Add `describe` to the file's vitest import if missing.)

Append to `tests/session-activity.test.ts`:
```ts
test("round 27: a turn Pi starts on its own (async sub-agent result) is busy until agent_end", () => {
  const a = new SessionActivity();
  a.event("s", { type: "agent_start" });
  expect(a.isBusy("s")).toBe(true);
  expect(a.isIdle("s")).toBe(false);
  a.event("s", { type: "agent_end" });
  expect(a.isBusy("s")).toBe(false);
});

test("round 27: restoreBusy undoes prompted() for a prompt Pi refused or handled", () => {
  const a = new SessionActivity();
  a.prompted("s");
  a.restoreBusy("s", false);
  expect(a.isBusy("s")).toBe(false);
});
```
Append to `tests/snapshots.test.ts` (add `discardSnapshot` to its import from `../src/main/snapshots`; `ws` is the file's per-test workspace):
```ts
test("round 27: discardSnapshot drops exactly one record by seq", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snaproot-"));
  fs.writeFileSync(path.join(ws, "a.txt"), "one");
  captureSnapshot(root, "s1", [ws], ws, "pre", "2026-10-08T00:00:00.000Z");
  fs.writeFileSync(path.join(ws, "a.txt"), "two");
  captureSnapshot(root, "s1", [ws], ws, "pre", "2026-10-08T00:00:01.000Z");
  const before = listSnapshots(root, "s1");
  expect(before).toHaveLength(2);
  discardSnapshot(root, "s1", before[1].seq);
  expect(listSnapshots(root, "s1").map((r) => r.seq)).toEqual([before[0].seq]);
  discardSnapshot(root, "s1", 999); // an unknown seq changes nothing
  expect(listSnapshots(root, "s1")).toHaveLength(1);
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run — expect FAIL** (modules/functions missing)

Run: `L=/tmp/vitest.log; npx vitest run tests/prompt-outcome.test.ts tests/provider-error.test.ts tests/session-activity.test.ts tests/snapshots.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement the pure pieces**

`src/main/pi/promptOutcome.ts`:
```ts
/**
 * §7 round 27 — what Pi did with a message. Since Pi 0.99, `prompt`/`steer`/`follow_up`
 * answer with `data.disposition`; a refusal (a run already going, compaction running, an
 * expired sign-in) is `success:false`. PiClient resolves BOTH, so a caller that reads
 * neither drops the user's message silently — which is what promptSession used to do.
 */
import type { PiResponse } from "./types";

export type PromptDisposition = "started" | "queued" | "handled";
export type PromptOutcome = { ok: true; disposition: PromptDisposition } | { ok: false; error: string };

export function promptOutcome(res: PiResponse): PromptOutcome {
  if (res.success === false) return { ok: false, error: typeof res.error === "string" ? res.error : "" };
  const d = (res.data as { disposition?: unknown } | undefined)?.disposition;
  return { ok: true, disposition: d === "queued" || d === "handled" ? d : "started" };
}
```
`src/main/providerError.ts` (stays import-free) — add:
```ts
/**
 * §7 round 27 — Pi's refusal of a prompt, in the app's words. Pi writes for its terminal
 * ("Run '/login x'"), and a HappyVibe user has no such command, so only the first line of
 * an unknown refusal is kept.
 */
export function describePromptRefusal(raw: string): string {
  const t = raw.trim();
  if (/compaction is in progress/i.test(t)) return "The agent is compacting its context. Send your message again when it finishes.";
  const auth = /^Authentication failed for "([^"]+)"/i.exec(t);
  if (auth) return `Your sign-in for ${auth[1]} has expired or can't be reached. Sign in again on Models, then send your message again.`;
  const key = /^No API key found for ([^.\n]+)\./i.exec(t);
  if (key) return `There's no key or sign-in for ${key[1]}. Add one on Models, then send your message again.`;
  if (/^No model selected/i.test(t)) return "This session has no model. Pick one in the model menu, then send your message again.";
  const first = t.split("\n")[0]?.trim();
  return first ? `The agent didn't take your message (${first}). Send it again.` : "The agent didn't take your message. Send it again.";
}
```
`src/main/activity.ts` — in `event()`, before the `agent_end` branch add:
```ts
    if (e.type === "agent_start") a.busy = true; // round 27: a turn Pi starts itself (an async result) is busy too
```
(make the existing `if (e.type === "agent_end")` an `else if`), and add methods after `prompted`:
```ts
  /** Pi is mid-run: a prompt was sent or a turn started on its own, and agent_end not seen yet. */
  isBusy(id: string): boolean {
    return this.map.get(id)?.busy ?? false;
  }

  /** Round 27: a prompt Pi refused or handled as a command never started a run — undo `prompted`. */
  restoreBusy(id: string, busy: boolean): void {
    const a = this.map.get(id);
    if (a) a.busy = busy;
  }
```
`src/main/snapshots.ts` — after `stampSnapshot`:
```ts
/**
 * Round 27: drop one record by seq. A "pre" captured for a message Pi then QUEUED was taken
 * mid-turn — left in place, the running turn's next tool call would stamp it as its anchor,
 * and a rewind would restore torn content. Blobs are left to pruneSnapshots.
 */
export function discardSnapshot(root: string, sessionId: string, seq: number): void {
  assertSessionId(sessionId);
  const records = listSnapshots(root, sessionId);
  const kept = records.filter((r) => r.seq !== seq);
  if (kept.length !== records.length) writeRecords(root, sessionId, kept);
}
```

- [ ] **Step 4: Run — expect PASS**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 5: Wire `promptSession`** (`src/main/ipc.ts`)

Imports: `promptOutcome, type PromptDisposition` from `./pi/promptOutcome`, `describePromptRefusal` from `./providerError` (check the existing import line first), `discardSnapshot` from `./snapshots`.

1. Line 3588, replace `activity.prompted(sessionId);` with:
```ts
    // Round 27: what main knew BEFORE this prompt. agent_start now marks busy too, so a turn Pi
    // started on its own (an async sub-agent result) counts — the renderer's flag can't see it yet.
    const wasBusy = activity.isBusy(sessionId);
    activity.prompted(sessionId);
```
2. The snapshot block (3715): change `if (behavior !== "steer" && meta?.workspaceId) {` to `let snap: { seq: number } | null = null;` followed by `if (!wasBusy && meta?.workspaceId) {` and assign `snap = captureSnapshot(…)`. Rewrite the comment above it: snapshots follow main's own busy knowledge, not the renderer's guess, and one taken for a message Pi then queues is discarded below.
3. Line 3735: `if (!turns.isBusy(sessionId) && startsTurn(msg)) turns.start(sessionId, bySchedule);` → 
```ts
    const startedHere = !turns.isBusy(sessionId) && startsTurn(msg);
    if (startedHere) turns.start(sessionId, bySchedule);
```
4. Replace the `try { await client.send(…) } catch …` block and `return { warnings };` with:
```ts
    // Round 27: never a refusal for "already processing" — Pi ignores streamingBehavior when idle,
    // and its disposition says what it did. A schedule's follow-up keeps its own behavior.
    const undo = (): void => {
      if (startedHere) turns.discard(sessionId);
      if (snap) discardSnapshot(snapshotDir(), sessionId, snap.seq);
    };
    let out;
    try {
      out = promptOutcome(await client.send(promptCommand(outgoing, behavior ?? "steer", images)));
    } catch (err) {
      undo();
      activity.restoreBusy(sessionId, wasBusy);
      throw err;
    }
    if (!out.ok) {
      undo();
      activity.restoreBusy(sessionId, wasBusy);
      throw new Error(describePromptRefusal(out.error));
    }
    if (out.disposition === "queued") undo(); // it joins the running turn: no turn of its own, and its snapshot was mid-turn
    if (out.disposition === "handled") { undo(); activity.restoreBusy(sessionId, wasBusy); } // a command — no run started
    // The composer guessed "busy" and sent a steer, but Pi started a turn: nothing has drawn the bubble.
    if (behavior === "steer" && out.disposition === "started" && !bySchedule) send("hv:session-prompted", { sessionId, text: msg });
    return { warnings, disposition: out.disposition };
```
Update the function's return type to `Promise<{ warnings: string[]; disposition: PromptDisposition }>`.

- [ ] **Step 6: Run the main-side suites — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/prompt-outcome.test.ts tests/provider-error.test.ts tests/session-activity.test.ts tests/snapshots.test.ts tests/steering.test.ts tests/piclient.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/main/pi/promptOutcome.ts src/main/providerError.ts src/main/activity.ts src/main/snapshots.ts src/main/ipc.ts tests/prompt-outcome.test.ts tests/provider-error.test.ts tests/session-activity.test.ts tests/snapshots.test.ts
git commit -s -m "fix(chat): a prompt Pi refuses is no longer dropped silently — main reads Pi's answer and its disposition" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The composer shows what Pi did (§7 round 27, renderer)

**Files:**
- Create: `src/renderer/src/sendOutcome.ts`
- Modify: `src/renderer/src/streaming.ts` (add `indexTools`)
- Modify: `src/renderer/src/App.tsx` — `send` (2776–2838), the two inline index rebuilds (789–794, 2750–2755), add `removeSent` + `refused` next to `appendItem` (658)
- Modify: `src/renderer/src/components/Transcript.tsx:63` (user item gets `sendId?: number`)
- Modify: `src/renderer/src/hv.d.ts:829-840` and `src/preload/index.ts:156` (return type only)
- Test: `tests/send-outcome.test.ts` (new), `tests/streaming.test.ts` (add `indexTools` to its import from `../src/renderer/src/streaming`)

**Interfaces:**
- Consumes: Task 3's `{ warnings, disposition }` and the rejection sentence.
- Produces: `sendOutcome(guessedBusy: boolean, r: { disposition: "started" | "queued" | "handled" }): { removeBubble: boolean; idle: boolean }`; `indexTools(items: TranscriptItem[]): Map<string, number>`.

- [ ] **Step 1: Write the failing tests**

`tests/send-outcome.test.ts`:
```ts
import { expect, test } from "vitest";
import { sendOutcome } from "../src/renderer/src/sendOutcome";

// The composer draws a bubble at once when it thinks the agent is idle (the answer can take
// seconds — Pi may compact first), and nothing when it thinks the agent is busy (a chip comes).
test("idle guess, Pi started it: the bubble stays", () => {
  expect(sendOutcome(false, { disposition: "started" })).toEqual({ removeBubble: false, idle: false });
});
test("idle guess, Pi queued it: the bubble goes — the chip, then the delivery, draw it", () => {
  expect(sendOutcome(false, { disposition: "queued" })).toEqual({ removeBubble: true, idle: false });
});
test("a command Pi handled started no run: the session is idle again", () => {
  expect(sendOutcome(false, { disposition: "handled" })).toEqual({ removeBubble: false, idle: true });
});
test("busy guess never had a bubble to remove (main draws one on started)", () => {
  for (const d of ["started", "queued"] as const) expect(sendOutcome(true, { disposition: d }).removeBubble).toBe(false);
});
```
And in the file that tests `streaming.ts`:
```ts
test("round 27: indexTools maps every tool card to its CURRENT position", () => {
  const items = [
    { kind: "user", text: "a" },
    { kind: "tool", card: { toolCallId: "t1" } },
    { kind: "assistant", text: "b" },
    { kind: "tool", card: { toolCallId: "t2" } },
  ] as never[];
  expect([...indexTools(items)]).toEqual([["t1", 1], ["t2", 3]]);
  expect([...indexTools(items.slice(1))]).toEqual([["t1", 0], ["t2", 2]]); // a removed bubble shifts every card
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/send-outcome.test.ts tests/streaming.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement**

`src/renderer/src/sendOutcome.ts`:
```ts
/**
 * §7 round 27 — what the screen does once Pi says what it did with a message.
 * Pure, so the rule is pinned without a DOM (tests/send-outcome.test.ts).
 */
export function sendOutcome(
  guessedBusy: boolean,
  r: { disposition: "started" | "queued" | "handled" },
): { removeBubble: boolean; idle: boolean } {
  return {
    // Only an idle guess drew a bubble; a queued message is drawn by its chip, then its delivery.
    removeBubble: !guessedBusy && r.disposition === "queued",
    // A command (extension) took it: no agent_end will ever come to clear the busy dots.
    idle: r.disposition === "handled",
  };
}
```
`src/renderer/src/streaming.ts`:
```ts
/** Every tool card's position. Rebuilt whenever items move — a stale entry patches the wrong card. */
export function indexTools(items: TranscriptItem[]): Map<string, number> {
  const map = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind === "tool") map.set(it.card.toolCallId, i);
  });
  return map;
}
```
Replace both inline rebuilds in `App.tsx` (789–794 and 2750–2755) with `toolIndex.current[sid] = indexTools(next);` / `toolIndex.current[id] = indexTools(merged);`.

`Transcript.tsx:63` — in the `user` member of `TranscriptItem` add `sendId?: number;` with a one-line comment (round 27: the send that drew it, so a queued or refused send can take it back).

`App.tsx` — next to `appendItem`:
```ts
  const sendSeq = useRef(0);
  /** Round 27: take back the bubble a send drew, and re-index — removal shifts every tool card. */
  const removeSent = (sid: string, sendId: number): void =>
    setTranscripts((p) => {
      const next = (p[sid] ?? []).filter((it) => !(it.kind === "user" && it.sendId === sendId));
      toolIndex.current[sid] = indexTools(next);
      return { ...p, [sid]: next };
    });
  /** Round 27: Pi (or main) refused the message — say why and give the words back. */
  const refused = (sid: string, msg: string, err: unknown, sendId?: number): void => {
    if (sendId !== undefined) removeSent(sid, sendId);
    appendItem(sid, { kind: "notice", text: ipcMessage(err) });
    setComposerInsert((prev) => ({ sid, text: stripInjectedBlocks(msg), nonce: (prev?.nonce ?? 0) + 1 }));
  };
```
(`stripInjectedBlocks` from `./mentions`; `ipcMessage` is already imported for `surface`.)

In `send`: busy branch — `catch (err) { surface(err); }` → `catch (err) { refused(sid, msg, err); }`, and rewrite its comment: a steer Pi started as a turn is drawn by main's `hv:session-prompted`. Idle branch — before `appendItem` add `const sendId = ++sendSeq.current;` and pass `sendId` in the user item; replace the try/catch with:
```ts
    try {
      const { warnings, disposition } = await window.hv.promptSession(sid, msg, undefined, images, mentions, openFiles, documentPaths);
      const o = sendOutcome(false, { disposition });
      if (o.removeBubble) removeSent(sid, sendId);
      if (o.idle) setBusy((p) => ({ ...p, [sid]: false }));
      noteWarnings(warnings);
      if (usage) trackUi("prompt_sent", usage);
    } catch (err) {
      setBusy((p) => ({ ...p, [sid]: false }));
      refused(sid, msg, err, sendId);
    }
```
`hv.d.ts:840` and the preload binding: return type `Promise<{ warnings: string[]; disposition: "started" | "queued" | "handled" }>`.

- [ ] **Step 4: Run — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/send-outcome.test.ts tests/streaming.test.ts tests/restore.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/sendOutcome.ts src/renderer/src/streaming.ts src/renderer/src/App.tsx src/renderer/src/components/Transcript.tsx src/renderer/src/hv.d.ts src/preload/index.ts tests/send-outcome.test.ts tests/streaming.test.ts
git commit -s -m "fix(chat): a queued, refused or command message draws what Pi actually did, and refused words go back in the box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Take back queued messages (§7 round 27, point 4)

**Files:**
- Modify: `src/main/pi/promptOutcome.ts` (add `clearedTexts`)
- Modify: `src/main/ipc.ts` (new `hv:clear-queue` handler, beside `hv:abort-session` ~3784)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts` (`clearQueue`)
- Modify: `src/renderer/src/queue.ts` (add `takeCleared`)
- Modify: `src/renderer/src/App.tsx` (queue_update handler 1822–1833, take-back handler, ChatView prop)
- Modify: `src/renderer/src/components/ChatView.tsx:1588-1612` (button, chip text, tooltips)
- Test: `tests/steering.test.ts` (queue tests live here), `tests/prompt-outcome.test.ts`, new `tests/take-back-copy.test.ts`
- Docs: `docs/guide/src/content/docs/first-session.md:70-72`, `session-view.md:136`, `.claude/rules/pi-runtime.md` (the `clear_queue` line)

**Interfaces:**
- Produces: IPC `hv:clear-queue(sessionId) → { steering: string[]; followUp: string[] }`; `clearedTexts(res: PiResponse): { steering: string[]; followUp: string[] }`; `takeCleared(left: string[], owed: string[]): { delivered: string[]; owed: string[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/steering.test.ts`:
```ts
import { takeCleared } from "../src/renderer/src/queue";

// Round 27: Pi announces clear_queue with an ordinary queue_update, so a text that left the
// queue was either DELIVERED (transcript) or CLEARED (back to the box). The clear_queue answer
// names exactly what it cleared; the event and the answer can arrive in either order.
test("takeCleared: what Pi cleared is consumed, the rest was delivered", () => {
  expect(takeCleared(["a", "b"], ["b"])).toEqual({ delivered: ["a"], owed: [] });
});
test("takeCleared: the same text queued twice is a multiset, not a set", () => {
  expect(takeCleared(["a", "a"], ["a"])).toEqual({ delivered: ["a"], owed: [] });
});
test("takeCleared: an answer that arrives BEFORE its event leaves the texts owed", () => {
  expect(takeCleared([], ["a", "b"])).toEqual({ delivered: [], owed: ["a", "b"] });
  expect(takeCleared(["a", "b"], ["a", "b"])).toEqual({ delivered: [], owed: [] });
});
```
Append to `tests/prompt-outcome.test.ts`:
```ts
import { clearedTexts } from "../src/main/pi/promptOutcome";
test("clearedTexts reads clear_queue's answer and drops anything that isn't text", () => {
  expect(clearedTexts({ type: "response", command: "clear_queue", success: true, data: { steering: ["a", 3], followUp: ["b"] } }))
    .toEqual({ steering: ["a"], followUp: ["b"] });
  expect(clearedTexts({ type: "response", command: "clear_queue", success: false })).toEqual({ steering: [], followUp: [] });
});
```
`tests/take-back-copy.test.ts`:
```ts
import fs from "node:fs";
import { expect, test } from "vitest";
const chat = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
test("the queued row offers Take back, and stops claiming Pi can't unqueue", () => {
  expect(chat).toContain(">Take back<");
  expect(chat).toContain("Puts every queued message back in the message box. Images attached to a queued message aren't kept.");
  expect(chat).not.toContain("Pi can't unqueue messages yet");
});
test("chips show what the user typed, not the hidden @file blocks Pi stores with it", () => {
  expect(chat).toMatch(/↪ \{stripInjectedBlocks\(m\)\}/);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/steering.test.ts tests/prompt-outcome.test.ts tests/take-back-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement the pure pieces**

`src/main/pi/promptOutcome.ts`:
```ts
/** Pi's clear_queue answer: exactly the texts it removed. Anything else is not ours to return. */
export function clearedTexts(res: PiResponse): { steering: string[]; followUp: string[] } {
  const d = (res.success === false ? {} : res.data ?? {}) as { steering?: unknown; followUp?: unknown };
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { steering: strs(d.steering), followUp: strs(d.followUp) };
}
```
`src/renderer/src/queue.ts`:
```ts
/**
 * Round 27 — split the texts that left the queue into delivered and cleared. `owed` is what
 * clear_queue said it removed and has not been matched to a queue_update yet. Multiset: the
 * same message can be queued twice.
 */
export function takeCleared(left: string[], owed: string[]): { delivered: string[]; owed: string[] } {
  const rest = [...owed];
  const delivered = left.filter((t) => {
    const i = rest.indexOf(t);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
  return { delivered, owed: rest };
}
```

- [ ] **Step 4: Main IPC** (`src/main/ipc.ts`, beside `hv:abort-session`):
```ts
  // §7 round 27: take every queued message back. Pi's answer names exactly what it cleared,
  // which is how the renderer tells a cleared text from one Pi delivered at the same moment.
  ipcMain.handle("hv:clear-queue", async (_e, sessionId: string) => {
    const client = manager.get(sessionId) as PiClient | null;
    if (!client) return { steering: [], followUp: [] };
    return clearedTexts(await client.send({ type: "clear_queue" }));
  });
```
Preload: `clearQueue: (sessionId: string) => ipcRenderer.invoke("hv:clear-queue", sessionId),`. `hv.d.ts`: `clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }>;`.

- [ ] **Step 5: Renderer wiring** (`App.tsx`)

Add `const clearing = useRef<Record<string, { inFlight: boolean; held: string[]; owed: string[] }>>({});`. In the `queue_update` branch, replace `for (const text of delivered) {…}` with:
```ts
        const c = clearing.current[sid];
        let landed = delivered;
        if (c?.inFlight) {
          c.held.push(...delivered); // undecided until clear_queue answers
          landed = [];
        } else if (c?.owed.length) {
          const t = takeCleared(delivered, c.owed);
          c.owed = t.owed;
          landed = t.delivered;
        }
        for (const text of landed) {
          commitStream(sid);
          appendItem(sid, { kind: "user", text, ts: Date.now() });
        }
```
Add the handler (beside `send`):
```ts
  /** §7 round 27: Take back — every queued message returns to the box; a delivered one stays a bubble. */
  const takeBackQueue = async (sid: string): Promise<void> => {
    clearing.current[sid] = { inFlight: true, held: [], owed: [] };
    try {
      const r = await window.hv.clearQueue(sid);
      const cleared = [...r.steering, ...r.followUp];
      const c = clearing.current[sid];
      const t = takeCleared(c.held, cleared);
      clearing.current[sid] = { inFlight: false, held: [], owed: t.owed };
      for (const text of t.delivered) appendItem(sid, { kind: "user", text, ts: Date.now() });
      if (cleared.length) {
        setComposerInsert((prev) => ({ sid, text: cleared.map(stripInjectedBlocks).join("\n\n"), nonce: (prev?.nonce ?? 0) + 1 }));
      }
    } catch (err) {
      const held = clearing.current[sid]?.held ?? [];
      clearing.current[sid] = { inFlight: false, held: [], owed: [] };
      for (const text of held) appendItem(sid, { kind: "user", text, ts: Date.now() }); // Pi cleared nothing we know of
      surface(err);
    }
  };
```
Pass `onTakeBackQueue={() => void takeBackQueue(sid)}` to `ChatView` next to `onSend`. (`composerInsert` inserts at the caret — `composerText.ts`, the rule *Send to chat* uses.)

- [ ] **Step 6: The control** (`ChatView.tsx`): add prop `onTakeBackQueue?: () => void;` to the props interface. In the queued row (~1588):
  - label span `title`: `Queued messages are kept even if you press Stop.`
  - after the label span:
```tsx
            {onTakeBackQueue && (
              <button
                type="button"
                onClick={onTakeBackQueue}
                title="Puts every queued message back in the message box. Images attached to a queued message aren't kept."
                className="rounded-full border-2 border-line bg-card px-2.5 py-0.5 text-xs font-bold hover:border-ink cursor-pointer"
              >Take back</button>
            )}
```
  - chips: `↪ {m}` → `↪ {stripInjectedBlocks(m)}`, `⏭ {m}` → `⏭ {stripInjectedBlocks(m)}`; tooltips: `Queued — delivered between tool calls: ${stripInjectedBlocks(m)}…` and `Queued — runs after this turn: ${stripInjectedBlocks(m)}…` (drop "Pi can't unqueue messages yet." from both). Import `stripInjectedBlocks` from `../mentions` if not already.

- [ ] **Step 7: Run — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/steering.test.ts tests/prompt-outcome.test.ts tests/take-back-copy.test.ts tests/steer-mentions.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`.

- [ ] **Step 8: Docs**
  - `first-session.md` after line 70: `Changed your mind? Click **Take back** beside "queued · kept on stop": every queued message goes back into the message box. Images attached to a queued message aren't kept.`
  - `session-view.md:136`: append `, with **Take back** to put them all back in the message box` to the queued-messages bullet.
  - `.claude/rules/pi-runtime.md`: replace the `clear_queue` bullet with: `` - **`clear_queue` backs the composer's *Take back*** (§7 round 27). It announces itself with an ordinary `queue_update`, so the renderer splits "left the queue" into delivered vs cleared with the RPC answer (`takeCleared`, `queue.ts`). Every composer send carries `streamingBehavior:"steer"` and main reads `disposition` (`promptOutcome.ts`); `PiClient.send` resolves `success:false` too, so a caller that ignores it drops the message. ``
  - Run `docs-reviewer` on both guide pages; fix findings.

- [ ] **Step 9: Commit**

```bash
git add src/main/pi/promptOutcome.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/queue.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx tests/steering.test.ts tests/prompt-outcome.test.ts tests/take-back-copy.test.ts docs/guide/src/content/docs/first-session.md docs/guide/src/content/docs/session-view.md .claude/rules/pi-runtime.md
git commit -s -m "feat(chat): Take back puts every queued message back in the box (Pi's clear_queue)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The priced image models, derived from Pi's catalogue (§13 round 27)

**Files:**
- Create: `pi-runtime/extensions/hv-images.ts` (import-free)
- Modify: `tools/provider-catalog/build.ts` (emit `IMAGE_MODELS`)
- Regenerate: `src/main/providerCatalog.generated.ts` (`npm run catalog:providers`)
- Test: `tests/hv-images.test.ts` (new), `tests/provider-catalog.test.ts`

**Interfaces:**
- Produces (hv-images.ts): `IMAGE_TOOL = "generate_image"`; `interface ImageModelInfo { id: string; name: string; input: number; output: number }`; `isPricedImageModel(m: { cost?: { input?: number; output?: number } }): boolean`; `byPrice(a, b): number`; `resolveImageModel(models: readonly ImageModelInfo[], stored: string | undefined): string | null`.
- Produces (generated): `IMAGE_MODELS: readonly ImageModelInfo[]`, cheapest first.

- [ ] **Step 1: Write the failing tests** — `tests/hv-images.test.ts`:
```ts
import { expect, test } from "vitest";
import { byPrice, isPricedImageModel, resolveImageModel, type ImageModelInfo } from "../pi-runtime/extensions/hv-images";

test("priced means BOTH rates above zero — an input-only or $0 model would read as free", () => {
  expect(isPricedImageModel({ cost: { input: 0.3, output: 2.5 } })).toBe(true);
  expect(isPricedImageModel({ cost: { input: 5, output: 0 } })).toBe(false);      // microsoft/mai-image-*
  expect(isPricedImageModel({ cost: { input: 0, output: 0 } })).toBe(false);      // FLUX, Recraft, …
  expect(isPricedImageModel({ cost: { input: -1e6, output: -1e6 } })).toBe(false); // openrouter/auto
  expect(isPricedImageModel({})).toBe(false);
});

const m = (id: string, input: number, output: number): ImageModelInfo => ({ id, name: id, input, output });

test("cheapest first: output rate, then input, then id", () => {
  expect([m("b", 2, 3), m("a", 0.25, 1.5), m("c", 0.5, 3)].sort(byPrice).map((x) => x.id)).toEqual(["a", "c", "b"]);
});

test("the stored model wins only while it is still priced; otherwise the cheapest; never invented", () => {
  const list = [m("cheap", 0.25, 1.5), m("pro", 2, 12)];
  expect(resolveImageModel(list, "pro")).toBe("pro");
  expect(resolveImageModel(list, "gone/after-a-bump")).toBe("cheap");
  expect(resolveImageModel(list, undefined)).toBe("cheap");
  expect(resolveImageModel([], "pro")).toBeNull();
});
```
Append to `tests/provider-catalog.test.ts` inside the `describe.skipIf(!HAVE_RUNTIME)` block (add `IMAGE_MODELS` to the generated import and `byPrice, isPricedImageModel` from `../pi-runtime/extensions/hv-images`):
```ts
  test("IMAGE_MODELS is exactly the OpenRouter image models Pi fully prices, cheapest first", async () => {
    const mod = (await import(PI_AI_PROVIDERS)) as { getBuiltinImageModels: (p: string) => Array<{ id: string; name?: string; cost?: { input?: number; output?: number } }> };
    const want = mod.getBuiltinImageModels("openrouter").filter(isPricedImageModel)
      .map((x) => ({ id: x.id, name: x.name ?? x.id, input: x.cost!.input!, output: x.cost!.output! })).sort(byPrice);
    expect(IMAGE_MODELS).toEqual(want);
  });

  test("only OpenRouter ships image models — a second provider is a product decision, not drift", async () => {
    const mod = (await import(PI_AI_PROVIDERS)) as { getBuiltinImageModels: (p: string) => unknown[] };
    for (const p of await upstream()) {
      if (p.id === "openrouter") continue;
      expect(mod.getBuiltinImageModels(p.id), `${p.id} now ships image models`).toHaveLength(0);
    }
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/hv-images.test.ts tests/provider-catalog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement** — `pi-runtime/extensions/hv-images.ts`:
```ts
/**
 * §13 round 27 — generate_image. Pure and IMPORT-FREE: the bridge, main, the renderer and the
 * provider-catalog generator all read it, and the renderer must never reach Node.
 */
export const IMAGE_TOOL = "generate_image";

export interface ImageModelInfo { id: string; name: string; input: number; output: number }

/**
 * Pi prices an image call from its catalogue (pi-ai api/openrouter-images.js), not from what
 * OpenRouter charges. Only a model with BOTH rates can show a real cost; at Pi 1.0.2, 39 of
 * the 59 are $0 there (billed per image) and would read as free — §19 ruling 3 forbids that.
 */
export function isPricedImageModel(m: { cost?: { input?: number; output?: number } }): boolean {
  const i = m.cost?.input;
  const o = m.cost?.output;
  return typeof i === "number" && typeof o === "number" && i > 0 && o > 0;
}

/** Cheapest first: the output rate (an image is billed as output), then input, then id. */
export function byPrice(a: ImageModelInfo, b: ImageModelInfo): number {
  return a.output - b.output || a.input - b.input || a.id.localeCompare(b.id);
}

/** The session's model: the user's choice while it is still priced, else the cheapest. Never invented. */
export function resolveImageModel(models: readonly ImageModelInfo[], stored: string | undefined): string | null {
  if (stored && models.some((m) => m.id === stored)) return stored;
  return [...models].sort(byPrice)[0]?.id ?? null;
}
```
`tools/provider-catalog/build.ts`: import `{ byPrice, isPricedImageModel }` from `"../../pi-runtime/extensions/hv-images.ts"`. In `main()` after `builtinProviders` is loaded:
```ts
  const { getBuiltinImageModels } = (await import(PI_AI_PROVIDERS)) as {
    getBuiltinImageModels: (p: string) => Array<{ id: string; name?: string; cost?: { input?: number; output?: number } }>;
  };
  // §13 round 27: Pi lists image models only under OpenRouter (the contract test fails if that changes).
  const imageModels = getBuiltinImageModels("openrouter").filter(isPricedImageModel)
    .map((m) => ({ id: m.id, name: m.name ?? m.id, input: m.cost!.input!, output: m.cost!.output! }))
    .sort(byPrice);
```
In the emitted template, add after the header comment: `import type { ImageModelInfo } from "../../pi-runtime/extensions/hv-images";` and after `REGISTRY_MODELS`:
```ts
/** §13 round 27: OpenRouter image models Pi fully prices (hv-images.ts isPricedImageModel), cheapest first. */
export const IMAGE_MODELS: readonly ImageModelInfo[] = ${JSON.stringify(imageModels, null, 2)};
```
and a log line: `console.log(\`priced image models: ${imageModels.length}\`);`

- [ ] **Step 4: Generate and run — expect PASS**

```bash
npm run catalog:providers
grep -c '"id": "google/\|"id": "openai/' src/main/providerCatalog.generated.ts
```
Expected: the generator prints `priced image models: 14`. Then:
Run: `L=/tmp/vitest.log; npx vitest run tests/hv-images.test.ts tests/provider-catalog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → `EXIT=0`.

- [ ] **Step 5: CLAUDE.md** — in "Import hygiene", add `hv-images.ts` to the list of files that import nothing.

- [ ] **Step 6: Commit**

```bash
git add pi-runtime/extensions/hv-images.ts tools/provider-catalog/build.ts src/main/providerCatalog.generated.ts tests/hv-images.test.ts tests/provider-catalog.test.ts CLAUDE.md
git commit -s -m "feat(images): the priced OpenRouter image models, derived from Pi's catalogue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: STOP GATE — one paid call checks Pi's image price (§19 round 27)

The spec says the round stops if Pi's estimate is far from what OpenRouter charges. Do this before building the tool.

**Files:**
- Create: `tools/image-cost-check.mjs`, `docs/validation/im1.md`

- [ ] **Step 1: Write the script** — `tools/image-cost-check.mjs`:
```js
// §19 round 27 — ONE paid image call: Pi's catalogue estimate vs OpenRouter's own charge.
// Run on a pin bump that changes image prices. Costs a few cents.
//   set -a; . ./.env; set +a; node tools/image-cost-check.mjs [model-id]
import path from "node:path";
import { pathToFileURL } from "node:url";

const PA = path.resolve("pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
const { getBuiltinImageModels } = await import(pathToFileURL(path.join(PA, "providers/all.js")).href);
const { generateImages } = await import(pathToFileURL(path.join(PA, "images.js")).href);
const key = process.env.OPENROUTER_API_KEY;
if (!key || key.startsWith("sk-REPLACE")) throw new Error("OPENROUTER_API_KEY is not set");
const id = process.argv[2] ?? "google/gemini-3.1-flash-lite-image";
const model = getBuiltinImageModels("openrouter").find((m) => m.id === id);
if (!model) throw new Error(`${id} is not in Pi's catalogue`);
const r = await generateImages(model, { input: [{ type: "text", text: "A flat app icon of a smiling sun, simple shapes." }] }, { apiKey: key });
console.log({ stopReason: r.stopReason, error: r.errorMessage, responseId: r.responseId, usage: r.usage });
await new Promise((res) => setTimeout(res, 5000)); // OpenRouter's generation stats lag a few seconds
const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${r.responseId}`, { headers: { Authorization: `Bearer ${key}` } })).json();
const charged = g?.data?.total_cost;
const estimate = r.usage?.cost?.total;
console.log({ model: id, piEstimate: estimate, openrouterCharged: charged, ratio: charged ? estimate / charged : null });
```

- [ ] **Step 2: Run it for the default and the most popular model**

```bash
set -a; . ./.env; set +a
node tools/image-cost-check.mjs google/gemini-3.1-flash-lite-image
node tools/image-cost-check.mjs google/gemini-2.5-flash-image
```
Expected: two result objects with `piEstimate`, `openrouterCharged` and `ratio`.

- [ ] **Step 3: Record and decide** — write `docs/validation/im1.md` with the date, Pi pin, both commands, the full outputs and one verdict line.
  - **Both ratios between 0.5 and 2:** the estimate is close enough. Continue to Task 8.
  - **Otherwise: STOP.** Commit the validation doc, report both numbers to the user and wait. (The answer may be spec option C, asking OpenRouter for the real charge after each image, which is a new decision.)

- [ ] **Step 4: Commit**

```bash
git add tools/image-cost-check.mjs docs/validation/im1.md
git commit -s -m "docs(validation): one paid image call — Pi's image price estimate against OpenRouter's charge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `generate_image` in the bridge, written by main (§13 round 27)

**Files:**
- Modify: `pi-runtime/extensions/hv-images.ts` (add `IMAGE_TOOL_DESCRIPTION`, `runImageTool`, `parseImageSave`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (register after the Documents block ~2114; `summarize()` arm ~line 85)
- Modify: `pi-runtime/extensions/hv-plan.ts:177` (`BLOCKED_PLAN_TOOLS` gets `generate_image`; read-only runs reuse it via `gateReadonlyCall`)
- Modify: `src/main/files.ts` (add `writeNewFile`)
- Modify: `src/main/config.ts` (`images` in `builtinTools`, default true; `imageModel` get/set)
- Modify: `src/main/pi/spawn.ts` (option `imageModel` → `HV_IMAGE_MODEL`)
- Modify: `src/main/ipc.ts` (spawnOpts ~1066; envelope handler beside the document one ~2269; `hv:image-settings` and `hv:image-model-set`)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts` (`imageSettings`, `imageModelSet`; `images` in builtinsGet/Set types)
- Test: `tests/hv-images.test.ts`, `tests/files.test.ts`, `tests/tool-switches-spawn.test.ts`, `tests/how-it-works.test.ts` (runs unchanged), new live `tests/image-bridge.test.ts`

**Interfaces:**
- Consumes: Task 6's `IMAGE_TOOL`, `resolveImageModel`, `IMAGE_MODELS`.
- Produces: env `HV_IMAGE_MODEL=<id>`, set only when `images` is on AND an OpenRouter key or sign-in exists. Its absence means the tool is not registered.
- Produces: envelope `{"kind":"hv.image-save","path":string,"mimeType":string,"data":base64,"model":string}` on `ui.input` `title`. Main replies `{"ok":true,"path":rel}` or `{"ok":false,"error":string}`.
- Produces: tool result `{ content: [{type:"text"}, {type:"image",data,mimeType}], details: { provider: "openrouter", model, path }, usage }`. Task 1's ledger reads `details` + `usage`.
- Produces: IPC `hv:image-settings → { available: boolean; model: string | null; models: ImageModelInfo[] }`, `hv:image-model-set(id) → void`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hv-images.test.ts`:
```ts
import { parseImageSave, runImageTool } from "../pi-runtime/extensions/hv-images";

const usage = { input: 10, output: 1290, cacheRead: 0, cacheWrite: 0, totalTokens: 1300, cost: { input: 0, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.002 } };
const okImages = { stopReason: "stop", output: [{ type: "image", data: "QUJD", mimeType: "image/png" }], usage };

test("a saved image comes back to the agent with its path, and carries Pi's usage for the ledger", async () => {
  const saved: unknown[] = [];
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "assets/sun.png",
    generate: async () => okImages,
    save: async (p) => { saved.push(p); return JSON.stringify({ ok: true, path: "assets/sun.png" }); },
  });
  expect(saved).toEqual([{ path: "assets/sun.png", mimeType: "image/png", data: "QUJD", model: "google/x" }]);
  expect(r.content).toEqual([{ type: "text", text: "Saved the image to assets/sun.png." }, { type: "image", data: "QUJD", mimeType: "image/png" }]);
  expect(r.details).toEqual({ provider: "openrouter", model: "google/x", path: "assets/sun.png" });
  expect(r.usage).toBe(usage);
});

test("a refused save (the file exists) keeps the usage — the image was still paid for", async () => {
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "assets/sun.png",
    generate: async () => okImages,
    save: async () => JSON.stringify({ ok: false, error: "A file already exists at assets/sun.png. Pick a new name." }),
  });
  expect(r.content).toEqual([{ type: "text", text: "A file already exists at assets/sun.png. Pick a new name." }]);
  expect(r.usage).toBe(usage);
});

test("a failed generation says why and never calls save", async () => {
  let called = false;
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "a.png",
    generate: async () => ({ stopReason: "error", errorMessage: "402 Insufficient credits", output: [] }),
    save: async () => { called = true; return ""; },
  });
  expect(called).toBe(false);
  expect(r.content[0]).toEqual({ type: "text", text: "The image model failed: 402 Insufficient credits" });
});

test("a reply with no image block is said plainly", async () => {
  const r = await runImageTool({ modelId: "m", prompt: "p", path: "a.png", generate: async () => ({ stopReason: "stop", output: [{ type: "text", text: "I can't draw that." }] }), save: async () => "" });
  expect(r.content[0]).toEqual({ type: "text", text: "The image model returned no image: I can't draw that." });
});

test("a broken envelope round trip is an error the agent sees, never a fake success", async () => {
  const r = await runImageTool({ modelId: "m", prompt: "p", path: "a.png", generate: async () => okImages, save: async () => undefined });
  expect(r.content[0]).toEqual({ type: "text", text: "HappyVibe could not save the image." });
});

test("parseImageSave accepts only our envelope", () => {
  expect(parseImageSave({ method: "input", title: JSON.stringify({ kind: "hv.image-save", path: "a.png", mimeType: "image/png", data: "QUJD", model: "m" }) }))
    .toEqual({ path: "a.png", mimeType: "image/png", data: "QUJD", model: "m" });
  expect(parseImageSave({ method: "select", title: "{}" })).toBeNull();
  expect(parseImageSave({ method: "input", title: JSON.stringify({ kind: "hv.document-read", path: "a" }) })).toBeNull();
});
```
Append to `tests/files.test.ts` (`ws` is the file's module-level temp workspace; add `writeNewFile` to its import from `../src/main/files`):
```ts
test("round 27: writeNewFile writes bytes inside the workspace and never overwrites", () => {
  const abs = writeNewFile([ws], ws, "assets/sun.png", Buffer.from("ABC"));
  expect(fs.readFileSync(abs, "utf8")).toBe("ABC");
  expect(() => writeNewFile([ws], ws, "assets/sun.png", Buffer.from("XYZ"))).toThrow(/EEXIST|exists/);
  expect(fs.readFileSync(abs, "utf8")).toBe("ABC");
  expect(() => writeNewFile([ws], ws, "../escape.png", Buffer.from("X"))).toThrow("Path escapes workspace");
  expect(() => writeNewFile([ws], ws, "/tmp/abs.png", Buffer.from("X"))).toThrow("Path escapes workspace");
});
```
Append to `tests/tool-switches-spawn.test.ts`:
```ts
describe("§13 round 27 — HV_IMAGE_MODEL", () => {
  test("set only when main names a model; absent means the tool is not registered", () => {
    expect(spawnWith({}, { imageModel: "google/gemini-3.1-flash-lite-image" }).env.HV_IMAGE_MODEL).toBe("google/gemini-3.1-flash-lite-image");
    expect(spawnWith({}).env.HV_IMAGE_MODEL).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/hv-images.test.ts tests/files.test.ts tests/tool-switches-spawn.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement the pure runner** — append to `pi-runtime/extensions/hv-images.ts`:
```ts
export const IMAGE_TOOL_DESCRIPTION =
  "Generate one image from a text prompt and save it as a new file in the workspace. It costs money on the user's OpenRouter account; the user picked the model.";

interface Usage { cost?: { total?: number } }
interface ImagesReply { stopReason: string; errorMessage?: string; output: Array<{ type: string; data?: string; mimeType?: string; text?: string }>; usage?: Usage }
type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ImageToolResult { content: Block[]; details: Record<string, unknown>; usage?: Usage }

/**
 * The whole tool, minus Pi and main: `generate` is ctx.modelRegistry.generateImages, `save` is
 * the blocking hv.image-save envelope (MAIN writes — path-confined, never overwriting). The
 * image is ALWAYS returned: the card draws it, and pi-ai replaces it for a model that can't
 * see images ("(tool image omitted…)", transform-messages.js), which leaves that model the path.
 * `usage` rides every outcome where the image was generated, because it was paid for.
 */
export async function runImageTool(d: {
  modelId: string;
  prompt: string;
  path: string;
  generate: (prompt: string) => Promise<ImagesReply | { error: string }>;
  save: (p: { path: string; mimeType: string; data: string; model: string }) => Promise<unknown>;
}): Promise<ImageToolResult> {
  const details = { provider: "openrouter", model: d.modelId, path: d.path };
  const say = (text: string, usage?: Usage): ImageToolResult => ({ content: [{ type: "text", text }], details, ...(usage ? { usage } : {}) });
  const r = await d.generate(d.prompt);
  if ("error" in r) return say(r.error);
  if (r.stopReason !== "stop") return say(`The image model failed: ${r.errorMessage ?? r.stopReason}`, r.usage);
  const img = r.output.find((b) => b.type === "image" && b.data);
  if (!img?.data) {
    const words = r.output.filter((b) => b.type === "text" && b.text).map((b) => b.text).join(" ").trim();
    return say(`The image model returned no image${words ? `: ${words}` : "."}`, r.usage);
  }
  const mimeType = img.mimeType ?? "image/png";
  const raw = await d.save({ path: d.path, mimeType, data: img.data, model: d.modelId });
  let ans: { ok?: boolean; path?: string; error?: string } = {};
  try { ans = typeof raw === "string" ? JSON.parse(raw) : {}; } catch { /* answered below */ }
  if (ans.ok === false) return say(ans.error ?? "HappyVibe could not save the image.", r.usage);
  if (ans.ok !== true) return say("HappyVibe could not save the image.", r.usage);
  return {
    content: [{ type: "text", text: `Saved the image to ${ans.path ?? d.path}.` }, { type: "image", data: img.data, mimeType }],
    details: { ...details, path: ans.path ?? d.path },
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

/** Main's side of the envelope. Payload on `title` because this is an INPUT. */
export function parseImageSave(r: { method?: string; title?: string }): { path: string; mimeType: string; data: string; model: string } | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.image-save" || typeof p.path !== "string" || typeof p.data !== "string") return null;
    return { path: p.path, mimeType: typeof p.mimeType === "string" ? p.mimeType : "image/png", data: p.data, model: typeof p.model === "string" ? p.model : "" };
  } catch {
    return null;
  }
}
```
`src/main/files.ts`, after `createFile`:
```ts
/** §13 round 27: a new binary file (generate_image). Confined like every writer; `wx` never overwrites. */
export function writeNewFile(registeredWorkspaces: string[], workspaceId: string, relPath: string, data: Buffer): string {
  const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data, { flag: "wx" });
  return abs;
}
```
`src/main/pi/spawn.ts`: add option `/** §13 round 27: the priced image model, or absent (switch off / no OpenRouter credential). */ imageModel?: string;` and env `...(opts.imageModel ? { HV_IMAGE_MODEL: opts.imageModel } : {}),` beside `HV_MEMORY_*`. Keep `images` OUT of `HV_BUILTINS` and say so in a comment: the bridge keys on `HV_IMAGE_MODEL`, which main resolves from the switch AND the credential.

- [ ] **Step 4: Run — expect PASS**

Same command as Step 2 → `EXIT=0`.

- [ ] **Step 5: Bridge registration** (`happyvibe-bridge.ts`, after `} // builtins.document`):
```ts
  // §13 round 27: generate_image. Main names a model only when the Images switch is on AND an
  // OpenRouter key or sign-in exists, so an absent HV_IMAGE_MODEL is how "off" arrives — the
  // memory dirs' pattern. MAIN writes the file (hv.image-save), like memory and plans.
  const imageModelId = process.env.HV_IMAGE_MODEL;
  if (imageModelId) {
    pi.registerTool({
      name: IMAGE_TOOL,
      label: "Generate image",
      description: IMAGE_TOOL_DESCRIPTION,
      parameters: Type.Object({
        intent: intentParam(),
        prompt: Type.String({ description: "What the image should show, in detail." }),
        path: Type.String({ description: "Workspace-relative file to create, e.g. assets/icon.png. Must not exist yet." }),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        const p = params as { prompt: string; path: string };
        return runImageTool({
          modelId: imageModelId,
          prompt: p.prompt,
          path: p.path,
          generate: async (prompt) => {
            const model = ctx.modelRegistry.getModelsOfType("image", "openrouter").find((m) => m.id === imageModelId);
            if (!model) return { error: `The image model ${imageModelId} isn't available in this version of HappyVibe.` };
            return ctx.modelRegistry.generateImages(model, { input: [{ type: "text", text: prompt }] }, { signal }) as never;
          },
          save: (payload) => ctx.ui.input(JSON.stringify({ kind: "hv.image-save", ...payload }), ""),
        }) as never;
      },
    });
  }
```
Import `IMAGE_TOOL, IMAGE_TOOL_DESCRIPTION, runImageTool` from `./hv-images`. In `summarize()`, before the generic arm, add:
```ts
  // §13 round 27: what is approved is the model (it costs money), the file and the prompt.
  if (toolName === IMAGE_TOOL) {
    return JSON.stringify({ model: process.env.HV_IMAGE_MODEL ?? "", path: input.path, prompt: String(input.prompt ?? "").slice(0, 300) });
  }
```
`hv-plan.ts:177`: add `"generate_image"` to `BLOCKED_PLAN_TOOLS` with a comment (it writes a file and spends money).

- [ ] **Step 6: Main** (`src/main/config.ts`, `src/main/ipc.ts`, preload, `hv.d.ts`)
- config: `images?: boolean` in the `builtinTools` type (line 67) and `images: t?.images ?? true` in `getBuiltinTools` (and in its return type and `setBuiltinTools`' parameter type). Add top-level `imageModel?: string` to the config type, plus:
```ts
/** §13 round 27: the user's image model. Absent ⇒ the cheapest priced one (resolveImageModel). */
export function getImageModel(): string | undefined { return load().imageModel; }
export function setImageModel(id: string): void { const cfg = load(); cfg.imageModel = id; save(cfg); }
```
- ipc.ts — a helper next to `sessionCanSeeImages`:
```ts
  /** §13 round 27: OpenRouter is the only provider Pi lists image models under — a key or a sign-in. */
  const openRouterReady = (): boolean => !!providerKeyStatus().openrouter || authJsonProviders(agentDir()).includes("openrouter");
```
- spawnOpts (beside `longCache`): `imageModel: builtins.images && openRouterReady() ? resolveImageModel(IMAGE_MODELS, getImageModel()) ?? undefined : undefined,`
- envelope (beside `parseDocumentReq` usage, ~2269), with the same always-answer `reply` pattern:
```ts
      const ir = parseImageSave(r as { method?: string; title?: string });
      if (ir) {
        let answered = false;
        const reply = (v: unknown): void => { if (!answered) { answered = true; client.respondUi(r.id, { value: JSON.stringify(v) }); } };
        try {
          const wsId = meta?.workspaceId;
          if (!wsId) throw new Error("This session has no workspace to save into.");
          writeNewFile(roots(), wsId, ir.path, Buffer.from(ir.data, "base64"));
          void log.append({ type: "image.generated", sessionId, workspaceId: wsId, data: { path: ir.path, model: ir.model, bytes: Math.floor((ir.data.length * 3) / 4) } });
          reply({ ok: true, path: ir.path });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          reply({ ok: false, error: /EEXIST/.test(msg) ? `A file already exists at ${ir.path}. Pick a new name.` : msg === "Path escapes workspace" ? `${ir.path} is outside the workspace. Save inside it.` : msg });
        }
        return;
      }
```
- IPC:
```ts
  ipcMain.handle("hv:image-settings", () => ({ available: openRouterReady(), model: resolveImageModel(IMAGE_MODELS, getImageModel()), models: IMAGE_MODELS }));
  ipcMain.handle("hv:image-model-set", async (_e, id: string) => {
    if (!IMAGE_MODELS.some((m) => m.id === id)) throw new Error("Not a priced image model");
    setImageModel(id);
    scheduleRuntimeReload("tools", "global", null);
    await restartUtility();
  });
```
- preload: `imageSettings: () => ipcRenderer.invoke("hv:image-settings"), imageModelSet: (id: string) => ipcRenderer.invoke("hv:image-model-set", id),`; `hv.d.ts`: matching declarations, and `images: boolean` / `images?: boolean` in `builtinsGet`/`builtinsSet`.

- [ ] **Step 7: Live wire test** — `tests/image-bridge.test.ts`. It costs about one image per run (cheapest model) and runs only on the OpenRouter route. Copy the `start()` harness from `tests/document-bridge.test.ts` (same imports, same `PiClient` args), with:
  - env: `...PROVIDER_ENV, HV_IMAGE_MODEL: "google/gemini-3.1-flash-lite-image"`;
  - a fake main that answers `hv.image-save` the way ipc.ts does (`writeNewFile` into the tmp dir) and auto-answers the `generate_image` permission select with `"Allow"`;
  - `test.skipIf(!KEY || MODEL.provider !== "openrouter")("generate_image reaches OpenRouter, main writes the file, and the result carries usage", …)`;
  - use `askUntil` (`tests/reask.ts`) with the prompt `Use generate_image to make a tiny flat icon of a sun and save it to sun.png.`, matching on the `hv.image-save` envelope;
  - assert: the file exists and starts with a PNG/JPEG/WEBP magic number; the `tool_execution_end` result has `details.model === "google/gemini-3.1-flash-lite-image"`, a `usage.cost.total > 0`, and an `image` content block.
  - Add the observed `tool_execution_end` shape (data truncated) and the envelope to `docs/validation/d1.md` under a new `## Pi 1.0.2 — generate_image (round 27)` heading.

- [ ] **Step 8: Run the bridge suites (non-live)**

Run: `L=/tmp/vitest.log; npx vitest run tests/hv-images.test.ts tests/files.test.ts tests/tool-switches-spawn.test.ts tests/how-it-works.test.ts tests/hv-plan.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add pi-runtime/extensions/hv-images.ts pi-runtime/extensions/happyvibe-bridge.ts pi-runtime/extensions/hv-plan.ts src/main/files.ts src/main/config.ts src/main/pi/spawn.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts tests/hv-images.test.ts tests/files.test.ts tests/tool-switches-spawn.test.ts tests/image-bridge.test.ts docs/validation/d1.md
git commit -s -m "feat(images): generate_image — OpenRouter only, priced models only, main writes the file and never overwrites" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Images on screen — the row, the prompt, the card (§13 round 27)

**Files:**
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` (`images` in `Builtins`; new `ImagesRow` after `DocumentsRow`)
- Modify: `src/renderer/src/toolSwitches.ts` (`images` in `ToolSwitchState`; `allToolsOff` counts it only when available)
- Modify: `src/renderer/src/components/PermissionModal.tsx` (image panel)
- Modify: `src/renderer/src/toolLabel.ts` (case `generate_image`)
- Create: `src/renderer/src/imagePrompt.ts` (pure copy for the prompt and the row)
- Test: new `tests/image-ui.test.ts`; `tests/tool-label.test.ts`; `tests/tool-switches-ui.test.ts`
- Docs: `docs/guide/src/content/docs/built-in-tools.md` (new `### Images — 1 tool`), `approve-a-tool-call.md` if it lists per-tool panels (check)

**Interfaces:**
- Consumes: Task 8's `imageSettings()` / `imageModelSet()` and the summary JSON `{ model, path, prompt }`.
- Produces: `IMAGES_ROW_COPY = { on: string; needsOpenRouter: string }`, `imagePromptLines(s: { model: string; path: string }, models: readonly { id: string; name: string }[]): string[]`, `fmtRate(m): string`.

- [ ] **Step 1: Write the failing tests** — `tests/image-ui.test.ts`:
```ts
import fs from "node:fs";
import { expect, test } from "vitest";
import { IMAGES_ROW_COPY, imagePromptLines, fmtRate } from "../src/renderer/src/imagePrompt";

test("the prompt names the model, says it costs money, and shows the file — never the intent", () => {
  const lines = imagePromptLines({ model: "google/gemini-3.1-flash-lite-image", path: "assets/sun.png" }, [{ id: "google/gemini-3.1-flash-lite-image", name: "Google: Gemini 3.1 Flash Lite Image" }]);
  expect(lines).toEqual([
    "This makes an image with Google: Gemini 3.1 Flash Lite Image on your OpenRouter account. It costs money.",
    "It saves a new file: assets/sun.png",
  ]);
});

test("rates read per million tokens, input then output", () => {
  expect(fmtRate({ input: 0.25, output: 1.5 })).toBe("$0.25 in · $1.50 out per million tokens");
});

test("the row's copy", () => {
  expect(IMAGES_ROW_COPY.needsOpenRouter).toBe("Needs an OpenRouter key or sign-in. Add one on");
  expect(IMAGES_ROW_COPY.on).toContain("costs money");
});

test("the picker lists only the priced models main sends — no hand-written model id in the renderer", () => {
  const src = fs.readFileSync("src/renderer/src/components/BuiltinToolsBlock.tsx", "utf8");
  for (const absent of ["flux", "recraft", "seedream", "mai-image", "openrouter/auto"]) expect(src.toLowerCase()).not.toContain(absent);
  expect(src).toContain("settings.models.map(");
});
```
Append to `tests/tool-label.test.ts`:
```ts
test("generate_image: intent first, else the file it makes", () => {
  expect(toolLabel("generate_image", { path: "assets/sun.png" }).label).toBe("Making sun.png");
  expect(toolLabel("generate_image", { path: "assets/sun.png", intent: "Drawing the app icon" }).label).toBe("Drawing the app icon");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `L=/tmp/vitest.log; npx vitest run tests/image-ui.test.ts tests/tool-label.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement**

`src/renderer/src/imagePrompt.ts`:
```ts
/** §13 round 27 — the Images row and the generate_image prompt, as data (no DOM in the suite). */
export const IMAGES_ROW_COPY = {
  on: "Lets the agent make an image and save it as a new file in your project. Each image costs money on your OpenRouter account, at the rates of the model you pick here.",
  needsOpenRouter: "Needs an OpenRouter key or sign-in. Add one on",
} as const;

export function fmtRate(m: { input: number; output: number }): string {
  return `$${m.input.toFixed(2)} in · $${m.output.toFixed(2)} out per million tokens`;
}

export function imagePromptLines(s: { model: string; path: string }, models: readonly { id: string; name: string }[]): string[] {
  const name = models.find((m) => m.id === s.model)?.name ?? s.model;
  return [`This makes an image with ${name} on your OpenRouter account. It costs money.`, `It saves a new file: ${s.path}`];
}
```
`BuiltinToolsBlock.tsx` — add `images: boolean` to `Builtins`, and:
```tsx
/** §13 round 27 — generate_image. Registered only with an OpenRouter credential; the picker lists
    only models Pi fully prices (main sends them), so the cost shown is real. */
function ImagesRow({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  const [settings, setSettings] = useState<{ available: boolean; model: string | null; models: { id: string; name: string; input: number; output: number }[] } | null>(null);
  useEffect(() => { void window.hv.imageSettings().then(setSettings); }, []);
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Images — 1 tool</span>
        <span className="text-xs text-ink-soft">{IMAGES_ROW_COPY.on}</span>
        {settings && !settings.available && (
          <span className="text-xs font-semibold block mt-1">{IMAGES_ROW_COPY.needsOpenRouter} <GoTo view="models" />.</span>
        )}
        {settings?.available && settings.model && (
          <label className="text-xs block mt-2">
            <span className="font-bold mr-2">Image model</span>
            <select
              value={settings.model}
              onChange={(e) => { const id = e.target.value; void window.hv.imageModelSet(id).then(() => setSettings((s) => (s ? { ...s, model: id } : s))); }}
              className="rounded-lg border-2 border-line bg-card px-2 py-1 text-xs"
            >
              {settings.models.map((m) => <option key={m.id} value={m.id}>{m.name} — {fmtRate(m)}</option>)}
            </select>
          </label>
        )}
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
    </div>
  );
}
```
Render it after `<DocumentsRow …/>` with `<ImagesRow on={builtins.images} onChange={(on) => save({ images: on })} />`. Imports: `GoTo` from `./GoTo`, `IMAGES_ROW_COPY, fmtRate` from `../imagePrompt`.

`toolSwitches.ts`: add `images?: boolean` and `imagesAvailable?: boolean` to `ToolSwitchState`, and make `allToolsOff` treat `images && imagesAvailable` as a tool that is still on. In `BuiltinToolsBlock`, pass `imagesAvailable` from the row's settings fetch (lift that fetch to the block if simpler).

`PermissionModal.tsx`: after the boundary block:
```tsx
          {/* §13 round 27: an image costs money — the model and the file are the question. */}
          {info.tool === "generate_image" && imageArgs && (
            <div className="mb-4 rounded-xl border-2 border-honey bg-honey-soft px-3 py-2 text-xs font-semibold text-ink">
              {imagePromptLines(imageArgs, imageModels).map((l) => <div key={l} className="break-words">{l}</div>)}
            </div>
          )}
```
with `const imageArgs = info.tool === "generate_image" ? (argsFromSummary(info.tool, info.summary) as { model: string; path: string } | undefined) : undefined;` and `imageModels` from `window.hv.imageSettings()`, fetched once in a `useEffect` only when `info.tool === "generate_image"`.

`toolLabel.ts`, beside `document_read`:
```ts
    case "generate_image": {
      const p = str("path");
      return { icon: "file-plus", label: intent ?? (p ? `Making ${basename(p)}` : "Making an image"), ...(p ? { path: p } : {}) };
    }
```

- [ ] **Step 4: Run — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/image-ui.test.ts tests/tool-label.test.ts tests/tool-switches-ui.test.ts tests/permission-boundary-render.test.ts tests/modal-layer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → `EXIT=0`.

- [ ] **Step 5: Guide** — `built-in-tools.md`: add `### Images — 1 tool` after Documents. Quote `IMAGES_ROW_COPY.on` exactly. Say: it needs an OpenRouter key or sign-in (quote the row's line); **Image model** lists only models whose price HappyVibe can show, cheapest first; the prompt names the model and the new file; it never replaces an existing file; plan mode blocks it. If `approve-a-tool-call.md` describes per-tool panels, add the image one. Run `docs-reviewer`; fix findings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/imagePrompt.ts src/renderer/src/components/BuiltinToolsBlock.tsx src/renderer/src/toolSwitches.ts src/renderer/src/components/PermissionModal.tsx src/renderer/src/toolLabel.ts tests/image-ui.test.ts tests/tool-label.test.ts docs/guide/src/content/docs/built-in-tools.md
git commit -s -m "feat(images): the Images row with its priced-model picker, and a prompt that says it costs money" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Gate, live batch, wire notes

- [ ] **Step 1: Gate**

Run: `L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: `EXIT=0`. On a typecheck error, fix it in the task's files and commit the fix.

- [ ] **Step 2: Which live files** — `npm run live:why`. It names at least the bridge files (Tasks 2 and 8). Before trusting a failure: `pgrep -fl electron-vite` (another app running?), check the OpenRouter balance, then rerun the failing file alone.

- [ ] **Step 3: Live batch** (background, ~8 min; needs the `.env` symlink from Task 0)

Run with `run_in_background`: `L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`, wall time ~7–8 min. A batch that ends in seconds means the key is missing: a fake green.

- [ ] **Step 4: Wire notes** — in `docs/validation/d1.md` add `## Pi 1.0.2 — prompt disposition and clear_queue (round 27)`. Include one real `prompt` response with `data.disposition` and one `success:false` refusal, both copied from a run (the compaction refusal is the reproducible one, see GUI check A2), plus one real `clear_queue` response. Commit `-s`.

---

## GUI verification (observable assertions)

Run the worktree app (`npm run dev`, debug port per `/devdoctor`). Use a workspace with an OpenRouter key, and a second profile or a key removal for the "no credential" checks. Each line names the page it is observed on.

**A. Messages typed mid-run** (session view)

1. **Baseline:** in an idle session, send "list the files here". One bubble appears, the busy dots run, and the turn ends normally.
2. **Refusal (compaction):** in a session with real context, click **Compact now**, then immediately type "hello" and press Enter.
   - **TRUE:** the transcript shows the notice "The agent is compacting its context. Send your message again when it finishes.", the message box contains "hello", and the busy dots stop once compaction ends.
   - **ABSENT:** no "hello" bubble anywhere in the transcript, and no red error banner at the top of the app.
3. **Queue and take back:** send "run `sleep 25` in bash, then say done". While it runs, send "also add a README" and "@package.json what's the version?".
   - **TRUE:** two chips appear. The second chip reads "@package.json what's the version?", not the file's contents.
   - Click **Take back**. **TRUE:** both chips disappear, and the box holds "also add a README" then a blank line then "@package.json what's the version?".
   - **ABSENT:** neither text appears as a bubble, during the turn or after it ends.
   - Then press Enter. **TRUE:** exactly one new bubble.
4. **Copy:** hover a queued chip and the "queued · kept on stop" label. **ABSENT:** the words "Pi can't unqueue".
5. **Regression the design risks (positions):** send a long multi-tool task ("read 5 files and summarise each"). The instant the first tool card appears, send "thanks". It is queued (or started, if the turn already ended). **TRUE:** every tool card still reaches its done state on the card it started on, and no card shows another card's result.

**B. Images** (Built-in tools page, session view, Files panel, Session cost panel, Agent tools page)

6. **Built-in tools, with OpenRouter:**
   - **TRUE:** an **Images — 1 tool** row, on. **Image model** lists exactly 14 models, the first being "Google: Gemini 3.1 Flash Lite Image — $0.25 in · $1.50 out per million tokens".
   - **ABSENT:** FLUX, Recraft, Seedream, Microsoft MAI and "openrouter/auto" are not in the list.
7. **Without OpenRouter** (remove the key and sign out of OpenRouter on Models):
   - **TRUE:** the row says "Needs an OpenRouter key or sign-in. Add one on Models." with a working link.
   - **ABSENT:** after a new session starts, **Agent tools** does not list `generate_image`.
8. **Make an image:** ask "make a small flat icon of a smiling sun and save it to assets/sun.png".
   - **TRUE:** the prompt shows "This makes an image with Google: Gemini 3.1 Flash Lite Image on your OpenRouter account. It costs money." and "It saves a new file: assets/sun.png".
   - Click **Allow**. **TRUE:** the tool card shows the image; `assets/sun.png` is in the Files panel and opens; the Session cost panel has a new row for that model labelled "Image"; the cost pill went up.
9. **No overwrite:** ask for another image, also saved to `assets/sun.png`.
   - **TRUE:** the card says "A file already exists at assets/sun.png. Pick a new name.", and the agent picks another name.
   - **ABSENT:** the first `sun.png` is unchanged (same picture, same modified time in Finder).
10. **Plan mode:** turn plan mode on and ask for an image. **TRUE:** refused by plan mode. **ABSENT:** no permission prompt and no new file.
11. **Grant regression:** choose **Allow for session** on one image; a second image doesn't prompt. Toggle any Built-in tools switch (the session respawns); the next image prompts again.

**C. Ledger** (Session cost panel, Stats page)

12. After B8, the session's total is the same on the cost pill, at the bottom of the Session cost panel, and on the **Stats** page for that workspace.
13. Click **Compact now** on a session with context. **TRUE:** a row labelled "Compaction" appears in the Session cost panel.

**D. Workflows** (Built-in tools, Agent tools)

14. With a fresh profile (no settings file):
    - **TRUE:** the Workflows row reads Off, and the page intro says "on by default except Workflows".
    - **ABSENT:** **Agent tools** does not list `SubagentWorkflow`.
    - Turn it on, then open a new session. **TRUE:** `SubagentWorkflow` is listed.
15. With an existing profile where Workflows was switched on before: it still reads On.

---

## Release note (for `/release`, not this branch)

This is MINOR. Give it a **Heads up** block: Workflows is now off by default — turn it on in Built-in tools to keep using it.
