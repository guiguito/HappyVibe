# Improve Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-turn cost of HappyVibe-authored prompt text by ~1,000 tokens, remove three contradictions/stale names the model reads every turn, and fix two silent bugs — without changing any parse contract or permission behaviour.

**Architecture:** Every change is to a string constant or a pure builder in `pi-runtime/extensions/hv-*.ts`, `happyvibe-bridge.ts`, `src/main/appendSystem.ts`, or a bundled `.md` — plus the tests that pin them. One structural change: the identity paragraph becomes a function of the intent switch, built in main at spawn. One deliberate edit of upstream text: Pi's "use the read tool" skills sentence is string-replaced in `before_agent_start`, pinned to Pi's source. F4 (`bg_wait`) is RESOLVED by measurement at plan time: upstream's async receipt still names `bg_wait` (`async-execution.ts:350-353`), so the tool stays registered and the measurement is pinned so a future pin reopens it.

**Tech Stack:** TypeScript 7 (native tsc), vitest, Pi 0.85.0 / pi-subagents 0.64.0 vendored under `pi-runtime/`.

**Spec:** Notion "Improve prompts" (`https://app.notion.com/p/Improve-prompts-3d7d33dfffca808eaf31cb3717e4fce8`) — locked 2026-09-10. Decisions mirrored in `docs/prd.md` §9, §10, §12, §13, §14, §16, §23, §28, §33 as `Decision (2026-09-10, Improve-prompts round)`.

## Global Constraints

- Setup in a fresh worktree: `npm install && (cd pi-runtime && npm ci)`; `ln -s ~/Documents/Github/HappyVibe/.env .env` (a missing `.env` makes the live batch exit 0 in ~5 s having tested nothing — read the wall time).
- Gate per task: `npm run gate` (build → typecheck ×3 → non-live suite). Never `npm run typecheck` before `gate`; never pipe test output to `tail`/`grep` — redirect to `/tmp/vitest.log` and grep the file.
- Live batch: `npm run test:live` (background, ~6 min) after Task 1 and after Task 9. Check `pgrep -fl "npm run dev"` before believing a live red; re-run one file in isolation before calling it a regression.
- Every commit message body says what a user would see, never a file path. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Parse contracts are frozen: `titles.ts:90` (last non-empty line), `cleanSubject` (last line), `splitPrDraft` (title line then blank then prose), `parseAgentsMdOutput` (`json agents-md` fence). The sentences those parsers depend on stay byte-identical.
- No hand-listed tool names in a prompt that the model may not have (§26 rule). No wait-tool literal anywhere but `WAIT_TOOLS` (hv-rules.ts).
- Never edit anything under `pi-runtime/node_modules/`.
- The delimiter family is underscore XML: `<happyvibe_subagents>`, `<happyvibe_plan_mode>`, `<happyvibe_memory>`, `<memory_policy>`, `<project_instructions>`, `<untrusted>`.

---

## File map

| File | Responsibility after this plan |
| --- | --- |
| `src/main/appendSystem.ts` | `buildIdentity({ intent })` — the two-paragraph identity, intent sentence conditional |
| `src/main/pi/spawn.ts:231` | passes `buildIdentity({ intent: opts.builtinTools?.intent ?? true })` |
| `pi-runtime/extensions/happyvibe-bridge.ts` | `INTENT_PARAM` (one ≤80-char description) reused by every tool; `ask_user`/`use_skill`/plan/memory descriptions shortened; refusal next-steps; injection order; return condition; skills-sentence replacement call |
| `pi-runtime/extensions/hv-skills.ts` | `PI_SKILLS_SENTENCE`, `HV_SKILLS_SENTENCE`, `replaceSkillsSentence(sp)`; `buildUseSkillGuidance` deleted |
| `pi-runtime/extensions/hv-agents.ts` | `renderSubagentSection` → `<happyvibe_subagents>` with the threshold sentence |
| `pi-runtime/extensions/hv-plan.ts` | `buildPlanPrompt(append, registeredTools?)` with a derived blocked list, `<happyvibe_plan_mode>` |
| `pi-runtime/extensions/hv-memory.ts` | `MEMORY_POLICY` (+ base rate, + types), `renderMemorySection` → `<happyvibe_memory>`/`<memory_policy>` |
| `pi-runtime/extensions/hv-agents-md.ts` | `renderNestedSection` → `<project_instructions path applies_to>` blocks |
| `pi-runtime/extensions/hv-browser.ts` | `wrapUntrusted(text, source, url)` replaces the prefix-only banner; `UNTRUSTED_OPEN` for the renderer/tests |
| `pi-runtime/extensions/hv-terminal.ts`, `hv-web.ts` | one-sentence steer lines |
| `src/renderer/src/components/ToolCard.tsx:400` | preview filter drops `<untrusted …>`/`</untrusted>` lines |
| `src/main/titles.ts`, `src/main/gitMessage.ts` | one added sentence each, parse sentences untouched |
| `pi-runtime/agents/{worker,code-explorer,agents-md-maker}.md` | one added/reworded line each |
| `tests/pi-skills-sentence.test.ts` (new) | pins Pi's literal in the vendored `skills.js` |
| `tests/pi-subagents-contract.test.ts` | pins that upstream's async receipt still names `bg_wait` (F4 gate) |
| `docs/validation/d1.md` | before/after token numbers |

---

