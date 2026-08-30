import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * §12/§26 (2026-08-30): the rail's GEOMETRY and its ABSENCES.
 *
 * The renderer suite has no DOM, so the half of this feature that cannot be
 * asserted by rendering is asserted by scanning the source — the
 * tests/modal-layer.test.ts pattern. Each case here corresponds to a trap this
 * app has already paid for once (see CLAUDE.md).
 */
const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
const term = readFileSync("src/renderer/src/components/TerminalRunCard.tsx", "utf8");
const rail = chat.slice(chat.indexOf("function RunRail"), chat.indexOf("export const GAUGE_TONE"));

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

  it("the rail found a RunRail body to scan", () => {
    // Guards every other case in this file: an empty slice would pass the
    // negative assertions vacuously.
    expect(rail.length).toBeGreaterThan(1000);
  });
});

describe("the overlay's geometry is the one that was specced", () => {
  it("the sticky container is a positioning ancestor", () => {
    // An `absolute` overlay inside the sticky header positions against the
    // nearest POSITIONED ancestor. Without `relative` here it escapes to the
    // pane and lands somewhere else entirely.
    expect(chat).toContain('className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full"');
  });

  it("the overlay is left-anchored, not centred", () => {
    const overlay = chat.slice(chat.indexOf("RUN_RAIL_OVERLAY ="), chat.indexOf("RUN_RAIL_OVERLAY =") + 200);
    expect(overlay).toContain("absolute");
    expect(overlay).toContain("left-0");
    expect(overlay).not.toContain("mx-auto");
  });

  it("nothing in the rail climbs above the cards' own layer", () => {
    // PRD §12 (2026-08-30): a readout, deliberately not dialog tier.
    // .hv-overlay/.hv-dialog own 100 and tests/modal-layer.test.ts guards it.
    expect(rail).not.toMatch(/z-\[?(3\d|[4-9]\d|\d{3,})/);
    expect(rail).toContain("z-20");
  });
});

describe("the dismissal traps this app has already been bitten by", () => {
  it("there is no full-viewport click-catcher", () => {
    // browserCoverage.ts gathers candidates by class word and judges them by
    // BOX, so a `fixed inset-0` catcher reads as covering every browser pane.
    expect(rail).not.toContain("fixed inset-0");
  });

  it("the rail does not dismiss on blur", () => {
    // A blur-dismissed surface unmounts between mousedown and mouseup and loses
    // its own click — reported twice as "none of this menu is clickable".
    expect(rail).not.toContain("onBlur");
  });

  it("the hover readout's STOP acts on mousedown", () => {
    expect(rail).toContain("onMouseDown");
  });

  it("Escape closes the overlay", () => {
    expect(rail).toContain('e.key === "Escape"');
  });
});

describe("the avatar's hue cannot be a Tailwind class", () => {
  it("is applied as an inline style", () => {
    // The JIT scanner never sees a computed class name and emits nothing, so a
    // `bg-[hsl(...)]` template would render every circle unstyled.
    expect(rail).toContain("style={{ backgroundColor: `hsl(");
    expect(rail).not.toMatch(/className=\{`[^`]*\$\{a\.hue\}/);
  });
});
