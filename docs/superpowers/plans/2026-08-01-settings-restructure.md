# Settings Restructure (Feedbacks v8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat seven-item sidebar footer and the single packed Settings scroll with one collapsible Settings group whose children are real pages — including an editable keyboard-shortcuts page — turn workspace settings from a dialog into a page, and make workspaces collapsible in the sidebar.

**Architecture:** Renderer-only, plus one new key in the existing `config.json` store. `SettingsView.tsx` (891 lines) is dismantled into five focused pages that reuse the page shell already used by `McpView`/`SkillsView`; the shortcut registry becomes the single source that three existing dispatch sites read from instead of hardcoding their own keys. No bridge change, no `pi-runtime` change, no pin exposure.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4, Radix (being *removed* from workspace settings), CodeMirror 6, vitest.

## Global Constraints

- **Source doc:** Notion "Feedbacks v8 on Settings" (`3afd33dfffca8084bec1ca071f1e38ba`). PRD decisions already folded: `docs/prd.md` §7, §16, §17, §19 and the Notion PRD mirror.
- **No bridge / no `pi-runtime` edits.** The 14 live-Pi tests are NOT part of this gate (`grep -rl 'skipIf(!KEY' tests/`).
- **Full gate:** `npm run typecheck` (node + web) · non-live suite · `npm run build` · GUI pass.
  Non-live suite command (CLAUDE.md §Tests):
  `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
- **`src/main` changes need a dev-server RESTART** — a renderer reload does not rebuild main. Verify the built artifact (`grep '<change>' out/main/index.js`), never the source.
- **Canonical shortcut format is CodeMirror's** (`"Mod-s"`, `"Mod-Shift-e"`, `"Mod-,"`). `Mod` = ⌘ on macOS, Ctrl elsewhere — matching the app's existing `metaKey || ctrlKey` handling.
- **Page shell for every new page** (copy from `src/renderer/src/components/McpView.tsx:22-30`):
  `<div className="flex-1 overflow-y-auto"><div className="max-w-3xl mx-auto w-full px-8 py-10">` + `<h1 className="font-black text-3xl tracking-tight mb-2">` + a `text-sm text-ink-soft mb-8` subtitle + `<Section>` cards.
- **Warm-workshop styling is not up for reinvention** — reuse the existing class strings verbatim when moving blocks.

---

## File Structure

**Created**
| File | Responsibility |
| --- | --- |
| `src/renderer/src/components/ModelsView.tsx` | Provider setup + global default model (ex-"LLM Setup"), incl. first-run onboarding |
| `src/renderer/src/components/PermissionsView.tsx` | Global rules + bypass toggle |
| `src/renderer/src/components/SystemPromptView.tsx` | Resolved prompt (read-only) + global additions |
| `src/renderer/src/components/StatsView.tsx` | Page shell around `DashboardView` |
| `src/renderer/src/components/AuditLogView.tsx` | Page shell around `AuditView` |
| `src/renderer/src/components/ShortcutsView.tsx` | Editable shortcut page |
| `src/renderer/src/components/WorkspaceSettingsView.tsx` | Workspace settings as a page |
| `tests/shortcuts.test.ts` | Unit tests for the pure shortcut logic |

**Modified**
`src/renderer/src/shortcuts.ts` (registry + pure helpers) · `src/renderer/src/components/Section.tsx` (icon set) · `src/renderer/src/components/Sidebar.tsx` (group, rail, workspace collapse) · `src/renderer/src/App.tsx` (routing, bindings, dispatch) · `src/renderer/src/components/ChatView.tsx` (search binding) · `src/renderer/src/components/FileTab.tsx` + `EditorPane.tsx` (save/search bindings) · `src/main/config.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `src/renderer/src/hv.d.ts` · `src/main/appendSystem.ts` · `tests/append-system.test.ts`

**Deleted**
`src/renderer/src/components/SettingsView.tsx` · `src/renderer/src/components/ShortcutsDialog.tsx` · `src/renderer/src/components/WorkspaceSettingsModal.tsx`

`OnboardingOverlay.tsx` **stays** (first-run only; its Help re-open path is removed).

---

## Task 1: Shortcut registry and pure logic

**Files:**
- Modify (rewrite): `src/renderer/src/shortcuts.ts`
- Test: `tests/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ShortcutId`, `SHORTCUT_ACTIONS: ShortcutAction[]`, `FIXED_SHORTCUTS`, `eventToBinding(e): string | null`, `matchesBinding(e, binding): boolean`, `formatBinding(binding, mac?): string`, `resolveBindings(saved): Record<ShortcutId, string>`, `findConflict(bindings, id, binding): ShortcutId | null`.

**Design note — why one `search` action, not two:** chat search and editor search share ⌘F today and are disambiguated by focus (`ChatView.tsx:341` bails when `.cm-editor` has focus). Modelling them as two actions would make the default configuration self-conflicting on first render. One action, two focus-scoped consumers.

- [ ] **Step 1: Write the failing test**

