# Animations (motion layer, PRD §20 / §12 / §17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app one motion vocabulary (three easings, four durations, zero dependencies) and apply it to every surface in the Notion inventory — Tiers A, B and C — including the card→rail-circle flight and a sidebar indicator that distinguishes "agent working" from "process alive".

**Architecture:** Tokens live once in `styles.css` `@theme` and are mirrored as data in `src/renderer/src/motion.ts` (pinned equal by a source-scan test). Enters use Tailwind `starting:`; exits across `display:none` use `transition-discrete`; exits on React unmount use a ~30-line `usePresence` hook; the flight and sibling shifts use ~60 lines of Web Animations API in `motion.ts`. The one wire change is a `toolCallId` carried on `hv.terminal-run` and echoed on the `hv.terminal started` notify. Three renderer state fixes precede the flight.

**Tech Stack:** Chromium 150 (Electron 43) — `@starting-style`, `transition-behavior: allow-discrete`, `el.animate()`; Tailwind 4.3 (`starting:`, `transition-discrete`, `duration-<int>`, `ease-<token>`); React 19.2; vitest with NO DOM (pure exports + source scans).

**Spec:** Notion "🚤 Animations" `https://app.notion.com/p/3d7d33dfffca80539b1cc49330ce3b18` (decided 2026-09-10; §3 mechanisms, §4 inventory A1–A8 / B1–B6 / C1–C4, §5 traps). PRD: `docs/prd.md` §20 (principles), §12 (flight), §17 (sidebar indicator).

## Global Constraints

- **Durations ≤ 320 ms; exits faster than enters; enter = ease-out, exit = ease-in.** Tokens: `--ease-hv-out: cubic-bezier(0.2, 0, 0, 1)`, `--ease-hv-in: cubic-bezier(0.4, 0, 1, 1)`, `--ease-hv-pop: cubic-bezier(0.34, 1.4, 0.64, 1)`; durations `120 / 150 / 180 / 320`.
- **Only `transform` and `opacity` animate**, plus `grid-template-rows/columns` for the reveals the spec names. No number tweens (cost, tokens, context %, elapsed).
- **Reduced motion = the settled frame.** Every `transition-*`/`starting:` utility is wrapped in `motion-safe:`; every new `@keyframes` class is listed in the existing `@media (prefers-reduced-motion: reduce)` block at the end of `styles.css`; JS helpers return early via `reducedMotion()`.
- **Browser-pane rules (§28 coverage check, `BrowserTab.tsx:185-202`):** nothing slides *across* a browser pane; a ghost sets `position: fixed` as an INLINE style, never the class word `fixed`/`absolute`; every fade-out lands on exactly `opacity: 0`; the outgoing half of a crossfade never uses `absolute inset-0`.
- **Layering:** nothing above `z-50` except `.hv-overlay` / `.hv-dialog` (z-100). `tests/modal-layer.test.ts` enforces it; the five hand-rolled confirms drop their `z-50` when they adopt the dialog classes.
- **Run rail invariants (pinned, `tests/run-rail-layout.test.ts`):** the sticky wrapper string `className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full"` is verbatim; no `fixed inset-0` click-catcher; no `onBlur`; nothing above z-20 inside the rail.
- **No DOM in the suite.** Pin visual contracts as exported DATA + source scans (`tests/modal-layer.test.ts` pattern). Do NOT add jsdom.
- **Zero new dependencies.** `package.json` `dependencies` is unchanged by this plan.
- **Gate:** `npm run gate` (build → non-live suite). After Task 12 (bridge change) `npm run live:why` prints something → `npm run test:live` once, backgrounded (~6 min; check `pgrep -fl "npm run dev"` first). Before Task 12 it prints nothing — say so.
- **Never `npm run lint` / `npm run format`.** Typecheck alone per task is `npm run typecheck` (1.2 s); never run it right before `gate`/`build`.
- **GUI verification is `/uicheck`** at the four milestones named below; nothing in this plan is visible to the suite.
- **Commits** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One PR from `guiguito/animations`.

---

## File map

**New**
| File | Responsibility |
|---|---|
| `src/renderer/src/motion.ts` | `DUR`, `EASE`, `reducedMotion()`, `flyGhost()`, `snapshotRects()`, `flipChildren()` |
| `src/renderer/src/usePresence.ts` | `usePresence(show, ms) → {mounted, leaving}` |
| `src/renderer/src/sessionDot.ts` | `SESSION_DOT` record + `sessionDotState()` (A8) |
| `tests/motion-tokens.test.ts` | tokens equal CSS; reduced-motion block covers new classes; dead CSS + wrong comment gone |
| `tests/menu-enter.test.ts` | every menu site carries `hv-menu-in` |
| `tests/session-dot.test.ts` | A8 mapping + derivation |
| `tests/live-item-flag.test.ts` | `appendItem` stamps `live`, restore/loadEarlier do not |
| `tests/terminal-toolcallid.test.ts` | key-free: bridge payload + main echo + renderer store carry `toolCallId` |

**Modified**
`src/renderer/src/styles.css` (tokens, `hv-menu-in`, `hv-dialog-flow`, delete `hv-shimmer`, fix comment) · `App.tsx` (drawer, settings wrapper, `live` flag, `started` dedupe, `asyncCards`, agentTerms `toolCallId`, `busy` → Sidebar, grid transition, modals) · `ChatView.tsx` (RunRail flight/enter/exit/overlay, menus, banners, toasts, rewind + paste modals) · `Transcript.tsx` (`data-live`) · `Sidebar.tsx` (one `<aside>`, dot, collapsed badge, settings group) · `ToolCard.tsx` (card roots `data-hv-run-card`, expand grid, status mark pop) · `TabStrip.tsx` (tab enter, `data-hv-tab`) · `TerminalRunCard.tsx` (open-as-tab flight) · `Banner.tsx` · `ModelSelect.tsx` · `FileTree.tsx` · `ContextPanel.tsx` · `OnboardingDoors.tsx` · `PlanCard.tsx` · `runRail.ts` (`domKey`, `toolCallId`) · `agents.ts` (`applySubagentStarted`, `TerminalEvent.toolCallId`) · `pi-runtime/extensions/happyvibe-bridge.ts:1784-1797` · `src/main/ipc.ts:238-245, 1733-1740` · `docs/validation/d1.md` (wire shape) · `tests/run-rail.test.ts`, `tests/run-rail-layout.test.ts`, `tests/terminal-bridge.test.ts`.

---

## Milestone 1 — foundation

### Task 1: Motion tokens, `motion.ts`, `usePresence`, dead CSS out, comment fixed

**Files:**
- Modify: `src/renderer/src/styles.css` (`@theme` block ~line 10-40; delete lines 230-242 `hv-shimmer`; rewrite the comment at 245-252; extend the reduced-motion block at 336-361)
- Create: `src/renderer/src/motion.ts`, `src/renderer/src/usePresence.ts`
- Test: `tests/motion-tokens.test.ts`

**Interfaces — Produces:**
```ts
// motion.ts
export const DUR = { fast: 120, base: 150, panel: 180, flight: 320 } as const;
export const EASE = { out: "cubic-bezier(0.2, 0, 0, 1)", in: "cubic-bezier(0.4, 0, 1, 1)", pop: "cubic-bezier(0.34, 1.4, 0.64, 1)" } as const;
export function reducedMotion(): boolean;
export function flyGhost(fromEl: HTMLElement, toEl: HTMLElement, opts?: { duration?: number; round?: boolean }): Promise<void>;
export function snapshotRects(parent: HTMLElement, attr: string): Map<string, DOMRect>;
export function flipChildren(parent: HTMLElement, attr: string, prev: Map<string, DOMRect>): void;
// usePresence.ts
export function usePresence(show: boolean, ms: number): { mounted: boolean; leaving: boolean };
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/motion-tokens.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { DUR, EASE } from "../src/renderer/src/motion";

const CSS = fs.readFileSync("src/renderer/src/styles.css", "utf8");

describe("motion tokens (Animations round, 2026-09-10)", () => {
  it("motion.ts mirrors the CSS easings exactly — one source, two consumers", () => {
    expect(CSS).toContain(`--ease-hv-out: ${EASE.out};`);
    expect(CSS).toContain(`--ease-hv-in: ${EASE.in};`);
    expect(CSS).toContain(`--ease-hv-pop: ${EASE.pop};`);
  });
  it("the pop easing IS the existing dialog overshoot", () => {
    expect(CSS).toMatch(/hv-pop-in 180ms cubic-bezier\(0\.34, 1\.4, 0\.64, 1\)/);
    expect(EASE.pop).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
  });
  it("durations are the four the spec names and nothing is over 320", () => {
    expect(Object.values(DUR).sort((a, b) => a - b)).toEqual([120, 150, 180, 320]);
  });
  it("dead shimmer CSS is gone and the CSP comment no longer blames the CSP", () => {
    expect(CSS).not.toContain("hv-shimmer");
    expect(CSS).not.toContain("an animation runtime cannot load at all");
  });
  it("every new keyframe class is neutralised under reduced motion", () => {
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const cls of ["hv-menu-in", "hv-dialog-flow"]) expect(reduced, cls).toContain(`.${cls}`);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/motion-tokens.test.ts` → FAIL (`motion` module not found).

