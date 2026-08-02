import { describe, it, expect } from "vitest";
import { inlineMentionPaths, willExpand } from "../src/main/commandMentions";

/**
 * §24 × F3. `/explain @Game.ts` used to reach Pi as the command PLUS the whole
 * file, because main appends `<file>` blocks before Pi expands and a template's
 * `${ARGUMENTS}` captures everything after the name. The file ended up inlined
 * and markdown-mangled inside the prompt, and the template's own "read the file"
 * instruction then made the model read it a second time.
 */
const FILES = ["/abs/prompts/explain.md", "/abs/prompts/review.md"];

describe("willExpand", () => {
  it("matches a loaded prompt template", () => {
    expect(willExpand("/explain @Game.ts", FILES)).toBe(true);
    expect(willExpand("/review", FILES)).toBe(true);
  });

  it("ignores a command this session did not load", () => {
    expect(willExpand("/notloaded x", FILES)).toBe(false);
  });

  it("ignores an ordinary message", () => {
    expect(willExpand("explain @Game.ts please", FILES)).toBe(false);
  });

  /**
   * Load-bearing. Pi expands a skill by APPENDING the args after the skill block
   * (agent-session.js:963 `${skillBlock}\n\n${args}`), so an injected <file>
   * block already lands exactly where it lands for a normal message. Rewriting
   * the mention to a bare path here would REMOVE a file the model currently
   * gets for free. Only `${ARGUMENTS}` substitution has the problem.
   */
  it("never matches a /skill: invocation — skills append args, they do not substitute", () => {
    expect(willExpand("/skill:pdf-tools @Game.ts", FILES)).toBe(false);
  });

  it("never matches an /hv-* extension command — Pi handles those before expansion", () => {
    expect(willExpand("/hv-context", FILES)).toBe(false);
  });
});

describe("inlineMentionPaths", () => {
  it("rewrites a basename label to its workspace-relative path", () => {
    expect(inlineMentionPaths("/explain @Game.ts", ["src/Game.ts"])).toBe("/explain src/Game.ts");
  });

  it("rewrites a full-path label (the basename-collision case) without double-substituting", () => {
    expect(inlineMentionPaths("/explain @src/Game.ts", ["src/Game.ts"])).toBe("/explain src/Game.ts");
  });

  it("handles several mentions in one message", () => {
    expect(inlineMentionPaths("/review @a.ts and @b.ts", ["src/a.ts", "lib/b.ts"])).toBe(
      "/review src/a.ts and lib/b.ts",
    );
  });

  it("leaves a hand-typed @token that is not a mention alone", () => {
    expect(inlineMentionPaths("/explain @nobody", ["src/Game.ts"])).toBe("/explain @nobody");
  });

  it("does not rewrite a token that merely starts with the label", () => {
    expect(inlineMentionPaths("/explain @Game.tsx", ["src/Game.ts"])).toBe("/explain @Game.tsx");
  });

  it("is a no-op with no mentions", () => {
    expect(inlineMentionPaths("/explain something", [])).toBe("/explain something");
  });
});