Create `tests/shortcuts.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  SHORTCUT_ACTIONS, eventToBinding, matchesBinding, formatBinding,
  resolveBindings, findConflict, type ShortcutId,
} from "../src/renderer/src/shortcuts";

const ev = (o: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

test("eventToBinding builds the canonical CodeMirror form", () => {
  expect(eventToBinding(ev({ key: "e", metaKey: true, shiftKey: true }))).toBe("Mod-Shift-e");
  expect(eventToBinding(ev({ key: "N", metaKey: true }))).toBe("Mod-n");
  expect(eventToBinding(ev({ key: ",", ctrlKey: true }))).toBe("Mod-,");
});

test("meta and ctrl both mean Mod — the app never distinguished them", () => {
  expect(eventToBinding(ev({ key: "b", metaKey: true }))).toBe(eventToBinding(ev({ key: "b", ctrlKey: true })));
});

test("a bare key or a lone modifier is not a binding", () => {
  expect(eventToBinding(ev({ key: "a" }))).toBeNull();
  expect(eventToBinding(ev({ key: "Meta", metaKey: true }))).toBeNull();
  expect(eventToBinding(ev({ key: "Shift", shiftKey: true }))).toBeNull();
});

test("matchesBinding is the exact inverse of capture", () => {
  const e = ev({ key: "E", metaKey: true, shiftKey: true });
  expect(matchesBinding(e, "Mod-Shift-e")).toBe(true);
  expect(matchesBinding(e, "Mod-e")).toBe(false);
});

test("formatBinding renders mac glyphs, and words elsewhere", () => {
  expect(formatBinding("Mod-Shift-e")).toBe("⌘⇧E");
  expect(formatBinding("Mod-,")).toBe("⌘,");
  expect(formatBinding("Mod-n", false)).toBe("Ctrl+N");
});

test("resolveBindings falls back to defaults and ignores unknown ids", () => {
  const defaults = resolveBindings(null);
  for (const a of SHORTCUT_ACTIONS) expect(defaults[a.id]).toBe(a.defaultKey);
  const overridden = resolveBindings({ newSession: "Mod-Shift-n", bogusAction: "Mod-x", save: "" });
  expect(overridden.newSession).toBe("Mod-Shift-n");
  expect(overridden.save).toBe("Mod-s"); // empty string is not an override
  expect("bogusAction" in overridden).toBe(false);
});

test("findConflict names the action that already owns a combo", () => {
  const b = resolveBindings(null);
  expect(findConflict(b, "newSession" as ShortcutId, b.toggleSidebar)).toBe("toggleSidebar");
  expect(findConflict(b, "newSession" as ShortcutId, b.newSession)).toBeNull(); // itself is not a conflict
  expect(findConflict(b, "newSession" as ShortcutId, "Mod-Shift-y")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: FAIL — `eventToBinding` is not exported from `shortcuts.ts`.

- [ ] **Step 3: Rewrite `src/renderer/src/shortcuts.ts`**

```ts
/**
 * F6 → round 8: the keyboard-shortcut registry — the single source for the
 * shortcuts PAGE and for every site that dispatches a shortcut.
 *
 * Canonical binding format is CodeMirror's ("Mod-s", "Mod-Shift-e"), because
 * one of the three dispatch sites IS a CodeMirror keymap (EditorPane) — storing
 * our own format would buy a translation layer that only that site reads.
 * "Mod" = ⌘ on macOS, Ctrl elsewhere, matching the app's existing
 * `metaKey || ctrlKey` handling.
 */

export type ShortcutId =
  | "newSession"
  | "closeTab"
  | "save"
  | "search"
  | "toggleSidebar"
  | "toggleFileDrawer"
  | "openSettings"
  | "openShortcuts";

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  defaultKey: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "newSession", label: "New session in the current workspace", defaultKey: "Mod-n" },
  { id: "closeTab", label: "Close the active file tab", defaultKey: "Mod-w" },
  { id: "save", label: "Save the open file", defaultKey: "Mod-s" },
  // One action, two consumers: whichever of the chat / the editor has focus.
  { id: "search", label: "Search the conversation or the open file", defaultKey: "Mod-f" },
  { id: "toggleSidebar", label: "Show or hide the workspace panel", defaultKey: "Mod-b" },
  { id: "toggleFileDrawer", label: "Show or hide the file drawer", defaultKey: "Mod-Shift-e" },
  { id: "openSettings", label: "Open Settings", defaultKey: "Mod-," },
  { id: "openShortcuts", label: "Open keyboard shortcuts", defaultKey: "Mod-/" },
];

/** Composer and dialog semantics, not bindings — rebinding them breaks typing.
    Listed on the page with a "built-in" tag so the page stays a complete map. */
export const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Enter", label: "Send the message" },
  { keys: "⇧Enter", label: "New line in the composer" },
  { keys: "@", label: "Reference a file or folder in the composer" },
  { keys: "Esc", label: "Close a dialog or search" },
];

type KeyEventish = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

/** A KeyboardEvent → its canonical binding, or null when it isn't one. */
export function eventToBinding(e: KeyEventish): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (parts.length === 0) return null; // a bare key is never an app shortcut
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("-");
}

/** Match by canonical form, so capture and dispatch can never disagree. */
export function matchesBinding(e: KeyEventish, binding: string): boolean {
  return eventToBinding(e) === binding;
}

export function formatBinding(binding: string, mac = true): string {
  return binding
    .split("-")
    .map((p) => {
      if (p === "Mod") return mac ? "⌘" : "Ctrl+";
      if (p === "Shift") return mac ? "⇧" : "Shift+";
      if (p === "Alt") return mac ? "⌥" : "Alt+";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("");
}

/** Stored overrides layered over the defaults. Unknown ids are dropped, so a
    renamed action can never resurrect a stale binding from an old config. */
export function resolveBindings(saved: Record<string, string> | null | undefined): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const a of SHORTCUT_ACTIONS) {
    const s = saved?.[a.id];
    out[a.id] = typeof s === "string" && s.length > 0 ? s : a.defaultKey;
  }
  return out;
}

