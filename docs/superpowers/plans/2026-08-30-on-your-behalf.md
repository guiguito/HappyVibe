# "On your behalf" — the app's own model calls get a page (and the dead plumbing goes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three model calls HappyVibe makes without a session — session title, commit message, PR description — one settings page that says they exist, which model runs them, what they say, and lets you steer or switch off each one; and delete the dead call chains the audit of them surfaced.

**Architecture:** One new config record (`assistantTasks`) mirroring `builtinTools`'s getter/setter shape holds model + append + on/off per task. Main enforces every switch at its IPC handler (the renderer only hides affordances). The page reuses the row component extracted out of `BuiltinToolsBlock` — read-only prompt, append box, switch — rather than building a second one. Nothing new is invented for prompt display: `hv:builtin-prompt`'s pattern is copied for `hv:assistant-task-prompt`.

**Tech Stack:** Electron + React/TS/Vite, vitest. No new dependencies.

**Spec:** Notion — "🧹 The app's own model calls — cleanup + a settings page" (`3ccd33dfffca81d6aba5e33a63be4ed8`), locked 2026-08-30. PRD: `docs/prd.md` §19 (Decision 2026-08-30 — the page), §15 (Decision 2026-08-30 — the draft is an agent), §11 and §29 (corrections).

## Global Constraints

- **Prompts are read-only, in full, with an append box — never an override.** PRD §13 round 6, inherited not re-decided. All three callers parse their output (`titles.ts` last non-empty line; `cleanSubject`; `splitPrDraft`), so an editable prompt breaks the parse silently.
- **Three one-shot callers, never four.** The AGENTS.md draft is a delegation and belongs to the Agents page. It gets **no row** here.
- **Global tier only.** No per-workspace override for these tasks (PRD §19, "not in scope").
- **Model default is "Same as your default model"** — an unset task model resolves `session → workspace → global` through `resolveSpawnModel`.
- `npm run gate` is the full check (`build` → non-live suite, ONE command). **Never run `npm run typecheck` before it** — `build` runs both typechecks first.
- **Live-Pi batch is NOT expected here** (no change under `pi-runtime/extensions/`, `src/main/pi/`, or a live test file). Still run `npm run live:why` *after* the commit that carries the change; if it prints anything, run `npm run test:live`. If it prints nothing, **say so** — do not silently omit it.
- Never run `npm run lint` / `npm run format` (scaffold leftovers, see CLAUDE.md).

---

### Task 1: Delete group A — the three dead call chains

Nothing here is reachable from the renderer. Verified 2026-08-30: no callers in `src/`, `tests/` or `scripts/`.

**Files:**
- Modify: `src/main/agentsMd.ts` — delete `proposeAgentsMd` (lines 117-184) and `workspaceFacts` (lines 96-115)
- Modify: `src/main/ipc.ts` — delete the `hv:propose-agents-md` handler (~3159-3166), the `hv:get-api-key` / `hv:set-api-key` / `hv:pick-folder` handlers (~1950-1956), and `proposeAgentsMd`, `getApiKey`, `setApiKey` from the imports on lines 11, 14, 74
- Modify: `src/main/config.ts` — delete the legacy `getApiKey`/`setApiKey` shims (~458-465)
- Modify: `src/preload/index.ts` — delete `getApiKey` (29), `setApiKey` (30), `pickFolder` (31), `proposeAgentsMd` (165)
- Modify: `src/renderer/src/hv.d.ts` — delete `getApiKey` (522), `setApiKey` (523), `pickFolder` (524), `proposeAgentsMd` (650)
- Modify: `tests/agents-md.test.ts` — delete the `workspaceFacts` test (~37-45) and drop `workspaceFacts` from the import on line 5

**Interfaces:**
- Produces: nothing. This task only removes.

- [ ] **Step 1: Confirm the sweep still holds before deleting anything**

```bash
for s in proposeAgentsMd workspaceFacts getApiKey setApiKey pickFolder; do
  echo "--- $s"; grep -rn "$s" src/renderer/src --include='*.tsx' ; done
```

Expected: **no output at all** under `src/renderer/src/**/*.tsx`. If any line appears, STOP — the chain is live and this task is wrong.

- [ ] **Step 2: Delete, in the file order listed above**

