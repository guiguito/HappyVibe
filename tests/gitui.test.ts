import { describe, expect, it } from "vitest";
import { badgeTint, countDiffLines, groupByDir, primaryAction, statusGlyph, summarise } from "../src/renderer/src/gitui";

/** A file change with only the fields a given assertion cares about. */
function f(over: Partial<HvGitFileChange> & { path: string }): HvGitFileChange {
  return { status: "modified", staged: false, additions: 0, deletions: 0, ...over };
}

describe("badgeTint", () => {
  it("stays green while the pile is small", () => {
    expect(badgeTint(0)).toBe("green");
    expect(badgeTint(49)).toBe("green");
  });

  it("turns amber past what you would be sad to lose", () => {
    expect(badgeTint(50)).toBe("amber");
    expect(badgeTint(5_000)).toBe("amber");
  });

  it("has NO red tier", () => {
    // Red means "broken" everywhere else in this app, and an uncommitted pile is
    // never broken. Pinned so nobody adds one for symmetry with the context bubble.
    const tints = [0, 1, 49, 50, 100, 10_000, 1e9].map(badgeTint);
    expect(tints).not.toContain("red");
    expect(new Set(tints)).toEqual(new Set(["green", "amber"]));
  });
});

describe("primaryAction", () => {
  const clean = { files: [], stagedCount: 0, upstream: null, ahead: 0, behind: 0, hasCommits: true };

  it("offers Save a version when nothing is staged", () => {
    const a = primaryAction({ ...clean, files: [f({ path: "a.ts" }), f({ path: "b.ts" })] });
    expect(a).toEqual({ kind: "save", label: "Save a version" });
  });

  it("says how many of how many when a subset is staged", () => {
    const a = primaryAction({
      ...clean,
      files: Array.from({ length: 12 }, (_, i) => f({ path: `f${i}.ts`, staged: i < 3 })),
      stagedCount: 3,
    });
    expect(a).toEqual({ kind: "save", label: "Save 3 of 12", count: [3, 12] });
  });

  it("offers Publish branch when clean with no upstream", () => {
    expect(primaryAction(clean)).toEqual({ kind: "publish", label: "Publish branch" });
  });

  it("offers Sync with the ahead count on the BUTTON, not the bar", () => {
    // The figures belong in the human altitude only as a count; the exact
    // ahead/behind pair lives in the tooltip and the mono command line.
    expect(primaryAction({ ...clean, upstream: "origin/main", ahead: 2, behind: 0 })).toEqual({
      kind: "sync",
      label: "Sync (2)",
      n: 2,
    });
    expect(primaryAction({ ...clean, upstream: "origin/main", ahead: 0, behind: 3 })).toEqual({
      kind: "sync",
      label: "Sync (3)",
      n: 3,
    });
  });

  it("offers nothing at all when clean and fully synced — the All saved state", () => {
    expect(primaryAction({ ...clean, upstream: "origin/main" })).toEqual({ kind: "none" });
  });

  it("offers Save, never Publish, when a repo has no commits yet", () => {
    // The on-ramp's first state: publishing an empty branch is not the move.
    const a = primaryAction({ ...clean, files: [f({ path: "a.ts", status: "untracked" })], hasCommits: false });
    expect(a.kind).toBe("save");
  });

  it("offers nothing on an unborn repo with no files", () => {
    expect(primaryAction({ ...clean, hasCommits: false })).toEqual({ kind: "none" });
  });
});

describe("groupByDir", () => {
  it("groups by directory with root files last", () => {
    const g = groupByDir([
      f({ path: "README.md" }),
      f({ path: "src/a.ts" }),
      f({ path: "docs/x.md" }),
      f({ path: "src/b.ts" }),
    ]);
    expect(g.map((x) => x.dir)).toEqual(["docs", "src", ""]);
    expect(g.find((x) => x.dir === "src")!.files.map((x) => x.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps nested directories distinct and sorted", () => {
    const g = groupByDir([f({ path: "src/ui/x.ts" }), f({ path: "src/a.ts" }), f({ path: "src/ui/a.ts" })]);
    expect(g.map((x) => x.dir)).toEqual(["src", "src/ui"]);
  });

  it("returns nothing for no files", () => {
    expect(groupByDir([])).toEqual([]);
  });
});

describe("statusGlyph", () => {
  it("gives each status a distinct single character", () => {
    const glyphs = (["added", "modified", "deleted", "renamed", "untracked"] as const).map(statusGlyph);
    expect(glyphs).toEqual(["A", "M", "D", "R", "U"]);
    expect(new Set(glyphs).size).toBe(5);
  });
});

describe("summarise", () => {
  it("counts files and lines for the panel header", () => {
    const s = summarise([
      f({ path: "a.ts", additions: 3, deletions: 1 }),
      f({ path: "b.ts", additions: 0, deletions: 4, staged: true }),
    ]);
    expect(s).toEqual({ files: 2, additions: 3, deletions: 5, staged: 1, changedLines: 8 });
  });

  it("reads zero for a clean tree", () => {
    expect(summarise([])).toEqual({ files: 0, additions: 0, deletions: 0, staged: 0, changedLines: 0 });
  });
});

/**
 * The `+n −m` beside a collapsed file in a commit's diff. Counted from the
 * hunks because `FileDiff` carries no totals and `gitShow` has no status behind
 * it — see countDiffLines' own note.
 */
describe("countDiffLines", () => {
  const hunk = (lines: string[]): HvDiffHunk => ({ header: "@@ -1 +1 @@", lines, raw: "" });

  it("counts added and removed lines, ignoring context", () => {
    expect(countDiffLines([hunk([" ctx", "+one", "+two", "-gone", " ctx"])])).toEqual({ additions: 2, deletions: 1 });
  });

  it("adds up across hunks", () => {
    expect(countDiffLines([hunk(["+a"]), hunk(["-b", "-c"])])).toEqual({ additions: 1, deletions: 2 });
  });

  it("does not count git's no-newline annotation as a change", () => {
    // `\ No newline at end of file` is a note about the file, not a line of it.
    expect(countDiffLines([hunk(["+a", "\\ No newline at end of file"])])).toEqual({ additions: 1, deletions: 0 });
  });

  it("reads zero for a file with no hunks (a pure rename)", () => {
    expect(countDiffLines([])).toEqual({ additions: 0, deletions: 0 });
  });
});