/** The OTHER action already holding `binding`, if any. */
export function findConflict(
  bindings: Record<ShortcutId, string>,
  id: ShortcutId,
  binding: string,
): ShortcutId | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id !== id && bindings[a.id] === binding) return a.id;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/shortcuts.ts tests/shortcuts.test.ts
git commit -m "feat(shortcuts): registry + pure binding logic (round 8)"
```

---

## Task 2: Persist bindings in app config

**Files:**
- Modify: `src/main/config.ts` (interface `ConfigFile` ~line 40, new exported pair near `getLongCache`, line 265)
- Modify: `src/main/ipc.ts:1405-1406` (add beside the long-cache handlers)
- Modify: `src/preload/index.ts:185-186` (same neighbourhood)
- Modify: `src/renderer/src/hv.d.ts:402-403` (same neighbourhood)

**Interfaces:**
- Consumes: Task 1's canonical string format (opaque here — main never parses it).
- Produces: `window.hv.getShortcuts(): Promise<Record<string,string>>`, `window.hv.setShortcuts(map): Promise<void>`.

**Note on testing:** `config.ts` imports `electron`, so it has no direct unit test in this repo (nothing else in `tests/` touches it either — `cache-retention.test.ts` pins the *spawn* side instead). Verification here is the typecheck plus Task 9's GUI pass; the logic that could actually be wrong is pure and lives in Task 1.

- [ ] **Step 1: Add the config field and accessors**

In `ConfigFile` (after the `mcpSecrets` entry):

```ts
  /** Round 8: user-remapped keyboard shortcuts, action id → canonical binding
      ("Mod-Shift-e"). An absent id means that action keeps its default. */
  shortcuts?: Record<string, string>;
```

After `setLongCache` (line ~269):

```ts
/** Round 8: shortcut overrides. Stored whole — the renderer owns the merge with
    defaults (shortcuts.ts resolveBindings), so main never has to know the
    action list. */
export function getShortcuts(): Record<string, string> {
  return load().shortcuts ?? {};
}

export function setShortcuts(map: Record<string, string>): void {
  const cfg = load();
  cfg.shortcuts = map;
  save(cfg);
}
```

- [ ] **Step 2: Wire the IPC**

`src/main/ipc.ts` — add `getShortcuts, setShortcuts` to the existing import list from `./config` (lines 10-13), then beside the long-cache handlers:

```ts
  ipcMain.handle("hv:get-shortcuts", () => getShortcuts());
  ipcMain.handle("hv:set-shortcuts", (_e, map: Record<string, string>) => setShortcuts(map ?? {}));
```

`src/preload/index.ts`:

```ts
  getShortcuts: () => ipcRenderer.invoke("hv:get-shortcuts"),
  setShortcuts: (map: Record<string, string>) => ipcRenderer.invoke("hv:set-shortcuts", map),
```

`src/renderer/src/hv.d.ts`:

```ts
  getShortcuts(): Promise<Record<string, string>>;
  setShortcuts(map: Record<string, string>): Promise<void>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS, both projects.

- [ ] **Step 4: Commit**

```bash
git add src/main/config.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(shortcuts): persist bindings in app config"
```

---

## Task 3: Dispatch from the registry (App, ChatView, EditorPane)

**Files:**
- Modify: `src/renderer/src/App.tsx:1104-1120` (global handler), state block near line 114
- Modify: `src/renderer/src/components/ChatView.tsx:337-351`
- Modify: `src/renderer/src/components/FileTab.tsx` (pass-through props)
- Modify: `src/renderer/src/components/EditorPane.tsx:155-180`

**Interfaces:**
- Consumes: `resolveBindings`, `matchesBinding`, `eventToBinding`, `ShortcutId` (Task 1); `window.hv.getShortcuts` (Task 2).
- Produces: App state `bindings: Record<ShortcutId, string>` and `setBindings`, passed to `ChatView` (`searchKey: string`) and `FileTab` (`saveKey: string`, `searchKey: string`) → `EditorPane` (same two props).

- [ ] **Step 1: Load bindings in App**

`src/renderer/src/App.tsx`, beside the other UI state (near line 114):

```tsx
  // Round 8: shortcut bindings, defaults until config answers.
  const [bindings, setBindings] = useState<Record<ShortcutId, string>>(() => resolveBindings(null));
  useEffect(() => { void window.hv.getShortcuts().then((m) => setBindings(resolveBindings(m))); }, []);
```

Import: `import { eventToBinding, resolveBindings, type ShortcutId } from "./shortcuts";`

- [ ] **Step 2: Rewrite the global handler**

Replace the body of `shortcutRef.current` (`App.tsx:1104-1120`) with:

```tsx
  shortcutRef.current = (e: KeyboardEvent): void => {
    const b = eventToBinding(e);
    if (!b) return;
    const is = (id: ShortcutId): boolean => bindings[id] === b;
    if (is("toggleSidebar")) { e.preventDefault(); setSidebarCollapsed((c) => !c); return; }
    if (is("toggleFileDrawer")) { e.preventDefault(); setTreeOpen((o) => !o); return; }
    if (is("newSession")) {
      e.preventDefault();
      const ws = wsId ?? workspaces[0];
      if (ws) void newSession(ws);
      return;
    }
    if (is("openSettings")) { e.preventDefault(); if (!needsSetup) setView("models"); return; }
    if (is("openShortcuts")) { e.preventDefault(); if (!needsSetup) setView("shortcuts"); return; }
    if (is("closeTab")) {
      // Close the first closable (non-chat) active tab; window close is ⌘⇧W.
      if (!wsId) return;
      const i = wsTabs.panes.findIndex((p) => p.active && p.active !== CHAT_TAB);
      if (i >= 0) { e.preventDefault(); closeFileTab(wsId, i, wsTabs.panes[i].active!); }
    }
  };
```

