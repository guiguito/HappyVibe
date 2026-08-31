import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BANNER_TONE } from "../src/renderer/src/components/Banner";

/**
 * §20 round 17 — one Banner. The grammar was hand-rolled four times at two
 * different border opacities.
 *
 * Principle 10 is the boundary this component must NOT cross: persistent state
 * is a pill, transient guidance is a banner. The plan-mode pill stays a pill.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const rendered = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("one banner grammar (§20 round 17)", () => {
  it("the hand-rolled shape survives nowhere but Banner.tsx", () => {
    const hits = tsxFiles(R)
      .filter((f) => path.basename(f) !== "Banner.tsx")
      .filter((f) => /px-6 py-2\.5/.test(rendered(f)))
      .map((f) => path.basename(f));
    expect(hits).toEqual([]);
  });

  it("offers exactly the three tones the app's vocabulary allows", () => {
    // §20's tone vocabulary is five words and guidance never invents a sixth.
    // A banner uses three of them: danger, attention, info.
    expect(Object.keys(BANNER_TONE).sort()).toEqual(["attention", "danger", "info"]);
  });

  it("every tone is built from an existing semantic colour", () => {
    for (const [k, v] of Object.entries(BANNER_TONE)) {
      expect(v, k).toMatch(/\b(berry|honey|sky)\b/);
    }
  });

  it("danger is berry and nothing else is", () => {
    // berry = danger/destructive ONLY. A berry attention banner would teach the
    // wrong vocabulary.
    expect(BANNER_TONE.danger).toContain("berry");
    expect(BANNER_TONE.attention).not.toContain("berry");
    expect(BANNER_TONE.info).not.toContain("berry");
  });
});

describe("Principle 10 — the plan pill is not a banner", () => {
  it("nothing renders plan mode through Banner", () => {
    // The plan-mode banner→pill migration is what made Principle 10 a rule;
    // routing it back through here would relitigate a settled decision.
    for (const f of tsxFiles(R)) {
      const src = rendered(f);
      for (const m of src.matchAll(/<Banner[^>]*>[\s\S]{0,200}/g)) {
        expect(m[0], path.basename(f)).not.toMatch(/plan mode/i);
      }
    }
  });
});
