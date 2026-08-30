/**
 * §16 round 16 — the thinking level, resolved in one place.
 *
 * Two tiers, not the model's three: session override → global default. A
 * workspace tier would be a third place to look for a setting whose entire
 * problem was being in none of them.
 *
 * This exists because the app never touched Pi's thinking level, which sounds
 * neutral and is not: Pi's own settings.json in the app's agent dir carried
 * `defaultThinkingLevel: "high"` that nothing in src/ ever wrote, so every
 * session ran at high thinking, chosen by nobody, invisible, and billed.
 * Passing --thinking unconditionally is what stops that file being read at all.
 *
 * Electron-free on purpose, like spawn.ts, so vitest can import it.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const known = (l: unknown): ThinkingLevel | null =>
  typeof l === "string" && (THINKING_LEVELS as readonly string[]).includes(l) ? (l as ThinkingLevel) : null;

/**
 * `null` means "nothing resolved" and the caller emits NO flag — Pi's own
 * precedence then applies, which is the only honest fallback. Never a guessed
 * default, the rule §16 finding 7 settled for the model.
 *
 * An unrecognised stored value is dropped rather than forwarded: config.json is
 * hand-editable and `--thinking` rejects an invalid level by exiting, which
 * would make a typo unrecoverable from the UI.
 */
export function resolveThinking(
  session: ThinkingLevel | null | undefined,
  global: ThinkingLevel | null | undefined,
): ThinkingLevel | null {
  return known(session) ?? known(global);
}
