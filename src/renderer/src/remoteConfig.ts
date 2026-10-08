/**
 * §39 — the window's view of main's config client. Holds no key, makes no
 * request (the CSP stays `script-src 'self'`). Reads return CONFIG_DEFAULTS
 * until main's first push, so a window never shows "paused" by accident.
 */
import { useEffect, useState } from "react";
import { createElectronRenderer } from "inlet-sdk/config/electron-renderer";
import { CONFIG_DEFAULTS } from "../../main/remoteConfig/defaults";
import { usePrivacy } from "./privacy";

export const remoteConfig = createElectronRenderer({ defaults: CONFIG_DEFAULTS });

/** Re-renders on a live change, so the Settings row flips without a reload (D13).
    Remote settings off: main reads CONFIG_DEFAULTS, so the box is never "paused". */
export function useWebDefaultPaused(): boolean {
  const read = (): boolean => !remoteConfig.getBoolean("web_default_service", CONFIG_DEFAULTS.web_default_service);
  const [paused, setPaused] = useState(read);
  const [privacy] = usePrivacy();
  useEffect(() => remoteConfig.onUpdate(() => setPaused(read())), []);
  return paused && privacy?.on.remoteConfig !== false;
}