### Task 1: One `intent` description + identity paragraph assembled per the intent switch (X1, A1)

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:259-268` (constants), every `intent: Type.String({ description: "REQUIRED. …" })` at lines 1682, 1737, 1780, 1823, 1855, 1870, 1885, 1898, 1910, 1924, 1938, 1953, 1971, 1986, 2161, 2209, 2253, 2275, 2314, 2350, 2371, and `webIntent` at 2035-2036
- Modify: `src/main/appendSystem.ts:60-64`
- Modify: `src/main/pi/spawn.ts:231`
- Test: `tests/identity-prompt.test.ts`, `tests/intent-direct-tools.test.ts`, new file `tests/intent-description.test.ts`

**Interfaces:**
- Produces: `export const INTENT_DESCRIPTION = "One customer-facing sentence, goal first — shown to the user as this call's headline."` (bridge, exported so a test can import it); `export function buildIdentity(o: { intent: boolean }): string` (appendSystem.ts). `HV_IDENTITY` is kept as `buildIdentity({ intent: true })` for the one existing test import, then that test is updated to use `buildIdentity`.

- [ ] **Step 1: Write the failing tests**

`tests/intent-description.test.ts` (new, key-free source scan — the repo's pattern for "an absence cannot be rendered"):

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { INTENT_DESCRIPTION } from "../pi-runtime/extensions/happyvibe-bridge";

const bridge = fs.readFileSync(path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");

describe("X1 — one intent description, stated once", () => {
  it("is at most 80 characters and does not shout", () => {
    expect(INTENT_DESCRIPTION.length).toBeLessThanOrEqual(80);
    expect(INTENT_DESCRIPTION).not.toMatch(/REQUIRED/);
  });
  it("no tool carries its own intent description any more", () => {
    // Every `intent:` schema line must reference the constant, never an inline string.
    const inline = bridge.match(/intent: Type\.String\(\{\s*description:\s*"/g) ?? [];
    expect(inline).toEqual([]);
    expect(bridge).not.toMatch(/One short customer-facing sentence/);
  });
});
```

Add to `tests/identity-prompt.test.ts`:

```ts
import { buildIdentity } from "../src/main/appendSystem";

test("the identity explains intent only while the switch is on", () => {
  expect(buildIdentity({ intent: true })).toMatch(/`intent`/);
  expect(buildIdentity({ intent: true })).toMatch(/Looking for the failing order/);
  expect(buildIdentity({ intent: false })).not.toMatch(/intent/);
  // Both arms keep the identity and the denial mental model.
  for (const on of [true, false]) {
    expect(buildIdentity({ intent: on })).toMatch(/HappyVibe/);
    expect(buildIdentity({ intent: on })).toMatch(/blocked call comes back with a reason/);
  }
});
```

- [ ] **Step 2: Run them, expect FAIL** — `npx vitest run tests/intent-description.test.ts tests/identity-prompt.test.ts > /tmp/vitest.log 2>&1; echo EXIT=$?; tail -30 /tmp/vitest.log` → `INTENT_DESCRIPTION`/`buildIdentity` not exported.

- [ ] **Step 3: Implement the bridge constant**

In `happyvibe-bridge.ts` replace lines 259-268 with:

```ts
// X1 (Improve-prompts round, 2026-09-10): ONE description for every intent
// parameter, bridge and MCP alike. The convention and its example live in the
// identity paragraph (src/main/appendSystem.ts), read once per turn instead of
// thirty times in schemas. "REQUIRED" is not restated: the schema's `required`
// array says it. tests/intent-description.test.ts pins the length and the absence
// of any per-tool copy.
export const INTENT_DESCRIPTION = "One customer-facing sentence, goal first — shown to the user as this call's headline.";
const INTENT_PARAM = { type: "string", description: INTENT_DESCRIPTION };
const OPTIONAL_INTENT_PARAM = { type: "string", description: `Optional. ${INTENT_DESCRIPTION} Falls back to the task text.` };
const intentParam = () => Type.String({ description: INTENT_DESCRIPTION });
```

Then replace every `intent: Type.String({ description: "REQUIRED. …" })` (21 sites) and the `ask_user` multi-line one at 1682-1685 with `intent: intentParam(),`. Replace `webIntent` (2035-2036) by deleting it and using `intent: intentParam(),` at its four call sites (2043, 2068, 2094, 2113).

- [ ] **Step 4: Implement `buildIdentity`**

Replace `appendSystem.ts:60-64` with:

```ts
export function buildIdentity(o: { intent: boolean }): string {
  const p1 = [
    "You are the coding agent inside HappyVibe, a desktop app for coding with an agent.",
    "When you name yourself, you are HappyVibe; pi is the runtime you run on.",
    "The pi documentation above still answers questions about the runtime itself (extensions, skills, prompt templates, the SDK); it does not describe HappyVibe.",
  ].join(" ");
  const p2 = [
    "HappyVibe shows the user every tool call and may pause one for their approval.",
    // X1: the ONE place the intent convention is stated. Conditional on the §13
    // round-12 switch — a paragraph must not describe a parameter that does not exist.
    o.intent
      ? "Tools that take an `intent` show that sentence to the user as the call's headline — write it goal first (\"Looking for the failing order in the logs\", not \"Running a log query\")."
      : "",
    "A blocked call comes back with a reason; read it and change approach rather than retrying.",
  ].filter(Boolean).join(" ");
  return `${p1}\n\n${p2}`;
}
/** @deprecated only for the pre-round import shape; spawn passes buildIdentity. */
export const HV_IDENTITY = buildIdentity({ intent: true });
```

In `spawn.ts:231`: `"--append-system-prompt", buildIdentity({ intent: opts.builtinTools?.intent ?? true }),` and change the import on line 3 to `import { buildIdentity } from "../appendSystem";`. Then delete the `HV_IDENTITY` export and update `tests/identity-prompt.test.ts:31` to `expect(buildIdentity({ intent: true })).toMatch(/HappyVibe/)`.

