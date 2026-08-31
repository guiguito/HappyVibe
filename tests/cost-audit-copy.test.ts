import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COST_COPY } from "../src/renderer/src/components/CostPanel";
import { AUDIT_COPY } from "../src/renderer/src/components/AuditView";

/**
 * §20 round 17 — the two data-dense surfaces that explained nothing.
 *
 * Doctrine rule 6: a fact the user needs TO DECIDE is inline; a fact for the
 * curious is a tooltip. Both surfaces had the deciding fact in hover, or
 * nowhere.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const rendered = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the cost panel is honest in visible text", () => {
  it("says every number is an estimate, once, where the numbers are read", () => {
    expect(COST_COPY.estimates).toContain("estimates");
    expect(rendered(path.join(R, "components/CostPanel.tsx"))).toContain("COST_COPY.estimates");
  });

  it("explains the cache column rather than leaving it to be guessed", () => {
    // §19: this is where estimate and invoice diverge hardest — 128 of pi-ai's
    // 266 OpenRouter entries price cacheRead at 0, while cache reads are most
    // of a coding agent's prompt tokens.
    expect(COST_COPY.cache.length).toBeGreaterThan(40);
    expect(COST_COPY.cache).toMatch(/\.$/);
  });

  it("the cache hint is DISCOVERABLE, not a bare title on a bare header", () => {
    // A native title= on a plain <th> gives no visual sign that hovering does
    // anything. The glyph is the affordance; the tooltip is still the browser's.
    const src = rendered(path.join(R, "components/CostPanel.tsx"));
    expect(src).toContain("aria-label");
    expect(src).toContain("<title>");
  });

  it("adds no floating surface to do it", () => {
    // browserCoverage.ts gathers coverage candidates by the literal class word,
    // so a hand-rolled popover here would blank an adjacent browser pane. Scoped
    // to the glyph: the panel ITSELF is legitimately positioned (round 15 made
    // it an in-pane panel), so a whole-file scan would be meaningless.
    const src = rendered(path.join(R, "components/CostPanel.tsx"));
    const glyph = src.slice(src.indexOf("function InfoDot"), src.indexOf("export function CostPanel"));
    expect(glyph.length).toBeGreaterThan(200); // not vacuous
    expect(glyph).not.toMatch(/\b(absolute|fixed)\b/);
  });
});

describe("the audit log explains its own clause", () => {
  it("says what a 'rules would have' row means, in visible text", () => {
    // sourceText() already RENDERS "bypass · rules would have asked" — the gap
    // was never that it was hidden, it was that nothing said what it meant.
    expect(AUDIT_COPY.wouldHave).toMatch(/would have/i);
    expect(AUDIT_COPY.wouldHave).toMatch(/\bask|\bdeny/i);
    expect(rendered(path.join(R, "components/AuditView.tsx"))).toContain("AUDIT_COPY.wouldHave");
  });

  it("does not restate what every row already says", () => {
    // Round 15 already made this mistake once with the SOURCE_TONE amber: with
    // a bypass on, EVERY row is a bypass, so repeating it per row says nothing.
    expect(AUDIT_COPY.wouldHave).not.toMatch(/^bypass/i);
  });
});
