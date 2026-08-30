/**
 * §16 round 12 — the Settings list is ordered by how often it is reached.
 *
 * Round 8 ordered it by provenance, and §26/§27 then appended Terminal and
 * Voice after Keyboard shortcuts — two live features below a reference table.
 * The second test is the one that matters over time: a reorder must never lose
 * a destination, which is the failure a hand-edited array invites.
 */
import { describe, expect, test } from "vitest";
import { NAV } from "../src/renderer/src/components/Sidebar";

describe("settings nav order", () => {
  test("Models leads; the pages you consult rather than change trail", () => {
    expect(NAV.map((n) => n.view)).toEqual([
      "models",
      "plugins",
      "skills",
      "promptTemplates",
      "mcp",
      "agents",
      "tools",
      "permissions",
      "sysprompt",
      // §19 (2026-08-30): beside System prompt, because both answer the same
      // question — what does this app tell a model, that I never typed?
      "onBehalf",
      "terminal",
      "voice",
      // Editable bindings are configuration, so this closes that block rather
      // than trailing the read-only reports.
      "shortcuts",
      "stats",
      "audit",
      // §30: product state like the two above it — what this build is, and what
      // changed to get here. Last because it is the least often reached.
      "changelog",
    ]);
  });

  test("every destination still has exactly one row", () => {
    expect(NAV).toHaveLength(16);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(16);
    expect(new Set(NAV.map((n) => n.label)).size).toBe(16);
  });

  test("every row has a label and an icon — a blank row is a dead end", () => {
    for (const n of NAV) {
      expect(n.label.trim().length).toBeGreaterThan(0);
      expect(typeof n.Icon).toBe("function");
    }
  });
});