- [ ] **Step 5: Run the two tests, expect PASS; run `npm run gate`, expect green.** `tests/intent-direct-tools.test.ts` still passes (it asserts `required`, not the text).

- [ ] **Step 6: Live batch (background):** `npm run test:live > /tmp/live1.log 2>&1; echo EXIT=$?` — watch `mcp-bridge` (intent still arrives: `tool_execution_start.args.intent` defined) and `skills-bridge`. Wall time must be minutes, not seconds.

- [ ] **Step 7: Commit** — `feat(prompts): one intent description for every tool, and the identity paragraph explains it once`

---

### Task 2: Replace Pi's skills sentence (A4, F3, B3)

**Files:**
- Modify: `pi-runtime/extensions/hv-skills.ts:91-105`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:834` (skillSection), `:1731-1736` (`use_skill` description), and the return condition (see Task 8 — leave it for now, `skillSection` becomes `""`)
- Test: `tests/hv-skills.test.ts:69`, new `tests/pi-skills-sentence.test.ts`

**Interfaces:**
- Produces: `export const PI_SKILLS_SENTENCE = "Use the read tool to load a skill's file when the task matches its description."`, `export const HV_SKILLS_SENTENCE = "Load a skill with `use_skill(name, intent)`; it returns the skill's instructions."`, `export function replaceSkillsSentence(systemPrompt: string): string`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests**

`tests/pi-skills-sentence.test.ts` (new, key-free, the `resource-loader.js` pin pattern):

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PI_SKILLS_SENTENCE, HV_SKILLS_SENTENCE, replaceSkillsSentence } from "../pi-runtime/extensions/hv-skills";

describe("A4 — Pi's skills sentence is replaced, and the replacement is pinned to Pi's source", () => {
  const skillsJs = fs.readFileSync(
    path.resolve(__dirname, "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js"),
    "utf8",
  );
  it("Pi still emits the exact sentence we replace (a pin bump that rewords it must fail here)", () => {
    expect(skillsJs).toContain(JSON.stringify(PI_SKILLS_SENTENCE));
  });
  it("replaces it once, and leaves a prompt without it untouched", () => {
    const sp = `intro\n${PI_SKILLS_SENTENCE}\n<available_skills>…</available_skills>`;
    expect(replaceSkillsSentence(sp)).toBe(`intro\n${HV_SKILLS_SENTENCE}\n<available_skills>…</available_skills>`);
    expect(replaceSkillsSentence("no skills here")).toBe("no skills here");
  });
  it("our sentence names use_skill and never tells the model to read SKILL.md", () => {
    expect(HV_SKILLS_SENTENCE).toMatch(/use_skill/);
    expect(HV_SKILLS_SENTENCE).not.toMatch(/read the SKILL\.md|do NOT read/i);
  });
});
```

In `tests/hv-skills.test.ts:69` replace the `buildUseSkillGuidance` assertion with `expect(HV_SKILLS_SENTENCE).toMatch(/use_skill/);` and fix the import.

- [ ] **Step 2: Run, expect FAIL** (exports missing).

- [ ] **Step 3: Implement** — in `hv-skills.ts` replace `buildUseSkillGuidance` (lines 91-105) with:

```ts
/**
 * A4 (2026-09-10): Pi's own skills block says "Use the read tool to load a
 * skill's file" a few hundred tokens before we used to say "do NOT read
 * SKILL.md". One prompt, two opposite instructions. before_agent_start already
 * rewrites the system prompt, so the ONE upstream sentence is replaced in place.
 * PI_SKILLS_SENTENCE is pinned against Pi's dist by tests/pi-skills-sentence.test.ts
 * so a pin bump that rewords it fails there instead of silently restoring the
 * contradiction. Pi's "Use bash to load…" branch fires only when `read` is
 * absent — never our case.
 */
export const PI_SKILLS_SENTENCE = "Use the read tool to load a skill's file when the task matches its description.";
export const HV_SKILLS_SENTENCE = "Load a skill with `use_skill(name, intent)`; it returns the skill's instructions.";
export function replaceSkillsSentence(systemPrompt: string): string {
  return systemPrompt.replace(PI_SKILLS_SENTENCE, HV_SKILLS_SENTENCE);
}
```

In the bridge: import `replaceSkillsSentence` instead of `buildUseSkillGuidance`; change line 821 `const sp = (event.systemPrompt ?? "") as string;` to `const sp = replaceSkillsSentence((event.systemPrompt ?? "") as string);` and delete `const skillSection = buildUseSkillGuidance(skillManifest);` plus its use in `injected` (line 857) and the return condition (883). **Because `sp` may now differ from `event.systemPrompt`, the return condition must return whenever a replacement happened** — this is folded into Task 8's `injected !== base` form; for this task add `|| sp !== event.systemPrompt` to the existing condition.

`use_skill` description (1731-1736) becomes: `"Load a skill's instructions by name. Prefer this over reading a SKILL.md file."`

- [ ] **Step 4: Run tests + `npm run gate`, expect green.** `tests/skills-contract.test.ts` still passes (it pins `--no-skills`/`--skill`, not the sentence).

- [ ] **Step 5: Commit** — `fix(prompts): the skills instruction says one thing — use_skill — instead of contradicting Pi's`

---

### Task 3: Roster rewrite (A2, F2)

