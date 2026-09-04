# Feedbacks v13 (round 21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten reported items: the agent says it is HappyVibe, model rows show what they cost, the chat top bar carries all three session resources in three colours on as many lines as it needs, session dialogs open over their own pane, the AGENTS.md draft actually gets written and its dialog becomes a real editor, and splitting a session pane stops blanking the browser beside it.

**Architecture:** Nine of the ten are renderer-local or spawn-argv changes. The tenth (the AGENTS.md writer) moves a responsibility from the renderer to main: main already knows which agent a finished run was and where the child's own session file is, so it reads the child's final output from that file, parses the structured block, and writes through the path-confined writer that already exists. Two items were reported as mysteries and turned out to be single geometric/lifecycle causes found in the code — the plan fixes the cause, not the symptom.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 (CSS-variable palette in `src/renderer/src/styles.css`), CodeMirror 6 (lazy chunk), Radix Dialog, vitest (no DOM — renderer contracts are pure exports plus source scans), vendored `@earendil-works/pi-coding-agent` + `pi-subagents`.

**Spec:** `docs/prd.md` §7, §15, §16, §28 — the seven `Decision (Feedback round 21, 2026-09-04)` paragraphs. Mirrored to the Notion PRD (`391d33dfffca80a0a383e50792d51c0a`), same sections.

## Global Constraints

- **The renderer test suite has NO DOM.** `vitest.config.ts` includes `tests/**/*.test.ts` only; there is no jsdom and no `@testing-library/react`. Every renderer contract is pinned in two halves: the logic is exported as a **pure function or data** and unit-tested, and the **absence** (a word or a row that must no longer render) is a **source scan**, the `tests/modal-layer.test.ts` pattern.
- **Never pipe a test run to `tail`/`grep`.** Redirect once, then grep the file: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- **`npm test` is the non-live suite** (`DEEPSEEK_API_KEY=sk-REPLACE OPENROUTER_API_KEY=sk-REPLACE vitest run`), ~25-40 s. Full gate is `npm run gate` (build → typechecks → non-live suite) as ONE command; never run `npm run typecheck` before it.
- **`npm run test:live` only when `npm run live:why` prints something**, and only after the commit that carries the change (it diffs `main...HEAD`). A fresh worktree has no `.env` — symlink it first (`ln -s ~/Documents/Github/HappyVibe/.env .env`) and read the wall time: a real batch is ~6 min, a silently-skipped one is ~5 s.
- **`src/main` changes need a dev-server RESTART**, not a renderer reload. Before claiming a main-side fix is live, grep the BUILT artifact: `grep '<your change>' out/main/index.js`.
- **Palette colours are CSS variables in `src/renderer/src/styles.css`**, consumed as Tailwind class words (`bg-teal-soft`, `text-teal`). Never an inline computed class name — the JIT scanner never sees one.
- **Every fs writer is path-confined** (`resolveInWorkspace` / `resolveNestedAgentsMd` pattern). `bash` is the one exception and that is why the resource gate exists.
- **Do not run `npm run lint` or `npm run format`** — scaffold leftovers, 19,839 warnings, and `format` rewrites 281 of 329 tracked files.
- **Two new palette tokens, exact values:** `--color-teal: #2c8a86`, `--color-teal-soft: #dcefed`, `--color-rose: #c2478a`, `--color-rose-soft: #fae0ee`.
- **Exact chip copy:** skills `{used}/{total} skills` (unchanged), agents `{n} agents` (unchanged text, new colour), MCP `{connected}/{total} MCP`.

---

### Task 1: The agent says it is HappyVibe

Pi's base prompt opens *"You are an expert coding assistant operating inside pi, a coding agent harness"*. We append one paragraph after it. The base prompt is NOT replaced.

