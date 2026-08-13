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
      "terminal",
      "voice",
      "stats",
      "audit",
      "shortcuts",
    ]);
  });

  test("every destination still has exactly one row", () => {
    expect(NAV).toHaveLength(14);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(14);
    expect(new Set(NAV.map((n) => n.label)).size).toBe(14);
  });

  test("every row has a label and an icon — a blank row is a dead end", () => {
    for (const n of NAV) {
      expect(n.label.trim().length).toBeGreaterThan(0);
      expect(typeof n.Icon).toBe("function");
    }
  });
});
