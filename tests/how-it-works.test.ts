import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HOWTO_COPY } from "../src/renderer/src/components/HowItWorks";

/**
 * §20 round 17 — the deleted Help page, dissolved in place.
 *
 * The load-bearing half of this file is the last block: Principle 11 says
 * guidance describing a gate is DERIVED from that gate, never re-typed beside
 * it. Finding 13 is what re-typing costs — the plan prompt told the model
 * "sub-agents are blocked" for months after §12's capability ceiling made it
 * false, and nothing failed.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const rendered = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("HOWTO_COPY", () => {
  it("has all six entries, each a real explanation", () => {
    const keys = ["planMode", "rules", "mcpBadge", "contextNumbers", "instructionFiles", "webTools"];
    expect(Object.keys(HOWTO_COPY).sort()).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(HOWTO_COPY)) {
      expect(v.title, k).toMatch(/^(How|What) /);
      expect(v.body.length, k).toBeGreaterThan(200);
    }
  });

  it("every entry has a call site", () => {
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && e.name !== "HowItWorks.tsx") sources.push(fs.readFileSync(p, "utf8"));
      }
    };
    walk(R);
    const all = sources.join("\n");
    expect(Object.keys(HOWTO_COPY).filter((k) => !all.includes(`copy="${k}"`))).toEqual([]);
  });

  it("plan mode names read-only, the plan file, and who can leave", () => {
    const b = HOWTO_COPY.planMode.body;
    expect(b).toMatch(/read-only/i);
    expect(b).toContain(".agents/plans/");
    expect(b).toMatch(/only you/i);
  });

  it("rules names the precedence and that silence never allows", () => {
    const b = HOWTO_COPY.rules.body;
    expect(b).toMatch(/deny beats ask/i);
    expect(b).toMatch(/ask beats allow/i);
    expect(b).toMatch(/asks you/i);
  });

  it("the MCP badge entry refuses to overclaim in BOTH directions", () => {
    const b = HOWTO_COPY.mcpBadge.body;
    expect(b).toMatch(/red badge does not/i);
    expect(b).toMatch(/green one is not proof/i);
  });

  it("the context entry keeps the honesty labels", () => {
    const b = HOWTO_COPY.contextNumbers.body;
    expect(b).toMatch(/measured/i);
    expect(b).toMatch(/estimated/i);
    expect(b).toContain("measuring…");
  });
});

describe("Principle 11 — the instruction-file order is DERIVED from Pi's loader", () => {
  const loader = fs.readFileSync(
    path.resolve(
      __dirname,
      "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js",
    ),
    "utf8",
  );

  it("names the candidates in the order Pi tries them", () => {
    // resource-loader.js: loadContextFileFromDir takes the FIRST match and
    // ignores the rest, which is why a CLAUDE.md beside an AGENTS.md is unread.
    const m = loader.match(/const candidates = \[([^\]]*)\]/);
    expect(m, "Pi's candidate list moved — re-derive the copy").not.toBeNull();
    const candidates = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(candidates[0]).toBe("AGENTS.override.md");
    expect(candidates).toContain("CLAUDE.md");
    const b = HOWTO_COPY.instructionFiles.body;
    for (const c of candidates) expect(b, `copy must name ${c}`).toContain(c);
  });

  it("says the closest file is read last, which is what the walk does", () => {
    // loadProjectContextFiles pushes the global file first, then UNSHIFTS each
    // ancestor while walking cwd upward — so the array ends outermost-first with
    // the project's own folder last.
    expect(loader).toContain("ancestorContextFiles.unshift(contextFile)");
    expect(loader).toContain("contextFiles.push(...ancestorContextFiles)");
    expect(HOWTO_COPY.instructionFiles.body).toMatch(/last/i);
  });

  it("says they are read once at session start", () => {
    expect(HOWTO_COPY.instructionFiles.body).toMatch(/restarted sessions|session starts/i);
  });
});

describe("Principle 11 — the plan-mode text is DERIVED from the plan gate", () => {
  const gate = fs.readFileSync(path.resolve(__dirname, "../pi-runtime/extensions/hv-plan.ts"), "utf8");

  it("does not claim sub-agents are blocked — the gate deliberately allows them", () => {
    // gatePlanCall returns { kind: "needs-boundary" } for `subagent`; it is
    // absent from BLOCKED_PLAN_TOOLS on purpose (§12's capability ceiling made
    // a read-only explorer the most useful thing a planning session can do).
    const blocked = gate.match(/BLOCKED_PLAN_TOOLS = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
    expect(blocked.length).toBeGreaterThan(10); // not vacuous
    expect(blocked).not.toContain("subagent");
    expect(HOWTO_COPY.planMode.body).not.toMatch(/sub-?agents? (are|is) blocked/i);
  });

  it("and the PROMPT the model reads does not claim it either (finding 13)", () => {
    const prompt = gate.slice(gate.indexOf("export function buildPlanPrompt"));
    expect(prompt.length).toBeGreaterThan(200); // not vacuous
    expect(prompt).not.toMatch(/sub-?agents? (are|is) blocked/i);
  });

  it("names what the gate actually blocks", () => {
    for (const t of ["edit", "write", "terminal_run"]) {
      expect(gate).toContain(`"${t}"`);
    }
  });
});

describe("the disclosures add no floating surface and no modal", () => {
  const src = rendered(path.join(R, "components/HowItWorks.tsx"));

  it("is a native details, with no disclosure state to manage", () => {
    expect(src).toContain("<details");
    expect(src).not.toContain("useState");
  });

  it("is never a dialog", () => {
    // §20 round 17: in place, inside the section it explains. Never a modal,
    // never a tour.
    expect(src).not.toMatch(/Dialog|hv-overlay|hv-dialog/);
    // Scoped to className: the word "fixed" legitimately appears in the prose
    // ("in a fixed order"), and browserCoverage.ts only ever reads class words.
    expect(src).not.toMatch(/className="[^"]*\b(absolute|fixed)\b/);
  });
});

// §32 — the copy has to carry the four things a user cannot discover by looking:
// where the fetching happens, that the grant is shared with the browser, that
// results are untrusted, and what the tools cannot do at all.
describe("HOWTO_COPY.webTools (§32)", () => {
  const b = HOWTO_COPY.webTools.body;

  it("says where pages are fetched, and who can see the URLs", () => {
    expect(b).toMatch(/not by your computer/i);
    expect(b).toMatch(/server HappyVibe operates/i);
    expect(b).toMatch(/your own service/i);
  });

  it("names the shared grant AND the narrower pane button, because they differ", () => {
    expect(b).toMatch(/same rules as the agent's browser/i);
    expect(b).toMatch(/Allow for this session/);
    // The asymmetry is deliberate (PRD §28 round 20) and is the one thing a
    // user could reasonably read as a bug, so the copy states it.
    expect(b).toMatch(/that one page's site for that browser pane only/i);
  });

  it("says results are untrusted, and what these tools cannot do", () => {
    expect(b).toMatch(/untrusted/i);
    expect(b).toMatch(/screenshots/i);
    expect(b).toMatch(/signed in/i);
    expect(b).toMatch(/recent results/i);
  });

  it("never names the backend — §32's vocabulary rule", () => {
    expect(b.toLowerCase()).not.toContain("firecrawl");
    expect(b.toLowerCase()).not.toContain("scrape");
    expect(b.toLowerCase()).not.toContain("crawl");
  });
});
