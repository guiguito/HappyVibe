import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §29 worktrees — the sidebar NAVIGATES, the Changes panel ACTS.
 *
 * The sidebar has had no hover control that *acts* since round 11 took the `×`
 * out, and §29's altitude rule keeps git words below the human verbs. So the
 * absence asserted here is the design: a worktree row offers a chevron, a click
 * and a `+`, and every git verb lives one surface over.
 *
 * Source scans because the renderer suite has no DOM (vitest.config includes
 * `tests/**\/*.test.ts` only) — and because an ABSENCE is exactly what a render
 * test does not fail on.
 */
const read = (p: string): string => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const sidebar = read("src/renderer/src/components/Sidebar.tsx");
const panel = read("src/renderer/src/components/ChangesPanel.tsx");
/** Comments explain the rules; only the code may satisfy them. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the sidebar shows worktrees and never acts on them", () => {
  it("draws the heading only when the project has some", () => {
    expect(code(sidebar)).toMatch(/worktrees\??[.!]?\[ws\]/);
    expect(code(sidebar)).toMatch(/\?\.length \?\? 0\) > 0/);
  });

  it("carries the explanation through the copy record, so the no-dead-copy test applies", () => {
    expect(sidebar).toContain('copy="worktrees"');
  });

  it("has no git verb anywhere in it", () => {
    expect(code(sidebar)).not.toMatch(/Merge into/);
    expect(code(sidebar)).not.toMatch(/Remove worktree/);
    expect(code(sidebar)).not.toMatch(/New worktree/);
  });

  it("a prunable row offers Clean up instead of becoming the active root", () => {
    const c = code(sidebar);
    expect(c).toMatch(/w\.prunable[\s\S]{0,40}onCleanUp\?\.\(ws\)/);
    expect(c).toMatch(/onActivateRoot\?\.\(w\.path\)/);
    // …and it gets no New-session button: there is no folder to start one in.
    expect(c).toMatch(/!w\.prunable[\s\S]{0,200}onNewSession\(w\.path\)/);
  });

  it("a detached worktree names its head rather than rendering a blank branch", () => {
    expect(code(sidebar)).toMatch(/detached/);
  });
});

describe("the Changes panel names the project a worktree belongs to", () => {
  it("renders the parent's name from main's own answer", () => {
    expect(code(panel)).toMatch(/worktreeOf/);
    expect(panel).toMatch(/worktree of/);
  });
});