Work main → preload → types → tests, so a half-finished state is a compile error rather than a silent orphan. `agentsMd.ts` keeps everything else: `resolveAgentsMd`, `hasClaudeMd`, `copyClaudeMdToAgentsMd`, `readAgentsMd`, `writeAgentsMd`, `writeAgentsMdFiles`. Its `spawn`, `path` and `PI_CLI_RELPATH` imports become unused — remove them too (`fs` and `path` are still needed).

- [ ] **Step 3: Verify nothing dangles**

```bash
grep -rn "proposeAgentsMd\|workspaceFacts\|getApiKey\|setApiKey\|pickFolder\|hv:propose-agents-md\|hv:get-api-key\|hv:set-api-key\|hv:pick-folder" src/ tests/
```

Expected: no output.

- [ ] **Step 4: Run the gate**

Run: `npm run gate`
Expected: PASS. `hv.d.ts` and `preload/index.ts` are both typechecked, so a missed half fails here.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete three dead call chains the one-shot audit surfaced"
```

---

### Task 2: Delete the `agents-md` audit row type

Round 15 wired `oneShot("agents-md")` into a handler that had been dead for a month, so no such row has ever been written. The label is unreachable; there is no history to preserve.

**Files:**
- Modify: `src/main/oneShotLog.ts:25` — `OneShotKind` drops `"agents-md"`; fix the header comment (it says "four" and names `agentsMd.ts`)
- Modify: `src/renderer/src/components/AuditView.tsx:38` (the `kind` union) and `:87` (the `"drafted AGENTS.md"` entry in `ONESHOT_LABEL`)
- Modify: `src/main/ipc.ts` — the `hv:read-audit` doc comment (~3062-3067) names four callers; make it three
- Test: `tests/oneshot-audit.test.ts`

**Interfaces:**
- Produces: `OneShotKind = "title" | "commit-message" | "pr-draft"` — Tasks 3 and 4 use this exact union.

- [ ] **Step 1: Write the failing test**

Add to `tests/oneshot-audit.test.ts`:

```ts
test("agents-md is not a one-shot kind — the AGENTS.md draft is a delegation (PRD §15, 2026-08-30)", () => {
  const src = readFileSync(new URL("../src/main/oneShotLog.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/"agents-md"/);
  const audit = readFileSync(new URL("../src/renderer/src/components/AuditView.tsx", import.meta.url), "utf8");
  expect(audit).not.toMatch(/drafted AGENTS\.md/);
});
```

(`readFileSync` from `node:fs` — a source scan, the `tests/modal-layer.test.ts` pattern, because an ABSENCE is what this pins and the renderer suite has no DOM.)

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log
npx vitest run tests/oneshot-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: FAIL — both strings still present.

- [ ] **Step 3: Make the deletions listed in Files**

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/oneshot-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(audit): remove a row type that was never once emitted"
```

---

### Task 3: `assistantTasks` config — replacing `gitMessageModel`

`gitMessageModel` was one setting two rows would secretly share, and **no UI ever wrote it**, so no user has one on disk. It is deleted, not migrated.

**Files:**
- Modify: `src/main/config.ts` — delete `gitMessageModel` from the config interface (87) and `getGitMessageModel`/`setGitMessageModel` (273-281); add the new record beside `getBuiltinTools`/`setBuiltinTools` (318-338), same shape
- Modify: `src/main/ipc.ts` — delete `hv:git-message-model` / `hv:set-git-message-model` (3696-3700) and the import on line 19
- Modify: `src/preload/index.ts:131-132`, `src/renderer/src/hv.d.ts:628-629` — delete both
- Test: `tests/assistant-tasks.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type AssistantTaskId = "title" | "commit-message" | "pr-draft";
  export interface AssistantTask {
    enabled: boolean;
    model: { provider: string; modelId: string } | null;
    append: string;
  }
  export function getAssistantTasks(): Record<AssistantTaskId, AssistantTask>;
  export function setAssistantTask(id: AssistantTaskId, patch: Partial<AssistantTask>): void;
  ```
  Task 4 consumes both. `AssistantTaskId` is deliberately the same three strings as `OneShotKind` from Task 2 — one vocabulary, so an audit row and a settings row can never disagree about which task they mean.

- [ ] **Step 1: Write the failing test**

Create `tests/assistant-tasks.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config.ts reads PI/HV dirs at call time — point it at a temp home first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-at-"));
process.env.HV_CONFIG_DIR = dir;

const { getAssistantTasks, setAssistantTask } = await import("../src/main/config");

describe("assistantTasks", () => {
  test("all three default to on, no model override, no append", () => {
    const t = getAssistantTasks();
    expect(Object.keys(t).sort()).toEqual(["commit-message", "pr-draft", "title"]);
    for (const v of Object.values(t)) {
      expect(v).toEqual({ enabled: true, model: null, append: "" });
    }
  });

  test("a patch merges rather than replacing the record", () => {
    setAssistantTask("title", { model: { provider: "openrouter", modelId: "x/y" } });
    setAssistantTask("title", { append: "always mention the ticket id" });
    expect(getAssistantTasks().title).toEqual({
      enabled: true,
      model: { provider: "openrouter", modelId: "x/y" },
      append: "always mention the ticket id",
    });
    // and the other two are untouched
    expect(getAssistantTasks()["pr-draft"].model).toBeNull();
  });

  test("gitMessageModel is gone — nothing to migrate, no UI ever wrote it", () => {
    const src = fs.readFileSync(new URL("../src/main/config.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/gitMessageModel/);
  });
});
```

Check how `tests/` already points `config.ts` at a temp dir (grep an existing config test) and copy that mechanism verbatim rather than inventing `HV_CONFIG_DIR` if it is spelled differently.

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/assistant-tasks.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Expected: FAIL — `getAssistantTasks is not a function`.

- [ ] **Step 3: Implement, mirroring `getBuiltinTools`**

```ts
// docs/prd.md §19 (2026-08-30): the three model calls the app makes without a
// session. Same shape as getBuiltinTools right above — one global record, a
// merging setter, fail-OPEN defaults (a task the user has never touched runs).
// gitMessageModel used to live here: one setting two of these rows would have
// shared, built end to end and never given a UI, so nothing had ever written it
// and there was nothing to migrate.
export type AssistantTaskId = "title" | "commit-message" | "pr-draft";
export interface AssistantTask {
  enabled: boolean;
  model: { provider: string; modelId: string } | null;
  append: string;
}
const ASSISTANT_TASK_IDS: AssistantTaskId[] = ["title", "commit-message", "pr-draft"];

export function getAssistantTasks(): Record<AssistantTaskId, AssistantTask> {
  const stored = load().assistantTasks ?? {};
  return Object.fromEntries(
    ASSISTANT_TASK_IDS.map((id) => {
      const t = stored[id];
      return [id, { enabled: t?.enabled ?? true, model: t?.model ?? null, append: t?.append ?? "" }];
    }),
  ) as Record<AssistantTaskId, AssistantTask>;
}

export function setAssistantTask(id: AssistantTaskId, patch: Partial<AssistantTask>): void {
  if (!ASSISTANT_TASK_IDS.includes(id)) return;
  const cfg = load();
  cfg.assistantTasks = { ...cfg.assistantTasks, [id]: { ...cfg.assistantTasks?.[id], ...patch } };
  save(cfg);
}
```

Add to the config interface beside `builtinTools` (line 44):

```ts
  assistantTasks?: Partial<Record<AssistantTaskId, Partial<AssistantTask>>>;
```

Then delete `gitMessageModel` everywhere listed in Files. `ipc.ts:3595` and `:3672` currently read `getGitMessageModel() ?? resolveSpawnModel(...)` — Task 4 replaces those two lines; leaving them broken between tasks is fine only if you do Tasks 3 and 4 back to back, so **do not commit a red build**: fold Task 4's step 3 in if the build is red here.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/assistant-tasks.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit (after Task 4 if the build is red)**

```bash
git add -A
git commit -m "feat(config): one record per assistant task, replacing a setting nobody could reach"
```

---

### Task 4: Main enforces the three switches, the models, and the appends

Every switch is enforced **in main**, at the IPC handler. The renderer hiding a button is an affordance, never the enforcement.

**Files:**
- Modify: `src/main/titles.ts` — extract the prompt into an exported pure builder that takes the append
- Modify: `src/main/gitMessage.ts:39` `buildDraftPrompt` and `:168` `buildPrPrompt` — each takes an `append` string
- Modify: `src/main/oneShotLog.ts` — `OneShotEvent` gains `appended: boolean`; `logOneShot` takes and records it
- Modify: `src/main/ipc.ts` — `maybeTitle` (~1041-1060), `hv:git-draft-message` (~3594), `hv:git-pr-url` (~3671)
- Test: `tests/git-message.test.ts` (exists — extend), `tests/oneshot-audit.test.ts` (extend)

**Interfaces:**
- Consumes: `getAssistantTasks` from Task 3; `OneShotKind` from Task 2.
- Produces:
  ```ts
  // titles.ts
  export function buildTitlePrompt(firstUserMessage: string, append: string): string;
  // gitMessage.ts — append is appended AFTER the instructions, BEFORE the diff
  export function buildDraftPrompt(input: DraftInput, budgetChars: number, append?: string): string;
  export function buildPrPrompt(input: PrDraftInput, budgetChars: number, append?: string): string;
  ```
  Task 5's page renders `buildTitlePrompt("<the first message you send>", "")` etc. as the read-only template.

- [ ] **Step 1: Write the failing tests**

Add to `tests/git-message.test.ts`:

```ts
test("an append lands after the instructions and before the diff", () => {
  const p = buildDraftPrompt({ diff: "DIFFBODY", files: [], recentSubjects: [] }, 24_000, "always prefix with the ticket id");
  expect(p).toContain("always prefix with the ticket id");
  expect(p.indexOf("always prefix with the ticket id")).toBeLessThan(p.indexOf("DIFFBODY"));
  expect(p.indexOf("Reply with ONLY")).toBeLessThan(p.indexOf("always prefix with the ticket id"));
});

test("no append changes nothing", () => {
  const a = buildDraftPrompt({ diff: "D", files: [], recentSubjects: [] }, 24_000);
  const b = buildDraftPrompt({ diff: "D", files: [], recentSubjects: [] }, 24_000, "");
  expect(a).toBe(b);
});
```

Add to `tests/oneshot-audit.test.ts`:

```ts
test("the audit row says when the prompt was appended to", () => {
  const rows: Array<{ data?: Record<string, unknown> }> = [];
  const sink = { append: (e: { data?: Record<string, unknown> }) => rows.push(e) };
  logOneShot(sink, {
    kind: "title", model: { provider: "p", modelId: "m" },
    promptChars: 100, outputChars: 20, ok: true, appended: true,
  });
  expect(rows[0].data?.appended).toBe(true);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
L=/tmp/vitest.log
npx vitest run tests/git-message.test.ts tests/oneshot-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Expected: FAIL — `buildDraftPrompt` takes two arguments; `appended` is not on the payload.

- [ ] **Step 3: Implement**

`titles.ts` — lift the inline prompt out, unchanged in wording:

```ts
/** Pure: the prompt, so the "On your behalf" page can show it verbatim (§19). */
export function buildTitlePrompt(firstUserMessage: string, append = ""): string {
  const base =
    "Write a short title (3 to 6 words, no quotes, no trailing period) for a coding session " +
    `that starts with this request:\n\n${firstUserMessage.slice(0, 500)}\n\nReply with ONLY the title.`;
  return append.trim() ? `${base}\n\n${append.trim()}` : base;
}
```

and `generateTitle` takes `opts.append`, calls it, and passes `appended: !!opts.append?.trim()` through `onDone`.

`gitMessage.ts` — `buildDraftPrompt(input, budgetChars, append = "")` inserts `append.trim()` into the array it already joins, **after** the `"Reply with ONLY the commit message subject line…"` line and before the `truncated ? … : "\nThe diff:\n"` entry. `buildPrPrompt` the same, after `"Do not wrap the answer in code fences…"`. Both `draftCommitMessage` and `draftPullRequest` gain an `append` parameter and forward `appended` to `onDone`.

`oneShotLog.ts` — `OneShotEvent` gains `appended: boolean`, `logOneShot`'s options gain it, and the header comment's "four" becomes three (Task 2 already fixed the kind list; fix the prose here).

`ipc.ts` `maybeTitle`:

```ts
const task = getAssistantTasks().title;
// §19 (2026-08-30): off means no call at all — the truncated-first-message
// fallback title stays, which is what a user who switched this off asked for.
if (!task.enabled) return;
void generateTitle(piRuntimeDir(), meta.workspaceId, msg, {
  // §19 (2026-08-30): session → workspace → global, identically to a chat
  // spawn. This used to be resolveSpawnModel() with NO arguments, so a
  // workspace model override was honoured for a commit message and ignored
  // for the title of the session it belonged to.
  model: task.model ?? resolveSpawnModel(meta.workspaceId, sessionId),
  append: task.append,
  env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
  onDone: oneShot("title", meta.workspaceId, sessionId),
});
```

`hv:git-draft-message`:

```ts
const task = getAssistantTasks()["commit-message"];
if (!task.enabled) return null;               // enforcement, not the renderer's hiding
const model = task.model ?? resolveSpawnModel(workspaceId);
```
and pass `task.append` through to `draftCommitMessage`.

`hv:git-pr-url` — **the button is NOT hidden when this task is off.** The URL still opens; only the drafted description falls away, and the body falls back to the commit list exactly as it already does with no provider:

```ts
const task = getAssistantTasks()["pr-draft"];
if (draft && task.enabled) {
  const model = task.model ?? resolveSpawnModel(workspaceId);
  …
}
```

Leave the `draft: false` eligibility path untouched — it must never read the config's model or a diff (PRD §29).

- [ ] **Step 4: Run the whole non-live suite**

```bash
npx vitest run > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Expected: PASS. `npm test` is ~25-40 s; do not background it and do not pipe it to `tail` without the redirect (`| tail` returns tail's exit code).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(assistant): the three app-made calls honour a switch, a model and an append"
```

---

### Task 5: Extract the shared row from `BuiltinToolsBlock`

`BuiltinToolsBlock.tsx`'s Plan-mode row is already read-only-prompt + append box + switch. Extract that shape once; both pages use it.

**Files:**
- Create: `src/renderer/src/components/PromptRow.tsx`
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` — the plan row (~55-215) and the terminal row (~305-380) consume it
- Test: `tests/prompt-row.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export function PromptRow(props: {
    title: string;
    subtitle: string;            // what it does and WHEN it fires
    on: boolean;
    onToggle: (on: boolean) => void;
    prompt: string | null;       // null = still loading; "" = none to show
    promptError?: boolean;
    promptNote?: string;         // e.g. "your diff is inserted here"
    append: string;
    onAppendChange: (v: string) => void;
    onAppendSave: () => void | Promise<void>;
    right?: React.ReactNode;     // the model picker slot, empty for built-in tools
    children?: React.ReactNode;  // extra body (the plan row's confirm dialog)
  }): React.JSX.Element;
  ```
  Task 6 renders three of these.

- [ ] **Step 1: Write the failing test**

Create `tests/prompt-row.test.ts`. The renderer suite has **no DOM** (`vitest.config.ts` includes `tests/**/*.test.ts` only, no jsdom, no testing-library), so this is a source scan plus the exported copy constant — the `tests/modal-layer.test.ts` pattern:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { APPEND_HELP } from "../src/renderer/src/components/PromptRow";

test("the append-never-override rule is stated once, in the shared row", () => {
  expect(APPEND_HELP).toMatch(/can't be edited|cannot be edited/);
  expect(APPEND_HELP).toMatch(/appended/);
});

test("BuiltinToolsBlock no longer carries its own copy of the row", () => {
  const src = readFileSync(new URL("../src/renderer/src/components/BuiltinToolsBlock.tsx", import.meta.url), "utf8");
  expect(src).toMatch(/PromptRow/);
  // the help string lived here as a local const; it must live in ONE place now
  expect(src).not.toMatch(/The built-in prompt above can't be edited/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/prompt-row.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: FAIL — module not found.

- [ ] **Step 3: Extract**

Move `BuiltinToolsBlock.tsx`'s `APPEND_HELP` const (~26-27) and the expandable body — the `built-in prompt (read-only)` label, the `<pre>`, the append `<textarea>`, the Save button and the `TogglePill` — into `PromptRow.tsx`, exporting `APPEND_HELP`. Keep `TogglePill` where it is and import it, or move it too; either is fine as long as there is exactly one definition. Rewire both `BuiltinToolsBlock` rows to the new component. **Do not change any user-visible copy in this task** — a pure extraction, so a regression here is a diff, not a mystery.

- [ ] **Step 4: Run it and the existing suite**

```bash
npx vitest run tests/prompt-row.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): one prompt row, two pages"
```

---

### Task 6: The "On your behalf" page

**Files:**
- Create: `src/renderer/src/components/OnBehalfView.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx:10-19` (the `View` union) and the `NAV` array (~168-192) — insert after `sysprompt`
- Modify: `src/renderer/src/App.tsx:2270` — add the route beside `SystemPromptView`
- Modify: `src/main/ipc.ts` — add `hv:assistant-task-prompt`, `hv:assistant-tasks-get`, `hv:assistant-task-set`
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts` — the three bindings
- Test: `tests/on-behalf-view.test.ts` (create)

**Interfaces:**
- Consumes: `PromptRow` (Task 5), `getAssistantTasks`/`setAssistantTask` (Task 3), `buildTitlePrompt`/`buildDraftPrompt`/`buildPrPrompt` (Task 4), `ModelSelect` (existing).
- Produces:
  ```ts
  // hv.d.ts
  assistantTasksGet(): Promise<Record<"title"|"commit-message"|"pr-draft", { enabled: boolean; model: { provider: string; modelId: string } | null; append: string }>>;
  assistantTaskSet(id: "title"|"commit-message"|"pr-draft", patch: { enabled?: boolean; model?: { provider: string; modelId: string } | null; append?: string }): Promise<void>;
  assistantTaskPrompt(id: "title"|"commit-message"|"pr-draft"): Promise<{ text: string; note: string }>;
  ```
  Task 7 does **not** use these — the AGENTS.md draft is an agent, so it reads the agent inventory instead.

- [ ] **Step 1: Write the failing test**

Create `tests/on-behalf-view.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { TASK_COPY } from "../src/renderer/src/components/OnBehalfView";

test("the page sits after System prompt, not among the capability pages", () => {
  const ids = NAV.map((n) => n.view);
  expect(ids).toContain("onBehalf");
  expect(ids.indexOf("onBehalf")).toBe(ids.indexOf("sysprompt") + 1);
});

test("three tasks, and the AGENTS.md draft is NOT one of them (PRD §15)", () => {
  expect(Object.keys(TASK_COPY).sort()).toEqual(["commit-message", "pr-draft", "title"]);
  const src = readFileSync(new URL("../src/renderer/src/components/OnBehalfView.tsx", import.meta.url), "utf8");
  expect(src).not.toMatch(/AGENTS\.md/);
  expect(src).not.toMatch(/agents-md/);
});

test("every row says when it fires — the thing no surface said before", () => {
  for (const c of Object.values(TASK_COPY)) {
    expect(c.when.length).toBeGreaterThan(10);
    expect(c.offMeans.length).toBeGreaterThan(10);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/on-behalf-view.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: FAIL — module not found.

- [ ] **Step 3: Main — the three handlers**

Beside `hv:builtin-prompt` (`ipc.ts:3052`), copying its shape:

```ts
// §19 (2026-08-30): the "On your behalf" page shows each task's prompt
// verbatim. The two git prompts only exist once there is a diff, so they are
// rendered as TEMPLATES with the insertion point named — showing a prompt
// built from an empty diff would be a different string from the real one.
ipcMain.handle("hv:assistant-task-prompt", (_e, id: AssistantTaskId) => {
  if (id === "title")
    return { text: buildTitlePrompt("<the first message you send in the session>"), note: "Your first message is inserted where it says so above." };
  if (id === "commit-message")
    return { text: buildDraftPrompt({ diff: "<your changes, as a diff>", files: [], recentSubjects: ["<your last 20 commit subjects>"] }, DEFAULT_DIFF_BUDGET), note: "Your diff and your recent commit subjects are inserted where they say so above. A large diff degrades to a file list plus the head of each change." };
  if (id === "pr-draft")
    return { text: buildPrPrompt({ commits: ["<the commits on this branch>"], diff: "<the branch's diff against its base>", branch: "<your branch>", base: "<the base branch>" }, DEFAULT_DIFF_BUDGET), note: "Your branch's commits and diff are inserted where they say so above." };
  return { text: "", note: "" };
});
ipcMain.handle("hv:assistant-tasks-get", () => getAssistantTasks());
ipcMain.handle("hv:assistant-task-set", (_e, id: AssistantTaskId, patch: Partial<AssistantTask>) => {
  setAssistantTask(id, patch);
  return getAssistantTasks();
});
```

Add the three preload bindings and the three `hv.d.ts` declarations.

- [ ] **Step 4: The page**

`OnBehalfView.tsx`, following `SystemPromptView.tsx`'s page shell (`max-w-3xl mx-auto w-full px-8 py-10`, `<h1 className="font-black text-3xl tracking-tight mb-2">`) and `Section`:

```tsx
export const TASK_COPY: Record<AssistantTaskId, { title: string; when: string; offMeans: string }> = {
  title: {
    title: "Session title",
    when: "Runs once per session, right after your first message — you never ask for it.",
    offMeans: "Off: sessions keep the first line of your message as their name.",
  },
  "commit-message": {
    title: "Commit message",
    when: "Runs when you press the wand beside the message box in Changes.",
    offMeans: "Off: the wand button is gone. You write the message yourself.",
  },
  "pr-draft": {
    title: "Pull request description",
    when: "Runs when you press “Open a pull request” in Changes.",
    offMeans: "Off: the button still works — the description falls back to your list of commits.",
  },
};
```

Each row is a `PromptRow` with the `right` slot filled by `ModelSelect` (`onClear` set, `clearLabel="Same as your default model"`, `models` from `window.hv.listModels()`). Above the rows, one paragraph: these run outside any session, so nothing enters a transcript or a context window, and their cost is an **estimate** in the Audit log and in Stats — never a session's pill (§19). When `listModels()` comes back empty AND no default resolves, each row shows **"No model configured — this never runs"** in place of the picker, and links to Models.

Wire the nav: add `| "onBehalf"` to the `View` union and `{ view: "onBehalf", label: "On your behalf", Icon: OnBehalfIcon }` immediately after the `sysprompt` entry. Add `{activeView === "onBehalf" && <OnBehalfView />}` beside line 2270.

- [ ] **Step 5: Run the test and the gate**

```bash
npx vitest run tests/on-behalf-view.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: both PASS.

- [ ] **Step 6: Renderer honours the commit switch**

`ChangesPanel.tsx:100` sets `canDraft` from a provider probe. AND the task's switch into it:

```tsx
void Promise.all([window.hv.providersStatus?.(), window.hv.assistantTasksGet()])
  .then(([p, tasks]) => setCanDraft(tasks["commit-message"].enabled && (p.byok.some((b) => b.source !== null) || !!p.defaultModel)))
  .catch(() => setCanDraft(false));
```

(Keep whatever the existing probe call actually is on line 99 — only the `.then` changes.) This is the affordance; Task 4 already made main refuse regardless.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): a page for the model calls the app makes for you"
```

---

### Task 7: The AGENTS.md button stops lying when its agent is off

The draft stays an agent (PRD §15, 2026-08-30). The one gap that leaves: turning `agents-md-maker` off on the Agents page leaves "Draft it for me" visible, and pressing it fails with *"No draft was produced this turn"*.

**Files:**
- Modify: `src/renderer/src/components/AgentsMdPanel.tsx` — the draft button
- Test: `tests/agents-md-panel.test.ts` (create, source scan)

**Interfaces:**
- Consumes: whatever the Agents page reads to render its per-agent switch — find it with `grep -n "agentEnabled\|setAgentEnabled\|agents(" src/renderer/src/components/AgentsView.tsx src/preload/index.ts` and reuse that exact binding. Do not add a second way to ask.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the draft button knows whether agents-md-maker is switched on", () => {
  const src = readFileSync(new URL("../src/renderer/src/components/AgentsMdPanel.tsx", import.meta.url), "utf8");
  expect(src).toMatch(/agents-md-maker/);
  // it must say WHY it can't run, not just fail after a turn
  expect(src).toMatch(/turned off|switched off|disabled/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/agents-md-panel.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: FAIL.

- [ ] **Step 3: Implement**

On mount, read the agent inventory the Agents page already uses; if `agents-md-maker` is absent or disabled, replace the draft button with: *"Drafting is turned off — switch agents-md-maker back on in Settings → Agents."* Do not disable the button silently and do not remove it: the user needs the sentence that names where the switch is.

- [ ] **Step 4: Run it and the gate**

```bash
npx vitest run tests/agents-md-panel.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(agents-md): say the agent is off instead of failing a turn to find out"
```

---

### Task 8: Verification in the running app

`src/main` changes need a **dev-server RESTART** — a renderer reload (⌘R) does not rebuild main. Before claiming any main-side behaviour, check the BUILT artifact, not the source:

```bash
grep -c "assistantTasks" out/main/index.js    # expect > 0
```

Every claim below is a thing that is TRUE ON SCREEN. Observe each on the page named, not on the page that changed it.

- [ ] **Step 1: Restart the dev server and open the page**

```bash
npm run dev
```

- [ ] **Step 2: Assert what is present — Settings → On your behalf**

- The sidebar's Settings group shows **On your behalf** in position immediately below **System prompt**.
- The page lists **exactly three** rows, titled *Session title*, *Commit message*, *Pull request description*.
- Expanding *Session title* shows the prompt text ending `Reply with ONLY the title.`, with a note that your first message is inserted into it.
- Expanding *Commit message* shows a prompt containing `at most 72 characters` and a note that your diff is inserted.
- Each row's model control reads **"Same as your default model"** before you touch it.

- [ ] **Step 3: Assert the absences, by name**

An absence cannot be screenshotted, so read for it:

- **`AGENTS.md` appears nowhere on this page** — no fourth row, no mention in the intro paragraph. It is an agent, and it lives on **Settings → Agents**.
- **No editable prompt.** Every prompt block is a read-only `<pre>`; the only writable field per row is the append box.
- **`Settings → Models` has gained nothing.** The page is a peer of Models, not a section inside it — check Models still ends where it did.
- **`All Tools` has gained nothing.** Its built-in-tools block still shows exactly Plan mode, ask_user, Terminal, intent and browser — the extraction in Task 5 must not have added or dropped a row there.

- [ ] **Step 4: Assert the appends and switches — observed on OTHER pages**

The surface that owns a setting is not the surface that shows its effect. Each of these is checked away from the page that changed it:

- Type `always start with the word chore` into *Commit message*'s append box, Save. Go to a workspace with changes → **Changes panel** → press the wand. The drafted message starts with `chore`.
- Then open **Settings → Audit log**: the newest `assistant` row is `drafted a commit message` and it is marked as having an appended prompt.
- Switch *Session title* off. Start a **new chat session** and send a message. After the turn, the session's name in the **sidebar** is still the truncated first message — it never changes to a model-written title. The Audit log gains **no** `named a session` row for it.
- Switch *Commit message* off. In the **Changes panel**, the wand button beside the message box is **gone** (not greyed).
- Switch *Pull request description* off. In the **Changes panel**, **"Open a pull request" is still there** and still opens the forge — with the body filled from your commit list rather than prose. This is the one switch that must NOT hide its button.

- [ ] **Step 5: Assert the model resolution fix — Sidebar, not Settings**

- Set a **workspace** model override (workspace gear → Model) different from the global default.
- Start a new session in that workspace and send a message.
- **Settings → Audit log**: the `named a session` row names the **workspace's** model, not the global default. Before this change it named the global one — that is the bug, and the audit row is the only place it is visible.

- [ ] **Step 6: The regression this design risks**

`PromptRow` is now shared by two pages, and its append box saves through two different setters. Perform this sequence:

1. **All Tools** → expand Plan mode → type `x` in its append box → Save.
2. Without reloading, go to **On your behalf** → expand *Session title* → its append box is **empty**, not `x`.
3. Type `y` there → Save → go back to **All Tools** → Plan mode's append still reads `x`, not `y`.

If either box shows the other's text, the extracted component is holding state above the row instead of per-row.

- [ ] **Step 7: Capture and record**

Screenshot the page and the two Changes-panel states (wand present / wand gone). Record a live-batch run in `docs/validation/live-runs.md`, **not** `RESULTS.md` — that file is explicitly historical ("the rows are deliberately not updated") and records the 2026-07-03 V1-V7 spike only.

- [ ] **Step 8: Final gate, then check whether the live batch is owed**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
npm run live:why
```

`live:why` diffs `main...HEAD`, so it only sees COMMITTED work — run it **after** the last commit. Expect **empty output** (nothing here touches `pi-runtime/extensions/`, `src/main/pi/`, or a live test file). If it prints anything, run `npm run test:live` in the background and wait. **If it prints nothing, say so** — do not silently omit the batch.

---

## What this plan deliberately does NOT do

- **No per-workspace tier** for these three tasks (PRD §19, out of scope). Global only.
- **No prompt rewriting.** The three prompts keep their exact wording; an append is added, never an edit.
- **No group-B surfacing** — linked skill/prompt directories, plugin marketplaces, `subagentInspect`. Named in the spec, filed separately, so this round stays one topic.
- **No "unreferenced preload binding" sweep test.** The sweep that found these 14 was a one-off audit; a standing test over 241 bindings would flag every binding built one commit ahead of its UI, which is a normal state here. Re-run the audit by hand next time the question comes up.