**Files:**
- Modify: `pi-runtime/extensions/hv-agents.ts:138-164`
- Test: `tests/hv-agents.test.ts:152-162, 240-244`, `tests/subagent-discovery-bridge.test.ts:115` (live)

- [ ] **Step 1: Update the tests first**

In `tests/hv-agents.test.ts` "lists each agent…" test replace the body with:

```ts
const s = renderSubagentSection([mk("code-explorer", "Read-only investigator"), mk("agents-md-maker", "Drafts AGENTS.md")]);
expect(s).toContain("<happyvibe_subagents>");
expect(s).toContain("</happyvibe_subagents>");
expect(s).toContain("subagent");
expect(s).toContain("- **code-explorer** — Read-only investigator");
expect(s).toContain("- **agents-md-maker** — Drafts AGENTS.md");
// The countermand stays: pi-subagents 0.64's own description still says
// "Before execution, call { action: \"list\" }" three times.
expect(s).toContain('{ action: "list" }');
// A2: the threshold sentence, and NO wait-tool name — any wait literal is WAIT_TOOLS' job.
expect(s).toMatch(/Delegate when the work spans many files/);
for (const w of WAIT_TOOLS) expect(s).not.toContain(`\`${w}\``);
expect(s).not.toMatch(/Do NOT|NEVER/);
```

(import `WAIT_TOOLS` from `../pi-runtime/extensions/hv-rules`). Update the "all-off" test's comment only. In `tests/subagent-discovery-bridge.test.ts:115` change `"## Available subagents"` to `"<happyvibe_subagents>"`.

- [ ] **Step 2: Run `tests/hv-agents.test.ts`, expect FAIL.**

- [ ] **Step 3: Implement** — replace the return of `renderSubagentSection` with:

```ts
return (
  "\n\n<happyvibe_subagents>\n" +
  "Sub-agents you can delegate to. Each runs in its own context and reports back a concise result:\n" +
  lines.join("\n") +
  "\n\nDelegate when the work spans many files or would take more than a few reads. " +
  "Call `subagent` with `{ agent, task }` directly, by name — there is no need to call " +
  // pi-subagents' own tool description still says "call { action: \"list\" } first"
  // (0.64, tool-description.ts:21/29/46) — a turn wasted; the countermand stays.
  '`{ action: "list" }` first. Delegations run in the background: after delegating, end your ' +
  "turn with one line saying so — the result arrives as a new turn, and the user can keep " +
  "chatting meanwhile.\n" +
  "</happyvibe_subagents>"
);
```

Keep `subagentRosterLine` unchanged (the Agents page measures from it).

- [ ] **Step 4: Run tests + `npm run gate`, expect green. Commit** — `fix(agents): the sub-agent roster says when to delegate and no longer names a tool that was renamed`

---

### Task 4: Delimiters, untrusted wrapping, static-before-dynamic order (X4, X5, X6, A8)

**Files:**
- Modify: `pi-runtime/extensions/hv-memory.ts:52-61` (renderMemorySection), `hv-agents-md.ts:104-113`, `hv-browser.ts:37-39`, `happyvibe-bridge.ts:147`, `:857`
- Modify: `src/renderer/src/components/ToolCard.tsx:397-401`
- Test: `tests/hv-memory.test.ts:13,39`, `tests/hv-agents-md.test.ts:70`, `tests/agents-md-bridge.test.ts:124,127` (live), `tests/hv-browser.test.ts:51`, `tests/tool-card-output.test.ts:92-108`, `tests/web-bridge.test.ts:169` (live)

**Interfaces:**
- Produces (hv-browser.ts): `export const UNTRUSTED_OPEN = "<untrusted"` and `export function wrapUntrusted(text: string, source: "web" | "browser", url?: string): string` returning `<untrusted source="…" url="…">\n${text}\n</untrusted>`; `UNTRUSTED_BANNER` is deleted.

- [ ] **Step 1: Update/write tests first**

`tests/hv-memory.test.ts:13` → `expect(s.indexOf("<memory_policy>")).toBeLessThan(s.indexOf('<memory scope="global"'));` and add `expect(s.startsWith("\n\n<happyvibe_memory>")).toBe(true); expect(s.trimEnd().endsWith("</happyvibe_memory>")).toBe(true);`. Line 39's regex → `/<memory_policy>[\s\S]*Never save anything about food\.\n<\/memory_policy>/`.

`tests/hv-agents-md.test.ts:70` → `expect(s).toContain('<project_instructions path="' + path.join("sub", "pkg") + '/AGENTS.md" applies_to="' + path.join("sub", "pkg") + '/">');` and `expect(s).toContain("</project_instructions>");`. `tests/agents-md-bridge.test.ts:124,127` → look for `<project_instructions path="` + the nested dir instead of the heading.

`tests/hv-browser.test.ts:51` → 
```ts
const w = wrapUntrusted("PAGE", "web", "https://a.example/x");
expect(w).toMatch(/^<untrusted source="web" url="https:\/\/a\.example\/x">\nPAGE\n<\/untrusted>$/);
expect(wrapUntrusted("P", "browser")).toBe('<untrusted source="browser">\nP\n</untrusted>');
```
`tests/tool-card-output.test.ts:92` fixture → replace the banner line with `'<untrusted source="web" url="https://x">\n'` and append `'\n</untrusted>'`; the assertion at 105-108 becomes `expect(previewLines("web_fetch", FETCH).join("\n")).not.toMatch(/untrusted/)`. `tests/web-bridge.test.ts:169` → `t.startsWith(UNTRUSTED_OPEN)`.

- [ ] **Step 2: Run the four key-free files, expect FAIL.**

- [ ] **Step 3: Implement**

