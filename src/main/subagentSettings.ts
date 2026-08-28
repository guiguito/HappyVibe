/**
 * The shape of `<agentDir>/settings.json` that keeps upstream's external-CLI
 * agents out of the injected roster — PURE, so vitest can exercise it.
 *
 * PRD §12 (2026-08-28): pi-subagents 0.58 ships 13 builtin agents, six of them
 * `runner: external-cli`. `EXTERNAL_CLI_AGENTS` in hv-rules.ts, checked by the
 * bridge, is the ENFORCEMENT — it has to be, because a PROJECT-scope
 * `.pi/settings.json` override beats this user-scope file outright (pi-subagents'
 * agents.ts returns on the project override before it ever reads the user one),
 * so a cloned repo could re-enable one. This module is HYGIENE: with the six
 * disabled here the model is never told they exist, so it cannot spend a turn
 * proposing one and being refused.
 *
 * Split out of config.ts rather than written inline there because config.ts
 * imports electron's `app` for `agentDir()`, so vitest cannot import it — the
 * same division of labour as spawn.ts and the pure hv-*.ts modules.
 */
import { EXTERNAL_CLI_AGENTS } from "../../pi-runtime/extensions/hv-rules";

/** The settings.json key pi-subagents reads builtin overrides from. */
const OVERRIDES_KEY = "agentOverrides";

/**
 * Return `settings` with every external-CLI builtin marked disabled.
 *
 * MERGES at three levels and every one of them matters:
 *  - top level, because `<agentDir>/settings.json` is PI's file (models, theme,
 *    providers). HappyVibe is merely the first thing in the app to write it, and
 *    replacing it would silently discard whatever Pi or the user put there;
 *  - the `subagents` object, so a user's `defaultThinking`/`modelScope` survives;
 *  - each agent entry, so `{model: …}` a user set on one of the six is kept
 *    beside `disabled: true` rather than replaced by it.
 *
 * Idempotent: running it over its own output changes nothing.
 *
 * The key is `agentOverrides`, NOT `overrides`. pi-subagents parses
 * `settings.subagents.agentOverrides` INTO an internal field it calls
 * `overrides`, so writing `overrides` here parses to nothing and does nothing —
 * a silent no-op with no symptom anywhere.
 *
 * Deliberately not `disableBuiltins: true`, which is all-or-nothing and would
 * also remove `worker` and `reviewer` — the two native builtins the next round
 * wants to adopt.
 */
export function externalAgentOverrides(settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  const subagents = { ...((out.subagents as Record<string, unknown> | undefined) ?? {}) };
  const overrides = { ...((subagents[OVERRIDES_KEY] as Record<string, unknown> | undefined) ?? {}) };
  for (const name of EXTERNAL_CLI_AGENTS) {
    const existing = (overrides[name] as Record<string, unknown> | undefined) ?? {};
    overrides[name] = { ...existing, disabled: true };
  }
  subagents[OVERRIDES_KEY] = overrides;
  out.subagents = subagents;
  return out;
}
