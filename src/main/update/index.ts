/**
 * PRD §38 — the app updates itself. The Electron half: electron-updater, the
 * timers, the IPC and the audit rows. Every DECISION is in ./state.ts (pure,
 * tested); this file only feeds it events and does what it says.
 *
 * NEVER imported by ipc.ts — `electron` is a CommonJS stub under vitest, and
 * reaching it from a vitest-imported module takes that whole file red (the §37
 * crash-module rule). index.ts wires the two together.
 */
import { app, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { getAutoUpdate, setAutoUpdate } from "../config";
import type { UpdateDeps } from "../ipc";
import { initialState, installGate, reduce, RELEASES_URL, updateMode, type UpdateEvent, type UpdateState } from "./state";

// electron-updater is CommonJS; its named export is a lazy getter, so it is read
// off the default import rather than destructured at module scope.
const { autoUpdater } = electronUpdater;

/** Never on the boot path: an app must not open behind a network call. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 4 * 60 * 60_000;
/** How often a shown "ready" row re-reads the gate, and an armed restart retries. */
// ponytail: a 5 s poll; an activity-change hook if this ever shows up in a profile.
const GATE_POLL_MS = 5_000;

export function startUpdater(deps: UpdateDeps): void {
  const mode = updateMode({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE });
  let state: UpdateState = initialState(mode, getAutoUpdate());

  const push = (): void => deps.send("hv:update-state", state);
  const apply = (e: UpdateEvent): void => {
    state = reduce(state, e);
    push();
  };
  const gateNow = (): { blockedBy: string[]; terminalsOpen: boolean } =>
    installGate({
      liveSessions: deps.liveSessions(),
      isIdle: deps.isIdle,
      pendingSessionIds: deps.pendingSessionIds(),
      terminalsOpen: deps.terminalsOpen(),
    });

  // Dev: nothing runs — unless a GUI pass asks to SEE the row. `ready:0.3.0`,
  // `available:0.3.0` or `downloading:0.3.0`. Install then only writes the audit
  // row it would have written; a dev build never installs over itself.
  const fake = !app.isPackaged && process.env.HV_UPDATE_FAKE ? process.env.HV_UPDATE_FAKE : null;
  if (fake) {
    const [k, version = "0.3.0"] = fake.split(":");
    state = { ...state, mode: "auto" };
    if (k === "ready") state = reduce(state, { t: "downloaded", version, at: Date.now() });
    else if (k === "available") state = { ...state, phase: { k: "available", version } };
    else if (k === "downloading") state = { ...state, phase: { k: "downloading", version, percent: 42 } };
  }

  let armedTimer: ReturnType<typeof setInterval> | null = null;
  const tryInstall = (): void => {
    if (state.phase.k !== "ready") return;
    const gate = installGate({
      liveSessions: deps.liveSessions(),
      isIdle: deps.isIdle,
      pendingSessionIds: deps.pendingSessionIds(),
      terminalsOpen: deps.terminalsOpen(),
    });
    if (gate.blockedBy.length > 0) {
      if (!state.gate.armed) deps.audit({ event: "deferred", version: state.phase.version, blockedBy: gate.blockedBy.length });
      apply({ t: "gate", gate: { ...gate, armed: true } });
      armedTimer ??= setInterval(tryInstall, GATE_POLL_MS);
      armedTimer.unref();
      return;
    }
    if (armedTimer) clearInterval(armedTimer);
    armedTimer = null;
    deps.audit({ event: "installed", version: state.phase.version });
    if (fake) {
      apply({ t: "gate", gate: { ...gate, armed: false } });
      return;
    }
    // isSilent=false (Windows shows its installer progress), isForceRunAfter=true.
    autoUpdater.quitAndInstall(false, true);
  };

  ipcMain.handle("hv:update-get", () => state);
  ipcMain.handle("hv:update-install", () => {
    if (state.mode === "manual") void shell.openExternal(RELEASES_URL);
    else tryInstall();
  });
  ipcMain.handle("hv:update-download", () => {
    if (state.mode === "manual" || fake) void shell.openExternal(RELEASES_URL);
    else if (state.mode === "auto") void autoUpdater.downloadUpdate().catch(() => { /* the error event reports it */ });
  });
  ipcMain.handle("hv:update-set-auto", (_e, on: boolean) => {
    setAutoUpdate(!!on);
    if (state.mode === "auto" && !fake) autoUpdater.autoDownload = !!on;
    apply({ t: "auto", on: !!on });
  });
  let manualCheck = false;
  const check = (manual: boolean): void => {
    if (state.mode === "disabled" || fake) return;
    manualCheck = manual;
    apply({ t: "checking", manual });
    void autoUpdater.checkForUpdates().catch(() => { /* the error event reports it */ });
  };
  ipcMain.handle("hv:update-check", () => check(true));

  // A shown "ready" row keeps its "Restart when…" sentence true.
  setInterval(() => {
    if (state.phase.k !== "ready") return;
    const g = gateNow();
    if (g.blockedBy.join("\n") !== state.gate.blockedBy.join("\n") || g.terminalsOpen !== state.gate.terminalsOpen)
      apply({ t: "gate", gate: { ...g, armed: state.gate.armed } });
  }, GATE_POLL_MS).unref();

  if (state.mode === "disabled" || fake) return;

  autoUpdater.autoDownload = state.mode === "auto" && state.auto;
  autoUpdater.autoInstallOnAppQuit = state.mode === "auto";
  autoUpdater.allowPrerelease = false;
  // electron-updater logs through console by default; the audit log is ours.
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) => {
    deps.audit({ event: "available", version: info.version });
    apply({ t: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => apply({ t: "none", at: Date.now() }));
  autoUpdater.on("download-progress", (p) => apply({ t: "progress", percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    deps.audit({ event: "downloaded", version: info.version });
    apply({ t: "downloaded", version: info.version, at: Date.now() });
    apply({ t: "gate", gate: { ...gateNow(), armed: false } });
  });
  autoUpdater.on("error", (err) => {
    // err.message verbatim: the §27 lesson — never collapse the message that
    // names the problem. Shown on screen only after a MANUAL check (state.ts).
    const message = err?.message ?? String(err);
    deps.audit({ event: "error", message, manual: manualCheck });
    apply({ t: "error", message, at: Date.now() });
  });

  setTimeout(() => check(false), FIRST_CHECK_MS).unref();
  setInterval(() => check(false), EVERY_MS).unref();
}