- [ ] **Step 3: Tokens in `styles.css`** — inside `@theme { … }`, after the colour tokens:

```css
  /* Animations round (2026-09-10): the whole motion vocabulary. Mirrored as
     data in motion.ts; tests/motion-tokens.test.ts pins the two equal. */
  --ease-hv-out: cubic-bezier(0.2, 0, 0, 1);       /* enters, movement */
  --ease-hv-in: cubic-bezier(0.4, 0, 1, 1);        /* exits */
  --ease-hv-pop: cubic-bezier(0.34, 1.4, 0.64, 1); /* = hv-pop-in's overshoot */
```

Delete the `@keyframes hv-shimmer` + `.hv-shimmer` block (lines 230-242) and the `/* V2.C1: subtle "working" shimmer bar … */` comment above it. Replace the paragraph in the §22 comment that reads *"CSS-only on purpose, not for taste: the renderer CSP is `script-src 'self'` with no `blob:` and no `data:`, so an animation runtime cannot load at all. That is the same wall §27's audio worklet hit, and it is not being hit twice."* with:

```
 * CSS-only on purpose. NOT because of the CSP: a bundled npm library is
 * `'self'` and loads fine (only CDN/blob/data are blocked — §27's worklet hit
 * that wall because it was a blob URL, not because it was a library). The
 * reason is the Animations round's decision (2026-09-10): native CSS + WAAPI,
 * zero dependencies, because Chromium 150 is a fixed target.
```

Add, after the `.hv-dialog` block:

```css
/* Animations round: menus enter from their anchor; exits stay instant. */
.hv-menu-in {
  transition: opacity 120ms var(--ease-hv-out), transform 120ms var(--ease-hv-out);
  @starting-style { opacity: 0; transform: scale(0.97); }
}
/* The hand-rolled confirms are flex-centred, so they cannot use hv-pop-in
   (its keyframes carry the translate(-50%,-50%) of an absolutely-centred
   Radix content). Same overshoot, no translate. */
@keyframes hv-pop-in-flow {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
.hv-dialog-flow { animation: hv-pop-in-flow 180ms var(--ease-hv-pop); }
```

Extend the reduced-motion block: add `.hv-menu-in,` and `.hv-dialog-flow,` to its `animation: none !important` selector list, plus `.hv-menu-in { transition: none; }`.

- [ ] **Step 4: `motion.ts`**

```ts
/**
 * Animations round (2026-09-10): the motion vocabulary as DATA, and the two
 * WAAPI helpers the CSS cannot do (a flight between two elements; siblings
 * sliding into a gap). Tokens are mirrored from styles.css `@theme` and pinned
 * equal by tests/motion-tokens.test.ts — the renderer suite has no DOM.
 */
export const DUR = { fast: 120, base: 150, panel: 180, flight: 320 } as const;
export const EASE = {
  out: "cubic-bezier(0.2, 0, 0, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  pop: "cubic-bezier(0.34, 1.4, 0.64, 1)",
} as const;

let reduced: boolean | null = null;
/** Read once; the setting does not change under the app. Settled frame, never a faster animation. */
export function reducedMotion(): boolean {
  if (reduced === null) reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced;
}

/**
 * Clone `fromEl`, fly the clone to `toEl`'s rect, remove it. The card stays.
 *
 * INLINE `position: fixed` on purpose: §28's coverage check finds candidates by
 * the CLASS WORDS `absolute`/`fixed` (BrowserTab.tsx:185-202), so a ghost must
 * carry neither. It never crosses a browser pane by construction — both rects
 * live in the same chat pane — and `pointer-events: none` keeps it out of
 * hit-testing. Non-uniform scale + 50% radius on the ORIGINAL box lands on a
 * true circle when `toEl` is square (36×36). Text fades over the first 40%.
 */
export function flyGhost(fromEl: HTMLElement, toEl: HTMLElement, opts: { duration?: number; round?: boolean } = {}): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return Promise.resolve();
  const ghost = fromEl.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    margin: "0", pointerEvents: "none", zIndex: "30", boxSizing: "border-box", overflow: "hidden", transformOrigin: "top left",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  const duration = opts.duration ?? DUR.flight;
  const dx = b.left - a.left, dy = b.top - a.top;
  const sx = b.width / a.width, sy = b.height / a.height;
  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1, 1)", borderRadius: getComputedStyle(fromEl).borderRadius, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: opts.round ? "50%" : getComputedStyle(toEl).borderRadius, opacity: 0.95 },
    ],
    { duration, easing: EASE.out, fill: "forwards" },
  );
  for (const t of ghost.querySelectorAll<HTMLElement>("*")) {
    if (t.childElementCount === 0 && t.textContent?.trim()) t.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration, fill: "forwards" });
  }
  const done = (): void => ghost.remove();
  return anim.finished.then(done, done);
}

/** Rects of `parent`'s children keyed by `attr`, taken BEFORE a list changes. */
export function snapshotRects(parent: HTMLElement, attr: string): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  for (const el of parent.querySelectorAll<HTMLElement>(`[${attr}]`)) m.set(el.getAttribute(attr)!, el.getBoundingClientRect());
  return m;
}

/** FLIP: children that moved translate from their old rect to the new one (200 ms). New children are left to their own `starting:` enter. */
export function flipChildren(parent: HTMLElement, attr: string, prev: Map<string, DOMRect>): void {
  if (reducedMotion()) return;
  for (const el of parent.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const was = prev.get(el.getAttribute(attr)!);
    if (!was) continue;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (dx === 0 && dy === 0) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 200, easing: EASE.out });
  }
}
```

- [ ] **Step 5: `usePresence.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";

/**
 * Keep a conditionally-rendered element mounted for `ms` after `show` flips
 * false, exposing `leaving` so CSS can play the exit (`data-leaving`).
 *
 * A TIMER, not `transitionend`: a hidden pane or reduced motion never fires
 * the event and the element would stay mounted forever. Under reduced motion
 * the wait is 0 — settled frame, no exit.
 */
export function usePresence(show: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (show) { setMounted(true); setLeaving(false); return; }
    const wait = reducedMotion() ? 0 : ms;
    if (wait === 0) { setMounted(false); setLeaving(false); return; }
    setLeaving(true);
    timer.current = setTimeout(() => { setMounted(false); setLeaving(false); timer.current = null; }, wait);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [show, ms]);
  return { mounted, leaving };
}
```

