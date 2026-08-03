/**
 * §25 ingestion screening — PURE, electron-free, vitest-importable.
 *
 * Runs PER FILE at ingestion, not per repo by hand: the original survey sampled
 * only 1–2 SKILL.md per repo, and the failure mode it was looking for is
 * SILENT. Every hardcoded-path call is typically `2>/dev/null || true`, so the
 * user gets confident prose with the machinery quietly dead.
 *
 * Pi sets NO skill-path environment variable at all — no SKILL_DIR, no
 * CLAUDE_PLUGIN_ROOT — so this is an install-time screen or nothing.
 */

export interface ScreenResult {
  verdict: "ok" | "reject" | "warn";
  reason?: string;
}

/**
 * `~/.claude/skills/...`, or any absolute path through a `.claude/skills` dir.
 * Unrepairable: it points into another tool's tree, which we neither own nor
 * populate.
 */
const CLAUDE_SKILLS = /\.claude\/skills\//;

/**
 * A bare `$SKILL_DIR` / `${SKILL_DIR}`. Deliberately does NOT match
 * `${CLAUDE_PLUGIN_ROOT}`, which we repair instead of rejecting.
 */
const SKILL_DIR = /\$\{SKILL_DIR\}|\$SKILL_DIR\b/;

/** Both spellings of the plugin-root variable Claude Code sets and Pi does not. */
const PLUGIN_ROOT = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g;

/** Screen one skill file's text. Hard reject wins over warn. */
export function screenSkillText(text: string): ScreenResult {
  if (CLAUDE_SKILLS.test(text)) {
    return {
      verdict: "reject",
      reason: "hardcodes a ~/.claude/skills path, which cannot work here and fails silently",
    };
  }
  if (SKILL_DIR.test(text)) {
    return {
      verdict: "warn",
      reason:
        "uses $SKILL_DIR, which Pi does not set — the agent can usually resolve it from context, so this degrades rather than breaks",
    };
  }
  return { verdict: "ok" };
}

/**
 * Rewrite `${CLAUDE_PLUGIN_ROOT}` to the directory the skill was installed into.
 *
 * Sound because import copies the skill dir to a path HappyVibe chose and hashes
 * it AFTER the copy, so the substitution lands inside the content the user then
 * reviews and approves. It is disclosed on the row precisely because we are
 * rewriting third-party text.
 */
export function substitutePluginRoot(text: string, root: string): string {
  return text.replace(PLUGIN_ROOT, root);
}

/** How many plugin-root refs a file carries — the number the disclosure shows. */
export function countPluginRootRefs(text: string): number {
  return text.match(PLUGIN_ROOT)?.length ?? 0;
}
