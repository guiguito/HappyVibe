/**
 * §39 — the Electron half of remote config. Never imported by `ipc.ts`
 * (vitest's `electron` stub takes the whole test file down otherwise).
 * One client for the app; windows reach it over `inlet:config` through the
 * preload's `inletConfig` bridge and hold no key.
 */
import { is } from "@electron-toolkit/utils";
import { installElectronMain } from "inlet-sdk/config/electron";
import { resolveFeedbackConfig } from "../feedback/config";
import { CONFIG_DEFAULTS } from "./defaults";
import { setConfigReader } from "./client";

export async function installRemoteConfig(): Promise<void> {
  const cfg = resolveFeedbackConfig(process.env, is.dev);
  if (!cfg) return; // no key for this channel: the defaults answer (§20)
  try {
    const client = await installElectronMain({
      baseUrl: cfg.baseUrl,
      publishableKey: cfg.publishableKey,
      databaseId: cfg.configDatabase,
      defaults: CONFIG_DEFAULTS,
      // A window can read values; it cannot change who this device is.
      acceptRendererIdentity: false,
      ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[config]", m, d ?? "") } : {}),
    });
    setConfigReader((key) => client.getBoolean(key, CONFIG_DEFAULTS[key]));
  } catch (err) {
    console.warn("[config] not installed:", err);
  }
}
