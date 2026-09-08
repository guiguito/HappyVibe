import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GROUPS, NAV, PINNED, groupFor } from "../src/renderer/src/components/Sidebar";

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
  it("all 17 destinations survive, each in exactly one group", () => {
    expect(NAV).toHaveLength(18);
    expect(new Set(NAV.map((n) => n.view)).size).toBe(18);
    for (const n of NAV) {
      if (n.group === null) continue; // pinned above the groups
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
    for (const n of NAV) {
      if (n.group === null) continue;
      if (runs.at(-1) !== n.group) runs.push(n.group);
    }
    expect(runs.length).toBe(new Set(runs).size);
  });

  it("round 12's frequency order survives within each group", () => {
    expect(NAV.map((n) => n.view)).toEqual([
      // §33 round 22: Memory is second, on Built-in tools' own argument — on by default and
      // free to reach. It cannot go lower without splitting the Plugins → Skills · Prompts ·
      // MCP run that the classifier-derived test below requires to stay contiguous.
      "models", "builtinTools", "memory", "plugins", "skills", "promptTemplates", "mcp", "agents",
      // Permissions leads its group ahead of All Tools: the more often
      // reached of the two, and the group's own thesis. System prompt closes
      // it — a standing instruction is a ground rule, though not a permission.
      "sysprompt", "permissions", "tools",
      // §19's page configures app behaviour (a per-task model/append/on-off
      // record), so it is an app feature, not a record of one.
      "terminal", "voice", "onBehalf", "shortcuts",
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
    expect(new Set(NAV.map((n) => n.label)).size).toBe(18);
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
    // §7 round 23 moved the STORE, not the shape: per-window chrome left
    // localStorage (shared by every renderer of one origin) for the window's
    // own record. Still a JSON array under the same key, still seeded empty.
    expect(APP).toContain('"hv:settings-groups"');
    expect(APP).toContain('uiGet("hv:settings-groups") ?? "[]"');
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
    // Both tool pages live in the same group: adjacent is where a reader
    // hunting for "tools" looks, and every switch on the first is on by
    // default, so every visit to it is a restriction.
    // It stays in Abilities: "you only ever go there to switch something OFF"
    // is equally true of Skills, Prompts, Agents and Plugins — every page in
    // that group is a list of capabilities with an on/off, which the IPC
    // surface confirms (skills-set-enabled, prompt-templates-set-enabled,
    // set-agent-enabled, plugins-enable-installed).
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

describe("no label means two different things", () => {
  const B = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "BuiltinToolsBlock.tsx"),
    "utf8",
  );

  it("the agent's terminal row does not collide with the Terminal page", () => {
    // The nav has a `Terminal` page — the USER's shell and its settings. This
    // row is the AGENT's three terminal tools. Same word, two meanings.
    expect(NAV.map((n) => n.label)).toContain("Terminal");
    expect(B).toContain('title="Agent terminal — 3 tools"');
    expect(B).not.toContain('title="Terminal — 3 tools"');
  });

  it("the browser row says whose browser it is too", () => {
    expect(B).toContain("Agent browser — 10 tools");
  });
});

describe("Models is pinned above the groups", () => {
  it("it is the only ungrouped row, and it leads", () => {
    // Round 12 already called it first-among-equals. It is also the one member
    // of Abilities that is not one: the others are capabilities you switch on
    // and off, this is WHO the agent talks to — and the app refuses to spawn
    // without it (§16 finding 7).
    expect(PINNED.map((n) => n.view)).toEqual(["models"]);
    expect(NAV[0]?.view).toBe("models");
  });

  it("a pinned row needs no group opened to be reachable", () => {
    // navigate() reveals the group holding its target; for a pinned row there
    // is none, and there must not be — it is always on screen.
    expect(groupFor("models")).toBeNull();
  });

  it("every other destination still lives in a group", () => {
    expect(NAV.filter((n) => n.group === null)).toHaveLength(1);
  });
});

describe("the two record icons are not the same drawing", () => {
  const SB = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
    "utf8",
  );
  const body = (fn: string): string => {
    const at = SB.indexOf(`function ${fn}()`);
    return SB.slice(at, SB.indexOf("</svg>", at));
  };

  it("Audit log is a checklist and Changelog is a timeline", () => {
    // Both used to be a document-with-lines; at 16px they read as one glyph
    // repeated, and the old comment claimed they were distinct.
    expect(body("AuditIcon")).toContain("M3 6.5l1.6 1.6");   // ticks
    expect(body("ChangelogIcon")).toContain("<circle");       // nodes on a spine
    expect(body("AuditIcon")).not.toContain("<circle");
  });

  it("neither is still the old page-with-a-turned-corner", () => {
    expect(body("ChangelogIcon")).not.toContain("M14 2v6h6");
    expect(body("AuditIcon")).not.toContain("a1 1 0 0 1 1-1h9l4 4");
  });
});

describe("no two rows draw the same glyph", () => {
  const SB = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
    "utf8",
  );
  /** The shape data an icon component renders, normalised. */
  const drawing = (fn: string): string => {
    const at = SB.indexOf(`function ${fn}()`);
    if (at < 0) throw new Error(`no icon component ${fn}`);
    const svg = SB.slice(at, SB.indexOf("</svg>", at));
    return (svg.match(/(?:d|cx|cy|r|x|y|width|height)="[^"]*"/g) ?? []).join("|");
  };

  it("every NAV row has a distinct drawing, not merely a distinct function", () => {
    // `PromptTemplatesIcon` and `TerminalIcon` were byte-identical: two
    // different components, one picture. Comparing function identity would
    // have passed, which is why this compares the shapes.
    const names = (SB.match(/Icon: (\w+)/g) ?? []).map((m) => m.replace("Icon: ", ""));
    const seen = new Map<string, string>();
    for (const n of new Set(names)) {
      const d = drawing(n);
      const clash = seen.get(d);
      expect(clash, `${n} draws the same picture as ${clash}`).toBeUndefined();
      seen.set(d, n);
    }
  });
});

describe("section icons are distinct too", () => {
  const SEC = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Section.tsx"),
    "utf8",
  );

  it("no two SECTION_ICONS entries draw the same picture", () => {
    const block = SEC.slice(SEC.indexOf("SECTION_ICONS"), SEC.indexOf("\n};", SEC.indexOf("SECTION_ICONS")));
    const entries = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(5);
    const seen = new Map<string, string>();
    for (const name of entries) {
      const at = block.indexOf(`${name}:`);
      const next = entries
        .map((e) => block.indexOf(`\n  ${e}:`))
        .filter((i) => i > at)
        .sort((a, b) => a - b)[0] ?? block.length;
      const shapes = (block.slice(at, next).match(/d="[^"]*"/g) ?? []).join("|");
      if (!shapes) continue;
      const clash = seen.get(shapes);
      expect(clash, `section icon "${name}" draws the same picture as "${clash}"`).toBeUndefined();
      seen.set(shapes, name);
    }
  });

  it("Providers and Default model do not share a glyph on the Models page", () => {
    // They both used `models` — one page, two sections, one picture.
    const MV = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "ModelsView.tsx"),
      "utf8",
    );
    expect(MV).toContain('icon="providers" title="Providers"');
    expect(SEC).toContain("providers: (");
  });
});

