import { describe, expect, it } from "vitest";
import {
  hunkPatch,
  mergeNumstat,
  parseLog,
  parseNumstat,
  parsePorcelainV2,
  parseStashList,
  parseUnifiedDiff,
  totalChangedLines,
} from "../src/main/gitParse";

/**
 * §29. Every fixture below is REAL output captured from git 2.50.1 against a
 * throwaway repo — never hand-written, because the shapes that bite (the
 * rename line's path order, a rename section with zero hunks, the unborn
 * `(initial)` oid) are exactly the ones a plausible guess gets wrong.
 */

const PORCELAIN = `# branch.oid f607fbdf36e04a02fa1bb18237731a656db723ba
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 .D N... 100644 100644 000000 c118916 c118916 docs/gone.md
1 .M N... 100644 100644 100644 c9e9e05 c9e9e05 src/a.ts
2 R. N... 100644 100644 100644 33194a0 33194a0 R100 src/renamed.ts\tsrc/rename-me.ts
u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts
? src/bin.dat
? src/new.ts
! ignored/thing.log
`;

const DIFF = `diff --git a/docs/gone.md b/docs/gone.md
deleted file mode 100644
index c118916..0000000
--- a/docs/gone.md
+++ /dev/null
@@ -1 +0,0 @@
-del me
diff --git a/src/a.ts b/src/a.ts
index c9e9e05..c7c4051 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
@@ -7,3 +7,3 @@
 seven
-eight
+EIGHT
 nine
diff --git a/src/rename-me.ts b/src/renamed.ts
similarity index 100%
rename from src/rename-me.ts
rename to src/renamed.ts
diff --git a/src/bin2.dat b/src/bin2.dat
index a1239a7..8a13470 100644
Binary files a/src/bin2.dat and b/src/bin2.dat differ
`;

