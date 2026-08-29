/**
 * The shape of `<agentDir>/settings.json` that keeps the builtins HappyVibe does
 * not offer out of upstream's own roster — PURE, so vitest can exercise it.
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
import { EXTERNAL_CLI_AGENTS, UNSUPPORTED_BUILTIN_AGENTS } from "../../pi-runtime/extensions/hv-rules";

/** The settings.json key pi-subagents reads builtin overrides from. */
const OVERRIDES_KEY = "agentOverrides";

/**
 * Return `settings` with every builtin in DISABLED_BUILTIN_AGENTS marked disabled.
 *
 * That is a UNION of two sets with different reasons (hv-rules.ts): the six
 * external-CLI runners, which the bridge also refuses because nothing can bound
 * them; and the unsupported ones (`researcher`, `oracle`), which are ordinary Pi
 * children that simply cannot do their job here. Disabling removes them from
 * upstream's resolved set, so a delegation cannot find them — which is what makes
 * "hidden" mean uninvokable rather than merely unlisted, and is also why the
 * Agents page and the injected roster need no filter of their own
 * (`enumerateAgents` already skips `disabled`).
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
/**
 * Which agents end up disabled, given the user's explicit choices.
 *
 * `agentsEnabled` is SPARSE — it holds only names the user actually toggled, so
 * resolution is `userChoice ?? default`, the same shape skills use
 * (`activation?.[skill.id] ?? true`, skills/registry.ts). Seeding it with today's
 * defaults would freeze this round's judgement about `researcher` forever;
 * leaving it sparse means a later change to UNSUPPORTED_BUILTIN_AGENTS still
 * reaches everyone who never expressed an opinion.
 *
 * EXTERNAL_CLI_AGENTS is applied LAST and unconditionally. It is a boundary
 * guarantee, not a preference — a hand-edited config must not re-open it, which
 * is why main resolves this rather than trusting whatever the renderer sends.
 */
export function resolveDisabledAgents(agentsEnabled: Record<string, boolean> = {}): Set<string> {
  const out = new Set<string>();
  for (const [name, enabled] of Object.entries(agentsEnabled)) {
    if (!enabled) out.add(name);
  }
  // Both forced sets are applied LAST and unconditionally, so a hand-edited
  // config cannot re-open either. They are also never LISTED (the bridge drops
  // them), which is what keeps the page's switches to agents that actually work.
  for (const name of UNSUPPORTED_BUILTIN_AGENTS) out.add(name);
  for (const name of EXTERNAL_CLI_AGENTS) out.add(name);
  return out;
}

export function disabledAgentOverrides(
  settings: Record<string, unknown>,
  agentsEnabled: Record<string, boolean> = {},
): Record<string, unknown> {
  const out = { ...settings };
  const subagents = { ...((out.subagents as Record<string, unknown> | undefined) ?? {}) };
  const overrides = { ...((subagents[OVERRIDES_KEY] as Record<string, unknown> | undefined) ?? {}) };
  const disabled = resolveDisabledAgents(agentsEnabled);
  // Every name we have an opinion about gets an EXPLICIT boolean. Omitting the
  // key for a re-enabled agent would leave the `disabled: true` a previous run
  // already wrote on disk, so the toggle would appear to do nothing.
  for (const name of new Set([...disabled, ...Object.keys(agentsEnabled)])) {
    const existing = (overrides[name] as Record<string, unknown> | undefined) ?? {};
    overrides[name] = { ...existing, disabled: disabled.has(name) };
  }
  subagents[OVERRIDES_KEY] = overrides;
  out.subagents = subagents;
  return out;
}
