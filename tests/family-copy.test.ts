import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAMILY_COPY, FAMILY_SWITCHES, KIT_FAMILIES, weightLabel } from "../src/renderer/src/toolSwitches";
import { IMAGES_ROW_COPY } from "../src/renderer/src/imagePrompt";
import { TOOL_WEIGHTS } from "../src/main/toolWeights.generated";

// Same helpers as tests/onboarding.test.ts — copied, because importing a test file re-runs its suites.
const flat = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "").replace(/\s+/g, " ");
const has = (src: string, needle: string): boolean => src.includes(needle);
const B = flat(fs.readFileSync(path.resolve(__dirname, "../src/renderer/src/components/BuiltinToolsBlock.tsx"), "utf8"));

describe("one record, two surfaces (PRD §13, Decision 2026-10-09)", () => {
  it("every Built-in tools row reads its sentence from FAMILY_COPY rather than retyping it", () => {
    for (const k of ["plan", "askUser", "terminal", "browser", "web", "memory", "schedules", "document", "workflows", "intent", "core"] as const) {
      expect(has(B, `FAMILY_COPY.${k}.what`), `${k} reads the record`).toBe(true);
      expect(has(B, FAMILY_COPY[k].what), `${k} retyped in the row`).toBe(false);
    }
    // The family switch rows and the Images row read it one hop away.
    for (const k of ["mcp", "subagents", "skills"] as const) {
      expect(FAMILY_SWITCHES[k].on, k).toBe(FAMILY_COPY[k].what);
      expect(FAMILY_SWITCHES[k].label, k).toBe(FAMILY_COPY[k].label);
    }
    expect(IMAGES_ROW_COPY.on.startsWith(FAMILY_COPY.images.what)).toBe(true);
  });

  it("the kit's order is the page's row order", () => {
    const rowOf: Record<string, string> = { plan: "<PlanModeRow", askUser: "<AskUserRow", terminal: "<TerminalRow", browser: "<BrowserRow", web: "<WebRow", memory: "<MemoryRow", schedules: "<SchedulesRow", document: "<DocumentsRow", images: "<ImagesRow", subagents: 'family="subagents"', workflows: "<WorkflowsRow", skills: 'family="skills"' };
    const at = KIT_FAMILIES.map((k) => B.indexOf(rowOf[k]));
    expect(at.every((i) => i >= 0), "every row found").toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("no row types a token figure any more", () => {
    expect(has(B, "about 5.5k"), "Workflows' typed figure").toBe(false);
    expect(/\b\d+(\.\d)?k tokens\b/.test(B), "any typed k-tokens").toBe(false);
  });

  it("'the heaviest tool the agent carries' is still true", () => {
    const f = TOOL_WEIGHTS.families as Record<string, number>;
    expect(Math.max(...Object.values(f))).toBe(f.workflows);
  });

  it("formats with the app's own formatter", () => {
    expect(weightLabel(1130)).toBe("~1.1k tokens");
    expect(weightLabel(365)).toBe("~365 tokens");
  });
});
