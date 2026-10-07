# Tool switches (Feedbacks v16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tool the agent has can be switched off: MCP, Sub-agents, Workflows, Skills as families, and Pi's seven core tools one by one. Also fixes the Schedules switch, which never reached the bridge.

**Architecture:** New keys go into the existing global `builtinTools` config, so they ride the spawn-resolved `HV_BUILTINS` path and its respawn. Spawn stops passing a family's `-e`/`--skill` args when it's off. Excluded tools go to Pi as one `--exclude-tools` list. The child guard reads the same `HV_BUILTINS` (children run in-process, so they share the env) and refuses a switched-off core tool. The renderer adds rows to Built-in tools and one shared `FamilySwitch` at the top of the MCP, Agents and Skills pages.

**Tech Stack:** Electron + React renderer, Pi 1.0.2 RPC, vitest (no DOM).

**Spec:** Notion "Feedbacks v16" (`3f1d33dfffca8174a3cefc1e774cc172`, rewritten 2026-10-08) and `docs/prd.md` §13 "Decision (Feedback round 26, 2026-10-08) — every tool the agent has can be switched off".

## Global Constraints

- Global only. No workspace tier for any new switch.
- Default for every new switch is ON (fail-open, same as every `builtinTools` key). `coreOff` defaults to `[]`.
- Core tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. On Windows (`agentShell === "powershell"`) the shell entry is `powershell`.
- No Prompts master switch: `PromptTemplatesView.tsx` gets no `FamilySwitch`.
- §26: no prompt line, steer line or tool description may name a tool the session doesn't have.
- Off holds under bypass: a switched-off tool is absent, not a permission, so `HV_BYPASS` never brings it back.
- Everything off is allowed, with no guard. Built-in tools then shows exactly: `The agent can only chat — it has no tools.`
- `HV_BUILTINS` keys stay EXPLICIT in `spawn.ts` (the existing rule). Every new key is listed there and pinned by a test.
- Commits: `git commit -s`, conventional messages, with the attribution trailer.

## Review Focus

1. **Bash off, sub-agents on.** The model delegates to an agent file with no `tools:` line, and that child's `bash` call must be refused (Task 5 test).
2. **Bypass on plus bash off.** The child guard must still refuse; the parent never has `bash` declared at all (Task 5 test).
3. **Sub-agents off but agent files exist.** The roster must not be injected, because it names `Agent` (Task 4 contract test).
4. **Workflows off while Sub-agents on.** `SubagentWorkflow` must be absent from `/hv-tools`, and plan mode's blocked list must not name it (Task 3 spawn test plus Task 4 contract test; plan prompt already filters by `getAllTools`).
5. **Windows shell off.** `powershell` must be excluded, not `bash`. The Windows `--tools` allowlist and `--exclude-tools` must combine (Task 3 test with `agentShell: "powershell"`).

---

### Task 1: Schedules switch reaches the bridge (bug fix)

**Files:**
- Modify: `src/main/pi/spawn.ts:271-283` (the `HV_BUILTINS` object)
- Create: `tests/tool-switches-spawn.test.ts`

**Interfaces:**
- Produces: `tests/tool-switches-spawn.test.ts`, with a `builtins(over)` helper returning a full `builtinTools` object. Tasks 3 and 5 add cases to it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";

export const builtins = (over: Record<string, unknown> = {}) => ({
  plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true,
  document: true, memory: true, memoryAppend: "", schedules: true,
  mcp: true, subagents: true, workflows: true, skills: true, coreOff: [] as string[],
  ...over,
});
const spawnWith = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  resolvePiSpawn("/w", "/s", "/rt", { builtinTools: builtins(over) as never, ...extra });