- [ ] **Step 6: Run** `npx vitest run tests/motion-tokens.test.ts tests/modal-layer.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 7: Commit** — `feat(motion): tokens, motion.ts, usePresence; drop dead shimmer; correct the CSP comment`

---

## Milestone 2 — CSS-only wins (A4, A6, A7, B2, B3, B4)

### Task 2: A4 — right drawer slide + content crossfade

**Files:** Modify `src/renderer/src/App.tsx:3366-3413` (the `{DRAWER && (…)}` block; `ChangesPanel` ↔ `FileTree` swap at `:3406-3410`).

**Interfaces — Consumes:** `usePresence`, `DUR`.

- [ ] **Step 1:** In `App`, where `DRAWER` (the boolean deciding the drawer renders) is computed, add `const drawer = usePresence(DRAWER, DUR.fast);` and change the guard to `{drawer.mounted && (`. On the drawer's root `<div>` (the one carrying `data-hv-drawer` and `absolute`), add to its `className`:

```
motion-safe:transition-[opacity,translate] motion-safe:duration-180 motion-safe:ease-hv-out motion-safe:starting:opacity-0 motion-safe:starting:translate-x-3 data-[leaving=true]:opacity-0 data-[leaving=true]:translate-x-3 data-[leaving=true]:duration-120 data-[leaving=true]:ease-hv-in
```
and `data-leaving={drawer.leaving || undefined}`. The width-drag handle (`:3382-3401`) gets no transition (unchanged).

- [ ] **Step 2:** Content swap: wrap the `ChangesPanel` / `FileTree` element in `<div key={drawerMode} className="contents motion-safe:starting:opacity-0 motion-safe:transition-opacity motion-safe:duration-120">` where `drawerMode` is the existing string deciding which panel shows (`"changes" | "files"`). `key` remounts on swap so `starting:` fires; `contents` keeps layout untouched.

- [ ] **Step 3:** `npm run typecheck`; `npx vitest run tests/browser-coverage.test.ts tests/layout-persist.test.ts` → PASS (the drawer is still `absolute` + `data-hv-drawer`; nothing about coverage changes).

- [ ] **Step 4: Commit** — `feat(motion): the drawer slides in from its own edge and fades out`

### Task 3: A6 — settings ↔ chat switch enter

**Files:** Modify `src/renderer/src/App.tsx:2852-2914` (the settings-view switch) and `:2919` (chat wrapper).

- [ ] **Step 1:** Wrap the settings-view switch in one `<div key={activeView} className="contents-none flex-1 min-h-0 flex flex-col motion-safe:starting:opacity-0 motion-safe:starting:translate-y-1 motion-safe:transition-[opacity,translate] motion-safe:duration-[140ms] motion-safe:ease-hv-out">`. Match the wrapper's flex classes to what the switched-in views already expect from their parent (read the parent `className` at `:2852` and copy its layout words — the wrapper must not change layout).
- [ ] **Step 2:** Chat wrapper `:2919`: `className={\`flex-1 min-h-0 ${activeView === "chat" ? "flex" : "hidden"} motion-safe:transition-[opacity,display] motion-safe:transition-discrete motion-safe:duration-[140ms] motion-safe:starting:opacity-0\`}`. No exit: hidden is instant on purpose (spec A6).
- [ ] **Step 3:** `npm run typecheck`. GUI note for the milestone: open Settings → Models → back to chat; the chat fades up 140 ms and the streaming bubble (if any) never freezes.
- [ ] **Step 4: Commit** — `feat(motion): settings and chat fade up on entry`

### Task 4: A7 — live transcript items enter; `live` flag not an id floor

**Files:** Modify `src/renderer/src/components/Transcript.tsx:55` (type) and `:735-754` (render), `src/renderer/src/App.tsx:575-580` (`appendItem`). Test: `tests/live-item-flag.test.ts`.

**Interfaces — Produces:** `TranscriptItem.live?: true`.

- [ ] **Step 1: Failing test**

```ts
// tests/live-item-flag.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { toRestoreItems } from "../src/renderer/src/restoreMap"; // use the real exported name at restoreMap.ts:55-61

const APP = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
const TX = fs.readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");

describe("only LIVE transcript items animate in (A7)", () => {
  it("appendItem stamps live:true — the one path that means 'appended now'", () => {
    const fn = APP.slice(APP.indexOf("const appendItem ="), APP.indexOf("const appendItem =") + 400);
    expect(fn).toContain("live: true");
  });
  it("loadEarlier does NOT stamp it — it mints fresh, higher ids, so an id floor would animate it", () => {
    const fn = APP.slice(APP.indexOf("const loadEarlier ="), APP.indexOf("const loadEarlier =") + 1600);
    expect(fn).not.toContain("live: true");
  });
  it("restore never produces a live item", () => {
    let n = 0;
    const items = toRestoreItems([{ role: "user", content: "hi" }] as never, () => ++n);
    for (const it of items) expect((it as { live?: boolean }).live).toBeUndefined();
  });
  it("Transcript reads the flag, not the id", () => {
    expect(TX).toContain('data-live={it.live');
    expect(TX).not.toContain("liveFloorId");
  });
});
```
(Adapt the restore import to the real exported function name and its real argument shape — read `restoreMap.ts:55-70` first; the assertion is only that no output item carries `live`.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** `Transcript.tsx:55`: `export type TranscriptItem = { id?: number; live?: true } & (…)`. `App.tsx:578`: `const withId = { ...item, id: idCounter.current++, live: true as const };`. In `Transcript.tsx:735-754`, both branches of the returned element get a wrapper attribute: change the `Fragment` branch to
```tsx
<div key={…} data-live={it.live || undefined} className="contents motion-safe:data-[live]:starting:opacity-0 motion-safe:data-[live]:starting:translate-y-1.5 motion-safe:data-[live]:transition-[opacity,translate] motion-safe:data-[live]:duration-150 motion-safe:data-[live]:ease-hv-out">{item}</div>
```
`contents` keeps the flex child positioning (`self-end`/`self-center`) intact — verify by reading the comment at `:748-749` and keeping the `outOfContext` wrapper branch as is (add the same `data-live`/classes there).
- [ ] **Step 4:** `npx vitest run tests/live-item-flag.test.ts tests/restore.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(motion): live transcript items rise in; restore and "show earlier" never do`

### Task 5: B2 — menus share `hv-menu-in`

**Files:** Modify `ModelSelect.tsx:105-109`; `ChatView.tsx:1544, 1608, 1645, 2320, 2377, 2445, 2488`; `TabStrip.tsx:373-385`; `FileTree.tsx:333`; `OnboardingDoors.tsx:125`. Test: `tests/menu-enter.test.ts`.

- [ ] **Step 1: Failing test**

```ts
// tests/menu-enter.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Every floating menu enters from its anchor with ONE shared class (B2). A
 * `bottom-full`/`top-full` positioned `absolute … z-` element is a menu. */
const files = ["ModelSelect.tsx", "ChatView.tsx", "TabStrip.tsx", "FileTree.tsx", "OnboardingDoors.tsx"];
describe("menus enter with hv-menu-in", () => {
  for (const f of files) {
    it(f, () => {
      const src = fs.readFileSync(path.join("src/renderer/src/components", f), "utf8");
      const menus = [...src.matchAll(/className=\{?[`"][^`"]*\babsolute\b[^`"]*\b(?:bottom-full|top-full)\b[^`"]*[`"]/g)];
      expect(menus.length, `${f} has menus`).toBeGreaterThan(0);
      for (const m of menus) expect(m[0], m[0].slice(0, 80)).toContain("hv-menu-in");
    });
  }
  it("the class sets its origin per direction at the call site, not in CSS", () => {
    const css = fs.readFileSync("src/renderer/src/styles.css", "utf8");
    expect(css).not.toMatch(/\.hv-menu-in[^}]*transform-origin/);
  });
});
```
Run → FAIL. (If a site's menu is positioned with `fixed` and coordinates rather than `bottom-full`/`top-full` — the tab context menu at `TabStrip.tsx:373` may be — extend the regex with `\bfixed\b` for that file and keep the assertion.)

- [ ] **Step 2:** Add `hv-menu-in` plus the origin to each menu's class string: `origin-bottom-left` on `bottom-full` menus, `origin-top-left` on `top-full` ones, `origin-top-left` on the fixed context menu. Exits untouched.
- [ ] **Step 3:** `npx vitest run tests/menu-enter.test.ts tests/tabstrip-menu.test.ts` → PASS; typecheck.
- [ ] **Step 4: Commit** — `feat(motion): every menu enters from its anchor with one shared class`

### Task 6: B3 — banners, notices, toasts

**Files:** Modify `Banner.tsx:32-33`; `App.tsx:2832-2851` (Banner mounts) and `:1606` (session-reloading notice); `ChatView.tsx:989-1021` (banners), `:1030` (AGENTS.md offer strip), `:1179` (voice toast).

- [ ] **Step 1:** `Banner.tsx`: wrap the root in a grid reveal. Replace the root with
```tsx
<div className="grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-[160ms] motion-safe:ease-hv-out motion-safe:starting:grid-rows-[0fr] motion-safe:starting:opacity-0 grid-rows-[1fr]">
  <div className={`min-h-0 overflow-hidden flex items-center gap-3 px-6 py-2.5 border-b-2 text-sm font-semibold ${BANNER_TONE[tone]}`}>
    {…existing children and dismiss button…}
  </div>
