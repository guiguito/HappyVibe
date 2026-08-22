/**
 * FR7 — ingest the child guard's decisions into the EventLog.
 *
 * The guard (`pi-runtime/extensions/hv-child-guard.ts`) appends one JSON line per
 * tool call to `<HV_CHILD_AUDIT_DIR>/<runId>.jsonl`. This module reads it. Per the
 * FR, ingestion reads JSON artifacts and never scrapes rendered text.
 *
 * Everything here is path-confined even though the paths come from our own env
 * var and upstream's own run ids: a reader that trusts its input is one bug away
 * from tailing anything on disk, and the runId in particular arrives via an
 * environment variable and is then used as a filename.
 *
 * Electron-free so vitest can import it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** One decision the guard made inside a child. Mirrors ChildAuditRow. */
export interface GuardAuditRow {
  ts: string;
  runId: string;
  tool: string;
  decision: "allow" | "deny";
  wouldHave: "allow" | "ask" | "deny";
  source: "child" | "bypass";
  summary: string;
}

/** A run id must be a single safe path segment — it becomes a filename. */
const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** True when `dir` is `root` itself or below it, after resolving. */
function confined(root: string, dir: string): boolean {
  const r = path.resolve(root);
  const d = path.resolve(dir);
  return d === r || d.startsWith(r + path.sep);
}

function isRow(v: unknown): v is GuardAuditRow {
  const o = v as GuardAuditRow;
  return (
    !!o && typeof o === "object" &&
    typeof o.ts === "string" && typeof o.runId === "string" && typeof o.tool === "string" &&
    (o.decision === "allow" || o.decision === "deny") &&
    (o.wouldHave === "allow" || o.wouldHave === "ask" || o.wouldHave === "deny")
  );
}

function parseFile(file: string): GuardAuditRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: GuardAuditRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRow(parsed)) out.push(parsed);
    } catch {
      // A torn FINAL line is normal for an appending writer, and dropping the
      // whole file over it would lose every decision recorded before it.
    }
  }
  return out;
}

/** Every decision the guard recorded for one run. */
export function readGuardAudit(root: string, dir: string, runId: string): GuardAuditRow[] {
  if (!confined(root, dir) || !SAFE_RUN_ID.test(runId)) return [];
  return parseFile(path.join(dir, `${runId}.jsonl`));
}

/** Every decision across every run in the directory (respawn catch-up). */
export function guardAuditRows(root: string, dir: string): GuardAuditRow[] {
  if (!confined(root, dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl") && SAFE_RUN_ID.test(n.slice(0, -6)))
    .flatMap((n) => parseFile(path.join(dir, n)));
}

/**
 * The per-run summary row.
 *
 * Exists so a completely uneventful child still leaves a trace: without it,
 * "nothing in the audit log" would mean both "the child behaved" and "ingestion
 * is broken", which is exactly the ambiguity an audit log must not have.
 */
export function rollupGuardAudit(rows: readonly GuardAuditRow[]): { attempted: number; denied: number } {
  return {
    attempted: rows.length,
    denied: rows.filter((r) => r.decision === "deny").length,
  };
}

/** Delete a drained run's file. Returns whether anything was removed. */
export function clearGuardAudit(root: string, dir: string, runId: string): boolean {
  if (!confined(root, dir) || !SAFE_RUN_ID.test(runId)) return false;
  try {
    fs.unlinkSync(path.join(dir, `${runId}.jsonl`));
    return true;
  } catch {
    return false;
  }
}
