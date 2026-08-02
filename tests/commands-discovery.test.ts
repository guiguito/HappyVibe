import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { hashCommandFile, parseCommandFrontmatter, readCommandFile, scanCommandsDir } from "../src/main/commands/discovery";

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("command discovery", () => {
  it("reads frontmatter and derives the name from the filename", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "review.md"), `---\ndescription: Review the diff\nargument-hint: "[path]"\n---\nReview $1.\n`);
    const [c] = scanCommandsDir(d, "managed");
    expect(c.name).toBe("review");
    expect(c.description).toBe("Review the diff");
    expect(c.argumentHint).toBe("[path]");
    expect(c.id).toBe(path.join(d, "review.md"));
  });

  it("falls back to the first body line, truncated to 60 chars, like Pi does", () => {
    const d = tmp();
    const long = "x".repeat(80);
    fs.writeFileSync(path.join(d, "nodesc.md"), `${long}\nmore\n`);
    const [c] = scanCommandsDir(d, "managed");
    expect(c.description).toBe("x".repeat(60) + "...");
  });

  it("flags inline bash injection, which Pi does not support", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "a.md"), "Context: !`git status`\n");
    fs.writeFileSync(path.join(d, "b.md"), "No injection here\n");
    const byName = Object.fromEntries(scanCommandsDir(d, "managed").map((c) => [c.name, c]));
    expect(byName.a.hasBashInjection).toBe(true);
    expect(byName.b.hasBashInjection).toBe(false);
  });

  it("does not recurse, and ignores non-markdown and dotfiles", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "nested"));
    fs.writeFileSync(path.join(d, "nested", "deep.md"), "deep\n");
    fs.writeFileSync(path.join(d, ".hidden.md"), "hidden\n");
    fs.writeFileSync(path.join(d, "notes.txt"), "nope\n");
    fs.writeFileSync(path.join(d, "top.md"), "top\n");
    expect(scanCommandsDir(d, "managed").map((c) => c.name)).toEqual(["top"]);
  });

  it("hash changes when the file content changes", () => {
    const d = tmp();
    const f = path.join(d, "c.md");
    fs.writeFileSync(f, "one\n");
    const h1 = hashCommandFile(f);
    fs.writeFileSync(f, "two\n");
    expect(hashCommandFile(f)).not.toBe(h1);
  });

  it("returns [] for a missing root", () => {
    expect(scanCommandsDir("/nope/does/not/exist", "workspace")).toEqual([]);
  });

  // Below: the invariants the plan's cases lean on but don't assert directly.

  it("parseCommandFrontmatter reads only description/argument-hint, and strips the block from the body", () => {
    const parsed = parseCommandFrontmatter(`---\ndescription: "Does a thing."\nargument-hint: '[file]'\nallowed-tools: bash\n---\nBody line.\n`);
    expect(parsed).toEqual({ description: "Does a thing.", argumentHint: "[file]", body: "Body line." });
    // No frontmatter at all: the whole file is the body (Pi's own behaviour).
    expect(parseCommandFrontmatter("Just a body.\n").body).toBe("Just a body.\n");
  });

  it("readCommandFile keeps the body and sizes it — there is no per-turn card cost", () => {
    const d = tmp();
    const f = path.join(d, "x.md");
    fs.writeFileSync(f, `---\ndescription: Sized.\n---\n${"y".repeat(40)}\n`);
    const c = readCommandFile(f, "linked");
    expect(c.body).toBe("y".repeat(40));
    expect(c.source).toBe("linked");
    expect(c.estTokens).toEqual({ body: 10 });
  });

  it("every readable .md loads — a description-less command is still a command", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "empty.md"), "");
    const [c] = scanCommandsDir(d, "managed");
    expect(c.name).toBe("empty");
    expect(c.description).toBe("");
    expect(c.hasBashInjection).toBe(false);
  });
});
