import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §29 worktrees — the sidebar navigates and STARTS; the Changes panel acts.
 *
 * Amended 2026-09-21 by the first real use: with no worktree yet the sidebar
 * said nothing about them at all, so the only route in was two clicks deep in a
 * menu labelled with a branch name. People look under `+`. The project row's
 * `+` therefore OPENS A MENU — the same control as the tab strip's pane `+`,
 * down to the shared row and the shortcut printed beside each label. A split
 * `+ ▾` was tried in between and was two controls where one was asked for.
 *
 * New worktree is the ONE git word the sidebar carries. Everything that CHANGES
 * a tree (merge, remove, clean up) still lives in the panel, and the assertions
 * below pin that line where it now is.
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

  it("carries no verb that CHANGES a tree — those stay in the panel", () => {
    expect(code(sidebar)).not.toMatch(/Merge into/);
    expect(code(sidebar)).not.toMatch(/Remove worktree/);
    expect(code(sidebar)).not.toMatch(/Clean up/);
  });

  it("the `+` OPENS the menu on a repo — one control, not a split", () => {
    const c = code(sidebar);
    expect(c).toMatch(/aria-haspopup="menu"/);
    expect(c).toMatch(/setStartMenu\(\(m\) => \(m === ws \? null : ws\)\)/);
    // The split that was tried in between is gone, caret and all.
    expect(c).not.toMatch(/More ways to start/);
    expect(c).not.toContain("▾");
  });

  it("both rows go through the SHARED row, each showing its shortcut", () => {
    const c = code(sidebar);
    expect(c).toMatch(/<MenuItem[\s\S]{0,200}?label="New session"[\s\S]{0,120}?hint=\{newSessionKey\}/);
    expect(c).toMatch(/<MenuItem[\s\S]{0,200}?label="New worktree…"[\s\S]{0,120}?hint=\{newWorktreeKey\}/);
    // It ASKS; the panel still owns the dialog.
    expect(c).toMatch(/onNewWorktree\?\.\(ws\)/);
  });

  it("the hints arrive ALREADY formatted — no key formatting in the sidebar", () => {
    // tests/mod-key-copy.test.ts allows a literal ⌘ in exactly three files and
    // pins that allowlist at three, so formatBinding stays in App.
    expect(code(sidebar)).not.toMatch(/formatBinding/);
    // Comments may name a key (mod-key-copy strips them too); rendered copy may not.
    expect(code(sidebar)).not.toContain("⌘");
  });

  it("a folder that is not a repository keeps a plain `+`", () => {
    // A `+` with one action is a button, not a menu.
    const c = code(sidebar);
    expect(c).toMatch(/\) : \([\s\S]{0,400}?title="New session"[\s\S]{0,120}?onClick=\{\(\) => onNewSession\(ws\)\}/);
  });

  it("dismisses on blur, NOT with a click-catcher that would blank browser panes", () => {
    // browserCoverage judges candidates by BOX, so a `fixed inset-0` catcher
    // reads as covering every embedded browser pane for as long as it is up.
    // The rows act on mousedown (MenuItem), which is what makes blur safe here.
    const c = code(sidebar);
    expect(c).toMatch(/onBlur=\{\(e\) => \{\s*if \(!e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)\) setStartMenu\(null\)/);
    expect(c).not.toMatch(/fixed inset-0[^\n]*setStartMenu/);
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

describe("the panel serves the sidebar's request, and still owns the dialog", () => {
  const c = code(panel);
  it("opens on request for THIS workspace, once, and waits for the payload", () => {
    expect(c).toMatch(/pendingNewWorktree !== workspace \|\| !payload/);
    // Consumed, because the panel remounts on every return to it — a nonce
    // would re-raise the dialog each time you came back.
    expect(c).toMatch(/onNewWorktreeConsumed\?\.\(\)/);
  });

  it("says why when the verb is unavailable, so the menu item is never a dead end", () => {
    expect(c).toMatch(/flashRef\.current\?\.\(payload\.worktreeAdd\.reason\)/);
  });
});

describe("New worktree… lives in the branch menu too", () => {
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

describe("the Sync button says it is working", () => {
  const c = code(panel);

  it("spins its own glyph while the sync runs", () => {
    expect(c).toMatch(/<SyncGlyph spinning=\{syncing\} \/>/);
    expect(c).toMatch(/spinning \? " animate-spin" : ""/);
  });

  it("off a flag of its OWN, not the panel-wide `working`", () => {
    // `working` is set by every write here — Fetch, stage, undo, stash, a
    // branch switch — so spinning off it would turn the Sync arrows for an
    // action Sync did not run.
    expect(c).not.toMatch(/<SyncGlyph spinning=\{working\}/);
    expect(c).toMatch(/setSyncing\(true\)[\s\S]{0,700}?\.finally\(\(\) => setSyncing\(false\)\)/);
  });
});

describe("a confirm dialog always has a way out", () => {
  const c = code(panel);

  it("Esc closes it — the promise FIXED_SHORTCUTS has been making since round 8", () => {
    // The scrim and the Cancel button were the only two ways out, so a dialog
    // whose Cancel does not respond had no keyboard escape at all. Found while
    // investigating exactly that report.
    expect(c).toMatch(/function ConfirmDialog[\s\S]{0,900}?e\.key !== "Escape"/);
    expect(c).toMatch(/function ConfirmDialog[\s\S]{0,1100}?window\.addEventListener\("keydown", onKey, true\)/);
  });

  it("listens on WINDOW, because the focus may be inside the dialog body", () => {
    // The New worktree dialog autofocuses its input; a handler on the container
    // would never see the key.
    expect(c).not.toMatch(/function ConfirmDialog[\s\S]{0,900}?onKeyDown=/);
  });

  it("and removes the listener, so a closed dialog cannot still eat Esc", () => {
    expect(c).toMatch(/removeEventListener\("keydown", onKey, true\)/);
  });
});

describe("the Changes panel names the project a worktree belongs to", () => {
  it("renders the parent's name from main's own answer", () => {
    expect(code(panel)).toMatch(/worktreeOf/);
    expect(panel).toMatch(/worktree of/);
  });
});
