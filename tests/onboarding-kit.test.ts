import { describe, expect, it } from "vitest";
import {
  basicsPatch, basicsTotal, DEFAULT_SWITCHES, fullTotal, KIT_SERVICES, kitPreset, kitShape, kitTiles, kitTotal,
  ONBOARDING_COPY, setFamily, smallModelLine, tooSmall, tooSmallLine, type KitDraft, type KitItems,
} from "../src/renderer/src/onboarding";
import { KIT_FAMILIES } from "../src/renderer/src/toolSwitches";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import { DEFAULT_GIT_RULES } from "../src/main/gitRules";
import { PLUGIN_CATALOG } from "../src/main/plugins/catalog.generated";
import { MCP_CATALOG } from "../src/main/mcpCatalog";

const W = {
  pi: "x", compactionReserve: 16384, total: 10_000,
  families: { plan: 600, askUser: 365, terminal: 555, browser: 1130, web: 960, document: 200, memory: 985, schedules: 1300, images: 300, subagents: 2700, workflows: 5543, skills: 900, intent: 400, mcp: 0 },
  core: { read: 170, bash: 135, edit: 295, write: 105, grep: 260, find: 150, ls: 115 },
  tools: {},
} as const;
const items: KitItems = {
  skills: [{ id: "/s/a", name: "a", tokens: 100 }, { id: "/s/b", name: "b", tokens: 50 }],
  agents: [{ id: "x", name: "x", tokens: 40 }],
  prompts: [{ id: "/p/t", name: "t", tokens: 0 }],
  imagesAvailable: false,
  core: ["read", "bash", "edit", "write", "grep", "find", "ls"],
};
const full = (): KitDraft => ({ switches: { ...DEFAULT_SWITCHES, coreOff: [] }, skillsOff: [], agentsOff: [], promptsOff: [] });

describe("kitPreset — the quarter (checked against Pi's reserve, docs/validation/kit1.md)", () => {
  it("opens on basics when the full kit takes more than a quarter of the window", () => {
    expect(kitPreset(4096, 10_000)).toBe("basics");
    expect(kitPreset(32_768, 10_000)).toBe("basics");
    expect(kitPreset(131_072, 10_000)).toBe("full");
  });
  it("an unknown window counts as large — never basics on a guess", () => {
    expect(kitPreset(null, 10_000)).toBe("full");
    expect(kitPreset(0, 10_000)).toBe("full");
  });
});

describe("tooSmall — at or under Pi's compaction reserve", () => {
  it("is derived from the reserve, not typed", () => {
    expect(tooSmall(4096, 16384)).toBe(true);
    expect(tooSmall(16384, 16384)).toBe(true);
    expect(tooSmall(16385, 16384)).toBe(false);
    expect(tooSmall(null, 16384)).toBe(false);
  });
  it("never claims more than the whole window", () => {
    expect(tooSmallLine(2500, 4096)).toContain("about 61% of it");
    expect(tooSmallLine(3000, 2048)).not.toMatch(/\d{3}%/);
    expect(tooSmallLine(3000, 2048)).toContain("don't fit");
  });
  it("the small-model line carries both computed numbers", () => {
    expect(smallModelLine(4096, 9_800)).toBe("Your model reads 4,096 tokens at a time and the full kit takes about 9.8k, so you're starting with just the basics.");
  });
});

describe("kitTotal", () => {
  it("the default draft is the measured total", () => {
    expect(kitTotal(full(), items, W)).toBe(10_000);
    expect(fullTotal(false, W)).toBe(10_000);
    expect(fullTotal(true, W)).toBe(10_300);
  });
  it("unticking a family or an item subtracts exactly its weight", () => {
    expect(kitTotal(setFamily(full(), "browser", false), items, W)).toBe(10_000 - 1130);
    expect(kitTotal({ ...full(), skillsOff: ["/s/a"] }, items, W)).toBe(10_000 - 100);
    expect(kitTotal({ ...full(), promptsOff: ["/p/t"] }, items, W)).toBe(10_000);
  });
  it("a family off does not subtract its items a second time", () => {
    const d = { ...setFamily(full(), "skills", false), skillsOff: ["/s/a"] };
    expect(kitTotal(d, items, W)).toBe(10_000 - 900);
    const a = { ...setFamily(full(), "subagents", false), agentsOff: ["x"] };
    expect(kitTotal(a, items, W)).toBe(10_000 - 2700);
  });
  it("Workflows only counts while Sub-agents is on", () => {
    const on = setFamily(full(), "workflows", true);
    expect(kitTotal(on, items, W)).toBe(10_000 + 5543);
    expect(kitTotal(setFamily(on, "subagents", false), items, W)).toBe(10_000 - 2700);
  });
  it("Images only counts with an OpenRouter credential", () => {
    expect(kitTotal(full(), { ...items, imagesAvailable: true }, W)).toBe(10_300);
  });
  it("the Windows shell is the same weight as bash", () => {
    expect(kitTotal({ ...full(), switches: { ...full().switches, coreOff: ["powershell"] } }, { ...items, core: ["read", "powershell"] }, W)).toBe(10_000 - 135);
    expect(kitTotal({ ...full(), switches: { ...full().switches, coreOff: ["bash", "powershell"] } }, items, W)).toBe(10_000 - 135);
  });
  it("basics keeps the core tools and every prompt", () => {
    const sum = Object.values(W.families).reduce((a, b) => a + b, 0) - W.families.workflows - W.families.images - W.families.intent - W.families.mcp;
    expect(basicsTotal(items, W)).toBe(10_000 - sum);
  });
});

