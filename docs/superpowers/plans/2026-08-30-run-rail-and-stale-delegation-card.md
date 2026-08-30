# Run Rail + Stale Delegation Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the resting state of every background run (sub-agent *and* agent terminal) to a circle-with-glyph in one shared row that expands to today's card on click, and make a finished async delegation's in-transcript card tell the truth.

**Architecture:** Two independent halves. **(A)** A new pure module `runRail.ts` merges the two run families into one `RunAvatar[]` and owns every policy decision (state, hue, which run must be promoted to a full card); a new `RunRail` component in `ChatView.tsx` renders the row, a hover readout carrying the facts and the STOP, and a left-anchored `absolute` overlay hosting the **unchanged** `DelegationRunCard` / `TerminalRunCard`. **(B)** The `hv.subagent` `complete` notify gains a second consumer: the transcript tool card, reached through an `asyncId → toolCallId` map the app already computes at dispatch and discards, and the long-dead `window.hv.subagentInspect` is wired behind that card's expand toggle.

**Tech Stack:** Electron + React 19 + TypeScript + Tailwind v4, vitest (no DOM — see Global Constraints), `@xterm/xterm` for the expanded terminal emulator.

**Spec:** `docs/prd.md` §12 Decision (2026-08-30, UX-feedback round) and §26 Decision (2026-08-30, UX-feedback round). Source feedback: Notion "⁉️ UX Feedbacks" (`3ccd33dfffca80c187a5f59b74565807`).

## Global Constraints

- **The renderer suite has NO DOM.** `vitest.config.ts` includes `tests/**/*.test.ts` only — no `.tsx`, no jsdom, no `@testing-library/react`. A visual contract is pinned in two halves: the mapping is exported as **DATA** from a `.ts` module (the `STATUS_MARK` / `GAUGE_TONE` pattern) and the **ABSENCE** is a source scan (the `tests/modal-layer.test.ts` pattern). Tests may import pure exports from `.tsx` files (`tests/terminal-card.test.ts` already does) but must never render.
- **Never run `npm run lint` or `npm run format`.** Scaffold leftovers; 19,839 warnings and an 85%-of-repo diff.
- **Never run `npm run typecheck` before `npm run build` or `npm run gate`** — `build` runs both typechecks first and fast-fails.
- **Full gate is one command: `npm run gate`** (= `build` → non-live suite). Live tests only when `npm run live:why` prints something, and it diffs `main...HEAD` so it only sees **committed** work.
- **Never pipe a test run to `tail` or `grep`** — `| tail` returns tail's exit code, so a red suite reads green. Redirect to a file, echo `$?`, then grep the file for free:
  ```
  L=/tmp/vitest.log
  npx vitest run <target> > $L 2>&1; echo "EXIT=$?"
  tail -30 $L
  ```
- **Tailwind cannot take a computed class name.** A derived hue must be an inline `style={{ ... }}` value, never `` className={`bg-[hsl(${h}deg...)]`} `` — the JIT scanner never sees it and the class is not emitted.
- **z-index ceiling for this feature is 20.** The overlay is a readout, not a modal. `.hv-overlay` / `.hv-dialog` own `z-index: 100` and `tests/modal-layer.test.ts` scans the renderer for anything climbing to 100 — do not touch that scale.
- **No `fixed inset-0` click-catcher anywhere in this feature.** `browserCoverage.ts` gathers coverage candidates by class word (`[class~="fixed"]`, `[class~="absolute"]`) and judges them by BOX, so a full-viewport catcher reads as covering every pane. Dismissal is toggle-the-same-avatar plus Escape.
- **A menu/overlay must never be dismissed by `onBlur`.** Pressing a `<button>` does not focus it, so the blur fires with `relatedTarget === null` and the surface unmounts between mousedown and mouseup, losing its own click. Reported twice in this app as "none of this menu is clickable". Act on `onMouseDown` where a control lives inside a dismissable surface.
- **`src/main` changes need a dev-server RESTART**, and a main-side fix is only live when the BUILT artifact shows it (`grep '<change>' out/main/index.js`). This plan touches `src/main` only in Task 3 (a type), so the GUI pass in Task 6 must follow a restart, not a ⌘R.

---

### Task 1: The pure rail model (`runRail.ts`)

Everything the rail decides, with no DOM and no React — so the renderer suite can pin it.

**Files:**
- Create: `src/renderer/src/runRail.ts`
- Create: `tests/run-rail.test.ts`

**Interfaces:**
- Consumes: `DelegationRun` from `src/renderer/src/agents.ts`; `TerminalRun` from `src/renderer/src/components/TerminalRunCard.tsx`.
- Produces:
  - `type RunState = "working" | "attention" | "done" | "failed" | "stopped"`
  - `interface RunAvatar { key: string; kind: "agent" | "terminal"; name: string; caption: string; state: RunState; hue: number }`
  - `avatarHue(name: string): number`
  - `toRunAvatars(delegations: DelegationRun[], terminals: TerminalRun[]): RunAvatar[]`
  - `promotedKeys(avatars: RunAvatar[]): string[]`
  - `const RUN_STATE_RING: Record<RunState, string>`

- [ ] **Step 1: Write the failing test**

