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

describe("New worktree… lives in the branch menu", () => {
  const c = code(panel);
  it("is offered on a project and absent inside a worktree", () => {
    expect(c).toMatch(/payload\?\.worktreeOf === null &&/);
    expect(c).toMatch(/New worktree…/);
  });

  it("is disabled with the REASON rather than hidden, and never `disabled`", () => {
    // round 14's lesson: a `disabled` control receives no pointer events, so its
    // title never appears — and the reason is the entire point.
    expect(c).toMatch(/aria-disabled=\{!payload\.worktreeAdd\.ok\}/);
    expect(c).toMatch(/payload\.worktreeAdd\.reason/);
    expect(c).not.toMatch(/[^-]\bdisabled=\{!payload\.worktreeAdd\.ok\}/);
  });

  it("previews the folder from the SHARED slug, never its own copy", () => {
    expect(c).toMatch(/worktreeSlug\(branch \|\| "…"\)/);
    expect(panel).toContain('from "../../../main/worktreeSlug"');
  });

  it("sends a branch name and nothing else — the folder is main's decision", () => {
    expect(c).toMatch(/window\.hv\.worktreeAdd\(workspace, branch\)/);
  });
});

describe("ChangesPanel calls no hook after its early returns", () => {
  /**
   * The Rules of Hooks, enforced here because this repo cannot run a linter:
   * typescript-eslint refuses TS 7 outright (CLAUDE.md), so `react-hooks` is
   * unavailable. This caught a real one — §29's `newWorktreeRef` was declared
   * beside the function that uses it, which is below this component's four
   * early returns. It typechecks, the DOM-less suite cannot see it, and the app
   * rendered a BLANK window: "Rendered more hooks than during the previous
   * render". The panel is the file with early returns AND the most hooks, so it
   * is the one worth scanning.
   */
  it("every hook is above the first early return", () => {
    const lines = panel.split("\n");
    const start = lines.findIndex((l) => l.startsWith("export function ChangesPanel("));
    const end = lines.findIndex((l, i) => i > start && l === "}");
    const body = lines.slice(start, end);
    const firstReturn = body.findIndex((l) => /^ {2}if \(.*\breturn\b/.test(l));
    expect(firstReturn).toBeGreaterThan(0); // the panel does have early returns
    const late = body
      .slice(firstReturn)
      .map((l, i) => [firstReturn + i + start + 1, l] as const)
      .filter(([, l]) => /^ {2}(const |let )?[^ ].*\buse(State|Ref|Memo|Effect|Callback)\(/.test(l));
    expect(late.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});

describe("the worktree cluster — finishing one", () => {
  const c = code(panel);

  it("exists only in a worktree's own panel", () => {
    expect(c).toMatch(/payload\.worktreeOf && \([\s\S]{0,1400}?Merge into[\s\S]{0,900}?Remove worktree…/);
  });

  it("merge is disabled with the precondition that is false, never hidden", () => {
    expect(c).toMatch(/aria-disabled=\{!mergeInfo\?\.ok\}/);
    expect(c).toMatch(/mergeInfo\?\.busy/);
    expect(c).toMatch(/mergeInfo\?\.reason/);
  });

  it("remove is two-stage: git's dirty refusal raises the force question", () => {
    expect(c).toMatch(/r\.dirty[\s\S]{0,600}?doRemove\(true, alsoDeleteBranch\)/);
    // …and deleting the branch is `-d`, never `-D`: git's refusal is the guard.
    expect(c).toMatch(/gitDeleteBranch\(parent, r\.branch, false\)/);
  });

  it("removing after a merge is OFFERED, never automatic", () => {
    expect(c).toMatch(/Merged — remove this worktree\?/);
    expect(c).toMatch(/confirmLabel: "Remove worktree and delete branch"/);
  });

  it("a conflict offers the pull request instead, and says nothing changed", () => {
    expect(c).toMatch(/r\.aborted \? "Couldn’t merge cleanly — nothing changed"/);
    expect(c).toMatch(/prUrl !== null \? "Open a pull request"/);
  });

  it("clean-up is on the PROJECT's panel, and the dialog says prune is repo-wide", () => {
    expect(c).toMatch(/!payload\.worktreeOf && staleWorktrees > 0/);
    expect(panel).toMatch(/every stale entry of this repository/);
  });

  it("every git failure is read with gitReason, never split\(\)\[0\]", () => {
    expect(c).not.toMatch(/\.error[^\n]*split\("\\n"\)\[0\]/);
    expect((c.match(/gitReason\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("the Changes panel names the project a worktree belongs to", () => {
  it("renders the parent's name from main's own answer", () => {
    expect(code(panel)).toMatch(/worktreeOf/);
    expect(panel).toMatch(/worktree of/);
  });
});
