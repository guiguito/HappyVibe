/**
 * §37 — the only evidence a hang leaves behind.
 *
 * A Force Quit, a power loss and an OOM kill all share one property: no
 * handler of ours runs, so nothing we could write at exit time gets written.
 * The inverse works — write a file while alive, delete it on a clean quit, and
 * find it still there at the next launch. That is the whole mechanism.
 *
 * The file's CONTENT is the start time and its MTIME is the last touch, so the
 * two together give the uptime of the session that never came back. One file,
 * two facts, no format to migrate.
 *
 * Pure and directory-agnostic so the tests can drive it over a tmp dir: it
 * knows nothing about Electron or about which builds arm it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SENTINEL_NAME = "running.lock";

const pathIn = (dir: string): string => join(dir, SENTINEL_NAME);

export function writeSentinel(dir: string, now = Date.now()): void {
  const p = pathIn(dir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, String(now), "utf8");
}

/** Touch only — the START must survive, or the uptime becomes zero every minute. */
export function touchSentinel(dir: string, now = Date.now()): void {
  const p = pathIn(dir);
  if (!existsSync(p)) return;
  const t = new Date(now);
  utimesSync(p, t, t);
}

/**
 * `null` when the last run exited cleanly — which is the common case and must
 * stay the cheap one. A malformed file reads as `undefined` uptime rather than
 * as no crash: the crash DID happen, we just cannot say how long it ran, and
 * dropping the report over a bad number would lose the fact to protect the
 * detail.
 */
export function readSentinel(dir: string): { lastUptimeMs?: number } | null {
  const p = pathIn(dir);
  if (!existsSync(p)) return null;
  try {
    const start = Number(readFileSync(p, "utf8").trim());
    const end = statSync(p).mtimeMs;
    if (!Number.isFinite(start) || end < start) return {};
    return { lastUptimeMs: Math.round(end - start) };
  } catch {
    return {};
  }
}

export function removeSentinel(dir: string): void {
  try {
    rmSync(pathIn(dir), { force: true });
  } catch {
    /* a sentinel we cannot delete becomes one false unclean-exit, never a crash here */
  }
}