Create `tests/run-rail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { avatarHue, toRunAvatars, promotedKeys, RUN_STATE_RING, type RunAvatar } from "../src/renderer/src/runRail";
import type { DelegationRun } from "../src/renderer/src/agents";
import type { TerminalRun } from "../src/renderer/src/components/TerminalRunCard";

const del = (over: Partial<DelegationRun> = {}): DelegationRun => ({
  id: "r1", kind: "async", agent: "code-explorer", label: "map the architecture",
  startedAt: 0, status: "running", ...over,
});
const term = (over: Partial<TerminalRun> = {}): TerminalRun => ({
  terminalId: "t1", title: "npm run dev", running: true, intent: "start the dev server",
  startedAt: 0, ...over,
});

describe("avatarHue", () => {
  it("is stable for the same name", () => {
    expect(avatarHue("code-explorer")).toBe(avatarHue("code-explorer"));
  });

  it("stays inside a hue circle", () => {
    for (const n of ["worker", "code-explorer", "agents-md-maker", "", "a"]) {
      const h = avatarHue(n);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("separates the three bundled agents", () => {
    const hues = ["code-explorer", "worker", "agents-md-maker"].map(avatarHue);
    expect(new Set(hues).size).toBe(3);
  });
});

describe("toRunAvatars", () => {
  it("puts agents before terminals", () => {
    const out = toRunAvatars([del()], [term()]);
    expect(out.map((a) => a.kind)).toEqual(["agent", "terminal"]);
  });

  it("keys an agent by its run id and a terminal by its terminal id", () => {
    const out = toRunAvatars([del({ id: "run-9" })], [term({ terminalId: "term-4" })]);
    expect(out.map((a) => a.key)).toEqual(["run-9", "term-4"]);
  });

  it("carries the agent name and its task as the caption", () => {
    const [a] = toRunAvatars([del({ agent: "worker", label: "rename the widget" })], []);
    expect(a.name).toBe("worker");
    expect(a.caption).toBe("rename the widget");
  });

  it("carries the terminal title and its intent as the caption", () => {
    const [, t] = toRunAvatars([], [term({ title: "vitest", intent: "run the suite" })]);
    expect(t).toBeUndefined();
    const [only] = toRunAvatars([], [term({ title: "vitest", intent: "run the suite" })]);
    expect(only.name).toBe("vitest");
    expect(only.caption).toBe("run the suite");
  });

  it("maps a running delegation to working and a needs-attention one to attention", () => {
    expect(toRunAvatars([del()], [])[0].state).toBe("working");
    expect(toRunAvatars([del({ live: { activityState: "needs_attention" } })], [])[0].state).toBe("attention");
  });

  it("does not raise attention for a run that has already stopped", () => {
    const a = toRunAvatars([del({ status: "done", live: { activityState: "needs_attention" } })], [])[0];
    expect(a.state).toBe("done");
  });

  it("maps each terminal outcome", () => {
    expect(toRunAvatars([del({ status: "error" })], [])[0].state).toBe("failed");
    expect(toRunAvatars([del({ status: "interrupted" })], [])[0].state).toBe("stopped");
  });

  it("a terminal is working while it runs and stopped once it exits", () => {
    expect(toRunAvatars([], [term()])[0].state).toBe("working");
    expect(toRunAvatars([], [term({ running: false })])[0].state).toBe("stopped");
  });

  it("survives an empty caption without inventing one", () => {
    expect(toRunAvatars([del({ label: "" })], [])[0].caption).toBe("");
  });
});

describe("promotedKeys", () => {
  it("promotes only runs that need attention", () => {
    const avatars: RunAvatar[] = [
      { key: "a", kind: "agent", name: "x", caption: "", state: "working", hue: 0 },
      { key: "b", kind: "agent", name: "y", caption: "", state: "attention", hue: 0 },
      { key: "c", kind: "terminal", name: "z", caption: "", state: "done", hue: 0 },
    ];
    expect(promotedKeys(avatars)).toEqual(["b"]);
  });

  it("promotes nothing when everything is calm", () => {
    expect(promotedKeys(toRunAvatars([del()], [term()]))).toEqual([]);
  });
});

describe("RUN_STATE_RING", () => {
  it("covers every state exactly once", () => {
    expect(Object.keys(RUN_STATE_RING).sort()).toEqual(["attention", "done", "failed", "stopped", "working"]);
  });

  it("animates the two live states and only those", () => {
    expect(RUN_STATE_RING.working).toContain("animate-pulse");
    expect(RUN_STATE_RING.attention).toContain("animate-pulse");
    for (const s of ["done", "failed", "stopped"] as const) {
      expect(RUN_STATE_RING[s]).not.toContain("animate-pulse");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
L=/tmp/vitest.log
npx vitest run tests/run-rail.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: FAIL — `Failed to resolve import "../src/renderer/src/runRail"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/runRail.ts`:

```ts
/**
 * §12 / §26 (2026-08-30): the resting state of a background run is a circle,
 * not a card — and this module owns every decision about it, so the renderer
 * suite (which has no DOM) can pin the whole policy.
 *
 * Two run families arrive here: sub-agent delegations and agent terminals. They
 * were two stacks of cards with two different caps; they are one row now, and
 * the merge is the reason this is a module rather than inline JSX.
 */
import type { DelegationRun } from "./agents";
import type { TerminalRun } from "./components/TerminalRunCard";

export type RunState = "working" | "attention" | "done" | "failed" | "stopped";

export interface RunAvatar {
  /** Map key: the delegation's run id, or the terminal's id. Unique across both. */
  key: string;
  kind: "agent" | "terminal";
  /** The agent's name, or the terminal's foreground command. */
  name: string;
  /** The delegation's task/intent, or the terminal's intent. May be empty. */
  caption: string;
  state: RunState;
  /** 0-359, derived from `name`. */
  hue: number;
}

/**
 * A hue from a name, so two concurrent robots are told apart at a glance.
 *
 * ponytail: FNV-1a, the same six lines `workspaceEmoji` uses for the collapsed
 * workspace rail and for the same reason — the only requirements are "stable"
 * and "spread out", and neither is worth a dependency. Copied rather than
 * shared because that module returns an emoji from a curated palette and this
 * one returns a number; folding them together would mean a generic hash helper
 * with two callers, which is the abstraction the ladder says to skip.
 */
export function avatarHue(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 360;
}

/**
 * The ring around a circle, as DATA rather than JSX: the suite has no DOM, so a
 * visual contract is pinned by exporting the mapping (the `GAUGE_TONE` /
 * `STATUS_MARK` pattern). `animate-pulse` is the "still going" signal the
 * feedback asked for and must appear on exactly the two live states — a
 * finished run that keeps pulsing is the whole bug this replaces, one surface
 * over.
 */
export const RUN_STATE_RING: Record<RunState, string> = {
  working: "border-sky animate-pulse",
  attention: "border-tangerine animate-pulse",
  done: "border-leaf",
  failed: "border-berry",
  stopped: "border-berry",
};

/** A delegation's state. `needs_attention` only counts while the run is live. */
function delegationState(run: DelegationRun): RunState {
  if (run.status === "running") {
    return run.live?.activityState === "needs_attention" ? "attention" : "working";
  }
  return run.status === "done" ? "done" : run.status === "interrupted" ? "stopped" : "failed";
}

/**
 * Both families, one row. Agents first: a delegation is the shorter-lived of
 * the two, which is the same ordering argument the two stacked sections already
 * used (delegations above terminals).
 */
export function toRunAvatars(delegations: DelegationRun[], terminals: TerminalRun[]): RunAvatar[] {
  return [
    ...delegations.map((r): RunAvatar => ({
      key: r.id,
      kind: "agent",
      name: r.agent,
      caption: r.label,
      state: delegationState(r),
      hue: avatarHue(r.agent),
    })),
    ...terminals.map((t): RunAvatar => ({
      key: t.terminalId,
      kind: "terminal",
      name: t.title,
      caption: t.intent,
      // A terminal does not end on its own, so "not running" means it exited or
      // was killed — never "succeeded".
      state: t.running ? "working" : "stopped",
      hue: avatarHue(t.title),
    })),
  ];
}

/**
 * Which runs must render as a full card rather than a circle.
 *
 * Attention is the one state that must not be reachable only by a click: the
 * amber pulse announces it, the card is what answers it (PRD §12, 2026-08-30).
 */
