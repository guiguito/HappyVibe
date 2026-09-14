import { describe, it, test, expect } from "vitest";
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

  it("no dialog is hand-rolled below the layer any more — every SCRIM uses it", () => {
    // Animations round (2026-09-10): seventeen confirms were `fixed inset-0
    // z-50` scrims, which is BELOW the modal layer — so a sticky z-20 card
    // could paint over one, and none of them animated. They all carry
    // `.hv-overlay` now, and this scan is what stops the eighteenth arriving as
    // a copy-paste of the old shape.
    //
    // A SCRIM is a full-viewport element that TINTS what is behind it. That is
    // deliberately not the same shape as the app's other `fixed inset-0`
    // idiom, the transparent CLICK-CATCHER every menu uses to dismiss itself —
    // those are correct at z-10, must stay below their own menu, and are not
    // dialogs. The tint is what tells the two apart.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          src.split("\n").forEach((line, i) => {
            const scrim = /\bfixed inset-0\b/.test(line) && /\bbg-(?:ink|black|white|paper)\//.test(line);
            if (scrim && !line.includes("hv-overlay")) {
              offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
            }
          });
        }
      }
    };
    walk(path.join(process.cwd(), "src/renderer/src"));
    expect(offenders).toEqual([]);
  });
});

it("keeps the z-100 layer classes on a pane-scoped dialog", () => {
  // `.hv-overlay` / `.hv-dialog` are what put a dialog above the app's z-50
  // ceiling. Switching `fixed` to `absolute` (§7 round 21) must not drop them,
  // or every z-20 sticky card in the pane paints over the scrim again — which
  // is the defect the layer rule above was written for.
  for (const f of ["src/renderer/src/components/PermissionModal.tsx", "src/renderer/src/components/AskUserModal.tsx"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    expect(src).toContain("SCOPED_OVERLAY");
    expect(src).toContain("VIEWPORT_OVERLAY");
    expect(src).not.toContain("hv-overlay fixed inset-0");
  }
});

/**
 * The two pop animations are not interchangeable, and picking the wrong one
 * fails VISIBLY but silently (Animations round, 2026-09-10).
 *
 * `hv-pop-in` — used by `.hv-dialog` — carries `translate(-50%, -50%)` inside
 * its keyframes, because it animates a card centred by `top-1/2 left-1/2`
 * transforms. Put it on a card centred by FLEX and the transform displaces it
 * by half its own size for the length of the animation and then snaps back:
 * the card appears to expand from the top left. Reported from the running app,
 * on two Memory dialogs that predate this round.
 *
 * `hv-dialog-flow` is the same overshoot with no translate, for flex-centred
 * cards. So the rule is a biconditional, and both directions are pinned:
 * translate-centred ⇒ `.hv-dialog`; flex-centred ⇒ `.hv-dialog-flow`.
 */
describe("a dialog's pop matches how it is centred", () => {
  const tsx = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...tsx(full));
      else if (e.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  };
  const FILES = tsx(path.join(process.cwd(), "src/renderer/src"));

  /** Class strings carrying one of the two pop classes, with their file. */
  const popSites = (cls: string): Array<{ file: string; text: string }> => {
    const out: Array<{ file: string; text: string }> = [];
    for (const f of FILES) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
        const text = m[1];
        const has = new RegExp(`(^|\\s)${cls}(\\s|$)`).test(text);
        if (has) out.push({ file: path.relative(process.cwd(), f), text });
      }
    }
    return out;
  };

  const isTransformCentred = (c: string): boolean => c.includes("-translate-x-1/2") && c.includes("-translate-y-1/2");

  it("finds both kinds — a scan matching nothing passes vacuously", () => {
    expect(popSites("hv-dialog").length).toBeGreaterThan(0);
    expect(popSites("hv-dialog-flow").length).toBeGreaterThan(0);
  });

  it("`hv-dialog` is only ever on a transform-centred card", () => {
    const wrong = popSites("hv-dialog").filter((s) => !isTransformCentred(s.text));
    expect(wrong.map((s) => s.file)).toEqual([]);
  });

  it("`hv-dialog-flow` is only ever on a card centred some other way", () => {
    // The inverse mistake: this animation has no translate, so on a
    // transform-centred card the `-translate-x-1/2` is overwritten for the
    // length of the animation and the card jumps to the viewport centre.
    const wrong = popSites("hv-dialog-flow").filter((s) => isTransformCentred(s.text));
    expect(wrong.map((s) => s.file)).toEqual([]);
  });

  it("only one of the two keyframes carries a translate", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/styles.css"), "utf8");
    const popIn = css.slice(css.indexOf("@keyframes hv-pop-in {"), css.indexOf("@keyframes hv-fade-in"));
    const flow = css.slice(css.indexOf("@keyframes hv-pop-in-flow {"), css.indexOf(".hv-dialog-flow {"));
    expect(popIn).toContain("translate(-50%, -50%)");
    expect(flow).not.toContain("translate(");
  });
});

/**
 * §20 round 24 — a dialog's action row is right-aligned, confirming action last.
 *
 * Reported as one misaligned confirm; a sweep of every `.hv-dialog` /
 * `.hv-overlay` surface found a second. The rule governs FOOTERS: an inline
 * confirm inside a dialog's body (the memory detail panel's Edit / Forget) is
 * a different thing and deliberately out of scope.
 */
describe("dialog action rows are right-aligned", () => {
  const read = (f: string): string =>
    fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components", f), "utf8");

  test("the feedback dialog's discard confirm", () => {
    const src = read("FeedbackDialog.tsx");
    const row = src.slice(src.indexOf("{confirmDiscard ? ("), src.indexOf("{C.discardYes}"));
    expect(row).toContain("justify-end");
    // Order: the destructive action is LAST, so it is not the one under the cursor.
    expect(row).toContain("{C.keep}");
  });

  test("the memory importer's footer", () => {
    const src = read("MemorySection.tsx");
    const at = src.indexOf("Import selected");
    const row = src.slice(at - 1200, at + 200);
    expect(row).toContain("justify-end");
    expect(row.lastIndexOf("Cancel")).toBeLessThan(row.indexOf("Import selected"));
  });
});
