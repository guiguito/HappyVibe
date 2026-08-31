import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §20 round 17 — one page-header shape, said once.
 *
 * The renderer suite has no DOM, so a visual contract ships in two halves: the
 * PRESENCE half is a scan of the h1 classes every page must carry, and the
 * ABSENCE half (below) is a comment-stripping walk for words that must no
 * longer appear anywhere. An absence is exactly what a render test cannot fail
 * on — hence the scan.
 */

const COMPONENTS = path.resolve(__dirname, "../src/renderer/src/components");
const H1 = /<h1\s+className="([^"]*)"/g;
/** The one shape a page header may take. */
const STANDARD = ["font-black", "text-3xl", "tracking-tight"];

/**
 * Every *View.tsx that renders a page-level h1. ChatView is exempt: its h1 is
 * the welcome greeting on the empty-state screen ("Pick a project, make a
 * vibe."), which is a hero line rather than a page header.
 */
function viewFiles(): string[] {
  return fs
    .readdirSync(COMPONENTS)
    .filter((f) => f.endsWith("View.tsx") && f !== "ChatView.tsx")
    .map((f) => path.join(COMPONENTS, f));
}

describe("page headers are one shape (§20 round 17)", () => {
  it("every page h1 carries the standard classes", () => {
    const bad: string[] = [];
    for (const file of viewFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(H1)) {
        const words = m[1].split(/\s+/);
        if (!STANDARD.every((c) => words.includes(c))) {
          bad.push(`${path.basename(file)}: ${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan actually inspected the pages", () => {
    // Guards against passing vacuously if the glob ever stops matching.
    const withH1 = viewFiles().filter((f) => /<h1/.test(fs.readFileSync(f, "utf8")));
    expect(withH1.length).toBeGreaterThan(10);
  });
});

describe("the deleted Help affordance is promised nowhere (§22 round 17)", () => {
  it("no source or doc claims the onboarding overlay is re-openable", () => {
    // §7 round 8 deleted the Help entry and named the consequence: the welcome
    // overlay shows once with NO re-open path. Three comments and one
    // validation note said otherwise for a month.
    //
    // Scope is the places that ASSERT behaviour — code, and the validation
    // record that describes what the code does. docs/prd.md and the plans
    // quote the stale phrase deliberately, to record the decision to kill it.
    const roots = ["../src", "../docs/validation"].map((r) => path.resolve(__dirname, r));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx|md)$/.test(e.name) &&
          // Whitespace-collapsed: JSX and prose both wrap, and a two-word
          // phrase that breaks across a line slides past a raw substring scan.
          // That exact hole hid "(the gear in\n the sidebar)" from
          // tests/go-to.test.ts until someone opened the app.
          fs.readFileSync(p, "utf8").replace(/\s+/g, " ").includes("Help affordance")
        ) {
          hits.push(path.relative(path.resolve(__dirname, ".."), p));
        }
      }
    };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});
