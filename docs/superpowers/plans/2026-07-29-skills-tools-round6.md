# Feedback Round 6 — Skills & Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tools/skills surfaces honest and manageable — name every context item, let users delete skills, split the settings page into four, make Plan mode / ask_user configurable, and surface loaded skills plus `/skill:` autocomplete in chat.

**Architecture:** Five independent waves. Wave A fixes a measurement defect in the bridge's context snapshot (pure-module changes + renderer). Wave B adds destructive skill operations in main (path-confined, per-source semantics). Wave C splits the renderer's `View` union into four sidebar pages. Wave D introduces the first *globally configurable built-in tool* — a new config tier read at spawn and applied via the existing runtime-reload machinery. Wave E wires session-level skill visibility and plugs the composer into Pi's existing `get_commands` RPC.

**Tech Stack:** Electron + React + Tailwind (renderer), TypeScript main process, vendored Pi 0.80.10 over NDJSON RPC, vitest.

## Global Constraints

- Decisions are locked in `docs/prd.md` §9, §13, §14 under "Decision (Feedback round 6, 2026-07-29)". Do not re-litigate them; if the code contradicts the PRD, the PRD wins.
- Every fs writer must be path-confined (pattern: `agentsMd.ts` / `files.ts` `resolveInWorkspace`). New delete paths are fs writers.
- `pi-runtime/extensions/hv-*.ts` are PURE modules (no electron, no non-node imports) — they are imported by both the bridge and vitest. Keep them that way.
- Bridge⇄main protocol: JSON envelopes `kind:"hv.*"`; blocking = select/input, fire-and-forget = notify. Main must ALWAYS `respondUi` to a blocking request, error string on failure, or the bridge hangs.
- Renderer perf invariants: streaming text stays out of the transcripts array; tool cards update via the `toolIndex` map, never a full `.map()`.
- Gate before each commit: `npx tsc --noEmit -p tsconfig.node.json` AND `-p tsconfig.web.json`, plus `npm test`. Live-Pi files (`DEEPSEEK_API_KEY` in `.env`) run BATCHED in one vitest invocation.
- Plan mode's read-only enforcement is the `gatePlanCall` clamp, never the prompt. No task in this plan may move enforcement into prompt text.
- Human-only invariant (§23): there is no `plan_off` tool. Nothing here adds a model-callable way to leave Plan Mode.

---

# Wave A — Context panel tells the truth

## Task 1: Tool definitions get real names and real sizes

The bridge maps Pi's `selectedTools` as if it were an array of tool spec objects. Pi types it `string[]` and fills it with `validToolNames`, so `o.name` is `undefined` → `"(tool)"`, and `JSON.stringify({name:undefined,…})` is `"{}"` → `chars: 2` → `≈1 tok` for every tool. Names are lost and the whole category is understated ~100×. The fix joins those names against `pi.getAllTools()`, which carries the real `description` and `parameters`.

**Files:**
- Modify: `pi-runtime/extensions/hv-context.ts` (add `buildToolDefs`, end of file)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:320-326` (call it)
- Test: `tests/context-tooldefs.test.ts` (create)

**Interfaces:**
- Produces: `buildToolDefs(selectedTools: unknown, allTools: ToolSpecLike[]): { name: string; chars: number }[]`, where `ToolSpecLike = { name?: string; description?: string; parameters?: unknown }`. Wave A Task 3 and the renderer keep consuming `system.toolDefs` unchanged in shape.

- [ ] **Step 1: Write the failing test**

Create `tests/context-tooldefs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildToolDefs } from "../pi-runtime/extensions/hv-context";

const ALL = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "write", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
];

