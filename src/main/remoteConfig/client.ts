/**
 * §39 — the electron-free seam, the crash/client.ts pattern: `ipc.ts` and
 * `config.ts` read the flag through here, and `remoteConfig/index.ts` plugs
 * the real reader in at install. Until then — or if it throws — the in-app
 * default answers, so nothing ever fails closed.
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
