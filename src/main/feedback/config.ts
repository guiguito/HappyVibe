/**
 * §34 — which Inlet project the app talks to, per channel.
 *
 * PUBLISHABLE keys only (`ipk_`): Inlet's contract is that they are safe in a
 * client — they can read a form, open an intent, upload and submit, and cannot
 * read a single response. The SERVER keys (`isk_`) stay in `.env` for the MCP
 * reading side and the live test's cleanup; `tests/feedback-secrets.test.ts`
 * fails if one ever lands here, and `resolveFeedbackConfig` refuses one by
 * SHAPE as well, so a mis-set env var cannot turn the app into an admin.
 *
 * Both channels have their key as of 2026-09-10; prod's had to be minted by a
 * signed-in admin in Inlet's web UI, because `/v1/projects/{id}/credentials`
 * answers `insufficient_scope` to an API key. Measured for the prod key on the
 * day it landed: it reads both prod forms, is refused on a DEV database
 * (`feedback_database_inaccessible`) and is refused on submissions
 * (`insufficient_scope`) — which is the whole reason it may be committed.
 *
 * A null key is still meaningful and still handled: it resolves to null here,
 * and null is what hides the icon and the pulse — "don't show what cannot
 * work" (§20) — so a future channel with no key degrades rather than failing.
 *
 * Electron-free on purpose — vitest imports it directly, and `is.dev` is passed
 * in rather than read, so both channels are testable in one process.
 */
import { MASTER_ENV } from "../privacySwitches";
export type FeedbackChannel = "dev" | "prod";

export interface FeedbackConfig {
  channel: FeedbackChannel;
  baseUrl: string;
  publishableKey: string;
  databases: { general: string; session: string };
  /** §37: the crash database for this channel. Same `ipk_` key as feedback. */
  crashDatabase: string;
  /** §39: usage statistics and remote config, same `ipk_` key. */
  analyticsDatabase: string;
  configDatabase: string;
}

export const FEEDBACK_CHANNELS = {
  dev: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: "ipk_24t5FAKO80XhC2jJZr3xrLcqITJhyxW0" as string | null,
    databases: { general: "fdb_fhkd99m59f7a", session: "fdb_9jc4be9npr1g" },
    crashDatabase: "cdb_vhqmcqmwq2dz",
    analyticsDatabase: "adb_nf15qfg0crx6",
    configDatabase: "cfg_gsd6fxwmwdmj",
  },
  prod: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: "ipk_6AGD12cyhTC37jfZikScNC9ktaFVpP5j" as string | null,
    databases: { general: "fdb_gk46pdxj0d7b", session: "fdb_ma2pqzg46cj5" },
    crashDatabase: "cdb_x1rta1zm9hta",
    analyticsDatabase: "adb_k9hj2jq82zyv",
    configDatabase: "cfg_s4zxy72egxf5",
  },
} as const satisfies Record<
  FeedbackChannel,
  {
    baseUrl: string;
    publishableKey: string | null;
    databases: { general: string; session: string };
    crashDatabase: string;
    analyticsDatabase: string;
    configDatabase: string;
  }
>;

export function resolveFeedbackConfig(
  env: Record<string, string | undefined>,
  isDev: boolean,
): FeedbackConfig | null {
  // HV_NO_PHONE_HOME=1: the machine's owner wants nothing sent to Inlet. Null is
  // the keyless path above, so feedback, crash, usage and remote config all stay off.
  if (env[MASTER_ENV] === "1") return null;
  const forced = env.HV_FEEDBACK_CHANNEL;
  const channel: FeedbackChannel = forced === "dev" || forced === "prod" ? forced : isDev ? "dev" : "prod";
  const base = FEEDBACK_CHANNELS[channel];
  const key = env.HV_FEEDBACK_PUBLISHABLE_KEY ?? base.publishableKey;
  if (!key || !key.startsWith("ipk_")) return null;
  return {
    channel,
    baseUrl: env.HV_FEEDBACK_BASE_URL ?? base.baseUrl,
    publishableKey: key,
    databases: {
      general: env.HV_FEEDBACK_DB_GENERAL ?? base.databases.general,
      session: env.HV_FEEDBACK_DB_SESSION ?? base.databases.session,
    },
    crashDatabase: env.HV_CRASH_DB ?? base.crashDatabase,
    analyticsDatabase: env.HV_ANALYTICS_DB ?? base.analyticsDatabase,
    configDatabase: env.HV_CONFIG_DB ?? base.configDatabase,
  };
}

/**
 * §34: the pulse's 20-second arm.
 *
 * An env flag, never `import.meta.env.DEV`. Under dev mode every development
 * session would show the pulse after its first turn, and every tap is a REAL
 * row in the Dev database — daily development would drown the signal it exists
 * to collect. Development behaves like production unless you are testing the
 * pulse; the GUI pass sets the flag.
 */
export function fastPulse(env: Record<string, string | undefined>): boolean {
  return env.HV_FEEDBACK_FAST_PULSE === "1";
}
