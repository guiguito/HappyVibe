/**
 * §39 — the Electron half of usage statistics. Never imported by `ipc.ts`.
 * Always initialised (enabled from the setting, like §37), so the Privacy
 * switch is live in both directions with no relaunch.
 */
import path from "node:path";
import { app, ipcMain } from "electron";
import { is } from "@electron-toolkit/utils";
import { installElectronMain } from "inlet-sdk/analytics/electron";
import { resolveFeedbackConfig } from "../feedback/config";
import { agentDir, getUsageStats, setUsageStats } from "../config";
import { existingUserAttribution, hasPriorUse } from "./attribution";
import { usageBeforeSend } from "./guard";
import { setUsageSink } from "./client";
import { forgetLastCrashReport } from "../crash";
import { lockedByEnv } from "../privacySwitches";

let setEnabled: ((on: boolean, opts?: { forget?: boolean }) => Promise<void> | void) | null = null;
let setAttribution: ((value: string) => void) | null = null;

function registerUsageIpc(): void {
  ipcMain.handle("hv:get-usage-stats", () => getUsageStats());
  ipcMain.handle("hv:set-usage-stats", async (_e, on: boolean) => {
    if (lockedByEnv("usageStats", process.env)) return; // an env lock: the switch is held off
    setUsageStats(!!on);
    // D16: opting back in starts a NEW installation, and forget cleared the
    // attribution — so it would count as a new install. Whoever flips this
    // switch has used the app: tag it first (the SDK keeps it while disabled
    // and announces it with app_installed on enable).
    if (on) setAttribution?.("existing_user");
    // D11: off FORGETS this installation (ID, session, queue, and the ID on
    // queued crash reports and submissions). No event is sent about it.
    // The kept copy of the last crash report carries that ID too: forget it whole.
    if (!on) forgetLastCrashReport();
    await setEnabled?.(!!on, on ? undefined : { forget: true });
  });
}

export async function installUsage(): Promise<void> {
  registerUsageIpc(); // before every gate: the Privacy page must always be able to turn it back on
  const cfg = resolveFeedbackConfig(process.env, is.dev);
  if (!cfg) return;
  // Privacy round: under the env lock the client is still built, disabled, so its stored
  // installation ID can be FORGOTTEN — remote settings share that ID, and must not keep
  // sending the one linked to past statistics (the Privacy copy promises an unlinked one).
  const locked = lockedByEnv("usageStats", process.env);
  const userData = app.getPath("userData");
  const attribution = existingUserAttribution(path.join(userData, "inlet"), hasPriorUse(userData, agentDir()));
  try {
    const a = await installElectronMain({
      baseUrl: cfg.baseUrl,
      publishableKey: cfg.publishableKey,
      analyticsDatabaseId: cfg.analyticsDatabase,
      // D8: dev builds send to the Dev project's database — an environment is a
      // project since inlet-sdk 0.5.0, which has no `environment` field.
      enabled: getUsageStats(),
      ...(attribution ? { attribution } : {}),
      acceptRendererIdentity: false,
      beforeSend: (env) => usageBeforeSend(env),
      ...(is.dev
        ? {
            debug: (m: string, d?: unknown) => console.warn("[usage]", m, d ?? ""),
            onDrop: (r: string, d?: unknown) => console.warn("[usage] dropped:", r, d ?? ""),
          }
        : {}),
    });
    if (locked) {
      await a.setEnabled(false, { forget: true });
      return;
    }
    setEnabled = (on, opts) => a.setEnabled(on, opts);
    setAttribution = (value) => a.setAttribution(value);
    setUsageSink((name, category, params) => a.track(name, { category, params }));
  } catch (err) {
    console.warn("[usage] not installed:", err);
  }
}
