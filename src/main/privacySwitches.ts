/**
 * Privacy round (2026-10-09) — the ONE list of what HappyVibe sends on its own,
 * each with the config key that stores the user's "off" (absent = on) and the
 * environment variable that forces it off before the first launch.
 *
 * Imports NOTHING: the renderer imports it for the lock state, and a runtime
 * import here puts node:* in the browser bundle (CLAUDE.md "Import hygiene").
 */
export const PRIVACY_SWITCHES = {
  usageStats: { off: "usageStatsOff", env: "HV_NO_USAGE_STATS" },
  crashReports: { off: "crashReportsOff", env: "HV_NO_CRASH_REPORTS" },
  feedback: { off: "feedbackButtonOff", env: "HV_NO_FEEDBACK" },
  sessionPulse: { off: "sessionPulseOff", env: "HV_NO_FEEDBACK" },
  remoteConfig: { off: "remoteConfigOff", env: "HV_NO_REMOTE_CONFIG" },
  updateCheck: { off: "updateCheckOff", env: "HV_NO_UPDATE_CHECK" },
  // Pi's own variable, counted Pi's way (1, true, yes) — that's what turns Pi offline.
  modelList: { off: "modelListOff", env: "PI_OFFLINE" },
  // The user's control lives on Built-in tools (own service, or web tools off).
  defaultWeb: { off: null, env: "HV_NO_DEFAULT_WEB" },
} as const;

export type SwitchKey = keyof typeof PRIVACY_SWITCHES;
export type Env = Record<string, string | undefined>;
export type PrivacyState = { on: Record<SwitchKey, boolean>; locked: SwitchKey[] };

export const SWITCH_KEYS = Object.keys(PRIVACY_SWITCHES) as SwitchKey[];
export const MASTER_ENV = "HV_NO_PHONE_HOME";
/** Pi's REMOTE_CATALOG_REFRESH_INTERVAL_MS in hours; tests/pi-privacy-contract.test.ts pins it. */
export const MODEL_LIST_REFRESH_HOURS = 4;

const piTruthy = (v: string | undefined): boolean => !!v && ["1", "true", "yes"].includes(v.toLowerCase());

export function lockedByEnv(key: SwitchKey, env: Env): boolean {
  if (env[MASTER_ENV] === "1") return true;
  const name = PRIVACY_SWITCHES[key].env;
  return name === "PI_OFFLINE" ? piTruthy(env[name]) : env[name] === "1";
}

export function lockedKeys(env: Env): SwitchKey[] {
  return SWITCH_KEYS.filter((k) => lockedByEnv(k, env));
}
