/**
 * PRD §33 — the store. Key-free, no Electron.
 *
 * The git arm builds a REAL repo with a REAL second worktree, because the whole point of the
 * common-dir key is a behaviour `git rev-parse` decides, not one we can assert against a
 * string. It skips itself when git is missing (§5a).
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CAPS,
  forgetAll,
  forgetMemory,
  indexText,
  listMemories,
  memoryRoot,
  readMemory,
  regenerateIndex,
  saveMemory,
  slugify,
  estimateTokens,
  workspaceMemoryDir,
  workspaceMemoryKey,
} from "../src/main/memory/store";
import { gitCommonDir, resetGitAvailability } from "../src/main/git";

const tmps: string[] = [];
const mk = (p = "hv-mem-"): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  tmps.push(d);
  return d;
};
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe("keys", () => {
  it("repo: keys by the common dir's PARENT, so two worktrees of one clone share", () => {
    const a = workspaceMemoryKey("/x/wt-a", "/x/main/.git");
    const b = workspaceMemoryKey("/x/wt-b", "/x/main/.git");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("two different clones do NOT share — the recorded limit", () => {
    expect(workspaceMemoryKey("/a/wt", "/a/main/.git")).not.toBe(workspaceMemoryKey("/b/wt", "/b/main/.git"));
  });

  it("no repo: keys by the normalized path; a trailing slash is a no-op", () => {
    expect(workspaceMemoryKey("/x/plain/", null)).toBe(workspaceMemoryKey("/x/plain", null));
    expect(workspaceMemoryKey("/x/plain", null)).not.toBe(workspaceMemoryKey("/x/other", null));
  });

  it("dirs", () => {
    expect(memoryRoot("/ad")).toBe(path.join("/ad", "memory"));
    expect(workspaceMemoryDir("/ad", "abcd")).toBe(path.join("/ad", "memory", "workspaces", "abcd"));
  });
});

/**
 * The git arm builds a REAL repo and a REAL linked worktree. It must not SILENTLY pass when git
 * is missing (the repo's own "green run that tested nothing" hazard), so availability is probed
 * once, up front, and the arm SKIPS visibly.
 *
 * Trap this pins: `rev-parse --git-common-dir` answers a RELATIVE ".git" from the main worktree
 * and an ABSOLUTE path from a linked one. Without the `path.resolve(workspace, …)` in
 * gitCommonDir the two would key differently and worktree sharing would silently not happen.
 */
