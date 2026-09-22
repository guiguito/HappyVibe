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
 * `documents.ts` and `mcpAdapterStore.ts`, which are vitest-imported too.
 *
 * So everything the rest of main needs lives here — reporting a child that
 * died, and handing over the audit log — and the Electron half wires itself in
 * at install time. Same division of labour as `platform.ts` and `schedules.ts`,
 * for the same measured reason.
 */
import type { CrashReportInput } from "inlet-sdk/crash";
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
