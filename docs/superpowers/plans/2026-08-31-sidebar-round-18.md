# Sidebar round 18 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the session list back ~2× its height by hiding the empty search field behind an icon, collapsing the 16-item settings nav into four collapsed-by-default groups, and deleting the changelog unread dot.

**Architecture:** Everything is renderer-local state in `Sidebar.tsx` / `App.tsx`, persisted in `localStorage` beside the sidebar's existing keys. `NAV` stays the single flat exported array — each entry just gains a `group` field, so `GoTo.tsx` and the existing tests keep importing it unchanged. The one main-process change is a pure deletion (the `lastSeenVersion` IPC chain, which exists only for the dot).

**Tech Stack:** React 19 + TypeScript, Tailwind, Electron, vitest (no DOM — see Global Constraints).

**Spec:** Notion "📐 Sidebar improvements" (`https://app.notion.com/p/3cdd33dfffca80caa265fc94557b4e01`), folded into `docs/prd.md` §7 `:205`, §16 `:495`, §30 `:841`.

## Global Constraints

- **The renderer suite has NO DOM.** `vitest.config.ts` includes `tests/**/*.test.ts` only — no `.tsx`, no jsdom, no `@testing-library/react`. A visual contract is pinned in two halves: **the mapping is exported as DATA** and imported by the test; **the absence is a source scan** (`tests/sidebar-row.test.ts` and `tests/modal-layer.test.ts` are the two patterns to copy).
- **Nothing is renamed.** Group headers speak human, item labels keep their real names. No third vocabulary.
- **The order lives in one place.** `NAV` is the single flat exported array; `GROUPS` holds only the four headers. Never a second array listing item names per group.
- **A group header is not a destination.** Clicking it toggles; there is no page behind it.
- **`⌘F` is unavailable.** `shortcuts.ts:46` binds it to `search`, and `findConflict` refuses duplicates. The new action is `findSession`, default `Mod-k`.
- **`max-h-[60%]` stays** on the settings block, and **no default split fraction is introduced** — `AUTO` (0) is flex and flex is right.
- **Do not run `npm run lint` or `npm run format`** — scaffold leftovers, see CLAUDE.md.
- **The gate is `npm run gate`** (build → both typechecks → non-live suite, ONE command). Never run `npm run typecheck` before it; that is the same check twice.
- **No live-Pi run is needed for any task here.** Nothing touches `pi-runtime/extensions/`, `src/main/pi/` or a live test file. Confirm with `npm run live:why` after the final commit — empty output means the batch is not required, and say so rather than silently omitting it.
- **`src/main` changes need a dev-server RESTART**, not a renderer reload. Task 1 touches `src/main`; verify against the BUILT artifact (`grep … out/main/index.js`), never the source.

---

### Task 1: Delete the changelog unread dot and its whole chain

The dot is live, not dead code (`App.tsx:149` seeds it, `:1815` clears it). PRD §30 round 18 reverses it. `lastSeenVersion` exists for **nothing else** — verified with `grep -rn "LastSeenVersion\|lastSeenVersion" src/ tests/` — so the config field, both IPC handlers, both preload bridges, both `hv.d.ts` entries and `ChangelogView`'s `onSeen` prop all go with it. Leaving any of them is how `proposeAgentsMd`'s dead IPC happened (CLAUDE.md).

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` — delete `UnreadDot` (`:248`), the `changelogUnread` prop (`:425`, `:449`), both render sites (`:798`, `:813`)
- Modify: `src/renderer/src/App.tsx` — delete `changelogUnread` state + seed effect (`:149-157`), `markChangelogSeen` (`:1814-1817`), the `changelogUnread=` prop (`:2347`), the `onSeen=` prop (`:2409`)
- Modify: `src/renderer/src/components/ChangelogView.tsx` — drop the `onSeen` prop and its `useEffect` (`:24-31`)
- Modify: `src/renderer/src/hv.d.ts:1001-1002`
- Modify: `src/preload/index.ts:220-221`
- Modify: `src/main/ipc.ts:3174-3175` and the import on `:12`
- Modify: `src/main/config.ts:34`, `:285-291`
- Test: `tests/changelog-dot-removed.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Sidebar`'s prop object no longer has `changelogUnread: boolean`. `ChangelogView` becomes `ChangelogView(): React.JSX.Element` — **no props at all**. Task 3 renders the settings block without any marker branch.

- [ ] **Step 1: Write the failing test**

Create `tests/changelog-dot-removed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §30 round 18 — the passive dot is deleted.
 *
 * A source scan, not a render test: this suite has no DOM, and every
 * assertion here is an ABSENCE, which is exactly what a render test cannot
 * fail on. The chain existed only for the dot, so a survivor is dead code.
 */