describe("Plugins is followed by exactly what a plugin contains", () => {
  it("the three rows under Plugins are DERIVED from ACCEPTED_COMPONENTS", async () => {
    // Round 12: "Plugins leads, it is the source the three below it get their
    // contents from." That is literal — a plugin may contain commands, MCP
    // servers and skills, and nothing else. Asserted against the classifier
    // rather than re-typed here, so widening what a plugin may hold fails
    // this test instead of silently orphaning the sentence (Principle 11).
    const { ACCEPTED_COMPONENTS } = await import("../src/main/plugins/classify");
    const COMPONENT_VIEW: Record<string, string> = {
      commands: "promptTemplates",
      mcpServers: "mcp",
      skills: "skills",
    };
    const views = NAV.map((n) => n.view);
    const after = views.slice(views.indexOf("plugins") + 1, views.indexOf("plugins") + 1 + ACCEPTED_COMPONENTS.length);
    expect(new Set(after)).toEqual(new Set(ACCEPTED_COMPONENTS.map((c) => COMPONENT_VIEW[c])));
    // Every accepted component must have a nav row, or the mapping above rots.
    for (const c of ACCEPTED_COMPONENTS) expect(COMPONENT_VIEW[c], c).toBeDefined();
  });
});

describe("Abilities reads have → get → got → author", () => {
  it("Built-in tools leads: it is the only member that costs nothing to use", () => {
    // Everything else in the group needs work first — install a plugin,
    // approve a skill, add a server, author an agent or a prompt. These are on
    // by default, and they are the product's own differentiators, so the page
    // earns its place on DISCOVERY rather than on round 12's edit-frequency
    // rule (which would put it last, since it is rarely changed).
    const inGroup = NAV.filter((n) => n.group === "abilities").map((n) => n.view);
    expect(inGroup[0]).toBe("builtinTools");
  });

  it("lifting it did not break the Plugins → its-three-components run", () => {
    const views = NAV.map((n) => n.view);
    expect(views.slice(views.indexOf("plugins") + 1, views.indexOf("plugins") + 4))
      .toEqual(["skills", "promptTemplates", "mcp"]);
  });
});

