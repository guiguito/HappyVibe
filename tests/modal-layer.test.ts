import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §28 round 1 — a dialog must outrank everything, and DOM order does not do it.
 *
 * Radix portals a dialog to the end of <body>, which looks like "on top" and is
 * not: among POSITIONED elements an explicit z-index beats document order, so a
 * `z-20` element inside the app paints ABOVE a dialog whose z-index is `auto`.
 * Observed with the agent-terminal card (`sticky top-0 z-20`) sitting bright and
 * clickable over the ask-user modal's scrim.
 *
 * Two things are pinned here: the modal layer HAS a z-index, and nothing else in
 * the renderer climbs to it. The second is the one that rots — a future
 * `z-[200]` on some popover would silently take the crown back.
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const CSS = R("src/renderer/src/styles.css");

/** The floor the app may not reach. */
const MODAL_LAYER = 100;

describe("the modal layer (§28 round 1)", () => {
  it("both dialog classes declare the layer", () => {
    for (const cls of ["hv-overlay", "hv-dialog"]) {
      const block = CSS.slice(CSS.indexOf(`.${cls} {`), CSS.indexOf("}", CSS.indexOf(`.${cls} {`)));
      expect(block, cls).toContain(`z-index: ${MODAL_LAYER}`);
    }
  });

  it("nothing in the renderer outranks it", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          // Tailwind `z-40`, and arbitrary `z-[999]`.
          for (const m of src.matchAll(/\bz-(?:\[(\d+)\]|(\d+))\b/g)) {
            const value = Number(m[1] ?? m[2]);
            if (value >= MODAL_LAYER) offenders.push(`${path.relative(process.cwd(), full)}: z-${value}`);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src/renderer/src"));
    expect(offenders).toEqual([]);
  });

  it("the app's own scale is what we think it is (nothing above z-50 in use)", () => {
    const used = new Set<number>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const m of fs.readFileSync(full, "utf8").matchAll(/\bz-(?:\[(\d+)\]|(\d+))\b/g)) {
            used.add(Number(m[1] ?? m[2]));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src/renderer/src"));
    expect(Math.max(...used)).toBeLessThanOrEqual(50);
  });
});
