/**
 * §39 — the window's view of main's config client. Holds no key, makes no
 * request (the CSP stays `script-src 'self'`). Reads return CONFIG_DEFAULTS
 * until main's first push — the free web service reads "not available" until then (fails closed).
 */
import { useEffect, useState } from "react";
import { createElectronRenderer } from "inlet-sdk/config/electron-renderer";
import { CONFIG_DEFAULTS } from "../../main/remoteConfig/defaults";
import { usePrivacy } from "./privacy";

export const remoteConfig = createElectronRenderer({ defaults: CONFIG_DEFAULTS });

/** Re-renders on a live change, so the Settings row flips without a reload (D13).
    Fails closed: with remote settings off main reads CONFIG_DEFAULTS, so the box is off. */
export function useWebDefaultPaused(): { unavailable: boolean; remoteOff: boolean } {
  const read = (): boolean => !remoteConfig.getBoolean("web_default_service", CONFIG_DEFAULTS.web_default_service);
  const [paused, setPaused] = useState(read);
  const [privacy] = usePrivacy();
  useEffect(() => remoteConfig.onUpdate(() => setPaused(read())), []);
  return { unavailable: paused || privacy?.on.remoteConfig === false, remoteOff: privacy?.on.remoteConfig === false };
}