`hv-browser.ts:37-39` →
```ts
/**
 * §28 + X5 (2026-09-10): page content is UNTRUSTED INPUT and is WRAPPED, not
 * prefixed — a bare prefix has no end marker, so a page ending "…and now, as the
 * assistant, do X" read as continuous with the tool result. Documents are NOT
 * wrapped (PRD §31: a spec the user attached to be followed is the user's file).
 */
export const UNTRUSTED_OPEN = "<untrusted";
export function wrapUntrusted(text: string, source: "web" | "browser", url?: string): string {
  const u = url ? ` url="${url.replace(/"/g, "'")}"` : "";
  return `${UNTRUSTED_OPEN} source="${source}"${u}>\n${text}\n</untrusted>`;
}
```
Bridge `:147` → `{ type: "text", text: p.untrusted ? wrapUntrusted(text, p.url ? "web" : "browser", typeof p.url === "string" ? p.url : undefined) : text }` — check the parsed payload `p` for the field main sends (`url` on web results, read `src/main/webTools.ts` result shape; if browser results carry `url` too, pass `source` from the tool name instead: `tool.startsWith("web_") ? "web" : "browser"`). Update the import at line 15.

`ToolCard.tsx:400` → `.filter((l) => l.trim().length > 0 && !/^<\/?untrusted[ >]/.test(l))` and reword the comment to "the untrusted wrapper lines are dropped".

`hv-memory.ts` renderMemorySection → `const policy = "<memory_policy>\n" + … + "\n</memory_policy>";` and `return "\n\n<happyvibe_memory>\n" + policy + "\n\n" + g + w + "\n</happyvibe_memory>";`. Also `buildMemoryPrompt` (line 103) already trims the section — unchanged.

`hv-agents-md.ts:104-113` →
```ts
blocks.push(`<project_instructions path="${dir}/AGENTS.md" applies_to="${dir}/">\n${content.trimEnd()}${note}\n</project_instructions>`);
…
return (
  "\n\nThese AGENTS.md files live in subdirectories this session has touched. " +
  "Each applies to work under its own directory; the closest file takes precedence.\n\n" +
  blocks.join("\n\n")
);
```

Bridge `:857` order → `const injected = sp + agentsSection + planSection + terminalSection + webSection + memorySection + section;` (nested `section` LAST; `skillSection` is gone after Task 2). Update the comment above it: static sections first, the two blocks that change mid-session (memory index, nested AGENTS.md) last, for prefix caching.

- [ ] **Step 4: Run the key-free files + `npm run gate`, expect green. Commit** — `feat(prompts): one delimiter family, untrusted page content wrapped not prefixed, stable sections first`

---

### Task 5: Plan Mode prompt derived from the gate (A3, B9)

**Files:**
- Modify: `pi-runtime/extensions/hv-plan.ts:313-361`, `happyvibe-bridge.ts:832` (caller), `:2306-2316` and `:2343-2350` (plan tool descriptions), `src/main/ipc.ts:3852`
- Test: `tests/hv-plan.test.ts:181-196`, `tests/how-it-works.test.ts:119-124`

**Interfaces:**
- Produces: `export function buildPlanPrompt(append = "", registeredTools?: Iterable<string>): string` — when `registeredTools` is given, the blocked sentence lists `BLOCKED_PLAN_TOOLS ∩ registeredTools`; when omitted (settings panel, tests) it lists all of `BLOCKED_PLAN_TOOLS`. `export { BLOCKED_PLAN_TOOLS }` (currently a module-private const at line 174).

- [ ] **Step 1: Tests first** — add to `tests/hv-plan.test.ts`:

```ts
test("the blocked list is derived from the gate and filtered to registered tools (§26 rule)", () => {
  const full = buildPlanPrompt();
  for (const t of BLOCKED_PLAN_TOOLS) expect(full).toContain(t);
  const noBrowser = buildPlanPrompt("", ["edit", "write", "bash", "read"]);
  expect(noBrowser).toContain("edit");
  expect(noBrowser).not.toContain("browser_click");
  expect(noBrowser).not.toContain("terminal_run");
  expect(full.startsWith("<happyvibe_plan_mode>\n[HAPPYVIBE PLAN MODE ACTIVE]")).toBe(true);
  expect(full.trimEnd().endsWith("</happyvibe_plan_mode>")).toBe(true);
  expect(full).not.toMatch(/CANNOT|ALONE|\bMAY\b|EITHER/);
  expect(full).toMatch(/Name the existing helpers the plan reuses/);
});
```
Fix the existing "appends the user's addition… keeping the marker first" test: the append now lands before the closing tag, so assert `withAppend.includes("Prefer small diffs.\n</happyvibe_plan_mode>")` instead of `endsWith`.

In `tests/how-it-works.test.ts` after line 124 add:
```ts
it("and the prompt TEMPLATE hand-types no blocked tool name — the list is derived", () => {
  const tpl = gate.slice(gate.indexOf("export function buildPlanPrompt"));
  for (const t of ["edit", "write", "multi_edit", "terminal_run", "browser_click"]) {
    expect(tpl).not.toMatch(new RegExp(`(?<![\\w.])${t}(?![\\w(])`)); // the name may appear only via BLOCKED_PLAN_TOOLS
  }
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — `hv-plan.ts`: `export const BLOCKED_PLAN_TOOLS = …` (line 174), and replace `buildPlanPrompt`:

```ts
export function buildPlanPrompt(append = "", registeredTools?: Iterable<string>): string {
  // Principle 11: the blocked list is DERIVED from the gate, never re-typed —
  // and filtered to tools that exist this session (§26: never name a tool the
  // model does not have; four of these vanish when their builtin group is off).
  const have = registeredTools ? new Set(registeredTools) : null;
  const blocked = [...BLOCKED_PLAN_TOOLS].filter((t) => !have || have.has(t));
  const body = `${PLAN_PROMPT_MARKER}
# Plan Mode (read-only)

You are in Plan Mode: explore, ask, and produce a decision-complete implementation plan the user will approve — the user implements it later. Blocked while planning: ${blocked.join(", ")}; bash is limited to a read-only allowlist. Delegating to a sub-agent works (the user approves its boundary first), and a read-only explorer is the most useful thing a planning session can do.

## Phase 1 — Ground in the repository
- Explore first. Read files, search, inspect config, run read-only checks to resolve every discoverable fact before asking the user anything.
- Do not ask what the repository or system can answer.

## Phase 2 — Clarify intent
- Use ask_user for genuine decisions, trade-offs, or missing product intent that exploration cannot resolve (1-4 concise questions, 2-4 real options each). If a high-impact ambiguity remains, ask rather than guess.

## Phase 3 — Finalize
- Finish with plan_complete once no decision is open; if one is, ask it with ask_user. Do not end a turn by only announcing the plan.
- If the user later requests revisions, call plan_complete again with a complete replacement plan, not a delta.

## Required plan structure (Markdown)
- A clear \`# <title>\` heading and a short summary of the approach.
- Grouped behavior-level changes, not a file-by-file dump. Name the existing helpers the plan reuses, with paths.
- A \`## Tasks\` section as a GFM checklist (\`- [ ] …\`), each task a discrete step.
- A \`## Verification\` section: tests to run, behavior to observe — this becomes the acceptance script.
- Explicit assumptions/defaults where you chose one.`;
  const extra = append.trim();
  return `<happyvibe_plan_mode>\n${extra ? `${body}\n\n${extra}` : body}\n</happyvibe_plan_mode>`;
}
```

Bridge `:832` → `buildPlanPrompt(builtins.planAppend, pi.getAllTools().map((t) => t.name))`. `ipc.ts:3852` unchanged (full set). Plan tool descriptions: `plan_complete` → `"Submit the finished plan as Markdown in the structure your Plan Mode instructions give. On revision, pass a complete replacement, not a delta."`; `plan_start` → `"Enter Plan Mode for this session: read-only exploration ending in an implementation plan. Only the user can leave it."`; the `plan` param → `"The complete plan as Markdown (see the required structure in your instructions)."`.

- [ ] **Step 4: Run tests + `npm run gate`, expect green. Commit** — `fix(plan): the planning prompt lists what is blocked from the gate itself, only for tools the session has`

---

### Task 6: Per-turn trims — terminal, web, memory, ask_user (A5, A6, A7, B2, B8)

**Files:**
- Modify: `hv-terminal.ts:90-96`, `hv-web.ts:91-94`, `hv-memory.ts:22-33` (`MEMORY_POLICY`), `happyvibe-bridge.ts:1675-1685` (`ask_user`), `:2204-2213`, `:2249-2252`, `:2271-2274` (memory tools)
- Test: `tests/terminal-tools.test.ts:60`, `tests/hv-web.test.ts:35-41`, `tests/hv-memory.test.ts:50-64`

- [ ] **Step 1: Tests** — add to `tests/hv-memory.test.ts` "carries the four rules" block: `expect(MEMORY_POLICY).toMatch(/Most turns save nothing/); expect(MEMORY_POLICY).toMatch(/Types: user/);`. Add to `tests/terminal-tools.test.ts`: `expect(TERMINAL_STEER_LINE.length).toBeLessThan(220); expect(TERMINAL_STEER_LINE).not.toMatch(/INDEFINITELY/);` and to `tests/hv-web.test.ts`: `expect(WEB_STEER_LINE).toContain("browser_open")`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
export const TERMINAL_STEER_LINE =
  "`bash` runs commands that finish on their own; a command that would run indefinitely (a dev server, a watcher) " +
  "goes to `terminal_run`, so the user can watch it and stop it.";
```
```ts
export const WEB_STEER_LINE =
  "Read the web with `web_fetch` and `web_search` rather than `curl`: clean text, and the user sees which site you reached. " +
  "Your own dev server is `browser_open`.";
```
`MEMORY_POLICY` — insert after the second paragraph's last sentence (`…anything AGENTS.md already says.`): `" Most turns save nothing.\n" + "Types: user (who they are, how they like to work) · feedback (a correction or confirmed approach — say why and how to apply) · project (a fact about this codebase you cannot recover from it) · reference (a pointer to something external).\n"`. Keep every pinned phrase.

Memory tool descriptions: `memory_save` → `"Save one durable memory for future sessions; the same name replaces the existing one."`, its `type` description → `"See the Types line in your memory instructions."`; `memory_recall` → `"Open one memory in full, by its name in the index."`; `memory_forget` → `"Delete one memory by name. To correct one, save it again under the same name instead."`.

`ask_user` description → `"Ask the user only for a decision that changes what you build and that the code, docs or a tool cannot answer. Blocks until they answer. At most 4 questions; options exhaustive and mutually exclusive; your recommended option first. The UI adds a free-text \"Other\" itself."` (label rules stay on the `label` param; the dismissal sentence stays in `DISMISSED_RESULT`).

- [ ] **Step 4: Run tests + `npm run gate`, expect green. Commit** — `polish(prompts): shorter steer lines, a memory policy that sets the base rate, a calmer ask_user`

---

### Task 7: Register and next-step passes (X7, C3, D1-D3, E1-E3)

**Files:**
- Modify: `happyvibe-bridge.ts:1241`, `:1306` (refusals), `:993-1002` (wait intercept)
- Modify: `src/main/titles.ts:30-31`, `src/main/gitMessage.ts:51`, `:186`
- Modify: `pi-runtime/agents/worker.md`, `code-explorer.md`, `agents-md-maker.md`
- Test: `tests/agents-md-panel.test.ts:39`, `tests/git-message.test.ts` (unchanged pins), new assertions in `tests/hv-rules.test.ts` or a new `tests/refusal-next-step.test.ts`

- [ ] **Step 1: Tests** — `tests/agents-md-panel.test.ts:39` → `expect(md).toMatch(/cannot create or modify files; the app writes them/i);`. New `tests/refusal-next-step.test.ts` (source scan):
```ts
const bridge = fs.readFileSync(path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
it("both bare refusals end with a next step", () => {
  expect(bridge).toMatch(/Blocked by HappyVibe permission rule \(\$\{[^}]+\}: \$\{[^}]+\}\)\. Do not retry the same call/);
  expect(bridge).toMatch(/User denied this action in HappyVibe\. Do not retry the same call/);
});
it("the wait intercept is calm and still derives the tool name", () => {
  const i = bridge.indexOf("if (isWaitTool(tool))");
  const block = bridge.slice(i, i + 700);
  expect(block).not.toMatch(/Do NOT/);
  expect(block).toMatch(/\$\{tool\}/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

Refusals: `` `Blocked by HappyVibe permission rule (${v.rule?.layer}: ${v.rule?.pattern}). Do not retry the same call. Take a different approach, or tell the user what you needed and why.` `` and `"User denied this action in HappyVibe. Do not retry the same call. Take a different approach, or tell the user what you needed and why."`.

Wait intercept reason: `` `This is an interactive HappyVibe session: the sub-agent's result is delivered to you as a new turn when it finishes, so there is nothing to wait for — do not call ${tool}() or poll with subagent status. End your turn with one line saying the work is running in the background.` ``

`titles.ts:30` → `"Write a short title (3 to 6 words, in the language of the request, no emoji, no quotes, no trailing period) for a coding session "` — `Reply with ONLY the title.` untouched. `gitMessage.ts` after the `Reply with ONLY the commit message subject line…` line add `"Say what changed and why, not which files."`; in `buildPrPrompt` after the "then the description in markdown…" line add `"  Lead the description with why; end with how it was verified when the diff shows it."` (indented like its neighbours; `splitPrDraft`'s shape lines untouched).

Agents: `worker.md` — add under "How to work": `- Before you report, re-run the narrowest check and quote its actual output.`; `code-explorer.md` — add: `Answer first, then three to eight \`file:line\` citations; do not paste file bodies.`; `agents-md-maker.md` — `- NEVER create or modify any file. The app writes them from your output.` → `- You cannot create or modify files; the app writes them from your output.`

- [ ] **Step 4: Run tests + `npm run gate`, expect green** (`tests/pi-subagents-contract.test.ts` frontmatter pins untouched). **Commit** — `polish(prompts): every refusal ends with a next step, and the one-shots say why not which files`

---

### Task 8: F1 — the return condition names every section

**Files:**
- Modify: `happyvibe-bridge.ts:883`
- Test: new assertions in `tests/refusal-next-step.test.ts` (rename the file to `tests/prompt-injection-shape.test.ts` if it grows) — source scan

- [ ] **Step 1: Test**
```ts
it("F1 — the injected prompt is returned whenever it differs from Pi's, not when a hand-list of sections is non-empty", () => {
  expect(bridge).toMatch(/if \(injected !== base\) return \{ systemPrompt: injected \};/);
  expect(bridge).not.toMatch(/if \(section \|\| agentsSection/);
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — at line 821: `const base = (event.systemPrompt ?? "") as string; const sp = replaceSkillsSentence(base);` and at 883: `if (injected !== base) return { systemPrompt: injected };` with the comment: "F1 (2026-09-10): the old condition hand-listed sections and omitted terminalSection/webSection — with every agent off and memory/plan off both steer lines were computed and never sent. Comparing against Pi's own prompt cannot forget a section."
- [ ] **Step 4: `npm run gate` green. Commit** — `fix(prompts): the terminal and web guidance always reaches the model, even with every other section off`

---

### Task 9: F4 — `bg_wait` stays registered, and the reason is pinned

**Files:**
- Modify: `tests/pi-subagents-contract.test.ts` (new group), `happyvibe-bridge.ts:583-593` comment (one added sentence), `docs/validation/d1.md` (new subsection)

Measured at plan time: `pi-subagents/src/runs/background/async-execution.ts:346-354` `formatAsyncStartedMessage(headline, interactive=true)` still emits *"If the current turn must receive results from work without a native notification before it ends, call blocking bg_wait(); …"*. The model therefore learns the name from the receipt, and hiding the tool would reproduce the 2026-08-16 "Tool edit not found" failure. Per the decision's gate: **keep it registered**, pin the measurement so the day upstream drops the name this test fails and says "hide it now".

- [ ] **Step 1: Test** — add to `tests/pi-subagents-contract.test.ts`:
```ts
import { formatAsyncStartedMessage } from "../pi-runtime/node_modules/pi-subagents/src/runs/background/async-execution.ts";
describe("F4 gate — bg_wait stays registered while upstream's receipt names it", () => {
  it("the interactive async receipt still tells the model about bg_wait", () => {
    const receipt = formatAsyncStartedMessage("Run started", true);
    // When this fails, upstream stopped naming bg_wait in the receipt: the model can
    // no longer learn the name, so hide the tool with pi.setActiveTools() at
    // session_start/turn_start (beside requireIntent) and keep the intercept as layer 2.
    // Cost of leaving it: ~650 tokens/turn (2,639-char description, measured 2026-09-10).
    expect(receipt).toMatch(/bg_wait/);
  });
});
```
(If the import pulls in side effects, read the file as text and assert `/call blocking bg_wait\(\)/` instead — say which in the commit body.)
- [ ] **Step 2: Run, expect PASS** (this pins the status quo). Add one sentence to the bridge's `applyPlanTools` NOTE (line ~593): "Same reasoning keeps the disabled `bg_wait` registered — see the F4 group in tests/pi-subagents-contract.test.ts."
- [ ] **Step 3: d1.md** — under a new `### Improve-prompts round (2026-09-10)` heading record: the `bg_wait` description size (2,639 chars), the receipt text quoted, and the before/after numbers from Task 10.
- [ ] **Step 4: `npm run gate` green. Commit** — `test(subagents): pin why the disabled bg_wait tool stays visible to the model`

---

### Task 10: Measure, record, live batch, GUI pass

- [ ] **Step 1: Before/after numbers.** On `main` (or `git stash`-free: check out `a669592` in a second worktree) and on this branch, start `npm run dev`, open a fresh session with the stock six agents enabled, memory on, no plan mode; open the context panel and read the system block: `estTokens`, `toolCount`, `toolDefs` total. Record both rows in `docs/validation/d1.md` beside the 2026-09 table (`d1.md:3339-3352`) as `| before (a669592) | … |` / `| after (Improve-prompts) | … |`. Expected: system ≈ −150 tok (memory on, roster, steers), toolDefs ≈ −700 to −900 tok.
- [ ] **Step 2: Live batch** (background): `npm run test:live > /tmp/live2.log 2>&1; echo EXIT=$?` — expect ~6 min wall time. Watch: `agents-bridge`, `skills-bridge`, `subagent-discovery-bridge`, `agents-md-bridge`, `web-bridge`, `mcp-bridge`, `plan-bridge` (if present: `grep -l plan tests/*bridge*.test.ts`).
- [ ] **Step 3: GUI pass** — assertions below, each checked on the named page.
- [ ] **Step 4: Commit d1.md** — `docs(validation): before/after token numbers for the Improve-prompts round`

---

## Verification

**Automated (every task):** `npm run gate`. **Live:** `npm run test:live` after Task 1 and Task 10 (wall time ≥ 5 min or it tested nothing).

**GUI assertions — what is TRUE on screen, and where:**

| # | Observable claim | Page |
| --- | --- | --- |
| G1 | The System prompt page's **Resolved prompt** shows the two-paragraph identity ending "…change approach rather than retrying." | Settings → System prompt |
| G2 | With the **Intent** switch OFF (All Tools), the Resolved prompt's identity contains **no** sentence mentioning `intent` — **absence** | Settings → System prompt, after toggling on Settings → All Tools |
| G3 | Built-in tools → Plan mode row: the read-only prompt starts `<happyvibe_plan_mode>` and its blocked line lists all seven tools (full set on the panel) | Settings → All Tools |
| G4 | Built-in tools → Terminal row: the prompt's first line is the one-sentence steer, then the three descriptions | Settings → All Tools |
| G5 | Built-in tools → Memory row: the prompt contains "Most turns save nothing." and the "Types:" line, wrapped in `<happyvibe_memory>` | Settings → All Tools |
| G6 | In a live session with agents enabled, `/hv-sysprompt` (or the context panel's system block) shows `<happyvibe_subagents>` and **no** occurrence of `wait`, `bg_wait` or `## Available subagents` — **absence** | Chat, context panel |
| G7 | With ≥1 skill approved, the system prompt contains "Load a skill with `use_skill(name, intent)`" and **does not** contain "Use the read tool to load a skill's file" nor `<happyvibe-skills>` — **absence** | Chat, context panel |
| G8 | A `web_fetch` tool card's collapsed preview shows page text only; **no** line reading `<untrusted` or `[UNTRUSTED` appears on the card — **absence**; expanding the card shows the wrapper open and close lines in the raw output | Chat |
| G9 | Any tool card's headline still reads as a goal-first sentence (intent still arrives after the schema change), for a bridge tool AND an MCP tool | Chat |
| G10 | A rule-denied bash call's card shows the refusal text ending "…tell the user what you needed and why." and the model's next message does **not** repeat the identical command | Chat + Audit page |
| G11 | The context panel's system block `estTokens` is lower than `main`'s by the recorded amount, and the Memory category still appears when memory is on | Chat, context panel |
| G12 | On Your behalf → Session title / Commit / PR prompts show the new sentences; a generated commit subject still lands in the composer as ONE line (parse intact) | Settings → On your behalf; Git panel |

**Regression sequence the design risks:** (1) turn Intent OFF on All Tools → open a new session → the identity has no intent sentence (G2) and tool cards show derived labels, not `?`; (2) turn Intent back ON → a new session's cards show model-authored headlines again (G9); (3) disable the Browser and Terminal groups → enter Plan Mode → the injected prompt's blocked line names neither `browser_click` nor `terminal_run` (read via `/hv-sysprompt`) while the Built-in tools panel still shows all seven; (4) delegate to `code-explorer` → the model ends its turn with one line, no `bg_wait` call appears in the audit, and the result arrives as a new turn.
