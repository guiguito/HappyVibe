import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GROUPS, NAV, groupFor } from "../src/renderer/src/components/Sidebar";

/**
 * §16 round 18 — the flat 16-item list becomes four collapsible groups.
 *
 * The first test is the one that matters over time: grouping a navigation is
 * exactly the change that silently drops a destination, and it photographs
 * beautifully when it does.
 */
const R = path.join(import.meta.dirname, "..", "src", "renderer", "src");
const SRC = fs.readFileSync(path.join(R, "components", "Sidebar.tsx"), "utf8");
const APP = fs.readFileSync(path.join(R, "App.tsx"), "utf8");

describe("nothing was lost", () => {
  it("all 16 destinations survive, each in exactly one group", () => {
    expect(NAV).toHaveLength(16);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(16);
    for (const n of NAV) {
      expect(GROUPS.map((g) => g.id), `${n.view}`).toContain(n.group);
    }
  });

  it("every group has at least one item — an empty header is a dead end", () => {
    for (const g of GROUPS) {
      expect(NAV.filter((n) => n.group === g.id).length, g.id).toBeGreaterThan(0);
    }
  });

  it("the four groups are exactly these, in this order", () => {
    expect(GROUPS.map((g) => g.label)).toEqual([
      "Set up your agent",
      "What it's allowed to do",
      "What it did",
      "This app",
    ]);
  });
});

describe("the order lives in ONE place", () => {
  it("group members are contiguous in NAV, so NAV alone decides the order", () => {
    // A second array listing item names per group would put the order in two
    // places — §20 round 17 Principle 11. Contiguity is what lets the sidebar
    // render `NAV.filter(...)` while NAV stays the source of truth.
    const runs: string[] = [];
    for (const n of NAV) if (runs.at(-1) !== n.group) runs.push(n.group);
    expect(runs.length).toBe(new Set(runs).size);
  });

  it("round 12's frequency order survives within each group", () => {
    expect(NAV.map((n) => n.view)).toEqual([
      "models", "plugins", "skills", "promptTemplates", "mcp", "agents",
      // Permissions leads its group ahead of All Tools: the more often
      // reached of the two, and the group's own thesis.
      "permissions", "tools", "sysprompt",
      "onBehalf", "stats", "audit",
      "terminal", "voice", "shortcuts", "changelog",
    ]);
  });
});

describe("every row is reachable and legible", () => {
  // Folded in from the retired tests/sidebar-nav-order.test.ts, whose order
  // assertion is the one above — two files pinning the same array is the
  // re-typing this repo's Principle 11 exists to stop.
  it("every row has a label and an icon — a blank row is a dead end", () => {
    for (const n of NAV) {
      expect(n.label.trim().length).toBeGreaterThan(0);
      expect(typeof n.Icon).toBe("function");
    }
  });

  it("no two rows share a label", () => {
    expect(new Set(NAV.map((n) => n.label)).size).toBe(16);
  });
});

describe("groupFor is what navigate() uses", () => {
  it("answers for every NAV destination", () => {
    for (const n of NAV) expect(groupFor(n.view)).toBe(n.group);
  });

  it("answers null for the views that are not in the nav", () => {
    expect(groupFor("chat")).toBeNull();
    expect(groupFor("workspace")).toBeNull();
  });

  it("navigate() opens the group holding its target", () => {
    // Without this a cross-page pointer lands on a page whose nav row is
    // inside a shut group — invisible, and looking like a broken link.
    expect(APP).toContain("groupFor(");
  });
});

describe("ABSENCE — the rejected alternatives", () => {
  it("no second array names items per group", () => {
    // The failure this guards: GROUPS growing an `items:` field.
    const at = SRC.indexOf("export const GROUPS");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 400)).not.toContain("items:");
  });

  it("groups are independent, not an accordion", () => {
    // One-open-at-a-time would shut a group whenever a GoTo link opened
    // another — auto-collapse-on-navigation by another name.
    expect(APP).not.toContain("setOpenGroups(new Set([g]))");
  });

  it("no item was renamed and no third vocabulary was invented", () => {
    for (const label of ["Models", "Plugins", "Skills", "Prompts", "MCP", "Agents",
      "All Tools", "Permissions", "System prompt", "On your behalf", "Terminal",
      "Voice", "Keyboard shortcuts", "Stats", "Audit log", "Changelog"]) {
      expect(NAV.map((n) => n.label)).toContain(label);
    }
  });

  it("a group header is not a destination", () => {
    const at = SRC.indexOf("GROUPS.map(");
    expect(at).toBeGreaterThan(-1);
    const header = SRC.slice(at, at + 900);
    expect(header).toContain("onToggleGroup(");
    expect(header).not.toContain("onNavigate(");
  });
});

describe("collapsed by default, and the state persists", () => {
  it("the persisted key is a set, seeded empty — App owns it beside settingsOpen", () => {
    expect(APP).toContain('"hv:settings-groups"');
    expect(APP).toContain('localStorage.getItem("hv:settings-groups") ?? "[]"');
  });
});
