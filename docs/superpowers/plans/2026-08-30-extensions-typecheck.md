# Extensions Typecheck (housekeeping item 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pi-runtime/extensions/` — all 19 files, including the ~106 KB `happyvibe-bridge.ts` that owns every permission decision — becomes typechecked at every gate, and the three errors the check surfaces get fixed.

**Architecture:** A third root tsconfig (`tsconfig.extensions.json`, standalone `--noEmit`, not composite, not referenced from `tsconfig.json`) covering the whole directory, appended to the `typecheck` npm chain so `build` → `gate` → CI all inherit it. The probe behind this design was run twice (main checkout and this worktree) and produces exactly 3 errors in ~2.5 s, so every task below is against a measured baseline.

**Tech Stack:** TypeScript 5 (`tsc -p`), vitest for the pin test. No new dependencies.

**Spec:** Notion "🧹 Deferred housekeeping", section "Item 1, brainstormed in full (2026-08-30)" — `https://app.notion.com/p/3c3d33dfffca81f08733f911e9bc66bf`. Decisions folded there 2026-08-30: PRD untouched; a real `AgentMessage` shape drift (if found) is fixed in this same change; the coverage is pinned permanently by a key-free test.

## Global Constraints

- Never patch vendored source (`pi-runtime/node_modules/**`). If upstream errors appear, adjust OUR config or use the `.mjs`+`.d.ts` shim escape hatch recorded in the spec.
- `hv-context.ts` stays a **zero-import pure module** (its own header declares it; `src/main/history.ts`, `ipc.ts` and preload import it, and `tsconfig.node.json` checks it). No upstream type imports may be added to it — the TS2769 fix must live at the bridge boundary or be expressed structurally/generically.
- The existing per-file include lists in `tsconfig.node.json` / `tsconfig.web.json` stay as-is (double-checking `hv-*` files under two configs is accepted precedent).
- Bridge edits are behavior-neutral: the three fixes plus dead-import deletion must not change any runtime statement's semantics. If Task 3's drift investigation forces a runtime change, that is expected and allowed (decision: fix in same change) — but it triggers the conditional GUI check in the Verification section.
- This plan edits `pi-runtime/extensions/`, so after the commit `npm run live:why` WILL print and the ~6-min serial `npm run test:live` batch is mandatory (CLAUDE.md rule: check it after the commit that carries the change, background it only alongside non-tree work).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: The check itself — `tsconfig.extensions.json` + standalone script

The config is the failing test: it must report exactly the 3 known errors before anything is fixed.

**Files:**
- Create: `tsconfig.extensions.json` (repo root)
- Modify: `package.json:12-14` (scripts block — add `typecheck:ext` only; do NOT touch the `typecheck` chain yet, that happens in Task 4 after the errors are fixed, or the build would be red for three tasks)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck:ext` — the command Tasks 2–5 and the pin test rely on; the file `tsconfig.extensions.json` with `include: ["pi-runtime/extensions/**/*.ts"]` that the Task 4 pin test asserts on.

- [x] **Step 1: Create the config** — byte-for-byte the measured probe:

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["pi-runtime/extensions/**/*.ts"],
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "baseUrl": ".",
    "paths": {
      "@earendil-works/pi-ai": ["pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.d.ts"],
      "@earendil-works/pi-ai/*": ["pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/*"],
      "@earendil-works/pi-agent-core": ["pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/index.d.ts"]
    }
  }
}
```

Why each knob (from the spec, so nobody "simplifies" them away): `allowImportingTsExtensions` — the bridge's relative imports carry explicit `.ts` extensions, and this flag legally requires `noEmit`; `noUnusedLocals/Parameters: false` — pi-subagents ships raw `.ts` sources (no `dist/`, so `skipLibCheck` cannot shield us) and 5 upstream unused-symbol errors are style lint on code we don't own; the `paths` — pi-subagents' source imports `@earendil-works/pi-ai`/`pi-agent-core`, which are NESTED under `pi-coding-agent/node_modules/` and invisible to walk-up resolution from pi-subagents' own directory. Not composite, not referenced from root `tsconfig.json`: it never emits and nothing builds from it.