export function promotedKeys(avatars: RunAvatar[]): string[] {
  return avatars.filter((a) => a.state === "attention").map((a) => a.key);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/run-rail.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vitest.log
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/runRail.ts tests/run-rail.test.ts
git commit -m "feat(run-rail): both run families, one row, decided in one pure module"
```

---

### Task 2: The rail itself — row, hover readout, left overlay, attention promotion

Replaces `DelegationSection` and `TerminalStack` in ChatView's sticky header. The two card components are reused **unchanged** — this task must not edit `DelegationRunCard`'s body or `TerminalRunCard`'s body.

**Files:**
- Modify: `src/renderer/src/components/TerminalRunCard.tsx` — export `TerminalRunCard`; delete `STACK_CAP`, `visibleRuns`, `summaryLabel` and the `TerminalStack` wrapper.
- Modify: `src/renderer/src/components/ChatView.tsx:1027-1043` (the sticky header slot), `:1499-1518` (`DelegationSection` → `RunRail`), and imports at `:14-17`.
- Modify: `tests/terminal-card.test.ts` — drop the cap/summary tests (their subject is gone), keep `parseTerminalEvent` and `toolLabel` coverage.
- Create: `tests/run-rail-layout.test.ts` — the source-scan half.

**Interfaces:**
- Consumes: `RunAvatar`, `toRunAvatars`, `promotedKeys`, `RUN_STATE_RING`, `avatarHue` (Task 1). `DelegationRunCard` (already in ChatView, unexported — stays that way, `RunRail` is in the same file). `TerminalRunCard` (newly exported).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing source-scan test**

The row, the overlay's alignment, the absence of the cap, and the absence of a click-catcher cannot be asserted by rendering (no DOM). Create `tests/run-rail-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
const term = readFileSync("src/renderer/src/components/TerminalRunCard.tsx", "utf8");

describe("the run rail replaced the two card stacks", () => {
  it("ChatView renders RunRail and no longer renders either stack", () => {
    expect(chat).toContain("<RunRail");
    expect(chat).not.toContain("<DelegationSection");
    expect(chat).not.toContain("<TerminalStack");
  });

  it("the terminal cap and its summary strip are gone", () => {
    for (const dead of ["STACK_CAP", "visibleRuns", "summaryLabel", "TerminalStack"]) {
      expect(term).not.toContain(dead);
    }
  });

  it("TerminalRunCard is exported so the rail can host it", () => {
    expect(term).toMatch(/export function TerminalRunCard\b/);
  });
});

describe("the overlay's geometry is the one that was specced", () => {
  it("the sticky container is a positioning ancestor", () => {
    // An `absolute` overlay inside the sticky header positions against the
    // nearest POSITIONED ancestor. Without `relative` here it escapes to the
    // pane and lands somewhere else entirely.
    expect(chat).toMatch(/sticky top-0 z-20[^"]*\brelative\b|\brelative\b[^"]*sticky top-0 z-20/);
  });

  it("the overlay is left-anchored, not centred", () => {
    const overlay = chat.slice(chat.indexOf("RUN_RAIL_OVERLAY"));
    expect(overlay).toContain("absolute");
    expect(overlay).toContain("left-0");
    expect(overlay).not.toContain("mx-auto");
  });

  it("nothing in the rail climbs above the cards' own layer", () => {
    // PRD §12 (2026-08-30): a readout, deliberately not dialog tier.
    // .hv-overlay/.hv-dialog own 100 and tests/modal-layer.test.ts guards it.
    const rail = chat.slice(chat.indexOf("function RunRail"));
    expect(rail).not.toMatch(/z-\[?(3\d|[4-9]\d|\d{3,})/);
  });
});

describe("the dismissal traps this app has already been bitten by", () => {
  it("there is no full-viewport click-catcher", () => {
    // browserCoverage.ts gathers candidates by class word and judges them by
    // BOX, so a `fixed inset-0` catcher reads as covering every browser pane.
    const rail = chat.slice(chat.indexOf("function RunRail"));
    expect(rail).not.toContain("fixed inset-0");
  });

  it("the rail does not dismiss on blur", () => {
    const rail = chat.slice(chat.indexOf("function RunRail"));
    expect(rail).not.toContain("onBlur");
  });

  it("the hover readout's STOP acts on mousedown", () => {
    const rail = chat.slice(chat.indexOf("function RunRail"));
    expect(rail).toContain("onMouseDown");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run tests/run-rail-layout.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/vitest.log
```

Expected: FAIL — the first case, `expect(chat).toContain("<RunRail")`.

- [ ] **Step 3: Export `TerminalRunCard` and delete the stack**

In `src/renderer/src/components/TerminalRunCard.tsx`:

1. Delete the `STACK_CAP` const, `visibleRuns`, `summaryLabel` and the whole `TerminalStack` function (they span the block documented "§26: two cards, then a strip." through the end of `TerminalStack`). Replace that block's doc comment with:

```ts
/**
 * §26 (2026-08-30): the cap and the summary strip are gone.
 *
 * They existed because a shared cap would have changed how delegation cards
 * behave, which was out of that round's scope — the avatar row IS that shared
 * treatment, arrived at deliberately (PRD §26, 2026-08-30). A row of circles is
 * already the summary the strip stood in for, and it stays legible past three.
 *
 * `formatElapsed` stays exported: the rail's hover readout uses it.
 */
```

2. Change `function TerminalRunCard({` to `export function TerminalRunCard({`.

3. Keep `formatElapsed` and the `TerminalRun` interface exported; keep `LiveTerminal` private.

- [ ] **Step 4: Trim `tests/terminal-card.test.ts`**

Delete every `describe`/`it` whose subject is `visibleRuns`, `summaryLabel` or `STACK_CAP`, and remove them from the import at line 2 (leaving `type TerminalRun` only if the remaining tests still need it). Do NOT delete the `parseTerminalEvent` or `toolLabel` cases — they cover §26 wire shapes and are unrelated.

- [ ] **Step 5: Write `RunRail` in ChatView.tsx**

Replace the `DelegationSection` function (currently at `:1499`) with `RunRail`. Keep `DelegationRunCard`, `GAUGE_TONE` and `OUTCOME_LINGER_MS` exactly as they are.

```tsx
/** The overlay's own marker, so the layout test can find it by name. */
const RUN_RAIL_OVERLAY = "absolute left-0 top-full mt-2 w-full max-w-2xl";

/**
 * §12 / §26 (2026-08-30): both run families as one row of circles.
 *
 * A card was the resting state of something that is mostly BACKGROUND work —
 * ~3 rows each, and the fleet round gave the delegation card a fourth, so two
 * runs plus a terminal pushed the conversation off the screen. The circle is
 * the resting state now; the card is what a click opens, unchanged.
 *
 * Three things are load-bearing and each has a comment where it lives: the
 * overlay is `absolute` inside the sticky container (so it paints OVER the
 * transcript instead of pushing it, which is what "overlay" was asked for) and
 * therefore needs `relative` on that container; dismissal is toggle-only, never
 * a `fixed inset-0` catcher, because browserCoverage.ts would read that as
 * covering every browser pane; and a run needing attention is PROMOTED to a
 * full card rather than waiting behind a click.
 */
function RunRail({
  runs,
  terminalRuns,
  terminalSettings,
  items,
  onStopRun,
  onStopChild,
  onStopTerminal,
  onOpenTerminalAsTab,
}: {
  runs: DelegationRun[];
  terminalRuns: TerminalRun[];
  terminalSettings?: HvTerminalSettings;
  items: TranscriptItem[];
  onStopRun?: (runId: string) => void;
  onStopChild?: (runId: string, childId: string) => void;
  onStopTerminal?: (terminalId: string) => void;
  onOpenTerminalAsTab?: (terminalId: string) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const avatars = toRunAvatars(runs, terminalRuns);
  const promoted = new Set(promotedKeys(avatars));

  // Escape closes the overlay. The only dismissal besides clicking the same
  // circle again — see the class comment on why there is no click-catcher.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A run that disappears (a delegation slides away 2.5s after completion, a
  // terminal is killed) must not leave its overlay open over nothing.
  const keys = avatars.map((a) => a.key).join("|");
  useEffect(() => {
    if (open && !avatars.some((a) => a.key === open)) setOpen(null);
    if (hover && !avatars.some((a) => a.key === hover)) setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  if (avatars.length === 0) return null;

  const cardFor = (key: string): React.JSX.Element | null => {
    const run = runs.find((r) => r.id === key);
    if (run) {
      return (
        <DelegationRunCard
          run={run}
          trace={run.kind === "fg" && run.toolCallId ? traceFor(items, run.toolCallId) : undefined}
          onStopRun={onStopRun}
          onStopChild={onStopChild}
        />
      );
    }
    const t = terminalRuns.find((x) => x.terminalId === key);
    if (!t || !terminalSettings || !onStopTerminal || !onOpenTerminalAsTab) return null;
    return (
      <TerminalRunCard
        run={t}
        settings={terminalSettings}
        open
        onToggle={() => setOpen(null)}
        onStop={onStopTerminal}
        onOpenAsTab={onOpenTerminalAsTab}
      />
    );
  };

  return (
    <div className="w-full flex flex-col">
      {/* Attention takes SPACE, not a click. */}
      {avatars.filter((a) => promoted.has(a.key)).map((a) => (
        <div key={`promoted-${a.key}`}>{cardFor(a.key)}</div>
      ))}
      <div className="pt-3 flex items-center gap-2 flex-wrap">
        {avatars.filter((a) => !promoted.has(a.key)).map((a) => (
          <div
            key={a.key}
            className="relative"
            onMouseEnter={() => setHover(a.key)}
            onMouseLeave={() => setHover((h) => (h === a.key ? null : h))}
          >
            <button
              type="button"
              onClick={() => setOpen((o) => (o === a.key ? null : a.key))}
              aria-expanded={open === a.key}
              aria-label={`${a.name}${a.caption ? ` — ${a.caption}` : ""} (${a.state})`}
              // The hue is INLINE, not a class: Tailwind's scanner never sees a
              // computed class name and would emit nothing.
              style={{ backgroundColor: `hsl(${a.hue} 70% 92%)`, color: `hsl(${a.hue} 60% 30%)` }}
              className={`size-9 rounded-full border-2 grid place-items-center shadow-sticker cursor-pointer ${RUN_STATE_RING[a.state]}`}
            >
              <ToolIcon kind={(a.kind === "agent" ? "robot" : "terminal") as IconKind} className="size-4" />
            </button>
            {hover === a.key && open !== a.key && (
              // No gap between the circle and this panel: a gap means the mouse
              // leaves on the way in and the STOP inside is unreachable.
              <div className="absolute left-0 top-full pt-1 z-20 w-72">
                <div className="rounded-lg border-2 border-line bg-card shadow-sticker-lg px-3 py-2 flex flex-col gap-1">
                  <span className="text-sm font-black text-tangerine-deep break-words">{a.name}</span>
                  {a.caption && <span className="text-xs text-ink-soft break-words">{a.caption}</span>}
                  <RunFacts avatar={a} runs={runs} terminalRuns={terminalRuns} />
                  <div className="flex items-center gap-2 pt-0.5">
                    {a.state !== "done" && a.state !== "failed" && a.state !== "stopped" && (
                      <button
                        type="button"
                        // mousedown, not click: this control lives inside a
                        // surface that can vanish, and a click that arrives
                        // after the unmount lands on nothing.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (a.kind === "agent") onStopRun?.(a.key);
                          else onStopTerminal?.(a.key);
                        }}
                        title={a.kind === "agent" ? "Stop this subagent" : "Stop this terminal and the process in it"}
                        className="rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-berry/10 cursor-pointer"
                      >
                        ◼ Stop
                      </button>
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-ink-soft">{a.state}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {open && !promoted.has(open) && (
        <div className={`${RUN_RAIL_OVERLAY} z-20`}>{cardFor(open)}</div>
      )}
    </div>
  );
}

/**
 * The numbers the card's header used to carry, now in the hover readout: PRD
 * §12's 2026-08-22 decision put a running delegation's spend "on the line that
 * stops it", and an avatar has no line — this panel is that line.
 */
function RunFacts({
  avatar,
  runs,
  terminalRuns,
}: {
  avatar: RunAvatar;
  runs: DelegationRun[];
  terminalRuns: TerminalRun[];
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const run = avatar.kind === "agent" ? runs.find((r) => r.id === avatar.key) : undefined;
  const term = avatar.kind === "terminal" ? terminalRuns.find((t) => t.terminalId === avatar.key) : undefined;
  const startedAt = run?.startedAt ?? term?.startedAt;
  if (startedAt == null) return null;
  const gauge = run && run.status === "running" ? childGauge(run.live?.context) : null;
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] text-ink-soft tabular-nums">
      <span title="Elapsed time">{formatElapsed(now - startedAt)}</span>
      {run?.live?.currentTool && <span className="truncate">{run.live.currentTool}</span>}
      {/* Absent until the child's first turn is billed — never a $0.00 standing
          in for "not measured yet". */}
      {run?.live?.cost && (
        <span>{fmtNum(run.live.cost.input + run.live.cost.output)} tok · {costEstimateLabel(run.live.cost)}</span>
      )}
      {gauge && (
        <span
          title={`This subagent's context window: ${gauge.label} tokens`}
          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${GAUGE_TONE[gauge.zone]}`}
        >
          {gauge.text}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Wire it into the sticky header**

In `ChatView.tsx`, replace the header slot (currently `:1027-1043`) with:

```tsx
          header={
            delegations.length > 0 || terminalRuns.length > 0 ? (
              // §12/§26 (2026-08-30): ONE rail for both families. `relative` is
              // load-bearing — the rail's expanded overlay is `absolute` and
              // positions against the nearest positioned ancestor, which is
              // this container or nothing.
              <div className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full">
                <RunRail
                  runs={delegations}
                  terminalRuns={terminalRuns}
                  terminalSettings={terminalSettings}
                  items={items}
                  onStopRun={onStopRun}
                  onStopChild={onStopChild}
                  onStopTerminal={onStopTerminal}
                  onOpenTerminalAsTab={onOpenTerminalAsTab}
                />
              </div>
            ) : undefined
          }
```

Then fix the imports at `:14-17`:

```tsx
import { agentBlurb, delegationHint, formatElapsed, isStoppableChild, sortAgents, traceFor, type AgentInfo, type DelegationRun, type SubagentTrace } from "../agents";
import { promotedKeys, toRunAvatars, RUN_STATE_RING, type RunAvatar } from "../runRail";
import { costEstimateLabel, fmtNum } from "../analytics-format";
import { SubagentTraceView, ToolIcon } from "./ToolCard";
import { TerminalRunCard, type TerminalRun } from "./TerminalRunCard";
import { type IconKind } from "../toolLabel";
```

(`formatElapsed` now resolves from `../agents` for both families — the two copies are byte-identical, and `TerminalRunCard.tsx` keeps its own for its own header.)

- [ ] **Step 7: Run the layout test and the whole suite**

```
L=/tmp/vitest.log
npx vitest run tests/run-rail-layout.test.ts tests/run-rail.test.ts tests/terminal-card.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS. Then the build, because this task's real gate is the typecheck:

```
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/build.log
```

Expected: EXIT=0. A non-zero exit here is almost always an unused import left behind in `ChatView.tsx` (`GAUGE_TONE` and `childGauge` are still used by `RunFacts` and `DelegationRunCard`; `SubagentTraceView` still by `DelegationRunCard`).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ChatView.tsx src/renderer/src/components/TerminalRunCard.tsx tests/run-rail-layout.test.ts tests/terminal-card.test.ts
git commit -m "feat(run-rail): a circle at rest, today's card on click, both families one row"
```

---

### Task 3: A finished async delegation's transcript card tells the truth

The bug in the feedback. The `complete` notify gets a second consumer.

**Files:**
- Modify: `src/renderer/src/agents.ts:324-333` — `SubagentEvent` gains `summary?: string`.
- Modify: `src/renderer/src/components/ToolCard.tsx:9-28` — `ToolCardData` gains `delegation?`.
- Modify: `src/renderer/src/components/ToolCard.tsx:441-453` — `SubagentCard` reads it.
- Modify: `src/renderer/src/App.tsx` — a new `asyncCards` ref, filled at `:1085`, consumed in `handleSubagentEvent`'s `complete` branch (`:657`).
- Modify: `tests/agents-renderer.test.ts` — the parse half.
- Create: `tests/delegation-card-outcome.test.ts` — the label half, as data + source scan.

**Interfaces:**
- Consumes: `parseSubagentEvent`, `asyncResultInfo`, `updateToolCard` (all existing).
- Produces:
  - `ToolCardData.delegation?: { outcome: "done" | "failed" | "stopped"; summary?: string }`
  - `delegationSummary(card): string` exported from `ToolCard.tsx`
  - `SubagentEvent.summary?: string`

- [ ] **Step 1: Write the failing tests**

Create `tests/delegation-card-outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { delegationSummary, type ToolCardData } from "../src/renderer/src/components/ToolCard";
import { parseSubagentEvent } from "../src/renderer/src/agents";

const dispatched: ToolCardData = {
  toolCallId: "call-1",
  toolName: "subagent",
  args: { agent: "code-explorer", task: "map the architecture" },
  status: "done",
  result: { details: { asyncId: "run-7" } },
};

describe("delegationSummary", () => {
  it("says the run is in the background while no outcome has arrived", () => {
    expect(delegationSummary(dispatched)).toBe("running in the background — result arrives when it finishes");
  });

  it("shows the completion's own summary once it has", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done", summary: "Mapped 14 files." } }))
      .toBe("Mapped 14 files.");
  });

  it("collapses whitespace in that summary", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done", summary: "one\n\ntwo   three" } }))
      .toBe("one two three");
  });

  it("falls back to a plain outcome sentence when the completion carried no summary", () => {
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "done" } }))
      .toBe("done — the result was folded into the conversation");
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "failed" } }))
      .toBe("failed — nothing was folded into the conversation");
    expect(delegationSummary({ ...dispatched, delegation: { outcome: "stopped" } }))
      .toBe("stopped — nothing was folded into the conversation");
  });

  it("never claims background work on a BLOCKING delegation", () => {
    // async:false returns the child's answer inline; `details.asyncId` is absent.
    const fg: ToolCardData = { ...dispatched, result: { details: {} } };
    expect(delegationSummary(fg)).toBe("");
  });
});

describe("the notify carries the summary the card needs", () => {
  it("parseSubagentEvent keeps `summary` off a complete stage", () => {
    const ev = parseSubagentEvent({
      method: "notify",
      message: JSON.stringify({ kind: "hv.subagent", stage: "complete", runId: "run-7", status: "success", summary: "Mapped 14 files." }),
    });
    expect(ev?.summary).toBe("Mapped 14 files.");
  });
});

describe("the waiting line cannot outlive the run", () => {
  const src = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");

  it("SubagentTraceView still refuses to say 'waiting' once anything is known", () => {
    // The guard was written for reopened sessions (`cost`) and never fired on
    // the live path. It now covers the live outcome too.
    const view = src.slice(src.indexOf("export function SubagentTraceView"));
    const guard = view.slice(view.indexOf("results.length === 0"), view.indexOf("Waiting for the subagent"));
    expect(guard).toContain("!cost");
    expect(guard).toContain("!outcome");
  });
});

describe("App routes the completion to the transcript card", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");

  it("remembers the asyncId → toolCallId link at dispatch", () => {
    expect(app).toContain("asyncCards");
    // The link is computed at tool_execution_end and used to be discarded.
    const end = app.slice(app.indexOf("const detached = asyncResultInfo(t.result)"));
    expect(end.slice(0, 600)).toContain("asyncCards");
  });

  it("the complete branch updates a tool card, not only the sticky one", () => {
    const complete = app.slice(app.indexOf('sub.stage === "complete"'));
    expect(complete.slice(0, 2500)).toContain("updateToolCard");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run tests/delegation-card-outcome.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/vitest.log
```

Expected: FAIL — `delegationSummary` is not exported from `ToolCard.tsx`.

- [ ] **Step 3: Add `summary` to `SubagentEvent`**

In `src/renderer/src/agents.ts`, inside `interface SubagentEvent` (after the `status` field):

```ts
  /**
   * The completion's own one-liner, capped at 500 chars by the bridge. This is
   * the only content the notify carries, and from 2026-08-30 it is what the
   * TRANSCRIPT card's collapsed line shows once a run has finished — the field
   * existed on the wire and had no reader.
   */
  summary?: string;
```

`parseSubagentEvent` already casts the whole payload, so no parser change is needed — the test above pins that.

- [ ] **Step 4: Add the field and the helper to `ToolCard.tsx`**

Add to `ToolCardData` (after `cost`):

```ts
  /**
   * §12 (2026-08-30): an ASYNC delegation's outcome.
   *
   * It cannot come from `result`: an async `tool_execution_end` carries a
   * dispatch receipt, and the run finishes minutes later on an `hv.subagent`
   * complete notify keyed by `asyncId`. Without this the card said "running in
   * the background" forever — reported from a real session twenty minutes after
   * the run had finished.
   */
  delegation?: { outcome: "done" | "failed" | "stopped"; summary?: string };
```

Add the exported helper above `SubagentCard`:

```ts
/**
 * The collapsed line under a delegation's headline.
 *
 * Exported and pure because the renderer suite has no DOM: the copy is pinned
 * as data (tests/delegation-card-outcome.test.ts) rather than by rendering.
 */
export function delegationSummary(card: ToolCardData): string {
  const d = card.delegation;
  if (d) {
    const s = d.summary?.trim().replace(/\s+/g, " ");
    if (s) return s;
    return d.outcome === "done"
      ? "done — the result was folded into the conversation"
      : `${d.outcome} — nothing was folded into the conversation`;
  }
  if (asyncResultInfo(card.result)) return "running in the background — result arrives when it finishes";
  const results = traceFromEnd(card.result)?.results ?? [];
  const err = errorTextOf(card.result);
  if (err) return err.replace(/\s+/g, " ");
  return results[0]?.finalOutput?.trim().replace(/\s+/g, " ") ?? "";
}
```

Then in `SubagentCard`, replace the `delegationStatus` and `summary` locals (`:441-453`) with:

```ts
  const outcome = card.delegation?.outcome;
  const delegationStatus = running
    ? "delegating…"
    : denied
      ? "denied"
      : card.status === "error"
        ? "failed"
        : (outcome ?? (async ? "dispatched" : "done"));
  const summary = delegationSummary(card);
```

and widen the dot so a failed/stopped run is berry, not leaf:

```tsx
          <span
            className={`mt-1 size-2.5 rounded-full shrink-0 ${
              running ? "bg-sky animate-pulse"
                : denied || card.status === "error" || outcome === "failed" || outcome === "stopped" ? "bg-berry"
                : "bg-leaf"
            }`}
```

Reuse the existing `async` / `results` / `errorText` locals already computed in that function — do not recompute them; `delegationSummary` exists for the collapsed line only, and the expanded branch keeps reading `results` directly.

- [ ] **Step 5: Teach `SubagentTraceView` the live outcome**

`SubagentTraceView` currently refuses to say "waiting" when it has a `cost`. Give it the outcome too. Change its signature and the guard:

```tsx
export function SubagentTraceView({
  results,
  cost,
  outcome,
}: {
  results: SubagentResult[];
  cost?: HvLedgerTotal;
  /** §12 (2026-08-30): set once an async run has finished. "Waiting" would then
   *  be a lie about a run that ended — the same lie `cost` already caught for a
   *  REOPENED session, which is why that guard existed and never fired live. */
  outcome?: "done" | "failed" | "stopped";
}): React.JSX.Element {
```

```tsx
      {results.length === 0 && !cost && !outcome && (
        <p className="text-xs text-ink-soft italic">Waiting for the subagent to respond…</p>
      )}
```

Pass it from `SubagentCard`'s expanded branch:

```tsx
            <SubagentTraceView results={results} cost={card.cost} outcome={outcome} />
```

`ChatView`'s two call sites keep working — `outcome` is optional.

- [ ] **Step 6: Route the completion in `App.tsx`**

Add the ref beside `toolIndex` and `planBlocked`:

```ts
  /**
   * §12 (2026-08-30): asyncId → toolCallId, per session.
   *
   * Both ids are in hand at tool_execution_end and were discarded there. The
   * completion notify arrives minutes later carrying only the runId, so this is
   * the only way back to the transcript card. Never persisted: a reopened
   * session's card is rebuilt by restore.ts, which has the cost instead.
   */
  const asyncCards = useRef<Record<string, Map<string, string>>>({});
```

In the `tool_execution_end` async branch, immediately after `const detached = asyncResultInfo(t.result);` and inside `if (detached) {`:

```ts
            (asyncCards.current[sid] ??= new Map()).set(detached.asyncId, t.toolCallId);
```

In `handleSubagentEvent`'s `complete` branch, after the sticky-card `setDelegations` and before the `appendItem` notice:

```ts
        // §12 (2026-08-30): the TRANSCRIPT card, not only the sticky one. The
        // sticky card slides away in 2.5s; this one is the permanent record and
        // used to freeze at "running in the background" forever.
        const cardId = asyncCards.current[sid]?.get(sub.runId!);
        if (cardId) {
          asyncCards.current[sid]?.delete(sub.runId!);
          const outcome = status === "done" ? ("done" as const) : status === "interrupted" ? ("stopped" as const) : ("failed" as const);
          // The run's last polled spend, which the sticky card already holds —
          // read before that card is torn down below.
          const finalCost = delegationsRef.current[sid]?.[sub.runId!]?.live?.cost;
          const idx = toolIndex.current[sid] ??= new Map();
          setTranscripts((p) => ({
            ...p,
            [sid]: updateToolCard(p[sid] ?? [], idx, cardId, (card) => ({
              ...card,
              status: outcome === "done" ? card.status : ("error" as const),
              delegation: { outcome, summary: sub.summary },
              cost: card.cost ?? finalCost,
            })),
          }));
        }
```

This needs a live read of the delegation map inside a callback. If `delegationsRef` does not already exist, add it beside the other mirrors:

```ts
  const delegationsRef = useRef(delegations);
  useEffect(() => { delegationsRef.current = delegations; }, [delegations]);
```

(Follow whichever mirror idiom `sessionsRef` uses in this file — do not invent a second pattern.)

- [ ] **Step 7: Run the tests**

```
L=/tmp/vitest.log
npx vitest run tests/delegation-card-outcome.test.ts tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/agents.ts src/renderer/src/App.tsx src/renderer/src/components/ToolCard.tsx tests/delegation-card-outcome.test.ts
git commit -m "fix(delegation-card): a finished async run stops claiming it is still running"
```

---

### Task 4: Expanding a finished delegation shows the child's real answer

Wires `window.hv.subagentInspect`, built 2026-08-21 and callerless ever since.

**Files:**
- Modify: `src/renderer/src/components/Transcript.tsx:175`, `:421`, `:438` — thread `sessionId`, exactly as `workspace` is already threaded.
- Modify: `src/renderer/src/components/ChatView.tsx` — pass `sessionId={sessionId}` to `<Transcript>`.
- Modify: `src/renderer/src/components/ToolCard.tsx` — `ToolCard`/`SubagentCard` accept `sessionId`; `SubagentCard` fetches on expand.
- Create: `tests/subagent-inspect-card.test.ts`

**Interfaces:**
- Consumes: `ToolCardData.delegation` (Task 3); `window.hv.subagentInspect(sessionId, asyncId)` returning `{ ok: true; reply: { task?, status?, finalOutput?, messages? } } | { ok: false; error: string; code?: string }` (already in `hv.d.ts:747`).
- Produces: `inspectToResults(reply): SubagentResult[]` exported from `src/renderer/src/agents.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/subagent-inspect-card.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inspectToResults } from "../src/renderer/src/agents";

describe("inspectToResults", () => {
  it("maps an inspect reply onto the rows SubagentTraceView already renders", () => {
    const out = inspectToResults({
      task: "map the architecture",
      status: "completed",
      finalOutput: "Fourteen files, three entry points.",
      messages: [
        { role: "assistant", kind: "text", text: "Reading vite.config.js" },
        { role: "assistant", kind: "toolCall", text: "vite.config.js", name: "read" },
        { role: "user", kind: "toolResult", text: "export default …", name: "read" },
      ],
    }, "code-explorer");
    expect(out).toHaveLength(1);
    expect(out[0].agent).toBe("code-explorer");
    expect(out[0].finalOutput).toBe("Fourteen files, three entry points.");
    expect(out[0].messages.map((m) => m.role)).toEqual(["assistant", "assistant", "user"]);
    // A tool call reads as its tool name, not as bare text — the same shape
    // traceFromEnd builds from upstream's compact `toolCalls`.
    expect(out[0].messages[1].text).toContain("read");
  });

  it("returns nothing rather than an empty card when there is nothing to show", () => {
    expect(inspectToResults({}, "worker")).toEqual([]);
    expect(inspectToResults({ messages: [] }, "worker")).toEqual([]);
  });

  it("keeps a final output with no transcript", () => {
    const out = inspectToResults({ finalOutput: "done" }, "worker");
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual([]);
  });
});

describe("the card fetches only when it has to", () => {
  const src = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  const card = src.slice(src.indexOf("function SubagentCard"), src.indexOf("export function SubagentTraceView"));

  it("calls subagentInspect", () => {
    expect(card).toContain("subagentInspect");
  });

  it("fetches on expand, not on mount", () => {
    // The whole reason this route is affordable: it costs no model turn but it
    // does cost an RPC round trip and a 10s timeout, per card, per transcript.
    const eff = card.slice(card.indexOf("subagentInspect") - 900, card.indexOf("subagentInspect"));
    expect(eff).toContain("if (!open");
  });

  it("does not fetch when the transcript already streamed in", () => {
    const eff = card.slice(card.indexOf("subagentInspect") - 900, card.indexOf("subagentInspect"));
    expect(eff).toContain("results.length");
  });

  it("names a foreign-session refusal instead of spinning", () => {
    // Inspection is scoped to the CURRENT session's children, so a respawn
    // legitimately answers foreign_session. A card that never hears back spins
    // forever, which is the failure this route was built to avoid.
    expect(card).toContain("inspectError");
  });
});

describe("sessionId reaches the card the same way workspace does", () => {
  const t = readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");

  it("Transcript takes it and hands it to ToolCard", () => {
    expect(t).toMatch(/sessionId\?:\s*string \| null/);
    expect(t).toMatch(/<ToolCard[^>]*sessionId=/s);
  });

  it("ChatView supplies it", () => {
    expect(chat).toMatch(/<Transcript[\s\S]{0,2000}sessionId=\{sessionId\}/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run tests/subagent-inspect-card.test.ts > /tmp/vitest.log 2>&1; echo "EXIT=$?"
tail -30 /tmp/vitest.log
```

Expected: FAIL — `inspectToResults` is not exported.

- [ ] **Step 3: Add `inspectToResults` to `agents.ts`**

Below `traceFromEnd`:

```ts
/**
 * §12 (2026-08-30): an inspect reply, mapped onto the rows the trace view
 * already renders.
 *
 * `/subagents-inspect-rpc` answers from upstream's own artifacts and keeps
 * working after the result has been delivered, which is exactly what a FINISHED
 * async delegation's card needs — its sticky card is long gone and its
 * `tool_execution_end` never carried a transcript.
 *
 * The three message kinds collapse into the two-field row `SubagentMessage`
 * already is, the same way `traceFromEnd` folds upstream's compact `toolCalls`.
 * Returns an EMPTY array when there is nothing to show: an empty card claiming
 * a child ran is worse than no card at all.
 */
export function inspectToResults(
  reply: {
    finalOutput?: string;
    messages?: Array<{ role: string; kind: "text" | "toolCall" | "toolResult"; text: string; name?: string }>;
  },
  agent: string,
): SubagentResult[] {
  const messages: SubagentMessage[] = (reply.messages ?? []).map((m) => ({
    role: m.role,
    text: m.kind === "text" ? m.text : `${m.name ?? m.kind} ${m.text}`.trim(),
  }));
  const finalOutput = reply.finalOutput?.trim() || undefined;
  if (messages.length === 0 && !finalOutput) return [];
  return [{ agent, messages, finalOutput }];
}
```

- [ ] **Step 4: Thread `sessionId` through `Transcript`**

In `src/renderer/src/components/Transcript.tsx`:

- add `sessionId` to the props destructure beside `workspace` (`:421`);
- add to the interface (`:438`): `sessionId?: string | null;`
- pass it down at `:175`:

```tsx
  if (it.kind === "tool") return <ToolCard card={it.card} workspace={workspace} sessionId={sessionId} onOpenFile={onOpenFile} />;
```

Thread `sessionId` into whatever row-rendering function owns line 175 exactly as `workspace` is threaded there — same parameter position, same optional type. Do not add a context or a store; `workspace` is the precedent and it is one prop.

In `ChatView.tsx`, add `sessionId={sessionId}` to the `<Transcript …>` call (the one at `:1021`).

- [ ] **Step 5: Fetch on expand in `SubagentCard`**

`ToolCard` gains the prop and forwards it:

```tsx
export function ToolCard({
  card,
  workspace,
  sessionId,
  onOpenFile,
}: {
  card: ToolCardData;
  workspace?: string | null;
  /** §12 (2026-08-30): needed only by the subagent card, which inspects a
   *  finished child by asyncId — inspection is session-scoped. */
  sessionId?: string | null;
  onOpenFile?: (relPath: string) => void;
}): React.JSX.Element {
  if (card.toolName === "subagent") return <SubagentCard card={card} sessionId={sessionId} />;
```

In `SubagentCard`, add the prop and the effect:

```tsx
function SubagentCard({ card, sessionId }: { card: ToolCardData; sessionId?: string | null }): React.JSX.Element {
```

```tsx
  /**
   * §12 (2026-08-30): a FINISHED async delegation's child transcript, on
   * demand.
   *
   * An async `tool_execution_end` carries a dispatch receipt, so this card has
   * never had a transcript to show — expanding it said "waiting" and nothing
   * else. Upstream answers `/subagents-inspect-rpc` from its own artifacts with
   * NO model turn and keeps answering after delivery, so the ask is affordable
   * — but only when asked: it is an RPC round trip with a 10s timeout, and
   * there can be many of these cards in one transcript.
   *
   * Dropped on collapse rather than cached, so reopening re-reads. Same rule
   * the run card's thinking view uses, for the same reason.
   */
  const [inspected, setInspected] = useState<SubagentResult[] | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const asyncId = asyncResultInfo(card.result)?.asyncId;
  useEffect(() => {
    if (!open || !asyncId || !sessionId || results.length > 0) {
      setInspected(null);
      setInspectError(null);
      return;
    }
    let alive = true;
    void window.hv.subagentInspect(sessionId, asyncId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setInspected(inspectToResults(r.reply, req?.agent ?? "subagent"));
        setInspectError(null);
      } else {
        // Named, never a spinner: inspection is scoped to the current session's
        // children, so a respawn answers foreign_session and that is a fact
        // about this run, not a failure to report.
        setInspectError(
          r.code === "foreign_session"
            ? "This delegation belongs to an earlier session — its transcript is no longer readable from here."
            : `Could not read this delegation's transcript: ${r.error}`,
        );
        setInspected(null);
      }
    });
    return () => { alive = false; };
  }, [open, asyncId, sessionId, results.length, req?.agent]);
```

Then the expanded branch renders whichever it has:

```tsx
      {open && (
        <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 flex flex-col gap-3">
          {errorText && results.length === 0 && !inspected?.length ? (
            <p className="text-xs text-berry whitespace-pre-wrap break-words">{errorText}</p>
          ) : (
            <>
              <SubagentTraceView
                results={results.length > 0 ? results : (inspected ?? [])}
                cost={card.cost}
                outcome={outcome}
              />
              {inspectError && <p className="text-xs text-ink-soft italic">{inspectError}</p>}
            </>
          )}
        </div>
      )}
```

Add `inspectToResults` and `asyncResultInfo` to `ToolCard.tsx`'s import from `../agents`, and `useEffect` to its React import.

- [ ] **Step 6: Run the tests, then the build**

```
L=/tmp/vitest.log
npx vitest run tests/subagent-inspect-card.test.ts tests/agents-renderer.test.ts tests/delegation-card-outcome.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/build.log
```

Expected: both EXIT=0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/agents.ts src/renderer/src/components/ToolCard.tsx src/renderer/src/components/Transcript.tsx src/renderer/src/components/ChatView.tsx tests/subagent-inspect-card.test.ts
git commit -m "feat(delegation-card): expanding a finished run reads the child's own transcript"
```

---

### Task 5: Docs and the full gate

**Files:**
- Modify: `docs/validation/d1.md` — a `§The run rail` subsection.
- Modify: `CLAUDE.md` — one Gotchas entry.

- [ ] **Step 1: Record the wire facts in `docs/validation/d1.md`**

Append a section. It must state, because each one is a thing a future session would otherwise re-derive:

- `hv.subagent` `complete` carries `{stage, runId, agent?, status, summary?}` — `summary` is capped at 500 chars by the bridge (`happyvibe-bridge.ts`, `d.summary?.slice(0, 500)`) and had **no reader** until 2026-08-30.
- An async `tool_execution_end` result is a dispatch receipt: `details.asyncId` present, `details.results` absent. The `asyncId → toolCallId` link exists **only** at that moment.
- `subagentInspect` was built 2026-08-21 and had **zero callers** until 2026-08-30. It is scoped to the current session's children and answers `foreign_session` after a respawn; it costs no model turn.
- The rail's overlay is `absolute` inside a `sticky` container, which needs `relative` on that container, and stays at `z-20` — `browserCoverage.ts` reads a `fixed inset-0` catcher as covering every pane, which is why dismissal is toggle+Escape.

- [ ] **Step 2: Add the `CLAUDE.md` Gotchas entry**

Insert beside the other renderer gotchas:

```markdown
- **An async delegation's transcript card is updated by the NOTIFY, not by its own tool result — and
  the link between them exists for one instant.** `tool_execution_end` for `async:true` carries a
  dispatch receipt (`details.asyncId`, no `results`), and the run finishes minutes later on an
  `hv.subagent` `complete` notify that carries only the runId. `App.tsx`'s `asyncCards` ref
  (`asyncId → toolCallId`, per session) is captured at that end event **because nothing else ever
  holds both ids again** — without it the card froze at "running in the background" forever, which
  is exactly how it shipped and how it was reported (2026-08-30, twenty minutes after the run
  finished). Two corollaries. The notify's `summary` field existed on the wire with no reader for
  months; it is the collapsed line now. And `window.hv.subagentInspect` — built 2026-08-21,
  callerless until 2026-08-30 — is what the EXPANDED card reads, because that end event never
  carried a transcript; it costs no model turn, keeps working after delivery, and answers
  `foreign_session` after a respawn, which the card must NAME rather than spin on.
  Pinned by `tests/delegation-card-outcome.test.ts` + `tests/subagent-inspect-card.test.ts`.
- **The sticky run rail's overlay is `absolute` inside a `sticky` container, and three traps are
  already paid for.** (1) `absolute` positions against the nearest POSITIONED ancestor, so the
  sticky wrapper carries `relative` — drop it and the card lands somewhere else entirely. (2) It
  stays at **z-20**: it is a readout, not a modal, and `.hv-overlay`/`.hv-dialog` own 100 with
  `tests/modal-layer.test.ts` guarding that scale. (3) There is **no `fixed inset-0` click-catcher**
  — `browserCoverage.ts` gathers candidates by class word and judges them by BOX, so a
  full-viewport catcher reads as covering every browser pane; dismissal is toggle-the-same-avatar
  plus Escape. The hover readout also has **no gap** between circle and panel: a gap means the
  pointer leaves on the way in and the STOP inside is unreachable. The avatar's hue is an inline
  `style`, never a computed Tailwind class — the JIT scanner never sees one. Policy lives in
  `runRail.ts` (pure, `tests/run-rail.test.ts`); geometry and absences in
  `tests/run-rail-layout.test.ts`.
```

- [ ] **Step 3: Run the full gate**

```
npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"
tail -40 /tmp/gate.log
```

Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add docs/validation/d1.md CLAUDE.md
git commit -m "docs: the run rail's geometry, and the one instant that holds asyncId next to toolCallId"
```

- [ ] **Step 5: Check whether the live batch is required**

```
npm run live:why
```

Nothing in this plan touches `pi-runtime/extensions/`, `src/main/pi/` or a live test file, so this should print **nothing** — say so explicitly rather than silently omitting the batch. If it prints anything, run `npm run test:live` in the background (~6 min) and do not edit the tree while it runs.

---

## Verification: what will be TRUE on screen

Written now, while the design is fresh. `npm run gate` proves none of this — every item below is observed by hand in the running app after `npm run dev` (and a **restart**, not ⌘R, because Task 3 touches `src/renderer` but the same session's main bundle must be current).

**Surface: a chat pane's transcript, while a delegation runs** (ask the agent: *"delegate to code-explorer: map this app's architecture"*)

1. Where a ~3-row card used to appear, there is a **single circle ~36px across** carrying the robot glyph, pinned at the top of the transcript, with the conversation visible behind and below it.
2. The circle's border **pulses** while the run is live.
3. **Absence assertion:** the words **`working`**, the elapsed timer, the token count, the `$` figure and the **`◼ Stop`** button are **NOT** on screen while the pointer is elsewhere. They were all header text before; if any is still visible at rest, the rail is drawing a card.
4. **Absence assertion:** the shimmer bar (`hv-shimmer`) is **NOT** present in the rail — it belonged to the collapsed card, and a pulsing ring replaced it.
5. Hovering the circle: a panel appears **immediately below it, flush** (no gap), naming `code-explorer`, its task, the elapsed time, and — once the child's first turn is billed — tokens and cost, plus a working `◼ Stop`. Moving the pointer from circle to panel does **not** dismiss it, and clicking `◼ Stop` there actually ends the run.
6. Clicking the circle: **today's delegation card** opens, **left-aligned** and **overlapping the transcript text** — the messages behind it do **not** shift down. Clicking the same circle again, or pressing Escape, closes it.

**Surface: the same pane, with an agent terminal too** (ask: *"start a dev server in a terminal"*, then delegate)

7. **Two circles side by side in one row** — robot glyph and terminal glyph — not two stacked sections.
8. Clicking the terminal circle opens the terminal card **with a live, typeable emulator**; typing in it reaches the shell.
9. **Absence assertion:** the strip reading **`N running · <titles>`** is **gone** and can no longer be produced. Open a **third** terminal: three circles appear in the row; no summary strip is ever drawn. (This strip was `summaryLabel`, only reachable above two terminals — the one behaviour the removal is most likely to be seen as a regression.)
10. Only **one** overlay is open at a time: opening the terminal card closes the agent card.

**Surface: the same pane, after the delegation finishes**

11. The sticky circle shows a **still (non-pulsing) leaf ring** briefly, then the whole rail disappears — the existing 2.5 s teardown, unchanged.
12. The *"Subagent finished — delivering results…"* notice still appears in the transcript.
13. **This is the reported bug.** The **in-transcript** delegation card (`→ asked code-explorer: …`) now reads its outcome: its dot is **green with the title `done`** (not `dispatched`), and its collapsed line shows the completion's **summary sentence**.
14. **Absence assertion, the headline one:** the string **`running in the background — result arrives when it finishes`** is **NOT** on that card any more. Leave the session sitting for two minutes and re-check — this is the exact text the screenshot in the feedback shows twenty minutes after completion.
15. **Absence assertion:** expanding that card does **NOT** show **`Waiting for the subagent to respond…`**. It shows the child's transcript rows and, at the bottom, an **`output`** block carrying the child's actual answer.
16. A **failed** delegation (delegate with a bogus agent name, or `◼ Stop` a live one): the transcript card's dot is **berry**, its title reads `failed` / `stopped`, and its line reads *"failed — nothing was folded into the conversation"* rather than a success summary.

**Surface: the same session, reopened from the sidebar (the restore path)**

17. That same delegation card still shows its outcome and its cost figure, and still does **not** say `Waiting for the subagent to respond…` — the pre-existing `cost` guard covers this path and must not have been broken by adding `outcome` beside it.
18. Expanding it shows either the child transcript or the named sentence *"This delegation belongs to an earlier session…"* — **never** an indefinite spinner and never an empty panel.

**Surface: a browser pane sharing the window with a chat pane** (the regression this design most risks)

19. Split the window, put a browser pane beside a chat pane, load a page, then start a delegation and **open its card**. The **web page stays visible** — the rail's overlay lives inside the chat pane's own rect and must not trip `browserCoverage`'s coverage check. If the page blanks, something in the rail grew a `fixed` full-viewport box (see Global Constraints).

**Regression sequence someone can perform end to end**

Start a delegation, start a terminal, open the agent card, open the terminal card (the agent card must close), press Escape (the terminal card must close), `◼ Stop` the terminal from its hover panel (its circle must leave the row and no overlay must be left hanging over nothing), let the delegation finish (the rail must empty and the transcript card must show its outcome), then reopen the session from the sidebar (the transcript card must still show its outcome).

---

## Self-review

**Spec coverage.** §12's decision has six claims: circle-with-glyph for both families (Task 1 `toRunAvatars`, Task 2 rail); animated state (Task 1 `RUN_STATE_RING`, pinned to animate exactly the two live states); hue derived from the name (Task 1 `avatarHue`); avatars always, even for one run (Task 2 — no cap anywhere, pinned by `tests/run-rail-layout.test.ts`); hover carries the facts and the STOP (Task 2 `RunFacts` + the hover panel); attention promotes to a card (Task 1 `promotedKeys`, Task 2 render); overlay left-anchored at the cards' own layer (Task 2 + `RUN_RAIL_OVERLAY`, pinned). Its second half has three: completion updates the transcript card (Task 3), the final cost lands on it (Task 3 step 6), expanding shows the child's real answer (Task 4). §26's decision has three: terminals join the row (Tasks 1-2), the cap and strip go (Task 2 steps 3-4), the emulator stays expand-only and one-at-a-time (Task 2 — `TerminalRunCard` body untouched, `open` state single-slot). No gaps.

**Type consistency.** `RunState` / `RunAvatar` / `RUN_STATE_RING` are used under those names in Tasks 1 and 2. `ToolCardData.delegation` is `{ outcome: "done" | "failed" | "stopped"; summary?: string }` in Tasks 3 and 4 alike, and `SubagentTraceView`'s new `outcome` prop takes that same union, not `RunState` — the two are deliberately different types, because a delegation cannot be `working` or `attention` by the time this field is set.

**One assumption stated rather than guessed.** The feedback said "a circle with an icon in there (Robot or Terminal)" and separately accepted my recommendation to *derive* identity rather than add a field. Those two combine here as **glyph from the kind, hue from the name** — the icon is what was asked for and the derivation is applied to the only axis left. If a per-agent emoji was wanted instead of a hue, only `avatarHue` and the `<ToolIcon>` line in Task 2 change.