**Files:**
- Modify: `src/main/pi/spawn.ts` (add `appendPrompt` handling to `resolvePiSpawn`'s argv; `PiSpawnOptions`)
- Modify: `src/main/appendSystem.ts` (export the identity copy beside the file helpers it belongs with)
- Modify: `src/main/ipc.ts` (pass `agentDir()`-derived append file into `spawnOpts`)
- Test: `tests/identity-prompt.test.ts` (new)

**Interfaces:**
- Consumes: `resolvePiSpawn(workspace, sessionDir, runtimeDir, opts)`, `globalAppendFile(agentDir)`
- Produces: `HV_IDENTITY: string` (exported from `src/main/appendSystem.ts`); `PiSpawnOptions.appendFile?: string`

- [ ] **Step 1: Write the failing test**

`tests/identity-prompt.test.ts`:

```ts
import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { HV_IDENTITY } from "../src/main/appendSystem";

const runtime = path.join(process.cwd(), "pi-runtime");
const spawnArgs = (opts = {}): string[] =>
  resolvePiSpawn("/tmp/ws", "/tmp/sessions", runtime, opts).args;

/** Every `--append-system-prompt` VALUE, in argv order. */
const appends = (args: string[]): string[] =>
  args.flatMap((a, i) => (a === "--append-system-prompt" ? [args[i + 1]] : []));

test("the identity paragraph is appended, and it names HappyVibe", () => {
  const got = appends(spawnArgs());
  expect(got).toEqual([HV_IDENTITY]);
  expect(HV_IDENTITY).toMatch(/HappyVibe/);
});

test("the user's own APPEND_SYSTEM.md is passed too, and AFTER the identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-append-"));
  const file = path.join(dir, "APPEND_SYSTEM.md");
  fs.writeFileSync(file, "always answer in haiku", "utf8");
  // Pi joins the sources with "\n\n" in argv order, so LAST wins on conflict —
  // the user's own words must be last.
  expect(appends(spawnArgs({ appendFile: file }))).toEqual([HV_IDENTITY, file]);
});

test("a MISSING APPEND_SYSTEM.md is NOT passed — a missing path is appended as literal text", () => {
  // resource-loader.js resolvePromptInput: a non-existent input is returned
  // VERBATIM, so passing the path would put "/…/APPEND_SYSTEM.md" in the prompt.
  const missing = path.join(os.tmpdir(), "hv-does-not-exist", "APPEND_SYSTEM.md");
  expect(appends(spawnArgs({ appendFile: missing }))).toEqual([HV_IDENTITY]);
});

test("upstream contract: --append-system-prompt REPLACES discovery, it does not add to it", () => {
  // The whole reason we pass the file explicitly. If a pin bump made the flag
  // additive, passing it twice would double the user's additions — and this
  // test is where you find out.
  const loader = fs.readFileSync(
    path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"),
    "utf8",
  );
  expect(loader).toMatch(/if \(!appendSources\) \{/);
  expect(loader).toMatch(/discoverAppendSystemPromptFile\(\)/);
});

test("upstream contract: a non-path append input is used verbatim", () => {
  const loader = fs.readFileSync(
    path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"),
    "utf8",
  );
  // resolvePromptInput: existsSync ? readFileSync : return input
  expect(loader).toMatch(/function resolvePromptInput\(input, description\) \{/);
});

test("the base prompt is NOT replaced — no --system-prompt is ever passed", () => {
  expect(spawnArgs()).not.toContain("--system-prompt");
  expect(spawnArgs({ appendFile: "/tmp/x" })).not.toContain("--system-prompt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/identity-prompt.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — `HV_IDENTITY` is not exported from `src/main/appendSystem.ts`.

- [ ] **Step 3: Add the identity copy**

Append to `src/main/appendSystem.ts`:

```ts
/**
 * PRD §16 round 21: the paragraph that makes the agent HappyVibe.
 *
 * Pi's base prompt opens "You are an expert coding assistant operating inside
 * pi, a coding agent harness", so with nothing appended the agent introduces
 * itself as pi. This lands AFTER the base prompt and is therefore the last
 * word, which is all an identity needs — the base prompt itself is not
 * replaced, because it is tool-aware (its guidelines vary with which tools are
 * switched on) and replacing it means inheriting a prompt Pi keeps improving.
 *
 * Fixed app copy, deliberately not editable: the user's own additions layer is
 * the editable one, and both already show up in the read-only "Resolved prompt"
 * readout, so making this visible costs no new surface.
 *
 * It does NOT disown pi. Pi's own documentation block in the base prompt stays
 * the right answer for questions about extensions, skills or the SDK, because
 * that block describes the RUNTIME, which really is pi.
 */
export const HV_IDENTITY = [
  "You are the coding agent inside HappyVibe, a desktop app for coding with an agent.",
  "When you name yourself, you are HappyVibe — pi is the runtime you happen to run on, not what you are.",
  "The pi documentation this prompt points at is still the right source for questions about the runtime itself (extensions, skills, prompt templates, the SDK); it does not describe HappyVibe's own product surface.",
].join(" ");
```

- [ ] **Step 4: Pass both appends in the spawn argv**

In `src/main/pi/spawn.ts`, add to `PiSpawnOptions`:

```ts
  /**
   * §16 round 21: the global APPEND_SYSTEM.md, passed EXPLICITLY.
   *
   * `--append-system-prompt` REPLACES Pi's own discovery of this file rather
   * than adding to it (resource-loader.js only discovers `if (!appendSources)`),
   * so once we pass the identity we must pass the user's file too or their
   * additions silently vanish. Absent or non-existent ⇒ not passed at all: a
   * missing path is appended as LITERAL TEXT (resolvePromptInput returns a
   * non-path input verbatim), which would put a filesystem path in the prompt.
   *
   * Consequence, accepted as an improvement (PRD §16 round 21): passing the
   * flag also stops Pi discovering a WORKSPACE `.pi/APPEND_SYSTEM.md`. That
   * file used to REPLACE the global additions with nothing in the UI saying so;
   * it now has no effect, so a cloned repo cannot rewrite the system prompt.
   */
  appendFile?: string;
```

Add `import fs from "node:fs";` if absent, and insert into the `args` array immediately after the `--no-themes` entry:

```ts
      // §16 round 21: identity first, the user's own additions LAST — Pi joins
      // the sources with "\n\n" in argv order, so last wins on a conflict.
      "--append-system-prompt", HV_IDENTITY,
      ...(opts.appendFile && fs.existsSync(opts.appendFile) ? ["--append-system-prompt", opts.appendFile] : []),
```

Import at the top of `spawn.ts`: `import { HV_IDENTITY } from "../appendSystem";`

*(`appendSystem.ts` is electron-free — it imports only `node:fs`/`node:path` — so this keeps `spawn.ts` vitest-importable, which `tests/mcp-spawn.test.ts` depends on.)*

- [ ] **Step 5: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/identity-prompt.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire `appendFile` at every spawn site in main**

In `src/main/ipc.ts`, find the `spawnOpts` builder (the ONE place §16 finding 7's model resolution lives) and add `appendFile: globalAppendFile(agentDir())` to the returned options. Import `globalAppendFile` from `./appendSystem` if not already imported.

Verify no second spawn site was missed:

Run: `grep -n "resolvePiSpawn(" src/main/*.ts src/main/pi/*.ts`
Expected: exactly the definition in `spawn.ts` plus the single call in the spawn helper.

- [ ] **Step 7: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS. `tests/mcp-spawn.test.ts` and `tests/resource-gate-contract.test.ts` must both still pass — they assert argv contents and would catch a misplaced flag.

- [ ] **Step 8: Commit**

```bash
git add src/main/appendSystem.ts src/main/pi/spawn.ts src/main/ipc.ts tests/identity-prompt.test.ts
git commit -m "feat(identity): the agent says it is HappyVibe, appended not replaced"
```

**Verification — what is observably TRUE:**
- On the **System prompt** settings page, the *Resolved prompt* block ends with the HappyVibe identity sentence, and — if the user has additions — those come after it. Observed on Settings → System prompt, after one turn has run.
- Asking a **new** session *"what are you?"* answers HappyVibe, not pi. (Applies to new or restarted sessions only — Pi reads the prompt at session load.)
- **Absence assertion:** the resolved prompt contains **no** literal filesystem path ending in `APPEND_SYSTEM.md`. That is exactly what a missing-file bug would put there, and it cannot be screenshotted as a presence.
- **Absence assertion:** with the additions box **empty**, the resolved prompt contains the identity **once** — not twice, and not followed by a stray blank layer.
- **Regression to perform:** type additions, Save, start a **new** session, open Settings → System prompt: the identity and the additions are both present, in that order. Then delete the additions, Save, start another new session: the identity is still there and the additions are gone.

---

### Task 2: Every model row shows what it costs

**Files:**
- Create: `src/renderer/src/modelPrice.ts`
- Modify: `src/main/ipc.ts:3598-3606` (`hv:list-models` stops dropping `cost`, adds `billing`)
- Modify: `src/renderer/src/hv.d.ts` (`HvModel` gains `priceIn`/`priceOut`/`billing`/`priceTierAbove`)
- Modify: `src/renderer/src/components/ModelSelect.tsx` (render the price line)
- Test: `tests/model-price.test.ts` (new)

**Interfaces:**
- Consumes: `planProvidersFor(keyStatus)` and `providerKeyStatus()` — the §19 ledger's own resolver, `src/main/calls.ts`
- Produces:
  ```ts
  // src/renderer/src/modelPrice.ts
  export interface ModelPriceLike {
    billing?: "metered" | "plan" | "unknown";
    priceIn?: number;   // USD per MILLION tokens
    priceOut?: number;
    priceTierAbove?: number; // input tokens above which a higher tier applies
  }
  export function formatModelPrice(m: ModelPriceLike): string;
  export function modelPriceTitle(m: ModelPriceLike): string | undefined;
  ```

- [ ] **Step 1: Write the failing test**

`tests/model-price.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatModelPrice, modelPriceTitle } from "../src/renderer/src/modelPrice";

test("a metered model reads as in / out per million tokens", () => {
  expect(formatModelPrice({ billing: "metered", priceIn: 3, priceOut: 15 })).toBe("$3 / $15 per Mtok");
});

test("fractional rates keep two decimals, whole ones keep none", () => {
  expect(formatModelPrice({ billing: "metered", priceIn: 0.08, priceOut: 0.17 })).toBe("$0.08 / $0.17 per Mtok");
  expect(formatModelPrice({ billing: "metered", priceIn: 1, priceOut: 2.5 })).toBe("$1 / $2.50 per Mtok");
});

test("a subscription provider never shows dollars", () => {
  // PRD §19 ruling 3: Pi prices openai-codex at full API rates on a flat plan.
  const s = formatModelPrice({ billing: "plan", priceIn: 1.25, priceOut: 10 });
  expect(s).toBe("on your plan");
  expect(s).not.toMatch(/\$/);
});

test("an unpriced model says unknown, never $0", () => {
  // An unpriced model defaults to ALL-ZERO rates, so zero means "no price
  // exists" — rendering it as free is the §19 defect this exists to prevent.
  const s = formatModelPrice({ billing: "unknown", priceIn: 0, priceOut: 0 });
  expect(s).toBe("price unknown");
  expect(s).not.toMatch(/\$0/);
});

test("missing rates are unknown, not zero", () => {
  expect(formatModelPrice({})).toBe("price unknown");
  expect(formatModelPrice({ billing: "metered" })).toBe("price unknown");
  // HALF a price is worse than none — §19 ruling 4's "quietly half right".
  expect(formatModelPrice({ billing: "metered", priceIn: 3 })).toBe("price unknown");
});

test("a tiered model shows its base rate and names the threshold on hover", () => {
  const m = { billing: "metered" as const, priceIn: 1.25, priceOut: 10, priceTierAbove: 200_000 };
  expect(formatModelPrice(m)).toBe("$1.25 / $10 per Mtok");
  expect(modelPriceTitle(m)).toMatch(/above 200,000/);
});

test("an untiered model has no price tooltip to add", () => {
  expect(modelPriceTitle({ billing: "metered", priceIn: 3, priceOut: 15 })).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/model-price.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — cannot resolve `../src/renderer/src/modelPrice`.

- [ ] **Step 3: Write the formatter**

`src/renderer/src/modelPrice.ts`:

```ts
/**
 * PRD §16 round 21 — a model row's price, under §19's three-state billing rule.
 *
 * Pure so the no-DOM renderer suite can pin it. The three states are not a
 * nicety: a naive render of Pi's registry is wrong in BOTH directions. A
 * flat-subscription provider is priced at full API rates in Pi's table, so
 * showing its dollars invents spend; and an UNPRICED model defaults to all-zero
 * rates, so showing $0 claims a model is free when the truth is that no price
 * exists. Both were live defects in the cost ledger before §19 ruling 3.
 *
 * Rates are USD per MILLION tokens with no conversion applied: pi-ai computes
 * `usage.cost.input = (rates.input / 1_000_000) * usage.input`
 * (`pi-ai/dist/models.js:540`), so the registry figure IS the per-Mtok number.
 */

export interface ModelPriceLike {
  billing?: "metered" | "plan" | "unknown";
  /** USD per MILLION tokens. */
  priceIn?: number;
  priceOut?: number;
  /** Input-token threshold above which a higher pricing tier applies. */
  priceTierAbove?: number;
}

/** `$3`, `$2.50`, `$0.08` — two decimals only when they say something. */
const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}`;

const priced = (m: ModelPriceLike): boolean =>
  typeof m.priceIn === "number" && typeof m.priceOut === "number" && (m.priceIn > 0 || m.priceOut > 0);

export function formatModelPrice(m: ModelPriceLike): string {
  // Plan wins over everything, exactly as in the ledger: a covered call's
  // dollars are wrong whether Pi computed them or zeroed them.
  if (m.billing === "plan") return "on your plan";
  if (!priced(m)) return "price unknown";
  return `${usd(m.priceIn as number)} / ${usd(m.priceOut as number)} per Mtok`;
}

/** The hover note, or undefined when the row's own text is the whole truth. */
export function modelPriceTitle(m: ModelPriceLike): string | undefined {
  if (m.billing === "plan" || !priced(m)) return undefined;
  if (!m.priceTierAbove) return undefined;
  return `Base rate — a higher tier applies above ${m.priceTierAbove.toLocaleString("en-US")} input tokens`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/model-price.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS, 7 tests.

- [ ] **Step 5: Stop dropping `cost` in main, and classify it there**

Replace the body of `hv:list-models` in `src/main/ipc.ts` (currently around line 3598):

```ts
  // Live model list from Pi's registry (only models with configured auth).
  ipcMain.handle("hv:list-models", async () => {
    const c = await ensureUtility();
    const res = await c.send({ type: "get_available_models" });
    type RegistryModel = {
      provider: string;
      id: string;
      name?: string;
      contextWindow?: number;
      input?: string[];
      cost?: { input?: number; output?: number; tiers?: { inputTokensAbove?: number }[] };
    };
    const models = (res.data as { models?: RegistryModel[] })?.models ?? [];
    // §16 round 21: price is classified HERE, with the ledger's own resolver.
    // The renderer must never re-derive "is this a subscription" — two answers
    // to one question is how a page comes to disagree with the cost pill.
    const plans = planProvidersFor(providerKeyStatus());
    return models.map((m) => {
      const priceIn = m.cost?.input;
      const priceOut = m.cost?.output;
      // All-zero rates mean UNPRICED, not free: Pi's provider composer defaults
      // an unpriced model to zeros (PRD §19 ruling 3).
      const billing = plans.has(m.provider)
        ? "plan"
        : (priceIn ?? 0) > 0 || (priceOut ?? 0) > 0
          ? "metered"
          : "unknown";
      // Lowest threshold: the first tier the user could actually cross.
      const above = (m.cost?.tiers ?? [])
        .map((t) => t.inputTokensAbove)
        .filter((n): n is number => typeof n === "number" && n > 0)
        .sort((a, b) => a - b)[0];
      return {
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
        // contextWindow feeds B5's estimated-gauge fallback (when Pi didn't measure).
        contextWindow: m.contextWindow,
        // input (W2.1) gates the image-attach button: only vision models accept images.
        input: m.input,
        billing,
        priceIn,
        priceOut,
        ...(above ? { priceTierAbove: above } : {}),
      };
    });
  });
```

- [ ] **Step 6: Extend `HvModel`**

In `src/renderer/src/hv.d.ts`, add to `interface HvModel`:

```ts
  /** §16 round 21: §19's three billing states, classified in main. */
  billing?: "metered" | "plan" | "unknown";
  /** USD per MILLION tokens, straight from Pi's registry (no conversion). */
  priceIn?: number;
  priceOut?: number;
  /** Input-token threshold above which a higher pricing tier applies. */
  priceTierAbove?: number;
```

- [ ] **Step 7: Render it in the one dropdown all three surfaces share**

In `src/renderer/src/components/ModelSelect.tsx`: extend `HvModelLike` with the four optional fields, `import { formatModelPrice, modelPriceTitle } from "../modelPrice";`, and replace the row's second line so the id and the price sit on one line:

```tsx
                    <span className="block truncate">{m.name}</span>
                    <span className="flex items-baseline gap-2 font-mono text-[10px] text-ink-soft">
                      <span className="truncate">{m.provider}/{m.id}</span>
                      <span
                        className={`shrink-0 ml-auto ${m.billing === "unknown" ? "text-tangerine-deep" : ""}`}
                        title={modelPriceTitle(m)}
                      >
                        {formatModelPrice(m)}
                      </span>
                    </span>
```

Widen the menu so the price is not truncated away: change `menuWidthClassName = "w-72"` to `menuWidthClassName = "w-80"`.

- [ ] **Step 8: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS. `tests/models-view.test.ts` also consumes the model list — it must stay green.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/modelPrice.ts tests/model-price.test.ts src/main/ipc.ts src/renderer/src/hv.d.ts src/renderer/src/components/ModelSelect.tsx
git commit -m "feat(models): every model row shows what it costs, under the three-state rule"
```

**Verification — what is observably TRUE:**
- Opening the **chat top-bar model chip** shows a price on the right of every row's second line — `$0.08 / $0.17 per Mtok` for `deepseek/deepseek-v4-flash`.
- The **same** price text appears in **Settings → Models** (global default) and in **Workspace settings** (workspace override) — one component, three surfaces.
- **Absence assertion:** **no row anywhere reads `$0`, `$0.00` or `$0 / $0`.** An unpriced model reads `price unknown` in tangerine. This is the assertion that matters: `$0` is what the naive render produces and it cannot be seen as an absence.
- **Absence assertion:** for a signed-in subscription provider (`openai-codex` or `github-copilot`), no row shows a dollar figure at all — it reads `on your plan`, in the same muted ink as the model id, not in amber. Observed on **Settings → Models**, which is the page that owns the sign-in, not the chat chip that merely reads it.
- **Regression to perform:** add a custom endpoint with **no** prices (Settings → Models → add endpoint, leave $/Mtok blank), reopen the chat model chip — its row reads `price unknown`. Then edit the endpoint to set both rates and reopen: the row shows them. Setting only ONE rate must still read `price unknown`, never a half price.