`"models"` and `"shortcuts"` don't exist in `View` yet — Task 5 and Task 4 add them. Add them to the union in `Sidebar.tsx:6` now so this typechecks:

```ts
export type View =
  | "chat" | "skills" | "mcp" | "agents" | "tools"
  | "models" | "permissions" | "sysprompt" | "stats" | "audit" | "shortcuts"
  | "workspace";
```

Temporarily keep `"settings"` in the union too, so `SettingsView` still routes until Task 5 deletes it.

- [ ] **Step 3: Chat search reads its binding**

`ChatView.tsx` — add `searchKey: string` to the props type and the destructure, then in the keydown effect (line ~340):

```tsx
      if (matchesBinding(e, searchKey)) {
        // v5.1: when the code editor is focused, this is its search, not the chat's.
        if (document.activeElement?.closest(".cm-editor")) return;
        e.preventDefault();
        onSearchOpenChange(true);
      } else if (e.key === "Escape" && searchOpen) {
```

Add `searchKey` to that effect's dependency array. Import `matchesBinding` from `../shortcuts`. Pass `searchKey={bindings.search}` at the `ChatView` call site in App.

- [ ] **Step 4: Editor save/search read their bindings**

`EditorPane.tsx` — accept `saveKey` and `searchKey` props, keep them in the existing `cbs` ref, and put the keymap in a compartment so a rebind applies to already-open tabs (tabs stay mounted for the life of the app, so a remount would never happen):

```tsx
import { Compartment } from "@codemirror/state";
import { openSearchPanel, search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";

  const keysCompartment = useRef(new Compartment());

  const keymapFor = (saveKey: string, searchKey: string) =>
    keymap.of([
      { key: saveKey, preventDefault: true, run: () => (cbs.current.onSave(), true) },
      { key: searchKey, preventDefault: true, run: openSearchPanel },
      indentWithTab,
      // Drop CM's own Mod-f so a rebound search key is the only one that opens it.
      ...searchKeymap.filter((b) => b.key !== "Mod-f"),
      ...defaultKeymap,
      ...historyKeymap,
    ]);
```

In the `extensions` array, replace the inline `keymap.of([...])` with:

```tsx
          keysCompartment.current.of(keymapFor(cbs.current.saveKey, cbs.current.searchKey)),
```

and add, after the view is created:

```tsx
  // Rebinding applies live — an open editor tab is never remounted.
  useEffect(() => {
    view.current?.dispatch({
      effects: keysCompartment.current.reconfigure(keymapFor(saveKey, searchKey)),
    });
  }, [saveKey, searchKey]);
```

`FileTab.tsx` takes `saveKey` / `searchKey` and forwards them to `<CodeEditor>`; App passes `saveKey={bindings.save} searchKey={bindings.search}` at the `FileTab` call site (`App.tsx:1385`).

- [ ] **Step 5: Typecheck and verify by hand**

Run: `npm run typecheck` → PASS.
Run: `npm run dev`, then press ⌘B, ⌘⇧E, ⌘N, ⌘F in chat, ⌘F in an open file, ⌘S in an open file — every one behaves exactly as before (this task is a refactor; behaviour parity is the test).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx src/renderer/src/components/FileTab.tsx src/renderer/src/components/EditorPane.tsx src/renderer/src/components/Sidebar.tsx
git commit -m "refactor(shortcuts): dispatch from the registry instead of hardcoded keys"
```

---

## Task 4: The editable shortcuts page

**Files:**
- Create: `src/renderer/src/components/ShortcutsView.tsx`
- Delete: `src/renderer/src/components/ShortcutsDialog.tsx`
- Modify: `src/renderer/src/App.tsx` (route `"shortcuts"`, drop `shortcutsOpen` state and the dialog render at line 1413), `src/renderer/src/components/Sidebar.tsx` (the existing footer button navigates instead of opening a dialog)

**Interfaces:**
- Consumes: everything from Task 1; `window.hv.setShortcuts` (Task 2); App's `bindings` + `setBindings` (Task 3).
- Produces: `<ShortcutsView bindings={…} onChange={(next) => …} />` where `onChange` receives the full resolved map.

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from "react";
import { Section } from "./Section";
import {
  FIXED_SHORTCUTS, SHORTCUT_ACTIONS, eventToBinding, findConflict, formatBinding,
  type ShortcutId,
} from "../shortcuts";

const LABEL: Record<string, string> = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.label]));

/** Round 8: the shortcuts cheat sheet becomes a page where bindings are editable —
    a list you can only read is a manual. Capture writes the whole map back
    through main (config.json), so a rebind survives a restart. */
export function ShortcutsView({
  bindings,
  onChange,
}: {
  bindings: Record<ShortcutId, string>;
  onChange: (next: Record<ShortcutId, string>) => void;
}): React.JSX.Element {
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { setCapturing(null); setError(null); return; }
      const next = eventToBinding(e);
      if (!next) return; // still holding modifiers — keep listening
      e.preventDefault();
      e.stopPropagation();
      const clash = findConflict(bindings, capturing, next);
      if (clash) {
        setError(`${formatBinding(next)} is already used by "${LABEL[clash]}".`);
        return;
      }
      const merged = { ...bindings, [capturing]: next };
      setCapturing(null);
      setError(null);
      onChange(merged);
      void window.hv.setShortcuts(merged);
    };
    // Capture phase: the app's own global handler must not act on the combo
    // the user is assigning.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, bindings, onChange]);

  const apply = (next: Record<ShortcutId, string>): void => {
    onChange(next);
    void window.hv.setShortcuts(next);
  };

  const resetOne = (id: ShortcutId): void => {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultKey;
    const clash = findConflict(bindings, id, def);
    if (clash) { setError(`The default ${formatBinding(def)} is currently used by "${LABEL[clash]}".`); return; }
    setError(null);
    apply({ ...bindings, [id]: def });
  };

  const resetAll = (): void => {
    setError(null);
    apply(Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey])) as Record<ShortcutId, string>);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Keyboard shortcuts</h1>
        <p className="text-sm text-ink-soft mb-8">
          Click a shortcut to record a new one. Esc cancels.
        </p>

        <Section icon="keyboard" title="Editable" subtitle="Yours to change — stored on this machine.">
          {error && <p className="text-sm text-berry mb-3">{error}</p>}
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {SHORTCUT_ACTIONS.map((a) => {
              const isDefault = bindings[a.id] === a.defaultKey;
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0">
                  <span className="flex-1 text-sm">{a.label}</span>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => resetOne(a.id)}
                      className="text-xs font-bold text-ink-soft hover:text-tangerine cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setError(null); setCapturing(a.id); }}
                    className={`min-w-20 rounded-md border-2 px-2 py-0.5 font-mono text-xs font-bold shadow-sticker cursor-pointer ${
                      capturing === a.id ? "border-tangerine bg-honey-soft animate-pulse" : "border-line-strong bg-card"
                    }`}
                  >
                    {capturing === a.id ? "press…" : formatBinding(bindings[a.id])}
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="mt-3 rounded-lg border-2 border-line bg-card px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer hover:bg-paper-deep"
          >
            Reset all to defaults
          </button>
        </Section>

        <Section icon="keyboard" title="Built-in" subtitle="Typing and dialog behaviour — not rebindable.">
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {FIXED_SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0">
                <span className="flex-1 text-sm">{s.label}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">built-in</span>
                <kbd className="min-w-20 text-center rounded-md border-2 border-line bg-paper-deep px-2 py-0.5 font-mono text-xs font-bold">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the `keyboard` icon to the shared Section**

`src/renderer/src/components/Section.tsx`, in `SECTION_ICONS`:

```tsx
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
```

- [ ] **Step 3: Route it, delete the dialog**

In `App.tsx`: remove the `shortcutsOpen` state (line 116) and the `{shortcutsOpen && <ShortcutsDialog …>}` render (line 1413) and its import; add beside the other view renders:

```tsx
        {activeView === "shortcuts" && (
          <ShortcutsView bindings={bindings} onChange={setBindings} />
        )}