describe("buildToolDefs", () => {
  it("resolves Pi's string[] selectedTools to named defs sized from their schema", () => {
    const defs = buildToolDefs(["read", "write"], ALL);
    expect(defs.map((d) => d.name)).toEqual(["read", "write"]);
    expect(defs[0].chars).toBeGreaterThan(40);
    expect(defs[1].chars).toBeGreaterThan(defs[0].chars);
  });

  it("still handles a spec-object array (defensive: Pi could change shape)", () => {
    const defs = buildToolDefs(ALL, ALL);
    expect(defs.map((d) => d.name)).toEqual(["read", "write"]);
    expect(defs[0].chars).toBeGreaterThan(40);
  });

  it("names an unknown tool honestly instead of inventing a size", () => {
    const defs = buildToolDefs(["ghost"], ALL);
    expect(defs).toEqual([{ name: "ghost", chars: 0 }]);
  });

  it("returns [] for a non-array", () => {
    expect(buildToolDefs(undefined, ALL)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/context-tooldefs.test.ts`
Expected: FAIL — `buildToolDefs is not a function` (no such export).

- [ ] **Step 3: Implement `buildToolDefs`**

Append to `pi-runtime/extensions/hv-context.ts`:

```ts
export interface ToolSpecLike {
  name?: string;
  description?: string;
  parameters?: unknown;
}

/**
 * Pi passes `systemPromptOptions.selectedTools` as a string[] of tool NAMES
 * (core/agent-session.js builds it from validToolNames) — not as tool specs.
 * Join those names against pi.getAllTools() to recover each tool's real schema
 * so the context panel can name it and size it. Unknown name → chars 0, which
 * the renderer labels rather than showing a fabricated estimate.
 */
export function buildToolDefs(selectedTools: unknown, allTools: ToolSpecLike[]): { name: string; chars: number }[] {
  if (!Array.isArray(selectedTools)) return [];
  const byName = new Map<string, ToolSpecLike>();
  for (const t of allTools) if (typeof t?.name === "string") byName.set(t.name, t);
  const out: { name: string; chars: number }[] = [];
  for (const entry of selectedTools) {
    const name = typeof entry === "string" ? entry : typeof (entry as ToolSpecLike)?.name === "string" ? (entry as ToolSpecLike).name! : "";
    if (!name) continue;
    const spec = byName.get(name) ?? (typeof entry === "string" ? undefined : (entry as ToolSpecLike));
    const chars = spec ? JSON.stringify({ name, description: spec.description, parameters: spec.parameters }).length : 0;
    out.push({ name, chars });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `npx vitest run tests/context-tooldefs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Call it from the bridge**

In `pi-runtime/extensions/happyvibe-bridge.ts`, replace the block at `:320-326` (the `const toolDefs = (Array.isArray(opts.selectedTools) …).map(…)` expression) with:

```ts
      const toolDefs = buildToolDefs(opts.selectedTools, pi.getAllTools() as ToolSpecLike[]);
```

Add `buildToolDefs`, `ToolSpecLike` to the existing `hv-context` import at the top of the file.

- [ ] **Step 6: Full typecheck + suite**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test`
Expected: both typechecks clean; suite green (`tests/context-renderer.test.ts` still passes — it feeds `toolDefs` directly and is unaffected).

- [ ] **Step 7: Commit**

```bash
git add pi-runtime/extensions/hv-context.ts pi-runtime/extensions/happyvibe-bridge.ts tests/context-tooldefs.test.ts
git commit -m "fix(context): name tool definitions and size them from real schemas

selectedTools is a string[] of names, not spec objects — every row rendered
'(tool) ~1 tok' and the category was understated ~100x."
```

---

## Task 2: Hide Pi's zero-cost bookkeeping entries

`session`, `model_change`, `thinking_level_change`, `session_info` entries have no `message` and no chars, so they render as `item ≈0 tok` and are the only remaining occupants of "Other" — which round 5 already promised to eliminate.

**Files:**
- Modify: `pi-runtime/extensions/hv-context.ts:250` (the skip list in `serializeEntries`)
- Test: `tests/hv-context.test.ts` (extend; create the file if absent)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `serializeEntries` no longer emits items with `group: "other"` for bookkeeping types. The renderer's `"other"` category and its `GROUP_LABELS`/`CATEGORY_COLOR` entries stay in place (a genuinely uncategorized item must still have somewhere to land, per the PRD's "appears only when genuinely needed").

- [ ] **Step 1: Write the failing test**

Add to `tests/hv-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeEntries } from "../pi-runtime/extensions/hv-context";

describe("serializeEntries — bookkeeping entries", () => {
  it("drops zero-cost Pi session bookkeeping instead of rendering unnamed 'item' rows", () => {
    const items = serializeEntries([
      { id: "1", type: "session" },
      { id: "2", type: "model_change" },
      { id: "3", type: "thinking_level_change" },
      { id: "4", type: "session_info" },
      { id: "5", type: "message", message: { role: "user", content: "hi" } },
    ] as never);
    expect(items.map((i) => i.entryId)).toEqual(["5"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/hv-context.test.ts`
Expected: FAIL — receives `["1","2","3","4","5"]`.

- [ ] **Step 3: Extend the skip list**

In `serializeEntries`, replace the skip line:

```ts
    if (entry.type === "label" || entry.type === "custom" || entry.type === "custom_message") continue;
```

with:

```ts
    // §9 round 6: Pi session bookkeeping carries no message and no tokens —
    // it rendered as unnamed "item ≈0 tok" rows and was the last occupant of
    // "Other". Drop it here so the panel only lists real consumers.
    if (BOOKKEEPING_TYPES.has(entry.type)) continue;
```

and add above `serializeEntries`:

```ts
const BOOKKEEPING_TYPES = new Set([
  "label",
  "custom",
  "custom_message",
  "session",
  "model_change",
  "thinking_level_change",
  "session_info",
]);
```

- [ ] **Step 4: Run the test — it passes**

Run: `npx vitest run tests/hv-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npm test
git add pi-runtime/extensions/hv-context.ts tests/hv-context.test.ts
git commit -m "fix(context): drop Pi bookkeeping entries instead of unnamed 'item' rows"
```

---

## Task 3: Skills become a drill-in with per-skill names

`skillTokenLines` returns only `{tokens,count}` per scope, so the two rows can only be aggregates; `ContextPanel.tsx:189-205` short-circuits them into a non-clickable dashed line.

**Files:**
- Modify: `pi-runtime/extensions/hv-skills.ts:66-79` (`skillTokenLines` gains `items`)
- Modify: `src/renderer/src/context.ts:245-258` (carry the per-skill list onto the rows)
- Modify: `src/renderer/src/components/ContextPanel.tsx:189-205` (make the rows drillable) and the drill-in renderer near `:316-330`
- Modify: `src/renderer/src/hv.d.ts` (`SystemBlock.skills` type)
- Test: `tests/hv-skills.test.ts` (extend), `tests/context-renderer.test.ts` (extend)

**Interfaces:**
- Produces: `skillTokenLines(m)` → `{ global: Scope; workspace: Scope }` where `Scope = { tokens: number; count: number; items: { name: string; tokens: number }[] }`. `CategorySummary` gains optional `skills?: { name: string; tokens: number }[]` — consumed only by `ContextPanel`.

- [ ] **Step 1: Write the failing bridge test**

Add to `tests/hv-skills.test.ts`:

```ts
it("skillTokenLines lists each skill by name per scope", () => {
  const m = {
    skills: [
      { name: "pdf-tools", dir: "/a", skillMdPath: "/a/SKILL.md", scope: "global", estTokens: { card: 20, body: 400 } },
      { name: "house-style", dir: "/b", skillMdPath: "/b/SKILL.md", scope: "workspace", estTokens: { card: 12, body: 90 } },
    ],
  } as never;
  const lines = skillTokenLines(m);
  expect(lines.global).toEqual({ tokens: 20, count: 1, items: [{ name: "pdf-tools", tokens: 20 }] });
  expect(lines.workspace.items).toEqual([{ name: "house-style", tokens: 12 }]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/hv-skills.test.ts`
Expected: FAIL — `items` is undefined.

- [ ] **Step 3: Implement in the bridge module**

Replace `skillTokenLines` in `pi-runtime/extensions/hv-skills.ts`:

```ts
export interface SkillScopeWeight {
  tokens: number;
  count: number;
  /** §9 round 6: per-skill names so the context panel can drill in. */
  items: { name: string; tokens: number }[];
}

/** Skill system-prompt weight per scope (chars/4 card estimate + count + names). */
export function skillTokenLines(m: SkillManifest): { global: SkillScopeWeight; workspace: SkillScopeWeight } {
  const acc = {
    global: { tokens: 0, count: 0, items: [] as { name: string; tokens: number }[] },
    workspace: { tokens: 0, count: 0, items: [] as { name: string; tokens: number }[] },
  };
  for (const s of m.skills) {
    const bucket = s.scope === "workspace" ? acc.workspace : acc.global;
    const tokens = s.estTokens?.card ?? 0;
    bucket.tokens += tokens;
    bucket.count += 1;
    bucket.items.push({ name: s.name, tokens });
  }
  for (const b of [acc.global, acc.workspace]) b.items.sort((x, y) => y.tokens - x.tokens);
  return acc;
}
```

- [ ] **Step 4: Run the bridge test — it passes**

Run: `npx vitest run tests/hv-skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the renderer type**

In `src/renderer/src/hv.d.ts`, change `SystemBlock`'s skills field to:

```ts
  skills?: {
    global: { tokens: number; count: number; items?: { name: string; tokens: number }[] };
    workspace: { tokens: number; count: number; items?: { name: string; tokens: number }[] };
  };
```

(`items` is optional so a snapshot from an older bridge still typechecks.)

- [ ] **Step 6: Carry names onto the summary rows**

In `src/renderer/src/context.ts`, add to `CategorySummary`:

```ts
  /** §9 round 6: per-skill detail for the skills rows' drill-in. */
  skills?: { name: string; tokens: number }[];
```

and in `summarizeGroups`, add `skills: sk.global.items ?? []` to the `skills-global` row and `skills: sk.workspace.items ?? []` to the `skills-workspace` row.

Add colors so the rows stop falling through to the default in `CATEGORY_COLOR`:

```ts
  "skills-global": "bg-plum/70",
  "skills-workspace": "bg-berry/70",
```

- [ ] **Step 7: Write the renderer test**

Add to `tests/context-renderer.test.ts`:

```ts
it("skills rows carry per-skill items for the drill-in", () => {
  const rows = summarizeGroups([], {
    chars: 100, estTokens: 25, toolCount: 0, contextFiles: [], toolDefs: [], agents: [],
    skills: { global: { tokens: 20, count: 1, items: [{ name: "pdf-tools", tokens: 20 }] }, workspace: { tokens: 0, count: 0, items: [] } },
  } as never);
  const g = rows.find((r) => r.key === "skills-global");
  expect(g?.skills).toEqual([{ name: "pdf-tools", tokens: 20 }]);
});
```

- [ ] **Step 8: Make the rows drillable**

In `ContextPanel.tsx`, delete the `skills-global`/`skills-workspace` short-circuit at `:189-205` so those rows fall through to the normal drillable row renderer (which already shows share + bar). Then in the drill-in switch, add a branch mirroring the tool-definitions list at `:316-330`:

```tsx
  if (drill === "skills-global" || drill === "skills-workspace") {
    const row = rows.find((r) => r.key === drill);
    return (
      <div className="space-y-1">
        {(row?.skills ?? []).map((s) => (
          <div key={s.name} className="flex items-baseline justify-between text-xs">
            <span className="font-medium">{s.name}</span>
            <span className="tabular-nums text-ink-soft">≈{s.tokens} tok</span>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-ink-soft">
          Name + description are paid every turn. The skill's body only enters context when it is loaded.
        </p>
      </div>
    );
  }
```

- [ ] **Step 9: Full gate**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test`
Expected: both clean, suite green.

- [ ] **Step 10: Commit**

```bash
git add pi-runtime/extensions/hv-skills.ts src/renderer/src/context.ts src/renderer/src/components/ContextPanel.tsx src/renderer/src/hv.d.ts tests/hv-skills.test.ts tests/context-renderer.test.ts
git commit -m "feat(context): drill into skills per-skill instead of two aggregate lines"
```

- [ ] **Step 11: GUI pass (Wave A gate)**

Launch `HV_DEBUG_PORT=9222 npm run dev` (the user launches; attach with `attach {debugPort:9222}` — never `start_app`). Open a session, open the context panel, and confirm with a screenshot: Tool definitions drills into named rows with plausible sizes (hundreds of tokens total, not ~1/tool); Skills rows are clickable; no `item` rows and no "Other" category.

---

# Wave B — Skills you can actually remove

## Task 4: Delete / unlink in main, with per-source semantics

`registry.forget(id, now)` exists at `src/main/skills/registry.ts:114` with zero callers; the only removal path today is deleting a folder by hand.

**Files:**
- Create: `src/main/skills/remove.ts`
- Modify: `src/main/ipc.ts` (register `hv:skills-delete` next to the other `hv:skills-*` handlers, ~`:1495-1687`)
- Modify: `src/preload/index.ts:167-182`, `src/renderer/src/hv.d.ts`
- Test: `tests/skills-delete.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type DeleteKind = "delete" | "unlink" | "refused";
  export interface DeletePlan { kind: DeleteKind; dir: string; reason?: string }
  export function planSkillRemoval(view: { id: string; source: string; dir: string }, roots: { managed: string; bundled: string; workspaces: string[] }): DeletePlan;
  export function removeSkillDir(dir: string, allowedRoots: string[]): void;
  ```
- IPC contract: `hv:skills-delete(skillId, workspaceId | null)` → `{ ok: true; kind: DeleteKind } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/skills-delete.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { planSkillRemoval, removeSkillDir } from "../src/main/skills/remove";

const ROOTS = { managed: "/app/skills", bundled: "/runtime/skills", workspaces: ["/ws/proj"] };

describe("planSkillRemoval", () => {
  it("deletes a managed (imported global) skill", () => {
    expect(planSkillRemoval({ id: "a", source: "managed", dir: "/app/skills/pdf" }, ROOTS).kind).toBe("delete");
  });

  it("deletes a workspace skill", () => {
    expect(planSkillRemoval({ id: "b", source: "workspace", dir: "/ws/proj/.agents/skills/x" }, ROOTS).kind).toBe("delete");
  });

  it("refuses to delete a bundled skill — the runtime reinstalls it at startup", () => {
    const p = planSkillRemoval({ id: "c", source: "bundled", dir: "/runtime/skills/skill-creator" }, ROOTS);
    expect(p.kind).toBe("refused");
    expect(p.reason).toMatch(/bundled/i);
  });

  it("unlinks a linked directory rather than deleting someone else's files", () => {
    expect(planSkillRemoval({ id: "d", source: "linked", dir: "/Users/me/.claude/skills/x" }, ROOTS).kind).toBe("unlink");
  });
});

describe("removeSkillDir", () => {
  it("removes a directory inside an allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    const dir = path.join(root, "skill");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "SKILL.md"), "x");
    removeSkillDir(dir, [root]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("refuses a path outside every allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    expect(() => removeSkillDir(path.join(root, "..", "elsewhere"), [root])).toThrow(/outside/i);
  });

  it("refuses an allowed root itself (never delete the whole skills dir)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    expect(() => removeSkillDir(root, [root])).toThrow(/outside|root/i);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/skills-delete.test.ts`
Expected: FAIL — cannot resolve `../src/main/skills/remove`.

- [ ] **Step 3: Implement `remove.ts`**

Create `src/main/skills/remove.ts`:

```ts
/**
 * §14 round 6 — removing a skill means different things per source:
 *  managed / workspace → real delete from disk
 *  bundled            → refused (installBundledSkills reinstalls at startup)
 *  linked             → unlink the directory reference; never touch the files,
 *                       they belong to another tool (e.g. ~/.claude/skills)
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type DeleteKind = "delete" | "unlink" | "refused";
export interface DeletePlan {
  kind: DeleteKind;
  dir: string;
  reason?: string;
}

export function planSkillRemoval(
  view: { id: string; source: string; dir: string },
  _roots: { managed: string; bundled: string; workspaces: string[] },
): DeletePlan {
  if (view.source === "bundled") {
    return { kind: "refused", dir: view.dir, reason: "Bundled skills ship with HappyVibe and are reinstalled at startup — disable it instead." };
  }
  if (view.source === "linked") return { kind: "unlink", dir: view.dir };
  return { kind: "delete", dir: view.dir };
}

/** Path-confined recursive delete (pattern: files.ts resolveInWorkspace). */
export function removeSkillDir(dir: string, allowedRoots: string[]): void {
  const abs = path.resolve(dir);
  const ok = allowedRoots.some((root) => {
    const r = path.resolve(root);
    return abs !== r && (abs.startsWith(r + path.sep) || abs === r + path.sep);
  });
  if (!ok) throw new Error(`Refusing to delete ${abs}: outside the managed skill roots.`);
  fs.rmSync(abs, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `npx vitest run tests/skills-delete.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the IPC handler**

In `src/main/ipc.ts`, alongside the other `hv:skills-*` handlers:

```ts
  ipcMain.handle("hv:skills-delete", async (_e, skillId: string, workspaceId: string | null) => {
    const view = listSkillViews(workspaceId).find((s) => s.id === skillId);
    if (!view) return { ok: false as const, error: "That skill no longer exists." };
    const plan = planSkillRemoval(view, {
      managed: managedSkillsDir(agentDir()),
      bundled: bundledSkillsDir(runtimeDir()),
      workspaces: workspaces.all().map((w) => w.path),
    });
    if (plan.kind === "refused") return { ok: false as const, error: plan.reason ?? "This skill cannot be deleted." };
    try {
      if (plan.kind === "unlink") {
        const linked = readLinkedSkillDirs().filter((d) => d !== plan.dir);
        writeLinkedSkillDirs(linked);
      } else {
        removeSkillDir(plan.dir, [managedSkillsDir(agentDir()), ...workspaces.all().map((w) => path.join(w.path, ".agents", "skills"))]);
      }
      skillRegistry.forget(skillId, new Date().toISOString());
      log.append({ type: "skill.deleted", data: { id: skillId, name: view.name, source: view.source, kind: plan.kind } });
      skillsChanged();
      scheduleRuntimeReload("skills", view.scope === "workspace" ? "workspace" : "global", workspaceId);
      return { ok: true as const, kind: plan.kind };
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) };
    }
  });
```

Match the surrounding code for the exact helper names in use (`listSkillViews`, `agentDir`, `runtimeDir`, `readLinkedSkillDirs`/`writeLinkedSkillDirs` as used by `hv:skills-get-linked`/`-set-linked`, `skillsChanged`, `scheduleRuntimeReload` at `:685`). Import `planSkillRemoval`, `removeSkillDir` from `./skills/remove`.

- [ ] **Step 6: Expose it through preload + types**

`src/preload/index.ts` (next to the other 13 skills methods):

```ts
  skillsDelete: (skillId: string, workspaceId: string | null) => ipcRenderer.invoke("hv:skills-delete", skillId, workspaceId),
```

`src/renderer/src/hv.d.ts`:

```ts
  skillsDelete(skillId: string, workspaceId: string | null): Promise<{ ok: true; kind: "delete" | "unlink" } | { ok: false; error: string }>;
```

- [ ] **Step 7: Gate + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test
git add src/main/skills/remove.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts tests/skills-delete.test.ts
git commit -m "feat(skills): delete managed/workspace skills, unlink linked dirs, refuse bundled"
```

---

## Task 5: Delete button in the inspector, with a confirm that names the path

**Files:**
- Modify: `src/renderer/src/components/SkillsSection.tsx` (`SkillInspector` action row, ~`:414-446`)

**Interfaces:**
- Consumes: `window.hv.skillsDelete` (Task 4).
- Produces: `SkillInspector` gains no new props; it reads `skill.source` to pick the label.

- [ ] **Step 1: Add the action**

In `SkillInspector`'s action row, after "Promote to global", add:

```tsx
        {skill.source !== "bundled" && (
          <button
            className="rounded-md border-2 border-berry/60 px-2 py-1 text-xs font-bold text-berry hover:bg-berry-soft"
            onClick={async () => {
              const unlink = skill.source === "linked";
              const msg =
                unlink ? `Unlink “${skill.name}”?\n\n${skill.dir}\n\nThe folder and its files are left untouched — HappyVibe just stops looking there.`
                : skill.source === "workspace" ? `Delete “${skill.name}”?\n\n${skill.dir}\n\nThis deletes a file from your project, which is probably tracked by git.`
                : `Delete “${skill.name}”?\n\n${skill.dir}\n\nThe folder is removed from disk.`;
              if (!window.confirm(msg)) return;
              const res = await window.hv.skillsDelete(skill.id, workspaceId ?? null);
              if (!res.ok) { setError(res.error); return; }
              onClose();
            }}
          >
            {skill.source === "linked" ? "Unlink" : "Delete"}
          </button>
        )}
```

Reuse the inspector's existing error state and `onClose` — match the names actually present in the component; do not introduce a second error channel.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SkillsSection.tsx
git commit -m "feat(skills): Delete / Unlink action in the skill inspector"
```

---

## Task 6: Select all / Deselect all in the import picker

**Files:**
- Modify: `src/renderer/src/components/SkillsSection.tsx` (`ImportPicker`, ~`:180-220`)

- [ ] **Step 1: Add the control**

Above the checkbox list, inside `ImportPicker`:

```tsx
        <div className="flex items-center gap-2 pb-1 text-[11px] font-bold text-ink-soft">
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set(scan.skills.map((s) => s.id)))}>Select all</button>
          <span>·</span>
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set())}>Deselect all</button>
          <span className="ml-auto tabular-nums">{selected.size}/{scan.skills.length}</span>
        </div>
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
git add src/renderer/src/components/SkillsSection.tsx
git commit -m "feat(skills): select all / deselect all in the import picker"
```

---

## Task 7: Workspace settings separates global from workspace skills

Today `WorkspaceSkillsBlock` shows project skills (inspectable, approvable) and a flat activation checklist where global skills are plain labels. The PRD now requires: global rows inspectable but **never approvable there**; workspace rows inspectable **and** approvable.

**Files:**
- Modify: `src/renderer/src/components/SkillsSection.tsx` (`SkillInspector` gains `canApprove?: boolean`, default `true`)
- Modify: `src/renderer/src/components/WorkspaceSettingsModal.tsx:205-274`
- Test: `tests/skills-view.test.ts` (extend, if the view builder is what you split on)

**Interfaces:**
- Produces: `SkillInspector` prop `canApprove?: boolean` — when `false`, the Approve/Re-approve button is not rendered and a one-line hint replaces it.

- [ ] **Step 1: Gate the approve button**

In `SkillInspector`, wrap the Approve/Re-approve button:

```tsx
        {status === "needs-review" && (canApprove
          ? <button …existing approve button… />
          : <p className="text-[11px] text-ink-soft">Approve this skill from the Skills page — a workspace can only turn a global skill off for itself.</p>
        )}
```

- [ ] **Step 2: Split the block into two labelled groups**

In `WorkspaceSkillsBlock`, render two sub-sections:

- **"This project's skills"** — the `.agents/skills` rows, unchanged, opening the inspector with `canApprove` omitted (defaults `true`).
- **"Global skills in this workspace"** — the activation checklist, but each row becomes a clickable name (opening the inspector with `canApprove={false}`) plus its checkbox for per-workspace activation. Keep the existing "Toggling a skill respawns this workspace's sessions" note.

Keep both wired to the same `skillsSetActive` / `skillsApprove` calls already in the file.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.web.json && npm test
git add src/renderer/src/components/SkillsSection.tsx src/renderer/src/components/WorkspaceSettingsModal.tsx
git commit -m "feat(skills): workspace settings separates global (no approve) from project skills"
```

- [ ] **Step 4: GUI pass (Wave B gate)**

Import a folder with several skills (verify Select all/Deselect all), delete one managed skill and confirm the folder is gone from disk, unlink a linked dir and confirm the files survive, try to delete a bundled skill and confirm the refusal message. Open workspace settings and confirm a global skill offers no Approve.

---

# Wave C — Four pages

## Task 8: Split the settings page into Skills · MCP · Agents · All Tools

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx:5` (`View` union), nav buttons ~`:453-465` and the collapsed rail ~`:295`
- Modify: `src/renderer/src/App.tsx:48,994,1116,1128,1255` (state, dispatch, the `onOpenMcp` deep link)
- Modify: `src/renderer/src/components/AgentsView.tsx` — split into four page components; the shared `Section` helper stays
- Create: `src/renderer/src/components/SkillsView.tsx`, `src/renderer/src/components/McpView.tsx`, `src/renderer/src/components/AllToolsView.tsx` (the Tools section moves into the last one; Wave D fills in its top block)

**Interfaces:**
- Produces: `type View = "chat" | "settings" | "skills" | "mcp" | "agents" | "tools"`. Wave D's built-in tools block mounts inside `AllToolsView`.

- [ ] **Step 1: Widen the union and the router**

`Sidebar.tsx:5`:

```ts
export type View = "chat" | "settings" | "skills" | "mcp" | "agents" | "tools";
```

Add four nav entries (Skills / MCP / Agents / All Tools) in both the expanded nav and the collapsed icon rail, following the existing button markup exactly.

In `App.tsx`, replace the single `activeView === "agents"` branch with four branches rendering `SkillsView`, `McpView`, `AgentsView`, `AllToolsView`. Repoint `onOpenMcp={() => setView("mcp")}` at `:1255`.

- [ ] **Step 2: Move the sections**

- `SkillsView` = the existing `Section title="Global skills"` wrapper around `<SkillsSection scope="global" …/>`.
- `McpView` = `<McpServersSection embedded />`.
- `AgentsView` keeps the Agents list + `AgentEditor` and drops the other three sections.
- `AllToolsView` takes the Tools list (`ToolRowItem`, `TOOLS_PREVIEW`, `showAllTools`, the `evalRules` join and `toolRows` state — move them wholesale, they are only used there).

Each page keeps its own `<h1>` matching its sidebar label.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean. Fix every `View` exhaustiveness error the compiler reports — that list is the complete set of call sites.

- [ ] **Step 4: Suite + commit**

```bash
npm test
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/components/AgentsView.tsx src/renderer/src/components/SkillsView.tsx src/renderer/src/components/McpView.tsx src/renderer/src/components/AllToolsView.tsx
git commit -m "feat(nav): split Skills / MCP / Agents / All Tools into four sidebar pages"
```

- [ ] **Step 5: GUI pass (Wave C gate)**

Screenshot each of the four pages; confirm the composer "+" → MCP deep link lands on the MCP page and that no page lost a section.

---

# Wave D — Built-in tools become configurable

## Task 9: A global "built-in tools" config, honoured at spawn

Plan mode and `ask_user` are registered unconditionally in the bridge. They need a global on/off resolved at spawn, applied live via the existing reload machinery.

**Files:**
- Modify: `src/main/config.ts` (global settings: `builtinTools?: { plan?: boolean; askUser?: boolean }`, default both `true`)
- Modify: `src/main/pi/spawn.ts` (pass `HV_BUILTINS` — a JSON string, same shape — alongside `HV_BYPASS`)
- Modify: `src/main/ipc.ts` (`hv:builtins-get` / `hv:builtins-set`; the setter calls `scheduleRuntimeReload("skills", "global", null)` — reuse the existing reason, this is the same respawn path)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (gate registration at `:786` `ask_user`, `:879` `plan_complete`, `:916` `plan_start`, `:939` `plan_status_update`, plus the `/hv-plan` command and the `planSection` injection at `:309`)
- Create: `pi-runtime/extensions/hv-builtins.ts` (pure parser)
- Test: `tests/hv-builtins.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface BuiltinToggles { plan: boolean; askUser: boolean; planAppend: string }
  export function parseBuiltins(raw: string | undefined): BuiltinToggles; // defaults: plan true, askUser true, planAppend ""
  ```
  Task 10 consumes `planAppend`.

- [ ] **Step 1: Write the failing test**

Create `tests/hv-builtins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("parseBuiltins", () => {
  it("defaults everything on when unset", () => {
    expect(parseBuiltins(undefined)).toEqual({ plan: true, askUser: true, planAppend: "" });
  });
  it("reads explicit offs", () => {
    expect(parseBuiltins(JSON.stringify({ plan: false, askUser: true }))).toEqual({ plan: false, askUser: true, planAppend: "" });
  });
  it("carries the plan prompt append", () => {
    expect(parseBuiltins(JSON.stringify({ planAppend: "Prefer small diffs." })).planAppend).toBe("Prefer small diffs.");
  });
  it("defaults on for corrupt input rather than silently disabling a tool", () => {
    expect(parseBuiltins("{not json")).toEqual({ plan: true, askUser: true, planAppend: "" });
  });
});
```

- [ ] **Step 2: Run it — fails** (`Cannot find module`).

Run: `npx vitest run tests/hv-builtins.test.ts`

- [ ] **Step 3: Implement**

Create `pi-runtime/extensions/hv-builtins.ts`:

```ts
/**
 * §13 round 6 — which built-in custom tools this session may register, plus the
 * user's append to Plan Mode's prompt. Resolved by main at spawn and passed in
 * HV_BUILTINS (same pattern as HV_BYPASS). Fail-open: a corrupt value must
 * never silently disable a tool the user believes is on.
 */
export interface BuiltinToggles {
  plan: boolean;
  askUser: boolean;
  planAppend: string;
}

export function parseBuiltins(raw: string | undefined): BuiltinToggles {
  const out: BuiltinToggles = { plan: true, askUser: true, planAppend: "" };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<{ plan: boolean; askUser: boolean; planAppend: string }>;
    if (p.plan === false) out.plan = false;
    if (p.askUser === false) out.askUser = false;
    if (typeof p.planAppend === "string") out.planAppend = p.planAppend;
  } catch {
    /* fail open */
  }
  return out;
}
```

- [ ] **Step 4: Run the test — passes.**

- [ ] **Step 5: Gate registration in the bridge**

Near the top of the bridge's activate path:

```ts
const builtins = parseBuiltins(process.env.HV_BUILTINS);
```

Then: wrap `pi.registerTool({ name: "ask_user" … })` in `if (builtins.askUser) { … }`; wrap the three plan tools **and** the `/hv-plan` command registration in `if (builtins.plan) { … }`; and make the per-turn injection `const planSection = builtins.plan && plan.enabled ? "\n\n" + buildPlanPrompt(builtins.planAppend) : "";` (the append parameter arrives in Task 10 — until then call `buildPlanPrompt()`).

- [ ] **Step 6: Config + spawn + IPC**

Add `builtinTools` to the global config shape with both defaults `true`; resolve it in the same place `spawnOpts` resolves `HV_BYPASS` and pass `HV_BUILTINS: JSON.stringify({plan, askUser, planAppend})`. Add `hv:builtins-get`/`hv:builtins-set` handlers; the setter writes config, then `scheduleRuntimeReload("skills", "global", null)`.

- [ ] **Step 7: Gate + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npm test
git add pi-runtime/extensions/hv-builtins.ts pi-runtime/extensions/happyvibe-bridge.ts src/main/config.ts src/main/pi/spawn.ts src/main/ipc.ts tests/hv-builtins.test.ts
git commit -m "feat(tools): global enable/disable for built-in tools (plan mode, ask_user)"
```

---

## Task 10: Plan-mode prompt — read-only display plus an append

`buildPlanPrompt()` in `pi-runtime/extensions/hv-plan.ts:191` takes no arguments. It is a pure module, so main can import it directly to show the text — no duplicated string.

**Files:**
- Modify: `pi-runtime/extensions/hv-plan.ts:191` (`buildPlanPrompt(append = "")`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (pass `builtins.planAppend`)
- Modify: `src/main/ipc.ts` (`hv:builtin-prompt` returning `{ text }` from `buildPlanPrompt()`)
- Test: `tests/hv-plan.test.ts` (extend)

**Interfaces:**
- Consumes: `BuiltinToggles.planAppend` (Task 9).
- Produces: `buildPlanPrompt(append?: string): string` — appends after the built-in body, separated by a blank line, marker unchanged. `hv:builtin-prompt(name: "plan") → { text: string }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/hv-plan.test.ts`:

```ts
it("appends the user's addition after the built-in body, keeping the marker first", () => {
  const base = buildPlanPrompt();
  const withAppend = buildPlanPrompt("Prefer small diffs.");
  expect(withAppend.startsWith(base)).toBe(true);
  expect(withAppend.endsWith("Prefer small diffs.")).toBe(true);
  expect(buildPlanPrompt("   ")).toBe(base); // whitespace-only adds nothing
});
```

- [ ] **Step 2: Run it — fails** (append ignored).

Run: `npx vitest run tests/hv-plan.test.ts`

- [ ] **Step 3: Implement**

```ts
export function buildPlanPrompt(append = ""): string {
  const body = `${PLAN_PROMPT_MARKER}
# Plan Mode (read-only)
…existing text, unchanged…`;
  const extra = append.trim();
  return extra ? `${body}\n\n${extra}` : body;
}
```

Do not restructure the existing body. The append is additive only — enforcement remains `gatePlanCall`.

- [ ] **Step 4: Run the test — passes. Then expose the text to the renderer**

```ts
  ipcMain.handle("hv:builtin-prompt", (_e, name: string) => {
    if (name !== "plan") return { text: "" };
    return { text: buildPlanPrompt() };
  });
```

Import `buildPlanPrompt` from the runtime extensions path already used by main for other `hv-*` pure modules.

- [ ] **Step 5: Gate + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npm test
git add pi-runtime/extensions/hv-plan.ts pi-runtime/extensions/happyvibe-bridge.ts src/main/ipc.ts tests/hv-plan.test.ts
git commit -m "feat(tools): plan-mode prompt append (built-in text stays read-only)"
```

---

## Task 11: The All Tools page's built-in block

**Files:**
- Modify: `src/renderer/src/components/AllToolsView.tsx` (from Task 8)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts` (`builtinsGet`, `builtinsSet`, `builtinPrompt`)

**Interfaces:**
- Consumes: `hv:builtins-get/-set` (Task 9), `hv:builtin-prompt` (Task 10).

- [ ] **Step 1: Render the block above the active list**

Two rows — **Plan mode** and **Ask user** — each with a name, one-line description, and an on/off toggle calling `builtinsSet`. Plan mode's row expands to show: the read-only prompt in a scrollable `<pre>` (from `builtinPrompt("plan")`), a labelled "Your additions" textarea bound to `planAppend`, a Save button, and this hint:

> "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told. Your additions are appended after it. Add preferences (e.g. 'always list affected files'), not contradictions."

Plan mode's toggle needs a confirm: turning it off removes the chat controls **and** the `plan_start` / `plan_complete` / `plan_status_update` tools, and respawns live sessions.

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.web.json && npm test
git add src/renderer/src/components/AllToolsView.tsx src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(tools): built-in custom tools block on the All Tools page"
```

- [ ] **Step 3: Live-Pi verification (Wave D gate)**

Extend `tests/plan-bridge.test.ts` with a case spawning the bridge with `HV_BUILTINS='{"plan":false}'` and asserting via `get_commands` / a `plan_start` attempt that the plan tools are absent, then run the live files batched:

```bash
npx vitest run tests/bridge.test.ts tests/rules-bridge.test.ts tests/intent-bridge.test.ts tests/ask-user-bridge.test.ts tests/agents-md-bridge.test.ts tests/subagent-context.test.ts tests/subagent-async-bridge.test.ts tests/subagent-discovery-bridge.test.ts tests/permission-coexistence.test.ts tests/mcp-bridge.test.ts tests/plan-bridge.test.ts tests/skills-bridge.test.ts
```

One failure ⇒ rerun that file in isolation before calling it a regression. Requires `DEEPSEEK_API_KEY` in `.env`.

---

# Wave E — Session visibility

## Task 12: Chat top bar shows this session's skills

Main already writes the per-session manifest (`skillsManifestDir/<sessionId>.json`) and only reads it for `sessionHasSkill`. The renderer currently **drops** `hv.skill` notifies with `detected:false` (`App.tsx:405-417`), so `use_skill` invocations are invisible outside the tool card.

**Files:**
- Modify: `src/main/ipc.ts` (`hv:skills-session(sessionId)` → `{ name, scope }[]` read from the manifest)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Modify: `src/renderer/src/App.tsx:405-417` (track invoked names for BOTH detected values; keep the transcript notice for `detected:true` only)
- Modify: `src/renderer/src/components/ChatView.tsx:322-374` (the chip)

**Interfaces:**
- Produces: `skillsSession(sessionId): Promise<{ name: string; scope: "global" | "workspace" }[]>`; `ChatView` prop `sessionSkills: { name: string; scope: string; used: boolean }[]`.

- [ ] **Step 1: Return the loaded set from main**

```ts
  ipcMain.handle("hv:skills-session", (_e, sessionId: string) => {
    try {
      const m = JSON.parse(fs.readFileSync(sessionManifestPath(sessionId), "utf8")) as { skills?: { name: string; scope: "global" | "workspace" }[] };
      return (m.skills ?? []).map((s) => ({ name: s.name, scope: s.scope }));
    } catch {
      return [];
    }
  });
```

Use the same manifest path helper `buildManifest` writes to.

- [ ] **Step 2: Track invocations in the renderer**

In the `hv.skill` handler, before the existing `detected` branch, record the name in a `Set` of used skills for that session (state alongside the other per-session UI state). Leave the `detected:true` transcript notice exactly as it is.

- [ ] **Step 3: Add the chip**

In the top bar's left cluster (lift `mr-auto` onto a shared container so the plan group and this chip can coexist), render when `sessionSkills.length > 0`:

```tsx
  <button className="rounded-full bg-plum-soft text-plum text-[11px] font-bold px-2 py-0.5" onClick={() => setShowSkills((v) => !v)}>
    🧠 {sessionSkills.filter((s) => s.used).length}/{sessionSkills.length} skills
  </button>
```

Expanding lists each skill with a "used" marker on the ones invoked this session. Keep it a popover in the bar — do not add a banner row.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx
git commit -m "feat(chat): top-bar chip showing this session's loaded and used skills"
```

---

## Task 13: `/skill:` autocomplete off Pi's `get_commands`

Pi registers each loaded skill as a `/skill:<name>` command (`enableSkillCommands` defaults true) and lists them over `get_commands` with `source:"skill"` — the same call `tests/skills-contract.test.ts` asserts. `PiClient.send({type})` already returns a `Promise<PiResponse>`, so no new transport is needed. Typing the command already works; only discovery is missing.

**Files:**
- Modify: `src/main/ipc.ts` (`hv:list-commands(sessionId)`)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Modify: `src/renderer/src/mentions.ts` (or a sibling module following its shape) + `src/renderer/src/components/ChatView.tsx` composer
- Test: `tests/skills-bridge.test.ts` (extend — live)

**Interfaces:**
- Produces: `listCommands(sessionId): Promise<{ name: string; source: string }[]>` — full list, unfiltered; the renderer filters to `source === "skill"` for V1.

- [ ] **Step 1: Add the main handler**

```ts
  ipcMain.handle("hv:list-commands", async (_e, sessionId: string) => {
    const res = await (await anyClient(sessionId)).send({ type: "get_commands" });
    const cmds = (res as { commands?: { name?: string; source?: string }[] }).commands ?? [];
    return cmds.filter((c) => typeof c.name === "string").map((c) => ({ name: c.name!, source: c.source ?? "" }));
  });
```

- [ ] **Step 2: Wire the composer**

When the composer's text matches `/^\/[\w:-]*$/` at the caret, fetch once per session (cache it; the set only changes on respawn, which already triggers `/hv-tools`) and show the existing @-mention dropdown filtered to `source === "skill"`, inserting the full `/skill:<name>` on select. Reuse `mentions.ts` filtering/keyboard handling rather than writing a second dropdown.

- [ ] **Step 3: Extend the live test**

In `tests/skills-bridge.test.ts`, assert `get_commands` lists the approved skill as `skill:<name>` and that the unapproved one is absent (the enforcement assertion already exists in `tests/skills-contract.test.ts`; this one covers the path the composer uses).

- [ ] **Step 4: Full gate (Wave E gate)**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test && npm run build
```

Then the live files batched (command in Task 11 Step 3). Then a GUI pass: type `/` in the composer and confirm the skill commands appear and insert correctly.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/mentions.ts src/renderer/src/components/ChatView.tsx tests/skills-bridge.test.ts
git commit -m "feat(chat): /skill: autocomplete sourced from Pi's get_commands

Closes the sk1.md deferral without building a slash-command framework."
```

---

## Docs to update when the plan completes

- `docs/validation/sk1.md` — replace the "Composer `/skill:name` autocomplete" deferral with how it shipped (`get_commands`, `source:"skill"`); add the `HV_BUILTINS` wire shape and the `hv:skills-delete` contract.
- `CLAUDE.md` — add the missing Skills gotcha (the `--no-skills` + `--skill` trust invariant, `HV_SKILLS_FILE`, `use_skill` in `SAFE_TOOLS`+`INTENT_TOOLS`), record `HV_BUILTINS`, and fix the MCP live-reload paragraph, which still names `scheduleMcpReload` (now `scheduleRuntimeReload(reason)`).
- `docs/validation/d1.md` — add `hv.skill` session-visibility and `get_commands` usage if new wire shapes appear.
