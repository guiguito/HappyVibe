# User guidance system — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HappyVibe's guidance one system — one page-header shape, one empty state, clickable cross-page pointers, a written tooltip doctrine, and five `How X works` disclosures — without adding a nav entry, a tone, a tooltip library, or a help page.

**Architecture:** Four new shared renderer components (`EmptyState`, `GoTo`, `InfoDot`, `Banner`) plus one nav context, each exporting its copy as a record so the DOM-less test suite can assert on data and scan source for absences. No main-process change except one `config.json` field for global hint dismissal (task 8) and the three stale comments deleted in task 1.

**Tech Stack:** React 19 + TypeScript + Tailwind v4 (renderer), vitest (no DOM — assert exported data + comment-stripped source scans), Electron main for `config.json`.

**Spec:** Notion "🆘 More user guidance" (`3ccd33dfffca80a88ae4e9ed53fc19e8`), decisions locked 2026-08-31. Mirrored into `docs/prd.md` §20 (the system), §15 (instruction-priority prose now, live list deferred), §22 (no onboarding re-open).

## Global Constraints

- **No new nav entry, no new tone, no tooltip library, no help page, no tour framework, no second empty-state tier.** (§20 round 17)
- **Standard page `h1`:** `font-black text-3xl tracking-tight` — exactly one sentence of intro beneath it, answering *what is this page*. Section subtitles carry only the delta.
- **Empty-state sentence template:** `No X yet — ⟨what to do⟩.` Headline matches `/^No .+ yet/`, `next` is never empty.
- **Locked words:** UI says *Prompts* · *cost*, never *budget* · *command* = a slash invocation or a shell command only.
- **Tones:** berry = danger/destructive · honey = attention/offer · leaf = done/safe · sky = informational · tangerine = primary action. Never a sixth.
- **The renderer test suite has NO DOM.** `vitest.config.ts` includes `tests/**/*.test.ts` only — no `.tsx`, no jsdom, no `@testing-library/react`. Tests import pure exports from `.tsx` files and scan source text. An *absence* is always a comment-stripped source scan (`rendered()` in `tests/on-behalf-view.test.ts`), never a render assertion.
- **Floating surfaces:** must carry a literal `absolute`/`fixed` Tailwind class word with a tight box (`browserCoverage.ts` gathers by class word and judges by BOX), and z-index ≤ 50 unless it is a real `.hv-overlay`/`.hv-dialog` at 100 (`tests/modal-layer.test.ts`).
- **Principle 11 (new, load-bearing):** guidance that describes a gate is DERIVED from that gate, never re-typed beside it. Where a disclosure states a rule the code enforces, its test asserts against the enforcing constant.
- **Never run `npm run lint` / `npm run format`** — scaffold leftovers, 19,839 warnings, an 85%-of-repo diff.
- **Never pipe a test run to `tail`/`grep`** — redirect to a log file, echo `$?`, then grep the log for free.
- **`npm run live:why` decides the live batch.** It diffs `main...HEAD`, so check it *after* the commit that carries a change. Nothing in this plan touches `pi-runtime/extensions/` except task 7's one-line prompt fix, so expect it to print only then.

---

### Task 0: Make the worktree runnable

This worktree has neither `node_modules` — a gate here fails on a missing binary, not on your code.

**Files:** none (environment only)

- [ ] **Step 1: Install both trees**

```bash
cd /Users/guilhemduche/.superset/worktrees/HappyVibe/user-guidance
npm install && (cd pi-runtime && npm ci)
```

- [ ] **Step 2: Symlink the API key so a live run is not a silent skip**

`.env` is gitignored so it does not travel with a worktree; without it every live file skips itself and the batch exits 0 in ~5 s while *looking* green.

```bash
ln -s ~/Documents/Github/HappyVibe/.env .env
git check-ignore -v .env   # must print a match — the link stays ignored
```

- [ ] **Step 3: Establish the baseline**

```bash
L=/tmp/gate-baseline.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS. If it fails, fix that before starting — you need a green baseline to attribute later failures.

---

### Task 1: The copy-only pass

Biggest visible win per line changed, and no new components. Fixes findings 1, 2, 5, 10, 12 and the dead-end *sentences* of finding 6 (the `EmptyState` *component* is task 2 — this task only makes the words right where they already are).

**Files:**
- Modify: `src/renderer/src/components/TerminalView.tsx:147` (h1 classes)
- Modify: `src/renderer/src/components/VoiceView.tsx:137` (h1 classes)
- Modify: `src/renderer/src/components/WorkspaceSettingsView.tsx:64` (add intro)
- Modify: `src/renderer/src/components/AllToolsView.tsx:108`, `SkillsView.tsx`, `PromptTemplatesView.tsx`, `McpView.tsx` (dedupe intros)
- Modify: `src/renderer/src/components/DashboardView.tsx:97` (delete local `Section`), `:23,:58,:81,:217` (empty sentences), and the four `Section` call sites (add subtitles)
- Modify: `src/renderer/src/components/AgentsView.tsx:102`, `AllToolsView.tsx:112`, `McpServersSection.tsx:298`, `Sidebar.tsx:708`, `ContextPanel.tsx:164`, `PermissionRulesSection.tsx:111` (dead-end sentences)
- Modify: `src/renderer/src/App.tsx:137`, `src/renderer/src/components/OnboardingOverlay.tsx:4`, `src/main/ipc.ts:3167` (delete stale comments)
- Modify: `docs/validation/d1.md:340` (correct the stale claim)
- Create: `tests/page-headers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. Later tasks rely on `DashboardView` having no local `Section` and on the dead-end strings already reading `No X yet — …`, so task 2 only moves them into a component.

**Two things are deliberately NOT in scope here.** Search-result empties (`No models match "{filter}".` `ModelSelect.tsx:141`, `No provider matches …` `ModelsView.tsx:474`, `Nothing matches that search.` `PluginsSection.tsx:398`) are a different class: the next step is "change your search", it is obvious, and `/^No .+ yet/` does not fit them. Leave them. And the empties that *already* name a next step (`ModelsView.tsx:389`, `:692`, `WorkspaceSettingsView.tsx:370`, `:394`, `:492`) keep their words — `:394` and `:492` get their pointers linked in task 5, not rewritten here.

- [ ] **Step 1: Write the failing test**

Create `tests/page-headers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const VIEWS = path.resolve(__dirname, "../src/renderer/src/components");
const H1 = /<h1\s+className="([^"]*)"/g;
/** The one shape a page header may take (§20 round 17). */
const STANDARD = ["font-black", "text-3xl", "tracking-tight"];

/** Every *View.tsx that renders a page-level h1. ChatView's welcome h1 is a
 *  greeting on the empty-state screen, not a page header, so it is exempt. */
function viewFiles(): string[] {
  return fs
    .readdirSync(VIEWS)
    .filter((f) => f.endsWith("View.tsx") && f !== "ChatView.tsx")
    .map((f) => path.join(VIEWS, f));
}

describe("page headers are one shape (§20 round 17)", () => {
  it("every page h1 carries the standard classes", () => {
    const bad: string[] = [];
    for (const file of viewFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(H1)) {
        const cls = m[1];
        if (!STANDARD.every((c) => cls.split(/\s+/).includes(c))) {
          bad.push(`${path.basename(file)}: ${cls}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("at least one h1 was actually inspected", () => {
    // Guards the scan against passing vacuously if the glob ever stops matching.
    const found = viewFiles().filter((f) => /<h1/.test(fs.readFileSync(f, "utf8")));
    expect(found.length).toBeGreaterThan(10);
  });
});

