import fs from "node:fs";
import { EMPTY_RULES, parseRulesFile, type Rule } from "../../pi-runtime/extensions/hv-rules";

/**
 * §29 — the default git permission rules, seeded once.
 *
 * Read against the engine as it actually is, their job is narrower and more
 * honest than "we protect you from destructive git": `bash` is not a safe-default
 * tool, so EVERY git command already asks. These exist for the day the user adds
 * `git *` as an allow to kill prompt fatigue — most-restrictive-wins then keeps
 * the destructive verbs asking through it.
 *
 * They are suggestions, not policy: seeded into the ordinary rules file, visible
 * and deletable in the Permissions UI like anything the user wrote. The
 * seed-once flag lives in app config and is what makes a deletion stick — a
 * suggestion that returns after you delete it is policy wearing a hat.
 *
 * Honest limit, recorded because the docs must not overclaim: the engine matches
 * the WHOLE command string, anchored, so `cd x && git push --force` and
 * `git -C repo push -f` slip past the deny. They fall back to ask, so the
 * default fails safe — but this is best-effort steering, never a security
 * boundary. Pinned by tests/git-rules-seed.test.ts.
 *
 * Electron-free so vitest drives it directly; config.ts owns the paths and flag.
 */

export const DEFAULT_GIT_RULES: readonly Rule[] = [
  { layer: "command", pattern: "git push*", action: "ask" },
  { layer: "command", pattern: "git reset --hard*", action: "ask" },
  { layer: "command", pattern: "git checkout -- *", action: "ask" },
  { layer: "command", pattern: "git clean*", action: "ask" },
  { layer: "command", pattern: "git rebase*", action: "ask" },
  { layer: "command", pattern: "git push --force*", action: "deny" },
  // §29 worktrees: `git worktree *` is not destructive to history, but the
  // forced remove deletes a checkout with uncommitted work in it — the same
  // class as `git clean*`, beside which it sits.
  { layer: "command", pattern: "git worktree remove --force*", action: "ask" },
];

/**
 * Append the shipped rules to the rules file. Returns whether it wrote, so the
 * caller knows to persist the flag.
 *
 * `alreadySeeded` is passed in rather than read here: the decision and the write
 * then live in one testable place, and this module stays free of app config.
 */
export function seedDefaultGitRules(rulesPath: string, alreadySeeded: boolean): boolean {
  if (alreadySeeded) return false;

  let rules = EMPTY_RULES;
  try {
    if (fs.existsSync(rulesPath)) rules = parseRulesFile(fs.readFileSync(rulesPath, "utf8"));
  } catch {
    // A hand-edited file that no longer parses must not stop the app from
    // starting; seeding onto empty is better than crashing on launch.
    rules = EMPTY_RULES;
  }

  const have = new Set(rules.global.map((r) => JSON.stringify([r.layer, r.pattern, r.action])));
  const missing = DEFAULT_GIT_RULES.filter(
    (r) => !have.has(JSON.stringify([r.layer, r.pattern, r.action]))
  );

  const next = { ...rules, global: [...rules.global, ...missing] };
  fs.writeFileSync(rulesPath, JSON.stringify(next, null, 2));
  return true;
}