- [x] **Step 2: Add the standalone script** in `package.json`, right after `typecheck:web`:

```json
"typecheck:ext": "tsc --noEmit -p tsconfig.extensions.json",
```

(No `--composite false` — unlike the other two, this config is not composite.)

- [x] **Step 3: Run it and verify the measured baseline — exactly these 3 errors, nothing else:**

Run: `npm run typecheck:ext`
Expected: FAIL with exactly:
```
happyvibe-bridge.ts(724,…): error TS7030: Not all code paths return a value.
happyvibe-bridge.ts(784,…): error TS2769: No overload matches this call.
happyvibe-bridge.ts(1710,…): error TS1064: The return type of an async function … must be the global Promise<T> type.
```
A 4th error, or an error outside `happyvibe-bridge.ts`, means the tree moved since the probe — stop and re-measure before proceeding; do not silence anything to get to 3.

- [x] **Step 4: Commit**

```bash
git add tsconfig.extensions.json package.json
git commit -m "chore(typecheck): a third tsconfig covers pi-runtime/extensions (not yet gating)"
```

---

### Task 2: The two mechanical errors + the two dead imports

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:780` (TS7030), `:1710` (TS1064), `:35-36` (dead imports)

**Interfaces:**
- Consumes: `npm run typecheck:ext` from Task 1.
- Produces: a bridge where the ONLY remaining extensions-typecheck error is the TS2769 at `:784`.

- [x] **Step 1: TS7030 — make the intended fall-through explicit.** In the `before_agent_start` handler, after line 780:

```ts
    if (section || agentsSection || planSection || skillSection) return { systemPrompt: injected };
  });
```
becomes
```ts
    if (section || agentsSection || planSection || skillSection) return { systemPrompt: injected };
    return undefined; // no injection this turn — resets Pi to the base prompt
  });
```
Falling off the end WAS the intended semantics; this only spells it.

- [x] **Step 2: TS1064 — respell `browserInput`'s return annotation** (line ~1710). TS requires async return types to be written with the literal global `Promise<T>`:

```ts
  ): ReturnType<typeof browserReply> => browserReply(await ctx.ui.input(JSON.stringify(payload), ""));
```
becomes
```ts
  ): Promise<Awaited<ReturnType<typeof browserReply>>> => browserReply(await ctx.ui.input(JSON.stringify(payload), ""));
```

- [x] **Step 3: Delete the two dead imports** — in the `./hv-subagent-boundary` import block (lines 34–38), remove `isReadOnlyBoundary` and `writeCapableIn` from the specifier list (they are unused; `noUnusedLocals` is off in this config so tsc will not do it for us — this is the by-hand fix the spec budgets). Leave every other name.

- [x] **Step 4: Verify only TS2769 remains**

Run: `npm run typecheck:ext`
Expected: FAIL with exactly ONE error — `happyvibe-bridge.ts(784,…): TS2769`.
Also run: `npm test` (~25–40 s) — Expected: PASS (nothing behavioral changed; `builtins-contract` still loads the bridge).

- [x] **Step 5: Commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts
git commit -m "fix(bridge): two annotations the never-run typecheck missed, and two dead imports"
```

---

### Task 3: TS2769 — the context handler, typed for real

This is the one open-ended piece. The handler at `happyvibe-bridge.ts:784` forces `event.messages` through `as unknown as` double-casts between upstream's `AgentMessage` (from `@earendil-works/pi-agent-core`: `Message | CustomAgentMessages[keyof CustomAgentMessages]`, where `Message = UserMessage | AssistantMessage | ToolResultMessage` from nested pi-ai) and the hand-rolled structural `AgentMessage` in `hv-context.ts:37`. §9's context removal and the sub-agent delivery repair both ride this handler.

