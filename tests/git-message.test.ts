import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDraftPrompt, buildPrPrompt, draftCommitMessage, draftPullRequest, splitPrDraft } from "../src/main/gitMessage";
import type { GitFileChange } from "../src/main/gitParse";

/**
 * §2b — "Write it for me". The prompt builder is pure and fully unit-tested; the
 * spawn half is the proven `titles.ts` pattern, exercised live at the bottom of
 * this file when a DeepSeek key is present (the same skipIf gate the rest of the
 * live suite uses).
 */

// Same inline .env reader the other live tests use: only fills what is UNSET, so
// a shell value (npm test's sk-REPLACE) always wins and the live arm self-skips.
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const RAW_KEY = process.env.DEEPSEEK_API_KEY;
const KEY = RAW_KEY && !RAW_KEY.startsWith("sk-REPLACE") ? RAW_KEY : undefined;

const FILES: GitFileChange[] = [
  { path: "src/auth.ts", status: "modified", staged: false, additions: 12, deletions: 3 },
  { path: "src/login.ts", status: "added", staged: false, additions: 40, deletions: 0 },
];

const DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,4 @@ export function authenticate() {
   const token = readToken();
-  return fetch(url, { headers: { token } });
+  return retry(() => fetch(url, { headers: { token } }), 3);
 }