describe("the PRD's own listing matches the shipped nav", () => {
  /**
   * This paragraph drifted twice while round 18 was being written — the
   * membership and the order were both re-typed by hand and both went stale
   * within the hour. CLAUDE.md records the same failure elsewhere ("the count
   * in this file has drifted twice; the grep has not"), so the listing is
   * pinned rather than trusted.
   */
  it("§16 round 18 names the same groups, members and order as NAV", () => {
    const prd = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "prd.md"), "utf8");
    for (const g of GROUPS) {
      const m = prd.match(new RegExp(`\\*\\*${g.label}\\*\\* \\(([^)]*)\\)`));
      expect(m, `docs/prd.md does not list the "${g.label}" group`).toBeTruthy();
      const listed = m![1].split("·").map((x) => x.replace(/[*`]/g, "").trim());
      const actual = NAV.filter((n) => n.group === g.id).map((n) => n.label);
      expect(listed, `"${g.label}" in docs/prd.md`).toEqual(actual);
    }
  });

  it("§16 round 18 records that Models is pinned", () => {
    const prd = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "prd.md"), "utf8");
    for (const p of PINNED) {
      expect(prd).toContain(`**${p.label}**, pinned above every group`);
    }
  });
});

describe("the session list is ordered by LAST USED, and the workspace on screen is marked", () => {
  const SIDEBAR = fs.readFileSync(path.join(import.meta.dirname, "..", "src/renderer/src/components/Sidebar.tsx"), "utf8");
  const APP = fs.readFileSync(path.join(import.meta.dirname, "..", "src/renderer/src/App.tsx"), "utf8");
  const IPC = fs.readFileSync(path.join(import.meta.dirname, "..", "src/main/ipc.ts"), "utf8");

  it("the sort goes through the shared comparator, not an inline updatedAt compare", () => {
    // The absence matters more than the presence: reverting the sort would
    // leave every other assertion here passing.
    expect(SIDEBAR).toContain("bySidebarOrder(live)");
    expect(SIDEBAR).not.toContain("b.updatedAt.localeCompare(a.updatedAt)");
  });

  it("waking pins alongside running, and crashed does not", () => {
    // Pinning only "running" would make a session you just clicked drop to its
    // old slot and jump back a second later, which is the jitter to avoid.
    // And it is `statuses` (the process) rather than `busy` (the turn) on
    // purpose — pinning the turn would reshuffle the list at every boundary.
    const i = SIDEBAR.indexOf("const live = new Set(");
    expect(i).toBeGreaterThan(-1);
    const block = SIDEBAR.slice(i, i + 300);
    expect(block).toContain('st === "running" || st === "waking"');
    expect(block).not.toContain("crashed");
  });

  /**
   * The trap this whole feature dies to, and no pure test can see it: App
   * hydrates the chats already on screen at boot. Bumping there would re-stamp
   * the restored layout at every launch and flatten the ordering — so the bump
   * belongs to the GESTURE, never to the load.
   */
  it("only a real open touches — never the boot hydration path", () => {
    expect(APP.match(/touchSession/g)?.length).toBe(2);
    const h = APP.indexOf("const hydrateSessionInner");
    expect(h).toBeGreaterThan(-1);
    expect(APP.slice(h, h + 2500)).not.toContain("touchSession");
    // and main's open handler stays a pure read
    const o = IPC.indexOf('"hv:open-session"');
    expect(IPC.slice(o, o + 1200)).not.toContain("touch(");
  });

  it("prompting counts as use", () => {
    const i = IPC.indexOf("activity.prompted(sessionId);");
    expect(IPC.slice(i, i + 300)).toContain("index.touch(sessionId)");
  });

  it("a failed window lookup is SURFACED, never swallowed", () => {
    // It removes UI when it fails: an empty list means the tab menu offers only
    // "Move to new window", with no hint that moving to an open window exists.
    // A stale main process (the handler lives in main, so ⌘R does not reload
    // it) looked exactly like the feature being broken.
    expect(APP).toContain("window.hv.listWindows().then(setAllWindows).catch(surface)");
  });

  it("the sidebar is told which workspace is on screen, in BOTH modes", () => {
    expect(SIDEBAR).toContain("activeWs: string | null;");
    expect(APP).toMatch(/<Sidebar[\s\S]{0,120}activeWs=\{wsId\}/);
    // the collapsed rail's tile className is no longer a constant
    expect(SIDEBAR).toMatch(/ws === activeWs \? "border-honey shadow-sticker" : "border-line hover:border-honey"/);
    // and the expanded header marks it too
    expect(SIDEBAR).toMatch(/ws === activeWs \? "rounded bg-honey-soft px-0\.5" : ""/);
    expect((SIDEBAR.match(/aria-current=\{ws === activeWs/g) ?? []).length).toBe(2);
  });

  it("the centre area does NOT name the workspace — one workspace, one identity", () => {
    // Reverses commit 6a11517: the right rail said it, which read as clutter in
    // a place that should be quiet. The left panel owns this now.
    const RAIL = fs.readFileSync(path.join(import.meta.dirname, "..", "src/renderer/src/components/RightRail.tsx"), "utf8");
    expect(RAIL).not.toContain("workspace: string | null;");
    expect(RAIL).not.toContain("workspaceEmoji");
    // Scoped to the RightRail call — AgentsMdPanel has its own legitimate
    // `workspace={wsId}`, and a bare string match would forbid that too.
    const r = APP.indexOf("<RightRail");
    expect(r).toBeGreaterThan(-1);
    expect(APP.slice(r, r + 400)).not.toContain("workspace=");
  });
});
