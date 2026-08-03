import path from "node:path";

/**
 * §24 × F3 — how `@file` mentions compose with slash commands. PURE.
 *
 * THE PROBLEM. Main appends hidden `<file path="…">…</file>` blocks to the
 * OUTGOING message for every `@mention` (ipc.ts, buildMentionBlocks). Pi expands
 * prompt templates AFTER that, and `expandPromptTemplate`'s argument capture is
 * `([\s\S]*)` — everything after the command name. So `/explain @Game.ts` became
 * `/explain @Game.ts\n\n<file …>…</file>`, and `${ARGUMENTS}` swallowed the whole
 * file into the expanded prompt. Measured consequences, all three observed:
 *   - the prompt carried the file inline, markdown-mangled,
 *   - the template's own "if it is a path, read the whole file" then fired, so
 *     the model read the same file AGAIN (paying for it twice),
 *   - and the card's title was a wall of source.
 *
 * THE FIX (decided 2026-08-03). For a message that will expand, do not inject
 * the blocks at all — rewrite each `@label` to the file's WORKSPACE-RELATIVE
 * PATH instead. `/explain @Game.ts` goes to Pi as `/explain src/Game.ts`, so
 * `${ARGUMENTS}` is a real path and the template's read instruction lands on
 * something the model can actually open. One read, no duplicated bytes.
 *
 * Ordinary (non-command) messages are untouched — they keep the inline blocks,
 * which is what makes `@file` feel like an attachment everywhere else.
 */

/** The label the composer wrote for a mention: its basename, or the full relative
 *  path when two mentions share a basename (renderer's `mentionLabel`). */
function labelsFor(rel: string): string[] {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  // Full path first: when it IS the label, the basename would match a prefix of
  // it and rewrite the wrong span.
  return rel === base ? [rel] : [rel, base];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `/explain @Game.ts` → `/explain src/Game.ts`. Only tokens that correspond to a
 * real mention are rewritten; a bare `@something` the user typed by hand is left
 * alone, because it was never a file reference.
 */
export function inlineMentionPaths(msg: string, mentions: string[]): string {
  let out = msg;
  for (const rel of mentions) {
    for (const label of labelsFor(rel)) {
      const re = new RegExp(`(^|\\s)@${escapeRe(label)}(?=\\s|$)`, "g");
      if (!re.test(out)) continue;
      out = out.replace(new RegExp(`(^|\\s)@${escapeRe(label)}(?=\\s|$)`, "g"), `$1${rel}`);
      break; // one label form per mention
    }
  }
  return out;
}

/**
 * Will Pi expand this message as a prompt template?
 *
 * Mirrors `expandPromptTemplate` (core/prompt-templates.js): a leading `/`, then
 * the command name up to the first whitespace. `commandFiles` are the absolute
 * `--prompt-template` paths this session spawned with, so the check is against
 * what Pi ACTUALLY loaded rather than everything on disk — an approved-but-
 * inactive command must not change how a message is assembled.
 *
 * Extension commands (`/hv-*`) are deliberately NOT matched: Pi handles those
 * before expansion and they never see arguments, so their mentions should keep
 * behaving like any other message's.
 */
export function willExpand(msg: string, commandFiles: string[]): boolean {
  const m = /^\/([^\s]+)/.exec(msg);
  if (!m) return false;
  const name = m[1];
  return commandFiles.some((f) => path.basename(f, ".md") === name);
}