</div>
```
`BANNER_TONE` stays the exported record (`tests/how-it-works.test.ts` / guidance tests read it).
- [ ] **Step 2:** For each Banner call site that is a conditional render, wrap with `usePresence(cond, DUR.fast)` → `{b.mounted && <Banner … data-leaving={b.leaving || undefined} />}` and let `Banner` accept `"data-leaving"?: true` to add `data-[leaving]:grid-rows-[0fr] data-[leaving]:opacity-0 data-[leaving]:duration-120 data-[leaving]:ease-hv-in` on the outer grid. Where a Banner is not conditional (always shown while a state holds), leave enter-only.
- [ ] **Step 3:** Voice toast, AGENTS.md strip, reloading notice: add `motion-safe:starting:opacity-0 motion-safe:starting:translate-y-2 motion-safe:transition-[opacity,translate] motion-safe:duration-[160ms] motion-safe:ease-hv-out` and, where conditional, the same `usePresence(…, DUR.fast)` + `data-[leaving]:opacity-0 data-[leaving]:duration-120` pair. A fade-out lands on `opacity-0` exactly (coverage rule).
- [ ] **Step 4:** `npx vitest run tests/how-it-works.test.ts tests/guidance*.test.ts` (whichever reads `BANNER_TONE`) → PASS; typecheck.
- [ ] **Step 5: Commit** — `feat(motion): banners unfold, toasts rise, both fade out`

### Task 7: B4 — hand-rolled confirms adopt the dialog classes

**Files:** Modify `App.tsx:3430-3436` (terminal-kill), `ChatView.tsx:1053-1055` (rewind), `:1186` (large paste), `FileTree.tsx:369, :401`, `ContextPanel.tsx:453`.

- [ ] **Step 1:** In each, the scrim `<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" …>` becomes `className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/60 p-8"` (drop `z-50`; `.hv-overlay` supplies z-100 + fade-in). The inner card gets `hv-dialog-flow` appended to its class (NOT `hv-dialog` — its keyframes translate by −50%, see Task 1's CSS comment).
- [ ] **Step 2:** `npx vitest run tests/modal-layer.test.ts tests/pane-dialog.test.ts tests/browser-coverage.test.ts` → PASS (the "nothing above z-50 in use" scan must still list the app scale unchanged; the five confirms no longer contribute `z-50`).
- [ ] **Step 3: Commit** — `feat(motion): the five hand-rolled confirms use the dialog layer and its animation`

### Milestone 2 GUI pass (`/uicheck`) — observable assertions

| Page | Claim | Absence |
|---|---|---|
| Chat, Files rail → open drawer | Drawer slides in 12 px from the right over ~180 ms; closing fades it out and it is GONE from the DOM after ~120 ms (`document.querySelector('[data-hv-drawer]') === null`). | The browser pane (if open) is NOT blanked while the drawer opens — `data-covered` on its placeholder stays `"false"`. |
| Chat → Settings → Models → Chat | Each page fades up on entry; a streaming assistant bubble keeps streaming through the switch. | No fade-out on leaving a page (instant). |
| Chat, send a prompt | The user bubble and each new tool card rise in once; reopen the same session → NOTHING animates on restore; click "Show earlier messages" → NOTHING animates. | No `data-live` attribute on any restored node (`document.querySelectorAll('[data-live]').length === 0` right after reopen). |
| Composer `+`, `@`, model picker, tab right-click | Menu scales from its anchor corner; closes instantly. | The pane `+` menu's items are still clickable on first press (`tests/tabstrip-menu.test.ts` regression). |
| Terminal-kill confirm (close a chat tab with an agent terminal) | Scrim fades, card pops; it paints ABOVE the sticky rail card. | No `z-50` scrim left: the confirm's scrim computed `z-index` is `100`. |

**Regression sequence:** open the drawer, split the pane, open a browser tab in the right pane, close the drawer → the browser page must be visible the whole time (coverage never fires on a fade that ends at exactly 0).

---

## Milestone 3 — the flight: A1 prerequisites, A1, A2, A3

### Task 8: Prereq 1 — stable DOM key (`domKey`) + DOM markers

**Files:** Modify `src/renderer/src/runRail.ts:15-27, 76-97`; `ChatView.tsx:1925` (React key) and `:1931` (button); `ToolCard.tsx:666` and `:840` (card roots). Test: `tests/run-rail.test.ts`.

**Interfaces — Produces:** `RunAvatar.domKey: string`; DOM attrs `data-hv-run-card={toolCallId}` (card roots), `data-hv-run-avatar={domKey}` (circle button). `DelegationRun` must expose the originating tool-call id: add `toolCallId?: string` to `DelegationRun` in `agents.ts` and set it wherever the foreground run is created from `tool_execution_start` (`App.tsx`, the handler that builds `{ id: t.toolCallId, kind: "fg", … }` — grep `kind: "fg"`); the re-key at `App.tsx:1420-1424` spreads `fg`, so `toolCallId` survives the re-key by construction.

- [ ] **Step 1: Failing test** (append to `tests/run-rail.test.ts`)

```ts
describe("domKey — React key = DOM identity (A1 prereq 1)", () => {
  it("a delegation keeps its tool-call id as its DOM key across the async re-key", () => {
    const fg = { id: "tc1", toolCallId: "tc1", kind: "fg", agent: "worker", label: "x", startedAt: 0, status: "running" } as never;
    const rekeyed = { ...(fg as object), id: "async-uuid", kind: "async" } as never;
    expect(toRunAvatars([fg], [])[0].domKey).toBe("tc1");
    expect(toRunAvatars([rekeyed], [])[0].domKey).toBe("tc1");
    expect(toRunAvatars([rekeyed], [])[0].key).toBe("async-uuid"); // the map key still follows the run id
  });
  it("a run with no tool-call id (post-respawn resync) falls back to its run id", () => {
    const r = { id: "run9", kind: "async", agent: "worker", label: "", startedAt: 0, status: "running" } as never;
    expect(toRunAvatars([r], [])[0].domKey).toBe("run9");
  });
  it("a terminal's DOM key is its terminal id", () => {
    const t = { terminalId: "t1", title: "zsh", running: true, intent: "", startedAt: 0 };
    expect(toRunAvatars([], [t])[0].domKey).toBe("t1");
  });
});
```
Run → FAIL (`domKey` undefined).

- [ ] **Step 2:** `runRail.ts`: add to `RunAvatar`
```ts
  /** React key AND `data-hv-run-avatar`: the tool-call id when the run has one, so the async
   *  re-key (toolCallId → asyncId, App.tsx tool_execution_end) does not destroy the circle's DOM node. */
  domKey: string;
```
and set `domKey: r.toolCallId ?? r.id` for delegations, `domKey: t.terminalId` for terminals.
- [ ] **Step 3:** `ChatView.tsx:1925`: `key={a.domKey}`; `:1931` button gains `data-hv-run-avatar={a.domKey}`. `ToolCard.tsx:666` (SubagentCard root) and `:840` (generic root): add `data-hv-run-card={card.toolCallId}` (use the card's existing tool-call id field name — read `ToolCardData` at the top of the file).
- [ ] **Step 4:** `npx vitest run tests/run-rail.test.ts tests/run-rail-layout.test.ts tests/agents-renderer.test.ts` → PASS; typecheck.
- [ ] **Step 5: Commit** — `fix(rail): key the circle on the tool-call id so the async re-key keeps its DOM node`

### Task 9: Prereq 2 — `started` updates a run it can find, adds otherwise

**Files:** Modify `src/renderer/src/agents.ts` (new pure `applySubagentStarted`), `App.tsx:894-907` (call it). Test: `tests/agents-renderer.test.ts` (append).

**Interfaces — Produces:**
```ts
export function applySubagentStarted(
  runs: Record<string, DelegationRun>,
  started: { runId: string; agent?: string; label: string },
  now: number,
): Record<string, DelegationRun>;
```

- [ ] **Step 1: Failing test**

```ts
describe("applySubagentStarted — update-if-present, add-otherwise (A1 prereq 2)", () => {
  const fg = { id: "tc1", toolCallId: "tc1", kind: "fg", agent: "worker", label: "Fix the tests", startedAt: 1, status: "running" } as DelegationRun;
  it("attaches the runId to the ONE running foreground run of that agent instead of adding a second circle", () => {
    const out = applySubagentStarted({ tc1: fg }, { runId: "run1", agent: "worker", label: "[prompt redacted]" }, 5);
    expect(Object.keys(out)).toEqual(["tc1"]);
    expect(out.tc1.runId).toBe("run1");
    expect(out.tc1.label).toBe("Fix the tests"); // the notify's caption never wins
  });
  it("adds when nothing matches — the post-respawn resync has no foreground card", () => {
    const out = applySubagentStarted({}, { runId: "run1", agent: "worker", label: "x" }, 5);
    expect(out.run1).toMatchObject({ id: "run1", kind: "async", status: "running" });
  });
  it("two same-agent delegations: the second started attaches to the run that has no runId yet", () => {
    const a = { ...fg, id: "tc1", toolCallId: "tc1" }, b = { ...fg, id: "tc2", toolCallId: "tc2" };
    const one = applySubagentStarted({ tc1: a, tc2: b }, { runId: "r1", agent: "worker", label: "" }, 5);
    const two = applySubagentStarted(one, { runId: "r2", agent: "worker", label: "" }, 6);
    expect([two.tc1.runId, two.tc2.runId].sort()).toEqual(["r1", "r2"]);
    expect(Object.keys(two)).toHaveLength(2);
  });
});
```
Run → FAIL.

- [ ] **Step 2:** `agents.ts`: add `runId?: string` to `DelegationRun` and
```ts
/**
 * A1 prereq 2 (2026-09-10): `subagent:async-started` used to ADD a run keyed by
 * runId beside the foreground card until the re-key deleted the card — two
 * circles for one delegation. Update the running foreground run of that agent
 * that has no runId yet; ADD only when none exists, because the same notify
 * serves the /hv-subagent-list resync after a respawn (App.tsx ~:967), where
 * there is no card to update. Never let the notify's caption win (it is
 * redacted upstream, hv-subagent-tasks.ts is best-effort).
 */
