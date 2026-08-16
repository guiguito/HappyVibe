import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BADGE_MARKS } from "../src/renderer/src/components/ToolCard";

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

describe("status is carried ONCE, by the dot", () => {
  it("there is no status-glyph table at all", async () => {
    // The dot and a status glyph both derived from `card.status` — the same
    // single field — so the row said it twice. Worse for two statuses: a denied
    // card rendered the dot plus TWO identical red crosses (the badge and the
    // status), and a skipped one two identical skip glyphs.
    const mod = await import("../src/renderer/src/components/ToolCard");
    expect("STATUS_MARK" in mod).toBe(false);
  });

  it("the dot is the status, and it keeps the word for hover and screen readers", () => {
    expect(SRC).toMatch(/title=\{s\.label\}/);
    expect(SRC).toMatch(/aria-label=\{s\.label\}/);
  });

  it("the subagent card does not re-add one either", () => {
    // Its dot carries `delegationStatus`; the one thing colour cannot separate
    // (dispatched vs done, both leaf) is spelled out on the summary line.
    expect(SRC).toMatch(/title=\{delegationStatus\}/);
    expect(SRC).not.toContain("BADGE_MARKS.denied");
  });
});

describe("the badges that survive say what the dot cannot", () => {
  it("keeps who approved it, why it was skipped, and whether it destroys something", () => {
    expect(Object.keys(BADGE_MARKS).sort()).toEqual(["allowed", "destructive", "plan", "session"]);
  });

  it("every badge keeps the word it replaced, as its tooltip", () => {
    expect(BADGE_MARKS.allowed.title).toBe("Allowed by you");
    expect(BADGE_MARKS.session.title).toBe("Allowed for this session");
    expect(BADGE_MARKS.plan.title).toBe("Skipped — not allowed in plan mode");
    expect(BADGE_MARKS.destructive.title).toBe("Destructive command");
  });

  it("the plan badge earns its place by naming the REASON, which the dot does not", () => {
    // The dot's title for that status is just "skipped".
    expect(BADGE_MARKS.plan.title).toMatch(/plan mode/);
    expect(SRC).toMatch(/label: "skipped"/);
  });

  it("no two badges are the same shape AND the same colour", () => {
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
