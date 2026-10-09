# Onboarding Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first-run dialog ends on a "kit" beat that shows every tool family, bundled skill, agent and prompt with what it weighs, lets the user untick any of it, opens on *Just the basics* for a small model, and hands over on **Start my first session** instead of a 2.2 s timer.

**Architecture:** A generator boots a key-free Pi (faux model, the app's real spawn args) once all-on and once per switch off, and writes per-family token weights to `src/main/toolWeights.generated.ts` (import-free, so the renderer reads it). One copy record in `toolSwitches.ts` gives every family its name and *"Lets the agent…"* sentence to both Built-in tools and the kit. The kit's logic is pure functions in `onboarding.ts` (no DOM in the suite); `OnboardingKit.tsx` renders it; `App.tsx` loads the lists, writes the small-model preset at open and the whole draft on Start.

**Tech Stack:** Electron + React 19 + TypeScript 7, Tailwind v4, vitest (no DOM), Pi 1.0.2 over RPC, `jiti` for the generator.

**Spec:** Notion "Onboarding improvements" (page `3f1d33dfffca8036965ec56c6859e82d`, locked 2026-10-09); `docs/prd.md` §22 and §13, both *Decision (Onboarding kit round, 2026-10-09)*.

## Global Constraints

- Headline **"Your agent comes fully loaded."** under the existing **"You're in."**; subline **"Untick anything you don't want."**
- Consent line, verbatim: **"Anything that changes your files or runs a command asks you first."**
- Footer, verbatim: **"Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each."**
- Third notice, verbatim: **"Want your agent to reach GitHub, Linear or Notion? Add a plugin or an MCP server — a few clicks."**, linking to **Plugins**, at the first-run session's **second** turn end.
- Buttons: **Start my first session** (primary), **Just the basics** (secondary), **Load everything anyway** (link, small-model case only).
- A family tick only where Built-in tools has a family switch. **Core tools** and **Prompts**: per-item ticks only, never a family tick. MCP and `intent` are never tiles.
- *Just the basics* = every kit family switch off (`plan askUser terminal browser web memory schedules document images subagents workflows skills`). It never touches `mcp`, `intent`, `coreOff` or any per-item state.
- Small-model preset when `fullTotal > window / 4`. Too-small line when `window <= compactionReserve` (Pi's `DEFAULT_COMPACTION_SETTINGS.reserveTokens`, read by the generator, never typed). Unknown window ⇒ full kit, no lines.
- Weights are characters ÷ 4 (the gauge's unit), shown via the existing `fmtNum` (`analytics-format.ts`), never typed anywhere.
- Writes: once on Start (one `builtinsSet` + per-item disables), plus the basics preset written once when the kit opens on a small model. Never per click.
- **Esc = Start.** No ✕ in the kit beat. No timer.
- Analytics: `onboarding_completed` gains `kit: "full" | "basics" | "custom"` and `smallModel: bool`. No `familiesOff`.
- Commits: `git commit -s`. Never run `npm run lint` / `npm run format`. Test runs are redirected, never piped: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- Copy that describes a gate is derived from the gate (§20); every new ONBOARDING_COPY key needs a call site (no-dead-copy test).

## Review Focus

1. **The window is unknown, zero or missing right after step 1** (provider just connected, `listModels` has no `contextWindow`): the kit must open fully loaded with no small-model line, never basics on a guess. Test: Task 3 `kitPreset(null|0, …) === "full"`.
2. **The window is smaller than the basics themselves** (a 2,048-token runner): the too-small line must not say "about 130% of it". Test: Task 3 `tooSmallLine` for `basics > window`.
3. **Skills family unticked after some skills were unticked individually**: the total must not subtract those skills twice (same for agents under Sub-agents, and Workflows under an unticked Sub-agents). Test: Task 3 `kitTotal` cases.
4. **Windows without Git Bash**: the core item is `powershell`, which the weights file keys as `bash`; unticking it must still subtract the shell's weight. Test: Task 3 `kitTotal` with `coreOff: ["powershell"]`.
5. **Start pressed twice, or Esc then Start**: one write batch, one session. Test: Task 4 source scan for the `starting` guard; GUI regression sequence R3.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `tools/tool-weights/measure.ts` | create | Boot one faux Pi with the real spawn args for a given switch variant; return chars |
| `tools/tool-weights/build.ts` | create | Run every variant, compute token deltas, write the generated file |
| `src/main/toolWeights.generated.ts` | create (generated) | `TOOL_WEIGHTS` — import-free data the renderer reads |
| `tests/tool-weights.test.ts` | create | Re-derive check: one all-on boot vs the file |
| `package.json` | modify | `catalog:tool-weights` script |
| `CLAUDE.md` | modify | Generated-files table row; import-free list |
| `docs/validation/kit1.md` | create | Measured figures + GUI-pass findings |
| `src/renderer/src/toolSwitches.ts` | modify | `FAMILY_COPY`, `KIT_FAMILIES`, `weightLabel`, `BUNDLED_NOTE` |
| `src/renderer/src/imagePrompt.ts` | modify | `IMAGES_ROW_COPY.on` composes from `FAMILY_COPY.images.what` |
| `src/renderer/src/components/BuiltinToolsBlock.tsx` | modify | Rows read `FAMILY_COPY` and show their weight; Workflows' typed figure goes |
| `src/renderer/src/components/FamilySwitch.tsx` | modify | Weight under the switch (Sub-agents/Skills with the bundled note; MCP none) |
| `tests/family-copy.test.ts` | create | Record ⇄ rows, order, Workflows claim, no typed weights |
| `src/renderer/src/onboarding.ts` | modify | Kit copy + pure kit logic |
| `tests/onboarding-kit.test.ts` | create | Kit logic, copy derivations, consent and footer pins |
| `src/renderer/src/components/OnboardingKit.tsx` | create | Tiles, expanders, totals, lines, buttons |
| `src/renderer/src/components/OnboardingDialog.tsx` | modify | Kit hosts the celebration beat; Start/Esc; no timer; analytics |
| `src/main/usage/events.ts` | modify | `onboarding_completed` params |
| `src/renderer/src/usageUi.ts` | modify | Comment on the now-unreachable `handover` dismissal |
| `tests/onboarding.test.ts` | modify | Timer test → Start test; notices; dead copy |
| `src/renderer/src/App.tsx` | modify | Window re-read, kit data, preset write, Start writes, third notice |
| `src/renderer/src/components/Transcript.tsx` | modify | Notice item gains optional `goTo` |
| `docs/guide/src/content/docs/{first-launch,first-session,connect-a-model,built-in-tools}.md` | modify | Guide, same commit as the screens |

---

### Task 1: Tool-weights generator, generated file, re-derive test

**Files:**
- Create: `tools/tool-weights/measure.ts`, `tools/tool-weights/build.ts`, `src/main/toolWeights.generated.ts`, `tests/tool-weights.test.ts`, `docs/validation/kit1.md`
- Modify: `package.json` (scripts), `CLAUDE.md` (generated-files table; "Anything the renderer imports" list)

**Interfaces:**
- Produces: `TOOL_WEIGHTS` (below) and `type WeightedFamily = keyof typeof TOOL_WEIGHTS.families`, `type CoreTool = keyof typeof TOOL_WEIGHTS.core`.
- Produces: `measure(v?: Variant): Promise<Measurement>` from `tools/tool-weights/measure.ts`.

Background the implementer needs:
- Pattern to copy: `tests/mcp-builtin-gate.test.ts` `boot()` — `resolvePiSpawn(...)`, then insert `-e tests/fixtures/faux-model.ts` just before the bridge's `-e`, add `--no-session --provider faux --model script`, env `HV_TEST_RUNTIME` + `HV_FAUX_STEPS`.
- The bridge computes `systemBlock` in `before_agent_start` (`happyvibe-bridge.ts:899-918`), so one model turn must run first; then the `/hv-context` command (sent as a `prompt`) notifies `{"kind":"hv.context","stage":"snapshot","system":{chars,toolDefs,...}}`. Per-request weight = `system.chars + Σ toolDefs[].chars`.
- Real spawn inputs a fresh install has (mirror `spawnOpts` in `ipc.ts:1022-1094`): `builtinTools` (defaults: `parseBuiltins(undefined)` in `hv-builtins.ts:107` plus `images: true`), memory dirs (empty temp dirs), bundled skills (`scanSkillsDir(bundledSkillsDir(runtime), "bundled")` → `--skill` ids + `buildManifest` → `skillsFile`), bundled prompts (`pi-runtime/prompts/*.md`), bundled agents copied into `<agentDir>/agents/`, `mcp: true`, `agentShell: "bash"`.
- Images register on `imageModel` alone (`spawn.ts:130`, `ipc.ts:1084`): pass `resolveImageModel(IMAGE_MODELS, undefined)`.
- Pi's system prompt contains the cwd and install paths, so absolute figures differ by machine by a few dozen tokens. Deltas mostly cancel; the test compares with a tolerance.

- [ ] **Step 1: Write `tools/tool-weights/measure.ts`**

```ts
/**
 * One key-free Pi, the app's REAL spawn arguments, a scripted model: how many
 * characters every request carries (system prompt + tool definitions).
 * Shared by the generator (build.ts) and the re-derive test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiClient } from "../../src/main/pi/PiClient.ts";
import { resolvePiSpawn } from "../../src/main/pi/spawn.ts";
import { bundledSkillsDir, buildManifest } from "../../src/main/skills/index.ts";
import { scanSkillsDir } from "../../src/main/skills/discovery.ts";
import { parseBuiltins } from "../../pi-runtime/extensions/hv-builtins.ts";
import { resolveImageModel } from "../../pi-runtime/extensions/hv-images.ts";
import { IMAGE_MODELS } from "../../src/main/providerCatalog.generated.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNTIME = path.join(ROOT, "pi-runtime");

export type Switches = ReturnType<typeof parseBuiltins>;
export interface Variant { builtins?: Partial<Switches>; images?: boolean }
export interface Measurement { piVersion: string; totalChars: number; toolChars: Record<string, number> }

export function piVersion(): string {
  const pkg = path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/package.json");
  return (JSON.parse(fs.readFileSync(pkg, "utf8")) as { version: string }).version;
}

export async function measure(v: Variant = {}): Promise<Measurement> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-weights-"));
  const agentDir = path.join(tmp, "agent");
  const ws = path.join(tmp, "ws");
  for (const d of [agentDir, ws, path.join(agentDir, "agents"), path.join(tmp, "mem-g"), path.join(tmp, "mem-w")]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(path.join(RUNTIME, "agents")).filter((n) => n.endsWith(".md"))) {
    fs.copyFileSync(path.join(RUNTIME, "agents", f), path.join(agentDir, "agents", f));
  }
  const builtins = { ...parseBuiltins(undefined), ...v.builtins };
  const skills = builtins.skills ? scanSkillsDir(bundledSkillsDir(RUNTIME), "bundled").filter((s) => s.loadable) : [];
  const skillsFile = path.join(tmp, "skills.json");
  fs.writeFileSync(skillsFile, JSON.stringify(buildManifest(skills.map((skill) => ({ skill, scope: "global" as const })))));
  const prompts = fs.readdirSync(path.join(RUNTIME, "prompts")).filter((n) => n.endsWith(".md")).map((n) => path.join(RUNTIME, "prompts", n));

  const spec = resolvePiSpawn(ws, path.join(tmp, "sessions"), RUNTIME, {
    mcp: true, agentDir, agentShell: "bash", builtinTools: builtins,
    memoryGlobalDir: builtins.memory ? path.join(tmp, "mem-g") : undefined,
    memoryWorkspaceDir: builtins.memory ? path.join(tmp, "mem-w") : undefined,
    skills: skills.map((s) => s.id), skillsFile, promptTemplates: prompts,
    imageModel: v.images ? resolveImageModel(IMAGE_MODELS, undefined) ?? undefined : undefined,
  });
  const bridge = spec.args.findIndex((a) => a.endsWith("happyvibe-bridge.ts"));
  const args = [...spec.args.slice(0, bridge - 1), "-e", path.join(ROOT, "tests/fixtures/faux-model.ts"), ...spec.args.slice(bridge - 1),
    "--no-session", "--provider", "faux", "--model", "script"];
  const client = new PiClient({ ...spec, execPath: process.execPath, args,
    env: { ...spec.env, HOME: tmp, HV_TEST_RUNTIME: RUNTIME, HV_FAUX_STEPS: JSON.stringify([{ text: "ok" }]) } as Record<string, string> });
  try {
    const ended = new Promise<void>((r) => client.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
    const snapshot = new Promise<{ chars: number; toolDefs: { name: string; chars: number }[] }>((r) =>
      client.on("ui-request", (m: { method?: string; message?: string }) => {
        if (m.method !== "notify") return;
        try {
          const p = JSON.parse(m.message ?? "") as { kind?: string; stage?: string; system?: { chars: number; toolDefs?: { name: string; chars: number }[] } };
          if (p.kind === "hv.context" && p.stage === "snapshot" && p.system) r({ chars: p.system.chars, toolDefs: p.system.toolDefs ?? [] });
        } catch { /* not ours */ }
      }));
    await client.start();
    await client.send({ type: "prompt", message: "go" });
    await ended;
    await client.send({ type: "prompt", message: "/hv-context" });
    const s = await snapshot;
    const toolChars = Object.fromEntries(s.toolDefs.map((t) => [t.name, t.chars]));
    return { piVersion: piVersion(), totalChars: s.chars + s.toolDefs.reduce((n, t) => n + t.chars, 0), toolChars };
  } finally {
    client.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
```

If an import above is not vitest/jiti-importable (reaches `electron`), stop and report which one — do not stub `electron`.

- [ ] **Step 2: Write `tools/tool-weights/build.ts`**

```ts
/**
 * Generates src/main/toolWeights.generated.ts — what each tool family adds to
 * EVERY request, measured on a key-free Pi with the app's real spawn args.
 * Run: npm run catalog:tool-weights. Re-run on a Pi bump or any change to a
 * tool's schema, description or prompt line (tests/tool-weights.test.ts says when).
 *
 * Each family = (reference) − (reference with that family off), so the prompt
 * text a family adds is counted with its schemas. Workflows and Images are off
 * in the reference (Workflows ships off; Images needs OpenRouter), so they are
 * measured the other way round. Ask user can't go off while Plan is on, so it
 * is measured with Plan off.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measure, piVersion, RUNTIME, type Variant } from "./measure.ts";
import { CORE_TOOLS } from "../../pi-runtime/extensions/hv-builtins.ts";

const tok = (chars: number): number => Math.round(chars / 4);
const total = async (v: Variant = {}): Promise<number> => (await measure(v)).totalChars;

const ref = await measure();
const minus = async (v: Variant): Promise<number> => tok(ref.totalChars - (await total(v)));
const plus = async (v: Variant): Promise<number> => tok((await total(v)) - ref.totalChars);

const families: Record<string, number> = {};
for (const k of ["plan", "terminal", "browser", "web", "document", "memory", "schedules", "subagents", "skills", "intent", "mcp"] as const) {
  families[k] = await minus({ builtins: { [k]: false } });
  console.log(k, families[k]);
}
const planOff = await total({ builtins: { plan: false } });
families.askUser = tok(planOff - (await total({ builtins: { plan: false, askUser: false } })));
families.workflows = await plus({ builtins: { workflows: true } });
families.images = await plus({ images: true });

const core: Record<string, number> = {};
for (const t of CORE_TOOLS) core[t] = await minus({ builtins: { coreOff: [t] } });

const pi = await import(pathToFileURL(path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
const reserve = (pi.DEFAULT_COMPACTION_SETTINGS as { reserveTokens: number }).reserveTokens;

if (families.mcp !== 0) {
  // §13/§22: MCP is not a kit tile because it weighs nothing until a server exists.
  throw new Error(`MCP with no server weighs ${families.mcp} tokens — the kit's "MCP is not a tile" decision needs revisiting. Stop and report.`);
}

const out = `// GENERATED by \`npm run catalog:tool-weights\` (tools/tool-weights/build.ts). Do not edit.
// Tokens = characters ÷ 4, the context gauge's unit. Import-free: the renderer reads it.
export const TOOL_WEIGHTS = ${JSON.stringify({
  pi: piVersion(),
  compactionReserve: reserve,
  total: tok(ref.totalChars),
  families,
  core,
  tools: ref.toolChars,
}, null, 2)} as const;

export type WeightedFamily = keyof typeof TOOL_WEIGHTS.families;
export type CoreTool = keyof typeof TOOL_WEIGHTS.core;
`;
fs.writeFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/main/toolWeights.generated.ts"), out);
console.log("wrote src/main/toolWeights.generated.ts");
```

Note `bash` off also switches `powershell` off (`normalizeCoreOff`); that is the right figure for "the shell".

- [ ] **Step 3: Add the script and run it**

In `package.json` scripts, beside `catalog:providers`:
```json
"catalog:tool-weights": "node --experimental-strip-types --import jiti/register tools/tool-weights/build.ts",
```
Run: `npm run catalog:tool-weights > /tmp/weights.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/weights.log`
Expected: `EXIT=0`, `wrote src/main/toolWeights.generated.ts`, 15+ boots in roughly 1–2 minutes. Open the file and sanity-check: `core` sums to ≈1,187 (measured 2026-10-09 from Pi's own definitions, schema only — the delta is a little higher because Pi's prompt lists each tool), `workflows` ≈5.5k, `browser` ≈1.1k, `mcp` 0. If `mcp` threw, STOP and report to the user.

- [ ] **Step 4: Write the re-derive test `tests/tool-weights.test.ts`**

```ts
// The weights the kit and Built-in tools show are measured, never typed (PRD §13, §22
// Decision 2026-10-09). This boots ONE all-on key-free Pi and fails when the file is stale.
import { expect, test } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TOOL_WEIGHTS } from "../src/main/toolWeights.generated";
import { measure, piVersion, RUNTIME } from "../tools/tool-weights/measure";

const near = (a: number, b: number, pct: number): boolean => Math.abs(a - b) <= Math.max(10, (b * pct) / 100);
const STALE = "stale — run `npm run catalog:tool-weights`";

test("the weights file matches the pinned Pi", async () => {
  expect(TOOL_WEIGHTS.pi, STALE).toBe(piVersion());
  const pi = await import(pathToFileURL(path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
  expect(TOOL_WEIGHTS.compactionReserve, STALE).toBe(pi.DEFAULT_COMPACTION_SETTINGS.reserveTokens);
});

test("an all-on session still declares the tools, sizes and total the file says", async () => {
  const m = await measure();
  const shells = new Set(["bash", "powershell"]);
  const names = (o: Record<string, number>): string[] => Object.keys(o).filter((n) => !shells.has(n)).sort();
  // A tool added or removed anywhere (bridge, Pi, tintinweb) changes this list.
  expect(names(m.toolChars), STALE).toEqual(names(TOOL_WEIGHTS.tools));
  for (const [name, chars] of Object.entries(TOOL_WEIGHTS.tools)) {
    if (name in m.toolChars) expect(near(m.toolChars[name], chars, 2), `${name}: ${STALE}`).toBe(true);
  }
  // Absolute total carries cwd/install paths, which differ by machine.
  expect(near(Math.round(m.totalChars / 4), TOOL_WEIGHTS.total, 3), `total: ${STALE}`).toBe(true);
}, 90_000);

test("MCP with no server weighs nothing — why it is not a kit tile", () => {
  expect(TOOL_WEIGHTS.families.mcp).toBe(0);
});
```

- [ ] **Step 5: Run it**

Run: `L=/tmp/vitest.log; npx vitest run tests/tool-weights.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: 3 passed. Then edit one bridge tool description by a sentence locally, re-run, confirm it FAILS with the STALE message, and revert the edit.

- [ ] **Step 6: Register it in `CLAUDE.md`**

Add to the generated-files table:
```
| `src/main/toolWeights.generated.ts` | `npm run catalog:tool-weights` | a Pi pin bump, or any change to a tool's schema, description or prompt line |
```
Add `toolWeights.generated.ts` to the "Anything the renderer imports must not reach Node" list of import-free files.

- [ ] **Step 7: Record the evidence in `docs/validation/kit1.md`**

A short page: date, Pi version, every figure from the generated file, the 1,187-token core-tool schema measurement, Pi's 16,384 reserve and `shouldCompact` rule (`window − reserve`), the quarter-vs-reserve comparison at 4k/8k/32k/64k/128k (both rules pick basics at 4k/8k/32k and full at 64k/128k), and `mcp = 0`.

- [ ] **Step 8: Commit**

```bash
git add tools/tool-weights src/main/toolWeights.generated.ts tests/tool-weights.test.ts package.json CLAUDE.md docs/validation/kit1.md
git commit -s -m "feat(§13): tool weights measured on a key-free Pi, generated and re-checked"
```

---

### Task 2: One copy record for the families; weights on Built-in tools

**Files:**
- Modify: `src/renderer/src/toolSwitches.ts`, `src/renderer/src/imagePrompt.ts`, `src/renderer/src/components/BuiltinToolsBlock.tsx`, `src/renderer/src/components/FamilySwitch.tsx`
- Create: `tests/family-copy.test.ts`

**Interfaces:**
- Consumes: `TOOL_WEIGHTS`, `WeightedFamily` (Task 1).
- Produces (all from `toolSwitches.ts`):
  - `type KitFamily = "plan" | "askUser" | "terminal" | "browser" | "web" | "memory" | "schedules" | "document" | "images" | "subagents" | "workflows" | "skills"`
  - `const KIT_FAMILIES: readonly KitFamily[]` — Built-in tools' row order.
  - `const FAMILY_COPY: Record<KitFamily | "intent" | "mcp" | "core", { label: string; what: string }>`
  - `function weightLabel(tokens: number): string` → `"~1.1k tokens"`
  - `const BUNDLED_NOTE = "with the bundled ones on"`

- [ ] **Step 1: Write the failing test `tests/family-copy.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAMILY_COPY, FAMILY_SWITCHES, KIT_FAMILIES, weightLabel } from "../src/renderer/src/toolSwitches";
import { IMAGES_ROW_COPY } from "../src/renderer/src/imagePrompt";
import { TOOL_WEIGHTS } from "../src/main/toolWeights.generated";

// Same helpers as tests/onboarding.test.ts — copied, because importing a test file re-runs its suites.
const flat = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "").replace(/\s+/g, " ");
const has = (src: string, needle: string): boolean => src.includes(needle);
const B = flat(fs.readFileSync(path.resolve(__dirname, "../src/renderer/src/components/BuiltinToolsBlock.tsx"), "utf8"));

describe("one record, two surfaces (PRD §13, Decision 2026-10-09)", () => {
  it("every Built-in tools row reads its sentence from FAMILY_COPY rather than retyping it", () => {
    for (const k of ["plan", "askUser", "terminal", "browser", "web", "memory", "schedules", "document", "workflows", "intent", "core"] as const) {
      expect(has(B, `FAMILY_COPY.${k}.what`), `${k} reads the record`).toBe(true);
      expect(has(B, FAMILY_COPY[k].what), `${k} retyped in the row`).toBe(false);
    }
    // The family switch rows and the Images row read it one hop away.
    for (const k of ["mcp", "subagents", "skills"] as const) {
      expect(FAMILY_SWITCHES[k].on, k).toBe(FAMILY_COPY[k].what);
      expect(FAMILY_SWITCHES[k].label, k).toBe(FAMILY_COPY[k].label);
    }
    expect(IMAGES_ROW_COPY.on.startsWith(FAMILY_COPY.images.what)).toBe(true);
  });

  it("the kit's order is the page's row order", () => {
    const rowOf: Record<string, string> = { plan: "<PlanModeRow", askUser: "<AskUserRow", terminal: "<TerminalRow", browser: "<BrowserRow", web: "<WebRow", memory: "<MemoryRow", schedules: "<SchedulesRow", document: "<DocumentsRow", images: "<ImagesRow", subagents: 'family="subagents"', workflows: "<WorkflowsRow", skills: 'family="skills"' };
    const at = KIT_FAMILIES.map((k) => B.indexOf(rowOf[k]));
    expect(at.every((i) => i >= 0), "every row found").toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("no row types a token figure any more", () => {
    expect(has(B, "about 5.5k"), "Workflows' typed figure").toBe(false);
    expect(/\b\d+(\.\d)?k tokens\b/.test(B), "any typed k-tokens").toBe(false);
  });

  it("'the heaviest tool the agent carries' is still true", () => {
    const f = TOOL_WEIGHTS.families as Record<string, number>;
    expect(Math.max(...Object.values(f))).toBe(f.workflows);
  });

  it("formats with the app's own formatter", () => {
    expect(weightLabel(1130)).toBe("~1.1k tokens");
    expect(weightLabel(365)).toBe("~365 tokens");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`FAMILY_COPY` not exported).

Run: `L=/tmp/vitest.log; npx vitest run tests/family-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement the record in `toolSwitches.ts`**

Add (keep `FAMILY_SWITCHES`, `RESPAWN_NOTE`, `ALL_OFF_COPY`, `toggleCore`, `allToolsOff` as they are, except `FAMILY_SWITCHES` now reads `label`/`on` from `FAMILY_COPY`):

```ts
import { DOCUMENT_FAMILY_LIST } from "../../../pi-runtime/extensions/hv-document";
import { fmtNum } from "./analytics-format";

/** §13 / §22 (Onboarding kit round, 2026-10-09): Built-in tools' families, in its row order — the kit's order too. */
export type KitFamily = "plan" | "askUser" | "terminal" | "browser" | "web" | "memory" | "schedules" | "document" | "images" | "subagents" | "workflows" | "skills";
export const KIT_FAMILIES: readonly KitFamily[] = ["plan", "askUser", "terminal", "browser", "web", "memory", "schedules", "document", "images", "subagents", "workflows", "skills"];

/**
 * Each family's row title and its first sentence, verbatim — read by the Built-in
 * tools rows AND the first-run kit, so the two can never describe a family differently.
 * A row keeps the rest of its copy after `what`.
 */
export const FAMILY_COPY: Record<KitFamily | "intent" | "mcp" | "core", { label: string; what: string }> = {
  plan: { label: "Plan mode", what: "Lets the agent draft and track a step-by-step plan before acting." },
  askUser: { label: "Ask user", what: "Lets the agent pause mid-turn to ask you a clarifying question." },
  terminal: { label: "Agent terminal — 3 tools", what: "Lets the agent run long-running commands in terminals you can watch, type into and stop." },
  browser: { label: "Agent browser — 10 tools", what: "Lets the agent open a page in a sandboxed browser tab, read it, screenshot it, click and type in it, and watch its console and network traffic." },
  web: { label: "Web tools — 4 tools", what: "Lets the agent search the web and read any public page as clean text, list a site's pages, or read a whole section of one." },
  memory: { label: "Memory — 3 tools", what: "Lets the agent remember durable facts about you and about each project, across sessions." },
  schedules: { label: "Schedules — 4 tools", what: "Lets the agent list this workspace's schedules and propose new ones." },
  document: { label: "Documents — 1 tool", what: `Lets the agent read ${DOCUMENT_FAMILY_LIST} files as Markdown, converted on this machine — nothing is sent anywhere.` },
  images: { label: "Images — 1 tool", what: "Lets the agent make an image and save it as a new file in your project." },
  subagents: { label: "Sub-agents — 4 tools", what: "Lets the agent delegate work to the agents on the Agents page." },
  workflows: { label: "Workflows — 1 tool", what: "Lets the agent run a scripted workflow of several sub-agents." },
  skills: { label: "Skills", what: "Lets the agent load the skills you turned on." },
  intent: { label: "Tool intent", what: "The one-line “why” the model writes for each tool card." },
  mcp: { label: "MCP", what: "Lets the agent use the tools of your MCP servers." },
  core: { label: "Core tools", what: "Pi's own tools for reading, searching and changing files and running commands." },
};

/** A family's weight in the app's own number format (chars ÷ 4, from the generated file). */
export function weightLabel(tokens: number): string {
  return `~${fmtNum(tokens)} tokens`;
}

/** Skills and Sub-agents grow with what you add; their measured figure is the shipped set. */
export const BUNDLED_NOTE = "with the bundled ones on";
```

and change `FAMILY_SWITCHES` entries to `label: FAMILY_COPY.mcp.label, on: FAMILY_COPY.mcp.what` (same for `subagents`, `skills`). In `imagePrompt.ts`, `IMAGES_ROW_COPY.on` becomes `` `${FAMILY_COPY.images.what} Each image costs money on your OpenRouter account. The prices below were measured once and are approximate; Session cost shows what OpenRouter actually charged.` `` (import `FAMILY_COPY` from `./toolSwitches`; `toolSwitches` must not import `imagePrompt`).

- [ ] **Step 4: Rows read the record and show their weight**

In `BuiltinToolsBlock.tsx`:
- Import `FAMILY_COPY, weightLabel, BUNDLED_NOTE` and `TOOL_WEIGHTS` (`../../../main/toolWeights.generated`).
- Add one tiny component used by every row, under the description:
  ```tsx
  function Weight({ tokens, note }: { tokens: number; note?: string }): React.JSX.Element {
    return <span className="text-xs text-ink-soft/80 block mt-0.5">{weightLabel(tokens)}{note ? ` ${note}` : ""}</span>;
  }
  ```
- Each row's title and first sentence come from `FAMILY_COPY.<k>.label` / `.what`; the rest of its existing copy follows unchanged. E.g. `SchedulesRow`: `{FAMILY_COPY.schedules.what} Creating, changing and deleting always open the drawer…`.
- `WorkflowsRow` copy becomes: `{FAMILY_COPY.workflows.what} It is the heaviest tool the agent carries, so turning it off keeps delegation and drops the cost. It is off until you turn it on.` plus `<Weight tokens={TOOL_WEIGHTS.families.workflows} />`.
- `CoreToolsRow`: `<Weight tokens={Object.values(TOOL_WEIGHTS.core).reduce((a, b) => a + b, 0)} />`.
- `IntentRow`: `<Weight tokens={TOOL_WEIGHTS.families.intent} />`.
- Keep `title="Agent terminal — 3 tools"` working (`tests/sidebar-groups.test.ts:265` asserts the literal) — pass `FAMILY_COPY.terminal.label` and update that test to accept the record (`expect(B).toContain('title={FAMILY_COPY.terminal.label}')` and assert the record's label is `"Agent terminal — 3 tools"`).

In `FamilySwitch.tsx` `FamilySwitchRow`: under the description, `family === "mcp" ? null : <span …>{weightLabel(TOOL_WEIGHTS.families[family])} {BUNDLED_NOTE}</span>` (both Sub-agents and Skills grow with what you add; MCP weighs nothing until a server exists).

- [ ] **Step 5: Run the tests**

Run: `L=/tmp/vitest.log; npx vitest run tests/family-copy.test.ts tests/sidebar-groups.test.ts tests/tool-switches-ui.test.ts tests/image-ui.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: all pass. Fix any existing assertion that pinned a moved literal by pointing it at the record, never by re-typing the literal in the row.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tc.log` — Expected `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/toolSwitches.ts src/renderer/src/imagePrompt.ts src/renderer/src/components/BuiltinToolsBlock.tsx src/renderer/src/components/FamilySwitch.tsx tests/family-copy.test.ts tests/sidebar-groups.test.ts
git commit -s -m "feat(§13): every Built-in tools row reads one shared sentence and shows what it weighs"
```

---

### Task 3: The kit's copy and pure logic

**Files:**
- Modify: `src/renderer/src/onboarding.ts`
- Create: `tests/onboarding-kit.test.ts`

**Interfaces:**
- Consumes: `KitFamily`, `KIT_FAMILIES` (Task 2); `TOOL_WEIGHTS` (Task 1); `coreToolNames` (`hv-builtins.ts`).
- Produces (from `onboarding.ts`):
  ```ts
  export type KitSwitches = Record<KitFamily, boolean> & { coreOff: string[] };
  export interface KitItem { id: string; name: string; tokens: number }   // prompts: tokens 0
  export interface KitItems { skills: KitItem[]; agents: KitItem[]; prompts: KitItem[]; imagesAvailable: boolean; core: string[] }
  export interface KitDraft { switches: KitSwitches; skillsOff: string[]; agentsOff: string[]; promptsOff: string[] }
  export interface KitTile { key: KitFamily | "core" | "prompts"; familyTick: boolean; items: "core" | "skills" | "agents" | "prompts" | null; nestedUnder: "subagents" | null }
  export const DEFAULT_SWITCHES: KitSwitches;
  export function basicsPatch(): Record<KitFamily, false>;
  export function setFamily(d: KitDraft, k: KitFamily, on: boolean): KitDraft;
  export function kitTotal(d: KitDraft, items: KitItems, w?: typeof TOOL_WEIGHTS): number;
  export function fullTotal(imagesAvailable: boolean, w?: typeof TOOL_WEIGHTS): number;
  export function basicsTotal(items: KitItems, w?: typeof TOOL_WEIGHTS): number;
  export function kitPreset(ctx: number | null, full: number): "full" | "basics";
  export function tooSmall(ctx: number | null, reserve?: number): boolean;
  export function smallModelLine(ctx: number, full: number): string;
  export function tooSmallLine(basics: number, ctx: number): string;
  export function kitShape(d: KitDraft): "full" | "basics" | "custom";
  export function kitTiles(imagesAvailable: boolean): KitTile[];
  export const KIT_SERVICES: readonly ["GitHub", "Linear", "Notion"];
  ```

- [ ] **Step 1: Write the failing test `tests/onboarding-kit.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  basicsPatch, basicsTotal, DEFAULT_SWITCHES, fullTotal, KIT_SERVICES, kitPreset, kitShape, kitTiles, kitTotal,
  ONBOARDING_COPY, setFamily, smallModelLine, tooSmall, tooSmallLine, type KitDraft, type KitItems,
} from "../src/renderer/src/onboarding";
import { KIT_FAMILIES } from "../src/renderer/src/toolSwitches";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import { DEFAULT_GIT_RULES } from "../src/main/gitRules";
import { PLUGIN_CATALOG } from "../src/main/plugins/catalog.generated";
import { MCP_CATALOG } from "../src/main/mcpCatalog";

const W = {
  pi: "x", compactionReserve: 16384, total: 10_000,
  families: { plan: 600, askUser: 365, terminal: 555, browser: 1130, web: 960, document: 200, memory: 985, schedules: 1300, images: 300, subagents: 2700, workflows: 5543, skills: 900, intent: 400, mcp: 0 },
  core: { read: 170, bash: 135, edit: 295, write: 105, grep: 260, find: 150, ls: 115 },
  tools: {},
} as const;
const items: KitItems = {
  skills: [{ id: "/s/a", name: "a", tokens: 100 }, { id: "/s/b", name: "b", tokens: 50 }],
  agents: [{ id: "x", name: "x", tokens: 40 }],
  prompts: [{ id: "/p/t", name: "t", tokens: 0 }],
  imagesAvailable: false,
  core: ["read", "bash", "edit", "write", "grep", "find", "ls"],
};
const full = (): KitDraft => ({ switches: { ...DEFAULT_SWITCHES, coreOff: [] }, skillsOff: [], agentsOff: [], promptsOff: [] });

describe("kitPreset — the quarter (checked against Pi's reserve, docs/validation/kit1.md)", () => {
  it("opens on basics when the full kit takes more than a quarter of the window", () => {
    expect(kitPreset(4096, 10_000)).toBe("basics");
    expect(kitPreset(32_768, 10_000)).toBe("basics");
    expect(kitPreset(131_072, 10_000)).toBe("full");
  });
  it("an unknown window counts as large — never basics on a guess", () => {
    expect(kitPreset(null, 10_000)).toBe("full");
    expect(kitPreset(0, 10_000)).toBe("full");
  });
});

describe("tooSmall — at or under Pi's compaction reserve", () => {
  it("is derived from the reserve, not typed", () => {
    expect(tooSmall(4096, 16384)).toBe(true);
    expect(tooSmall(16384, 16384)).toBe(true);
    expect(tooSmall(16385, 16384)).toBe(false);
    expect(tooSmall(null, 16384)).toBe(false);
  });
  it("never claims more than the whole window", () => {
    expect(tooSmallLine(2500, 4096)).toContain("about 61% of it");
    expect(tooSmallLine(3000, 2048)).not.toMatch(/\d{3}%/);
    expect(tooSmallLine(3000, 2048)).toContain("don't fit");
  });
  it("the small-model line carries both computed numbers", () => {
    expect(smallModelLine(4096, 9_800)).toBe("Your model reads 4,096 tokens at a time and the full kit takes about 9.8k, so you're starting with just the basics.");
  });
});

describe("kitTotal", () => {
  it("the default draft is the measured total", () => {
    expect(kitTotal(full(), items, W)).toBe(10_000);
    expect(fullTotal(false, W)).toBe(10_000);
    expect(fullTotal(true, W)).toBe(10_300);
  });
  it("unticking a family or an item subtracts exactly its weight", () => {
    expect(kitTotal(setFamily(full(), "browser", false), items, W)).toBe(10_000 - 1130);
    expect(kitTotal({ ...full(), skillsOff: ["/s/a"] }, items, W)).toBe(10_000 - 100);
    expect(kitTotal({ ...full(), promptsOff: ["/p/t"] }, items, W)).toBe(10_000);
  });
  it("a family off does not subtract its items a second time", () => {
    const d = { ...setFamily(full(), "skills", false), skillsOff: ["/s/a"] };
    expect(kitTotal(d, items, W)).toBe(10_000 - 900);
    const a = { ...setFamily(full(), "subagents", false), agentsOff: ["x"] };
    expect(kitTotal(a, items, W)).toBe(10_000 - 2700);
  });
  it("Workflows only counts while Sub-agents is on", () => {
    const on = setFamily(full(), "workflows", true);
    expect(kitTotal(on, items, W)).toBe(10_000 + 5543);
    expect(kitTotal(setFamily(on, "subagents", false), items, W)).toBe(10_000 - 2700);
  });
  it("Images only counts with an OpenRouter credential", () => {
    expect(kitTotal(full(), { ...items, imagesAvailable: true }, W)).toBe(10_300);
  });
  it("the Windows shell is the same weight as bash", () => {
    expect(kitTotal({ ...full(), switches: { ...full().switches, coreOff: ["powershell"] } }, { ...items, core: ["read", "powershell"] }, W)).toBe(10_000 - 135);
    expect(kitTotal({ ...full(), switches: { ...full().switches, coreOff: ["bash", "powershell"] } }, items, W)).toBe(10_000 - 135);
  });
  it("basics keeps the core tools and every prompt", () => {
    const sum = Object.values(W.families).reduce((a, b) => a + b, 0) - W.families.workflows - W.families.images - W.families.intent - W.families.mcp;
    expect(basicsTotal(items, W)).toBe(10_000 - sum);
  });
});

describe("setFamily keeps Plan's dependency", () => {
  it("Ask user can't go off while Plan is on, and Plan back on forces it on", () => {
    expect(setFamily(full(), "askUser", false).switches.askUser).toBe(true);
    const noPlan = setFamily(setFamily(full(), "plan", false), "askUser", false);
    expect(noPlan.switches.askUser).toBe(false);
    expect(setFamily(noPlan, "plan", true).switches.askUser).toBe(true);
  });
});

describe("basics and shape", () => {
  it("basics switches every kit family off and nothing else", () => {
    expect(Object.keys(basicsPatch()).sort()).toEqual([...KIT_FAMILIES].sort());
    expect(Object.values(basicsPatch()).every((v) => v === false)).toBe(true);
    expect("mcp" in basicsPatch() || "intent" in basicsPatch() || "coreOff" in basicsPatch()).toBe(false);
  });
  it("names what was chosen, for §39", () => {
    expect(kitShape(full())).toBe("full");
    expect(kitShape({ ...full(), switches: { ...full().switches, ...basicsPatch() } })).toBe("basics");
    expect(kitShape(setFamily(full(), "web", false))).toBe("custom");
    expect(kitShape({ ...full(), promptsOff: ["/p/t"] })).toBe("custom");
  });
});

describe("kitTiles", () => {
  it("only switches the app already has: no family tick on Core tools or Prompts, no MCP, no intent", () => {
    const t = kitTiles(false);
    expect(t.find((x) => x.key === "core")).toMatchObject({ familyTick: false, items: "core" });
    expect(t.find((x) => x.key === "prompts")).toMatchObject({ familyTick: false, items: "prompts" });
    expect(t.map((x) => x.key)).not.toContain("mcp");
    expect(t.map((x) => x.key)).not.toContain("intent");
    expect(t.map((x) => x.key)).not.toContain("images");
    expect(kitTiles(true).map((x) => x.key)).toContain("images");
    expect(t.find((x) => x.key === "workflows")?.nestedUnder).toBe("subagents");
  });
  it("follows Built-in tools' order, then Core tools, then Prompts", () => {
    expect(kitTiles(true).map((x) => x.key)).toEqual([...KIT_FAMILIES, "core", "prompts"]);
  });
});

describe("copy derived from the gate", () => {
  it("the consent line holds: changing files and running commands are never safe-allowed, and no seed rule allows", () => {
    for (const t of ["write", "edit", "bash", "powershell", "terminal_run"]) expect(SAFE_TOOLS.has(t), t).toBe(false);
    expect(DEFAULT_GIT_RULES.some((r) => r.action === "allow")).toBe(false);
    expect(ONBOARDING_COPY.kitConsent).toBe("Anything that changes your files or runs a command asks you first.");
  });
  it("every service the footer and the notice name is in both catalogs", () => {
    for (const s of KIT_SERVICES) {
      expect(ONBOARDING_COPY.kitFooter.includes(s) && ONBOARDING_COPY.noticeExtend.includes(s), s).toBe(true);
      expect(PLUGIN_CATALOG.some((p) => p.name === s.toLowerCase()), `${s} plugin`).toBe(true);
      expect(MCP_CATALOG.some((m) => m.name === s), `${s} MCP`).toBe(true);
    }
  });
  it("the handover no longer promises a timer", () => {
    expect("doneBody" in ONBOARDING_COPY).toBe(false);
  });
});
```

If `src/main/gitRules.ts` cannot be imported under vitest, source-scan it instead (`!/action: "allow"/.test(src)`).

- [ ] **Step 2: Run it — expect FAIL** (exports missing).

Run: `L=/tmp/vitest.log; npx vitest run tests/onboarding-kit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 3: Implement in `onboarding.ts`**

Copy additions to `ONBOARDING_COPY` (delete `doneBody`):
```ts
  kitHeadline: "Your agent comes fully loaded.",
  kitSubline: "Untick anything you don't want.",
  // + the page names, rendered from GOTO_LABELS (builtinTools, skills, agents, promptTemplates), never typed here.
  kitLaterLead: "You can change all of it later on",
  kitConsent: "Anything that changes your files or runs a command asks you first.",
  kitFooter: "Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each.",
  kitStart: "Start my first session",
  kitBasics: "Just the basics",
  kitLoadAll: "Load everything anyway",
  kitTotalTail: "tokens on every message",
  kitPrompts: "Ready-made prompts you start with /. They weigh nothing until you use one.",
  kitMoreRoom: "Give your model more room ↗",
  noticeExtend: "Want your agent to reach GitHub, Linear or Notion? Add a plugin or an MCP server — a few clicks.",
```

Logic (imports: `TOOL_WEIGHTS` from `../../main/toolWeights.generated`, `KIT_FAMILIES`/`KitFamily` from `./toolSwitches`, `fmtNum` from `./analytics-format`):
```ts
export const KIT_SERVICES = ["GitHub", "Linear", "Notion"] as const;

export type KitSwitches = Record<KitFamily, boolean> & { coreOff: string[] };
export interface KitItem { id: string; name: string; tokens: number }
export interface KitItems { skills: KitItem[]; agents: KitItem[]; prompts: KitItem[]; imagesAvailable: boolean; core: string[] }
export interface KitDraft { switches: KitSwitches; skillsOff: string[]; agentsOff: string[]; promptsOff: string[] }
export interface KitTile { key: KitFamily | "core" | "prompts"; familyTick: boolean; items: "core" | "skills" | "agents" | "prompts" | null; nestedUnder: "subagents" | null }
/** Structural, not `typeof TOOL_WEIGHTS` (whose `as const` literals would reject any other figures). */
type Weights = { total: number; compactionReserve: number; families: Record<string, number>; core: Record<string, number> };

/** A fresh install's switches (hv-builtins.ts parseBuiltins + images on): everything on but Workflows. */
export const DEFAULT_SWITCHES: KitSwitches = { plan: true, askUser: true, terminal: true, browser: true, web: true, memory: true, schedules: true, document: true, images: true, subagents: true, workflows: false, skills: true, coreOff: [] };

/** Just the basics: every kit family off. MCP, intent, core tools and items are never touched. */
export function basicsPatch(): Record<KitFamily, false> {
  return Object.fromEntries(KIT_FAMILIES.map((k) => [k, false])) as Record<KitFamily, false>;
}

/** Plan mode's prompt requires ask_user (Built-in tools locks it on the same way). */
export function setFamily(d: KitDraft, k: KitFamily, on: boolean): KitDraft {
  if (k === "askUser" && !on && d.switches.plan) return d;
  const s = { ...d.switches, [k]: on };
  if (k === "plan" && on) s.askUser = true;
  return { ...d, switches: s };
}

const SHELL: Record<string, string> = { powershell: "bash" };

/** Tokens on every message for this draft — the measured total, minus what is off, plus what is on that ships off. */
export function kitTotal(d: KitDraft, items: KitItems, w: Weights = TOOL_WEIGHTS): number {
  const s = d.switches;
  const f = w.families;
  let t = w.total;
  for (const k of KIT_FAMILIES) {
    if (k === "workflows" || k === "images") continue;
    if (!s[k]) t -= f[k];
  }
  if (s.subagents && s.workflows) t += f.workflows;
  if (items.imagesAvailable && s.images) t += f.images;
  // normalizeCoreOff stores BOTH shell names when either is off — count the shell once.
  for (const name of new Set(s.coreOff.map((n) => SHELL[n] ?? n))) t -= w.core[name] ?? 0;
  if (s.skills) t -= items.skills.filter((i) => d.skillsOff.includes(i.id)).reduce((n, i) => n + i.tokens, 0);
  if (s.subagents) t -= items.agents.filter((i) => d.agentsOff.includes(i.id)).reduce((n, i) => n + i.tokens, 0);
  return t;
}

export function fullTotal(imagesAvailable: boolean, w: Weights = TOOL_WEIGHTS): number {
  return w.total + (imagesAvailable ? w.families.images : 0);
}

export function basicsTotal(items: KitItems, w: Weights = TOOL_WEIGHTS): number {
  return kitTotal({ switches: { ...DEFAULT_SWITCHES, ...basicsPatch(), coreOff: [] }, skillsOff: [], agentsOff: [], promptsOff: [] }, items, w);
}

/** More than a quarter of the window ⇒ basics. Unknown (null/0) counts as large, like Pi's own fallback. */
export function kitPreset(ctx: number | null, full: number): "full" | "basics" {
  return ctx && ctx > 0 && full > ctx / 4 ? "basics" : "full";
}

/** At or under Pi's compaction reserve, the window is past Pi's summarise line from the first message. */
export function tooSmall(ctx: number | null, reserve: number = TOOL_WEIGHTS.compactionReserve): boolean {
  return !!ctx && ctx > 0 && ctx <= reserve;
}

export function smallModelLine(ctx: number, full: number): string {
  return `Your model reads ${ctx.toLocaleString("en-US")} tokens at a time and the full kit takes about ${fmtNum(full)}, so you're starting with just the basics.`;
}

export function tooSmallLine(basics: number, ctx: number): string {
  const pct = Math.round((100 * basics) / ctx);
  return pct >= 100
    ? "Even the basics don't fit in it — too little room for real work."
    : `Even the basics fill about ${pct}% of it — too little room for real work.`;
}

export function kitShape(d: KitDraft): "full" | "basics" | "custom" {
  const s = d.switches;
  const itemsTouched = d.skillsOff.length + d.agentsOff.length + d.promptsOff.length + s.coreOff.length > 0;
  if (itemsTouched) return "custom";
  if (KIT_FAMILIES.every((k) => s[k] === DEFAULT_SWITCHES[k])) return "full";
  if (KIT_FAMILIES.every((k) => !s[k])) return "basics";
  return "custom";
}

export function kitTiles(imagesAvailable: boolean): KitTile[] {
  const tiles: KitTile[] = KIT_FAMILIES.filter((k) => k !== "images" || imagesAvailable).map((k) => ({
    key: k,
    familyTick: true,
    items: k === "subagents" ? "agents" : k === "skills" ? "skills" : null,
    nestedUnder: k === "workflows" ? "subagents" : null,
  }));
  return [...tiles, { key: "core", familyTick: false, items: "core", nestedUnder: null }, { key: "prompts", familyTick: false, items: "prompts", nestedUnder: null }];
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `L=/tmp/vitest.log; npx vitest run tests/onboarding-kit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
(`tests/onboarding.test.ts` "no dead copy" will fail until Task 4 renders the new keys — expected at this point; do not commit-gate on it until Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/onboarding.ts tests/onboarding-kit.test.ts
git commit -s -m "feat(§22): the kit's copy and pure logic — preset, totals, tiles, shape"
```

---

### Task 4: The kit beat in the dialog

**Files:**
- Create: `src/renderer/src/components/OnboardingKit.tsx`
- Modify: `src/renderer/src/components/OnboardingDialog.tsx`, `src/main/usage/events.ts`, `src/renderer/src/usageUi.ts`, `tests/onboarding.test.ts`

**Interfaces:**
- Consumes: everything Task 3 exports; `FAMILY_COPY`, `weightLabel` (Task 2); `TOOL_WEIGHTS`.
- Produces — `OnboardingDialog` props change:
  ```ts
  contextWindow: number | null;     // default model's context window, re-read after step 1 (NOT `window`: that shadows the global the welcome effect uses)
  kitItems: KitItems | null;        // null while loading
  kitSwitches: KitSwitches | null;  // builtinsGet() after any preset write
  onKitOpen: (preset: "full" | "basics") => void;  // App writes the preset (basics) and loads the lists
  onDone: (d: KitDraft) => Promise<void>;          // App writes the draft, then hands over
  imagesAvailable: boolean;         // decides the Images tile and the preset before the lists load
  onOpenRoomGuide: () => void;      // the too-small line's link, in the system browser
  ```
- Produces — `OnboardingKit` props: `{ draft, setDraft, items }` (pure presentational; no IPC).

- [ ] **Step 1: Update `tests/onboarding.test.ts` first (failing)**

Replace `"holds long enough to be read once the pops finish"` with:
```ts
  it("waits for Start — no timer hands over any more (§22, 2026-10-09)", () => {
    const src = flat(DIALOG);
    expect(has(src, "setTimeout(onDone"), "timer").toBe(false);
    expect(has(src, "C.kitStart"), "Start button").toBe(true);
  });

  it("Esc in the kit beat starts, it never dismisses", () => {
    const src = flat(DIALOG);
    const esc = src.slice(src.indexOf("onEscapeKeyDown"), src.indexOf("onOpenAutoFocus"));
    expect(has(esc, "if (complete)"), "kit branch").toBe(true);
    expect(has(esc, "start()"), "Esc = Start").toBe(true);
  });

  it("Start is guarded, so a double press writes once and opens one session", () => {
    expect(has(flat(DIALOG), "starting.current"), "guard").toBe(true);
  });

  it("the kit preset is reported once, when the beat opens", () => {
    expect(has(flat(DIALOG), "onKitOpen(kitPreset(contextWindow,"), "preset at open").toBe(true);
  });
```
In `"the two wow notices"`, add: `expect(has(src, "ONBOARDING_COPY.noticeExtend"), "third notice").toBe(true); expect(has(src, 'goTo: "plugins"'), "links to Plugins").toBe(true);` (App source; Task 5 makes it pass).

Run: `L=/tmp/vitest.log; npx vitest run tests/onboarding.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` — Expected: the new cases FAIL.

- [ ] **Step 2: `OnboardingKit.tsx`**

A presentational component. Structure (Tailwind classes follow `OnboardingDialog.tsx`'s `StepRow`/buttons; the layout — flat grid vs three bands — is decided at the GUI pass, start with a two-column grid inside a scroll box):

```tsx
import { useState } from "react";
import { FAMILY_COPY, weightLabel, BUNDLED_NOTE } from "../toolSwitches";
import { TOOL_WEIGHTS } from "../../../main/toolWeights.generated";
import { kitTiles, setFamily, type KitDraft, type KitItems, type KitTile, ONBOARDING_COPY as C } from "../onboarding";
import { GOTO_LABELS } from "./GoTo";

/**
 * §22 (Onboarding kit round, 2026-10-09). Everything in the box, switchable, with what it weighs.
 * Pure presentation: the draft lives in OnboardingDialog (Esc must be able to Start with it),
 * and nothing here writes a setting — Start does, once.
 */
export function OnboardingKit({ draft, setDraft, items }: { draft: KitDraft; setDraft: (d: KitDraft) => void; items: KitItems }): React.JSX.Element {
  const [open, setOpen] = useState<KitTile["key"] | null>(null);
  const s = draft.switches;
  const weightOf = (t: KitTile): number | null =>
    t.key === "core" ? Object.values(TOOL_WEIGHTS.core).reduce((a, b) => a + b, 0)
    : t.key === "prompts" ? 0
    : TOOL_WEIGHTS.families[t.key];
  const isOn = (t: KitTile): boolean => t.key === "core" || t.key === "prompts" ? true : s[t.key] && (t.nestedUnder ? s.subagents : true);
  // … render: for each tile in kitTiles(items.imagesAvailable):
  //   - familyTick ? <input type="checkbox" checked={isOn(t)} disabled={(t.key==="askUser" && s.plan) || (t.nestedUnder==="subagents" && !s.subagents)}
  //                     onChange={(e) => setDraft(setFamily(draft, t.key as KitFamily, e.target.checked))} />
  //                : no checkbox at all (Core tools, Prompts)
  //   - label: t.key === "core" ? FAMILY_COPY.core.label : t.key === "prompts" ? GOTO_LABELS.promptTemplates : FAMILY_COPY[t.key].label
  //   - title attribute = the shared sentence (FAMILY_COPY[...].what, C.kitPrompts for prompts)
  //   - grey weight: weightLabel(weightOf(t)) (+ " " + BUNDLED_NOTE for skills/subagents)
  //   - items !== null: a ▸ toggle showing the count; open lists one checkbox per item:
  //       core   → items.core, checked = !s.coreOff.includes(n), toggles via toggleCore (toolSwitches.ts) on draft.switches.coreOff
  //       skills → items.skills, checked = !draft.skillsOff.includes(i.id), disabled while !s.skills
  //       agents → items.agents, checked = !draft.agentsOff.includes(i.id), disabled while !s.subagents
  //       prompts→ items.prompts, checked = !draft.promptsOff.includes(i.id)
  return <div>{/* as above */}</div>;
}
```
Write it out fully; keep every visible string from `C`, `FAMILY_COPY` or `GOTO_LABELS`. No `fixed`/`absolute` positioning (renderer-layers rule: browser coverage). Use the existing `ALL_OFF_COPY` line when `allToolsOff({ ...s, mcp: false, imagesAvailable: items.imagesAvailable }, items.core.includes("powershell") ? "powershell" : "bash")` is true (`mcp: false`: a fresh install has no server, so MCP gives the agent nothing).

- [ ] **Step 3: Wire it into `OnboardingDialog.tsx`**

- New props (above). Keep `modelReady`/`workspaceReady` derivation untouched.
- State: `const [draft, setDraft] = useState<KitDraft | null>(null);`, `const starting = useRef(false);`, `const reported = useRef(false);`.
- When `complete && !welcome` first becomes true, call `onKitOpen(kitPreset(contextWindow, fullTotal(imagesAvailable)))` once (`reported` ref), written inline in that shape (the test scans for it). `imagesAvailable` comes from a new `imagesAvailable: boolean` prop App fills from `imageSettings()` at boot of the dialog — the lists in `kitItems` are not loaded yet at that moment.
- When `kitSwitches` arrives and `draft === null`: `setDraft({ switches: kitSwitches, skillsOff: [], agentsOff: [], promptsOff: [] })`.
- Delete the `setTimeout(onDone, 2200)` effect and its paired `report` timer.
- `start`:
  ```ts
  const start = (): void => {
    if (!draft || starting.current) return;
    starting.current = true;
    setBusy(true);
    trackUi("onboarding_completed", {
      durationSec: Math.round((Date.now() - mountedAt.current) / 1000),
      skippedAnimation: skippedAnimation.current,
      kit: kitShape(draft),
      smallModel: kitPreset(contextWindow, fullTotal(imagesAvailable)) === "basics",
    });
    void onDone(draft);
  };
  ```
- Esc: `if (welcome) { setWelcome(false); return; } if (complete) { start(); return; } dismiss();`
- The celebration panel: keep `hv-burst` 🎉 and `hv-done-title` "You're in."; the `hv-done-body` class moves to `<p>{C.kitHeadline}</p>`; then `C.kitSubline` + later-line (`C.kitLaterLead` + `GOTO_LABELS.builtinTools`, `.skills`, `.agents`, `.promptTemplates` joined with commas/"and", plain text — NOT `GoTo` links), the small-model and too-small lines when they apply (with **Load everything anyway** = `setDraft({ ...draft, switches: { ...DEFAULT_SWITCHES, coreOff: draft.switches.coreOff } })`, and `C.kitMoreRoom` opening `docUrl("connect-a-model") + "#give-your-model-more-room"` via a new `onOpenRoomGuide` prop wired to `window.hv.openExternal` — the setup dialog uses the system browser), `<OnboardingKit …/>` (or a "Loading…" line while `kitItems`/`draft` is null), `🔒 {C.kitConsent}`, `{C.kitFooter}`, then a row: ghost **{C.kitBasics}** (`setDraft({ ...draft, switches: { ...draft.switches, ...basicsPatch() } })`), total `~{fmtNum(kitTotal(draft, kitItems))} {C.kitTotalTail}`, primary **{C.kitStart}** (`onClick={start}`, `disabled={busy || !draft}`).
- The panel scrolls inside the fixed frame (`h-full overflow-y-auto`, `min-h-full` column — the round-25 rule); the dialog size does not change.
- No ✕ while `complete` (already true today).

- [ ] **Step 4: Analytics schema**

`src/main/usage/events.ts`:
```ts
  onboarding_completed: { category: "activation", plain: "The first-run guide finished: how long it took, and whether the kit was kept, cut to the basics or changed", params: { durationSec: num, skippedAnimation: bool, kit: oneOf("full", "basics", "custom"), smallModel: bool } },
```
`src/renderer/src/usageUi.ts` `onboardingStep`: change the `"handover"` comment to `// unreachable since the kit (Esc = Start, no ✕); kept so old events still validate`.

- [ ] **Step 5: Run the onboarding tests and the usage tests**

Run: `L=/tmp/vitest.log; npx vitest run tests/onboarding.test.ts tests/onboarding-kit.test.ts tests/usage-attribution.test.ts tests/usage-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: everything passes except the two App-side notice assertions (Task 5). If a usage test pins `onboarding_completed`'s params, update it to the new shape.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/OnboardingKit.tsx src/renderer/src/components/OnboardingDialog.tsx src/main/usage/events.ts src/renderer/src/usageUi.ts tests/onboarding.test.ts
git commit -s -m "feat(§22): the celebration beat becomes the kit — Start, Esc = Start, no timer"
```

---

### Task 5: App wiring — window, lists, preset, writes on Start, the third notice

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Transcript.tsx`

**Interfaces:**
- Consumes: Task 4's dialog props; `basicsPatch`, `KitDraft`, `KitItems`, `KitSwitches` (Task 3); `subagentRosterLine` (`pi-runtime/extensions/hv-agents.ts`, already imported by `agents.ts`); `coreToolNames` (`hv-builtins.ts`).
- Produces: notice items `{ kind: "notice"; text: string; goTo?: View; … }`.

- [ ] **Step 1: Re-read the default model's window when a model appears**

Extract the IIFE at `App.tsx:1012-1021` into `const loadFallbackWindow = async (): Promise<void> => { … }` (same body) and call it from an effect keyed on `keyState`:
```ts
  // §22 kit: the window has to be known AFTER step 1 connects the model, not just at boot.
  // Also keeps the gauge's estimated fallback right for the first session.
  useEffect(() => { if (keyState === "present") void loadFallbackWindow(); }, [keyState]);
```
Place the effect with the other effects ABOVE the `keyState === "loading"` early return (the round-17 hooks-count bug).

- [ ] **Step 2: Load the kit's data when the beat opens**

```ts
  const [kitItems, setKitItems] = useState<KitItems | null>(null);
  const [kitSwitches, setKitSwitches] = useState<KitSwitches | null>(null);
  const openKit = async (preset: "full" | "basics"): Promise<void> => {
    // Written ONCE, before anything else, so quitting mid-beat leaves the safe preset (§22).
    if (preset === "basics") await window.hv.builtinsSet(basicsPatch());
    const [b, sk, pt, img, shell] = await Promise.all([
      window.hv.builtinsGet(), window.hv.skillsList(), window.hv.promptTemplatesList(), window.hv.imageSettings(), window.hv.agentShell(),
    ]);
    setKitSwitches({ plan: b.plan, askUser: b.askUser, terminal: b.terminal, browser: b.browser, web: b.web, memory: b.memory, schedules: b.schedules, document: b.document, images: b.images, subagents: b.subagents, workflows: b.workflows, skills: b.skills, coreOff: b.coreOff });
    setKitItems({
      skills: sk.global.filter((s) => s.source === "bundled").map((s) => ({ id: s.id, name: s.name, tokens: s.estTokens.card })),
      prompts: pt.global.filter((p) => p.source === "bundled").map((p) => ({ id: p.id, name: p.name, tokens: 0 })),
      agents: [], // filled from the hv.agents notify below
      imagesAvailable: img.available,
      core: coreToolNames(shell.shell),
    });
    // AFTER the preset write: builtinsSet restarts the utility client, which would drop a pending /hv-agents.
    void window.hv.listAgents();
  };
```
Bundled agents for the kit come from the existing `agents` state (the `parseAgents` handler at `App.tsx:1216` already fills it from the utility client's notify). Pass `kitItems && agents ? { ...kitItems, agents: agents.filter((a) => a.source === "bundled").map((a) => ({ id: a.name, name: a.name, tokens: Math.ceil(subagentRosterLine(a).length / 4) })) } : null` to the dialog.

- [ ] **Step 3: Write the draft on Start, then hand over**

`finishOnboarding` becomes:
```ts
  const finishOnboarding = async (d: KitDraft): Promise<void> => {
    // One builtins write (each one restarts the utility client), then only the items the user unticked.
    // All awaited BEFORE newSession, or the first session spawns with the old switches.
    try {
      await window.hv.builtinsSet(d.switches);
      for (const id of d.skillsOff) await window.hv.skillsSetEnabled(id, false);
      for (const name of d.agentsOff) await window.hv.setAgentEnabled(name, false);
      for (const id of d.promptsOff) await window.hv.promptTemplatesSetEnabled(id, false);
    } catch (err) {
      surface(err); // the session still opens; Built-in tools shows what actually saved
    }
    const ws = workspaces[0];
    dismissOnboarding();
    if (!ws) return;
    const entries = await window.hv.fsList(ws, ".").catch(() => []);
    setChips(chipsFor(folderHasCode(entries)));
    const sid = await newSession(ws);
    if (sid) firstRunSession.current = sid;
  };
```
Dialog props: `contextWindow={fallbackWindow}`, `imagesAvailable={imagesAvailable}` (a `useState(false)` filled by `window.hv.imageSettings()` when `onboarding` turns true), `kitItems={…}`, `kitSwitches={kitSwitches}`, `onKitOpen={(p) => void openKit(p)}`, `onDone={finishOnboarding}`, `onOpenRoomGuide={() => void window.hv.openExternal(docUrl("connect-a-model") + "#give-your-model-more-room")}`.

- [ ] **Step 4: The third notice, at the second turn end**

Change `wowShown` to `{ tools: boolean; context: boolean; extend: boolean }` and add `const firstRunTurns = useRef(0);`. In the existing `agent_end` block (`App.tsx:1765`), keep ONE `sid === firstRunSession.current` guard:
```ts
        if (sid === firstRunSession.current) {
          firstRunTurns.current += 1;
          if (!wowShown.current.context) {
            wowShown.current.context = true;
            appendItem(sid, { kind: "notice", text: ONBOARDING_COPY.noticeContext });
          } else if (firstRunTurns.current >= 2 && !wowShown.current.extend) {
            // §22 (2026-10-09): one turn later, so two notices never land at once.
            wowShown.current.extend = true;
            appendItem(sid, { kind: "notice", text: ONBOARDING_COPY.noticeExtend, goTo: "plugins" });
          }
        }
```
Keep the existing test's `wowShown.current.context = true` literal; the `firstRunSession.current` guard count stays 2.

- [ ] **Step 5: Notices can link (`Transcript.tsx`)**

Item type: `| { kind: "notice"; text: string; pending?: boolean; title?: string; goTo?: View }` (import `View` type from `./Sidebar`, `GoTo` from `./GoTo`). Render: when `it.goTo`, drop `truncate` and `rounded-full` for `rounded-2xl` so the sentence wraps, and append ` <GoTo view={it.goTo} />` after the text. Notices without `goTo` render exactly as today.

- [ ] **Step 6: Run the suite parts and typecheck**

Run: `L=/tmp/vitest.log; npx vitest run tests/onboarding.test.ts tests/onboarding-kit.test.ts tests/family-copy.test.ts tests/go-to.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` — all pass.
Run: `npm run typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tc.log` — `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Transcript.tsx
git commit -s -m "feat(§22): the kit loads its lists, saves the small-model preset at open, writes on Start; third notice links to Plugins"
```

---

### Task 6: The guide, same change

**Files:**
- Modify: `docs/guide/src/content/docs/first-launch.md`, `first-session.md`, `connect-a-model.md`, `built-in-tools.md`

- [ ] **Step 1: `first-launch.md`** — replace *Watch the handover* with the kit beat: "You're in." / "Your agent comes fully loaded.", what the tiles are, that Core tools and Prompts open to one tick per item, the grey weights and the total, **Just the basics**, the small-model line and **Load everything anyway**, the too-small line and its link, the consent line, the footer, **Start my first session**, **Esc** = start. Update *Setting up yourself instead* (no ✕ in the last beat). Add a `<!-- TODO(media): first-launch/onboarding-kit.png — The kit beat with its tiles, total and Start button -->`. Quote every string from `ONBOARDING_COPY` / `FAMILY_COPY` character for character.
- [ ] **Step 2: `first-session.md`** — after the context-gauge note (line ~78), the third note at the second turn end, quoted, with its **Plugins** link.
- [ ] **Step 3: `connect-a-model.md`** — new section `## Give your model more room` (anchor `give-your-model-more-room`, the one the too-small link opens): why a small window can't hold an agent, then how to raise it in Ollama (the app's context-length setting, or `OLLAMA_CONTEXT_LENGTH`) and LM Studio (the model's context length when loading it). Verify each instruction against the tools' current docs before writing; say "HappyVibe picks the new size up at the next session" only after checking `resolveOllamaWindows` does (it reads `/api/ps` per spawn).
- [ ] **Step 4: `built-in-tools.md`** — each row now shows what it weighs; what the figure counts; Skills and Sub-agents "with the bundled ones on"; MCP shows none.
- [ ] **Step 5: Review and build**

Run the `docs-reviewer` agent on the four pages and fix every finding. Then:
`cd docs/guide && npm run build > /tmp/guide.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/guide.log` — `EXIT=0`.
`L=/tmp/vitest.log; npx vitest run tests/docs-links.test.ts tests/docs-structure.test.ts tests/docs-doors.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L` — pass.

- [ ] **Step 6: Commit**

```bash
git add docs/guide/src/content/docs
git commit -s -m "docs(guide): the first-run kit, the third note, giving a model more room, weights on Built-in tools"
```

---

### Task 7: Gate, live check, GUI pass

- [ ] **Step 1: Gate** — `npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/gate.log` — `EXIT=0`.
- [ ] **Step 2: Live** — after the last commit, `npm run live:why`. This branch touches no `pi-runtime/extensions/`, `pi-runtime/package*.json`, `src/main/pi/` or live test file, so it should print nothing; say so explicitly ("live batch not required"). If it prints anything, run `npm run test:live` with `run_in_background` (symlink `.env` first: `ln -s ~/Documents/Github/HappyVibe/.env .env`).
- [ ] **Step 3: GUI pass** — every assertion in *Verification* below, on the BUILT app with a throwaway profile, never the user's dev server or profile: `npm run build`, then electron-debug `start_app` with `extraArgs: ["--user-data-dir=/tmp/hv-kit-<n>"]` (a new `<n>` per scenario). Scope any `pkill` to this worktree. Record every finding and fix in `docs/validation/kit1.md`.
- [ ] **Step 4: Calibrate** — the quarter against one real 4k, 32k and 128k model; grid vs bands at the real size. Record the outcome in `kit1.md`; if bands win, only the kit's rendering changes (`KIT_FAMILIES` order stays the page's).
- [ ] **Step 5: Commit** fixes and `kit1.md` with `git commit -s`; stop for `/land`.

---

## Verification — what will be TRUE on screen

Profiles: **L** = large model (paste the DeepSeek key from `.env` at step 1 → no OpenRouter) · **LO** = large + OpenRouter key · **S4** / **S32** / **S128** = a custom endpoint whose model's context window is 4,096 / 32,768 / 131,072. To get S*: launch a fresh profile, close the wizard with ✕, add the custom endpoint on **Models** (any OpenAI-compatible URL; set the model's context window), make it the default model, quit, set `"onboardingSeen": false` in `<user-data-dir>/config.json` (confirm the file path with `ls` first), relaunch — step 1 is pre-checked. A real Ollama at its default window is the better S4 if installed.

**Kit beat (observed in the onboarding dialog)**
1. **L:** after both steps tick, the panel shows 🎉, "You're in.", "Your agent comes fully loaded.", "Untick anything you don't want." and the later-line naming *Built-in tools, Skills, Agents and Prompts* as plain text (not links).
2. **L:** tiles appear in this order: Plan mode, Ask user, Agent terminal — 3 tools, Agent browser — 10 tools, Web tools — 4 tools, Memory — 3 tools, Schedules — 4 tools, Documents — 1 tool, Sub-agents — 4 tools (▸ 10), Workflows — 1 tool (nested, **unticked**), Skills (▸ 8), Core tools (▸ 7), Prompts (▸ 9, weight 0). Every family tick is on except Workflows.
3. **L:** wait 10 s — the dialog is still open (no timer). The frame's size equals the setup beat's (measure both with `getBoundingClientRect`).
4. **Absent, by name (L):** no ✕ button; no **MCP** tile; no **Tool intent** tile; no **Images** tile; no checkbox beside **Core tools** or **Prompts** (only their ▸); no text "Opening your first session…"; no small-model line; no too-small line.
5. **LO:** an **Images — 1 tool** tile appears between Documents and Sub-agents, ticked, with its weight; the total is higher than in L by exactly that weight.
6. **L:** untick **Agent browser** → the total drops by exactly Agent browser's grey figure. Open Skills ▸, untick **theme-factory** → the total drops by that skill's figure. Untick **Skills** → its items grey out and the total drops by Skills' figure only (not by theme-factory again). While Plan mode is ticked, **Ask user**'s tick is locked on. Untick **Plan mode** → Ask user's tick unlocks; untick it; re-tick Plan mode → Ask user is ticked and locked again.
7. **L:** the consent line reads "🔒 Anything that changes your files or runs a command asks you first."; the footer reads "Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each."
8. **S4:** the kit opens with every family tick off; Core tools' 7 items and Prompts' 9 items stay ticked. The line reads "Your model reads 4,096 tokens at a time and the full kit takes about N, so you're starting with just the basics." with N equal to the L total. The too-small line shows a percentage under 100 (or "don't fit") and **Give your model more room ↗** opens the guide's *Connect a model* page at that section in the system browser.
9. **S32:** opens on basics; the small-model line shows "32,768"; **no** too-small line. **S128:** opens fully loaded; **no** small-model line, **no** too-small line.
10. **S4 → Load everything anyway:** every family ticks on except Workflows; the total equals L's.

**After Start (observed on the pages that OWN each setting, not in the dialog)**
11. **L, untick Agent browser + theme-factory (skill) + translate (prompt) + data-analyst (agent), click Start:** the button shows busy, then the dialog closes and a session opens with chips. **Built-in tools:** Agent browser off, every other row on, Workflows off, **MCP on**. **Skills:** theme-factory disabled, the other 7 on. **Prompts:** translate disabled. **Agents:** data-analyst off. **Agent tools** (in the new session): no `browser_*` row; `read`, `edit`, `bash` present.
12. **Built-in tools (any profile):** every row except MCP shows a grey "~N tokens"; Skills and Sub-agents add "with the bundled ones on"; the Workflows row no longer says "about 5.5k tokens". **Absent:** any weight under the MCP row.
13. **Context panel (L, after the first turn, nothing unticked):** the system + tools estimate is within ±10% of the kit's total from step 2 — the kit and the gauge use the same unit.

**First session notices (observed in the transcript)**
14. Turn 1 with a tool call: the tools note, then at turn end the context note. **Absent after turn 1:** the GitHub/Linear/Notion note.
15. Turn 2 ends: "Want your agent to reach GitHub, Linear or Notion? Add a plugin or an MCP server — a few clicks." appears in full (not truncated) with a **Plugins** link; clicking it opens the Plugins page.
16. **Absent:** a second session created afterwards shows none of the three notes.

**Regression sequences (perform exactly)**
- **R1 — quit mid-beat on a small model:** S4 → the kit opens on basics → quit the app (⌘Q) without clicking anything → relaunch the same profile. Expected: no wizard; **Built-in tools** shows every kit family off, **MCP still on**, Core tools all on.
- **R2 — the preset must not outlive the user's choice:** S4 → **Load everything anyway** → **Start**. Expected on **Built-in tools:** every row on except Workflows (the preset written at open was overwritten by Start).
- **R3 — double start:** L → press **Esc**, then immediately click **Start my first session**. Expected: one new session in the sidebar, not two; one `onboarding_completed` event in the analytics debug log.
- **R4 — writes land before the spawn:** L → untick Agent browser → Start → immediately send "open example.com in the browser". Expected: the agent has no `browser_open` (it says it can't, or uses `web_fetch`); **Agent tools** lists no `browser_*`.

---

## Self-review notes

- Spec coverage: kit placement/Start/Esc (T4), ticks + no family tick for Core/Prompts (T3 `kitTiles`, T4), shared record + names (T2), weights generated (T1) + on rows (T2), small-model preset + saved at open (T3/T5), too-small line + guide section (T3/T6), footer + third notice (T3/T5), consent pin (T3), analytics (T4), fresh-installs-only and no re-open path (unchanged, guarded by existing `shouldShowOnboarding` tests), guide (T6), GUI pass (T7).
- The MCP-weighs-0 claim is read from Pi's source; Task 1 stops the round if the generator disagrees.
