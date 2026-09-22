/**
 * §37 — crash reports. All the Electron in this feature lives here; everything
 * with a rule in it lives in the pure siblings so the non-live suite can assert it.
 *
 * Installed from `src/main/index.ts` immediately after the userData migration,
 * because the handlers cover only what happens AFTER they exist and the most
 * interesting failures are boot failures.
 */
import { app, crashReporter, ipcMain, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { installElectronMain } from "inlet-sdk/crash/electron";
import type { CrashEnvelope, CrashReportInput, DropReason, SentReport } from "inlet-sdk/crash";
import { setEnabled } from "inlet-sdk/crash";
import { resolveFeedbackConfig } from "../feedback/config";
import { getCrashReports, setCrashReports } from "../config";
import { TAG_ALLOW, redactMessage, scrubEnvelope } from "./policy";
import { readSentinel, removeSentinel, touchSentinel, writeSentinel } from "./sentinel";
import { captureCrash, recordCrashSent, setCrashCapture, type CrashRow } from "./client";

/** Injected by electron-vite (`main.define`), the same string the Changelog shows. */
declare const __RUNTIME_PINS__: string;

const TOUCH_MS = 60_000;
/** Two uncaught exceptions this close together is a loop, not an accident. */
const FATAL_REPEAT_MS = 10_000;

let client: { captureReport(r: CrashReportInput): Promise<string | null> } | null = null;
let lastSent: CrashRow | null = null;
const recent: CrashEnvelope[] = [];
let queueDir = "";

export function crashInfo(): {
  enabled: boolean;
  installed: boolean;
  lastSent: CrashRow | null;
  lastReport: CrashEnvelope | null;
  queueDir: string;
  dumpsDir: string;
} {
  return {
    enabled: getCrashReports(),
    installed: client !== null,
    lastSent,
    lastReport: recent.at(-1) ?? null,
    queueDir,
    dumpsDir: app.getPath("crashDumps"),
  };
}

/** The toggle. Live in both directions — the client is always initialised. */
export async function setCrashEnabled(on: boolean): Promise<void> {
  // `dropQueue` is what makes OFF mean OFF: without it a report captured on the
  // fatal path while the setting was off would still be on disk, and turning
  // reports back on months later would send it.
  await setEnabled(on, { dropQueue: !on });
}

/**
 * The §37 IPC surface. It lives here rather than in `ipc.ts` because `ipc.ts`
 * must not reach `@electron-toolkit/utils` (CLAUDE.md), and a feature module
 * that does is the same import one hop away.
 *
 * Registered BEFORE every gate: with reporting off or dev-gated the Privacy
 * page must still open and still be able to turn it back ON.
 */
function registerCrashIpc(): void {
  ipcMain.handle("hv:get-crash-reports", () => getCrashReports());
  ipcMain.handle("hv:set-crash-reports", async (_e, on: boolean) => {
    setCrashReports(!!on);
    await setCrashEnabled(!!on);
  });
  ipcMain.handle("hv:crash-info", () => crashInfo());
  ipcMain.handle("hv:crash-reveal", () => { shell.showItemInFolder(crashInfo().dumpsDir); });
  // Dev-only, and deliberately without a button anywhere: the GUI pass drives
  // it from electron-debug. Four controls that render only in development are
  // UI built for a test, on a page whose whole job is to be believable.
  ipcMain.handle("hv:crash-test", (e, kind: string) => {
    // `nested` exists to answer "are the FRAMES any good", which a one-line
    // throw cannot: it fails several NAMED functions deep so the report carries
    // a real in-app stack to read, the way a genuine bug would.
    const level3 = (): never => { throw new Error("hv:crash-test nested"); };
    const level2 = (): never => level3();
    const level1 = (): never => level2();
    if (app.isPackaged) return false;
    if (kind === "throw") setTimeout(() => { throw new Error("hv:crash-test throw"); }, 0);
    else if (kind === "reject") void Promise.reject(new Error("hv:crash-test reject"));
    // The SENDER's webContents, never `getFocusedWindow()`. That returns null
    // whenever the app is not frontmost — which is always, when the GUI pass
    // drives it over CDP — so the optional call silently did nothing while this
    // handler still answered `true`. Measured: zero `render-process-gone`
    // events with two listeners registered, i.e. nothing crashed at all.
    else if (kind === "crash") (e.sender as Electron.WebContents).forcefullyCrashRenderer();
    else if (kind === "nested") setTimeout(() => level1(), 0);
    else if (kind === "message") captureCrash({ kind: "message", exception: { type: "Probe", message: "hv:crash-test", handled: true, frames: [] } });
    else return false;
    return true;
  });
}

export async function installCrash(broadcast: (channel: string, payload?: unknown) => void): Promise<void> {
  // Synchronous, and BEFORE every gate: with reporting off or dev-gated the
  // Privacy page must still open, still read as Off, and still be able to turn
  // it back on. (Nothing is awaited above this line, so the handlers exist by
  // the time the first window can ask.)
  registerCrashIpc();

  // FIRST gate, ahead of the user's setting: development does not report unless
  // asked. Your own half-written code is the loudest crasher on this machine,
  // and it would bury the one report that came from a real dev-channel user.
  // `HV_FEEDBACK_FAST_PULSE`'s rule, one feature over — and an env flag rather
  // than `is.dev` alone so the GUI pass can turn the whole thing on.
  if (is.dev && process.env.HV_CRASH_DEV !== "1") return;

  const cfg = resolveFeedbackConfig(process.env, is.dev);
  if (!cfg) return; // no publishable key for this channel — §20, don't show what cannot work

  queueDir = join(app.getPath("userData"), "inlet-crash");

  const onSent = (sent: SentReport, envelope: CrashEnvelope): void => {
    // Ids and counts. Never the message, never a frame, never the context —
    // the audit log is a record that something left, not a second copy of it.
    const row: CrashRow = {
      reportId: sent.reportId,
      groupId: sent.groupId,
      isNewGroup: sent.isNewGroup,
      kind: envelope.kind,
      bytes: JSON.stringify(envelope).length,
      channel: cfg.channel,
    };
    lastSent = row;
    recent.push(envelope);
    if (recent.length > 5) recent.shift();
    recordCrashSent(row);
    broadcast("hv:crash-sent", row);
  };

  const onDrop = (reason: DropReason, detail?: unknown): void => {
    // The answer to "why did my crash not arrive", which is the question the
    // GUI pass asks most. Dev only: in production a drop is not the user's problem.
    if (is.dev) console.warn("[crash] dropped:", reason, detail ?? "");
  };

  try {
    const installed = await installElectronMain(
      {
        baseUrl: cfg.baseUrl,
        publishableKey: cfg.publishableKey,
        crashDatabaseId: cfg.crashDatabase,
        channel: cfg.channel,
        environment: is.dev ? "development" : "production",
        // Always initialise, even when off, so the toggle needs no relaunch.
        enabled: getCrashReports(),
        tags: { runtime: __RUNTIME_PINS__, channel: cfg.channel },
        tagAllowlist: [...TAG_ALLOW],
        beforeSendSync: scrubEnvelope,
        // EXTENDS upstream's default rather than replacing it: an exact-match
        // pre-filter for the messages our own code throws as string literals,
        // then `defaultRedaction` for everything else. Without it the database
        // is a wall of `<redacted>` — measured 7/20 realistic errors surviving,
        // and all seven were the engine's, not ours. See policy.ts.
        redaction: redactMessage,
        onSent,
        onDrop,
        timeoutMs: 20_000,
        ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[crash]", m, d ?? "") } : {}),
        // NO `fetch`, and NO `appRoots`: the default is `app.getAppPath()`,
        // which is what makes every frame root-relative so the developer's own
        // repo path never travels. Overriding it is how that leaks.
      },
      // Explicit though it is now the default. Main exiting takes every live Pi
      // session with it, including any in-flight delegation, and an upstream
      // default that flips silently must not be able to do that.
      { exitCode: false },
    );
    client = installed.client;
    // The seam `documents.ts` and `mcpAdapterStore.ts` report through — they are
    // vitest-imported and must never reach `electron` (see ./client.ts).
    setCrashCapture((r) => { void installed.client.captureReport(r); });
  } catch (err) {
    // `init` throws on a key that is not `ipk_`. An unhandled rejection here is
    // the stock Electron dialog this feature exists to replace, so it is caught
    // and the app simply goes without reporting.
    console.warn("[crash] not installed:", err);
    return;
  }

  // Local minidumps only. A minidump is a memory image — it can hold anything
  // the process was holding — so it never leaves the machine; the Privacy page
  // reveals the folder instead.
  crashReporter.start({ uploadToServer: false, submitURL: "" });

  installSentinel();

  // The double-fault guard, and ONLY for uncaught exceptions. Registered after
  // the SDK's own handler so its capture runs first. A rejection is deliberately
  // not counted: they are common enough that pairing one with a real exception
  // would quit an app that was recoverable, which is the thing `exitCode: false`
  // exists to prevent.
  let lastFatal = 0;
  process.on("uncaughtException", () => {
    const now = Date.now();
    if (now - lastFatal < FATAL_REPEAT_MS) app.exit(1);
    lastFatal = now;
  });
}

/**
 * Packaged builds only: electron-vite restarts main constantly in development,
 * so in dev the sentinel would report the dev loop itself, every few seconds.
 */
function installSentinel(): void {
  if (!app.isPackaged) return;
  const dir = app.getPath("userData");

  const previous = readSentinel(dir);
  if (previous) captureCrash({ kind: "unclean-exit", exit: previous });

  const arm = (): void => {
    writeSentinel(dir);
    const timer = setInterval(() => touchSentinel(dir), TOUCH_MS);
    timer.unref();
  };
  if (app.isReady()) arm();
  else void app.whenReady().then(arm);

  app.on("will-quit", () => removeSentinel(dir));
}
