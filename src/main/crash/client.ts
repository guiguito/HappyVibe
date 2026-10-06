/**
 * §37 — the crash seam every OTHER module talks to, deliberately electron-free.
 *
 * `crash/index.ts` imports `electron` and `@electron-toolkit/utils`. Under
 * vitest `electron` resolves to a CommonJS stub with no named exports, so
 * importing it from a module a test loads takes that whole FILE down with
 * *"Named export 'BrowserWindow' not found"* — an error naming the import
 * rather than the cause. It is a rule of this repo (CLAUDE.md) that `ipc.ts`
 * must not reach `@electron-toolkit/utils`, and reaching it one hop away
 * through a feature module breaks exactly the same three test files, plus
 * `documents.ts`, which is vitest-imported too.
 *
 * So everything the rest of main needs lives here — reporting a child that
 * died, and handing over the audit log — and the Electron half wires itself in
 * at install time. Same division of labour as `platform.ts` and `schedules.ts`,
 * for the same measured reason.
 */
import fs from "node:fs";
import path from "node:path";
import type { CrashEnvelope, CrashReportInput } from "inlet-sdk/crash";
import type { EventLog } from "../log";

export interface CrashRow {
  reportId: string;
  groupId: string;
  isNewGroup: boolean;
  kind: string;
  bytes: number;
  channel: string;
}

type Capture = (report: CrashReportInput) => void;

let capture: Capture | null = null;
let auditLog: EventLog | null = null;
let pending: CrashRow[] = [];

/** Called once by `installCrash`. Until then — and whenever reporting is off,
    dev-gated or refused — `captureCrash` is a no-op, which is the behaviour we
    want rather than a state every call site has to check. */
export function setCrashCapture(fn: Capture | null): void {
  capture = fn;
}

/** For the call sites that own a child process the SDK cannot see. */
export function captureCrash(report: CrashReportInput): void {
  capture?.(report);
}

/**
 * Hands over the EventLog once `registerIpc` has built it. Rows written before
 * then are buffered rather than dropped: a crash during boot is the one we most
 * want a row for, and it necessarily happens before the log exists.
 */
export function attachCrashAudit(log: EventLog): void {
  auditLog = log;
  for (const row of pending.splice(0)) void log.append({ type: "crash.sent", data: { ...row } });
}

/** One payload, two moments — the live append and the buffered drain. */
export function recordCrashSent(row: CrashRow): void {
  if (auditLog) void auditLog.append({ type: "crash.sent", data: { ...row } });
  else pending.push(row);
}

/**
 * docs-round #10: the last report that LEFT, kept so the Privacy page can still show it
 * after a restart. Its own file, beside the SDK's store, because the EventLog takes ids,
 * never content. The envelope is already scrubbed (`beforeSendSync`), so this file holds
 * exactly what was sent — including the SDK's rotating session id and, while usage
 * statistics are on, the installation id. That is why both opt-outs delete it whole
 * (`clearLastReport`): the SDK's `dropQueue` and `forget` only reach the queued items.
 */
export const LAST_REPORT_FILE = "last-report.json";
const LAST_REPORT_TMP = `${LAST_REPORT_FILE}.tmp`;

/** Temp file then rename, so a kill mid-write cannot clobber the previous good copy. */
export function writeLastReport(dir: string, envelope: CrashEnvelope): void {
  const tmp = path.join(dir, LAST_REPORT_TMP);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(envelope));
    fs.renameSync(tmp, path.join(dir, LAST_REPORT_FILE));
  } catch {
    // A missing copy only means the page says nothing was sent. Never worth a crash.
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

/** Valid JSON of the wrong shape (an array, a string, `{}`) reads as nothing sent. */
export function readLastReport(dir: string): CrashEnvelope | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(path.join(dir, LAST_REPORT_FILE), "utf8"));
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    return typeof (v as { kind?: unknown }).kind === "string" ? (v as CrashEnvelope) : null;
  } catch {
    return null;
  }
}

/** Opting out of crash reports or usage statistics forgets the local copy. Never throws. */
export function clearLastReport(dir: string): void {
  for (const f of [LAST_REPORT_FILE, LAST_REPORT_TMP]) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* best effort */ }
  }
}