export function applySubagentStarted(runs: Record<string, DelegationRun>, started: { runId: string; agent?: string; label: string }, now: number): Record<string, DelegationRun> {
  if (runs[started.runId]) return runs;
  const host = Object.values(runs).find((r) => r.kind === "fg" && r.status === "running" && !r.runId && (!started.agent || r.agent === started.agent));
  if (host) return { ...runs, [host.id]: { ...host, runId: started.runId } };
  return { ...runs, [started.runId]: { id: started.runId, kind: "async", agent: started.agent ?? "subagent", label: started.label, startedAt: now, status: "running" } };
}
```
- [ ] **Step 3:** `App.tsx:894-907`: replace the body of the `started` branch with `setDelegations((p) => ({ ...p, [sid]: applySubagentStarted(p[sid] ?? {}, { runId: sub.runId!, agent: sub.agent, label: runLabel(sub.task) }, Date.now()) }));`. The re-key at `:1402-1426` already prefers `fg`'s label/agent; keep `raised` handling (a `complete` that arrives keyed by runId before the re-key must still find its run: in the `complete`/`control` branches, look up `p[sid][sub.runId] ?? Object.values(p[sid]).find(r => r.runId === sub.runId)`).
- [ ] **Step 4:** `npx vitest run tests/agents-renderer.test.ts tests/delegation-card-outcome.test.ts tests/subagent-inspect-card.test.ts` → PASS; typecheck.
- [ ] **Step 5: Commit** — `fix(rail): one delegation is one circle — started attaches to the foreground run`

### Task 10: Prereq 3 — terminal `toolCallId` join (bridge → main → renderer)

**Files:** Modify `pi-runtime/extensions/happyvibe-bridge.ts:1784-1797`; `src/main/ipc.ts:230-245` (`parseTerminalReq`) and `:1733-1740` (notify); `src/renderer/src/agents.ts:415-421` (`TerminalEvent`); `App.tsx:201` (`agentTerms` type) and `:1114-1117`; `runRail.ts` (terminal `toolCallId` → `domKey`); `TerminalRunCard.tsx:25-33` (`TerminalRun.toolCallId?`); `docs/validation/d1.md:924-931`. Tests: `tests/terminal-toolcallid.test.ts` (new, key-free), `tests/terminal-bridge.test.ts` (live, one assertion).

**Interfaces — Produces:** `hv.terminal-run` payload `{kind, command, terminalId?, intent, toolCallId}`; `hv.terminal` started notify gains `toolCallId?: string`; `TerminalRun.toolCallId?: string`; `RunAvatar.domKey` for a terminal = `t.toolCallId ?? t.terminalId`.

- [ ] **Step 1: Failing key-free test**

```ts
// tests/terminal-toolcallid.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseTerminalEvent } from "../src/renderer/src/agents";
import { toRunAvatars } from "../src/renderer/src/runRail";

const BRIDGE = fs.readFileSync("pi-runtime/extensions/happyvibe-bridge.ts", "utf8");
const IPC = fs.readFileSync("src/main/ipc.ts", "utf8");

