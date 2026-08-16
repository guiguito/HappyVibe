import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BADGE_MARKS, STATUS_MARK } from "../src/renderer/src/components/ToolCard";

/**
 * Round 15 — every word on a tool card becomes an icon, its text on hover.
 *
 * Two halves, and the second is the one that rots. The mapping below pins that
 * each state HAS a glyph and a tooltip; the source scan pins that the words are
 * actually GONE from the row, which is the part a future edit re-introduces by
 * adding one more helpful pill. There is no DOM in this suite (vitest include
 * is `tests/**\/*.test.ts` with no jsdom), so a rendered-output assertion is not
 * available — the scan is the substitute, and it is why the mapping is exported
 * as data rather than written inline as JSX.
 */

const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "ToolCard.tsx"),
  "utf8",
);

describe("every status and badge carries a glyph and its word", () => {
  it("each terminal status maps to a mark with a non-empty tooltip", () => {
    for (const status of ["done", "error", "denied", "skipped"] as const) {
      const mark = STATUS_MARK[status];
      expect(mark, `${status} has no mark`).toBeTruthy();
      expect(mark!.title.length).toBeGreaterThan(0);
      expect(mark!.tone).toMatch(/^text-/);
    }
  });

  it("running has NO glyph — the pulsing dot is the signal", () => {
    // A glyph for "in progress" is a worse animation than an animation.
    expect(STATUS_MARK.running).toBeNull();
  });

  it("every badge keeps the word it replaced, as its tooltip", () => {
    expect(BADGE_MARKS.allowed.title).toBe("Allowed by you");
    expect(BADGE_MARKS.session.title).toBe("Allowed for this session");
    expect(BADGE_MARKS.denied.title).toBe("Denied");
    expect(BADGE_MARKS.plan.title).toBe("Skipped — not allowed in plan mode");
    expect(BADGE_MARKS.destructive.title).toBe("Destructive command");
  });

  it("no two marks are the same shape AND the same colour", () => {
    // Distinguishable at a glance is the whole point of dropping the words.
    const seen = new Set<string>();
    for (const m of Object.values(BADGE_MARKS)) {
      const key = `${m.kind}/${m.tone}`;
      expect(seen.has(key), `duplicate mark ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("the words are gone from the card row", () => {
  /**
   * The rendered strings, as they appeared before round 15. Matched as JSX text
   * nodes (`>word<`) or as bare quoted literals in a className-free position —
   * a substring search alone would hit the tooltips, which are supposed to
   * contain these words.
   */
  const GONE = [
    ">details<",
    ">hide details<",
    ">not in plan mode<",
    ">session pass<",
    ">allowed<",
    ">destructive<",
  ];

  it.each(GONE)("%s is no longer rendered as text", (needle) => {
    const flat = SRC.replace(/\s+/g, "");
    expect(flat.includes(needle.replace(/\s+/g, ""))).toBe(false);
  });

  it("the status label is no longer printed beside the details toggle", () => {
    // The old row ended `{s.label}` then the toggle. `s.label` survives only as
    // the dot's title/aria-label, never as visible text.
    expect(SRC).not.toMatch(/>\{s\.label\}</);
    expect(SRC).toMatch(/title=\{s\.label\}/);
  });
});