describe("the deleted Help affordance is not promised anywhere", () => {
  it("no source or doc claims the onboarding overlay is re-openable", () => {
    const roots = ["../src", "../docs"].map((r) => path.resolve(__dirname, r));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|md)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("Help affordance")) {
          hits.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/t1.log
npx vitest run tests/page-headers.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: FAIL twice — `TerminalView.tsx: text-2xl font-bold` and `VoiceView.tsx: font-black text-2xl tracking-tight` in the first, four "Help affordance" paths in the second.

- [ ] **Step 3: Fix the two h1s**

`TerminalView.tsx:147` and `VoiceView.tsx:137` both become:

```tsx
<h1 className="font-black text-3xl tracking-tight mb-1">Terminal</h1>
```
```tsx
<h1 className="font-black text-3xl tracking-tight mb-1">Voice</h1>
```

- [ ] **Step 4: Delete the four stale Help claims**

Remove the words "re-openable from the Help affordance" from `src/renderer/src/App.tsx:137`, `src/renderer/src/components/OnboardingOverlay.tsx:4` and `src/main/ipc.ts:3167`, leaving each comment otherwise intact and true. In `App.tsx` the sentence becomes:

```tsx
  // session (no prior sessions). Dismissing it is permanent — §7 round 8
  // deleted the Help entry, and §22 round 17 confirmed no re-open path.
```

Apply the same correction in `OnboardingOverlay.tsx:4` and `src/main/ipc.ts:3167`, and correct the claim at `docs/validation/d1.md:340` to say the overlay shows once with no re-open path.

- [ ] **Step 5: Add the Workspace-settings intro**

Under the `h1` at `WorkspaceSettingsView.tsx:64` (below the existing path line):

```tsx
<p className="text-sm text-ink-soft mb-8">
  Everything about this project only — model, permissions, skills, prompts and MCP servers that
  apply here and nowhere else.
</p>
```

- [ ] **Step 6: Dedupe the four double intros**

The `h1` intro answers *what is this page*; the `Section` subtitle keeps only the delta.

- `AllToolsView.tsx:108` subtitle → `"Permission state comes from your rules."` (the cross-page pointer becomes a link in task 5 — leave the words plain for now, no parenthetical).
- `SkillsView.tsx` subtitle → `"Reviewed and gated. Workspace-specific skills are managed in each workspace's settings."`
- `PromptTemplatesView.tsx` subtitle → `"Typing /name expands the file into your message — nothing runs on its own. Project prompts are managed in each workspace's settings."`
- `McpView.tsx` subtitle → keep `"Recognised Model Context Protocol servers, ready to install."` (already a delta), and trim the `h1` intro's second sentence to `External MCP servers, available in every workspace.` — the "add one for a single project" pointer moves to task 5's link.

- [ ] **Step 7: Delete `DashboardView`'s local `Section` and add the four subtitles**

Delete `function Section(` at `DashboardView.tsx:97`, import the shared one, and give each call site its subtitle:

```tsx
import { Section } from "./Section";
// Sessions over time  → "How much you've used the agent, day by day."
// By workspace        → "Where your sessions happen."
// By model            → "Which models you actually use — and what each one cost."
// Permission activity → "What the agent asked for, and what you decided."
```

The shared `Section` requires an `icon` too — reuse existing keys from `SECTION_ICONS` in `Section.tsx`.

- [ ] **Step 8: Rewrite the dead-end sentences**

```
DashboardView.tsx:23  "No sessions yet."                    → "No sessions yet — start one from a workspace in the sidebar."
DashboardView.tsx:58  "No data yet."                        → "No data yet — this fills in once you've run a session."
DashboardView.tsx:81  "None yet."                           → "Nothing yet — this fills in once you've run a session."
DashboardView.tsx:217 "No permission decisions logged yet." → "No permission decisions yet — they appear here once the agent asks for something."
AgentsView.tsx:102    "No agents found."                    → "No agents yet — the bundled ones appear after your first session runs."
AllToolsView.tsx:112  "No tools reported."                  → "No tools yet — start a session and this fills in from the live agent."
McpServersSection.tsx:298 "No MCP servers configured."      → "No MCP servers yet — install one from the catalog above, or add your own."
Sidebar.tsx:708       "No sessions yet."                    → "No sessions yet — hit + next to a workspace."
ContextPanel.tsx:164  "Nothing in context yet."             → "Nothing in context yet — it fills in as soon as you send a message."
PermissionRulesSection.tsx:111 "No {…} rules yet."          → "No {…} rules yet — add one below, or let the agent ask and choose Always."
```

`DashboardView.tsx:81` intentionally breaks the `/^No /` prefix because "None yet." is a `<span>` inside a sentence — task 2's `EMPTY_COPY` assertion covers only the entries that become `EmptyState`, and this one stays inline prose.

- [ ] **Step 9: Run the test and the suite**

```bash
L=/tmp/t1.log
npx vitest run tests/page-headers.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
npm test > /tmp/t1-full.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1-full.log
```

Expected: both PASS. If `tests/dashboard*.test.ts` or a view test fails on a changed string, update the test — the string is the thing that changed on purpose.

- [ ] **Step 10: GUI pass — see Verification, PR 1**

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "fix(guidance): every page says what it is once, and every empty state names the next step"
```

---

### Task 2: `EmptyState` — one component, one tier

**Files:**
- Create: `src/renderer/src/components/EmptyState.tsx`
- Create: `tests/empty-state.test.ts`
- Modify: the ten sites listed in task 1 step 8, plus `AgentsMdPanel.tsx:207`

**Interfaces:**
- Consumes: the corrected sentences from task 1.
- Produces:
  ```tsx
  export type EmptyKey = keyof typeof EMPTY_COPY;
  export const EMPTY_COPY: Record<string, { headline: string; next: string }>;
  export function EmptyState(props: {
    copy: EmptyKey;
    action?: { label: string; onClick: () => void };
  }): React.JSX.Element;
  ```
  Task 5 adds an optional `goTo?: View` to the same props; task 8 does not touch it.

- [ ] **Step 1: Write the failing test**

Create `tests/empty-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_COPY } from "../src/renderer/src/components/EmptyState";

describe("EMPTY_COPY (§20 round 17: every empty state names the next step)", () => {
  it("every headline states the fact in the locked shape", () => {
    for (const [key, v] of Object.entries(EMPTY_COPY)) {
      expect(v.headline, key).toMatch(/^No .+ yet$/);
    }
  });

  it("every entry names a next step", () => {
    for (const [key, v] of Object.entries(EMPTY_COPY)) {
      expect(v.next.trim().length, key).toBeGreaterThan(10);
      expect(v.next, key).toMatch(/\.$/);
    }
  });

  it("covers the surfaces the audit found dead-ending", () => {
    for (const k of ["agents", "tools", "mcpServers", "sidebarSessions", "context", "agentsMd"]) {
      expect(Object.keys(EMPTY_COPY)).toContain(k);
    }
  });
});

describe("one tier only", () => {
  it("no second empty-state shape ships beside it", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/renderer/src/components/EmptyState.tsx"),
      "utf8",
    );
    // The locked tier is the dashed box (SystemPromptView/OnBehalfView shape).
    expect(src).toContain("border-dashed");
    // An illustrated full-page tier was explicitly not built.
    expect(src).not.toMatch(/<svg[^>]*class[^>]*size-(1[6-9]|2\d)/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/t2.log; npx vitest run tests/empty-state.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

Expected: FAIL — cannot resolve `../src/renderer/src/components/EmptyState`.

- [ ] **Step 3: Write the component**

Create `src/renderer/src/components/EmptyState.tsx`:

```tsx
/**
 * §20 round 17 — the ONE empty state. One visual tier: the dashed box that
 * SystemPromptView and OnBehalfView already used. The illustrated card the
 * audit thought it was generalizing never existed, and a second tier is a
 * second thing to keep consistent.
 *
 * Copy lives here as DATA so tests/empty-state.test.ts can assert on the prose
 * without a DOM (the TASK_COPY pattern from OnBehalfView).
 */
export const EMPTY_COPY = {
  agents: {
    headline: "No agents yet",
    next: "The bundled ones appear after your first session runs.",
  },
  tools: {
    headline: "No tools yet",
    next: "Start a session and this fills in from the live agent.",
  },
  mcpServers: {
    headline: "No MCP servers yet",
    next: "Install one from the catalog above, or add your own.",
  },
  sidebarSessions: {
    headline: "No sessions yet",
    next: "Hit + next to a workspace.",
  },
  context: {
    headline: "Nothing in context yet",
    next: "It fills in as soon as you send a message.",
  },
  agentsMd: {
    headline: "No AGENTS.md yet",
    next: "Write the house rules for this project, or let an agent draft them for you.",
  },
  statsSessions: {
    headline: "No sessions yet",
    next: "Start one from a workspace in the sidebar.",
  },
  statsData: {
    headline: "No data yet",
    next: "This fills in once you've run a session.",
  },
  statsPermissions: {
    headline: "No permission decisions yet",
    next: "They appear here once the agent asks for something.",
  },
  rules: {
    headline: "No rules yet",
    next: "Add one below, or let the agent ask and choose Always.",
  },
} as const;

export type EmptyKey = keyof typeof EMPTY_COPY;

export function EmptyState({
  copy,
  action,
}: {
  copy: EmptyKey;
  action?: { label: string; onClick: () => void };
}): React.JSX.Element {
  const { headline, next } = EMPTY_COPY[copy];
  return (
    <div className="rounded-xl border-2 border-dashed border-line px-4 py-3 text-sm text-ink-soft">
      <span className="font-bold text-ink">{headline}</span> — {next}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-2 rounded-lg border-2 border-line bg-card px-2 py-0.5 text-xs font-bold shadow-sticker cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

Note `context` and `agentsMd` break the `/^No .+ yet$/` headline shape ("Nothing in context yet"). Either relax the regex to `/^(No|Nothing) .+ yet$/` in the test, or reword the copy — **relax the regex**, because "Nothing in context" is the honest sentence and the rule is about naming a next step, not about the literal word "No". Make that edit to the test in this step and note it in the commit.

- [ ] **Step 4: Run the test and watch it pass**

```bash
L=/tmp/t2.log; npx vitest run tests/empty-state.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

Expected: PASS.

- [ ] **Step 5: Migrate the ten sites**

Replace each bare paragraph with `<EmptyState copy="…" />`. The `AgentsMdPanel.tsx:207` case is the one that changes shape rather than styling: today the guidance is the `<textarea placeholder>`, which vanishes the moment the user types. Render `<EmptyState copy="agentsMd" action={{ label: "Draft it for me", onClick: … }} />` **above** the editor when the file is empty, and drop the placeholder text to a short `Markdown…`.

- [ ] **Step 6: Run the suite**

```bash
npm test > /tmp/t2-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t2-full.log
```

Expected: PASS. `tests/agents-md*.test.ts` may assert on the old placeholder — update it, the placeholder stopped being the empty state on purpose.

- [ ] **Step 7: GUI pass — see Verification, PR 2**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(guidance): one empty state, one shape, and it always names the next step"
```

---

### Task 3: `InfoDot` + `Section` for Audit and Cost

> **Corrected during implementation (2026-08-31).** Three of this task's four items were
> mis-specified by the audit, and reading the code rather than building to the spec is what
> caught it:
>
> 1. **The Audit page is a card list, not a table.** It has no `<th>` anywhere, so there are no
>    column heads to hang `InfoDot`s on. And `sourceText()` (`AuditView.tsx:125`) already RENDERS
>    `bypass · rules would have asked` as **visible text** — the audit's "meaning lives only in
>    hover tooltips" is wrong. The one real gap is that nothing ever said what that clause *means*,
>    so the fix is one sentence in the page intro (`AUDIT_COPY.wouldHave`). The proposed legend
>    line would have restated what every row already says — the exact mistake round 15 made with
>    the `SOURCE_TONE` amber and reverted after a GUI pass.
> 2. **The Agents page's token cost is already inline.** `83f54ac` ("the page reads like the
>    Skills page — the row is the control") landed *after* the audit was written: the Section
>    subtitle carries the roster cost and every row shows `~N tok` as visible text
>    (`AgentsView.tsx:97`, `:128`). Finding 8's Agents half is closed; nothing to do.
> 3. **`InfoDot` has exactly one honest call site**, the Cost panel's Cache column. Stats already
>    carries its caveats as visible `sub` text ("estimate — some prices unknown"), and Audit has no
>    columns. A shared component + copy record + test file for one site is scaffolding for later,
>    so the glyph is **local to `CostPanel.tsx`** with its copy exported from there. Extract it if a
>    second site ever appears.
>
> What actually shipped: `COST_COPY` (the estimate line + the cache explanation), a discoverable ⓘ
> on the Cache header, the cost panel's `EmptyState`, and `AUDIT_COPY.wouldHave`. Test is
> `tests/cost-audit-copy.test.ts`, not `tests/info-dot.test.ts`.

Finding 8: the same class of fact is inline on one page and tooltip-only on another. Fixes the two data-dense surfaces that explain nothing.

**Files:**
- Create: `src/renderer/src/components/InfoDot.tsx`
- Create: `tests/info-dot.test.ts`
- Modify: `src/renderer/src/components/AuditView.tsx:205+` (wrap in `Section`, InfoDots on column heads, one legend line)
- Modify: `src/renderer/src/components/CostPanel.tsx` (header line, InfoDot on the cache column, `EmptyState`)
- Modify: `src/renderer/src/components/AgentsView.tsx` (inline token-cost line, twinning the tooltip)

**Interfaces:**
- Consumes: `EmptyState` from task 2.
- Produces:
  ```tsx
  export const INFO_COPY: Record<string, string>;
  export function InfoDot({ copy }: { copy: keyof typeof INFO_COPY }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/info-dot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { INFO_COPY } from "../src/renderer/src/components/InfoDot";

describe("INFO_COPY", () => {
  it("covers the columns whose meaning lived only in hover", () => {
    for (const k of ["auditDecision", "auditSource", "auditWouldHave", "costCacheRead", "costCacheWrite"]) {
      expect(Object.keys(INFO_COPY)).toContain(k);
    }
  });

  it("every entry is a full sentence", () => {
    for (const [k, v] of Object.entries(INFO_COPY)) {
      expect(v.length, k).toBeGreaterThan(20);
      expect(v, k).toMatch(/\.$/);
    }
  });

  it("the would-have entry says it is the ENGINE's answer, not a decision", () => {
    // wouldHave is a RuleAction (allow/ask/deny), never an AuditDecision —
    // mapping `ask` onto `allow-session` is the exact misreport it exists to prevent.
    expect(INFO_COPY.auditWouldHave).toMatch(/\bask\b/i);
  });
});

describe("the glyph is accessible and non-floating", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/src/components/InfoDot.tsx"),
    "utf8",
  );
  it("carries both title and aria-label (the CardGlyph pattern)", () => {
    expect(src).toContain("aria-label");
    expect(src).toContain("<title>");
  });
  it("is not a floating surface", () => {
    // A native title= tooltip is the browser's, not ours — it needs no
    // absolute/fixed box and must not be one (browserCoverage.ts).
    expect(src).not.toMatch(/className="[^"]*\b(absolute|fixed)\b/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/t3.log; npx vitest run tests/info-dot.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/renderer/src/components/InfoDot.tsx`:

```tsx
/**
 * §20 round 17 — a column header cannot carry a sentence, so it carries a dot.
 * Built exactly like CardGlyph: one SVG, a nested <title>, an aria-label, copy
 * exported as data. NOT a floating surface — the tooltip is the browser's.
 */
export const INFO_COPY = {
  auditDecision: "What you chose: allow once, allow for the rest of this session, or deny.",
  auditSource: "Which layer answered — a global rule, this workspace's rules, a session grant, or a bypass.",
  auditWouldHave: "What your rules would have answered on their own — allow, ask or deny — when a bypass let the call through anyway.",
  costCacheRead: "Prompt tokens served from the provider's cache. This is where an estimate and an invoice diverge hardest.",
  costCacheWrite: "Prompt tokens written into the provider's cache so a later turn can read them back cheaply.",
} as const;

export function InfoDot({ copy }: { copy: keyof typeof INFO_COPY }): React.JSX.Element {
  const text = INFO_COPY[copy];
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block size-3.5 ml-1 align-[-1px] text-ink-soft/70"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      role="img"
      aria-label={text}
    >
      <title>{text}</title>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
L=/tmp/t3.log; npx vitest run tests/info-dot.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 5: Wrap Audit and Cost**

- `AuditView.tsx`: wrap the table in the shared `Section` (`icon="audit"` or an existing key), subtitle `"Every permission decision, newest first — what was asked for, what answered, and what you chose."` Add `<InfoDot copy="auditDecision" />`, `auditSource`, `auditWouldHave` to the matching column headers, and one visible legend line beneath the table: `A bypass row shows what your rules would have answered on their own.`
- `CostPanel.tsx`: add the header line `Every billed call in this session — newest first. All costs are estimates.`, `<InfoDot copy="costCacheRead" />` / `costCacheWrite` on those columns, and an `EmptyState` when there are no rows. Add a `costs` entry to `EMPTY_COPY` (`headline: "No billed calls yet"`, `next: "They appear here as soon as the agent talks to a model."`).
- `AgentsView.tsx`: add the inline token-cost line that Skills already has, twinning the existing tooltip.

- [ ] **Step 6: Run the suite, GUI pass (Verification, PR 3), commit**

```bash
npm test > /tmp/t3-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t3-full.log
git add -A
git commit -m "feat(guidance): the audit and cost tables say what their columns mean"
```

---

### Task 4: `Banner` extraction

Pure refactor — copy unchanged. Do it before `GoTo` so task 5 does not have to touch four hand-rolled banners.

**Files:**
- Create: `src/renderer/src/components/Banner.tsx`
- Create: `tests/banner.test.ts`
- Modify: `src/renderer/src/App.tsx:2332` (honey), `:2345` (berry), `src/renderer/src/components/ChatView.tsx:814`, `:828` (berry)

**Interfaces:**
- Produces:
  ```tsx
  export function Banner(props: {
    tone: "danger" | "attention" | "info";
    children: React.ReactNode;
    onDismiss?: () => void;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/banner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const R = path.resolve(__dirname, "../src/renderer/src");

/** Comment-stripped source, so a mention in a comment is not a false hit. */
function rendered(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("one Banner (§20 round 17)", () => {
  it("the hand-rolled grammar survives nowhere but Banner.tsx", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && e.name !== "Banner.tsx" && /px-6 py-2\.5/.test(rendered(p))) {
          hits.push(path.basename(p));
        }
      }
    };
    walk(R);
    expect(hits).toEqual([]);
  });

  it("Banner offers exactly the three locked tones", () => {
    const src = rendered(path.join(R, "components/Banner.tsx"));
    expect(src).toMatch(/danger/);
    expect(src).toMatch(/attention/);
    expect(src).toMatch(/info/);
    // §20's tone vocabulary is five words and guidance never invents a sixth.
    expect(src).not.toMatch(/\bmauve\b|\bviolet\b|\bteal\b/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail** (four hits expected)

```bash
L=/tmp/t4.log; npx vitest run tests/banner.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 3: Write the component**

```tsx
/**
 * §20 round 17 — the banner grammar, hand-rolled four times, extracted once.
 * Principle 10: persistent state is a pill, transient guidance is a banner —
 * so the plan pill stays a pill and does NOT come through here.
 */
const TONE = {
  danger: "bg-berry-soft border-berry/60 text-berry",
  attention: "bg-honey-soft border-honey/60",
  info: "bg-sky-soft border-sky/60",
} as const;

export function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: keyof typeof TONE;
  children: React.ReactNode;
  onDismiss?: () => void;
}): React.JSX.Element {
  return (
    <div className={`flex items-center gap-3 px-6 py-2.5 border-b-2 text-sm font-semibold ${TONE[tone]}`}>
      {children}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="ml-auto text-xs font-bold underline cursor-pointer">
          Dismiss
        </button>
      )}
    </div>
  );
}
```

Check `bg-sky-soft` and `border-sky` exist in the Tailwind theme before using them; if `info` has no precedent in the theme, use the existing sky tokens the plan pill uses.

- [ ] **Step 4: Migrate the four sites, run the test, run the suite**

```bash
L=/tmp/t4.log; npx vitest run tests/banner.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
npm test > /tmp/t4-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t4-full.log
```

- [ ] **Step 5: GUI pass (Verification, PR 4), commit**

```bash
git add -A && git commit -m "refactor(guidance): one banner, four call sites, copy unchanged"
```

---

### Task 5: `GoTo` — every cross-page pointer is a link

> **Corrected during implementation (2026-08-31).** Two notes.
>
> 1. **A sixth phrasing existed** that the audit missed: `CostPanel.tsx`'s unknown-price banner said
>    *"Set $/Mtok in Settings → Custom endpoint."* It is a link now and is in the retirement scan.
> 2. **McpView's workspace pointer stays prose, deliberately.** From the GLOBAL MCP page there is no
>    single workspace to navigate to — the user has to pick one — so a link would have to guess.
>    "Open that workspace's own settings" names the destination without pretending to know which.
>    That is the honest form of the rule, not an exception to it.
> 3. **All Tools' pointer is a child line, not the subtitle.** `Section`'s `subtitle` is typed
>    `string`, so it cannot carry a link; widening the shared component's API for one call site is
>    the wrong trade. The link sits as the section's first child instead.

**Files:**
- Create: `src/renderer/src/components/GoTo.tsx` (component + `NavContext`)
- Create: `tests/go-to.test.ts`
- Modify: `src/renderer/src/App.tsx` (provide `navigate`)
- Modify: `src/renderer/src/components/ModelSelect.tsx:25`, `AllToolsView.tsx:108`, `WorkspaceSettingsView.tsx:394`, `:492`, `McpView.tsx:28`

**Interfaces:**
- Consumes: `View` and `NAV` from `Sidebar.tsx:10`, `:192`.
- Produces:
  ```tsx
  export type NavTarget = { view: View; workspace?: string };
  export const NavContext: React.Context<(t: NavTarget) => void>;
  export const GOTO_LABELS: Record<View, string>;   // === the sidebar NAV label
  export function GoTo({ view, workspace }: NavTarget): React.JSX.Element;
  ```

**The mechanical constraint.** `GoTo` cannot call `setView` alone. Settings-shaped destinations need `setSettingsOpen(true)` alongside it (the `App.tsx:2188` pattern) and a workspace destination needs `setWsSettings(ws)` before `setView("workspace")`. One `navigate(target)` callback in `App.tsx` owns all three; the context is what keeps ~8 call sites from prop-drilling through five levels.

- [ ] **Step 1: Write the failing test**

Create `tests/go-to.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GOTO_LABELS } from "../src/renderer/src/components/GoTo";

const R = path.resolve(__dirname, "../src/renderer/src");
const rendered = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("GOTO_LABELS", () => {
  it("every label is the word the sidebar uses", () => {
    // Derived, not re-typed: the sidebar's NAV array is the source of truth.
    const nav = rendered(path.join(R, "components/Sidebar.tsx"));
    for (const [view, label] of Object.entries(GOTO_LABELS)) {
      expect(nav, `${view} → ${label}`).toContain(`label: "${label}"`);
    }
  });
});

describe("the five old phrasings are retired", () => {
  const DEAD = [
    "the gear in the sidebar",
    "(Settings → Permissions)",
    "in the Global skills view",
    "configure a provider in Settings",
    "settings from the sidebar",
  ];
  it("none of them survives in rendered source", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx")) {
          const src = rendered(p);
          for (const d of DEAD) if (src.includes(d)) hits.push(`${path.basename(p)}: ${d}`);
        }
      }
    };
    walk(R);
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail** (module missing, then five phrasing hits)

- [ ] **Step 3: Write the component**

```tsx
import { createContext, useContext } from "react";
import { NAV, type View } from "./Sidebar";

export type NavTarget = { view: View; workspace?: string };

/** Default is a no-op so a component rendered outside the provider (a test,
 *  a storybook-less snapshot) degrades to inert text rather than throwing. */
export const NavContext = createContext<(t: NavTarget) => void>(() => {});

/** DERIVED from the sidebar's own NAV (§20 round 17: a pointer is phrased the
 *  way the sidebar names the destination). Never hand-list these. */
export const GOTO_LABELS = Object.fromEntries(NAV.map((n) => [n.view, n.label])) as Record<View, string>;

export function GoTo({ view, workspace }: NavTarget): React.JSX.Element {
  const navigate = useContext(NavContext);
  return (
    <button
      type="button"
      onClick={() => navigate({ view, workspace })}
      className="font-bold underline underline-offset-2 cursor-pointer hover:text-tangerine"
    >
      {GOTO_LABELS[view] ?? view}
    </button>
  );
}
```

`GOTO_LABELS` derived from `NAV` makes step 1's test tautological if written that way — so the test asserts against the *source text* of `Sidebar.tsx`, which catches a `NAV` entry renamed without its consumers noticing. Keep it that way.

- [ ] **Step 4: Provide `navigate` in `App.tsx`**

```tsx
const navigate = useCallback((t: NavTarget) => {
  if (needsSetup) return;
  if (t.workspace) setWsSettings(t.workspace);
  // Every destination but chat lives behind the settings drawer (App.tsx:2188).
  if (t.view !== "chat") setSettingsOpen(true);
  setView(t.view);
}, [needsSetup]);
```

Wrap the app tree in `<NavContext.Provider value={navigate}>`.

- [ ] **Step 5: Convert the five pointers**

```
ModelSelect.tsx:25            "No models — configure a provider in Settings."
                            → "No models yet — set one up on the <GoTo view="models"/> page."
AllToolsView.tsx:108          "…from your rules (Settings → Permissions)."
                            → "…from your rules — see the <GoTo view="permissions"/> page."
WorkspaceSettingsView.tsx:394 "Approve skills in the Global skills view."
                            → "Approve them on the <GoTo view="skills"/> page."
WorkspaceSettingsView.tsx:492 "Approve them in the Prompts view."
                            → "Approve them on the <GoTo view="promptTemplates"/> page."
McpView.tsx:28                "open that workspace's settings from the sidebar."
                            → "open its <GoTo view="workspace" workspace={ws}/> settings."
```

`ModelSelect`'s `emptyHint` is a prop default typed `string`; widen it to `React.ReactNode` so it can carry the link.

- [ ] **Step 6: Run the test, run the suite, GUI pass (Verification, PR 5), commit**

```bash
L=/tmp/t5.log; npx vitest run tests/go-to.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
npm test > /tmp/t5-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t5-full.log
git add -A && git commit -m "feat(guidance): a pointer to another page is a link that goes there"
```

---

### Task 6: The five `How X works` disclosures

The copy is spec'd — four texts verbatim below, one derived. Principle 11 applies: the plan-mode text is asserted against the constant that enforces it.

**Files:**
- Create: `src/renderer/src/components/HowItWorks.tsx`
- Create: `tests/how-it-works.test.ts`
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` (plan row), `PermissionRulesSection.tsx`, `McpServersSection.tsx`, `ContextPanel.tsx`, `AgentsMdPanel.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export const HOWTO_COPY: Record<
    "planMode" | "rules" | "mcpBadge" | "contextNumbers" | "instructionFiles",
    { title: string; body: string }
  >;
  export function HowItWorks({ copy }: { copy: keyof typeof HOWTO_COPY }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/how-it-works.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HOWTO_COPY } from "../src/renderer/src/components/HowItWorks";

describe("HOWTO_COPY", () => {
  it("has all five entries, each titled How … works", () => {
    const keys = ["planMode", "rules", "mcpBadge", "contextNumbers", "instructionFiles"];
    expect(Object.keys(HOWTO_COPY).sort()).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(HOWTO_COPY)) {
      expect(v.title, k).toMatch(/^(How|What) /);
      expect(v.body.length, k).toBeGreaterThan(200);
    }
  });

  it("plan mode names read-only, the plan file, and who can leave", () => {
    const b = HOWTO_COPY.planMode.body;
    expect(b).toMatch(/read-only/i);
    expect(b).toContain(".agents/plans/");
    expect(b).toMatch(/only you/i);
  });

  it("rules names the precedence and that silence never allows", () => {
    const b = HOWTO_COPY.rules.body;
    expect(b).toMatch(/deny beats ask/i);
    expect(b).toMatch(/ask beats allow/i);
    expect(b).toMatch(/asks you/i);
  });

  it("the MCP badge entry refuses to overclaim in BOTH directions", () => {
    const b = HOWTO_COPY.mcpBadge.body;
    expect(b).toMatch(/red badge does not/i);
    expect(b).toMatch(/green one is not proof/i);
  });

  it("the context entry keeps the honesty labels", () => {
    const b = HOWTO_COPY.contextNumbers.body;
    expect(b).toMatch(/measured/i);
    expect(b).toMatch(/estimated/i);
    expect(b).toContain("measuring…");
  });
});

describe("Principle 11 — the plan-mode text is DERIVED from the gate", () => {
  const gate = fs.readFileSync(
    path.resolve(__dirname, "../pi-runtime/extensions/hv-plan.ts"),
    "utf8",
  );

  it("does not claim sub-agents are blocked — the gate deliberately allows them", () => {
    // gatePlanCall returns { kind: "needs-boundary" } for `subagent`; it is
    // absent from BLOCKED_PLAN_TOOLS on purpose (§12's capability ceiling).
    const blocked = gate.match(/BLOCKED_PLAN_TOOLS = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
    expect(blocked).not.toContain("subagent");
    expect(HOWTO_COPY.planMode.body).not.toMatch(/sub-?agents? (are|is) blocked/i);
  });

  it("and the PROMPT the model reads does not claim it either", () => {
    // Finding 13: buildPlanPrompt said "sub-agents are blocked" for months
    // after the ceiling made it false, and nothing failed.
    const prompt = gate.match(/buildPlanPrompt[\s\S]*?`;/)?.[0] ?? "";
    expect(prompt).not.toMatch(/sub-?agents? (are|is) blocked/i);
    expect(prompt.length).toBeGreaterThan(100); // not vacuous
  });

  it("names every tool the gate actually blocks", () => {
    for (const t of ["edit", "write", "terminal_run"]) {
      expect(gate).toContain(`"${t}"`);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/t6.log; npx vitest run tests/how-it-works.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: module not found, and once the module exists, the *prompt* assertion still fails — that is finding 13.

- [ ] **Step 3: Derive the instruction-file order before writing its copy**

Do NOT hand-write the order. Read Pi's own context-file loader and take the order from it:

```bash
cd pi-runtime
grep -rn 'AGENTS\.md\|CLAUDE\.md' node_modules/@earendil-works/pi-coding-agent/dist --include='*.js' | head -20
```

Write down what you find (which filenames, walked in which direction, which wins) and put *that* in `HOWTO_COPY.instructionFiles.body`, plus the fact the bridge adds: nested files are injected per-turn for the subtree a tool touches (`hv-agents-md.ts`), and files are read once at session start so an edit applies to new or restarted sessions. If the grep is ambiguous, write a throwaway probe rather than guessing.

- [ ] **Step 4: Write the component with the four spec'd texts**

```tsx
/**
 * §20 round 17 — the deleted Help page, dissolved in place. One native
 * <details> (the McpCatalogSection precedent: no disclosure state to manage),
 * collapsed, inside the section it explains. Never a modal, never a tour.
 *
 * Principle 11: where a body states a rule the code enforces, tests/how-it-works
 * asserts the two against the same constant.
 */
export const HOWTO_COPY = {
  planMode: {
    title: "How plan mode works",
    body: `Plan mode makes the whole session read-only. The agent can read, search and explore; edits, writes, installs, commits and anything that changes your project are blocked. Read-only wins over everything else — over a permission rule that says allow, and over Bypass all permissions too. Handing work to a sub-agent still works, because reading a large codebase is exactly what planning is for — it asks you to approve the boundary first. The plan is a real markdown file in your project under .agents/plans/, so you can read it, edit it, and keep it after the session ends. Only you can implement it or leave plan mode; the agent has no button for either. Tip: planning loves your smartest model.`,
  },
  rules: {
    title: "How rules combine",
    body: `Three layers answer every tool call: your global rules, this workspace's rules, and any grants you've given the running session. The most restrictive answer wins — deny beats ask, ask beats allow — so a workspace rule can tighten a global allow, but it can never loosen a global deny. When no rule matches, the app asks you; nothing is ever allowed by silence. "Allow for this session" lives in memory only, so it is gone when the session restarts — which also happens when you change MCP configuration.`,
  },
  mcpBadge: {
    title: "What the badge means",
    body: `This badge is HappyVibe's own probe: the app connects to the server itself, checks that it answers, and lists its tools. Your agent's connection is a different one, made when a session starts. So a red badge does not mean the running session lost those tools, and a green one is not proof that it has them. Changing a server restarts your sessions so they pick it up.`,
  },
  contextNumbers: {
    title: "How these numbers are measured",
    body: `Two kinds of number live here. The gauge is measured — it is what the model itself reported for the last turn. Everything in the breakdown is estimated, at roughly one token per four characters, because nothing reports a per-item cost. Right after the conversation is compacted there is no measured figure at all, so the gauge says "measuring…" rather than showing you a zero it would have made up.`,
  },
  instructionFiles: {
    title: "How instruction files combine",
    body: `…derived in step 3…`,
  },
} as const;

export function HowItWorks({ copy }: { copy: keyof typeof HOWTO_COPY }): React.JSX.Element {
  const { title, body } = HOWTO_COPY[copy];
  return (
    /* ponytail: native <details> — no disclosure state to manage. */
    <details className="mt-3 group [&[open]>summary]:mb-2">
      <summary className="cursor-pointer text-xs font-bold text-ink-soft hover:text-ink select-none">
        {title}
      </summary>
      <p className="text-xs text-ink-soft leading-relaxed">{body}</p>
    </details>
  );
}
```

- [ ] **Step 5: Fix finding 13 — the prompt that lies to the model**

In `pi-runtime/extensions/hv-plan.ts`, `buildPlanPrompt`'s body currently reads:

```
file edits, writes, installs, commits, and sub-agents are blocked, and shell is
limited to read-only inspection.
```

Sub-agents are NOT blocked — `gatePlanCall` routes `subagent` to `needs-boundary`, with a comment saying §12's capability ceiling is why. Correct it:

```
file edits, writes, installs and commits are blocked, and shell is limited to
read-only inspection. You MAY delegate to a read-only sub-agent — the user
approves its boundary first.
```

- [ ] **Step 6: Mount the five disclosures**

`BuiltinToolsBlock.tsx` plan row → `planMode`. `PermissionRulesSection.tsx` → `rules`. `McpServersSection.tsx` → `mcpBadge`. `ContextPanel.tsx` → `contextNumbers` (conform the existing compaction explainer to it rather than duplicating). `AgentsMdPanel.tsx` → `instructionFiles`.

- [ ] **Step 7: Run the test and the suite**

```bash
L=/tmp/t6.log; npx vitest run tests/how-it-works.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
npm test > /tmp/t6-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t6-full.log
```

`tests/plan-*.test.ts` may pin the old prompt string — update it, that string was wrong.

- [ ] **Step 8: GUI pass (Verification, PR 6), commit, then check the live batch**

This is the only task touching `pi-runtime/extensions/`, so `live:why` will print **after** this commit.

```bash
git add -A && git commit -m "feat(guidance): the five things that had no explanation get one, in place"
npm run live:why
# if it prints anything:
npm run test:live > /tmp/live.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/live.log
```

**Read the wall time before believing a green live run** — a real batch is ~6 min. 5 s means `.env` did not resolve and everything skipped.

---

### Task 7: Dismissals that persist

**Files:**
- Modify: `src/main/config.ts` (add `hintsSeen`, get/set pair)
- Modify: `src/main/ipc.ts` (two handlers), `src/preload/index.ts` + its `.d.ts` (expose them)
- Modify: `src/renderer/src/components/ChatView.tsx:612` (`suggestDismissed`), `src/renderer/src/components/PlanCard.tsx:39` (`dismissed`)
- Create: `tests/hints-seen.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (main):
  ```ts
  export function getHintSeen(key: string): boolean;
  export function setHintSeen(key: string, seen: boolean): void;
  ```
  Mirrors the `gitRulesSeeded` pattern at `config.ts:93`, `:298`.

- [ ] **Step 1: Write the failing test**

Create `tests/hints-seen.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getHintSeen, setHintSeen } from "../src/main/config";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-hints-"));
  process.env.PI_CODING_AGENT_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("hintsSeen", () => {
  it("an unseen hint reads false", () => {
    expect(getHintSeen("redZone")).toBe(false);
  });

  it("a dismissal survives a reload", () => {
    setHintSeen("redZone", true);
    expect(getHintSeen("redZone")).toBe(true);
  });

  it("keys are independent", () => {
    setHintSeen("redZone", true);
    expect(getHintSeen("planDraft")).toBe(false);
  });
});
```

Check how the existing `config.ts` tests point the config directory (grep `tests/` for `gitRulesSeeded`) and mirror that setup exactly rather than the env var above if it differs.

- [ ] **Step 2: Run it and watch it fail**

```bash
L=/tmp/t7.log; npx vitest run tests/hints-seen.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 3: Add the field and the pair**

In `src/main/config.ts`, beside `gitRulesSeeded?: boolean;` at `:93`:

```ts
  /** §20 round 17 — global show-once dismissals. Per-workspace hints use
   *  localStorage `hv:<hint>:${workspace}` instead (the agentsmd precedent). */
  hintsSeen?: Record<string, boolean>;
```

```ts
export function getHintSeen(key: string): boolean {
  return load().hintsSeen?.[key] ?? false;
}

export function setHintSeen(key: string, seen: boolean): void {
  const cfg = load();
  cfg.hintsSeen = { ...(cfg.hintsSeen ?? {}), [key]: seen };
  save(cfg);
}
```

Match the surrounding file's actual `load()`/`save()` names.

- [ ] **Step 4: Wire the IPC and the two consumers**

Add `hv:hint-get` / `hv:hint-set` handlers in `ipc.ts`, expose `window.hv.hintGet` / `hintSet` in preload + its `.d.ts`. Then:

- `ChatView.tsx:612` — `suggestDismissed` is per-session in memory. The **red-zone banner** dismissal should persist per workspace, so use `localStorage` `hv:redzone-dismissed:${workspace}` (the `hv:agentsmd-dismissed` precedent at `ChatView.tsx:602`), not the global field.
- `PlanCard.tsx:39` — `dismissed` is the draft-plan card's, which is global guidance rather than workspace state, so it uses `hintSet("planDraft", true)`.

- [ ] **Step 5: Run the test, run the suite, GUI pass (Verification, PR 7), commit**

```bash
L=/tmp/t7.log; npx vitest run tests/hints-seen.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
npm test > /tmp/t7-full.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t7-full.log
git add -A && git commit -m "fix(guidance): a hint you dismissed stays dismissed after a reload"
```

---

### Task 8: Final gate

- [ ] **Step 1: Full gate**

```bash
L=/tmp/gate-final.log
npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

`gate` = `build` (both typechecks, fast-fail) → non-live suite. Do NOT run `npm run typecheck` first — `build` already does it.

- [ ] **Step 2: Live batch if required**

```bash
npm run live:why
```

Task 6 committed a `pi-runtime/extensions/` change, so this prints. Run `npm run test:live` in the background and **read the wall time** (~6 min real, ~5 s means everything skipped).

- [ ] **Step 3: Full GUI pass** — every assertion in the Verification section below, in one sitting.

---

## Verification — what will be TRUE on screen

"Needs a GUI pass" is a reminder, not a verification. These are the observable claims, the surface each is observed on, the named absences, and the regressions to perform.

Attach with `mcp__electron-debug__attach` (or `/uicheck`). `npm run dev` must be RESTARTED for any `src/main` change — a ⌘R renderer reload does not rebuild main; check the built artifact (`grep '<your change>' out/main/index.js`) before believing a main-side fix is live.

### PR 1 — copy-only

| Claim | Observed on |
|---|---|
| The Terminal page's title is the same size and weight as the Skills page's | Terminal page, side by side with Skills |
| The Voice page's title likewise | Voice page |
| Workspace settings shows one sentence under the folder name | click a workspace's gear in the sidebar |
| All Tools says "Everything the agent can call." **once**, not twice | All Tools page |
| All four Stats charts carry a subtitle | Stats page |
| Every empty message on Stats ends with something to do | Stats page, on a **fresh profile** with no sessions |

**Absence assertions (named):**
- The string `Help affordance` appears in **no** file under `src/` or `docs/` — `grep -rn "Help affordance" src/ docs/` returns nothing. (An absence cannot be screenshotted; this is the check.)
- `AllToolsView`'s Section subtitle does **not** contain `Everything the agent can call` — that sentence lives only in the `h1`.
- `DashboardView.tsx` contains **no** `function Section(`.

**Regression to perform:** open Stats on a profile that *has* sessions, then on one that has none. Both must render — the shared `Section` requires an `icon` and a `subtitle`, and a missing icon key renders an empty `<svg>` rather than throwing, which is exactly the kind of silent blank the swap risks.

### PR 2 — EmptyState

| Claim | Observed on |
|---|---|
| The Agents page's empty message is a dashed box, not a bare grey line | Agents page **before any session has run** |
| The sidebar's no-sessions message names the `+` button (inline prose, deliberately not the component) | sidebar, fresh workspace |
| AGENTS.md guidance is a real dashed box above the editor, not ghost placeholder text | AGENTS.md panel, workspace with no AGENTS.md |

**Absence assertions (named):** the AGENTS.md `<textarea>`'s `placeholder` no longer carries the guidance sentence — it reads `Markdown…`. There is **no** illustrated/large-icon empty card anywhere: `EmptyState.tsx` has one visual shape, the dashed box. And `EMPTY_COPY` has **no** `sidebarSessions` or `costs` key at this point — an unused key fails `tests/empty-state.test.ts`, because unreferenced copy is the drift the component exists to end.

**Note on scope, decided during implementation:** the empty state is gated `missing && !dirty`, matching the Copy CLAUDE.md / draft buttons directly beneath it — guidance and its actions appear and leave together. The audit's complaint was that a *placeholder* is grey ghost text reading as "type here" and disappears on the first keystroke; the fix is that it is now a real element sitting with its actions, not that it outlives them.

**Regression to perform:** open a workspace with **no** AGENTS.md, click "Draft it for me", let it finish, and confirm the empty state disappears rather than sitting above a now-populated editor.

### PR 3 — InfoDot, Audit, Cost

| Claim | Observed on |
|---|---|
| Audit's decision / source / would-have columns each carry an ⓘ whose hover explains it | Audit log page (needs at least one decision — deny something in a session first) |
| One visible legend line explains a bypass row, without hovering | Audit log page |
| The Cost panel says "All costs are estimates." in visible text | Cost panel — opened from the **CostBubble in the chat**, not from Stats |
| The Agents page shows token cost inline, like Skills does | Agents page, compared against Skills |

**Absence assertions (named):** the estimation caveat is **not** repeated as a per-cell tooltip on every cost row — one line per panel. And `InfoDot` renders **no** floating popover: hovering shows the OS's native tooltip, and `InfoDot.tsx` carries no `absolute`/`fixed` class.

**Regression to perform:** open a browser pane (§28) beside the Audit page and hover an ⓘ. The pane must **not** hide — `browserCoverage.ts` gathers candidates by the literal class words `absolute`/`fixed`, so a floating tooltip here would blank the page. A native `title=` cannot.

### PR 4 — Banner

| Claim | Observed on |
|---|---|
| Dangerous mode's banner looks exactly as it did before | chat, after `/hv-dangerous` |
| The crash banner looks exactly as it did before | chat, after killing the Pi child |

**Absence assertions (named):** the plan indicator is still a **pill**, not a banner — Principle 10, and `Banner.tsx` has no plan-mode call site. `grep -rn "px-6 py-2.5" src/renderer/src` returns only `Banner.tsx`.

**Regression to perform:** turn on dangerous mode *and* trigger the red-zone context suggestion in the same session. Two banners must stack legibly rather than one replacing the other.

### PR 5 — GoTo

| Claim | Observed on |
|---|---|
| The model selector's empty hint is a link, and clicking it lands on Models with the settings drawer open | the **composer's model picker in chat**, on a profile with no provider configured |
| All Tools' permission pointer links to Permissions | All Tools page |
| Workspace settings' two "approve them" pointers link to Skills and Prompts | a workspace's settings page |
| Every link's word matches the sidebar's label for that page | any of the above, compared against the sidebar |

**Absence assertions (named):** the phrases `the gear in the sidebar`, `(Settings → Permissions)`, `in the Global skills view` and `configure a provider in Settings` appear **nowhere** in `src/renderer/src` — `grep -rn` returns nothing for each.

**Regression to perform:** click the MCP page's workspace pointer from the **global** MCP page. It must land on that workspace's settings with the workspace selected — this is the one target needing `setWsSettings` before `setView`, and getting the order wrong lands on the previous workspace's page with the right title.

### PR 6 — disclosures

| Claim | Observed on |
|---|---|
| A collapsed "How plan mode works" sits on the plan row and opens in place | All Tools page |
| "How rules combine" opens on the Permissions page | Permissions page |
| "What the badge means" opens beside the MCP server list | MCP page |
| "How these numbers are measured" opens on the context panel | context panel, opened from the chat gauge |
| "How instruction files combine" opens on the AGENTS.md panel, and its order matches what Pi actually does | AGENTS.md panel |

**Absence assertions (named):** none of the five is a **modal** — the page behind stays scrollable and no scrim appears. And the plan-mode text does **not** contain the words "sub-agents are blocked" — neither does the prompt the model reads (`grep -n "sub-agents are blocked" pi-runtime/extensions/hv-plan.ts` returns nothing).

**Regression to perform:** open a disclosure, navigate to another page, and come back. It should be closed again — a native `<details>` has no persisted state, and if it *is* remembered, someone added state this pattern exists to avoid. Then: with a **browser pane open**, expand the plan-mode disclosure. The pane must not hide — a `<details>` is in normal flow and carries no `absolute`/`fixed`.

### PR 7 — persistence

| Claim | Observed on |
|---|---|
| Dismissing the red-zone banner keeps it dismissed after ⌘R | chat, in a session pushed into the red context zone |
| Dismissing the draft-plan card keeps it dismissed after ⌘R | chat, with a plan draft in flight |

**Absence assertions (named):** the red-zone dismissal is scoped — dismiss it in workspace A and it is **still shown** in workspace B (per-workspace `localStorage`, not the global field). And the plan-card dismissal does **not** appear in `localStorage` — it is in `config.json`'s `hintsSeen`.

**Regression to perform:** dismiss the red-zone banner, ⌘R, then **quit and relaunch the app**. Still dismissed. Then open a second workspace and drive it red — the banner appears there. (`localStorage` survives a reload but the scoping is the part that silently regresses to global.)

---

## Self-review notes

- **Spec coverage:** P1 → task 1. P2 → task 1 (Dashboard) + task 3 (Audit/Cost). P3 → task 2. P4 → task 5. P5 → task 3 (`InfoDot` + the inline/tooltip split); the *written doctrine* itself is prose in the Notion doc and `docs/prd.md` §20, not code — nothing to implement. P6 → task 4. P7 → task 6. P8 → task 7. P9 → task 1 (the comments; no re-open path is the decision *not* to build). P10 → every task's test.
- **Deliberately out:** the live "which instruction files are active" list (§15, deferred by decision), search-result empties (different class), a second empty-state tier, an onboarding re-open path.
- **The one risky assumption:** task 6 step 3 requires reading Pi's context-file loader, which needs `pi-runtime/node_modules` — task 0 installs it. If the loader's order cannot be established from source, write a probe extension rather than guessing; a hand-written order is exactly what Principle 11 forbids.
