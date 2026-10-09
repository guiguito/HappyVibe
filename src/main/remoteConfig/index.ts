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
import { getSwitch } from "../config";
import { setConfigReader, setRemoteConfigSwitchHandler } from "./client";

type Client = Awaited<ReturnType<typeof installElectronMain<typeof CONFIG_DEFAULTS>>>;
let client: Client | null = null;
let starting: Promise<void> | null = null;

/** Privacy round: Remote settings off (switch or env lock) → no check at launch, on focus or on the tick. */
function start(): Promise<void> {
  return (starting ??= (async () => {
    const cfg = resolveFeedbackConfig(process.env, is.dev);
    if (client || !cfg || !getSwitch("remoteConfig")) return; // no key for this channel (§20), or off
    try {
      const c = await installElectronMain({
        baseUrl: cfg.baseUrl,
        publishableKey: cfg.publishableKey,
        databaseId: cfg.configDatabase,
        defaults: CONFIG_DEFAULTS,
        // A window can read values; it cannot change who this device is.
        acceptRendererIdentity: false,
        ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[config]", m, d ?? "") } : {}),
      });
      client = c;
      setConfigReader((key) => c.getBoolean(key, CONFIG_DEFAULTS[key]));
      // Turned off while the init was in flight (Review Focus 3).
      if (!getSwitch("remoteConfig")) stop();
    } catch (err) {
      console.warn("[config] not installed:", err);
    }
  })().finally(() => {
    starting = null;
  }));
}

/** inlet-sdk 0.5.0: close() frees the one-client slot, so a later start() is a fresh init. */
function stop(): void {
  if (!client) return;
  client.uninstall();
  client.close();
  client = null;
  setConfigReader(null); // CONFIG_DEFAULTS answer from here on: the free web service is off (fails closed)
}

export async function installRemoteConfig(): Promise<void> {
  setRemoteConfigSwitchHandler((on) => (on ? void start() : stop()));
  await start();
}