**Files:**
- Modify: `pi-runtime/extensions/hv-context.ts` (`filterMessages` signature, ~line 160), `pi-runtime/extensions/hv-subagent-delivery.ts` (`substituteDeliveries` signature, ~line 127), `pi-runtime/extensions/happyvibe-bridge.ts:784-795` (the handler — casts removed)
- Test: existing `tests/hv-context.test.ts`, `tests/subagent-delivery.test.ts` (or wherever `substituteDeliveries` is tested — re-derive with `grep -rl substituteDeliveries tests/`) must stay green unmodified; that is the no-behavior-change check.

**Interfaces:**
- Consumes: the Task 1 check.
- Produces: `filterMessages<M extends AgentMessage>(messages: M[], marks: Set<MarkKey>): M[]` and `substituteDeliveries<M extends DeliveryMessage>(messages: M[] | undefined, outputs: …): M[] | null` — identity-preserving generics, so the bridge passes upstream's `AgentMessage[]` in and gets the same type back with **zero casts**.

- [x] **Step 1: Diff the shapes first — this is the point of the whole item.** Compare every field `hv-context.ts`'s `AgentMessage`/`ContentBlock` and `hv-subagent-delivery.ts`'s `DeliveryMessage` actually read or write against the upstream definitions:
  - upstream union: `pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:282` (`AgentMessage`) and the `CustomAgentMessages` augmentation near it;
  - pi-ai messages: `…/pi-ai/dist/types.d.ts:292-335` (`UserMessage`/`AssistantMessage`/`ToolResultMessage`).

  Record the diff in the commit message. Two outcomes:
  - **Shapes agree** on every touched field (role names, `content` block shapes, `toolCallId`, `timestamp`, `customType`) → pure typing repair, continue to Step 2.
  - **A touched field genuinely differs** → that is a live discrepancy in the context pipeline, papered over by the casts. Decision (2026-08-30): **fix it here**, in the same change — correct the reading/writing code to upstream's real shape, and note in the Verification section that the conditional GUI/live check is now armed.

- [x] **Step 2: Make the two rewrite functions identity-preserving generics.** `hv-context.ts` stays zero-import — the generic bound is its own structural type:

