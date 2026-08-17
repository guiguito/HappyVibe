/**
 * The one place the live-Pi tests decide WHICH model they talk to.
 *
 * Sixteen live files used to carry a byte-identical copy of "load .env, read
 * DEEPSEEK_API_KEY, treat sk-REPLACE as absent", plus their own hardcoded
 * `{provider:"deepseek", modelId:"deepseek-v4-flash"}`. That worked until the
 * DeepSeek account ran out of balance, at which point every one of them failed in
 * a way that looked exactly like a real regression (see docs/validation/d1.md
 * §pi-subagents 0.50 — four shape assertions "failed" against a 402).
 *
 * Provider resolution, first match wins:
 *
 *   1. OPENROUTER_API_KEY → `openrouter` / `deepseek/deepseek-v4-flash`
 *      (OpenRouter's floating alias for the latest v4-flash; the dated snapshot is
 *      `-0731`. ~$0.08/M in, $0.17/M out, so a full serial batch costs pennies.)
 *   2. DEEPSEEK_API_KEY → `deepseek` / `deepseek-v4-flash`  (first-party, unchanged)
 *   3. neither → `KEY` is undefined and every `skipIf(!KEY)` skips, as before.
 *
 * OpenRouter is preferred when both are present: it is the one that can be topped
 * up without touching provider accounts, and it keeps working when a first-party
 * balance lapses.
 *
 * A key of `sk-REPLACE…` counts as ABSENT for either provider. That is the
 * mechanism `npm test` uses to force the whole live batch to skip, so the non-live
 * suite must neutralise BOTH vars — see the `test` script in package.json. Get that
 * wrong and `npm test` silently becomes a six-minute run that spends money.
 */
import fs from "node:fs";

// Same inline loader the live files used: fill only what is UNSET, so a shell
// value (notably the sk-REPLACE sentinel) always wins over .env.
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const usable = (v: string | undefined): string | undefined =>
  v && v.trim() && !v.startsWith("sk-REPLACE") ? v : undefined;

export interface LiveModel {
  /** The API key itself. */
  key: string;
  /** Pi provider id, for `model.provider`. */
  provider: "openrouter" | "deepseek";
  /** Pi model id, for `model.modelId`. */
  modelId: string;
  /** Env to inject on spawn — the provider's own var, and only that one. */
  env: Record<string, string>;
  /** Human label for skip messages and logs. */
  label: string;
}

function resolve(): LiveModel | undefined {
  const or = usable(process.env.OPENROUTER_API_KEY);
  if (or) {
    return {
      key: or,
      provider: "openrouter",
      modelId: "deepseek/deepseek-v4-flash",
      env: { OPENROUTER_API_KEY: or },
      label: "OpenRouter deepseek/deepseek-v4-flash",
    };
  }
  const ds = usable(process.env.DEEPSEEK_API_KEY);
  if (ds) {
    return {
      key: ds,
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      env: { DEEPSEEK_API_KEY: ds },
      label: "DeepSeek deepseek-v4-flash",
    };
  }
  return undefined;
}

export const LIVE = resolve();

/** The live gate every live test spells `skipIf(!KEY)`. Undefined ⇒ skip. */
export const KEY = LIVE?.key;

/** `model` for resolvePiSpawn. Falls back to the DeepSeek shape so a skipped test
 *  can still construct a spec without a branch at every call site. */
export const MODEL: { provider: string; modelId: string } = {
  provider: LIVE?.provider ?? "deepseek",
  modelId: LIVE?.modelId ?? "deepseek-v4-flash",
};

/** `providerEnv` for resolvePiSpawn (empty when skipping). */
export const PROVIDER_ENV: Record<string, string> = LIVE?.env ?? {};
