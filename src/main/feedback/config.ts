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
export type FeedbackChannel = "dev" | "prod";

export interface FeedbackConfig {
  channel: FeedbackChannel;
  baseUrl: string;
  publishableKey: string;
  databases: { general: string; session: string };
  /** §37: the crash database for this channel. Same `ipk_` key as feedback. */
  crashDatabase: string;
}

export const FEEDBACK_CHANNELS = {
  dev: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: "ipk_MMpg82eVQNJo9NIiEfyzEODvhPa-Ho9n" as string | null,
    databases: { general: "fdb_h2ntrck1mywr", session: "fdb_384szrcgeb7n" },
    crashDatabase: "cdb_aamshzzkjx9c",
  },
  prod: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: "ipk_mF6m0qBQWvn0uFOZg7CKv9f_HOagaTIN" as string | null,
    databases: { general: "fdb_yfre0219xr82", session: "fdb_hnbkxr94p5cd" },
    crashDatabase: "cdb_64m8jfkbxw2y",
  },
} as const satisfies Record<
  FeedbackChannel,
  {
    baseUrl: string;
    publishableKey: string | null;
    databases: { general: string; session: string };
    crashDatabase: string;
  }
>;

export function resolveFeedbackConfig(
  env: Record<string, string | undefined>,
  isDev: boolean,
): FeedbackConfig | null {
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