---

### Task 3: Two palette tokens, and three coloured chips

**Files:**
- Modify: `src/renderer/src/styles.css` (two token pairs)
- Modify: `src/renderer/src/components/ChatView.tsx` (`AgentsChip` fill; `SkillsChip` unchanged)
- Test: `tests/chip-colours.test.ts` (new)

**Interfaces:**
- Produces: `CHIP_TONE` exported from `ChatView.tsx` — the mapping, as DATA, so the no-DOM suite can pin it.

- [ ] **Step 1: Write the failing test**

`tests/chip-colours.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { CHIP_TONE } from "../src/renderer/src/components/ChatView";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("skills, agents and MCP each get a DIFFERENT fill", () => {
  const tones = [CHIP_TONE.skills, CHIP_TONE.agents, CHIP_TONE.mcp];
  expect(new Set(tones).size).toBe(3);
  for (const t of tones) expect(t).toMatch(/^bg-\w+-soft text-\w+$/);
});

test("skills keeps plum — it was already coloured and the colour means skills", () => {
  expect(CHIP_TONE.skills).toBe("bg-plum-soft text-plum");
});

test("no chip borrows a colour that already means something else", () => {
  // leaf = success, berry = danger, sky = plan mode. Reusing one makes a
  // resource chip look like a state.
  const taken = ["leaf", "berry", "sky"];
  for (const t of Object.values(CHIP_TONE)) {
    for (const name of taken) expect(t).not.toContain(name);
  }
});

test("every colour a chip names is DEFINED in the palette", () => {
  // A Tailwind class for an undefined variable renders with no fill and no
  // error — exactly how `bg-plum` shipped unstyled for several rounds.
  const css = read("src/renderer/src/styles.css");
  for (const t of Object.values(CHIP_TONE)) {
    for (const cls of t.split(" ")) {
      const name = cls.replace(/^(bg|text)-/, "");
      expect(css, `--color-${name} must exist for ${cls}`).toContain(`--color-${name}:`);
    }
  }
});

test("the model and thinking chips stay the neutral mono pair", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  // Both are `font-mono … border-2 border-line bg-card` — the read-me pair.
  expect(src.match(/font-mono text-\[11px\] rounded-full border-2 border-line bg-card/g)?.length).toBe(2);
  // And neither is in the tone map at all.
  expect(Object.keys(CHIP_TONE).sort()).toEqual(["agents", "mcp", "skills"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/chip-colours.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — `CHIP_TONE` is not exported.

- [ ] **Step 3: Add the two token pairs**

In `src/renderer/src/styles.css`, after the `--color-plum-soft` line:

```css
  /* §7 round 21: the session-resource chips each need their own colour, and the
     palette had none free — leaf is success, berry is danger, sky is plan mode,
     plum is skills. Two added rather than borrowing one that already means
     something: a resource chip must not read as a state. */
  --color-teal: #2c8a86;
  --color-teal-soft: #dcefed;
  --color-rose: #c2478a;
  --color-rose-soft: #fae0ee;
```

- [ ] **Step 4: Export the mapping and use it**

Near the top of `src/renderer/src/components/ChatView.tsx`:

```tsx
/**
 * §7 round 21 — the session-resource chips: skills, agents, MCP.
 *
 * Exported as DATA because the renderer suite has no DOM: the mapping is
 * pinned by tests/chip-colours.test.ts, which also checks each colour is
 * actually DEFINED in styles.css (a Tailwind class for an undefined variable
 * renders with no fill and no error — that is how `bg-plum` shipped unstyled).
 *
 * The model and thinking chips are deliberately NOT here. They are the two you
 * READ; these three are things you EXPLORE, and keeping the read-me pair
 * neutral mono is what lets three fills coexist without a carnival.
 *
 * This reverses the 2026-08-30 decision to keep the agents chip a quiet
 * outline. That was right when it was the only coloured chip's neighbour; with
 * three coloured siblings it made agents the odd one out rather than the
 * restrained one.
 */
export const CHIP_TONE = {
  skills: "bg-plum-soft text-plum",
  agents: "bg-teal-soft text-teal",
  mcp: "bg-rose-soft text-rose",
} as const;
```

In `SkillsChip`, replace the literal `bg-plum-soft text-plum` with `${CHIP_TONE.skills}`.

In `AgentsChip`, replace the whole quiet-outline `className` with the filled form:

```tsx
        className={`flex items-center gap-1 rounded-full ${CHIP_TONE.agents} text-[11px] font-bold px-2 py-0.5 cursor-pointer hover:brightness-105`}
```

and delete the now-false "Quiet by design (2026-08-30)" comment above it, replacing it with:

```tsx
        // §7 round 21: filled, like its two siblings. It was a bare outline
        // (2026-08-30) while it was the only uncoloured chip beside one
        // coloured one; with skills, agents and MCP all coloured, an outline
        // reads as disabled rather than as restrained.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/chip-colours.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS, 5 tests. (The MCP entry is already asserted here; its chip lands in Task 4 and this test does not depend on it rendering yet.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/ChatView.tsx tests/chip-colours.test.ts
git commit -m "feat(chat): the session-resource chips get three colours, and two palette tokens to do it"
```

**Verification — what is observably TRUE:**
- In the chat top bar: the skills chip is **purple-filled**, the agents chip is **teal-filled**, both with dark text on a pale ground. Neither is an outline.
- **Absence assertion:** the agents chip has **no border and no grey text** — it is not the outline it used to be. An outline is what "the colour token is undefined" also looks like, so check the fill, not the presence of a chip.
- **Absence assertion:** the **model** and **think:** chips are still bordered mono, with **no** fill colour — the round did not colour all five.
- **Regression to perform:** with plan mode ON and a plan drafted, all five surfaces are visible at once — the blue plan-mode pill and blue plan pill must still be the only blue things in the bar, distinguishable at a glance from the three resource chips.

---

### Task 4: MCP becomes a top-bar chip and leaves the `+` menu

**Files:**
- Create: `src/renderer/src/mcpChip.ts`
- Modify: `src/renderer/src/components/ChatView.tsx` (new `McpChip`; delete the `+` menu's MCP row and submenu, `mcpSubOpen` state and its fetch effect)
- Test: `tests/mcp-chip.test.ts` (new)

**Interfaces:**
- Consumes: `window.hv.mcpStatus()`, `window.hv.onMcpStatusChanged(cb)`, `McpServerStatusLike { name, scope, workspaceId, state, toolCount }`; `CHIP_TONE.mcp` from Task 3
- Produces:
  ```ts
  // src/renderer/src/mcpChip.ts
  export interface McpRowLike { name: string; scope: "global" | "workspace"; workspaceId: string | null; state: string }
  export function serversForWorkspace<T extends McpRowLike>(all: T[], workspace: string | null): T[];
  export function mcpChipLabel(rows: McpRowLike[]): string;
  ```

- [ ] **Step 1: Write the failing test**

`tests/mcp-chip.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { mcpChipLabel, serversForWorkspace } from "../src/renderer/src/mcpChip";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

const row = (name: string, scope: "global" | "workspace", workspaceId: string | null, state: string) =>
  ({ name, scope, workspaceId, state });

test("global servers always count; a workspace server counts only for ITS workspace", () => {
  const all = [
    row("github", "global", null, "connected"),
    row("mine", "workspace", "/a", "connected"),
    row("theirs", "workspace", "/b", "connected"),
  ];
  expect(serversForWorkspace(all, "/a").map((r) => r.name)).toEqual(["github", "mine"]);
  expect(serversForWorkspace(all, "/b").map((r) => r.name)).toEqual(["github", "theirs"]);
});

test("with no workspace, only global servers count", () => {
  const all = [row("github", "global", null, "connected"), row("mine", "workspace", "/a", "connected")];
  expect(serversForWorkspace(all, null).map((r) => r.name)).toEqual(["github"]);
});

test("the label is connected-of-total", () => {
  expect(mcpChipLabel([row("a", "global", null, "connected"), row("b", "global", null, "failed")])).toBe("1/2 MCP");
  expect(mcpChipLabel([row("a", "global", null, "connected")])).toBe("1/1 MCP");
});

test("only `connected` counts as connected — needs-auth and checking do not", () => {
  const rows = ["connected", "needs-auth", "failed", "checking"].map((s, i) => row(`s${i}`, "global", null, s));
  // A server that needs auth is exactly the one the chip exists to surface;
  // counting it as connected would hide it.
  expect(mcpChipLabel(rows)).toBe("1/4 MCP");
});

test("the + menu no longer offers MCP", () => {
  // Absence, as a source scan: the no-DOM suite cannot fail on a row that
  // renders, and this row is what moving MCP to the top bar removes.
  const src = read("src/renderer/src/components/ChatView.tsx");
  expect(src).not.toMatch(/mcpSubOpen/);
  expect(src).not.toMatch(/v5: MCP submenu/);
});

test("the + menu is exactly the two attach rows", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  const menu = src.slice(src.indexOf("attachMenuOpen && ("), src.indexOf("§23: plan-mode toggle"));
  expect(menu).toContain("Attach image");
  expect(menu).toContain("Attach document");
  expect(menu).not.toContain("Edit AGENTS.md"); // Task 6
  expect(menu).not.toContain("Manage…");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/mcp-chip.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — cannot resolve `../src/renderer/src/mcpChip`.

- [ ] **Step 3: Write the pure half**

`src/renderer/src/mcpChip.ts`:

```ts
/**
 * §7 round 21 — the MCP chip's policy, pure so the no-DOM suite can pin it.
 *
 * The workspace filter is a BUG FIX riding along: the `+` menu's submenu this
 * chip replaces listed every configured server, including ones belonging to a
 * workspace this session has nothing to do with — so a session showed servers
 * it could not call.
 */

export interface McpRowLike {
  name: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  state: string;
}

/** Global servers, plus this workspace's own. Order preserved. */
export function serversForWorkspace<T extends McpRowLike>(all: T[], workspace: string | null): T[] {
  return all.filter((r) => r.scope === "global" || (workspace != null && r.workspaceId === workspace));
}

/**
 * `2/3 MCP` — the same connected-of-total shape the skills chip uses.
 *
 * Only `connected` counts. A server that is failing or needs auth is precisely
 * what this chip exists to surface, so folding either into the numerator would
 * hide the one thing worth glancing at.
 */
export function mcpChipLabel(rows: McpRowLike[]): string {
  const up = rows.filter((r) => r.state === "connected").length;
  return `${up}/${rows.length} MCP`;
}
```

- [ ] **Step 4: Add the chip and delete the submenu**

In `src/renderer/src/components/ChatView.tsx`:

1. `import { mcpChipLabel, serversForWorkspace } from "../mcpChip";`
2. Replace the lazily-fetched submenu state with an always-live list:

```tsx
  // §7 round 21: MCP is a top-bar chip, so the list is live rather than fetched
  // when a submenu opens. `onMcpStatusChanged` already exists — a sweep, an
  // auth, or a server being added all push through it.
  const [mcpServers, setMcpServers] = useState<McpServerStatusLike[] | null>(null);
```

3. Delete `const [mcpSubOpen, setMcpSubOpen] = useState(false);` and replace its fetch effect with:

```tsx
  useEffect(() => {
    window.hv.mcpStatus().then(setMcpServers).catch(() => setMcpServers([]));
    return window.hv.onMcpStatusChanged(setMcpServers);
  }, []);
```

4. Derive the session's own rows, beside the other resolved values:

```tsx
  const mcpRows = mcpServers ? serversForWorkspace(mcpServers, workspace ?? null) : null;
```

5. In the top bar, after `<AgentsChip … />`:

```tsx
        {mcpRows && mcpRows.length > 0 && <McpChip rows={mcpRows} onManage={onOpenMcp} />}
```

6. Add the component beside `SkillsChip`:

```tsx
/**
 * §7 round 21 — MCP joins skills and agents in the top bar.
 *
 * It replaces the `+` menu's submenu wholesale: `+` is for attaching things,
 * and a list of connected servers is not something you attach. Dismissal is the
 * `fixed inset-0` click-catcher every other menu here uses, NOT onBlur —
 * pressing a button does not focus it, so a blur-dismissed menu unmounts
 * between mousedown and mouseup and loses its own clicks.
 */
function McpChip({
  rows,
  onManage,
}: {
  rows: McpServerStatusLike[];
  onManage?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const up = rows.filter((r) => r.state === "connected").length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${up} of ${rows.length} MCP server${rows.length === 1 ? "" : "s"} connected for this session`}
        className={`flex items-center gap-1 rounded-full ${CHIP_TONE.mcp} text-[11px] font-bold px-2 py-0.5 cursor-pointer hover:brightness-105`}
      >
        <span aria-hidden>🔌</span> {mcpChipLabel(rows)}
      </button>
      {open && <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 w-64 max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1.5 text-sm">
          {rows.map((s) => (
            <div key={`${s.scope}:${s.name}`} className="flex items-center gap-2 px-3 py-1">
              <span
                className={`size-2 rounded-full shrink-0 ${
                  s.state === "connected" ? "bg-leaf" : s.state === "checking" ? "bg-honey" : "bg-berry"
                }`}
                title={s.state}
              />
              <span className="flex-1 min-w-0 truncate font-medium">{s.name}</span>
              <span className="text-[9px] uppercase tracking-wide text-ink-soft shrink-0">{s.state}</span>
            </div>
          ))}
          {onManage && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onManage(); }}
              className="w-full text-left px-3 py-1.5 text-[12px] font-bold text-tangerine-deep hover:bg-paper-deep/40 cursor-pointer"
            >
              Manage…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