describe("a terminal's tool-call id travels bridge → main → renderer (A1 prereq 3)", () => {
  it("the bridge puts toolCallId in the hv.terminal-run payload instead of discarding it", () => {
    const run = BRIDGE.slice(BRIDGE.indexOf("TERMINAL_TOOL_DESCRIPTIONS.terminal_run"), BRIDGE.indexOf("TERMINAL_TOOL_DESCRIPTIONS.terminal_run") + 1400);
    expect(run).toContain("async execute(toolCallId,");
    expect(run).toMatch(/kind: "hv\.terminal-run"[^}]*toolCallId/);
  });
  it("main parses it and echoes it on the started notify", () => {
    expect(IPC).toMatch(/toolCallId: typeof p\.toolCallId === "string" \? p\.toolCallId : undefined/);
    const notify = IPC.slice(IPC.indexOf('stage: "started",\n                  terminalId: res.terminalId'), IPC.indexOf('stage: "started",\n                  terminalId: res.terminalId') + 300);
    expect(notify).toContain("toolCallId: term.toolCallId");
  });
  it("the renderer reads it off the notify and keys the circle on it", () => {
    const ev = parseTerminalEvent({ method: "notify", message: JSON.stringify({ kind: "hv.terminal", stage: "started", terminalId: "t1", title: "zsh", toolCallId: "tc7" }) });
    expect(ev?.toolCallId).toBe("tc7");
    const a = toRunAvatars([], [{ terminalId: "t1", title: "zsh", running: true, intent: "", startedAt: 0, toolCallId: "tc7" }])[0];
    expect(a.domKey).toBe("tc7");
    expect(a.key).toBe("t1");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Bridge** (`:1784`): `async execute(toolCallId, params, _signal, _onUpdate, ctx)` and the payload `JSON.stringify({ kind: "hv.terminal-run", command: checked.command, terminalId, intent, toolCallId })`. Comment beside it: *"§12/A1: the card knows this id, the circle needs it — main echoes it on the started notify."*
- [ ] **Step 3: Main** — `parseTerminalReq` run branch returns `toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined` (extend the return type); the started `notify({...})` at `:1733` gains `toolCallId: term.toolCallId`.
- [ ] **Step 4: Renderer** — `TerminalEvent.toolCallId?: string`; `agentTerms` value type `{ intent: string; startedAt: number; toolCallId?: string }` and set it at `:1114-1117` from `termEv.toolCallId`; wherever `TerminalRun[]` is assembled for `RunRail` (grep `intent: agentTerms` in `ChatView.tsx`/`App.tsx`) carry `toolCallId`; `TerminalRun.toolCallId?: string`; `runRail.ts` terminal `domKey: t.toolCallId ?? t.terminalId`.
- [ ] **Step 5: d1.md** — in the `hv.terminal` block at `:926-929`, add `"toolCallId": "call_…"` to BOTH the `hv.terminal-run` input payload (documented above it in the same section) and the started notify, with one sentence: *"Carried from the bridge's `execute(toolCallId)` so the renderer can key the run rail's circle on the same id the transcript card has (A1, 2026-09-10)."*
- [ ] **Step 6: Live test** — in `tests/terminal-bridge.test.ts`, where the fake main parses the `hv.terminal-run` input (around `:65`), add `expect(typeof payload.toolCallId).toBe("string")` on the parsed input payload.
- [ ] **Step 7:** `npx vitest run tests/terminal-toolcallid.test.ts tests/run-rail.test.ts tests/agents-renderer.test.ts` → PASS; typecheck (this includes `tsconfig.extensions.json` for the bridge).
- [ ] **Step 8: Commit** — `feat(terminal): carry the tool-call id from the bridge to the run rail`
- [ ] **Step 9: Live batch.** `npm run live:why` now prints the bridge file and the terminal-bridge test. Check `pgrep -fl "npm run dev"` (none running), then `npm run test:live > /tmp/live.log 2>&1; echo EXIT=$?` in the background (~6 min). Read the WALL TIME (a 5 s "green" means no `.env`; `ln -s ~/Documents/Github/HappyVibe/.env .env` first). One red ⇒ rerun that file alone before calling it a regression.

### Task 11: A1 — the flight; A2 — circle enter / exit / shift; A3 — overlay + readout

**Files:** Modify `ChatView.tsx:1833-1986` (`RunRail`), `:1921` (row), `:1931-1942` (button), `:1943-1979` (hover readout), `:1983` + `RUN_RAIL_OVERLAY :1814`; `App.tsx:1435-1442` (2.5 s timer → `leaving`); `agents.ts` (`DelegationRun.leaving?: true`); `TerminalRunCard.tsx` (`TerminalRun.leaving?` not needed — terminals do not time out). Test: `tests/run-rail-layout.test.ts` (append).

**Interfaces — Consumes:** `flyGhost`, `snapshotRects`, `flipChildren`, `reducedMotion`, `usePresence`, `DUR`, `EASE`; `data-hv-run-card`, `data-hv-run-avatar`, `data-hv-pane-session` (`App.tsx:3179`).

- [ ] **Step 1: Failing tests** (append to `tests/run-rail-layout.test.ts`)

```ts
describe("the flight and the circle's own motion (A1/A2/A3)", () => {
  it("the ghost is positioned INLINE, never by class word — the coverage check matches [class~=fixed]", () => {
    const motion = fs.readFileSync("src/renderer/src/motion.ts", "utf8");
    expect(motion).toContain('position: "fixed"');
    expect(motion).not.toMatch(/className|classList\.add\("fixed"|"absolute"/);
  });
  it("the circle enters via starting: and leaves via data-leaving, both motion-safe", () => {
    expect(chat).toContain("motion-safe:starting:scale-[.6]");
    expect(chat).toContain("data-[leaving]:scale-[.6]");
    expect(chat).toContain("data-[leaving]:opacity-0");
  });
  it("the flight never scrolls the transcript", () => {
    const rail = chat.slice(chat.indexOf("function RunRail"), chat.indexOf("function RunRail") + 9000);
    expect(rail).not.toContain("scrollIntoView");
    expect(rail).not.toContain("scrollTo(");
  });
  it("the hover readout has no exit and keeps the no-gap pt-1", () => {
    const readout = chat.slice(chat.indexOf("hover === a.key && open !== a.key"), chat.indexOf("hover === a.key && open !== a.key") + 700);
    expect(readout).toContain("pt-1");
    expect(readout).not.toContain("data-[leaving]");
  });
  it("the sticky wrapper string is untouched", () => {
    expect(chat).toContain('className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full"');
  });
});
```
Run → FAIL.

- [ ] **Step 2: A2 enter/exit on the button** (`:1931`). Class additions:
```
motion-safe:transition-[transform,opacity,border-color] motion-safe:duration-[160ms] motion-safe:ease-hv-pop motion-safe:starting:scale-[.6] motion-safe:starting:opacity-0 data-[leaving]:scale-[.6] data-[leaving]:opacity-0 data-[leaving]:duration-150 data-[leaving]:ease-hv-in data-[flying]:opacity-0
```
plus `data-leaving={a.leaving || undefined}` and `data-flying={flying === a.domKey || undefined}` (state below). Expose `leaving` on `RunAvatar` (`runRail.ts`: `leaving?: true`, from `DelegationRun.leaving`). Ring colour: `RUN_STATE_RING` stays data; `transition-[…border-color]` above covers it.
- [ ] **Step 3: exit timer** (`App.tsx:1435-1442`): before the 2 500 ms delete, add `setTimeout(() => setDelegations(p => mark leaving: true on p[sid][t.toolCallId]), 2_350)`. Same pattern in the async `complete` branch if it also deletes on a timer (read `:915-940`).
- [ ] **Step 4: A1 flight + A2 sibling shift in `RunRail`.** Inside `RunRail`:
```tsx
const rowRef = useRef<HTMLDivElement>(null);
const prevKeys = useRef<Set<string> | null>(null);       // null = first render → never fly (restore)
const prevRects = useRef<Map<string, DOMRect>>(new Map());
const [flying, setFlying] = useState<string | null>(null);
useLayoutEffect(() => {
  const row = rowRef.current;
  const keys = new Set(avatars.map((a) => a.domKey));
  if (row && prevKeys.current) {
    flipChildren(row, "data-hv-run-avatar", prevRects.current);           // siblings slide into a gap
    const fresh = [...keys].filter((k) => !prevKeys.current!.has(k));
    for (const k of fresh) void fly(k);
  }
  if (row) prevRects.current = snapshotRects(row, "data-hv-run-avatar");
  prevKeys.current = keys;
}, [avatars]);

async function fly(domKey: string): Promise<void> {
  if (reducedMotion()) return;
  const row = rowRef.current;
  const circle = row?.querySelector<HTMLElement>(`[data-hv-run-avatar="${domKey}"]`);
  const pane = row?.closest<HTMLElement>("[data-hv-pane-session]");
  const card = pane?.querySelector<HTMLElement>(`[data-hv-run-card="${domKey}"]`);
  const scroller = card?.closest<HTMLElement>(".overflow-y-auto");        // the transcript scroller
  if (!circle || !card || !scroller) return;                               // → A2 pop-in only
  const r = card.getBoundingClientRect(), s = scroller.getBoundingClientRect();
  if (r.bottom < s.top || r.top > s.bottom) return;                        // off-screen → pop-in only; NEVER scroll
  const header = card.querySelector<HTMLElement>(":scope > button, :scope > div") ?? card;
  setFlying(domKey);
  header.animate([{ opacity: 1 }, { opacity: 0.6, offset: 0.5 }, { opacity: 1 }], { duration: DUR.flight });
  await flyGhost(header, circle, { duration: DUR.flight, round: true });
  setFlying(null);
  circle.animate([{ transform: "scale(1.1)" }, { transform: "scale(1)" }], { duration: 120, easing: EASE.pop });
}
```
Attach `ref={rowRef}` to the `pt-3 flex items-center gap-2 flex-wrap` row. `data-flying` keeps the circle at `opacity-0` until the ghost lands.
- [ ] **Step 5: A3 overlay + promoted card + readout.** Overlay (`:1983`): wrap in `usePresence(open !== null && !promoted.has(open), 100)`; the overlay div gets `motion-safe:starting:scale-[.96] motion-safe:starting:opacity-0 motion-safe:transition-[transform,opacity] motion-safe:duration-[160ms] motion-safe:ease-hv-out data-[leaving]:opacity-0 data-[leaving]:scale-[.96] data-[leaving]:duration-100 data-[leaving]:ease-hv-in` and an inline `style={{ transformOrigin }}` computed from the clicked circle's rect relative to the overlay's parent (`rowRef.current!.parentElement!.getBoundingClientRect()`). Hover readout (`:1943`): `motion-safe:starting:opacity-0 motion-safe:starting:-translate-y-0.5 motion-safe:transition-[opacity,translate] motion-safe:duration-100` — enter only. Promoted card wrapper (above the row): `grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-180 motion-safe:starting:grid-rows-[0fr] motion-safe:starting:opacity-0 grid-rows-[1fr]` with `min-h-0 overflow-hidden` on the child.
- [ ] **Step 6:** `npx vitest run tests/run-rail.test.ts tests/run-rail-layout.test.ts tests/modal-layer.test.ts tests/browser-coverage.test.ts` → PASS; typecheck.
- [ ] **Step 7: Commit** — `feat(rail): the card flies to its circle; circles enter, leave and shift; the overlay grows from its circle`

### Milestone 3 GUI pass (`/uicheck`) — observable assertions

| Page | Claim | Absence |
|---|---|---|
| Chat, ask for a delegation ("use a worker sub-agent to list the files") | A ghost of the card header flies to the rail and becomes a circle; the circle then squashes in; the card is still in the transcript, header dipped and back. | Exactly ONE circle per delegation at every instant — screenshot 300 ms after dispatch and count `[data-hv-run-avatar]`; no second circle appears and vanishes. |
| Same, with two delegations to the same agent in one turn | Two circles, two different `data-hv-run-avatar` values, each keyed by its tool-call id. | No circle's DOM node is replaced mid-run (`el === document.querySelector(…)` before and after the async re-key). |
| Chat, `terminal_run` | The terminal card flies to a circle; the circle's `data-hv-run-avatar` EQUALS the card's `data-hv-run-card`. | — |
| Reopen a session with a live delegation (respawn) | Circle present via resync, NO flight, NO enter animation on restore (first render never flies). | `flyGhost` is never called: no element with inline `position: fixed` and `pointer-events: none` under `<body>` during the first second. |
| Scroll the transcript up so the card is off-screen, then dispatch | The circle pops in; the transcript does NOT scroll. | No ghost. |
| Finished foreground delegation | The circle shrinks and fades at ~2.35 s and is gone at 2.5 s; its right-hand sibling slides left 200 ms. | — |
| Click a circle → overlay | The card grows from that circle's centre; Escape / same-circle click closes with a 100 ms fade. | No `fixed inset-0` catcher (pinned); the hover readout disappears INSTANTLY on mouse-out (the STOP is never late). |
| Browser pane open in the right half during all of the above | The page stays visible. | `data-covered="false"` throughout; the ghost never overlaps the browser rect. |

**Regression sequence:** dispatch two delegations, let one finish (circle leaves, sibling shifts), open the remaining circle, Escape, dispatch a third → third flies, overlay stays closed, no stale `data-flying` circle at opacity 0.

---

## Milestone 4 — A5 sidebar, B5 splits, A8 working indicator

### Task 12: A5 — one `<aside>` whose width transitions, content crossfades

**Files:** Modify `src/renderer/src/components/Sidebar.tsx:811-859` (collapsed) and `:863-1244` (expanded). Test: `tests/sidebar-aside.test.ts` (new source scan).

- [ ] **Step 1: Failing test**

```ts
// tests/sidebar-aside.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
const SB = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
describe("the sidebar is ONE aside so its width can transition (A5)", () => {
  it("exactly one <aside>", () => { expect(SB.match(/<aside\b/g)?.length).toBe(1); });
  it("the width transitions and the two contents stack in one grid cell without absolute", () => {
    expect(SB).toContain("motion-safe:transition-[width]");
    const aside = SB.slice(SB.indexOf("<aside"), SB.indexOf("<aside") + 600);
    expect(aside).toContain("grid");
    expect(aside).not.toContain("absolute inset-0"); // a coverage candidate
  });
});
```
Run → FAIL (two asides).

- [ ] **Step 2:** Restructure: delete the early `return` at `:811`. One root:
```tsx
<aside ref={asideRef} className={`${railCollapsed ? "w-12" : "w-64"} shrink-0 bg-paper-deep pegboard border-r-2 border-line grid overflow-hidden motion-safe:transition-[width] motion-safe:duration-180 motion-safe:ease-hv-out`}>
  <div className={`col-start-1 row-start-1 flex flex-col items-center py-3 gap-2 motion-safe:transition-opacity motion-safe:duration-100 ${railCollapsed ? "opacity-100" : "opacity-0 pointer-events-none"}`} aria-hidden={!railCollapsed}>
    {…the former collapsed subtree, minus its <aside>…}
  </div>
  <div className={`col-start-1 row-start-1 flex flex-col min-w-64 motion-safe:transition-opacity motion-safe:duration-100 ${railCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"}`} aria-hidden={railCollapsed}>
    {…the former expanded subtree, minus its <aside>…}
  </div>
</aside>
```
`min-w-64` on the expanded child keeps it from reflowing while the width animates; `overflow-hidden` on the aside clips it. Both children share `col-start-1 row-start-1` (same grid cell) — NOT `absolute`. Hidden child is `opacity-0 pointer-events-none aria-hidden`, so no duplicate focus targets: also add `tabIndex={-1}`-safe `inert` (`inert={railCollapsed || undefined}` on the expanded child, the inverse on the collapsed one — React 19 supports the boolean `inert` prop).
- [ ] **Step 3:** `npx vitest run tests/sidebar-aside.test.ts tests/go-to.test.ts tests/session-order.test.ts` (any test reading Sidebar source) → PASS; typecheck.
- [ ] **Step 4: Commit** — `feat(sidebar): one aside; collapse animates the width and crossfades the contents`

### Task 13: B5 — pane split / unsplit

**Files:** Modify `App.tsx:2920-2925` (the grid div with `style={gridStyle}`), `:3526-3600` (dividers — find the drag start/end handlers).

- [ ] **Step 1:** Add `const [dragging, setDragging] = useState(false);` set true on a divider's `onMouseDown` and false on the document `mouseup` the existing drag code already listens for. Grid div class: `flex-1 min-w-0 min-h-0 grid relative motion-safe:transition-[grid-template-columns,grid-template-rows] motion-safe:duration-180 motion-safe:ease-hv-out data-[dragging]:transition-none` with `data-dragging={dragging || undefined}`.
- [ ] **Step 2:** New pane content already rises via A7's `data-live` on transcript items; nothing else.
- [ ] **Step 3:** `npx vitest run tests/pane-dividers.test.ts tests/tabs.test.ts` → PASS; typecheck.
- [ ] **Step 4: Commit** — `feat(motion): pane splits animate the grid; drags stay direct`

### Task 14: A8 — sidebar "agent is working" indicator

**Files:** Create `src/renderer/src/sessionDot.ts`; modify `Sidebar.tsx:505-535` (row dot), `:640-650` (props) and the collapsed tiles (`:832-853` before Task 12; now inside the first grid child); `App.tsx` (pass `busy` to `<Sidebar>` — grep `<Sidebar` and add `busy={busy}`). Test: `tests/session-dot.test.ts`.

**Interfaces — Produces:**
```ts
export type DotState = "working" | "alive" | "waking" | "crashed" | "idle";
export const SESSION_DOT: Record<DotState, string>;
export function sessionDotState(status: SessionStatus | undefined, busy: boolean): DotState;
```

- [ ] **Step 1: Failing test**

```ts
// tests/session-dot.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { SESSION_DOT, sessionDotState } from "../src/renderer/src/sessionDot";

describe("the session dot tells working from alive (A8, PRD §17 2026-09-10)", () => {
  it("busy wins, then the process status", () => {
    expect(sessionDotState("running", true)).toBe("working");
    expect(sessionDotState("running", false)).toBe("alive");
    expect(sessionDotState("waking", false)).toBe("waking");
    expect(sessionDotState("crashed", false)).toBe("crashed");
    expect(sessionDotState(undefined, false)).toBe("idle");
    expect(sessionDotState(undefined, true)).toBe("working"); // a turn in flight IS working, whatever main thinks
  });
  it("only WORKING spins, only WAKING pulses — alive is a plain dot", () => {
    expect(SESSION_DOT.working).toContain("animate-spin");
    expect(SESSION_DOT.alive).not.toContain("animate-");
    expect(SESSION_DOT.waking).toContain("animate-pulse");
    for (const k of ["crashed", "idle"] as const) expect(SESSION_DOT[k]).not.toContain("animate-");
  });
  it("the row reads the record — no inline ternary over animate-pulse remains", () => {
    const sb = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
    expect(sb).toContain("SESSION_DOT[sessionDotState(status, busy)]");
    expect(sb).not.toContain('? "bg-leaf animate-pulse"');
  });
  it("the collapsed workspace tile spins when any of its sessions is busy", () => {
    const sb = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
    expect(sb).toContain("wsBusy");
    expect(sb).toMatch(/wsBusy[^\n]*&&[^\n]*SESSION_DOT\.working|SESSION_DOT\.working[^\n]*wsBusy/);
  });
});
```
Run → FAIL.

- [ ] **Step 2: `sessionDot.ts`**

```ts
import type { SessionStatus } from "./App";

/**
 * A8 (2026-09-10): the row's dot used to be the PROCESS status, so every open
 * session pulsed green whether the agent was mid-turn or idle. Five states,
 * derived here, rendered from data (the suite has no DOM). Working is a
 * ROTATION precisely because pulse already meant "alive".
 */
export type DotState = "working" | "alive" | "waking" | "crashed" | "idle";

export function sessionDotState(status: SessionStatus | undefined, busy: boolean): DotState {
  if (busy) return "working";
  if (status === "running") return "alive";
  if (status === "waking") return "waking";
  if (status === "crashed") return "crashed";
  return "idle";
}

/** Class for the 6px dot slot. `working` is a ring with a gap (a spinner), not a filled dot. */
export const SESSION_DOT: Record<DotState, string> = {
  working: "size-2.5 rounded-full border-[1.5px] border-tangerine border-t-transparent motion-safe:animate-spin [animation-duration:1.2s] motion-reduce:border-t-tangerine",
  alive: "size-1.5 rounded-full bg-leaf",
  waking: "size-1.5 rounded-full bg-honey animate-pulse",
  crashed: "size-1.5 rounded-full bg-berry",
  idle: "size-1.5 rounded-full bg-line-strong",
};

export const DOT_TITLE: Record<DotState, string> = {
  working: "working…", alive: "running", waking: "waking up…", crashed: "crashed", idle: "idle",
};
```
(`motion-reduce:border-t-tangerine` closes the gap so the settled frame is a full ring, not a broken one.)
- [ ] **Step 3: Row** (`Sidebar.tsx:505-535`): delete the `dot` ternary; `SessionRow` gains `busy: boolean`; render `<span className={`shrink-0 ${SESSION_DOT[sessionDotState(status, busy)]}`} title={DOT_TITLE[sessionDotState(status, busy)]} />`. The age slot condition at `:591` becomes `!status && !busy` (round 15's rule kept). `Sidebar` props: `busy: Record<string, boolean>`; pass `busy={!!busy[s.id]}` at `:1046`. `App.tsx`: `<Sidebar … busy={busy} />`.
- [ ] **Step 4: Collapsed tile**: compute `const wsBusy = (ws: string): boolean => sessions.some((s) => s.workspaceId === ws && busy[s.id]);` and inside each tile button add `{wsBusy(ws) && <span aria-hidden className={`absolute -top-1 -right-1 ${SESSION_DOT.working}`} />}` with `relative` on the button. This `absolute` is INSIDE the sidebar, never overlapping a browser pane (the sidebar is left of the centre grid), so it is not a coverage hazard.
- [ ] **Step 5:** `npx vitest run tests/session-dot.test.ts tests/sidebar-aside.test.ts` → PASS; typecheck.
- [ ] **Step 6: Commit** — `feat(sidebar): a spinning dot means the agent is working; a plain dot means alive`

### Milestone 4 GUI pass (`/uicheck`) — observable assertions

| Page | Claim | Absence |
|---|---|---|
| ⌘\ with a browser pane open in the centre | Sidebar width animates 180 ms; contents crossfade; the browser page shows no tearing (bounds follow). If it tears: skip the width transition while a browser pane is visible and record it. | Only ONE `<aside>` in the DOM; the hidden child has `aria-hidden="true"` and `inert`. |
| Sidebar, two sessions open, one mid-turn | The busy row shows a spinning tangerine ring; the idle-but-alive row a PLAIN green dot (not pulsing); a hibernated row keeps ☾. | No row shows `animate-pulse` on a green dot (`document.querySelectorAll('.bg-leaf.animate-pulse').length === 0`). |
| Collapsed sidebar, same state | The workspace tile of the busy session carries the spinner badge; the other tile has none. | Badge disappears within one render of the turn ending. |
| Split a pane, unsplit | Columns animate 180 ms; dragging the divider is direct (no lag). | `data-dragging` is absent when the mouse is up. |

---

## Milestone 5 — B1, B6, Tier C

### Task 15: B1 — tool card expand/collapse + status mark pop

**Files:** Modify `ToolCard.tsx:60-72` (`STATUS`), `:594/669/709` (open bodies), `:825-888`, `DetailsToggle :432`.

- [ ] **Step 1:** Each expandable body becomes `<div className="grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-180 motion-safe:ease-hv-out" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}><div className="min-h-0 overflow-hidden">{open && body}</div></div>`; the body itself gets `motion-safe:starting:opacity-0 motion-safe:transition-opacity motion-safe:duration-120`. Content mounted only when open (unchanged). For `openDiff` bodies over ~200 lines, animate the container only (already the case — the inner is mounted once).
- [ ] **Step 2:** Status mark: give the mark element `key={card.status}` and `motion-safe:starting:scale-50 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-hv-pop`. `STATUS`/`BADGE_MARKS`/`STATUS_MARK` remain exported records (the renderer tests read them).
- [ ] **Step 3:** `npx vitest run tests/agents-renderer.test.ts tests/tool-card*.test.ts` → PASS; typecheck. **Commit** — `feat(motion): tool cards unfold; status marks pop`

### Task 16: B6 — tabs enter; "Open as tab" flight

**Files:** Modify `TabStrip.tsx:239-260` (tab button: `data-hv-tab={id}`, enter classes); `TerminalRunCard.tsx:135-145` + `App.tsx:1834` (`openAgentTerminalAsTab`).

- [ ] **Step 1:** Tab button: `data-hv-tab={id}` and `motion-safe:starting:scale-90 motion-safe:starting:opacity-0 motion-safe:transition-[transform,opacity] motion-safe:duration-120 motion-safe:ease-hv-out`. Tab close: instant (no presence).
- [ ] **Step 2:** In `openAgentTerminalAsTab`, after the tab is added, `requestAnimationFrame(() => { const from = document.querySelector<HTMLElement>(`[data-hv-run-avatar="${toolCallId ?? terminalId}"]`); const to = document.querySelector<HTMLElement>(`[data-hv-tab="${tabId}"]`); if (from && to) void flyGhost(from, to, { duration: 280 }); })` — run BEFORE the circle is dropped from state, or the `from` element is gone; then drop it.
- [ ] **Step 3:** `npx vitest run tests/tabs.test.ts tests/tabstrip-menu.test.ts tests/layout-persist.test.ts` → PASS; typecheck. **Commit** — `feat(motion): tabs pop in; an agent terminal flies from its circle to its tab`

### Task 17: Tier C — C1 PlanCard mark, C2 session list FLIP, C3 file-tree fade, C4 settings group

**Files:** `PlanCard.tsx:34` (`STATUS_META`), `Sidebar.tsx` (session list container + `:1137-1180` settings group), `FileTree.tsx:263-266`.

- [ ] **Step 1 (C1):** the plan checklist item mark: `key={item.done}` + `motion-safe:starting:scale-50 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-hv-pop`.
- [ ] **Step 2 (C2):** session list container `ref={listRef}` and rows `data-hv-session={s.id}`; `useLayoutEffect(() => { const el = listRef.current; if (!el) return; flipChildren(el, "data-hv-session", prev.current); prev.current = snapshotRects(el, "data-hv-session"); }, [orderedSessions])`; new row: `motion-safe:starting:opacity-0 motion-safe:starting:translate-y-1 motion-safe:transition-[opacity,translate] motion-safe:duration-150`.
- [ ] **Step 3 (C3):** `FileTree.tsx:266` children wrapper: `motion-safe:starting:opacity-0 motion-safe:transition-opacity motion-safe:duration-100`.
- [ ] **Step 4 (C4):** settings group body: the same `grid` 0fr↔1fr pattern as B1, 150 ms.
- [ ] **Step 5:** `npx vitest run tests/session-order.test.ts tests/go-to.test.ts tests/plan-*.test.ts` → PASS; typecheck. **Commit** — `feat(motion): plan marks pop, sessions reorder in place, trees and groups unfold`

### Milestone 5 GUI pass (`/uicheck`)

| Page | Claim | Absence |
|---|---|---|
| Chat, expand/collapse a bash card and a 300-line diff card | Body unfolds 180 ms; the big diff unfolds once with no double layout. | The `⋯` toggle still toggles (aria-expanded flips). |
| Card running → done | The status mark pops once at the transition. | `animate-pulse` remains ONLY on running marks (the "still going" signal). |
| Terminal card → Open as tab | Ghost flies from the circle to the new tab; circle gone after. | No leftover ghost node under `<body>` after 400 ms. |
| Sidebar, send in a lower session | Its row slides to the top over 200 ms (no jump). | The row under the pointer does not reorder mid-hover if `bySidebarOrder` pins it (unchanged rule). |

---

## Final gate

- [ ] `npm run gate` → green (build includes both typechecks). `npm run live:why` → prints the bridge + terminal-bridge test (Task 10) → the live batch from Task 10 Step 9 was green with a real wall time (~6 min).
- [ ] `git diff main --stat -- package.json` shows NO dependency change.
- [ ] `/uicheck` tables above all checked; every "Absence" column verified by DOM query, not by eye.
- [ ] Notion "Animations" page status callout → **implemented (date)**; PRD §20/§12/§17 decisions already folded (2026-09-10).

## Self-review

- **Spec coverage:** A1 (T8-11) · A2 (T11) · A3 (T11) · A4 (T2) · A5 (T12) · A6 (T3) · A7 (T4) · A8 (T14) · B1 (T15) · B2 (T5) · B3 (T6) · B4 (T7) · B5 (T13) · B6 (T16) · C1-4 (T17) · tokens/helpers/dead CSS/comment (T1) · d1 wire shape (T10) · traps §5.1-10 in Global Constraints.
- **Types:** `RunAvatar.domKey`/`leaving`, `DelegationRun.toolCallId`/`runId`/`leaving`, `TerminalRun.toolCallId`, `TerminalEvent.toolCallId`, `TranscriptItem.live` are each introduced once and used by name afterwards.
