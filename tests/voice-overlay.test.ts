import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §27 round 2. Source-level pins for the recording indicator.
 *
 * There is no React test infra in this repo (no jsdom, no testing-library), and
 * adding one for these two assertions is not worth the dependency — but both
 * failures are INVISIBLE in review and in a casual GUI pass, so they are pinned
 * by reading the source rather than left unguarded.
 */
const ROOT = path.join(__dirname, "..");
const OVERLAY = fs.readFileSync(path.join(ROOT, "src/renderer/src/components/VoiceOverlay.tsx"), "utf8");
const MIC = fs.readFileSync(path.join(ROOT, "src/renderer/src/components/MicButton.tsx"), "utf8");
const CHAT = fs.readFileSync(path.join(ROOT, "src/renderer/src/components/ChatView.tsx"), "utf8");

describe("the recording overlay", () => {
  it("PORTALS to document.body — a display:none pane would collapse it to 0x0", () => {
    // Measured: App gives each pane `display:none` when the active view is not
    // "chat", and that collapses a position:fixed descendant. Without the
    // portal, opening a settings page mid-recording hid the only indicator
    // there was — a hot microphone with no feedback.
    expect(OVERLAY).toContain("createPortal");
    expect(OVERLAY).toContain("document.body");
    expect(OVERLAY).toMatch(/from\s+["']react-dom["']/);
  });

  it("stays viewport-fixed and centred, and never eats clicks meant for the transcript", () => {
    expect(OVERLAY).toContain("fixed");
    expect(OVERLAY).toContain("pointer-events-none");
    // …while its own button remains clickable.
    expect(OVERLAY).toContain("pointer-events-auto");
  });

  it("drives the glow from the live level, rather than animating regardless", () => {
    // If this becomes a CSS keyframe animation it will look identical while
    // telling the user nothing about whether the microphone is working.
    expect(OVERLAY).toContain("boxShadow");
    expect(OVERLAY).toMatch(/level/);
  });

  it("names its own escape, so cancel is discoverable without the docs", () => {
    expect(OVERLAY).toContain("Esc to cancel");
  });
});

describe("the composer chip", () => {
  it("no longer renders a level meter — that was the space complaint", () => {
    // The old meter was five spans with inline percentage heights.
    expect(MIC).not.toMatch(/height:\s*`?\$\{/);
    expect(MIC).not.toContain("0.35, 0.7, 1, 0.7, 0.35");
  });

  it("still refuses the HTML disabled attribute", () => {
    // Unchanged invariant: a disabled button swallows the click that the whole
    // activation flow depends on. Only aria-disabled is allowed.
    expect(MIC).toContain("aria-disabled");
    expect(MIC).not.toMatch(/\n\s+disabled=\{/);
  });

  it("is rendered conditionally, so both new settings can hide it", () => {
    expect(CHAT).toContain("dictation.showChip");
  });
});