```

Change the Sidebar prop `onOpenShortcuts` to `() => setView("shortcuts")` (App) — the button and the rail icon keep working, they just navigate now.

```bash
rm src/renderer/src/components/ShortcutsDialog.tsx
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → PASS.
Run: `npx vitest run tests/shortcuts.test.ts` → PASS.
GUI: open the page, rebind "New session" to ⌘⇧N, confirm ⌘⇧N opens a session and plain ⌘N no longer does; try assigning ⌘B to it and confirm the refusal names "Show or hide the workspace panel"; Reset; restart the app and confirm a rebind survived.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src
git commit -m "feat(shortcuts): editable shortcuts page replaces the cheat-sheet dialog"
```

---

## Task 5: Split Settings into five pages

**Files:**
- Create: `ModelsView.tsx`, `PermissionsView.tsx`, `SystemPromptView.tsx`, `StatsView.tsx`, `AuditLogView.tsx` (all in `src/renderer/src/components/`)
- Delete: `src/renderer/src/components/SettingsView.tsx`
- Modify: `src/renderer/src/components/Section.tsx` (icons), `src/renderer/src/App.tsx` (routes, first-run)

**Interfaces:**
- Consumes: existing `PermissionRulesSection`, `AuditView`, `DashboardView`, `ModelSelect`, `AuthFlowModal`, `parseAuth`.
- Produces:
  - `<ModelsView firstRun={boolean} onSaved={() => void} />`
  - `<PermissionsView />`
  - `<SystemPromptView sessionId={string | null} />`
  - `<StatsView workspaces={string[]} />`
  - `<AuditLogView sessions={SessionMeta[]} workspaces={string[]} />`

**This is a move, not a rewrite.** Every block below already exists in `SettingsView.tsx`; carry the code and its comments across verbatim and change only the wrapper.

- [ ] **Step 1: Extend the shared Section icon set**

`Section.tsx` — add the five icons currently duplicated in `SettingsView.tsx:39-60`, renaming `llm` → `models` and `dashboard` → `stats`:

```tsx
  models: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  sysprompt: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  permissions: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  audit: (
    <>
      <path d="M9 12h6M9 16h6M9 8h2" />
      <path d="M5 4a1 1 0 0 1 1-1h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    </>
  ),
  stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
