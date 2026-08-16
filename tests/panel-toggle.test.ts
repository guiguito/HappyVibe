import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Round 15 — the cost and context panels have no close button; their pill is
 * the toggle and shows a pressed state.
 *
 * The same rule the Files panel got earlier this round, applied to the two
 * panels that still had an ✕: one entry point, one exit, the same control. What
 * makes it safe to remove the ✕ is that the pill now REPORTS the panel's state
 * — without that it would be a button that opens something you cannot see a way
 * out of.
 *
 * Source-scanned: this suite has no DOM, and the assertions that matter are
 * absences (see tests/tool-card-icons.test.ts for the same reasoning).
 */
const read = (...p: string[]): string =>
  fs.readFileSync(path.join(import.meta.dirname, "..", "src", "renderer", "src", ...p), "utf8");

const CONTEXT_PANEL = read("components", "ContextPanel.tsx");
const COST_PANEL = read("components", "CostPanel.tsx");
const CONTEXT_BUBBLE = read("components", "ContextBubble.tsx");
const COST_BUBBLE = read("components", "CostBubble.tsx");
const CHAT = read("components", "ChatView.tsx");

describe("neither panel carries its own close button", () => {
  it.each([
    ["ContextPanel", CONTEXT_PANEL],
    ["CostPanel", COST_PANEL],
  ])("%s has no ✕ in its header", (_name, src) => {
    // The header block, up to the first section after the <h2>.
    const header = src.slice(src.indexOf("<h2"), src.indexOf("<h2") + 600);
    expect(header).not.toContain('aria-label="Close"');
    expect(header).not.toContain("×");
  });

  it("the compaction confirm INSIDE the context panel keeps its own buttons", () => {
    // It is a modal, not the panel — removing its actions would strand the user.
    expect(CONTEXT_PANEL).toContain("onCancel");
  });
});

describe("each pill is a toggle that reports its panel", () => {
  it.each([
    ["ContextBubble", CONTEXT_BUBBLE],
    ["CostBubble", COST_BUBBLE],
  ])("%s takes `open`, fires `onToggle`, and sets aria-pressed", (_name, src) => {
    expect(src).toContain("open: boolean");
    expect(src).toContain("onToggle");
    expect(src).toContain("aria-pressed={open}");
    // The old one-way handler is gone, or the pill could open but never close.
    expect(src).not.toContain("onOpen");
  });

  it("ChatView wires them as toggles, not as open-only", () => {
    expect(CHAT).toContain("onToggle={() => onCostOpenChange(!costOpen)}");
    expect(CHAT).toContain("onToggle={() => onContextOpenChange(!contextOpen)}");
  });

  it("every pill variant has a distinct pressed class — including the neutral ones", () => {
    // The "—%" and "…%" bubbles have no zone hue, so they would otherwise show
    // no open-state at all: the exact case where the missing ✕ would strand.
    expect(CONTEXT_BUBBLE).toContain("NEUTRAL_PRESSED");
    for (const zone of ["calm", "amber", "red"]) {
      expect(CONTEXT_BUBBLE).toMatch(new RegExp(`${zone}: \\{[\\s\\S]*?pressed:`));
    }
    for (const tone of ["quiet", "calm", "amber"]) {
      expect(COST_BUBBLE).toMatch(new RegExp(`${tone}: \\{[\\s\\S]*?pressed:`));
    }
  });

  it("the pressed state of a coloured pill keeps its own hue", () => {
    // Zone colour is information (calm/amber/red) and cost amber means unknown
    // money. Overwriting either with the generic tangerine would trade a fact
    // for a state that the border already conveys.
    expect(CONTEXT_BUBBLE).toMatch(/pressed: "border-leaf .*text-leaf/);
    expect(CONTEXT_BUBBLE).toMatch(/pressed: "border-berry .*text-berry/);
    expect(COST_BUBBLE).toMatch(/pressed: "border-honey .*text-tangerine-deep/);
  });
});