7. Delete the `+` menu's MCP button and its whole `{mcpSubOpen && ( … )}` block, and drop `setMcpSubOpen(false)` from the menu's click-catcher.

- [ ] **Step 5: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/mcp-chip.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: PASS, 6 tests. The "exactly two attach rows" test still fails on `Edit AGENTS.md` until Task 6 — if so, run only the first five here and re-run the file at the end of Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/mcpChip.ts tests/mcp-chip.test.ts src/renderer/src/components/ChatView.tsx
git commit -m "feat(chat): MCP becomes a top-bar chip, filtered to this workspace"
```

**Verification — what is observably TRUE:**
- With one global MCP server connected, the chat top bar shows a **rose-filled `1/1 MCP`** chip beside the agents chip. Clicking it lists the server with a green dot and `Manage…`.
- Clicking `Manage…` navigates to the **MCP** settings page.
- **Absence assertion:** the `+` menu has **no MCP row and no submenu** — it contains exactly *Attach image* and *Attach document*. (With Task 6, that is the whole menu.)
- **Absence assertion:** a server configured in workspace **B** does **not** appear in a session opened on workspace **A**, and does not count in A's `n/m`. Observed by configuring it on the **Workspace settings → MCP** page of B, then reading the chip in a chat on A — the surface that owns the resource is not the surface that reveals the bug.
- **Absence assertion:** with **no** MCP servers configured at all, there is **no** chip — not a `0/0 MCP` chip.
- **Regression to perform:** open the chip's menu, then click the skills chip: the MCP menu closes and the skills menu opens (the `fixed inset-0` catcher must not swallow the second click). Then add a server on the MCP page and return to chat without reloading — the chip's count goes up on its own, via `onMcpStatusChanged`.

---

### Task 5: The top bar wraps to a second line

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx:795` (the top-bar container)
- Test: `tests/chat-topbar.test.ts` (new)

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Write the failing test**

`tests/chat-topbar.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const src = readFileSync(path.join(__dirname, "..", "src/renderer/src/components/ChatView.tsx"), "utf8");
/** The top-bar container's className, up to the plan-pill group. */
const bar = src.slice(src.indexOf("v5.1: search + context bubble"), src.indexOf("§23: compact plan-mode indicator"));

test("the bar wraps instead of squeezing its chips", () => {
  expect(bar).toContain("flex-wrap");
});

test("its height is a MINIMUM, not a fixed one", () => {
  // `h-11` cannot grow, so wrapped chips would overflow the bar's own box and
  // paint over the transcript — the fixed height is the bug, not the wrapping.
  expect(bar).toContain("min-h-11");
  expect(bar).not.toMatch(/\bh-11\b/);
});

test("it stays shrink-0 so a wrapped bar takes room from the transcript, not from itself", () => {
  expect(bar).toContain("shrink-0");
});

test("there is no overflow menu — a hidden control is worse than a taller bar", () => {
  expect(bar).not.toMatch(/⋯|overflowMenu/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/chat-topbar.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL on `flex-wrap` and `min-h-11`.

- [ ] **Step 3: Make the bar wrap**

Change the top-bar container in `src/renderer/src/components/ChatView.tsx` from:

```tsx
      <div className="flex items-center justify-end gap-1.5 px-3 h-11 border-b-2 border-line bg-paper shrink-0">
```

to:

```tsx
      {/* §7 round 21: the bar WRAPS. It was a fixed-height single row, so in a
          narrow split pane the model, thinking, skills, agents, MCP and plan
          chips squeezed each other rather than taking a second line. The height
          is a minimum: with `h-11` a wrapped row overflows the bar's own box and
          paints over the transcript, so the fixed height was the actual bug.
          No overflow menu — a control hidden behind `⋯` is worse than a taller
          bar, and this bar is read at a glance. */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 px-3 py-1.5 min-h-11 border-b-2 border-line bg-paper shrink-0">
```

Also add `min-w-0` to the `mr-auto` group so it yields before the right-hand cluster does:

```tsx
        <div className="mr-auto min-w-0 flex flex-wrap items-center gap-1.5">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/chat-topbar.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatView.tsx tests/chat-topbar.test.ts
git commit -m "feat(chat): the top bar takes a second line rather than squeezing its chips"
```

**Verification — what is observably TRUE:**
- Split the centre into two side-by-side chats and narrow one: its top bar takes **two lines**, with the search / cost / context cluster staying together on the right.
- **Absence assertion:** **no chip is clipped, truncated to an ellipsis, or pushed off the right edge** at the narrowest pane width the divider allows. Clipping is what the fixed-height row did and it is not visible as a missing element — check the last chip on the row, not the first.
- **Absence assertion:** the wrapped bar does **not** overlap the first transcript message — the transcript starts below it.
- **Regression to perform:** at a **wide** pane, the bar is still a **single** line of the same height it was (`min-h-11` must not have added permanent vertical padding). Then turn plan mode on at a narrow width — the bar grows to two lines and the `Wrap up` / `✕` controls remain clickable.

---

### Task 6: The `+` menu loses "Edit AGENTS.md"

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx:1506-1514` (delete the row)
- Test: `tests/mcp-chip.test.ts` (the "exactly the two attach rows" test from Task 4 now passes), `tests/agents-md-panel.test.ts` (add the surviving-routes assertion)

**Interfaces:**
- Consumes: `onOpenAgentsMd` stays a ChatView prop — the AGENTS.md **offer banner** still calls it.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/agents-md-panel.test.ts`:

```ts
test("the + menu no longer opens the AGENTS.md editor", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  const menu = src.slice(src.indexOf("attachMenuOpen && ("), src.indexOf("§23: plan-mode toggle"));
  expect(menu).not.toContain("Edit AGENTS.md");
  expect(menu).not.toContain("project context for the agent");
});

