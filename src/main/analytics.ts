/**
 * B7 — local-only analytics aggregation. Pure over an EventLog read; no Electron
 * import so vitest can drive it directly. NEVER sends anywhere (PRD: local-only).
 *
 * Source events (emitted in src/main/ipc.ts, envelope frozen in log.ts):
 *   session.start      {data:{resume}}
 *   session.end        {data:{stats}}  stats = get_session_stats payload
 *   session.crash      {data:{code}}
 *   permission.decision {data:{tool,summary,decision,source,rule?}}
 *
 * Missing/partial data is expected and handled: a session.start with no matching
 * session.end is still-open (or crashed) and contributes no duration; a torn log
 * line is already skipped by EventLog.read; a session.end with null stats sums to
 * zero. Money is an ESTIMATE (surfaced as such in the UI).
 */
import type { LogEvent } from "./log";

/** get_session_stats payload we read (superset of renderer SessionStats). All optional. */
interface Stats {
  tokens?: { input?: number; output?: number };
  cost?: number;
  model?: string; // present on some providers' payloads; per-model breakdown is best-effort
}

export interface AnalyticsFilter {
  workspaceId?: string;
  sinceTs?: string; // ISO 8601; events with ts < sinceTs are ignored
}

export interface Breakdown {
  key: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface Analytics {
  totalSessions: number;
  openSessions: number; // start with no matching end (still-open or crashed)
  crashes: number;
  tokens: { input: number; output: number };
  cost: number; // estimated, summed from session.end stats
  duration: { avgMs: number | null; medianMs: number | null; count: number };
  /** yyyy-mm-dd → sessions started that day, ascending by date. */
  sessionsPerDay: Array<{ date: string; count: number }>;
  perWorkspace: Breakdown[]; // desc by sessions
  perModel: Breakdown[]; // desc by sessions; empty if no stats carried a model
  permissions: {
    total: number;
    byDecision: Record<string, number>; // allow | allow-session | deny | …
    bySource: Record<string, number>; // rule | user | dangerous | safe-default | …
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function statsOf(e: LogEvent): Stats | null {
  const s = (e.data as { stats?: unknown } | undefined)?.stats;
  return s && typeof s === "object" ? (s as Stats) : null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Add a session's tokens/cost into a keyed breakdown bucket. */
function bump(buckets: Map<string, Breakdown>, key: string, tokens: number, cost: number): void {
  const b = buckets.get(key) ?? { key, sessions: 0, tokens: 0, cost: 0 };
  b.sessions += 1;
  b.tokens += tokens;
  b.cost += cost;
  buckets.set(key, b);
}

const bySessionsDesc = (a: Breakdown, b: Breakdown): number =>
  b.sessions - a.sessions || b.tokens - a.tokens || a.key.localeCompare(b.key);

/**
 * Aggregate an already-read event list. Kept separate from the read so it's a
 * trivially testable pure function (feed it synthetic LogEvents).
 */
export function aggregate(events: LogEvent[], filter: AnalyticsFilter = {}): Analytics {
  const matches = (e: LogEvent): boolean =>
    (!filter.workspaceId || e.workspaceId === filter.workspaceId) &&
    (!filter.sinceTs || e.ts >= filter.sinceTs);

  // Pair start↔end by sessionId to derive duration. Keep the FIRST start ts and
  // the LAST end ts per session (defensive against replays / re-resumes).
  const startTs = new Map<string, string>();
  const endTs = new Map<string, string>();
  const endStats = new Map<string, Stats | null>();
  const wsOf = new Map<string, string | undefined>();

  const perDay: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let crashes = 0;
  let permTotal = 0;

  for (const e of events) {
    if (!matches(e)) continue;
    switch (e.type) {
      case "session.start": {
        const id = e.sessionId;
        if (id && !startTs.has(id)) startTs.set(id, e.ts);
        if (id) wsOf.set(id, e.workspaceId);
        inc(perDay, e.ts.slice(0, 10));
        break;
      }
      case "session.end": {
        const id = e.sessionId;
        if (id) {
          endTs.set(id, e.ts);
          endStats.set(id, statsOf(e));
          if (!wsOf.has(id)) wsOf.set(id, e.workspaceId);
        }
        break;
      }
      case "session.crash":
        crashes += 1;
        break;
      case "permission.decision": {
        permTotal += 1;
        const d = e.data as { decision?: string; source?: string } | undefined;
        if (d?.decision) inc(byDecision, d.decision);
        if (d?.source) inc(bySource, d.source);
        break;
      }
    }
  }

  // Tokens / cost / per-workspace / per-model come from ended sessions' stats.
  let inputTok = 0;
  let outputTok = 0;
  let cost = 0;
  const wsBuckets = new Map<string, Breakdown>();
  const modelBuckets = new Map<string, Breakdown>();

  for (const [id, s] of endStats) {
    const input = num(s?.tokens?.input);
    const output = num(s?.tokens?.output);
    const c = num(s?.cost);
    inputTok += input;
    outputTok += output;
    cost += c;
    const tok = input + output;
    bump(wsBuckets, wsOf.get(id) ?? "(unknown)", tok, c);
    if (s?.model) bump(modelBuckets, s.model, tok, c);
  }

  // Durations: only sessions with BOTH a start and an end. Guard clock skew.
  const durations: number[] = [];
  for (const [id, start] of startTs) {
    const end = endTs.get(id);
    if (!end) continue;
    const ms = Date.parse(end) - Date.parse(start);
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
  }
  durations.sort((a, b) => a - b);
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Open = started but never ended (still-running or crashed without close).
  let openSessions = 0;
  for (const id of startTs.keys()) if (!endTs.has(id)) openSessions += 1;

  return {
    totalSessions: startTs.size,
    openSessions,
    crashes,
    tokens: { input: inputTok, output: outputTok },
    cost,
    duration: { avgMs, medianMs: median(durations), count: durations.length },
    sessionsPerDay: Object.keys(perDay)
      .sort()
      .map((date) => ({ date, count: perDay[date] })),
    perWorkspace: [...wsBuckets.values()].sort(bySessionsDesc),
    perModel: [...modelBuckets.values()].sort(bySessionsDesc),
    permissions: { total: permTotal, byDecision, bySource },
  };
}
