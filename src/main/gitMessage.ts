import { spawn } from "node:child_process";
import path from "node:path";
import type { GitFileChange } from "./gitParse";
import { PI_CLI_RELPATH, nodeExecPath } from "./pi/spawn";

/**
 * §2b — the commit message, drafted.
 *
 * WHERE it runs matters more than how it reads: never the live chat session. A
 * commit message asked of the open session would land in the transcript AND in
 * the context window, which is the one thing this app exists to keep clean. So
 * this is a one-shot `pi -p --no-session --no-tools --no-extensions` call — the
 * third user of the pattern after `titles.ts` (session titles) and `agentsMd.ts`
 * (AGENTS.md drafts). It borrows Pi's provider/model resolution instead of
 * re-implementing it, leaves no session file behind, and works with no session
 * open at all — which is exactly when you are most likely to be committing.
 *
 * ponytail: the spawn is ~20 lines and deliberately NOT shared with titles.ts —
 * a common abstraction over three callers with different prompts and different
 * result handling would be longer than the duplication it removes.
 */

export interface DraftInput {
  /** The diff being committed — the staged set if staging is in use. */
  diff: string;
  files: GitFileChange[];
  /** Recent subject lines, so the draft matches the repo's existing style. */
  recentSubjects: string[];
}

/** Default budget for the diff we paste in. Roughly 6k tokens of text. */
export const DEFAULT_DIFF_BUDGET = 24_000;

/**
 * Pure: build the prompt. Past the budget the diff degrades to a file list, the
 * per-file stats and the head of each hunk — so a 400-file commit still drafts
 * something honest instead of timing out.
 */
export function buildDraftPrompt(input: DraftInput, budgetChars: number): string {
  const { diff, files, recentSubjects } = input;
  const truncated = diff.length > budgetChars;
  const body = truncated ? summarise(diff, files, budgetChars) : diff;

  const style = recentSubjects.length
    ? `\nThis repository's recent commit subjects — match their style, format and tone:\n${recentSubjects
        .map((s) => `- ${s}`)
        .join("\n")}\n`
    : "";

  return [
    "Write a commit message for the change below.",
    "Reply with ONLY the commit message subject line: one line, imperative mood, no quotes, no trailing period, at most 72 characters.",
    style,
    truncated
      ? "\nThe diff was TRUNCATED because it is large. You are given the changed files, their line counts, and the beginning of each change:\n"
      : "\nThe diff:\n",
    body,
  ].join("\n");
}

function summarise(diff: string, files: GitFileChange[], budgetChars: number): string {
  const list = files
    .map((f) => `${f.status.padEnd(9)} ${f.path} (+${f.additions} -${f.deletions})`)
    .join("\n");

  // Head of each hunk: enough to see what KIND of change this is, without the bulk.
  const heads: string[] = [];
  let current = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("@@")) {
      current = 0;
      heads.push(line);
      continue;
    }
    if (current < 4 && (line.startsWith("+") || line.startsWith("-"))) {
      heads.push(line);
      current++;
    }
  }

  const remaining = Math.max(0, budgetChars - list.length - 200);
  return `${list}\n\n${heads.join("\n").slice(0, remaining)}`;
}

/**
 * Fire-and-forget: resolves null on ANY failure (no provider, no key, non-zero
 * exit, junk output). The caller hides the button rather than showing an error —
 * the same rule the title generator follows, which never blocks the chat.
 */
export function draftCommitMessage(
  runtimeDir: string,
  workspace: string,
  input: DraftInput,
  model: { provider: string; modelId: string },
  env: Record<string, string> = {},
  budgetChars: number = DEFAULT_DIFF_BUDGET
): Promise<string | null> {
  const prompt = buildDraftPrompt(input, budgetChars);
  return new Promise((resolve) => {
    const child = spawn(
      nodeExecPath(),
      [
        path.join(runtimeDir, PI_CLI_RELPATH),
        "-p", "--no-session", "--no-tools", "--no-extensions",
        "--provider", model.provider,
        "--model", model.modelId,
        prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
        // README gotcha: a one-shot Pi call hangs unless stdin is closed.
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      resolve(cleanSubject(out));
    });
  });
}

/** Take the last non-empty line and strip the decoration models like to add. */
export function cleanSubject(raw: string): string | null {
  const line = raw
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const cleaned = line
    .replace(/^```\w*\s*|\s*```$/g, "")
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    .trim();
  return cleaned && cleaned.length <= 100 ? cleaned : null;
}

// ── §29 §7: the pull request, drafted ───────────────────────────────────────

export interface PrDraftInput {
  /** Subjects of the commits this branch adds over the base, newest first. */
  commits: string[];
  /** The branch's diff against the merge-base, truncated by the caller's budget. */
  diff: string;
  branch: string;
  base: string;
}

export interface PrDraft {
  title: string;
  body: string;
}

/** Pure: the prompt. A PR wants a headline AND prose, unlike a commit subject. */
export function buildPrPrompt(input: PrDraftInput, budgetChars: number): string {
  const { commits, branch, base } = input;
  const truncated = input.diff.length > budgetChars;
  const diff = truncated ? input.diff.slice(0, budgetChars) : input.diff;
  return [
    `Write a pull request for the branch "${branch}", to be merged into "${base}".`,
    "",
    "Reply in exactly this shape:",
    "  - the FIRST line is the title: one line, under 72 characters, no prefix like 'Title:'",
    "  - then a blank line",
    "  - then the description in markdown: what changed and why, a short bullet list where it helps.",
    "Do not wrap the answer in code fences. Do not invent changes that are not in the diff.",
    "",
    commits.length ? `Commits on this branch:\n${commits.map((c) => `- ${c}`).join("\n")}` : "",
    "",
    truncated ? "The diff below is TRUNCATED because it is large:" : "The diff:",
    diff,
  ].join("\n");
}

/**
 * Draft a PR title and body. Same one-shot `pi -p` path as the commit message —
 * no session, no transcript, no context-window cost.
 *
 * Resolves null on ANY failure. The caller falls back to the commit list, so a
 * missing provider costs the user nothing but nicer prose.
 */
export function draftPullRequest(
  runtimeDir: string,
  workspace: string,
  input: PrDraftInput,
  model: { provider: string; modelId: string },
  env: Record<string, string> = {},
  budgetChars: number = DEFAULT_DIFF_BUDGET
): Promise<PrDraft | null> {
  const prompt = buildPrPrompt(input, budgetChars);
  return new Promise((resolve) => {
    const child = spawn(
      nodeExecPath(),
      [
        path.join(runtimeDir, PI_CLI_RELPATH),
        "-p", "--no-session", "--no-tools", "--no-extensions",
        "--provider", model.provider,
        "--model", model.modelId,
        prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 90_000,
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code === 0 ? splitPrDraft(out) : null));
  });
}

/**
 * First non-empty line is the title, the rest is the body.
 *
 * Models like to fence the whole answer or label the title; both are stripped,
 * because the alternative is a PR whose title is literally "Title: ...".
 */
export function splitPrDraft(raw: string): PrDraft | null {
  const text = raw.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  if (!text) return null;
  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim().length > 0);
  if (titleIdx === -1) return null;
  const title = lines[titleIdx]
    .replace(/^\s*#+\s*/, "")
    .replace(/^\s*(title|pr title)\s*:\s*/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  if (!title) return null;
  const body = lines.slice(titleIdx + 1).join("\n").replace(/^\s*\n/, "").trimEnd();
  return { title: title.slice(0, 120), body };
}
