import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A5 (Animations round, 2026-09-10) — the sidebar is ONE element.
 *
 * ⌘\ used to swap between two different `<aside>` subtrees behind an early
 * return, so there was no shared node whose width could change and nothing
 * could animate. The two contents now stack in the same grid cell and
 * crossfade while the width transitions.
 *
 * The renderer suite has no DOM, so this pins the structure by scanning the
 * source — and every case below is a way the refactor fails in the running app
 * while still looking correct in review.
 */
const SB = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components/Sidebar.tsx"), "utf8");

describe("the sidebar is one aside, so its width can transition (A5)", () => {
  it("there is exactly one <aside>", () => {
    expect(SB.match(/<aside\b/g)?.length).toBe(1);
    expect(SB.match(/<\/aside>/g)?.length).toBe(1);
  });

  it("the early return that made two subtrees is gone", () => {
    expect(SB).not.toMatch(/if \(railCollapsed\) \{\s*\n\s*const railBtn/);
  });

  it("the width transitions", () => {
    const aside = SB.slice(SB.indexOf("<aside"), SB.indexOf("<aside") + 500);
    expect(aside).toContain("motion-safe:transition-[width]");
    expect(aside).toContain("grid");
    expect(aside).toContain("overflow-hidden");
  });

  it("the two halves stack in one grid cell, NOT with absolute inset-0", () => {
    // An absolutely positioned full-height overlay is a candidate for §28's
    // coverage check, which judges by bounding box — it would blank a browser
    // pane sitting beside it, for the life of the app.
    // Counted in class strings only — the design note above the element uses
    // the same words in prose.
    const stacked = SB.match(/className=\{`col-start-1 row-start-1/g);
    expect(stacked?.length).toBe(2);
    expect(SB).not.toContain("absolute inset-0 w-12");
    expect(SB).not.toContain("absolute inset-0 w-64");
  });

  it("the hidden half is inert AND aria-hidden, not merely transparent", () => {
    // It stays in the DOM at full size. Without `inert` every one of its
    // buttons keeps its place in the tab order, and ⌘K could focus a search
    // box nobody can see.
    expect(SB).toContain("inert={!railCollapsed || undefined}");
    expect(SB).toContain("inert={railCollapsed || undefined}");
    expect(SB).toContain("aria-hidden={!railCollapsed || undefined}");
    expect(SB).toContain("aria-hidden={railCollapsed || undefined}");
    expect(SB.match(/pointer-events-none/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the expanded half keeps its own width while the aside animates through", () => {
    // Without `min-w-64` its contents reflow through every intermediate width,
    // which reads as the text being squeezed rather than the panel sliding.
    expect(SB).toContain("min-w-64");
  });
});