describe("HV_BUILTINS carries every switch", () => {
  test("schedules:false reaches the bridge", () => {
    expect(JSON.parse(spawnWith({ schedules: false }).env.HV_BUILTINS).schedules).toBe(false);
  });
});
```

- [ ] **Step 2: Run it.** `L=/tmp/vitest.log; npx vitest run tests/tool-switches-spawn.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`. Expected: FAIL (`schedules` is undefined).
- [ ] **Step 3: Fix.** Add `schedules: opts.builtinTools.schedules,` to the `HV_BUILTINS` object in `spawn.ts`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit.** `fix(schedules): the Schedules switch reaches the bridge — HV_BUILTINS omitted the key, so the four tools always loaded`

### Task 2: Config and parse carry the new keys

**Files:**
- Modify: `pi-runtime/extensions/hv-builtins.ts` (`BuiltinToggles`, `parseBuiltins`, new `CORE_TOOLS`, new `excludedTools`, new `offToolRefusal`)
- Modify: `src/main/config.ts:64,398-424` (`builtinTools` type, `getBuiltinTools`, `setBuiltinTools`)
- Modify: `src/main/pi/spawn.ts:84` (the `builtinTools` option type)
- Modify: `src/main/ipc.ts:4323` (`hv:builtins-set` param type: add the five keys)
- Modify: `src/renderer/src/hv.d.ts` (`Builtins` type)
- Test: `tests/hv-builtins.test.ts`

**Interfaces:**
- Produces (in `hv-builtins.ts`, import-free, so the renderer can import it):
  - `BuiltinToggles` gains `mcp: boolean; subagents: boolean; workflows: boolean; skills: boolean; coreOff: string[]`
  - `export const CORE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;`
  - `export function coreToolNames(shell: "bash" | "powershell"): string[]` (`bash` swapped for `powershell`)
  - `export function excludedTools(b: BuiltinToggles): string[]` returns `[...b.coreOff, ...(b.subagents && !b.workflows ? ["SubagentWorkflow"] : [])]`
  - `export function offToolRefusal(tool: string, b: BuiltinToggles): string | null` returns `The user switched off '${tool}' in Settings → Built-in tools. Do not retry it and do not work around it; finish what you can with the tools you have.` when `b.coreOff` includes `tool`, else `null`

- [ ] **Step 1: Failing tests** in `tests/hv-builtins.test.ts`:

```ts
import { coreToolNames, excludedTools, offToolRefusal, parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("§13 round 26 — family and core switches", () => {
  test("defaults are on, coreOff empty", () => {
    const b = parseBuiltins(undefined);
    expect([b.mcp, b.subagents, b.workflows, b.skills, b.coreOff]).toEqual([true, true, true, true, []]);
  });
  test("false keys parse; coreOff keeps only core names", () => {
    const b = parseBuiltins(JSON.stringify({ mcp: false, skills: false, coreOff: ["bash", "Agent", 3] }));
    expect([b.mcp, b.skills, b.coreOff]).toEqual([false, false, ["bash"]]);
  });
  test("powershell is a core name on Windows", () => {
    expect(coreToolNames("powershell")).toEqual(["read", "powershell", "edit", "write", "grep", "find", "ls"]);
    expect(parseBuiltins(JSON.stringify({ coreOff: ["powershell"] })).coreOff).toEqual(["powershell"]);
  });
  test("workflows off excludes SubagentWorkflow only while sub-agents are on", () => {
    expect(excludedTools(parseBuiltins(JSON.stringify({ workflows: false, coreOff: ["ls"] })))).toEqual(["ls", "SubagentWorkflow"]);
    expect(excludedTools(parseBuiltins(JSON.stringify({ workflows: false, subagents: false })))).toEqual([]);
  });
  test("offToolRefusal names only switched-off tools", () => {
    const b = parseBuiltins(JSON.stringify({ coreOff: ["bash"] }));
    expect(offToolRefusal("bash", b)).toMatch(/switched off 'bash'/);
    expect(offToolRefusal("read", b)).toBeNull();
  });
});
```

Also update the existing `toEqual` default objects in this file (lines 6–29) to include `mcp: true, subagents: true, workflows: true, skills: true, coreOff: []`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `parseBuiltins`: `if (p.mcp === false) out.mcp = false;` and the same for subagents, workflows and skills. `coreOff`: `Array.isArray(p.coreOff) ? p.coreOff.filter((t) => typeof t === "string" && [...CORE_TOOLS, "powershell"].includes(t)) : []`. In `config.ts` `getBuiltinTools`, add `mcp: t?.mcp ?? true, subagents: t?.subagents ?? true, workflows: t?.workflows ?? true, skills: t?.skills ?? true, coreOff: t?.coreOff ?? []`, and widen both type literals. Widen the `spawn.ts:84`, `ipc.ts:4323` and `hv.d.ts` types the same way (`coreOff?: string[]` on the setter).
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tools): builtinTools carries the MCP, Sub-agents, Workflows, Skills and core-tool switches`

### Task 3: Spawn obeys the switches

**Files:**
- Modify: `src/main/pi/spawn.ts` (args and the `HV_BUILTINS` keys)
- Modify: `src/main/ipc.ts:~1018` (`spawnOpts`: skill entries empty when `!builtins.skills`)
- Test: `tests/tool-switches-spawn.test.ts`

**Interfaces:**
- Consumes: `excludedTools`, `BuiltinToggles` (Task 2)
- Produces: `HV_BUILTINS` JSON carrying `mcp`, `subagents`, `workflows`, `skills`, `coreOff` (read by Tasks 4 and 5)

- [ ] **Step 1: Failing tests** (append):

```ts
import path from "node:path";
import { TW_RELPATH, PI_MCP_EXTENSIONS } from "../src/main/pi/spawn";

const argsOf = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) => spawnWith(over, extra).args;
const valueAfter = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

describe("round 26 — spawn obeys the switches", () => {
  test("subagents:false drops tintinweb", () => {
    expect(argsOf({ subagents: false })).not.toContain(path.join("/rt", TW_RELPATH));
    expect(argsOf({})).toContain(path.join("/rt", TW_RELPATH));
  });
  test("mcp:false wins over the caller's mcp:true, and HV_MCP is unset", () => {
    const s = spawnWith({ mcp: false }, { mcp: true });
    expect(s.args).not.toContain(PI_MCP_EXTENSIONS[1]);
    expect(s.env.HV_MCP).toBeUndefined();
  });
  test("skills:false passes no --skill even when given skills", () => {
    expect(argsOf({ skills: false }, { skills: ["/a/skill"] })).not.toContain("--skill");
  });
  test("one --exclude-tools list: core tools plus SubagentWorkflow", () => {
    expect(valueAfter(argsOf({ coreOff: ["bash", "write"], workflows: false }), "--exclude-tools")).toBe("bash,write,SubagentWorkflow");
    expect(argsOf({})).not.toContain("--exclude-tools");
  });
  test("Windows: powershell excluded alongside the --tools allowlist", () => {
    const a = argsOf({ coreOff: ["powershell"] }, { agentShell: "powershell" });
    expect(valueAfter(a, "--exclude-tools")).toBe("powershell");
    expect(a).toContain("--tools");
  });
  test("HV_BUILTINS lists every new key", () => {
    const b = JSON.parse(spawnWith({ mcp: false, subagents: false, workflows: false, skills: false, coreOff: ["ls"] }).env.HV_BUILTINS);
    expect(b).toMatchObject({ mcp: false, subagents: false, workflows: false, skills: false, coreOff: ["ls"] });
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** in `resolvePiSpawn`:
  - `const b = opts.builtinTools;` then `const twOn = b?.subagents ?? true;` and `const mcpOn = !!opts.mcp && (b?.mcp ?? true);`
  - `...(twOn ? ["-e", path.join(runtimeDir, TW_RELPATH)] : [])`
  - `...(mcpOn ? PI_MCP_EXTENSIONS : [])` and `...(mcpOn ? { HV_MCP: "1" } : {})`
  - `...((b?.skills ?? true) ? (opts.skills ?? []).flatMap(...) : [])` (keep `--no-skills` unconditional)
  - After the `--tools` line: `...(b && excludedTools(b as BuiltinToggles).length ? ["--exclude-tools", excludedTools(b as BuiltinToggles).join(",")] : [])`
  - Add the five keys to `HV_BUILTINS`.
  - In `ipc.ts` `spawnOpts`: `const entries = workspace && sessionId && builtins.skills ? activeSkillEntries(workspace, project) : [];`. Move `const builtins = getBuiltinTools();` above it.
- [ ] **Step 4: Run** this file plus `tests/tw-spawn.test.ts tests/mcp-spawn.test.ts tests/skills-spawn.test.ts tests/resource-gate-contract.test.ts`. Expected: all PASS (the existing tests pass no `builtinTools`, so the defaults keep the old args).
- [ ] **Step 5: Commit.** `feat(tools): spawn drops MCP, sub-agents and skills when switched off, and excludes switched-off tools`

### Task 4: The bridge never names a tool the session lacks

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (`use_skill` registration ~1656, roster ~840, `/hv-tools` unchanged)
- Modify: `pi-runtime/extensions/hv-plan.ts:~354` (`buildPlanPrompt`: the "bash is limited" clause only when a shell tool is in `registeredTools`; the "Delegating to a sub-agent works" sentence only when `Agent` is)
- Modify: `pi-runtime/extensions/hv-terminal.ts` (`shellSteerLine`): if the shell tool is switched off, the steer line must not name it. Read the line and drop the "rather than backgrounding a <shell> command" clause when `coreOff` includes the shell
- Test: `tests/builtins-contract.test.ts` (boots Pi, no key, no model turn), `tests/hv-plan*.test.ts` (whichever file tests `buildPlanPrompt`; grep it)

**Interfaces:**
- Consumes: `parseBuiltins` keys `skills`, `subagents`, `coreOff` (Tasks 2 and 3)

- [ ] **Step 1: Failing tests.**
  - Contract (extend `probe` so its args can take extra flags like `["--exclude-tools", "bash"]`):
    - `HV_BUILTINS={"skills":false}`: `/hv-tools` lists no `use_skill`.
    - With `["--exclude-tools", "bash,SubagentWorkflow"]` and the tintinweb `-e` added: `/hv-tools` lists neither name. This pins Pi's `getAllTools()` filtering excluded tools, which the Agent tools page relies on. A pin bump that breaks it fails here.
  - Plan prompt unit: `buildPlanPrompt("", ["read", "grep"])` contains neither `bash` nor `sub-agent`; `buildPlanPrompt("", ["read", "bash", "Agent"])` contains both.
  - Roster: `HV_BUILTINS={"subagents":false}` with an agent file in `<agentDir>/agents/x.md`. Probe the injected system prompt the same way the existing roster test does (grep `tests/` for `renderSubagentSection`). Expected: no "Available subagents" block.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Wrap the `use_skill` `registerTool` in `if (builtins.skills) { … }`.
  - `const agentsSection = builtins.subagents ? renderSubagentSection(await enumerateAgents(), { tool: "Agent" }) : "";`
  - Plan prompt: build both clauses from `have`.
  - Terminal steer: pass `builtins.coreOff` and drop the shell clause when the shell is off.
- [ ] **Step 4: Run.** Expected: PASS. Also run `tests/how-it-works.test.ts`. If any guidance copy derived from these gates changed, re-derive it as the test says.
- [ ] **Step 5: Commit.** `feat(bridge): no use_skill, roster or shell line for a switched-off family or tool`

### Task 5: Off reaches sub-agent children

**Files:**
- Modify: `pi-runtime/extensions/hv-child-guard.ts` (`inProcessGuard`, before `guardDecision`)
- Modify: `pi-runtime/extensions/hv-tw-gate.ts` (`twBoundary`: drop switched-off names from `effectiveAllowlist`, so the approval card doesn't promise a tool the child can't use)
- Test: `tests/child-guard-inproc.test.ts`, plus `twBoundary` unit cases wherever it's tested (grep `twBoundary` in `tests/`)

**Interfaces:**
- Consumes: `parseBuiltins`, `offToolRefusal` (Task 2)

- [ ] **Step 1: Failing tests** (follow the file's existing harness for building a guard with a policy):
  - `HV_BUILTINS={"coreOff":["bash"]}`: a child `bash` call returns `{ block: true, reason: /switched off 'bash'/ }`, and `policy.ask` is NOT called.
  - Same, plus `HV_BYPASS=1`: still blocked.
  - `read` with the same env: not blocked by this check.
  - `twBoundary("x", { declared: undefined, builtinToolNames: ["read", "bash"] } as never, {}, new Set(["bash"]))`: the summary does not list `bash`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Import `parseBuiltins` and `offToolRefusal` from `./hv-builtins`. In `inProcessGuard`, add `const builtins = parseBuiltins(process.env.HV_BUILTINS);`, and first thing in the handler:
  ```ts
  const off = offToolRefusal(tool, builtins);
  if (off) { report(tool, input, "deny", "deny", off); return { block: true, reason: off }; }
  ```
  For `twBoundary`, add an optional 4th param `off: ReadonlySet<string> = new Set()` and filter `info.builtinToolNames`. At both bridge call sites (~1066, ~1225), pass `new Set(builtins.coreOff)`.
- [ ] **Step 4: Run.** Expected: PASS, and `tests/tw-child-guard-bridge.test.ts` still passes.
- [ ] **Step 5: Commit.** `feat(subagents): a switched-off core tool is refused in children too, even under bypass`

### Task 6: Settings UI: new rows and one switch per page

**Files:**
- Create: `src/renderer/src/components/FamilySwitch.tsx`
- Create: `src/renderer/src/toolSwitches.ts` (pure data plus `allToolsOff`, renderer-safe: imports only `hv-builtins.ts`)
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` (rows: MCP, Sub-agents — 4 tools with nested Workflows — 1 tool, Skills, Core tools — 7 tools; the all-off line)
- Modify: `src/renderer/src/components/McpView.tsx`, `SkillsView.tsx`, `AgentsView.tsx` (`<FamilySwitch family=… />` under the `<h1>` subtitle)
- Test: create `tests/tool-switches-ui.test.ts`

**Interfaces:**
- Consumes: `Builtins` type (Task 2), `window.hv.builtinsGet/builtinsSet`, `CORE_TOOLS`/`coreToolNames` (Task 2)
- Produces:
  - `export const FAMILY_SWITCHES = { mcp: { label: "MCP", off: "MCP is off — no server starts in any session. Your servers are kept." }, subagents: { label: "Sub-agents — 4 tools", off: "Sub-agents are off — the agent can't delegate." }, skills: { label: "Skills", off: "Skills are off — no skill loads in any session." } } as const`
  - `export function allToolsOff(b: Builtins, shell: "bash" | "powershell"): boolean`, true iff every family key, every HappyVibe tool key (plan, askUser, terminal, browser, web, document, memory, schedules) is false AND `coreOff` covers `coreToolNames(shell)`
  - `export const ALL_OFF_COPY = "The agent can only chat — it has no tools."`
  - `<FamilySwitch family: "mcp" | "subagents" | "skills" />`: reads `builtinsGet`, writes `builtinsSet({[family]: on})`, renders the label, the `TogglePill`, `RESPAWN_NOTE`, and the `off` sentence while off

- [ ] **Step 1: Failing tests** (data plus source scan, no DOM):

```ts
import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { allToolsOff, ALL_OFF_COPY } from "../src/renderer/src/toolSwitches";

const src = (f: string) => fs.readFileSync(`src/renderer/src/components/${f}`, "utf8");
const everythingOff = { plan: false, askUser: false, planAppend: "", terminal: false, intent: false, browser: false, web: false, document: false, memory: false, memoryAppend: "", schedules: false, mcp: false, subagents: false, workflows: false, skills: false, coreOff: ["read", "bash", "edit", "write", "grep", "find", "ls"] };

describe("round 26 UI contract", () => {
  test("all off is detected per shell", () => {
    expect(allToolsOff(everythingOff as never, "bash")).toBe(true);
    expect(allToolsOff(everythingOff as never, "powershell")).toBe(false); // powershell still on
    expect(allToolsOff({ ...everythingOff, skills: true } as never, "bash")).toBe(false);
  });
  test("MCP, Skills and Agents pages carry the switch; Prompts does NOT", () => {
    for (const f of ["McpView.tsx", "SkillsView.tsx", "AgentsView.tsx"]) expect(src(f)).toMatch(/<FamilySwitch family=/);
    expect(src("PromptTemplatesView.tsx")).not.toMatch(/FamilySwitch/);
  });
  test("Built-in tools renders the all-off line from the shared constant", () => {
    expect(src("BuiltinToolsBlock.tsx")).toMatch(/ALL_OFF_COPY/);
    expect(ALL_OFF_COPY).toBe("The agent can only chat — it has no tools.");
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Rows follow `SchedulesRow`'s shape (bold label, one-line description, `RESPAWN_NOTE`, `TogglePill`). The Workflows row sits indented under Sub-agents, `disabled` while Sub-agents is off, and its description says it's about 5.5k tokens per request.
  - Core tools row: one `TogglePill` per name from `coreToolNames(window.hv.agentShell ?? "bash")`. If the renderer has no shell value, add `agentShell` to the `builtinsGet` payload from main (`platform.agentShell().shell`) rather than guessing from the OS. Toggling writes the whole `coreOff` array.
  - Above the rows: `{allToolsOff(builtins, shell) && <p className="px-4 py-2 text-sm font-semibold">{ALL_OFF_COPY}</p>}`.
  - `FamilySwitch` on the three pages, directly under the page subtitle.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(settings): Built-in tools switches MCP, sub-agents, workflows, skills and each core tool; each family page carries its own switch`

### Task 7: Docs and rules, current-state

**Files:**
- Modify: `docs/guide/src/content/docs/built-in-tools.md` (the five new rows, the all-off line, children follow core switches)
- Modify: `docs/guide/src/content/docs/mcp.md`, `docs/guide/src/content/docs/agent-tools.md` (one sentence each: the switch on top / switched-off tools disappear from this list)
- Modify: `CLAUDE.md` Architecture bullet "Chat sessions load `builtin:mcp` + `builtin:tool-search`" → append "unless the MCP switch is off"
- Modify: `.claude/rules/subagents.md` "Gating" (one line: the child guard refuses `coreOff` tools before the boundary, under bypass too)
- Modify: `docs/validation/d1.md` (wire note: `--exclude-tools` removes names from `getAllTools()`, pinned by `builtins-contract.test.ts`)

- [ ] **Step 1:** Write the edits.
- [ ] **Step 2:** Run the `docs-reviewer` agent on the three guide pages and fix what it finds.
- [ ] **Step 3: Commit.** `docs: tool switches in the guide, rules and wire notes`

### Task 8: Gate, live, GUI

- [ ] `npm run gate`, redirected to a log, and read `EXIT`.
- [ ] Commit, then `npm run live:why`. If it prints anything: symlink `.env` (`ln -s ~/Documents/Github/HappyVibe/.env .env`), check `pgrep -fl electron-vite`, then `npm run test:live` with `run_in_background`. If it prints nothing, say the live batch isn't required.
- [ ] GUI pass with the assertions below (`/uicheck`, attach on 9333).

## GUI verification: what must be TRUE on screen

Run on a fresh `npm run dev` from this worktree, with one workspace and one open chat session.

**Built-in tools page (Settings → Abilities → Built-in tools)**
1. Five new rows: **MCP**, **Sub-agents — 4 tools**, **Workflows — 1 tool** (indented under Sub-agents), **Skills**, **Core tools — 7 tools** with seven switches labelled `read bash edit write grep find ls`. All are on by default.
2. Turn Sub-agents off: the Workflows switch greys out and can't be toggled.
3. **Absence:** there is **no "Prompts" row**, and the Prompts page has no master switch at its top.
4. Turn every switch off: the line *"The agent can only chat — it has no tools."* appears. Turn any one back on: the line disappears.

**Agent tools page (Settings → Control → Agent tools), observed after each change, with the session respawned**
5. Turn `bash` off: **`bash` is absent** from the list; `read` is still there.
6. Turn Workflows off with Sub-agents on: **`SubagentWorkflow` is absent**; `Agent`, `get_subagent_result` and `steer_subagent` are present.
7. Turn Sub-agents off: **all four sub-agent tools are absent**.
8. Turn Skills off: **`use_skill` is absent**. Turn MCP off: **`tool_search` is absent**.
9. **Schedules bug:** turn Schedules off: **`schedule_list` is absent**. Before this round it stayed listed.

**MCP / Skills / Agents pages**
10. Each shows the switch under its subtitle. Turning MCP off **on the MCP page** makes the MCP row on Built-in tools read off when you navigate there (one setting, two places). Server cards stay listed, and the off sentence shows.

**Chat**
11. With `bash` off, ask "run `ls` with bash": no bash card appears. With sub-agents on and an agent file without `tools:`, ask it to delegate a bash command: the child's card shows a refusal naming `switched off 'bash'`, and **no permission prompt opens**.
12. With sub-agents off, the context panel's system prompt drill-in has no "Available subagents" block.

**Regression sequence (the respawn path)**
13. Open two sessions. Turn MCP off and wait for both to respawn (restart note). Turn MCP back on, then open a third session. All three list `tool_search` on Agent tools, and the first two still show their earlier transcripts.

## Skipped (YAGNI)

- No per-workspace tier: decision 4.
- The MCP page's workspace probe still runs while MCP is off. The banner says MCP is off; add a skip only if the probe proves costly.
