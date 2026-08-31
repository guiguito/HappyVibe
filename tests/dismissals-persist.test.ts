import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §20 round 17, Principle 5 (never nag) — a dismissal that dies with the page
 * is not a dismissal.
 *
 * Both of these were plain in-memory state and re-nagged after every ⌘R. There
 * is no DOM here, so the contract is pinned as a source scan: the state must be
 * SEEDED from storage, and the dismiss handler must WRITE to it. Either half
 * alone leaves the bug.
 */

const R = path.resolve(__dirname, "../src/renderer/src/components");
const rendered = (f: string): string =>
  fs.readFileSync(path.join(R, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the red-zone banner remembers being dismissed", () => {
  const src = rendered("ChatView.tsx");

  it("seeds its state from storage rather than an empty Set", () => {
    expect(src).toContain("REDZONE_KEY");
    const decl = src.slice(src.indexOf("const [suggestDismissed"), src.indexOf("const [suggestDismissed") + 400);
    expect(decl).toContain("localStorage");
  });

  it("writes the dismissal when the banner is dismissed", () => {
    expect(src).toMatch(/localStorage\.setItem\(`\$\{REDZONE_KEY\}/);
  });

  it("is scoped per SESSION, not per app", () => {
    // A different session hitting the red zone is a warning the user has not
    // seen; a global flag would swallow it.
    expect(src).toMatch(/REDZONE_KEY\}\$\{sessionId\}/);
  });
});

describe("the plan card remembers being dismissed", () => {
  const src = rendered("PlanCard.tsx");

  it("seeds its state from storage rather than false", () => {
    const decl = src.slice(src.indexOf("const [dismissed"), src.indexOf("const [dismissed") + 300);
    expect(decl).toContain("localStorage.getItem");
    expect(decl).not.toMatch(/useState\(false\)/);
  });

  it("writes the dismissal, scoped per PLAN", () => {
    // Dismissing one plan's action row must not hide every future plan's.
    expect(src).toMatch(/localStorage\.setItem\(`\$\{PLAN_DISMISS_KEY\}\$\{card\.path\}/);
  });
});

describe("the keys follow the app's storage convention", () => {
  it("both are hv:-prefixed, like every other renderer preference", () => {
    for (const [f, k] of [["ChatView.tsx", "REDZONE_KEY"], ["PlanCard.tsx", "PLAN_DISMISS_KEY"]] as const) {
      const m = rendered(f).match(new RegExp(`const ${k} = "([^"]+)"`));
      expect(m, `${k} missing`).not.toBeNull();
      expect(m![1]).toMatch(/^hv:/);
    }
  });
});
