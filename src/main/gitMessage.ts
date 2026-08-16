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
