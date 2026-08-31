import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_COPY } from "../src/renderer/src/components/EmptyState";

/**
 * §20 round 17 — one empty state, one visual tier, and the standing principle
 * that every empty state names the next step.
 *
 * The suite has no DOM, so the copy ships as an exported record and the
 * assertions are semantic (the TASK_COPY pattern from OnBehalfView).
 */

describe("EMPTY_COPY", () => {
  it("every headline states the fact in the locked shape", () => {
    // "Nothing in context yet" is the honest sentence for that surface, so the
    // shape is No|Nothing — the rule is about naming a next step, not about the
    // literal word "No".
    for (const [key, v] of Object.entries(EMPTY_COPY)) {
      expect(v.headline, key).toMatch(/^(No|Nothing) .*yet$/);
    }
  });

  it("every entry names a next step, as a sentence", () => {
    for (const [key, v] of Object.entries(EMPTY_COPY)) {
      expect(v.next.trim().length, key).toBeGreaterThan(10);
      expect(v.next, key).toMatch(/\.$/);
    }
  });

  it("covers the surfaces the audit found dead-ending", () => {
    const keys = Object.keys(EMPTY_COPY);
    for (const k of ["agents", "tools", "mcpServers", "context", "agentsMd", "rules"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("no dead copy", () => {
  it("every key has a call site in the renderer", () => {
    // Unreferenced copy is exactly the drift this component exists to end, so
    // an unused key is a failure rather than harmless.
    const R = path.resolve(__dirname, "../src/renderer/src");
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && e.name !== "EmptyState.tsx") {
          sources.push(fs.readFileSync(p, "utf8"));
        }
      }
    };
    walk(R);
    const all = sources.join("\n");
    const unused = Object.keys(EMPTY_COPY).filter((k) => !all.includes(`copy="${k}"`));
    expect(unused).toEqual([]);
  });
});

describe("one visual tier only", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/src/components/EmptyState.tsx"),
    "utf8",
  );

  it("is the dashed box the app already used", () => {
    expect(src).toContain("border-dashed");
  });

  it("ships no illustrated full-page tier beside it", () => {
    // A second tier is a second thing to keep consistent, and the illustrated
    // card the audit thought it was generalizing never existed.
    expect(src).not.toMatch(/size-(1[6-9]|2\d)/);
  });

  it("is not a floating surface", () => {
    // browserCoverage.ts gathers candidates by the literal class WORD, so an
    // in-flow element must carry neither.
    expect(src).not.toMatch(/className="[^"]*\b(absolute|fixed)\b/);
  });
});
