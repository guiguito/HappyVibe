/**
 * §39 — the electron-free seam, the crash/client.ts pattern: `ipc.ts` and
 * `config.ts` read the flag through here, and `remoteConfig/index.ts` plugs
 * the real reader in at install. Until then — or if it throws — the in-app
 * default answers — which, for the free web service, is OFF (defaults.ts).
 */
import { CONFIG_DEFAULTS } from "./defaults";

type Reader = (key: "web_default_service") => boolean;
let reader: Reader | null = null;

export function setConfigReader(fn: Reader | null): void {
  reader = fn;
}

export function webDefaultServiceAllowed(): boolean {
  try {
    return reader ? reader("web_default_service") : CONFIG_DEFAULTS.web_default_service;
  } catch {
    return CONFIG_DEFAULTS.web_default_service;
  }
}

/**
 * Privacy round (2026-10-09): the Remote settings switch. ipc.ts (which must not
 * reach Electron) calls applyRemoteConfigSwitch; remoteConfig/index.ts plugs in
 * the live stop/start at install. No handler (no key, tests): inert.
 */
let onSwitch: ((on: boolean) => void) | null = null;

export function setRemoteConfigSwitchHandler(fn: ((on: boolean) => void) | null): void {
  onSwitch = fn;
}

export function applyRemoteConfigSwitch(on: boolean): void {
  onSwitch?.(on);
}
