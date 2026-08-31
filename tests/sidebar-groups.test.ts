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
    expect(NAV).toHaveLength(17);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(17);
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
    // Short NOUNS, matching the `WORKSPACES` label's idiom directly above
    // them. Round 18's first cut used four different grammatical shapes and
    // read as arbitrary. "The record" trails because round 12's own rule puts
    // the pages you consult rather than change at the bottom.
    expect(GROUPS.map((g) => g.label)).toEqual([
      "Abilities",
      "Control",
      "App features",
      "The record",
    ]);
  });

  it("no header is a clause — they are all short noun phrases", () => {
    for (const g of GROUPS) {
      expect(g.label.split(" ").length, g.label).toBeLessThanOrEqual(2);
      expect(g.label, g.label).not.toMatch(/^(What|How|Set up|Where)\b/);
    }
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
      "models", "plugins", "skills", "promptTemplates", "mcp", "agents", "builtinTools",
      // Permissions leads its group ahead of All Tools: the more often
      // reached of the two, and the group's own thesis. System prompt closes
      // it — a standing instruction is a ground rule, though not a permission.
      "permissions", "tools", "sysprompt",
      // §19's page configures app behaviour (a per-task model/append/on-off
      // record), so it is an app feature, not a record of one.
      "terminal", "voice", "shortcuts", "onBehalf",
      "stats", "audit", "changelog",
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
    expect(new Set(NAV.map((n) => n.label)).size).toBe(17);
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
      "Built-in tools", "Permissions", "Agent tools", "System prompt", "AI autofill",
      "Terminal", "Voice", "Keyboard shortcuts", "Stats", "Audit log", "Changelog"]) {
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

describe("round 18 renames — the old names are gone everywhere", () => {
  const R = path.join(import.meta.dirname, "..", "src");
  const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

  it('no nav row still says "On your behalf"', () => {
    // It described the whole product rather than the page, and it was the one
    // label that was not a noun. Renamed under "App features", where its
    // siblings are Terminal / Voice / Keyboard shortcuts.
    expect(NAV.map((n) => n.label)).not.toContain("On your behalf");
    expect(NAV.map((n) => n.label)).toContain("AI autofill");
  });

  it("the page's own heading matches the nav row", () => {
    expect(read("renderer/src/components/OnBehalfView.tsx")).toContain(">AI autofill</h1>");
  });

  it("the Audit log's pointer to it is not left dangling", () => {
    // Round 17: every cross-page pointer is a link, and a pointer naming a
    // page that no longer has that name is worse than no pointer.
    const audit = read("renderer/src/components/AuditView.tsx");
    expect(audit).not.toContain("on your behalf");
  });

  it('"AI" is used ONCE, as an adjective on that one label', () => {
    // The app says "the agent" and "the model"; it had never said "AI". The
    // exception earns itself by separating GENERATED text from the
    // browser-autofill sense of remembered text — it is not a second name for
    // the agent. A second use would be the third vocabulary §29 forbids.
    expect(NAV.filter((n) => /\bAI\b/.test(n.label))).toHaveLength(1);
    expect(GROUPS.filter((g) => /\bAI\b/.test(g.label))).toHaveLength(0);
  });
});

describe("§13 round 18 — the two tool pages are two pages", () => {
  const R = path.join(import.meta.dirname, "..", "src", "renderer", "src", "components");
  const read = (f: string): string => fs.readFileSync(path.join(R, f), "utf8");

  it("the switches and the inventory are separate destinations", () => {
    // One page mixed global ON/OFF switches that unregister tools and respawn
    // live sessions with a read-only list you consult. Different jobs, and
    // "Everything the agent can call" described only the second.
    expect(NAV.find((n) => n.view === "builtinTools")?.group).toBe("abilities");
    expect(NAV.find((n) => n.view === "tools")?.group).toBe("rules");
  });

  it("the switches left the inventory page entirely", () => {
    const all = read("AllToolsView.tsx");
    expect(all).not.toContain("<BuiltinToolsBlock");
    expect(all).not.toContain("onPlanBuiltinChange");
    expect(read("BuiltinToolsView.tsx")).toContain("<BuiltinToolsBlock");
  });

  it('nothing still says "All Tools"', () => {
    // It claimed to be the complete catalogue while half of it lived elsewhere.
    expect(NAV.map((n) => n.label)).not.toContain("All Tools");
    expect(read("AllToolsView.tsx")).not.toContain(">All Tools<");
  });

  it("the switches page points at the inventory, and not the reverse", () => {
    // Round 17's rule is that a pointer IS a link, not that every page carries
    // one. The useful direction is switches → inventory: you turned something
    // off, now go see what the agent is left with. The reverse pointer was
    // written and cut — from a list of tools, "where are the switches" is not
    // a question a reader is asking, and a second pointer beside the
    // Permissions one is noise.
    expect(read("BuiltinToolsView.tsx")).toContain('<GoTo view="tools" />');
    expect(read("AllToolsView.tsx")).not.toContain('view="builtinTools"');
  });

  it("the inventory shows every tool — no preview cap", () => {
    // The page's one job is "everything the agent can call"; hiding all but
    // ten behind "Show all N tools" made that sentence false on arrival.
    const all = read("AllToolsView.tsx");
    expect(all).not.toContain("TOOLS_PREVIEW");
    expect(all).not.toContain("showAllTools");
    expect(all).not.toContain("Show all");
    expect(all).toContain("toolRows.map((t) => (");
  });

  it("they do not share an icon", () => {
    const a = NAV.find((n) => n.view === "tools")?.Icon;
    const b = NAV.find((n) => n.view === "builtinTools")?.Icon;
    expect(a).not.toBe(b);
  });
});