```ts
export function filterMessages<M extends AgentMessage>(messages: M[], marks: Set<MarkKey>): M[] {
```
Inside, where a modified assistant message is rebuilt from a filtered `content`, spread the original so the element type survives: `out.push({ ...m, content: kept });` (already the shape — verify, don't assume). Same treatment for `substituteDeliveries` in `hv-subagent-delivery.ts`:

```ts
export function substituteDeliveries<M extends DeliveryMessage>(
  messages: M[] | undefined,
  outputs: Map<string, string>,
): M[] | null {
```
(Adjust the second parameter's spelling to whatever it actually is — read the file; the generic is the change, not the parameters.)

If the generic route fights the compiler somewhere (e.g. a constructed message that is legitimately NOT `M`), fall back to ONE explicit, named conversion function at the bridge boundary — never restore an `as unknown as`.

- [x] **Step 3: Remove the casts in the bridge handler.** `happyvibe-bridge.ts:784-795` becomes (modulo the local variable names already there):

```ts
  pi.on("context", async (event) => {
    let messages = event.messages;
    if (contextMarks.size > 0) messages = filterMessages(messages, contextMarks);
    const repaired = substituteDeliveries(messages, childOutputs);
    if (repaired) messages = repaired;
    return contextMarks.size > 0 || repaired ? { messages } : undefined;
  });
```
For this to compile, upstream's `AgentMessage` must satisfy both structural bounds — if it does not, that IS the Step 1 drift and gets fixed per the decision, not cast away.

- [x] **Step 4: Verify green**

Run: `npm run typecheck:ext` — Expected: PASS (zero errors).
Run: `npm test` — Expected: PASS, with `tests/hv-context.test.ts` and the delivery tests unmodified.
Run: `grep -n "as unknown as" pi-runtime/extensions/happyvibe-bridge.ts` — Expected: **no hit inside the `pi.on("context", …)` handler** (hits elsewhere in the file are out of scope; do not chase them).

- [x] **Step 5: Commit** (message records the Step 1 diff outcome)

```bash
git add pi-runtime/extensions/hv-context.ts pi-runtime/extensions/hv-subagent-delivery.ts pi-runtime/extensions/happyvibe-bridge.ts
git commit -m "fix(bridge): the context handler is typed against upstream, casts removed"
```

---

### Task 4: Wire into the gate + pin it

**Files:**
- Modify: `package.json:14` (`typecheck` chain)
- Create: `tests/extensions-typecheck.test.ts`

**Interfaces:**
- Consumes: green `typecheck:ext` from Task 3.
- Produces: `npm run typecheck` = node + web + ext; a key-free pin test in the non-live suite.

- [x] **Step 1: Write the pin test** (key-free, runs in `npm test` and CI). The include list drifting is exactly how this hole existed, so the test asserts the two things a future "tidy" would break:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Housekeeping item 1 (2026-08-30): pi-runtime/extensions/ was typechecked by
// NOTHING for the app's whole life, which shipped a real TDZ ReferenceError
// across the §12 refusal paths. The coverage is pinned here so an include-list
// or script "cleanup" fails this suite instead of silently reopening the hole.
describe("extensions typecheck coverage", () => {
  it("tsconfig.extensions.json covers the whole extensions directory", () => {
    const cfg = JSON.parse(readFileSync("tsconfig.extensions.json", "utf8"));
    expect(cfg.include).toEqual(["pi-runtime/extensions/**/*.ts"]);
    // noEmit is what makes allowImportingTsExtensions legal; losing it breaks the check.
    expect(cfg.compilerOptions.noEmit).toBe(true);
  });

  it("the typecheck chain runs it, so build/gate/CI inherit it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["typecheck:ext"]).toBe("tsc --noEmit -p tsconfig.extensions.json");
    expect(pkg.scripts.typecheck).toContain("typecheck:ext");
  });
});
```

- [x] **Step 2: Run it to verify the second assertion fails** (chain not wired yet)

Run: `npx vitest run tests/extensions-typecheck.test.ts`
Expected: FAIL — `typecheck` does not yet contain `typecheck:ext`.

- [x] **Step 3: Wire the chain.** `package.json`:

```json
"typecheck": "npm run typecheck:node && npm run typecheck:web && npm run typecheck:ext",
```

- [x] **Step 4: Verify**

Run: `npx vitest run tests/extensions-typecheck.test.ts` — Expected: PASS.
Run: `npm run typecheck` — Expected: PASS, all three configs.

- [x] **Step 5: Commit**

```bash
git add package.json tests/extensions-typecheck.test.ts
git commit -m "chore(gate): the extensions typecheck gates build/gate/CI, pinned by test"
```

---

### Task 5: Plant-a-bug proof, CLAUDE.md rewrite, full gate, live batch

**Files:**
- Modify: `CLAUDE.md` (two entries — see Step 3)
- No src changes.

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped state; documentation matching it.

- [x] **Step 1: Plant a type error in the bridge and prove the gate goes red.** Add a deliberately wrong line anywhere in `happyvibe-bridge.ts`, e.g. `const _proof: number = "red";`

Run: `npm run gate`
Expected: FAIL, fast, in `typecheck:ext`, naming `happyvibe-bridge.ts` and TS2322.

- [x] **Step 2: Remove the planted line.** `git diff` must show `pi-runtime/extensions/` clean of it.

- [x] **Step 3: Rewrite the two CLAUDE.md entries.**
  1. The **"`happyvibe-bridge.ts` is in NEITHER typecheck include list"** entry (starts "…and that hid a real bug"): rewrite to state the NEW truth — all of `pi-runtime/extensions/` is checked by `tsconfig.extensions.json` at every gate since 2026-08-30 (housekeeping item 1); keep the TDZ history as the reason it exists; note the source-order pin in `tests/subagent-external-agents.test.ts` is retained but no longer load-bearing alone (TS rejects use-before-declaration at the gate now).
  2. Add the **pin-bump hazard line** to the pin-bump-adjacent guidance (beside the typebox entry is the natural home): a pi-subagents bump can now fail *typecheck* with errors pointing under `node_modules` — the response is adjusting `tsconfig.extensions.json` (its `paths` encode the nested pi-ai/pi-agent-core layout) or the `.mjs`+`.d.ts` shim escape hatch in the Notion housekeeping doc, never patching vendored source.
  3. In the Commands section, update "`npm run typecheck` (node + web…)" to "(node + web + ext…)".

- [x] **Step 4: Full gate**

Run: `L=/tmp/vitest.log; npm run gate > $L 2>&1; echo "EXIT=$?"` then `tail -30 $L`
Expected: EXIT=0. `builtins-contract` green is the load-time assertion the spec calls out.

- [x] **Step 5: Commit, then the live batch — after the commit, never before** (live:why diffs `main...HEAD` on committed work):

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): the compiler is watching the bridge now (housekeeping #1)"
npm run live:why    # will print — pi-runtime/extensions/ changed
npm run test:live   # ~6 min serial; background it only alongside non-tree work
```
Expected: live batch green. One live failure ⇒ rerun that file in isolation before calling it a regression, and check provider balance before believing anything (CLAUDE.md rule).

---

## Verification (what must be observably true)

This change touches no `src/renderer/` or `src/main/` file, so there is no GUI surface to assert on in the default path. The observable claims:

- **The gate is louder:** a planted type error in `happyvibe-bridge.ts` turns `npm run gate` red in `typecheck:ext` (Task 5 Steps 1–2 perform exactly this sequence). Before this change the same gate passed regardless of the bridge's contents.
- **Absence assertion (named):** `pi.on("context", …)` in `happyvibe-bridge.ts` contains **no `as unknown as` cast** — greppable, Task 3 Step 4.
- **Nothing behavioral moved:** `npm test` green with `tests/hv-context.test.ts` and the delivery tests byte-unmodified; `builtins-contract` (bridge loads in real Pi) green; the full serial `test:live` batch green.
- **Conditional GUI check — armed only if Task 3 Step 1 finds a real shape drift and changes a runtime statement:** in the running app (dev server restarted — a renderer reload does not rebuild main or the bridge), on a session with at least one completed tool-using turn: open the context panel, remove that completed turn, and observe (a) the row leaves the panel, and (b) the next model reply shows no knowledge of the removed content. Then run one async delegation and observe the child's full answer (not a 1,000-char truncation) arrive in the transcript — that is the delivery repair, the other rider on this handler. Observed on: the chat view's context panel and the transcript, respectively.
- **The pin holds:** deleting `typecheck:ext` from the `typecheck` chain or narrowing the tsconfig's `include` fails `tests/extensions-typecheck.test.ts` in the key-free suite.

## Self-review notes

- Spec coverage: config (T1), wiring (T4), three errors (T2/T3), dead imports (T2), pin (T4, per decision 3), plant-a-bug + gate (T5), CLAUDE.md + pin-bump hazard (T5), live batch (T5), drift-fixed-in-same-change (T3 Step 1, per decision 2), PRD untouched (decision 1 — no task, deliberately).
- The `typecheck` chain is wired in T4, not T1, so the build is never red between tasks.
- T3's generic signatures were checked against the real code far enough to know `filterMessages` rebuilds assistant messages by spread and `substituteDeliveries` takes `DeliveryMessage[] | undefined` → `| null`; the implementer verifies the exact parameter spelling in-file rather than trusting this plan.
