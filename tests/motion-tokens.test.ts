import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DUR, EASE } from "../src/renderer/src/motion";
import { SESSION_DOT } from "../src/renderer/src/sessionDot";

/**
 * Animations round (2026-09-10) — the motion vocabulary has ONE source.
 *
 * The tokens live in `styles.css`'s `@theme` (so Tailwind emits `ease-hv-*`
 * utilities) and are mirrored as data in `motion.ts` (so the WAAPI helpers and
 * these tests can read them). Two copies of a number is exactly the drift
 * §20's Principle 11 forbids, so this file pins them equal — as a SOURCE SCAN,
 * because the renderer suite has no DOM and never will (tests/modal-layer's
 * pattern).
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const CSS = R("src/renderer/src/styles.css");

describe("motion tokens (Animations round, 2026-09-10)", () => {
  it("motion.ts mirrors the CSS easings exactly — one source, two consumers", () => {
    expect(CSS).toContain(`--ease-hv-out: ${EASE.out};`);
    expect(CSS).toContain(`--ease-hv-in: ${EASE.in};`);
    expect(CSS).toContain(`--ease-hv-pop: ${EASE.pop};`);
  });

  it("the pop easing IS the existing dialog overshoot, not a second one beside it", () => {
    expect(CSS).toMatch(/hv-pop-in 180ms cubic-bezier\(0\.34, 1\.4, 0\.64, 1\)/);
    expect(EASE.pop).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
  });

  it("durations are the four the spec names and nothing is over 320 ms", () => {
    expect(Object.values(DUR).sort((a, b) => a - b)).toEqual([120, 150, 180, 320]);
  });

  it("dead shimmer CSS is gone", () => {
    // `.hv-shimmer` had zero callers for the app's whole life. Vocabulary
    // nobody speaks is not vocabulary.
    expect(CSS).not.toContain("hv-shimmer");
  });

  it("the CSP comment no longer blames the CSP for a taste decision", () => {
    // A bundled npm library IS `'self'` and loads fine; only CDN/blob/data are
    // blocked. §27's worklet hit that wall because it was a BLOB URL, not
    // because it was a library. Recording the zero-deps choice against the
    // wrong reason is how it gets reversed for the wrong reason later.
    expect(CSS).not.toContain("an animation runtime cannot load at all");
  });

  it("every new animated class is neutralised under reduced motion", () => {
    // The rule is the SETTLED FRAME, never a faster animation (§22's rule,
    // made general). A class added to the stylesheet without a line here is a
    // motion a reduced-motion user still sees.
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.length).toBeGreaterThan(0);
    for (const cls of ["hv-menu-in", "hv-dialog-flow"]) expect(reduced, cls).toContain(`.${cls}`);
  });
});

/**
 * Animations round (2026-09-10) — the Tailwind v4 trap that cost a GUI pass.
 *
 * v4 compiles `scale-*` to the **`scale` property** and `translate-*` to the
 * **`translate` property**, not to `transform` as v3 did. A transition list
 * naming `transform` therefore leaves the size or position change INSTANT
 * while everything beside it animates — which looks almost right, reviews
 * clean, and is invisible in a screenshot.
 *
 * It was found by reading the emitted CSS in the running app, not by watching
 * the animation. This scan is what stops the next one shipping.
 */
describe("a transition names the property Tailwind v4 actually sets", () => {
  const RENDERER = path.join(process.cwd(), "src/renderer/src");

  /** Every `className` value in the renderer, as raw text. */
  const classStrings = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".tsx")) {
          const src = fs.readFileSync(full, "utf8");
          for (const m of src.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) out.push(`${path.relative(process.cwd(), full)}::${m[1]}`);
        }
      }
    };
    walk(RENDERER);
    return out;
  };

  const withTransition = (): string[] => classStrings().filter((c) => c.includes("transition-["));

  it("finds transition lists to check — a scan matching nothing passes vacuously", () => {
    expect(withTransition().length).toBeGreaterThanOrEqual(5);
  });

  it("any class that scales also transitions `scale`", () => {
    const bad = withTransition().filter((c) => /\bscale-\[/.test(c) && !/transition-\[[^\]]*\bscale\b/.test(c));
    expect(bad.map((c) => c.split("::")[0])).toEqual([]);
  });

  it("any class that translates also transitions `translate`", () => {
    const bad = withTransition().filter((c) => /\btranslate-[xy]-/.test(c) && !/transition-\[[^\]]*\btranslate\b/.test(c));
    expect(bad.map((c) => c.split("::")[0])).toEqual([]);
  });

  it("nothing transitions bare `transform` — v4 emits none of these through it", () => {
    const bad = withTransition().filter((c) => /transition-\[[^\]]*\btransform\b/.test(c));
    expect(bad.map((c) => c.split("::")[0])).toEqual([]);
  });
});

/**
 * The reveal that opens and SNAPS shut (Animations round, 2026-09-10).
 *
 * A `grid-template-rows` 0fr↔1fr wrapper around `{open && children}` opens
 * beautifully and closes in one frame: the open row's height comes from its
 * content, so the moment React unmounts that content there is nothing left to
 * animate from. Measured in the running app before the fix — 280px → 0px, no
 * intermediate.
 *
 * `Unfold` is the one place that gets this right, so every height reveal goes
 * through it rather than being hand-rolled a fifth time.
 */