```

- [ ] **Step 2: `ModelsView.tsx`**

Move from `SettingsView.tsx`: `OAUTH_PROVIDERS`, `smallBtn`, `Chip`, `GroupLabel`, `LongCacheToggle`, the whole `SettingsView` body **minus** `SystemPromptSection`, the Permissions `<Section>`, and the audit/dashboard sub-page machinery (`page` state, the `if (page !== "main")` branch, the two push-buttons at lines 870-881).

Shell:

```tsx
export function ModelsView({ firstRun, onSaved }: { firstRun: boolean; onSaved: () => void }): React.JSX.Element {
  // …all the provider state and effects, unchanged…
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        {firstRun ? (
          /* the existing welcome hero, unchanged */
        ) : (
          <>
            <h1 className="font-black text-3xl tracking-tight mb-2">Models</h1>
            <p className="text-sm text-ink-soft mb-8">Providers the agent can talk to, and the default model.</p>
          </>
        )}
        <Section icon="models" title="Providers" subtitle="Sign in, add an API key, or point at a local server.">
          {/* configured summary + add-provider groups, unchanged */}
        </Section>
        {!firstRun && (
          <Section icon="models" title="Default model" subtitle="Used for new sessions unless a workspace or session overrides it.">
            {/* ModelSelect + hint + <LongCacheToggle /> , unchanged */}
          </Section>
        )}
      </div>
      {login && <AuthFlowModal providerLabel={login.label} event={login.event} onCancel={cancelLogin} onClose={closeLogin} />}
    </div>
  );
}
```

The `sessions` / `workspaces` props go away here — they only fed the embedded audit view.

- [ ] **Step 3: `PermissionsView.tsx`**

```tsx
import { PermissionRulesSection } from "./PermissionRulesSection";
import { Section } from "./Section";
// GlobalBypassToggle moves here verbatim from SettingsView.tsx:249-305.

