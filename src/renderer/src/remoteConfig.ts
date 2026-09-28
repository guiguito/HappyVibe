/**
 * §39 — the window's view of main's config client. Holds no key, makes no
 * request (the CSP stays `script-src 'self'`). Reads return CONFIG_DEFAULTS
 * until main's first push, so a window never shows "paused" by accident.
 */
import { useEffect, useState } from "react";
import { createElectronRenderer } from "inlet-sdk/config/electron-renderer";
import { CONFIG_DEFAULTS } from "../../main/remoteConfig/defaults";

export const remoteConfig = createElectronRenderer({ defaults: CONFIG_DEFAULTS });

/** Re-renders on a live change, so the Settings row flips without a reload (D13). */
export function useWebDefaultPaused(): boolean {
  const read = (): boolean => !remoteConfig.getBoolean("web_default_service", CONFIG_DEFAULTS.web_default_service);
  const [paused, setPaused] = useState(read);
  useEffect(() => remoteConfig.onUpdate(() => setPaused(read())), []);
  return paused;
}
