import { describe, expect, it } from "vitest";
import { planPillLabel, showsPlanPill } from "../src/renderer/src/components/ChatView";

/**
 * §23 round 9 — the pill is the route to a plan whose transcript card was
 * compacted away. Its whole value is reporting the plan's REAL status, so the
 * regression these tests guard is the one 833a966 removed: an implemented plan
 * presented as a pending draft.
 */
describe("showsPlanPill", () => {
  it("surfaces a plan the user can still act on", () => {
    expect(showsPlanPill("draft")).toBe(true);
    expect(showsPlanPill("implementing")).toBe(true);
  });

  it("still surfaces an IMPLEMENTED plan — the transcript route may be gone", () => {
    expect(showsPlanPill("implemented")).toBe(true);
  });

  it("hides a cancelled plan (nothing to read, nothing to do)", () => {
    expect(showsPlanPill("cancelled")).toBe(false);
  });
});

describe("planPillLabel", () => {
  it("never calls a non-draft plan 'ready'", () => {
    expect(planPillLabel("implemented", 8, 8)).toBe("Plan implemented");
    expect(planPillLabel("implementing", 3, 8)).toBe("Implementing 3/8");
  });

  it("labels a real draft", () => {
    expect(planPillLabel("draft", 0, 0)).toBe("Plan ready");
  });
});