const R = path.join(import.meta.dirname, "..", "src");
const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

describe("the unread dot is gone from the sidebar", () => {
  const SRC = read("renderer/src/components/Sidebar.tsx");

  it("has no UnreadDot component and no render site", () => {
    expect(SRC).not.toContain("UnreadDot");
  });

  it("takes no changelogUnread prop", () => {
    expect(SRC).not.toContain("changelogUnread");
  });
});

describe("the last-seen-version chain is gone end to end", () => {
  // One survivor is a dead IPC handler, which this repo has shipped before.
  const FILES = [
    "renderer/src/App.tsx",
    "renderer/src/components/ChangelogView.tsx",
    "renderer/src/hv.d.ts",
    "preload/index.ts",
    "main/ipc.ts",
    "main/config.ts",
  ];

  for (const f of FILES) {
    it(`${f} does not mention lastSeenVersion`, () => {
      expect(read(f).toLowerCase()).not.toContain("lastseenversion");
    });
  }

  it("the IPC channel itself is unregistered", () => {
    expect(read("main/ipc.ts")).not.toContain("hv:get-last-seen-version");
    expect(read("main/ipc.ts")).not.toContain("hv:set-last-seen-version");
  });

  it("ChangelogView takes no props", () => {
    const src = read("renderer/src/components/ChangelogView.tsx");
    expect(src).toContain("export function ChangelogView()");
    expect(src).not.toContain("onSeen");
  });
});