const HAVE_GIT = ((): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAVE_GIT)("gitCommonDir over a real repo and a real worktree", () => {
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: "pipe" });
  };

  it("both worktrees answer the same common dir, so both key the same", async () => {
    resetGitAvailability();
    const root = mk("hv-mem-git-");
    const main = path.join(root, "main");
    fs.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.email", "t@example.com");
    git(main, "config", "user.name", "T");
    fs.writeFileSync(path.join(main, "a.txt"), "x");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "init");
    const wt = path.join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "side");

    const c1 = await gitCommonDir(main);
    const c2 = await gitCommonDir(wt);
    expect(c1).not.toBeNull();
    expect(path.isAbsolute(c1!)).toBe(true); // the relative ".git" was resolved
    expect(c2).toBe(c1);
    expect(workspaceMemoryKey(wt, c2)).toBe(workspaceMemoryKey(main, c1));
    // …and neither equals the path-only key it would have had without git.
    expect(workspaceMemoryKey(wt, c2)).not.toBe(workspaceMemoryKey(wt, null));
  });

  it("a subdirectory of a repo keys to the same clone — memory follows the clone", async () => {
    resetGitAvailability();
    const root = mk("hv-mem-sub-");
    git(root, "init", "-q");
    const sub = path.join(root, "packages", "app");
    fs.mkdirSync(sub, { recursive: true });
    const c1 = await gitCommonDir(root);
    const c2 = await gitCommonDir(sub);
    expect(c1).not.toBeNull();
    expect(workspaceMemoryKey(sub, c2)).toBe(workspaceMemoryKey(root, c1));
  });

  it("a folder that is not a repo answers null, and still gets a key", async () => {
    resetGitAvailability();
    const plain = mk("hv-mem-plain-");
    expect(await gitCommonDir(plain)).toBeNull();
    expect(workspaceMemoryKey(plain, null)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("slugify", () => {
  it.each([
    ["OpenRouter preferred for live tests", "openrouter-preferred-for-live-tests"],
    ["  Talk like a young engineer! ", "talk-like-a-young-engineer"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["a".repeat(80), "a".repeat(64)],
  ])("%s → %s", (i, o) => {
    expect(slugify(i)).toBe(o);
  });

  it.each(["../../etc/passwd", "..", "/", "", "---", "!!!"])("never escapes on %s", (i) => {
    const s = slugify(i);
    if (s === null) return;
    expect(s).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    expect(s).not.toContain("/");
    expect(s).not.toContain("..");
  });
});

describe("save / read / list / forget / index", () => {
  it("saves, generates the index, upserts by name", async () => {
    const dir = mk();
    const r1 = await saveMemory(dir, {
      name: "Talk like a young engineer",
      description: "straight, explain jargon",
      type: "user",
      content: "Body A",
      originSessionId: "s1",
      now: new Date("2026-09-04T10:00:00Z"),
    });
    expect(r1).toEqual({ ok: true, slug: "talk-like-a-young-engineer", replaced: false });
    expect(fs.existsSync(path.join(dir, "talk-like-a-young-engineer.md"))).toBe(true);
    expect(indexText(dir)).toContain("## user");
    expect(indexText(dir)).toContain("- talk-like-a-young-engineer — straight, explain jargon");
    expect(readMemory(dir, "talk-like-a-young-engineer")?.originSessionId).toBe("s1");

    const r2 = await saveMemory(dir, {
      name: "talk like a young engineer",
      description: "updated",
      type: "user",
      content: "Body B",
    });
    expect(r2).toMatchObject({ ok: true, replaced: true });
    expect(readMemory(dir, "talk-like-a-young-engineer")?.body).toBe("Body B");
    expect(listMemories(dir)).toHaveLength(1);
    expect(indexText(dir)).not.toContain("straight, explain jargon");
  });

  it("forget removes the file AND the index line; an unknown slug is false", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "a", description: "d", type: "project", content: "x" });
    expect(await forgetMemory(dir, "a")).toBe(true);
    expect(indexText(dir)).not.toContain("- a —");
    expect(await forgetMemory(dir, "a")).toBe(false);
    expect(await forgetMemory(dir, "../escape")).toBe(false);
  });

  it("refuses with a reason: body cap, description cap, secret, bad name, bad type", async () => {
    const dir = mk();
    expect(await saveMemory(dir, { name: "a", description: "d", type: "project", content: "x".repeat(CAPS.body + 1) })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("4 KB"),
    });
    expect(await saveMemory(dir, { name: "a", description: "d".repeat(CAPS.description + 1), type: "project", content: "x" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("150"),
    });
    expect(
      await saveMemory(dir, { name: "a", description: "d", type: "project", content: "key: sk-abcdefghijklmnopqrstuvwxyz0123456789" })
    ).toMatchObject({ ok: false, reason: expect.stringContaining("API key") });
    expect(await saveMemory(dir, { name: "!!!", description: "d", type: "project", content: "x" })).toMatchObject({ ok: false });
    expect(await saveMemory(dir, { name: "a", description: "d", type: "secret", content: "x" })).toMatchObject({ ok: false });
    expect(listMemories(dir)).toHaveLength(0); // nothing that failed a check reached disk
  });

  it("the scope cap refuses a NEW memory but still allows an upsert — that is how it consolidates", async () => {
    const dir = mk();
    for (let i = 0; i < CAPS.perScope; i++) {
      await saveMemory(dir, { name: `m${i}`, description: "d", type: "project", content: "x" });
    }
    expect(await saveMemory(dir, { name: "one-more", description: "d", type: "project", content: "x" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("full (100)"),
    });
    expect(await saveMemory(dir, { name: "m1", description: "d2", type: "project", content: "y" })).toMatchObject({
      ok: true,
      replaced: true,
    });
  });

  it("the index is regenerated from FILES, so a hand-deleted file leaves no dangling line", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "a", description: "da", type: "project", content: "x" });
    await saveMemory(dir, { name: "b", description: "db", type: "reference", content: "x" });
    fs.rmSync(path.join(dir, "a.md"));
    regenerateIndex(dir);
    expect(indexText(dir)).not.toContain("da");
    expect(indexText(dir)).toContain("## reference\n- b — db");
  });

  it("concurrent saves serialize — no torn index", async () => {
    const dir = mk();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => saveMemory(dir, { name: `c${i}`, description: `d${i}`, type: "feedback", content: "x" }))
    );
    const idx = indexText(dir);
    for (let i = 0; i < 20; i++) expect(idx).toContain(`- c${i} — d${i}`);
    expect(listMemories(dir)).toHaveLength(20);
  });

  it("ignores MEMORY.md and files without usable frontmatter when listing", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "a", description: "d", type: "project", content: "x" });
    fs.writeFileSync(path.join(dir, "stray.md"), "no frontmatter");
    fs.writeFileSync(path.join(dir, "notes.txt"), "not markdown");
    expect(listMemories(dir).map((m) => m.slug)).toEqual(["a"]);
  });

  it("listing an absent scope is empty, not an error", () => {
    expect(listMemories(path.join(mk(), "never-created"))).toEqual([]);
    expect(indexText(path.join(mk(), "never-created"))).toBe("");
  });

  it("estimateTokens weighs the index lines, not the bodies", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "a", description: "short", type: "user", content: "x".repeat(2000) });
    const e = estimateTokens(dir);
    expect(e.count).toBe(1);
    expect(e.tokens).toBeLessThan(20); // the 2 KB body is NOT in the per-turn cost
    expect(e.items[0].name).toBe("a");
  });

  it("forgetAll empties the scope and the index", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "a", description: "d", type: "user", content: "x" });
    await saveMemory(dir, { name: "b", description: "d", type: "user", content: "x" });
    expect(await forgetAll(dir)).toBe(2);
    expect(listMemories(dir)).toEqual([]);
    expect(indexText(dir).trim()).toBe("");
  });

  it("sorts newest-modified first", async () => {
    const dir = mk();
    await saveMemory(dir, { name: "old", description: "d", type: "user", content: "x", now: new Date("2026-01-01T00:00:00Z") });
    await saveMemory(dir, { name: "new", description: "d", type: "user", content: "x", now: new Date("2026-09-01T00:00:00Z") });
    expect(listMemories(dir).map((m) => m.slug)).toEqual(["new", "old"]);
  });
});