test("but the editor is still reachable — the banner and the file tree both open it", () => {
  // Removing the menu row must not orphan the panel. These are the two
  // surviving routes and they are both source-pinned, because the no-DOM suite
  // cannot click either one.
  const chat = read("src/renderer/src/components/ChatView.tsx");
  // The "no AGENTS.md here" banner's Generate one button.
  expect(chat).toMatch(/setOfferAgentsMd\(false\); onOpenAgentsMd\(\)/);
  // Clicking any AGENTS.md in the file tree opens the dialog, not a plain tab.
  const app = read("src/renderer/src/App.tsx");
  expect(app).toMatch(/tabBasename\(rel\) === "AGENTS\.md"/);
  expect(app).toMatch(/setAgentsMd\(rel\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-panel.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL on the first new test — `Edit AGENTS.md` is still in the menu.

- [ ] **Step 3: Delete the row**

Remove the whole `{/* WS7: AGENTS.md editor (replaces the removed header chip). */}` button block from the `+` menu in `src/renderer/src/components/ChatView.tsx`.

Leave the `onOpenAgentsMd` prop and its type in place, and note why above the offer banner's button:

```tsx
          {/* §7 round 21: this and the file tree are the two remaining routes to
              the AGENTS.md editor — the `+` menu's row is gone, because `+` is
              for attaching things and editing project context is not one. */}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-panel.test.ts tests/mcp-chip.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS — including Task 4's "exactly the two attach rows" test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChatView.tsx tests/agents-md-panel.test.ts
git commit -m "feat(chat): the + menu is attachments only"
```

**Verification — what is observably TRUE:**
- The `+` menu shows exactly **two** rows: *Attach image* and *Attach document*.
- **Absence assertion:** *Edit AGENTS.md* appears **nowhere** in the `+` menu.
- Clicking `AGENTS.md` in the **file tree** still opens the AGENTS.md dialog (not a plain editor tab). Observed on the **Files** drawer, which is the surface that now owns the route.
- **Regression to perform:** open a workspace that has **no** `AGENTS.md`, start a session — the honey banner still appears and *Generate one* still opens the dialog. Then, in a workspace that **has** one, confirm the banner is absent and the file tree is the route.

---

### Task 7: A session's dialogs open over that session's pane

**Files:**
- Create: `src/renderer/src/paneDialog.ts`
- Modify: `src/renderer/src/App.tsx` (a pane-host ref map; `relative` on the chat pane wrapper; pass `container` to the two modals)
- Modify: `src/renderer/src/components/PermissionModal.tsx`, `src/renderer/src/components/AskUserModal.tsx` (accept `container`, switch `fixed`→`absolute` when scoped)
- Test: `tests/pane-dialog.test.ts` (new); `tests/modal-layer.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // src/renderer/src/paneDialog.ts
  export function dialogHost(el: HTMLElement | null | undefined): HTMLElement | null;
  export const SCOPED_OVERLAY: string;
  export const SCOPED_CONTENT: string;
  export const VIEWPORT_OVERLAY: string;
  export const VIEWPORT_CONTENT: string;
  ```

- [ ] **Step 1: Write the failing test**

`tests/pane-dialog.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { SCOPED_CONTENT, SCOPED_OVERLAY, VIEWPORT_CONTENT, VIEWPORT_OVERLAY, dialogHost } from "../src/renderer/src/paneDialog";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("a HIDDEN pane is not a host — the dialog must fall back to the viewport", () => {
  // The chat pane wrapper is `hidden` whenever the user is on a settings page.
  // Portalling a permission prompt into a hidden element makes it invisible,
  // and permission prompts NEVER time out — the agent would hang forever with
  // nothing on screen. This is the one failure mode that must not exist.
  expect(dialogHost({ offsetParent: null, getClientRects: () => [] } as unknown as HTMLElement)).toBeNull();
  expect(dialogHost(null)).toBeNull();
  expect(dialogHost(undefined)).toBeNull();
});

test("a visible pane IS a host", () => {
  const el = { offsetParent: {}, getClientRects: () => [{ width: 400, height: 300 }] } as unknown as HTMLElement;
  expect(dialogHost(el)).toBe(el);
});

test("a zero-sized pane is not a host either", () => {
  const el = { offsetParent: {}, getClientRects: () => [] } as unknown as HTMLElement;
  expect(dialogHost(el)).toBeNull();
});

test("scoped uses absolute; viewport keeps fixed", () => {
  // A composited WebContentsView has no z-index relative to the DOM, so the
  // point of scoping is that the scrim stops lying across every pane.
  expect(SCOPED_OVERLAY).toContain("absolute");
  expect(SCOPED_OVERLAY).not.toMatch(/\bfixed\b/);
  expect(VIEWPORT_OVERLAY).toContain("fixed");
});

test("both variants keep the dialog layer classes that own z-index 100", () => {
  for (const c of [SCOPED_OVERLAY, VIEWPORT_OVERLAY]) expect(c).toContain("hv-overlay");
  for (const c of [SCOPED_CONTENT, VIEWPORT_CONTENT]) expect(c).toContain("hv-dialog");
});

test("a scoped dialog is CLAMPED to its pane and scrolls inside it", () => {
  // A narrow pane must not push the dialog out over its neighbour — which is
  // the browser pane this whole change exists to stop covering.
  expect(SCOPED_CONTENT).toMatch(/max-w-\[calc\(100%-1\.5rem\)\]/);
  expect(SCOPED_CONTENT).toMatch(/max-h-\[calc\(100%-1\.5rem\)\]/);
  expect(SCOPED_CONTENT).toContain("overflow-y-auto");
});

test("only the two SESSION dialogs are scoped", () => {
  const app = read("src/renderer/src/App.tsx");
  const scoped = [...app.matchAll(/container=\{paneHost\(/g)].length;
  expect(scoped).toBe(2); // PermissionModal + AskUserModal, nothing else
  for (const other of ["AgentsMdPanel", "AuthFlowModal", "OnboardingDialog"]) {
    const at = app.indexOf(`<${other}`);
    expect(at, `${other} must be rendered`).toBeGreaterThan(-1);
    expect(app.slice(at, at + 400)).not.toContain("container=");
  }
});

test("the chat pane wrapper is POSITIONED, or an absolute dialog lands elsewhere", () => {
  const app = read("src/renderer/src/App.tsx");
  expect(app).toMatch(/data-hv-pane-session=\{sid\}/);
  const at = app.indexOf("data-hv-pane-session={sid}");
  expect(app.slice(at - 400, at + 400)).toMatch(/\brelative\b/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/pane-dialog.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — cannot resolve `../src/renderer/src/paneDialog`.

- [ ] **Step 3: Write the policy module**

`src/renderer/src/paneDialog.ts`:

```ts
/**
 * §7 round 21 — a session's dialogs render inside that session's pane.
 *
 * WHY, and it is a §28 reason rather than a taste one: a viewport-wide dialog
 * and its viewport-wide scrim lie across EVERY pane, which is exactly the
 * situation where a composited `WebContentsView` and the DOM contend over which
 * is on top. The app's answer to that contention is to HIDE the page — so a
 * permission prompt about one session blanked a browser in another. A dialog
 * scoped to one pane never overlaps a browser in a different pane, so the
 * question stops being asked rather than being answered better.
 *
 * Pure so the no-DOM suite can pin it.
 */

/**
 * The pane element to portal into, or null to fall back to the viewport.
 *
 * The null cases are load-bearing, not defensive. A chat pane wrapper is
 * `hidden` whenever the user is on a settings page, and portalling a permission
 * prompt into a hidden element makes it INVISIBLE — while permission prompts
 * never time out by design, so the agent would wait forever with nothing on
 * screen. Same for a pane whose tab was closed while its session kept running.
 */
export function dialogHost(el: HTMLElement | null | undefined): HTMLElement | null {
  if (!el) return null;
  // `offsetParent === null` covers display:none on the element or any ancestor.
  if (el.offsetParent === null) return null;
  // And a positioned-but-collapsed pane has no box to centre anything in.
  return el.getClientRects().length > 0 ? el : null;
}

/** Scoped: absolute within the pane, which must therefore be `relative`. */
export const SCOPED_OVERLAY = "hv-overlay absolute inset-0 bg-ink/50 backdrop-blur-[2px]";
/**
 * Clamped to the pane and scrolling inside it: a narrow pane must not push the
 * dialog out over its neighbour, which is the browser pane this exists to stop
 * covering. `1.5rem` leaves the same visual inset the viewport variant has.
 */
export const SCOPED_CONTENT =
  "hv-dialog absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto";

/** Viewport: what every dialog did before, and still the fallback. */
export const VIEWPORT_OVERLAY = "hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]";
export const VIEWPORT_CONTENT = "hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
```

- [ ] **Step 4: Teach the two modals to be scoped**

In both `PermissionModal.tsx` and `AskUserModal.tsx`: add `container?: HTMLElement | null` to the props, import the four constants, and swap the hard-coded classes:

```tsx
        <Dialog.Portal container={container ?? undefined}>
          <Dialog.Overlay className={container ? SCOPED_OVERLAY : VIEWPORT_OVERLAY} />
          <Dialog.Content
            className={`${container ? SCOPED_CONTENT : VIEWPORT_CONTENT} w-[min(30rem,calc(100vw-3rem))] rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none`}
```

(`AskUserModal` keeps its own width expression — only the leading positioning classes change.)

- [ ] **Step 5: Wire the host map in App**

In `src/renderer/src/App.tsx`:

```tsx
  /**
   * §7 round 21: each chat pane's element, so a session's dialogs can portal
   * into the pane that raised them. A ref rather than state: the panes mount
   * long before any prompt arrives, and re-rendering App on every pane mount
   * to store a DOM node would be churn for nothing.
   */
  const paneHosts = useRef(new Map<string, HTMLDivElement>());
  const paneHost = useCallback(
    (sessionId: string | undefined): HTMLElement | null =>
      dialogHost(sessionId ? paneHosts.current.get(sessionId) : null),
    [],
  );
```

On the chat pane wrapper (the `<div style={{ gridArea: area }}>` inside `chatSessions.map`), add the marker, the ref and `relative`:

```tsx
              data-hv-pane-session={sid}
              ref={(el) => {
                if (el) paneHosts.current.set(sid, el);
                else paneHosts.current.delete(sid);
              }}
              className={`relative min-h-0 min-w-0 flex-col ${paneDivider(area)} ${activeView === "chat" && area ? "flex" : "hidden"}`}
```

And pass the container to the two modals:

```tsx
      {uiReq?.kind === "permission" && (
        <PermissionModal req={uiReq.req} info={uiReq.info} onChoice={respondPermission} container={paneHost(uiReq.req.sessionId)} />
      )}
      {uiReq?.kind === "askUser" && (
        <AskUserModal key={uiReq.req.id} ask={uiReq.ask} onSubmit={respondAskUser} onDismiss={() => respondAskUser(null)} container={paneHost(uiReq.req.sessionId)} />
      )}
```

Import `dialogHost` from `./paneDialog`.

- [ ] **Step 6: Extend the layer test**

Append to `tests/modal-layer.test.ts`:

```ts
test("a pane-scoped dialog keeps the z-100 layer classes", () => {
  // `.hv-overlay` / `.hv-dialog` are what put a dialog above the app's z-50
  // ceiling. Switching `fixed` to `absolute` must not drop them, or every
  // z-20 sticky card in the pane paints over the scrim again.
  for (const f of ["src/renderer/src/components/PermissionModal.tsx", "src/renderer/src/components/AskUserModal.tsx"]) {
    const src = readFileSync(path.join(__dirname, "..", f), "utf8");
    expect(src).toContain("SCOPED_OVERLAY");
    expect(src).toContain("VIEWPORT_OVERLAY");
    // And neither file hard-codes its own positioning any more.
    expect(src).not.toContain("hv-overlay fixed inset-0");
  }
});
```

- [ ] **Step 7: Run the tests**

Run: `L=/tmp/v.log; npx vitest run tests/pane-dialog.test.ts tests/modal-layer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: PASS.

- [ ] **Step 8: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/paneDialog.ts tests/pane-dialog.test.ts tests/modal-layer.test.ts src/renderer/src/App.tsx src/renderer/src/components/PermissionModal.tsx src/renderer/src/components/AskUserModal.tsx
git commit -m "feat(chat): a session's permission and ask-user dialogs open over its own pane"
```

**Verification — what is observably TRUE:**
- Session in the left pane, **browser in the right**. Trigger a permission prompt in the left session: the prompt is centred **over the left pane**, its scrim dims **only** the left pane, and the **browser on the right keeps rendering its page** throughout.
- The prompt's buttons are clickable and the agent proceeds on Allow.
- **Absence assertion:** the right-hand browser pane does **not** go blank or white at any point while the prompt is up. Blanking is the current behaviour, so this is the whole test — watch the right pane, not the dialog.
- **Absence assertion:** the AGENTS.md dialog, the provider auth modal and the onboarding card are **still viewport-centred with a full-window scrim** — this round scoped exactly two dialogs, and an app-level dialog has no pane to sit over.
- **Absence assertion, the dangerous one:** trigger a permission prompt, then — while it is pending — navigate to **Settings → Models**. The prompt must still be **visible** (viewport-centred, because its pane is now hidden), never invisible-but-pending. Reproduce it the other way too: be on a settings page when a prompt arrives.
- **Regression to perform:** split the centre into two chats, start a turn in each so both raise a prompt. Answer the right one first, then the left: each prompt must appear over its **own** pane, and answering one must not dismiss or move the other.

---

### Task 8: Main writes the AGENTS.md draft, on every surface

The dialog listened for a BLOCKING delegation's result; delegations are async by default, and an async dispatch carries no results. Nothing was listening on the path that actually fires, and in chat nothing was listening at all.

**Files:**
- Modify: `src/main/agentsMd.ts` (move `parseAgentsMdOutput` here; add `finalTextFromSessionFile`)
- Modify: `src/main/ipc.ts:1436-1465` (write on `stage === "complete"`; push `hv:agents-md-written`)
- Modify: `src/renderer/src/agents.ts` (delete `parseAgentsMdOutput` and `AGENTS_MD_FENCE`)
- Modify: `src/renderer/src/components/AgentsMdPanel.tsx` (stop parsing; listen for the event)
- Modify: `src/renderer/src/hv.d.ts`, `src/preload/index.ts` (the new event)
- Test: `tests/agents-md-capture.test.ts` (retarget + new cases)

**Interfaces:**
- Consumes: `writeAgentsMdFiles(registeredWorkspaces, workspaceId, files)`, `readSessionFile(sessionDirPath, file)` from `./store`, `delegatedAgentByRun` and `childSessionsByRun` (both already live in `ipc.ts`)
- Produces:
  ```ts
  // src/main/agentsMd.ts
  export function parseAgentsMdOutput(finalOutput: string): Record<string, string> | null;
  export function finalTextFromSessionFile(jsonl: string | null | undefined): string;
  // renderer event
  onAgentsMdWritten(cb: (p: { workspaceId: string; files: string[] }) => void): () => void;
  ```

- [ ] **Step 1: Write the failing test**

Rewrite the header of `tests/agents-md-capture.test.ts` to import from main, and append the new cases:

```ts
/**
 * WS5 + §15 round 21: the agents-md-maker structured-output contract, and the
 * reader that gets its FULL answer out of the child's own session file.
 *
 * The parser moved from the renderer to main in round 21, because main is now
 * the writer on every surface — the renderer copy had exactly one caller (a
 * dialog), which is why a draft run from chat was never written at all.
 */
import { expect, test } from "vitest";
import { finalTextFromSessionFile, parseAgentsMdOutput } from "../src/main/agentsMd";
```

Then append:

```ts
const line = (role: string, content: unknown): string => JSON.stringify({ type: "message", message: { role, content } });

test("the child's final answer is the LAST assistant message's text blocks", () => {
  const jsonl = [
    line("user", [{ type: "text", text: "draft it" }]),
    line("assistant", [{ type: "thinking", thinking: "let me look" }, { type: "toolCall", name: "ls" }]),
    line("assistant", [{ type: "text", text: "```json agents-md\n{\"files\":{\"AGENTS.md\":\"# p\"}}\n```" }]),
  ].join("\n");
  expect(parseAgentsMdOutput(finalTextFromSessionFile(jsonl))).toEqual({ "AGENTS.md": "# p" });
});

test("several text blocks in the final message are joined", () => {
  const jsonl = line("assistant", [{ type: "text", text: "a" }, { type: "text", text: "b" }]);
  expect(finalTextFromSessionFile(jsonl)).toBe("ab");
});

test("thinking and toolCall blocks are not part of the answer", () => {
  const jsonl = line("assistant", [
    { type: "thinking", thinking: "secret" },
    { type: "toolCall", name: "read", arguments: { path: "x" } },
    { type: "text", text: "answer" },
  ]);
  expect(finalTextFromSessionFile(jsonl)).toBe("answer");
});

test("an assistant message with no text falls back to the previous one", () => {
  // A child whose last turn was pure tool calls still has an answer earlier.
  const jsonl = [
    line("assistant", [{ type: "text", text: "the answer" }]),
    line("assistant", [{ type: "toolCall", name: "ls" }]),
  ].join("\n");
  expect(finalTextFromSessionFile(jsonl)).toBe("the answer");
});

test("a plain-string content is read too", () => {
  expect(finalTextFromSessionFile(line("assistant", "just a string"))).toBe("just a string");
});

test("a torn last line is skipped, not thrown", () => {
  // The file is appended live; the tail can be half-written.
  const jsonl = line("assistant", [{ type: "text", text: "ok" }]) + '\n{"type":"mes';
  expect(finalTextFromSessionFile(jsonl)).toBe("ok");
});

test("nothing at all yields the empty string, never a throw", () => {
  expect(finalTextFromSessionFile(null)).toBe("");
  expect(finalTextFromSessionFile("")).toBe("");
  expect(finalTextFromSessionFile(line("user", [{ type: "text", text: "hi" }]))).toBe("");
});

test("the renderer no longer parses the draft — main does", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
  expect(read("src/renderer/src/agents.ts")).not.toContain("parseAgentsMdOutput");
  const panel = read("src/renderer/src/components/AgentsMdPanel.tsx");
  expect(panel).not.toContain("parseAgentsMdOutput");
  expect(panel).not.toContain("writeAgentsMdFiles");
  // It listens for the write instead of doing it.
  expect(panel).toContain("onAgentsMdWritten");
});

test("main writes on the ASYNC completion path — the one that actually fires", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const ipc = readFileSync(path.join(__dirname, "..", "src/main/ipc.ts"), "utf8");
  const at = ipc.indexOf('sub.stage === "complete"');
  expect(at).toBeGreaterThan(-1);
  const block = ipc.slice(at, at + 3000);
  expect(block).toContain("agents-md-maker");
  expect(block).toContain("writeAgentsMdFiles");
  // It reads the child's SESSION FILE, not the notify: the notify's summary is
  // capped at 500 chars in the bridge and would truncate a real draft.
  expect(block).toContain("finalTextFromSessionFile");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-capture.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: FAIL — `finalTextFromSessionFile` is not exported from `src/main/agentsMd.ts`.

- [ ] **Step 3: Move the parser and add the reader**

Cut `AGENTS_MD_FENCE` and `parseAgentsMdOutput` out of `src/renderer/src/agents.ts` and paste them into `src/main/agentsMd.ts`, exported, with this note above them:

```ts
/**
 * WS5's structured-output contract, moved here in round 21.
 *
 * It lived in the renderer while the renderer was the writer. Main is the
 * writer on every surface now, and the renderer's copy had exactly ONE caller —
 * a dialog — which is why a draft asked for in chat was parsed by nobody and
 * written by nobody.
 *
 * Lenient about surrounding prose (find the tagged fence), strict about paths
 * (relative, no escape, basename AGENTS.md) — `writeAgentsMdFiles` confines
 * them again, so this is the first of two gates rather than the only one.
 */
```

Add the reader:

```ts
/**
 * A child sub-agent's final answer, out of its own Pi session file.
 *
 * This is the UNTRUNCATED source, and that matters: upstream caps the
 * completion payload at 1,000 chars, the bridge caps the notify's summary at
 * 500, and pi-subagents' inspect RPC caps `finalOutput` at 8,000 — a real
 * multi-file draft exceeds all three. Pi's own session record has no such cap.
 *
 * The LAST assistant message with text wins, not simply the last one: a child
 * whose final turn was pure tool calls still gave its answer a message earlier.
 *
 * Tolerant by design, same contract as parseCalls: the file is appended live,
 * so the last line can be torn mid-write. A bad line is skipped, never thrown.
 */
export function finalTextFromSessionFile(jsonl: string | null | undefined): string {
  if (!jsonl) return "";
  const texts: string[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let entry: { type?: string; message?: { role?: unknown; content?: unknown } };
    try {
      entry = JSON.parse(raw) as typeof entry;
    } catch {
      continue;
    }
    const m = entry.type === "message" ? entry.message : undefined;
    if (!m || m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content.trim()) texts.push(m.content);
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const text = m.content
      .map((b) => (b as { type?: unknown; text?: unknown }))
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text.trim()) texts.push(text);
  }
  return texts.length ? texts[texts.length - 1] : "";
}
```

- [ ] **Step 4: Write on completion, in main**

In `src/main/ipc.ts`, inside the `sub.stage === "complete" && sub.runId` branch — **before** `childSessionsByRun.delete(sub.runId)`, because that map is the only record of where the child wrote:

```ts
          // §15 round 21: the agents-md-maker's draft is written HERE, not by a
          // dialog. Delegations are async by default, so `tool_execution_end`
          // carries a dispatch receipt with no results at all — the renderer's
          // listener never matched, and from chat there was no listener. This is
          // the one moment main holds both halves: which agent the run was, and
          // where its child wrote.
          const finishedAgent = sub.agent ?? delegatedAgentByRun.get(sub.runId);
          if (finishedAgent === "agents-md-maker" && sub.status === "success") {
            const ws = meta?.workspaceId;
            const kids = childSessionsByRun.get(sub.runId) ?? [];
            // The child's OWN session file, untruncated — the notify's summary
            // is capped at 500 chars in the bridge and would cut a draft
            // mid-string, which is the failure this replaces.
            const output = kids
              .map((k) => finalTextFromSessionFile(readSessionFile(sessionDir(), k.sessionFile)))
              .find((t) => parseAgentsMdOutput(t) !== null);
            const files = output ? parseAgentsMdOutput(output) : null;
            if (ws && files) {
              try {
                const written = writeAgentsMdFiles(workspaces.list(), ws, files);
                void log.append({ type: "agents_md.written", workspaceId: ws, data: { files: written, runId: sub.runId } });
                send("hv:agents-md-written", { workspaceId: ws, files: written });
              } catch (e) {
                void log.append({
                  type: "agents_md.write_failed",
                  workspaceId: ws,
                  data: { runId: sub.runId, error: String(e) },
                });
              }
            }
          }
```

Add the imports: `finalTextFromSessionFile` and `parseAgentsMdOutput` from `./agentsMd`, `readSessionFile` from `./store`.

- [ ] **Step 5: Expose the event**

In `src/preload/index.ts`, beside the other `on*` bridges:

```ts
  onAgentsMdWritten: (cb: (p: { workspaceId: string; files: string[] }) => void) => {
    const h = (_e: unknown, p: { workspaceId: string; files: string[] }) => cb(p);
    ipcRenderer.on("hv:agents-md-written", h);
    return () => ipcRenderer.removeListener("hv:agents-md-written", h);
  },
```

*(Forward the payload argument explicitly — a preload bridge that drops its argument is a silent failure this repo has shipped once already.)*

In `src/renderer/src/hv.d.ts`, beside the other `on*` declarations:

```ts
  /** §15 round 21: main wrote an AGENTS.md draft (root and any nested). */
  onAgentsMdWritten(cb: (p: { workspaceId: string; files: string[] }) => void): () => void;
```

- [ ] **Step 6: Make the panel a listener, not a writer**

In `src/renderer/src/components/AgentsMdPanel.tsx`, replace the whole `draft()` body's pi-event listener with a subscription to the write, and delete the `parseAgentsMdOutput` / `unfence` / `writeAgentsMdFiles` path:

```tsx
  /**
   * §15 round 21: main writes the draft; this only waits for it.
   *
   * The old listener watched `tool_execution_end` for a BLOCKING delegation's
   * results. Delegations are async by default, so that event carries a dispatch
   * receipt with no results — nothing ever matched, `agent_end` then fired, and
   * the user got "No draft was produced this turn" while the run was still
   * going. Waiting for the WRITE is correct on both paths and needs no
   * knowledge of how the delegation was dispatched.
   */
  const draft = (): void => {
    if (!sessionId) return; // draft needs a live session to delegate on
    setDrafting(true);
    setError(null);
    offDraft.current?.();
    offDraft.current = window.hv.onAgentsMdWritten(({ workspaceId, files }) => {
      if (workspaceId !== workspace) return;
      offDraft.current?.();
      offDraft.current = null;
      setDrafting(false);
      setSavedFiles(files);
      setJustCreated(true);
      // Reload from disk rather than trusting an echo: main is the writer, so
      // the file is the truth about what was written.
      void window.hv.readAgentsMd(workspace).then((c) => {
        setMissing(c === null);
        setContent(c ?? "");
        setDocVersion((v) => v + 1); // replace the editor's whole document
        setDirty(false);
      });
    });
    void window.hv
      .promptSession(
        sessionId,
        'Use the subagent tool to delegate to the "agents-md-maker" agent with the task: ' +
          '"Explore this project and draft its AGENTS.md (plus a nested AGENTS.md for any large subproject). ' +
          'Return them in the structured json agents-md block as instructed." ' +
          "Do not create or modify any files yourself. When it finishes, reply with one short sentence " +
          "confirming the draft is ready — do not repeat its output.",
      )
      .catch((e) => {
        offDraft.current?.();
        offDraft.current = null;
        setDrafting(false);
        setError(String(e));
      });
  };
```

Remove the now-unused `traceFromEnd` and `unfence` imports/helpers, and add `const [docVersion, setDocVersion] = useState(0);` (Task 9 uses it too).

Note the accepted ceiling above `drafting`:

```tsx
  // The button stays in "Drafting…" until the write lands. An async delegation
  // has no bounded end, so there is deliberately no timeout that would claim
  // failure while a run is still working — the run rail is where a live
  // delegation is watched and stopped.
```

- [ ] **Step 7: Run the tests**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-capture.test.ts tests/agents-md-panel.test.ts tests/hv-agents-md.test.ts tests/agents-md.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: PASS. Fix any import of `parseAgentsMdOutput` from the renderer that the move broke.

- [ ] **Step 8: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/agentsMd.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/agents.ts src/renderer/src/hv.d.ts src/renderer/src/components/AgentsMdPanel.tsx tests/agents-md-capture.test.ts tests/agents-md-panel.test.ts
git commit -m "fix(agents-md): main writes the draft when the run completes, on every surface"
```

- [ ] **Step 10: Check whether the live batch is required**

Run: `npm run live:why`
If it prints anything, symlink the key and run the batch in the background:

```bash
ln -s ~/Documents/Github/HappyVibe/.env .env 2>/dev/null; git check-ignore -v .env
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```
Expected: PASS, with a wall time of roughly **6 minutes**. A run that finishes in seconds tested nothing — check `.env` resolved.

**Verification — what is observably TRUE:**
- **From chat**, in a workspace with no `AGENTS.md`: ask *"draft an AGENTS.md for this project"*. When the delegation's run card completes, `AGENTS.md` **exists on disk** and appears in the file tree — with no dialog ever opened.
- **From the dialog**: click *Draft with agents-md-maker*, leave the dialog open. When the run completes the dialog **shows the drafted content** and a `✓ AGENTS.md created` notice, without a reload.
- A **nested** draft writes both files and the notice reads `✓ 2 AGENTS.md files created`.
- The **Audit** page shows an `agents_md.written` row naming the files.
- **Absence assertion:** *"No draft was produced this turn"* must **never** appear for a run that actually produced one. That sentence is the bug's signature and it cannot be screenshotted as an absence — watch for it while the run is still going, which is exactly when it used to fire.
- **Absence assertion:** the drafted file contains **no `` ``` `` fence, no `{"files":` JSON wrapper and no truncation ellipsis** — a `…`-terminated or fence-wrapped file means the truncated notify was read instead of the session file.
- **Absence assertion, on the Agents page:** `agents-md-maker` still lists `read, grep, find, ls` and **not** `write` — the agent did not gain the ability to write its own output.
- **Regression to perform:** switch `agents-md-maker` **off** on Settings → Agents, reopen the AGENTS.md dialog: the draft button is replaced by the sentence naming the switch. Switch it back on, run a draft, and **close the dialog while the run is still going** — the file must still be written when it completes, and reopening the dialog shows it.

---

### Task 9: The AGENTS.md dialog becomes the editor a file tab already is

**Files:**
- Modify: `src/renderer/src/components/AgentsMdPanel.tsx` (lazy `CodeEditor` + source/preview switch)
- Modify: `src/renderer/src/components/FileTab.tsx` (export `CodeGlyph` and `EyeGlyph` instead of duplicating them)
- Modify: `src/renderer/src/App.tsx` (pass `saveKey` / `searchKey` to the panel)
- Test: `tests/agents-md-editor.test.ts` (new)

**Interfaces:**
- Consumes: `CodeEditor` default export from `./EditorPane` — `{ path, doc, docVersion, onChange, onSave, saveKey, searchKey }`; `bindings.save` / `bindings.search` in App
- Produces: `CodeGlyph`, `EyeGlyph` exported from `FileTab.tsx`

- [ ] **Step 1: Write the failing test**

`tests/agents-md-editor.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
const panel = (): string => read("src/renderer/src/components/AgentsMdPanel.tsx");

test("the textarea is gone — this is the same editor a file tab uses", () => {
  const src = panel();
  expect(src).not.toContain("<textarea");
  expect(src).toContain('lazy(() => import("./EditorPane"))');
  expect(src).toContain("<Suspense");
});

test("it reuses FileTab's own switcher glyphs rather than drawing new ones", () => {
  // Two icon sets for one control is how two surfaces come to look different.
  expect(panel()).toMatch(/import \{[^}]*CodeGlyph[^}]*\} from "\.\/FileTab"/);
  expect(panel()).toMatch(/import \{[^}]*EyeGlyph[^}]*\} from "\.\/FileTab"/);
  const ft = read("src/renderer/src/components/FileTab.tsx");
  expect(ft).toMatch(/export function CodeGlyph/);
  expect(ft).toMatch(/export function EyeGlyph/);
});

test("preview renders markdown with GFM, like the file tab", () => {
  const src = panel();
  expect(src).toContain('from "react-markdown"');
  expect(src).toContain("remarkGfm");
  expect(src).toContain('className="md');
});

test("an EXISTING file opens on preview; a missing one opens on source", () => {
  // Nothing to preview and something to write.
  expect(panel()).toMatch(/useState<"rendered" \| "raw">\(/);
  expect(panel()).toMatch(/missing \? "raw" : "rendered"/);
});

test("the editor's document is replaced by version, not by controlled value", () => {
  // CodeMirror is uncontrolled between versions; a drafted file must bump it or
  // the editor keeps showing the old buffer.
  expect(panel()).toContain("docVersion");
  expect(panel()).toMatch(/setDocVersion\(\(v\) => v \+ 1\)/);
});

test("the keymap comes from the shortcut registry, not a hardcoded key", () => {
  expect(panel()).toMatch(/saveKey/);
  expect(panel()).toMatch(/searchKey/);
  const app = read("src/renderer/src/App.tsx");
  const at = app.indexOf("<AgentsMdPanel");
  expect(app.slice(at, at + 600)).toMatch(/saveKey=\{bindings\.save\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-editor.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — the panel still has a `<textarea`.

- [ ] **Step 3: Export the two glyphs**

In `src/renderer/src/components/FileTab.tsx`, change `function CodeGlyph()` → `export function CodeGlyph()` and `function EyeGlyph()` → `export function EyeGlyph()`, with a note:

```tsx
/** Exported for the AGENTS.md dialog's switcher (§15 round 21) — one icon set
 *  for one control, so the two surfaces cannot drift apart. */
```

- [ ] **Step 4: Swap the textarea for the editor**

In `src/renderer/src/components/AgentsMdPanel.tsx`:

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeGlyph, EyeGlyph } from "./FileTab";

// Code-split: CodeMirror lives in its own chunk, as it does for file tabs.
const CodeEditor = lazy(() => import("./EditorPane"));
```

Add props `saveKey: string; searchKey: string;` and the view state:

```tsx
  /**
   * §15 round 21: the same source/preview switch a `.md` file tab has.
   *
   * Preview is the default for a file that already exists; a MISSING or
   * freshly-drafted one opens on source, because there is nothing to preview
   * and something to write. Seeded from `missing` once it is known, which is
   * why this is set in the load effect rather than in the initializer.
   */
  const [view, setView] = useState<"rendered" | "raw">("raw");
```

In the load effect, after `setMissing(c === null)`, add `setView(c === null ? "raw" : "rendered");` (and the same for the nested-file branch, which is never missing: `setView("rendered")`).

Replace the `<textarea …/>` with the switcher plus the body:

```tsx
              <div className="flex items-center gap-2 mb-2">
                {/* Same two-icon pill as a file tab, with the current view lit.
                    A single button labelled with the OTHER state is a riddle. */}
                <div className="flex items-center rounded-lg border-2 border-line-strong overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setView("raw")}
                    aria-pressed={view === "raw"}
                    aria-label="Edit source"
                    title="Edit source"
                    className={`flex items-center px-2 py-1 cursor-pointer ${
                      view === "raw" ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                    }`}
                  >
                    <CodeGlyph />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("rendered")}
                    aria-pressed={view === "rendered"}
                    aria-label="Preview rendered"
                    title="Preview rendered"
                    className={`flex items-center px-2 py-1 cursor-pointer border-l-2 border-line-strong ${
                      view === "rendered" ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                    }`}
                  >
                    <EyeGlyph />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-64 rounded-xl border-2 border-line-strong bg-paper overflow-hidden">
                {view === "rendered" ? (
                  <div className="h-full overflow-y-auto px-6 py-4">
                    <div className="md max-w-3xl mx-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <Suspense
                    fallback={<div className="h-full flex items-center justify-center text-sm text-ink-soft">Opening editor…</div>}
                  >
                    <CodeEditor
                      path={relPath}
                      doc={content}
                      docVersion={docVersion}
                      onChange={(t) => { setContent(t); setDirty(true); setJustCreated(false); }}
                      onSave={() => void save()}
                      saveKey={saveKey}
                      searchKey={searchKey}
                    />
                  </Suspense>
                )}
              </div>
```

- [ ] **Step 5: Pass the bindings from App**

In `src/renderer/src/App.tsx`, on `<AgentsMdPanel …>`, add:

```tsx
          saveKey={bindings.save}
          searchKey={bindings.search}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/agents-md-editor.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/AgentsMdPanel.tsx src/renderer/src/components/FileTab.tsx src/renderer/src/App.tsx tests/agents-md-editor.test.ts
git commit -m "feat(agents-md): the dialog gets the file editor and its source/preview switch"
```

**Verification — what is observably TRUE:**
- Opening `AGENTS.md` from the file tree in a workspace that **has** one shows the **rendered** Markdown — real headings and lists, not `#` characters — with the eye icon lit.
- Clicking the code icon shows **syntax-highlighted source** with line numbers, and typing marks Save as dirty; ⌘S saves.
- Opening a workspace with **no** `AGENTS.md` lands on **source** with the eye icon unlit, and the empty-state box plus the draft button still show.
- **Absence assertion:** there is **no** plain unstyled `textarea` anywhere in the dialog — no monospace box without line numbers. That is what the old editor looked like and its replacement is the point of the task.
- **Absence assertion:** the preview does **not** show raw `#`, `*` or `` ` `` markers, and the source view does **not** render them away.
- **Regression to perform:** with the dialog open in **source** view and unsaved edits, run a draft (Task 8): when the write lands the editor must show the **new** file, not the stale buffer — this is what `docVersion` is for. Then switch to preview and back: the content survives the switch.

---

### Task 10: The cross divider stops crossing panes that are not split

**Files:**
- Modify: `src/renderer/src/tabs.ts` (add the pure `crossDividerSpans`)
- Modify: `src/renderer/src/App.tsx` (`PaneDividers` renders one strip per span)
- Test: `tests/pane-dividers.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  // src/renderer/src/tabs.ts
  export interface CrossSpan { half: 0 | 1; from: number; to: number }
  export function crossDividerSpans(t: Pick<WorkspaceTabs, "split" | "subSplit" | "sizes">): CrossSpan[];
  ```

- [ ] **Step 1: Write the failing test**

`tests/pane-dividers.test.ts`:

```ts
import { expect, test } from "vitest";
import { crossDividerSpans, emptyTabs, type WorkspaceTabs } from "../src/renderer/src/tabs";

const tabs = (over: Partial<WorkspaceTabs>): WorkspaceTabs => ({ ...emptyTabs, ...over } as WorkspaceTabs);
const sizes = { main: 0.5, cross: 0.5 };

test("no split, no cross divider", () => {
  expect(crossDividerSpans(tabs({ split: null, subSplit: [false, false], sizes }))).toEqual([]);
});

test("split but nothing sub-split: still no cross divider", () => {
  expect(crossDividerSpans(tabs({ split: "v", subSplit: [false, false], sizes }))).toEqual([]);
});

test("SESSION LEFT, BROWSER RIGHT, split the left: the strip stops at the divider", () => {
  // This is the whole bug. One strip spanning left-0 right-0 crossed the
  // browser's rect, the geometric coverage check found it, and the page hid.
  const spans = crossDividerSpans(tabs({ split: "v", subSplit: [true, false], sizes: { main: 0.6, cross: 0.5 } }));
  expect(spans).toEqual([{ half: 0, from: 0, to: 0.6 }]);
});

test("split the RIGHT half only: the strip starts at the divider", () => {
  const spans = crossDividerSpans(tabs({ split: "v", subSplit: [false, true], sizes: { main: 0.6, cross: 0.5 } }));
  expect(spans).toEqual([{ half: 1, from: 0.6, to: 1 }]);
});

test("both halves sub-split: TWO strips, one per half, not one spanning both", () => {
  // Two strips rather than one full-width one, so the rule has no special case
  // — and where a browser really is in a sub-split column the divider is at its
  // edge, which DIVIDER_INSET already handles.
  expect(crossDividerSpans(tabs({ split: "v", subSplit: [true, true], sizes: { main: 0.4, cross: 0.5 } }))).toEqual([
    { half: 0, from: 0, to: 0.4 },
    { half: 1, from: 0.4, to: 1 },
  ]);
});

test("a horizontal primary split works the same way, along the other axis", () => {
  expect(crossDividerSpans(tabs({ split: "h", subSplit: [true, false], sizes: { main: 0.3, cross: 0.5 } }))).toEqual([
    { half: 0, from: 0, to: 0.3 },
  ]);
});

test("no span is ever the full extent unless BOTH halves are split", () => {
  for (const split of ["v", "h"] as const) {
    for (const subSplit of [[true, false], [false, true]] as [boolean, boolean][]) {
      for (const { half, from, to } of crossDividerSpans(tabs({ split, subSplit, sizes }))) {
        expect(half === 0 ? from : to, "a one-half strip must stop at the main divider").toBe(half === 0 ? 0 : 1);
        expect(to - from).toBeLessThan(1);
      }
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `L=/tmp/v.log; npx vitest run tests/pane-dividers.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL — `crossDividerSpans` is not exported from `tabs.ts`.

- [ ] **Step 3: Write the pure geometry**

Append to `src/renderer/src/tabs.ts`:

```ts
/** One cross-divider strip: which half it belongs to, and its extent as a
 *  fraction of the grid along the PRIMARY split's axis. */
export interface CrossSpan {
  half: 0 | 1;
  from: number;
  to: number;
}

/**
 * §28 round 21 — where the second-level divider is allowed to be drawn.
 *
 * It used to be ONE strip spanning the whole grid (`left-0 right-0`), rendered
 * as soon as EITHER half was sub-split. With a session on the left and a
 * browser on the right, splitting the left column drew a 10px `absolute` strip
 * straight across the browser — the geometric coverage check found it
 * overlapping and the page hid, which is correct behaviour for a rectangle
 * drawn over a composited view that has no business being there. Reported as
 * "the browser content disappears, and comes back when I unsplit".
 *
 * So: one strip per sub-split half, both driven by the same shared ratio. Two
 * strips rather than a full-width one even when both halves are split, so the
 * rule has no special case — and in that case the divider sits at the browser's
 * own edge, where `DIVIDER_INSET` already keeps the strip grabbable and the
 * page visible.
 */
export function crossDividerSpans(
  t: Pick<WorkspaceTabs, "split" | "subSplit" | "sizes">,
): CrossSpan[] {
  if (!t.split) return [];
  const spans: CrossSpan[] = [];
  if (t.subSplit[0]) spans.push({ half: 0, from: 0, to: t.sizes.main });
  if (t.subSplit[1]) spans.push({ half: 1, from: t.sizes.main, to: 1 });
  return spans;
}
```

- [ ] **Step 4: Render one strip per span**

In `src/renderer/src/App.tsx`'s `PaneDividers`, delete the `anyCross` constant and replace the `{anyCross && ( … )}` block with:

```tsx
      {/* §28 round 21: ONE strip per sub-split half, never one across the whole
          grid. A full-width strip crossed a browser pane that was not split at
          all, and the browser hid from it — see crossDividerSpans. */}
      {crossDividerSpans(tabs).map(({ half, from, to }) => {
        // Along the primary axis the strip is bounded by its own half; across
        // it, the shared cross ratio positions it.
        const bounds = vertical
          ? { left: pct(from), right: pct(1 - to), top: pct(tabs.sizes.cross) }
          : { top: pct(from), bottom: pct(1 - to), left: pct(tabs.sizes.cross) };
        return (
          <div
            key={`cross-${half}`}
            role="separator"
            aria-orientation={vertical ? "horizontal" : "vertical"}
            title="Drag to resize"
            onMouseDown={drag("cross", !vertical)}
            className={`${hit} ${vertical ? "h-2.5 cursor-row-resize -translate-y-1/2" : "w-2.5 cursor-col-resize -translate-x-1/2"}`}
            style={bounds}
          >
            <div className={`${tint} ${vertical ? "inset-x-0 top-1/2 h-[5px] -translate-y-1/2" : "inset-y-0 left-1/2 w-[5px] -translate-x-1/2"}`} />
          </div>
        );
      })}
```

Import `crossDividerSpans` from `./tabs`.

*(`drag` reads `e.currentTarget.parentElement.getBoundingClientRect()` — the grid container — so both strips compute the same ratio from the same box and need no change.)*

- [ ] **Step 5: Run test to verify it passes**

Run: `L=/tmp/v.log; npx vitest run tests/pane-dividers.test.ts tests/tabs.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS.

- [ ] **Step 6: Run the non-live suite**

Run: `L=/tmp/v.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: PASS. `tests/browser-coverage.test.ts` must stay green — its policy is unchanged; the rectangle it was correctly reacting to is what went away.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/tabs.ts src/renderer/src/App.tsx tests/pane-dividers.test.ts
git commit -m "fix(panes): the cross divider stops crossing halves that are not split"
```

**Verification — what is observably TRUE:**
- Session in the left pane, browser in the right, browser showing a page. Split the **left** pane in two: the browser on the right **keeps showing its page** throughout, and the new horizontal divider appears **only** across the left column.
- The `data-covered` attribute on the browser pane's placeholder reads `"false"` while the left column is split. (This is the live decision, exposed because the page is not in the DOM and cannot otherwise be asked.)
- **Absence assertion:** the horizontal divider does **not** extend over the right-hand column — its tint stops at the vertical divider. An overlapping strip is nearly invisible on its own, so check the *end* of the line, not its presence.
- **Absence assertion:** the browser pane never goes white/blank during or after the split.
- **Regression to perform:** split **both** halves, each with a browser in its lower pane. Both cross dividers must be **draggable** (grab and move — the panes resize together, since the ratio is shared), and both browsers stay visible. Then unsplit one half: its strip disappears and the other's remains.

---

### Task 11: Full gate and the round's documentation

**Files:**
- Modify: `CLAUDE.md` (the two root-cause traps worth remembering)
- Test: whole gate

- [ ] **Step 1: Run the full gate**

Run: `L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: PASS — `build` runs both typechecks first and fast-fails on them, so this is the one command.

- [ ] **Step 2: Confirm the built main bundle carries the main-side changes**

```bash
grep -c "HappyVibe, a desktop app for coding" out/main/index.js
grep -c "finalTextFromSessionFile\|agents-md-maker" out/main/index.js
```
Expected: both non-zero. Verifying the source is not verifying the app.

- [ ] **Step 3: Check the live batch**

Run: `npm run live:why`
If it prints anything (Task 1 touches `src/main/pi/spawn.ts`, so it will):

```bash
ln -s ~/Documents/Github/HappyVibe/.env .env 2>/dev/null; git check-ignore -v .env
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```
Expected: PASS in roughly **6 minutes**. A seconds-long green run tested nothing.

- [ ] **Step 4: Record the two traps in CLAUDE.md**

Add to the Gotchas section:

```markdown
- **A full-width `absolute` strip is what blanks a browser pane, and the cross divider was one.**
  The second-level pane divider was drawn `left-0 right-0` across the WHOLE grid whenever
  *either* half was sub-split, so splitting a session on the left drew a 10px strip across a
  browser on the right, `paneIsCovered` found it, and the page hid — reported as "the browser
  content disappears and comes back when I unsplit". `crossDividerSpans` (tabs.ts) now emits
  one strip per sub-split half. The lesson generalises: **the coverage check has no false
  positives, only honest ones** — when a pane goes blank, find the `absolute`/`fixed`
  rectangle overlapping it rather than loosening the check. Pinned by
  `tests/pane-dividers.test.ts`.
- **`--append-system-prompt` REPLACES Pi's discovery of `APPEND_SYSTEM.md`, it does not add to
  it** (`resource-loader.js` discovers a file only `if (!appendSources)`), and
  `resolvePromptInput` returns a **non-existent path VERBATIM** — so the identity flag must be
  passed alongside the user's file, and only when that file **exists**, or their additions
  vanish or a filesystem path lands in the prompt. Both cases are pinned by
  `tests/identity-prompt.test.ts`, which also asserts the two upstream behaviours as a
  pin-bump gate. Consequence, deliberate: Pi no longer discovers a workspace
  `.pi/APPEND_SYSTEM.md`, which used to replace the global additions with nothing in the UI
  saying so — a cloned repo can no longer rewrite the system prompt.
- **A dialog portalled into a pane must fall back to the viewport when that pane is HIDDEN.**
  A chat pane wrapper is `hidden` whenever the user is on a settings page, and a permission
  prompt rendered inside a hidden element is invisible while the agent waits forever
  (prompts never time out by design). `dialogHost` (paneDialog.ts) returns null for
  `offsetParent === null` or a zero-rect element, and only the two SESSION dialogs
  (permission, ask_user) are scoped at all. Pinned by `tests/pane-dialog.test.ts`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): the three round-21 traps worth not rediscovering"
```

**Verification:** `npm run gate` green, and `npm run test:live` green with a ~6-minute wall time.

---

## Self-Review

**Spec coverage** — every §-decision maps to a task: §16 identity → T1; §16 prices → T2; §7 colours → T3; §7 MCP chip → T4; §7 wrapping → T5; §7 `+` menu → T4 (MCP row) + T6 (AGENTS.md row); §7 pane-scoped dialogs → T7; §15 writer → T8; §15 editor → T9; §28 divider → T10. No spec requirement is unclaimed.

**Cross-task type consistency** — `CHIP_TONE` (T3) is consumed by `McpChip` (T4); `docVersion` is introduced in T8's panel edit and consumed by T9's editor, so T8 must precede T9; T4's "exactly the two attach rows" test only passes after T6, and Step 5 of T4 says so explicitly; `dialogHost`/`SCOPED_*` are defined and consumed within T7.

**Ordering constraints** — T3 before T4 (`CHIP_TONE.mcp`). T8 before T9 (`docVersion`, and the panel is rewritten once). T4 before T6 only for the shared test's final green. Everything else is independent.