describe("what the page still does is unchanged", () => {
  it("still reports the running version and the runtime pins", () => {
    const src = read("renderer/src/components/ChangelogView.tsx");
    expect(src).toContain("__APP_VERSION__");
    expect(src).toContain("__RUNTIME_PINS__");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/changelog-dot-removed.test.ts`
Expected: FAIL — `UnreadDot` and `lastseenversion` are still present in every listed file.

- [ ] **Step 3: Delete the sidebar half**

In `src/renderer/src/components/Sidebar.tsx`, delete the whole `UnreadDot` block including its `§30` doc comment (`:243-250`), the `changelogUnread,` destructure (`:425`), the `changelogUnread: boolean;` prop type (`:449`), and both render sites — the comment block plus `{changelogUnread && !settingsOpen && <UnreadDot />}` at `:792-798`, and `{n.view === "changelog" && changelogUnread && <UnreadDot />}` at `:813`.

- [ ] **Step 4: Delete the App half**

In `src/renderer/src/App.tsx`: delete the `changelogUnread` state and the `§30` comment above it, the whole `useEffect` that calls `getLastSeenVersion` (`:152-157`), `markChangelogSeen` (`:1813-1817`), the `changelogUnread={changelogUnread}` line in the `<Sidebar>` props (`:2347`), and change `:2409` to:

```tsx
{activeView === "changelog" && <ChangelogView />}
```

- [ ] **Step 5: Delete the ChangelogView prop**

In `src/renderer/src/components/ChangelogView.tsx`, replace the signature and the mount effect:

```tsx
export function ChangelogView(): React.JSX.Element {
  return (
```

Delete the now-unused `useEffect` import if nothing else in the file uses it, and delete the two-sentence "Opening the page IS reading it" comment. Leave the "Explicitly not here: any check for a newer version" paragraph — §30 round 18 does not reopen it.

- [ ] **Step 6: Delete the IPC chain**

- `src/renderer/src/hv.d.ts` — remove the two declarations at `:1001-1002`.
- `src/preload/index.ts` — remove `getLastSeenVersion` / `setLastSeenVersion` at `:220-221`.
- `src/main/ipc.ts` — remove both `ipcMain.handle` lines at `:3174-3175`, and remove `getLastSeenVersion, setLastSeenVersion,` from the `config` import on `:12`.
- `src/main/config.ts` — remove `lastSeenVersion?: string;` (`:34`) and both exported functions (`:285-291`).

A stale `lastSeenVersion` key left in an existing user's `config.json` is harmless: `load()` no longer reads it and no migration is needed.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npx vitest run tests/changelog-dot-removed.test.ts tests/changelog.test.ts`
Expected: PASS. `tests/changelog.test.ts` pins the CHANGELOG.md ↔ package.json invariant and must be untouched by this.

- [ ] **Step 8: Full gate**

Run: `npm run gate`
Expected: PASS. This is the task that touches `src/main`, so the build arm is what proves the IPC removal typechecks on both sides.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(sidebar): the changelog dot goes, and takes its whole IPC chain with it"
```

---

### Task 2: `findSession` — the search field hides behind an icon on ⌘K

**Files:**
- Modify: `src/renderer/src/shortcuts.ts:31-56` (add the action)
- Modify: `src/renderer/src/components/Sidebar.tsx` — add `SearchIcon`, the `searching` state, the header button (`:591-600` region), the conditional field (`:603-611`)
- Modify: `src/renderer/src/App.tsx:2200-2215` (dispatch the shortcut)
- Test: `tests/shortcuts.test.ts` (extend), `tests/sidebar-search.test.ts` (create)

**Interfaces:**
- Consumes: `Sidebar`'s prop object from Task 1.
- Produces: `Sidebar` gains two props — `searchNonce: number` (App bumps it to open the field) and the existing `onToggleCollapsed`. `ShortcutId` gains the literal `"findSession"`. Task 3 does not touch any of this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shortcuts.test.ts`:

```ts
describe("§7 round 18 — finding a session is its own action", () => {
  it("findSession is registered and defaults to Mod-k", () => {
    const a = SHORTCUT_ACTIONS.find((x) => x.id === "findSession");
    expect(a?.defaultKey).toBe("Mod-k");
  });

  it("it did NOT take Mod-f — that belongs to the conversation search", () => {
    // Round 8 modelled `search` as one action with two focus-scoped consumers
    // precisely so ⌘F could not conflict with itself. A third claim on it
    // would reopen that.
    const a = SHORTCUT_ACTIONS.find((x) => x.id === "findSession");
    expect(a?.defaultKey).not.toBe("Mod-f");
    expect(SHORTCUT_ACTIONS.find((x) => x.id === "search")?.defaultKey).toBe("Mod-f");
  });

  it("Mod-k was free — no other action claims it", () => {
    const b = defaultBindings();
    expect(findConflict(b, "findSession", "Mod-k")).toBeNull();
  });

  it("every default binding is still unique", () => {
    const keys = SHORTCUT_ACTIONS.map((a) => a.defaultKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

Create `tests/sidebar-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §7 round 18 — the filter input hides, the affordance does not.
 *
 * Source-scanned: no DOM in this suite, and the load-bearing half is an
 * ABSENCE (the input is not rendered at rest) plus a behaviour a render test
 * would not catch either — that Esc CLEARS, which is what makes "a collapsed
 * search can never mean a filtered list" true by construction.
 */
const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
  "utf8",
);

describe("the input is conditional, the icon is not", () => {
  it("the field renders only while searching", () => {
    expect(SRC).toContain("{searching && (");
  });

  it("the affordance carries its shortcut in the tooltip, like the collapse control", () => {
    expect(SRC).toContain('title="Find a session (⌘K)"');
  });

  it("the placeholder is unchanged — this hides the input, not the capability", () => {
    expect(SRC).toContain('placeholder="Filter sessions…"');
  });
});

describe("Esc clears as well as collapses", () => {
  it("the Escape branch resets the filter, not just the field", () => {
    // Collapsing without clearing is the only route to a filtered list that
    // does not look filtered — which is the state the rejected "dot on the
    // icon" existed to signal.
    const esc = SRC.slice(SRC.indexOf('=== "Escape"'), SRC.indexOf('=== "Escape"') + 220);
    expect(esc).toContain('setFilter("")');
    expect(esc).toContain("setSearching(false)");
  });

  it("blur only closes when the filter is empty", () => {
    expect(SRC).toContain("if (!filter) setSearching(false)");
  });
});

describe("ABSENCE — the rejected alternatives", () => {
  it("there is no filter-active dot on the icon", () => {
    expect(SRC).not.toContain("FilterActiveDot");
  });

  it("nothing claims ⌘F for the sidebar", () => {
    expect(SRC).not.toContain("⌘F");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/shortcuts.test.ts tests/sidebar-search.test.ts`
Expected: FAIL — `findSession` is not in `SHORTCUT_ACTIONS`; `searching` does not exist in `Sidebar.tsx`.

- [ ] **Step 3: Register the shortcut**

In `src/renderer/src/shortcuts.ts`, add `| "findSession"` to `ShortcutId` after `"search"`, and insert into `SHORTCUT_ACTIONS` immediately after the `search` entry:

```ts
  // §7 round 18: finding a SESSION is a different action on a different
  // surface from searching the conversation, so it gets its own key rather
  // than a third focus-scoped consumer of ⌘F. Mod-k was free.
  { id: "findSession", label: "Find a session in the sidebar", defaultKey: "Mod-k" },
```

- [ ] **Step 4: Add the icon and the conditional field**

In `src/renderer/src/components/Sidebar.tsx`, add beside the other icon components:

```tsx
/** §7 round 18: the search affordance. The INPUT hides; this does not. */
function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
```

Add state beside `const [filter, setFilter] = useState("")`:

```tsx
  // §7 round 18: the field is 44px of permanent chrome that is empty at rest.
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // App bumps `searchNonce` on ⌘K. It expands the rail first if needed, so by
  // the time this fires the input exists to be focused.
  useEffect(() => {
    if (searchNonce === 0) return;
    setSearching(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchNonce]);
```

Add `searchNonce` to the destructure and to the prop type:

```tsx
  /** §7 round 18: bumped by ⌘K to open and focus the session filter. */
  searchNonce: number;
```

In the header row, insert the button immediately before the collapse `«` button:

```tsx
        <button
          type="button"
          onClick={() => { setSearching(true); requestAnimationFrame(() => searchRef.current?.focus()); }}
          title="Find a session (⌘K)"
          aria-label="Find a session"
          className="shrink-0 text-ink-soft hover:text-ink cursor-pointer px-1"
        >
          <SearchIcon />
        </button>
```

Replace the whole `{/* Session title filter */}` block with:

```tsx
      {/* §7 round 18: hidden at rest. Blur while non-empty KEEPS it open —
          losing an active filter because you clicked a result would be
          hostile — while Esc collapses AND clears, which is what makes "a
          collapsed search can never mean a filtered list" true by
          construction rather than by a marker. */}
      {searching && (
        <div className="px-4 pb-2">
          <input
            ref={searchRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onBlur={() => { if (!filter) setSearching(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setFilter(""); setSearching(false); }
            }}
            placeholder="Filter sessions…"
            className="w-full rounded-lg bg-card border-2 border-line px-2.5 py-1.5 text-sm focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
          />
        </div>
      )}
```

- [ ] **Step 5: Dispatch it from App**

In `src/renderer/src/App.tsx`, add state beside the other sidebar state:

```tsx
  // §7 round 18: a counter rather than a boolean — pressing ⌘K twice must
  // re-focus the field, and a boolean that is already true fires no effect.
  const [searchNonce, setSearchNonce] = useState(0);
```

In the shortcut handler, beside the `openSettings` line:

```tsx
    if (is("findSession")) {
      e.preventDefault();
      // A shortcut that silently does nothing is a bug: expand the rail first.
      if (sidebarCollapsed) setSidebarCollapsed(false);
      setSearchNonce((n) => n + 1);
      return;
    }
```

Pass `searchNonce={searchNonce}` to `<Sidebar>`. (Use whatever the collapsed-sidebar state is actually named at the call site — read it, do not guess.)

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npx vitest run tests/shortcuts.test.ts tests/sidebar-search.test.ts`
Expected: PASS.

- [ ] **Step 7: Full gate**

Run: `npm run gate`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sidebar): the session filter hides behind an icon, on its own ⌘K"
```

---

### Task 3: Four collapsible groups, collapsed by default

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` — `NAV` (`:192-222`), the settings block render (`:779-818`)
- Modify: `src/renderer/src/App.tsx:2148-2152` (`navigate` opens the target's group)
- Test: `tests/sidebar-nav-order.test.ts` (extend), `tests/sidebar-groups.test.ts` (create)

**Interfaces:**
- Consumes: `Sidebar` without `changelogUnread` (Task 1), with `searchNonce` (Task 2).
- Produces:
  - `export type NavGroup = "setup" | "allowed" | "did" | "app";`
  - `NAV` entries become `{ view: View; label: string; Icon: () => React.JSX.Element; group: NavGroup }` — **still one flat array, still exported, still 16 entries**, so `GoTo.tsx:33` and `tests/on-behalf-view.test.ts` need no change.
  - `export const GROUPS: Array<{ id: NavGroup; label: string }>` — headers only, never item names.
  - `export function groupFor(view: View): NavGroup | null` — `null` for `"chat"` and `"workspace"`, which are not in `NAV`. `App.navigate` uses it.

- [ ] **Step 1: Write the failing tests**

Create `tests/sidebar-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GROUPS, NAV, groupFor } from "../src/renderer/src/components/Sidebar";

/**
 * §16 round 18 — the flat 16-item list becomes four collapsible groups.
 *
 * The test that matters over time is the first one: grouping a navigation is
 * exactly the change that silently drops a destination, and it photographs
 * beautifully when it does.
 */
const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
  "utf8",
);

describe("nothing was lost", () => {
  it("all 16 destinations survive, each in exactly one group", () => {
    expect(NAV).toHaveLength(16);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(16);
    for (const n of NAV) {
      expect(GROUPS.map((g) => g.id), `${n.view}`).toContain(n.group);
    }
  });

  it("every group has at least one item — an empty header is a dead end", () => {
    for (const g of GROUPS) {
      expect(NAV.filter((n) => n.group === g.id).length, g.id).toBeGreaterThan(0);
    }
  });

  it("the four groups are exactly these, in this order", () => {
    expect(GROUPS.map((g) => g.label)).toEqual([
      "Set up your agent",
      "What it's allowed to do",
      "What it did",
      "This app",
    ]);
  });
});

describe("the order lives in ONE place", () => {
  it("group members are contiguous in NAV, so NAV alone decides the order", () => {
    // A second array listing item names per group would put the order in two
    // places — §20 round 17 Principle 11. Contiguity is what lets the sidebar
    // render `NAV.filter(...)` and still be the source of truth.
    const seen: string[] = [];
    for (const n of NAV) if (seen.at(-1) !== n.group) seen.push(n.group);
    expect(seen.length).toBe(new Set(seen).size);
  });

  it("round 12's frequency order survives within each group", () => {
    expect(NAV.map((n) => n.view)).toEqual([
      "models", "plugins", "skills", "promptTemplates", "mcp", "agents",
      // Permissions leads its group ahead of All Tools: more often reached,
      // and it is the group's own thesis.
      "permissions", "tools", "sysprompt",
      "onBehalf", "stats", "audit",
      "terminal", "voice", "shortcuts", "changelog",
    ]);
  });
});

describe("groupFor is what navigate() uses", () => {
  it("answers for every NAV destination", () => {
    for (const n of NAV) expect(groupFor(n.view)).toBe(n.group);
  });

  it("answers null for the views that are not in the nav", () => {
    expect(groupFor("chat")).toBeNull();
    expect(groupFor("workspace")).toBeNull();
  });
});

describe("ABSENCE — the rejected alternatives", () => {
  it("no second array names items per group", () => {
    // The failure this guards: `GROUPS` growing an `items:` field.
    expect(SRC).not.toMatch(/items\s*:\s*\[/);
  });

  it("groups are independent, not an accordion", () => {
    // One-open-at-a-time would silently close a group on a GoTo navigation,
    // which is auto-collapse-on-navigation by another name.
    expect(SRC).not.toContain("setOpenGroups(new Set([");
  });

  it("no item was renamed and no third vocabulary was invented", () => {
    for (const label of ["Models", "Plugins", "Skills", "Prompts", "MCP", "Agents",
      "All Tools", "Permissions", "System prompt", "On your behalf", "Terminal",
      "Voice", "Keyboard shortcuts", "Stats", "Audit log", "Changelog"]) {
      expect(NAV.map((n) => n.label)).toContain(label);
    }
  });

  it("a group header is not a destination", () => {
    // No header may call onNavigate.
    const headerBlock = SRC.slice(SRC.indexOf("GROUPS.map("), SRC.indexOf("GROUPS.map(") + 900);
    expect(headerBlock).toContain("toggleGroup(");
    expect(headerBlock).not.toContain("onNavigate(");
  });
});

describe("collapsed by default, and the state persists", () => {
  it("the persisted key is a set, seeded empty", () => {
    expect(SRC).toContain('"hv:settings-groups"');
    expect(SRC).toContain('localStorage.getItem("hv:settings-groups") ?? "[]"');
  });
});
```

Then in `tests/sidebar-nav-order.test.ts`, replace the first test's expected array with the same 16-view order above, and add to the file's doc comment:

```
 * §16 round 18: the list is now four groups. NAV stays flat and stays the
 * single source of order — grouping is a `group` field, not a second array.
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/sidebar-groups.test.ts tests/sidebar-nav-order.test.ts`
Expected: FAIL — `GROUPS` and `groupFor` are not exported.

- [ ] **Step 3: Add the group field, GROUPS and groupFor**

In `src/renderer/src/components/Sidebar.tsx`, above `NAV`:

```tsx
/**
 * §16 round 18 — four groups, and the order still lives in ONE place.
 *
 * Round 12's "one flat group with no sub-headings" was right for fourteen
 * entries and wrong at sixteen: 640px of content in a 423px scroll region,
 * with `MCP`, `All Tools` and `System prompt` as the first three names a
 * beginner reads. Headers speak human, items keep their real names — §29's
 * "one panel, two altitudes, one vocabulary", and no third vocabulary.
 *
 * `NAV` stays the single flat exported array because `GoTo.tsx` derives
 * `GOTO_LABELS` from it and `tests/go-to.test.ts` asserts against this file's
 * SOURCE. A `GROUPS` array listing item names would put the order in two
 * places, which is what §20 round 17's Principle 11 forbids. So `GROUPS` is
 * headers only and the sidebar renders `NAV.filter(n => n.group === g.id)`.
 */
export type NavGroup = "setup" | "allowed" | "did" | "app";

export const GROUPS: Array<{ id: NavGroup; label: string }> = [
  { id: "setup", label: "Set up your agent" },
  { id: "allowed", label: "What it's allowed to do" },
  { id: "did", label: "What it did" },
  { id: "app", label: "This app" },
];
```

Add `group: NavGroup` to `NAV`'s type and tag every entry, reordering so `permissions` precedes `tools`. The `sysprompt` entry keeps its `§19` comment; move `onBehalf` down into the `did` group and update its comment to say *why it moved* rather than that it sits beside System prompt. Final order and tags:

`models·plugins·skills·promptTemplates·mcp·agents` → `"setup"`; `permissions·tools·sysprompt` → `"allowed"`; `onBehalf·stats·audit` → `"did"`; `terminal·voice·shortcuts·changelog` → `"app"`.

Then, after `NAV`:

```tsx
/** The group a destination lives in — `null` for the views that are not in the
    nav at all. `App.navigate` uses this so a cross-page pointer can never land
    on a page whose row is inside a shut group. */
export function groupFor(view: View): NavGroup | null {
  return NAV.find((n) => n.view === view)?.group ?? null;
}
```

- [ ] **Step 4: Render the groups**

Add state beside the `collapsed` workspace set, copying that exact persistence idiom:

```tsx
  // §16 round 18: which settings groups are open. INDEPENDENT, not an
  // accordion — one-open-at-a-time would shut a group whenever a GoTo link
  // opened another, which is auto-collapse-on-navigation by another name.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("hv:settings-groups") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem("hv:settings-groups", JSON.stringify([...openGroups]));
  }, [openGroups]);

  const toggleGroup = (g: string): void =>
    setOpenGroups((p) => {
      const next = new Set(p);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
```

Replace the `{settingsOpen && ( <div …>{NAV.map(…)}</div> )}` block with:

```tsx
        {settingsOpen && (
          <div className="mt-1 flex flex-col min-h-0 overflow-y-auto">
            {GROUPS.map((g) => (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={openGroups.has(g.id)}
                  className="w-full flex items-center gap-2 rounded-xl pl-5 pr-3.5 py-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft border-2 border-transparent hover:bg-card/70 cursor-pointer transition-colors"
                >
                  <span className="flex-1 text-left">{g.label}</span>
                  <Chevron open={openGroups.has(g.id)} />
                </button>
                {openGroups.has(g.id) &&
                  NAV.filter((n) => n.group === g.id).map((n) => (
                    <button
                      key={n.view}
                      type="button"
                      onClick={() => onNavigate(n.view)}
                      className={`w-full flex items-center gap-2.5 rounded-xl pl-8 pr-3.5 py-2 text-sm font-bold border-2 cursor-pointer transition-colors ${
                        view === n.view ? "bg-card border-line shadow-sticker" : "border-transparent hover:bg-card/70"
                      }`}
                    >
                      <n.Icon />
                      <span className="flex-1 text-left">{n.label}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Teach navigate() to open the target's group**

In `src/renderer/src/App.tsx`, add state beside `settingsOpen`:

```tsx
  // §16 round 18: mirrors the sidebar's own key, so a GoTo link can open the
  // group holding its destination. Read once; the sidebar owns it thereafter.
  const [navGroupNonce, setNavGroupNonce] = useState(0);
```

Simplest correct wiring, and the one to use: **lift `openGroups` into `App`** rather than adding a nonce — `App` already owns `settingsOpen` for exactly this reason, and a second mechanism would be a second thing to keep in sync. So instead:

- Move the `openGroups` state + its `useEffect` persistence from `Sidebar` into `App`, next to `settingsOpen`.
- Pass `openGroups` and `onToggleGroup` down as props, mirroring `settingsOpen` / `onToggleSettingsOpen`.
- In `navigate()`, after `if (t.view !== "chat") setSettingsOpen(true);` add:

```tsx
    const g = groupFor(t.view);
    if (g) setOpenGroups((p) => (p.has(g) ? p : new Set([...p, g])));
```

- Do the same in the `openSettings` (⌘,) and `openShortcuts` (⌘/) handlers, which set the view directly rather than going through `navigate`.

Delete the `navGroupNonce` stub above — it is not used. (Kept in this plan only to say explicitly that the nonce approach was considered and rejected; do not implement it.)

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npx vitest run tests/sidebar-groups.test.ts tests/sidebar-nav-order.test.ts tests/go-to.test.ts tests/on-behalf-view.test.ts`
Expected: PASS. `go-to` and `on-behalf-view` are the two suites that import `NAV` from outside — they must pass **unchanged**, which is the whole point of keeping `NAV` flat.

Note: `tests/sidebar-groups.test.ts` asserts `'localStorage.getItem("hv:settings-groups") ?? "[]"'` appears in `Sidebar.tsx`. Once Step 5 lifts the state into `App.tsx`, **move that assertion to scan `App.tsx` instead** — do not weaken it to "appears somewhere".

- [ ] **Step 7: Full gate**

Run: `npm run gate`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sidebar): the settings list becomes four groups, collapsed by default"
```

---

### Task 4: A dragged split stops binding when every group is shut

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx:502` (the `sized` expression)
- Test: `tests/sidebar-split.test.ts` (extend)

**Interfaces:**
- Consumes: `openGroups` prop from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`sized` is currently an inline expression, so extract it as a pure function in `src/renderer/src/sidebarSplit.ts` — that file already exists for exactly this ("kept here rather than inline in the handler so the clamping is testable without a DOM"). Append to `tests/sidebar-split.test.ts`:

```ts
import { AUTO, isSized } from "../src/renderer/src/sidebarSplit";

describe("§7 round 18 — a dragged height divides nothing when every group is shut", () => {
  it("does not bind when the Settings group is closed", () => {
    // Round 12's original rule, unchanged.
    expect(isSized(false, 0.34, 2)).toBe(false);
  });

  it("does not bind when Settings is open but no group inside it is", () => {
    // Without this the tree stays at 34% while a ~204px settings block is
    // handed two thirds of the sidebar — ~420px of dead pegboard, which is
    // the exact defect round 12 fixed one level up.
    expect(isSized(true, 0.34, 0)).toBe(false);
  });

  it("binds when Settings is open, a group is open, and the handle was dragged", () => {
    expect(isSized(true, 0.34, 1)).toBe(true);
  });

  it("never binds at AUTO, however many groups are open", () => {
    expect(isSized(true, AUTO, 4)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/sidebar-split.test.ts`
Expected: FAIL — `isSized` is not exported from `sidebarSplit.ts`.

- [ ] **Step 3: Add the function**

Append to `src/renderer/src/sidebarSplit.ts`:

```ts
/**
 * Does the dragged fraction apply right now?
 *
 * Round 12: "a dragged height with the group collapsed is a division of
 * nothing." §16 round 18 put four collapsible groups inside that group, so the
 * same is true one level down — an open `Settings` whose four groups are all
 * shut is ~204px of content, and pinning the tree at its dragged height leaves
 * the remainder as dead pegboard.
 */
export function isSized(settingsOpen: boolean, fraction: number, openGroupCount: number): boolean {
  return settingsOpen && openGroupCount > 0 && fraction !== AUTO;
}
```

- [ ] **Step 4: Use it in the sidebar**

Replace `const sized = settingsOpen && treeFrac !== AUTO;` with:

```tsx
  const sized = isSized(settingsOpen, treeFrac, openGroups.size);
```

and add `isSized` to the existing `sidebarSplit` import.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run tests/sidebar-split.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate**

Run: `npm run gate`
Expected: PASS.

- [ ] **Step 7: Confirm no live batch is required**

Run: `npm run live:why`
Expected: empty output (nothing Pi-facing changed). If it prints anything, run `npm run test:live` in the background and read the WALL TIME — a ~5 s "green" run means `.env` is missing, not that it passed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(sidebar): a dragged split divides nothing when every settings group is shut"
```

---

## GUI verification — what will be TRUE on screen

`npm run gate` proves none of this. The suite has no DOM, so every claim below is observed in the running app (`npm run dev`, then attach with the `electron-debug` MCP). **A renderer reload is enough for Tasks 2–4; Task 1 touches `src/main`, so restart the dev server and confirm against `out/main/index.js`, not the source.**

### Observable claims, and the page each is observed on

| # | Claim | Where observed |
| --- | --- | --- |
| 1 | With Settings open and all four groups shut, the settings block measures **≈204px**, not 505px, and the session list is **≈2× taller** than before | Sidebar, any chat |
| 2 | At rest there is **no `<input>` in the sidebar** — only a magnifier icon left of `«` | Sidebar header |
| 3 | `⌘K` expands the field below the header and **puts the caret in it** | Sidebar |
| 4 | `⌘K` with the sidebar rail-collapsed **expands the rail first**, then focuses | Sidebar, from the 48px rail |
| 5 | Typing `zzz` filters the list; **clicking a session row leaves the field open** with `zzz` still in it | Sidebar |
| 6 | `Esc` **collapses the field AND restores every session row** | Sidebar |
| 7 | All four group headers are visible with Settings open; **clicking a header does not change the page** | Sidebar |
| 8 | With all four groups open, **all 16 destinations are present and each appears once** | Sidebar |
| 9 | A `GoTo` link from another page — e.g. the model selector's hint → **Models** — arrives with *Set up your agent* **already open** and Models highlighted | Chat composer → Models page |
| 10 | `⌘,` opens *Set up your agent*; `⌘/` opens *This app* | Any page |

### Absence assertions — named, because an absence cannot be screenshotted

- **`UnreadDot` is absent everywhere.** Set a stale version (`await window.hv.getLastSeenVersion()` should now **throw / be undefined** — the bridge is gone), reload, and confirm **no tangerine dot** on the `Settings` row, on *This app*, or on the `Changelog` row. Observed on: the **sidebar**, not the Changelog page — the surface that owned the marker is not the surface it marked.
- **No `<input placeholder="Filter sessions…">` in the DOM at rest.** `document.querySelectorAll('input[placeholder*="ilter"]').length === 0`.
- **No "filter active" dot on the search icon** — the rejected alternative. After `Esc` with text typed, the icon is plain *and the list is unfiltered*; a dot appearing would mean `Esc` stopped clearing.
- **No second scroll region with groups collapsed.** `Array.from(document.querySelectorAll('aside div')).filter(d => d.getBoundingClientRect().width < 300 && d.scrollHeight > d.clientHeight + 2).length === 1` — one, the session list.
- **No group header navigates.** Click all four; `activeView` is unchanged after each.

### The one regression this design risks

**Independent groups plus `GoTo` means the nav can only ever grow.** Perform this sequence:

1. Open **Set up your agent**, then **What it's allowed to do**, then **What it did**, then **This app** — all four open.
2. Confirm the settings block hits its `max-h-[60%]` cap and **scrolls internally** rather than crushing the session list below its `min-h-32` floor.
3. Drag the handle to give the tree ~34%, then shut all four groups.
4. **The tree must reflow to fill the sidebar** — no dead pegboard under the settings block. This is Task 4, and it is the failure mode B introduces.
5. Reopen one group. The dragged 34% must come back.
6. Quit and relaunch. The open-group set, the split and the collapsed workspaces must all restore as left.

The other sequence worth performing: **open two sessions in two panes, filter the sidebar to one of them, click the other's row.** The filter must survive (blur keeps it open) and the row must still select — the field must not swallow the click.

## Self-review

- **Spec coverage:** A → Task 2. B → Task 3. C → Task 4. D → Task 1. §8's six "what not to do" items are covered by the ABSENCE blocks in Tasks 2 and 3 plus the `max-h-[60%]`/no-default-fraction constraints in Global Constraints.
- **Placeholders:** none — every code step carries the code.
- **Type consistency:** `NavGroup` / `GROUPS` / `groupFor` are named identically in Tasks 3 and 4; `isSized(settingsOpen, fraction, openGroupCount)` matches its call site; `openGroups` is a `Set<string>` in both `App` and `Sidebar`.
- **Known wrinkle, called out rather than hidden:** Task 3 Step 5 moves `openGroups` from `Sidebar` to `App` mid-task. That is deliberate — `App` already owns `settingsOpen` for the same reason — but it means the Step 4 code block writes state that Step 5 relocates. Implement Step 4 and Step 5 together if that reads more naturally; the end state is what the tests pin.
