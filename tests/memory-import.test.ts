/**
 * PRD §33 — import from Claude Code. Fixtures are the REAL on-disk layout
 * (`~/.claude/projects/<key>/memory/*.md`) with all three frontmatter variants.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guessPathFromKey, importMemories, scanClaudeCodeMemory } from "../src/main/memory/import";
import { indexText, listMemories, saveMemory } from "../src/main/memory/store";

const tmps: string[] = [];
const mk = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mem-import-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

function fakeHome(): { home: string; dir: string } {
  const home = mk();
  const dir = path.join(home, ".claude", "projects", "-Users-me-Documents-Github-Foo", "memory");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Memory Index\n- [a](a.md) — hook\n");
  fs.writeFileSync(path.join(dir, "a.md"), `---\nname: a-fact\ndescription: "A: one"\nmetadata:\n  type: user\n---\n\nBody A.\n`);
  fs.writeFileSync(
    path.join(dir, "b.md"),
    `---\nname: b-fact\ndescription: B two\nmetadata:\n  node_type: memory\n  type: project\n  originSessionId: cc-session-1\n---\nBody B.`
  );
  fs.writeFileSync(
    path.join(dir, "c.md"),
    `---\nname: c-fact\ndescription: C three\nmetadata:\n  node_type: memory\n  type: feedback\n  originSessionId: cc-2\n  modified: 2026-01-01T00:00:00.000Z\n---\nBody C.`
  );
  fs.writeFileSync(path.join(dir, "bad.md"), "just prose, no frontmatter at all");
  fs.writeFileSync(
    path.join(dir, "leaky.md"),
    `---\nname: leaky\ndescription: has a key\nmetadata:\n  type: reference\n---\n\ntoken sk-abcdefghijklmnopqrstuvwxyz0123456789\n`
  );
  return { home, dir };
}

describe("scanClaudeCodeMemory", () => {
  it("finds the project, reads all three frontmatter variants, names what it skipped", () => {
    const { home } = fakeHome();
    const { projects } = scanClaudeCodeMemory(home);
    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(p.key).toBe("-Users-me-Documents-Github-Foo");
    // leaky.md parses fine here — the SECRET is caught at write time, not at scan time, so the
    // user sees it in the picker and then sees it refused with a reason.
    expect(p.memories.map((m) => m.slug).sort()).toEqual(["a-fact", "b-fact", "c-fact", "leaky"]);
    expect(p.memories.find((m) => m.slug === "b-fact")!.type).toBe("project");
    expect(p.skipped.map((s) => s.file)).toEqual(["bad.md"]);
    expect(p.skipped[0].reason).toMatch(/frontmatter/);
  });

  it("never offers Claude Code's own MEMORY.md — ours is regenerated", () => {
    const { home } = fakeHome();
    const p = scanClaudeCodeMemory(home).projects[0];
    expect(p.memories.some((m) => m.file.endsWith("MEMORY.md"))).toBe(false);
    expect(p.skipped.some((s) => s.file === "MEMORY.md")).toBe(false);
  });

  it("no Claude Code on this machine ⇒ an empty list, not an error", () => {
    expect(scanClaudeCodeMemory(mk())).toEqual({ projects: [] });
  });

  it("a project folder with no memory dir is not listed", () => {
    const home = mk();
    fs.mkdirSync(path.join(home, ".claude", "projects", "-Users-me-empty"), { recursive: true });
    expect(scanClaudeCodeMemory(home).projects).toEqual([]);
  });
});

describe("guessPathFromKey", () => {
  it("turns Claude Code's slug back into a path, for PRE-SELECTION only", () => {
    expect(guessPathFromKey("-Users-me-Documents-Github-Foo")).toBe("/Users/me/Documents/Github/Foo");
  });

  it("is lossy on a hyphenated directory — which is why nothing is written on it", () => {
    // A real folder named "my-app" is indistinguishable from a separator. The guess is wrong
    // here, on purpose: the user picks the destination, this only pre-selects one.
    expect(guessPathFromKey("-Users-me-my-app")).toBe("/Users/me/my/app");
  });
});

describe("importMemories", () => {
  it("copies in, re-serialises to our shape, and DROPS the foreign originSessionId", async () => {
    const { home } = fakeHome();
    const dest = mk();
    const files = scanClaudeCodeMemory(home).projects[0].memories.filter((m) => m.slug !== "leaky").map((m) => m.file);
    const res = await importMemories(files, dest);
    expect(res.imported.sort()).toEqual(["a-fact", "b-fact", "c-fact"]);
    expect(res.skipped).toEqual([]);
    const items = listMemories(dest);
    expect(items).toHaveLength(3);
    // b.md carried originSessionId: cc-session-1 — it must NOT survive, or the inspector would
    // claim one of OUR sessions saved it.
    for (const m of items) expect(m.originSessionId).toBeUndefined();
    expect(indexText(dest)).toContain("- a-fact — A: one");
    expect(indexText(dest)).toContain("## project");
  });

  it("skips and NAMES a collision — never overwrites", async () => {
    const { home } = fakeHome();
    const dest = mk();
    await saveMemory(dest, { name: "a-fact", description: "mine, edited", type: "user", content: "MY BODY" });
    const files = scanClaudeCodeMemory(home).projects[0].memories.map((m) => m.file);
    const res = await importMemories(files, dest);
    expect(res.imported).not.toContain("a-fact");
    expect(res.skipped.find((s) => s.file === "a.md")!.reason).toMatch(/already here/);
    expect(listMemories(dest).find((m) => m.slug === "a-fact")!.description).toBe("mine, edited");
  });

  it("runs the secret scan — an imported memory is not a trusted one", async () => {
    const { home } = fakeHome();
    const dest = mk();
    const leaky = scanClaudeCodeMemory(home).projects[0].memories.find((m) => m.slug === "leaky")!;
    const res = await importMemories([leaky.file], dest);
    expect(res.imported).toEqual([]);
    expect(res.skipped[0].reason).toMatch(/API key/);
    expect(listMemories(dest)).toEqual([]);
  });

  it("importing twice is a no-op the second time, and says so", async () => {
    const { home } = fakeHome();
    const dest = mk();
    const files = scanClaudeCodeMemory(home).projects[0].memories.filter((m) => m.slug !== "leaky").map((m) => m.file);
    await importMemories(files, dest);
    const second = await importMemories(files, dest);
    expect(second.imported).toEqual([]);
    expect(second.skipped).toHaveLength(3);
    expect(listMemories(dest)).toHaveLength(3);
  });
});