export function PermissionsView(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Permissions</h1>
        <p className="text-sm text-ink-soft mb-8">
          Global rules for every workspace. Per-workspace overrides live in each workspace&apos;s settings.
        </p>
        <Section icon="permissions" title="Rules" subtitle="Evaluated by the same engine that enforces them.">
          <PermissionRulesSection />
          <GlobalBypassToggle />
        </Section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `SystemPromptView.tsx`**

Move `parseSysprompt`, `SYSPROMPT_CACHE_KEY` and the `SystemPromptSection` body verbatim (`SettingsView.tsx:108-210`); wrap in the page shell with `<h1>System prompt</h1>` and keep the existing `<Section icon="sysprompt" …>` inside it.

- [ ] **Step 5: `StatsView.tsx` and `AuditLogView.tsx`**

```tsx
export function StatsView({ workspaces }: { workspaces: string[] }): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-8 pt-10 pb-2 shrink-0">
        <h1 className="font-black text-3xl tracking-tight mb-2">Stats</h1>
        <p className="text-sm text-ink-soft">Local-only. Nothing here is ever sent anywhere.</p>
      </div>
      <DashboardView workspaces={workspaces} />
    </div>
  );
}
```

`AuditLogView` is the same shape around `<AuditView sessions={sessions} workspaces={workspaces} />` with the subtitle "Every tool call, permission decision, and file change, per session and per workspace." Both content components already scroll internally — do NOT wrap them in the `max-w-3xl` column, which would fight their own layout.

- [ ] **Step 6: Route them and delete `SettingsView`**

`App.tsx`:

```tsx
  const activeView: View = needsSetup ? "models" : view;
```

```tsx
        {activeView === "models" && (
          <ModelsView firstRun={needsSetup} onSaved={() => { setKeyState("present"); setView("chat"); }} />
        )}
        {activeView === "permissions" && <PermissionsView />}
        {activeView === "sysprompt" && <SystemPromptView sessionId={selectedId} />}
        {activeView === "stats" && <StatsView workspaces={workspaces} />}
        {activeView === "audit" && <AuditLogView sessions={sessions} workspaces={workspaces} />}
```

Remove `"settings"` from the `View` union and the old `{activeView === "settings" && <SettingsView …>}` block, then:

```bash
rm src/renderer/src/components/SettingsView.tsx
```

The Sidebar's "Settings" button is rewritten in Task 6; until then point it at `setView("models")` so nothing dangles.

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → PASS.
GUI: each of the five pages renders; a provider key still saves; the resolved system prompt still shows from cache at launch; the audit filters and the stats charts still work; first run still lands on the welcome hero.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/src
git commit -m "feat(settings): split the settings scroll into Models/Permissions/System prompt/Stats/Audit pages"
```

---

## Task 6: One collapsible Settings group in the sidebar

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` (footer lines 485-560, rail lines 291-342, props)
- Modify: `src/renderer/src/App.tsx` (drop `onOpenHelp`, keep `onboarding` for first run)

**Interfaces:**
- Consumes: `View` (extended in Task 3).
- Produces: Sidebar props lose `onOpenHelp` and `onOpenShortcuts`; navigation is `onNavigate(view)` for every entry.

- [ ] **Step 1: Replace the footer with the group**

```tsx
/** Round 8: every configuration destination lives under ONE collapsible group —
    the flat list had grown to seven entries. Open state persists (localStorage,
    same pattern as the rail's own collapsed state in App). */
const NAV: Array<{ view: View; label: string; icon: () => React.JSX.Element; dividerBefore?: boolean }> = [
  { view: "skills", label: "Skills", icon: SkillsIcon },
  { view: "mcp", label: "MCP", icon: McpIcon },
  { view: "agents", label: "Agents", icon: AgentsIcon },
  { view: "tools", label: "All Tools", icon: ToolsIcon },
  { view: "models", label: "Models", icon: ModelsIcon, dividerBefore: true },
  { view: "permissions", label: "Permissions", icon: PermissionsIcon },
  { view: "sysprompt", label: "System prompt", icon: SysPromptIcon },
  { view: "stats", label: "Stats", icon: StatsIcon },
  { view: "audit", label: "Audit log", icon: AuditIcon },
  { view: "shortcuts", label: "Keyboard shortcuts", icon: KeyboardIcon },
];
```

(The six new icon components are the same paths added to `Section.tsx` in Task 5 — inline them here as `size-4` SVGs in the file's existing icon style.)

```tsx
      <div className="p-4 border-t-2 border-line">
        <button
          type="button"
          onClick={() => onToggleSettingsOpen()}
          className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
        >
          <GearIcon />
          <span className="flex-1 text-left">Settings</span>
          <span className="text-ink-soft text-[10px]">{settingsOpen ? "▾" : "▸"}</span>
        </button>
        {settingsOpen && (
          <div className="mt-1 flex flex-col">
            {NAV.map((n) => (
              <div key={n.view}>
                {n.dividerBefore && <div className="border-t border-line my-1.5 mx-3" />}
                <button
                  type="button"
                  onClick={() => onNavigate(n.view)}
                  className={`w-full flex items-center gap-2.5 rounded-xl pl-6 pr-3.5 py-2 text-sm font-bold border-2 cursor-pointer transition-colors ${
                    view === n.view ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
                  }`}
                >
                  <n.icon />
                  {n.label}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
```

The Help button is deleted outright.

- [ ] **Step 2: One gear in the collapsed rail**

Replace the seven rail nav buttons (`Sidebar.tsx:320-340`) with one:

```tsx
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Settings"
          aria-label="Settings"
          className={railBtn(false)}
        >
          <GearIcon />
        </button>
```

Ten icons in a 48px rail is a wall; expanding the sidebar is what the workspace initials above already do on click.

- [ ] **Step 3: Persist the group state in App**

```tsx
  const [settingsOpen, setSettingsOpen] = useState(() => localStorage.getItem("hv:settings-open") === "1");
  useEffect(() => { localStorage.setItem("hv:settings-open", settingsOpen ? "1" : "0"); }, [settingsOpen]);
```

Pass `settingsOpen` and `onToggleSettingsOpen={() => setSettingsOpen((o) => !o)}`. In the two shortcut branches from Task 3, open the group as you navigate:

```tsx
    if (is("openSettings")) { e.preventDefault(); if (!needsSetup) { setSettingsOpen(true); setView("models"); } return; }
    if (is("openShortcuts")) { e.preventDefault(); if (!needsSetup) { setSettingsOpen(true); setView("shortcuts"); } return; }
```

Remove the `onOpenHelp` prop and the `onOpenShortcuts` prop from the Sidebar call; keep `onboarding`/`dismissOnboarding` and the `<OnboardingOverlay>` render (first-run only, no re-open path — PRD §7 round 8).

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → PASS.
GUI: the footer is one gear row; expanding shows ten children with the divider after "All Tools"; the open state survives a restart; ⌘, opens the group on Models; ⌘/ opens it on Keyboard shortcuts; collapsing the sidebar (⌘B) shows a single gear that expands it; there is no Help entry; a fresh profile still gets the welcome overlay once.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat(sidebar): one collapsible Settings group, Help removed"
```

---

## Task 7: Workspace settings becomes a page

**Files:**
- Create: `src/renderer/src/components/WorkspaceSettingsView.tsx`
- Delete: `src/renderer/src/components/WorkspaceSettingsModal.tsx`
- Modify: `src/renderer/src/App.tsx` (`wsSettings` becomes the page target), `src/main/appendSystem.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `tests/append-system.test.ts`

**Interfaces:**
- Consumes: `PermissionRulesSection`, `ModelSelect`, `WorkspaceSkillsBlock`, `WorkspaceMcpBlock` (the latter two move across from the modal unchanged).
- Produces: `<WorkspaceSettingsView workspace={string} />`.

- [ ] **Step 1: Port the modal to a page**

Copy `WorkspaceSettingsModal.tsx` to `WorkspaceSettingsView.tsx`; drop the `Dialog.Root/Portal/Overlay/Content` wrapper, the `onClose` prop, and the `Dialog.Close` button. Header:

```tsx
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-1">{basename(workspace)}</h1>
        <p className="text-xs text-ink-soft font-mono truncate mb-8">{workspace}</p>
        {/* sections */}
      </div>
    </div>
```

Sections, in this order, each as a `<Section>` card (not the old `<Block>` label):

1. `icon="models"` **Model** — the existing `ModelSelect` block verbatim.
2. `icon="permissions"` **Permissions** — `<PermissionRulesSection workspace={workspace} />` **followed by the bypass tri-state select and its confirm dialog**, both moved up from the old bottom-of-dialog position. They are one topic; the bypass sitting three sections below the rules read as unrelated.
3. `icon="skills"` **Skills** — `<WorkspaceSkillsBlock workspace={workspace} />` verbatim.
4. `icon="mcp"` **Workspace MCP** — `<WorkspaceMcpBlock workspace={workspace} />` verbatim.

**Delete the "system prompt additions" `<Block>` entirely** (lines 171-198), along with the `additions` / `dirty` / `saved` state, the `getWorkspaceAppend` effect, and `saveAdditions`.

- [ ] **Step 2: Route it**

`App.tsx` — `wsSettings` already exists as the modal's target; keep the state, change what it drives:

```tsx
        {activeView === "workspace" && wsSettings && <WorkspaceSettingsView workspace={wsSettings} />}
```

The Sidebar gear now navigates: `onWorkspaceSettings={(ws) => { setWsSettings(ws); setView("workspace"); }}`. Remove the `{wsSettings && <WorkspaceSettingsModal …>}` render (line 1411) and its import.

```bash
rm src/renderer/src/components/WorkspaceSettingsModal.tsx
```

- [ ] **Step 3: Remove the workspace-append plumbing**

- `src/preload/index.ts:171-173` — delete `getWorkspaceAppend` / `setWorkspaceAppend`.
- `src/renderer/src/hv.d.ts` — delete the two matching declarations.
- `src/main/ipc.ts:1539-1542` — delete both handlers; drop `resolveWorkspaceAppend` from the `./appendSystem` import (line 48).
- `src/main/ipc.ts:1662` — the comment says "same trust boundary as `resolveWorkspaceAppend`"; rewrite it as "only paths registered in the WorkspaceRegistry are writable (path.resolve matching)".
- `src/main/appendSystem.ts` — delete `resolveWorkspaceAppend` and update the file header comment: the workspace tier is gone; Pi still discovers `<workspace>/.pi/APPEND_SYSTEM.md` on its own, and an existing file keeps being read with no UI showing it (PRD §16 round 8, accepted in beta).

- [ ] **Step 4: Prune the tests**

`tests/append-system.test.ts` — delete the five `resolveWorkspaceAppend` tests (the ones at lines 14, 19, 23, 30, 37, 56 that construct workspace paths) and the now-unused `registered` fixture; keep `globalAppendFile`, and rewrite the read/write round-trip tests to use `globalAppendFile(agentDir)`:

```ts
test("writeAppend then readAppend round-trips the global file", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-append-"));
  const file = globalAppendFile(agentDir);
  writeAppend(file, "be terse");
  expect(readAppend(file)).toBe("be terse");
});
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/append-system.test.ts` → PASS.
Run: `npm run typecheck` → PASS.
Restart the dev server (main changed) and check the built artifact:
`grep -c "hv:get-workspace-append" out/main/index.js` → expect `0`.
GUI: the gear opens a full page named after the workspace; model override, rules, bypass, skills and MCP all still work; there is no system-prompt box.

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "feat(workspace): settings become a page; per-workspace system-prompt additions removed"
```

---

## Task 8: Collapsible workspaces in the sidebar

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx:270-300` (state) and `398-447` (the workspace row)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — self-contained sidebar behaviour.

- [ ] **Step 1: Persist the collapsed set**

Replace `const [collapsed, setCollapsed] = useState<Set<string>>(new Set());` with:

```tsx
  // Round 8: which workspaces are collapsed, remembered across restarts —
  // several workspaces of many sessions each is exactly when it matters.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("hv:ws-collapsed") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem("hv:ws-collapsed", JSON.stringify([...collapsed]));
  }, [collapsed]);
```

(Import `useEffect` alongside `useState`.)

- [ ] **Step 2: Move the arrow right, make the name clickable**

In the workspace row (line ~405), delete the leading chevron button and make the name a toggle; add the chevron immediately before the always-last `+`:

```tsx
              <div className="group flex items-center gap-1.5 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => toggle(ws)}
                  className="flex-1 min-w-0 truncate font-bold text-sm text-left cursor-pointer"
                  title={ws}
                >
                  {basename(ws)}
                </button>
                {/* gear + × keep their reserved hover slots, unchanged */}
                <button
                  type="button"
                  title={isCollapsed ? "Show sessions" : "Hide sessions"}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(ws)}
                  className="text-ink-soft hover:text-ink cursor-pointer text-[10px] w-3 shrink-0"
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                {/* the "+" new-session button stays LAST — the V2.C2 invariant */}
              </div>
```

Keep `const isCollapsed = collapsed.has(ws) && !q;` exactly as-is: a filter query must still expand everything, or a search could hide its own results.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → PASS.
GUI: clicking a workspace name collapses its sessions and the arrow flips; the arrow alone does the same; the `+` never moves; typing in the filter reveals matches inside a collapsed workspace; restart the app and the collapsed workspaces are still collapsed.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx
git commit -m "feat(sidebar): collapsible workspaces, remembered across restarts"
```

---

## Task 9: Full gate

**Files:** none — verification only.

- [ ] **Step 1: Typechecks**

Run: `npm run typecheck`
Expected: PASS for node and web.

- [ ] **Step 2: Non-live suite**

Run:
```bash
npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'
```
Expected: all green, including the new `shortcuts.test.ts` and the pruned `append-system.test.ts`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: GUI pass**

Run `npm run dev` (fresh start — main changed in Tasks 2 and 7) and walk:
1. Sidebar: one gear group, ten children, divider after All Tools, state survives restart, no Help entry, rail shows a single gear.
2. Each of the six settings pages renders at the wide measure and does its job.
3. Shortcuts: rebind, conflict refusal naming the owner, per-row Reset, Reset all, survives restart; ⌘S and both ⌘F still work in their focus contexts.
4. Workspace settings page from the gear: Model → Permissions (rules + bypass) → Skills → MCP, no system-prompt box.
5. Workspace rows collapse by name and by arrow, and stay collapsed after a restart.

**No live-Pi run is required for this round** — nothing in `pi-runtime/`, the bridge, or any pin changed. (`grep -rl 'skipIf(!KEY' tests/` is the live set; none of it touches renderer settings.)

- [ ] **Step 5: Final commit if the gate produced fixes**

```bash
git add -A
git commit -m "chore: round-8 gate fixes"
```

---

## Self-review

**Spec coverage** — Notion doc §1 sidebar group → Task 6 · §2 six pages → Tasks 4, 5 · §3 Help removed → Task 6 · §4 editable shortcuts → Tasks 1-4 · §5 workspace page → Task 7 · §6 system-prompt additions removed → Task 7 · §7 workspace collapse → Task 8. PRD §7/§16/§17 decisions all map to a task.

**Deliberate non-goals** — no migration or deletion of existing `<ws>/.pi/APPEND_SYSTEM.md` files (PRD §16 round 8, beta); no rebinding of Enter/⇧Enter/`@`/Esc; no per-workspace tier for shortcuts; no help page (post-V1).

**Known ceiling** — `eventToBinding` keys off `e.key`, so a binding recorded on one keyboard layout is stored as the character that layout produces. Acceptable for a local-first single-user app; the upgrade path is `e.code`, which would need its own display mapping.