describe("height reveals go through Unfold", () => {
  const UNFOLD = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components/Unfold.tsx"), "utf8");

  it("Unfold keeps its children alive for the close", () => {
    expect(UNFOLD).toContain("usePresence");
    expect(UNFOLD).toContain("present.mounted && children");
  });

  it("and still refuses to render them while collapsed", () => {
    // The other half of the bargain: a collapsed delegation transcript costs
    // nothing. `mounted` is false at rest, not merely hidden.
    expect(UNFOLD).not.toMatch(/\{children\}(?![^]*present\.mounted)/);
  });

  it("the inner element can shrink to nothing", () => {
    // A grid item's default `min-height: auto` refuses to shrink below its
    // content, so without this the row never reaches 0fr and it never closes.
    expect(UNFOLD).toContain("min-h-0");
    expect(UNFOLD).toContain("overflow-hidden");
  });

  it("every height reveal has SOMETHING keeping its content alive for the close", () => {
    // The rule is not "always use Unfold" — `Banner` and the AGENTS.md strip
    // hand-roll the same rows because their CALLER already holds them mounted
    // through `usePresence` and drives them by `data-leaving`, which satisfies
    // the requirement a different way. What must never exist is a 0fr↔1fr
    // wrapper with no mechanism at all: that one opens and snaps shut.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".tsx") && e.name !== "Unfold.tsx") {
          const src = fs.readFileSync(full, "utf8");
          const reveals = /grid-rows-\[0fr\]/.test(src) && /grid-rows-\[1fr\]/.test(src);
          const keepsAlive = src.includes("data-leaving") || src.includes("usePresence");
          if (reveals && !keepsAlive) offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src/renderer/src"));
    expect(offenders).toEqual([]);
  });
});

/**
 * What this round deliberately did NOT animate (Animations round, 2026-09-10).
 *
 * Each of these is a decision with a reason, and each is the kind of decision a
 * later "let's polish this too" quietly reverses. They are cheaper to pin than
 * to re-argue.
 */
describe("the deliberate absences", () => {
  const R2 = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("the transcript's autoscroll stays instant", () => {
    // `Transcript.tsx` explains it at length: smooth scroll fights the `follow`
    // heuristic, so the view ends up chasing itself. The in-conversation
    // search's match-centring keeps its own smooth scroll and is untouched.
    const tx = R2("src/renderer/src/components/Transcript.tsx");
    const follow = tx.slice(tx.indexOf("bottom.current?.scrollIntoView"), tx.indexOf("bottom.current?.scrollIntoView") + 120);
    expect(follow).not.toContain('behavior: "smooth"');
  });

  it("the streaming bubble and the busy dots are not given an enter", () => {
    // They already move. A7's `live` flag is stamped by `appendItem`, and the
    // in-progress turn renders OUTSIDE `items` precisely so a delta re-renders
    // only itself — animating it would fight that.
    const tx = R2("src/renderer/src/components/Transcript.tsx");
    const tail = tx.slice(tx.indexOf("{streaming && <AssistantBubble"));
    expect(tail.slice(0, 600)).not.toContain("starting:");
  });

  it("no number is tweened", () => {
    // Cost, tokens, context % and elapsed all tick. Tweening a ticker is noise
    // dressed as polish — and `contextUsage.tokens` is null right after a
    // compaction, so a tween would animate towards a lie.
    for (const f of ["ContextBubble.tsx", "CostBubble.tsx"]) {
      const src = R2(`src/renderer/src/components/${f}`);
      expect(src, f).not.toMatch(/transition-\[[^\]]*width/);
      expect(src, f).not.toContain("motion-safe:starting:");
    }
  });

  it("the width DRAGS stay untransitioned", () => {
    // A dragged edge must track the pointer exactly. The drawer's strip writes
    // px per mousemove and the pane divider writes a percentage; easing either
    // one makes it lag the hand holding it.
    const app = R2("src/renderer/src/App.tsx");
    const strip = app.slice(app.indexOf('aria-label="Resize the panel"'), app.indexOf('aria-label="Resize the panel"') + 400);
    expect(strip).not.toContain("transition-[width]");
    expect(app).toContain("data-dragging");
  });

  it("the pulse still means 'still going' everywhere it survived", () => {
    // A8 took the pulse off the sidebar's ALIVE dot on purpose — that is the
    // whole change. It must stay on the states that really are in progress.
    const card = R2("src/renderer/src/components/ToolCard.tsx");
    expect(card).toContain('running: { dot: "bg-sky animate-pulse"');
    expect(SESSION_DOT.waking).toContain("animate-pulse");
    expect(SESSION_DOT.alive).not.toContain("animate-pulse");
  });

  it("the composer's auto-grow is untouched", () => {
    // Its height goes `auto` → measured px per keystroke; a transition there
    // would lag the caret behind the text being typed.
    const chat = R2("src/renderer/src/components/ChatView.tsx");
    const grow = chat.slice(chat.indexOf("scrollHeight"), chat.indexOf("scrollHeight") + 300);
    expect(grow).not.toContain("transition");
  });
});