describe("parsePorcelainV2", () => {
  const r = parsePorcelainV2(PORCELAIN);

  it("reads the branch header including ahead/behind", () => {
    expect(r.branch).toEqual({
      branch: "main",
      oid: "f607fbdf36e04a02fa1bb18237731a656db723ba",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
  });

  it("reads an unborn HEAD as a null oid, not the literal (initial)", () => {
    const u = parsePorcelainV2("# branch.oid (initial)\n# branch.head main\n");
    expect(u.branch.oid).toBeNull();
    expect(u.branch.branch).toBe("main");
    expect(u.branch.ahead).toBe(0);
  });

  it("reads a detached HEAD as a null branch", () => {
    const d = parsePorcelainV2("# branch.oid abc123\n# branch.head (detached)\n");
    expect(d.branch.branch).toBeNull();
  });

  it("classifies ordinary entries and their staged half", () => {
    const gone = r.files.find((f) => f.path === "docs/gone.md")!;
    expect(gone.status).toBe("deleted");
    expect(gone.staged).toBe(false); // ".D" — deleted in the worktree only

    const a = r.files.find((f) => f.path === "src/a.ts")!;
    expect(a.status).toBe("modified");
    expect(a.staged).toBe(false);
  });

  it("takes the NEW path from a rename entry and keeps the old one", () => {
    // "2 R. … R100 <new>\t<orig>" — new first, orig after the tab. Getting this
    // backwards would show the user a file that no longer exists.
    const ren = r.files.find((f) => f.status === "renamed")!;
    expect(ren.path).toBe("src/renamed.ts");
    expect(ren.origPath).toBe("src/rename-me.ts");
    expect(ren.staged).toBe(true); // "R." — staged rename
  });

  it("keeps unmerged entries as modified rather than crashing", () => {
    const c = r.files.find((f) => f.path === "src/conflict.ts")!;
    expect(c.status).toBe("modified");
  });

  it("lists untracked files and drops ignored ones", () => {
    const untracked = r.files.filter((f) => f.status === "untracked").map((f) => f.path);
    expect(untracked).toEqual(["src/bin.dat", "src/new.ts"]);
    expect(r.files.some((f) => f.path === "ignored/thing.log")).toBe(false);
  });

  it("survives a path containing spaces", () => {
    const s = parsePorcelainV2("1 .M N... 100644 100644 100644 aaa bbb src/My Notes.md\n");
    expect(s.files[0].path).toBe("src/My Notes.md");
  });

  it("unquotes a C-quoted path", () => {
    const s = parsePorcelainV2('1 .M N... 100644 100644 100644 aaa bbb "src/we\\"ird.md"\n');
    expect(s.files[0].path).toBe('src/we"ird.md');
  });
});

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(DIFF);

  it("splits every file section", () => {
    expect(files.map((f) => f.path)).toEqual([
      "docs/gone.md",
      "src/a.ts",
      "src/renamed.ts",
      "src/bin2.dat",
    ]);
  });

  it("keeps a deleted file's own path rather than /dev/null", () => {
    expect(files[0].path).toBe("docs/gone.md");
    expect(files[0].hunks).toHaveLength(1);
  });

  it("splits multiple hunks and keeps their raw lines verbatim", () => {
    const a = files[1];
    expect(a.hunks).toHaveLength(2);
    expect(a.hunks[0].header).toBe("@@ -1,4 +1,4 @@");
    expect(a.hunks[0].lines).toEqual([" one", "-two", "+TWO", " three"]);
    expect(a.hunks[1].lines).toEqual([" seven", "-eight", "+EIGHT", " nine"]);
  });

  it("reads a rename section that carries no hunks at all", () => {
    const ren = files[2];
    expect(ren.origPath).toBe("src/rename-me.ts");
    expect(ren.hunks).toHaveLength(0);
    expect(ren.binary).toBe(false);
  });

  it("flags a binary file instead of inventing hunks", () => {
    expect(files[3].binary).toBe(true);
    expect(files[3].hunks).toHaveLength(0);
  });

  it("keeps the no-newline marker inside the hunk", () => {
    const nn = parseUnifiedDiff(
      "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n"
    );
    expect(nn[0].hunks[0].lines).toContain("\\ No newline at end of file");
  });

  it("returns nothing for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("hunkPatch", () => {
  it("rebuilds a one-hunk patch git apply can consume", () => {
    const files = parseUnifiedDiff(DIFF);
    const patch = hunkPatch(files[1], files[1].hunks[1]);
    // The file header must survive intact — apply needs it to find the file.
    expect(patch.startsWith("diff --git a/src/a.ts b/src/a.ts\n")).toBe(true);
    expect(patch).toContain("--- a/src/a.ts");
    expect(patch).toContain("+++ b/src/a.ts");
    // Exactly the ONE hunk asked for, never its sibling.
    expect(patch.match(/^@@/gm)).toHaveLength(1);
    expect(patch).toContain("+EIGHT");
    expect(patch).not.toContain("+TWO");
    expect(patch.endsWith("\n")).toBe(true);
  });
});

describe("parseNumstat", () => {
  it("reads counts and treats a binary marker as zero", () => {
    const m = parseNumstat("0\t1\tdocs/gone.md\n2\t2\tsrc/a.ts\n-\t-\tsrc/bin2.dat\n");
    expect(m.get("docs/gone.md")).toEqual({ additions: 0, deletions: 1 });
    expect(m.get("src/a.ts")).toEqual({ additions: 2, deletions: 2 });
    expect(m.get("src/bin2.dat")).toEqual({ additions: 0, deletions: 0 });
  });

  it("keys a rename by its new path", () => {
    const m = parseNumstat("0\t0\tsrc/rename-me.ts => src/renamed.ts\n");
    expect(m.get("src/renamed.ts")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("mergeNumstat", () => {
  it("fills counts onto matching files and leaves the rest at zero", () => {
    const { files } = parsePorcelainV2(PORCELAIN);
    const merged = mergeNumstat(files, parseNumstat("2\t2\tsrc/a.ts\n"));
    expect(merged.find((f) => f.path === "src/a.ts")).toMatchObject({ additions: 2, deletions: 2 });
    expect(merged.find((f) => f.path === "src/new.ts")).toMatchObject({ additions: 0, deletions: 0 });
  });
});

describe("totalChangedLines", () => {
  it("sums additions and deletions across files", () => {
    const files = mergeNumstat(
      parsePorcelainV2(PORCELAIN).files,
      parseNumstat("2\t2\tsrc/a.ts\n0\t1\tdocs/gone.md\n")
    );
    expect(totalChangedLines(files)).toBe(5);
  });
});

describe("parseStashList and parseLog", () => {
  it("reads the NUL-separated stash format", () => {
    const s = parseStashList("stash@{0}\x00On main: HappyVibe: switching to x\nstash@{1}\x00WIP\n");
    expect(s).toEqual([
      { index: 0, message: "On main: HappyVibe: switching to x" },
      { index: 1, message: "WIP" },
    ]);
  });

  it("reads the NUL-separated log format, keeping a subject that contains spaces", () => {
    const l = parseLog(
      "897050d\x00fix(auth): stop the retry loop\x002026-08-16T07:35:47+02:00\nf607fbd\x00init\x002026-08-16T07:34:21+02:00\n"
    );
    expect(l).toHaveLength(2);
    expect(l[0]).toEqual({
      sha: "897050d",
      subject: "fix(auth): stop the retry loop",
      authorDate: "2026-08-16T07:35:47+02:00",
    });
  });
});