describe("setFamily keeps Plan's dependency", () => {
  it("Ask user can't go off while Plan is on, and Plan back on forces it on", () => {
    expect(setFamily(full(), "askUser", false).switches.askUser).toBe(true);
    const noPlan = setFamily(setFamily(full(), "plan", false), "askUser", false);
    expect(noPlan.switches.askUser).toBe(false);
    expect(setFamily(noPlan, "plan", true).switches.askUser).toBe(true);
  });
});

describe("basics and shape", () => {
  it("basics switches every kit family off and nothing else", () => {
    expect(Object.keys(basicsPatch()).sort()).toEqual([...KIT_FAMILIES].sort());
    expect(Object.values(basicsPatch()).every((v) => v === false)).toBe(true);
    expect("mcp" in basicsPatch() || "intent" in basicsPatch() || "coreOff" in basicsPatch()).toBe(false);
  });
  it("names what was chosen, for §39", () => {
    expect(kitShape(full())).toBe("full");
    expect(kitShape({ ...full(), switches: { ...full().switches, ...basicsPatch() } })).toBe("basics");
    expect(kitShape(setFamily(full(), "web", false))).toBe("custom");
    expect(kitShape({ ...full(), promptsOff: ["/p/t"] })).toBe("custom");
  });
});

describe("kitTiles", () => {
  it("only switches the app already has: no family tick on Core tools or Prompts, no MCP, no intent", () => {
    const t = kitTiles(false);
    expect(t.find((x) => x.key === "core")).toMatchObject({ familyTick: false, items: "core" });
    expect(t.find((x) => x.key === "prompts")).toMatchObject({ familyTick: false, items: "prompts" });
    expect(t.map((x) => x.key)).not.toContain("mcp");
    expect(t.map((x) => x.key)).not.toContain("intent");
    expect(t.map((x) => x.key)).not.toContain("images");
    expect(kitTiles(true).map((x) => x.key)).toContain("images");
    expect(t.find((x) => x.key === "workflows")?.nestedUnder).toBe("subagents");
  });
  it("follows Built-in tools' order, then Core tools, then Prompts", () => {
    expect(kitTiles(true).map((x) => x.key)).toEqual([...KIT_FAMILIES, "core", "prompts"]);
  });
});

describe("copy derived from the gate", () => {
  it("the consent line holds: changing files and running commands are never safe-allowed, and no seed rule allows", () => {
    for (const t of ["write", "edit", "bash", "powershell", "terminal_run"]) expect(SAFE_TOOLS.has(t), t).toBe(false);
    expect(DEFAULT_GIT_RULES.some((r) => r.action === "allow")).toBe(false);
    expect(ONBOARDING_COPY.kitConsent).toBe("Anything that changes your files or runs a command asks you first.");
  });
  it("every service the footer and the notice name is in both catalogs", () => {
    for (const s of KIT_SERVICES) {
      expect(ONBOARDING_COPY.kitFooter.includes(s) && ONBOARDING_COPY.noticeExtend.includes(s), s).toBe(true);
      expect(PLUGIN_CATALOG.some((p) => p.name === s.toLowerCase()), `${s} plugin`).toBe(true);
      expect(MCP_CATALOG.some((m) => m.name === s), `${s} MCP`).toBe(true);
    }
  });
  it("the handover no longer promises a timer", () => {
    expect("doneBody" in ONBOARDING_COPY).toBe(false);
  });
});