`;

describe("buildDraftPrompt", () => {
  it("hands over the whole diff when it fits the budget", () => {
    const p = buildDraftPrompt({ diff: DIFF, files: FILES, recentSubjects: [] }, 10_000);
    expect(p).toContain("+  return retry(");
    expect(p).not.toMatch(/truncat/i);
  });

  it("teaches the repo's own style from recent subjects", () => {
    const p = buildDraftPrompt(
      { diff: DIFF, files: FILES, recentSubjects: ["fix(auth): stop the retry loop", "feat(ui): add a badge"] },
      10_000
    );
    expect(p).toContain("fix(auth): stop the retry loop");
    expect(p).toContain("feat(ui): add a badge");
  });

  it("says nothing about style when the repo has no history to copy", () => {
    const p = buildDraftPrompt({ diff: DIFF, files: FILES, recentSubjects: [] }, 10_000);
    expect(p).not.toMatch(/recent commit/i);
  });

  it("degrades to a file summary past the budget, and SAYS it was truncated", () => {
    const huge = `${DIFF}\n${"+padding line\n".repeat(5_000)}`;
    const p = buildDraftPrompt({ diff: huge, files: FILES, recentSubjects: [] }, 500);

    // A 400-file commit still drafts something honest instead of timing out.
    expect(p).toMatch(/truncat/i);
    expect(p).toContain("src/auth.ts");
    expect(p).toContain("src/login.ts");
    expect(p).toContain("+12"); // per-file stats survive
    expect(p).toContain("-3");
    expect(p.length).toBeLessThan(huge.length);
    // The padding is what got dropped; the head of the real hunk is kept.
    expect(p).not.toContain("+padding line\n+padding line\n+padding line\n+padding line");
  });

  it("keeps the head of each hunk when truncating, so the draft has something real to read", () => {
    const p = buildDraftPrompt({ diff: `${DIFF}${"+x\n".repeat(4_000)}`, files: FILES, recentSubjects: [] }, 800);
    expect(p).toContain("@@");
  });

  it("asks for one subject line and nothing else", () => {
    const p = buildDraftPrompt({ diff: DIFF, files: FILES, recentSubjects: [] }, 10_000);
    expect(p).toMatch(/only the commit message/i);
  });
});

describe.skipIf(!KEY)("draftCommitMessage (live DeepSeek flash)", () => {
  it("drafts a one-line message from a real diff", async () => {
    const runtimeDir = path.join(__dirname, "..", "pi-runtime");
    const msg = await draftCommitMessage(
      runtimeDir,
      process.cwd(),
      { diff: DIFF, files: FILES, recentSubjects: ["fix(auth): stop the retry loop", "feat(ui): add a badge"] },
      { provider: "deepseek", modelId: "deepseek-v4-flash" },
      { DEEPSEEK_API_KEY: KEY! }
    );

    expect(msg, "a configured provider must produce a draft").toBeTruthy();
    expect(msg!.includes("\n")).toBe(false); // one subject line, never a body
    expect(msg!.length).toBeLessThanOrEqual(100);
    // It read the diff rather than echoing the instructions.
    expect(msg!.toLowerCase()).toMatch(/retry|auth|fetch|token/);
    // eslint-disable-next-line no-console
    console.log(`[live draft] ${msg}`);
  }, 90_000);

  it("resolves null rather than throwing when the provider is unusable", async () => {
    const runtimeDir = path.join(__dirname, "..", "pi-runtime");
    const msg = await draftCommitMessage(
      runtimeDir,
      process.cwd(),
      { diff: DIFF, files: FILES, recentSubjects: [] },
      { provider: "deepseek", modelId: "no-such-model-at-all" },
      { DEEPSEEK_API_KEY: "sk-definitely-invalid" }
    );
    // Quiet failure is the contract: the button is simply absent, never an error
    // surface, and never a blocked commit.
    expect(msg).toBeNull();
  }, 90_000);
});

describe("buildPrPrompt", () => {
  const input = { commits: ["feat: a", "fix: b"], diff: DIFF, branch: "feature/x", base: "main" };

  it("names both branches and lists the commits", () => {
    const p = buildPrPrompt(input, 10_000);
    expect(p).toContain('"feature/x"');
    expect(p).toContain('"main"');
    expect(p).toContain("- feat: a");
    expect(p).toContain("- fix: b");
  });

  it("asks for a title line then a description, and forbids fences", () => {
    const p = buildPrPrompt(input, 10_000);
    expect(p).toMatch(/FIRST line is the title/);
    expect(p).toMatch(/code fences/i);
  });

  it("says so when the diff is truncated", () => {
    const p = buildPrPrompt({ ...input, diff: "x".repeat(5_000) }, 500);
    expect(p).toMatch(/TRUNCATED/);
    expect(p.length).toBeLessThan(2_000);
  });

  it("copes with a branch that adds no commits", () => {
    expect(() => buildPrPrompt({ ...input, commits: [] }, 10_000)).not.toThrow();
  });
});

describe("splitPrDraft", () => {
  it("takes the first line as the title and the rest as the body", () => {
    expect(splitPrDraft("Add the git panel\n\nIt does things.\n- one\n- two")).toEqual({
      title: "Add the git panel",
      body: "It does things.\n- one\n- two",
    });
  });

  it("strips a code fence wrapping the whole answer", () => {
    expect(splitPrDraft("```markdown\nA title\n\nA body\n```")).toEqual({ title: "A title", body: "A body" });
  });

  it("strips a leading heading marker and a Title: label", () => {
    // Otherwise the PR is literally titled "Title: ...".
    expect(splitPrDraft("# A title\n\nbody")!.title).toBe("A title");
    expect(splitPrDraft("Title: A title\n\nbody")!.title).toBe("A title");
  });

  it("survives a title with no body at all", () => {
    expect(splitPrDraft("Just a title")).toEqual({ title: "Just a title", body: "" });
  });

  it("returns null for empty or whitespace output", () => {
    expect(splitPrDraft("")).toBeNull();
    expect(splitPrDraft("   \n\n  ")).toBeNull();
  });

  it("caps a runaway title", () => {
    expect(splitPrDraft(`${"x".repeat(400)}\n\nbody`)!.title.length).toBeLessThanOrEqual(120);
  });
});

describe.skipIf(!KEY)("draftPullRequest (live DeepSeek flash)", () => {
  it("drafts a title and a description from a real diff", async () => {
    const runtimeDir = path.join(__dirname, "..", "pi-runtime");
    const draft = await draftPullRequest(
      runtimeDir,
      process.cwd(),
      { commits: ["fix(auth): stop the retry loop"], diff: DIFF, branch: "fix/retry", base: "main" },
      { provider: "deepseek", modelId: "deepseek-v4-flash" },
      { DEEPSEEK_API_KEY: KEY! }
    );
    expect(draft, "a configured provider must produce a draft").toBeTruthy();
    expect(draft!.title.includes("\n")).toBe(false);
    expect(draft!.title.length).toBeGreaterThan(3);
    expect(draft!.title.length).toBeLessThanOrEqual(120);
    // It read the diff rather than echoing the instructions back.
    expect(`${draft!.title} ${draft!.body}`.toLowerCase()).toMatch(/retry|auth|fetch|token/);
    // eslint-disable-next-line no-console
    console.log(`[live PR draft] ${draft!.title}\n${draft!.body.slice(0, 200)}`);
  }, 120_000);

  it("resolves null rather than throwing when the model is unusable", async () => {
    const runtimeDir = path.join(__dirname, "..", "pi-runtime");
    const draft = await draftPullRequest(
      runtimeDir,
      process.cwd(),
      { commits: [], diff: DIFF, branch: "x", base: "main" },
      { provider: "deepseek", modelId: "no-such-model-at-all" },
      { DEEPSEEK_API_KEY: "sk-definitely-invalid" }
    );
    expect(draft).toBeNull();
  }, 90_000);
});
