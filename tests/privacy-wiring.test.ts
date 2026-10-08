import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { applyRemoteConfigSwitch, setRemoteConfigSwitchHandler } from "../src/main/remoteConfig/client";

const read = (f: string): string => fs.readFileSync(f, "utf8");

describe("privacy state wiring", () => {
  it("the remote-config seam forwards each flip, and is inert with no handler", () => {
    const seen: boolean[] = [];
    applyRemoteConfigSwitch(false);
    setRemoteConfigSwitchHandler((on) => seen.push(on));
    applyRemoteConfigSwitch(false);
    applyRemoteConfigSwitch(true);
    applyRemoteConfigSwitch(false);
    setRemoteConfigSwitchHandler(null);
    expect(seen).toEqual([false, true, false]);
  });
  it("main answers get/set and broadcasts every change", () => {
    const ipc = read("src/main/ipc.ts");
    expect(ipc).toContain('ipcMain.handle("hv:privacy-get"');
    expect(ipc).toContain('ipcMain.handle("hv:privacy-set"');
    expect(ipc).toMatch(/windows\.broadcast\("hv:privacy-changed"/);
  });
  it("a set for a locked or foreign key is refused before anything is written (Review Focus 2)", () => {
    const ipc = read("src/main/ipc.ts");
    const handler = ipc.slice(ipc.indexOf('ipcMain.handle("hv:privacy-set"'));
    const guard = handler.indexOf("lockedByEnv(key, process.env)");
    const write = handler.indexOf("setSwitch(key");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
    expect(ipc).toMatch(/PRIVACY_SET_HERE: SwitchKey\[\] = \["feedback", "sessionPulse", "remoteConfig", "modelList"\]/);
  });
  it("HV_NO_FEEDBACK means the feedback clients are never built, so nothing queued replays", () => {
    expect(read("src/main/ipc.ts")).toMatch(/const inlet = feedbackCfg && !lockedByEnv\("feedback", process\.env\)\s*\?\s*createFeedbackClients/);
  });
  it("the preload exposes the three calls with literal channels", () => {
    const pre = read("src/preload/index.ts");
    expect(pre).toContain('ipcRenderer.invoke("hv:privacy-get")');
    expect(pre).toContain('ipcRenderer.invoke("hv:privacy-set", key, on)');
    expect(pre).toContain('ipcRenderer.on("hv:privacy-changed"');
  });
  it("ipc.ts reaches remote config only through its import-free seam", () => {
    expect(read("src/main/ipc.ts")).toMatch(/from "\.\/remoteConfig\/client"/);
  });
  it("final review: under HV_NO_USAGE_STATS the old installation ID is forgotten, so remote settings can't send it", () => {
    const u = read("src/main/usage/index.ts");
    const body = u.slice(u.indexOf("export async function installUsage"));
    expect(body).toMatch(/if \(locked\) \{\s*await a\.setEnabled\(false, \{ forget: true \}\);\s*return;/);
    // the lock must no longer skip the install: forgetting needs the client
    expect(body).not.toMatch(/if \(!cfg \|\| lockedByEnv\("usageStats"/);
  });
});
