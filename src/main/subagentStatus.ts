/**
 * Live status poller for detached (async) subagent runs (docs/validation/d1.md
 * §hv:subagent-status). A detached run outlives the parent turn, so its progress
 * can't ride the parent's tool_execution_update stream; instead pi-subagents
 * atomically rewrites `<asyncDir>/status.json` on every change and we tail it.
 *
 * ponytail: 500 ms polling of one small JSON per active run. fs.watch on the OS
 * tmpdir is flaky cross-platform; a poll is the boring, correct option. Upgrade
 * to fs.watch only if active-run counts ever make this measurably costly.
 */
import * as fs from "node:fs";
import * as os from "node:os";

/** The subset of pi-subagents' AsyncStatus we forward to the renderer. */
export interface SubagentStatus {
  state?: string;
  activityState?: string;
  currentTool?: string;
  currentPath?: string;
  turnCount?: number;
  toolCount?: number;
  recentTools?: Array<{ tool: string; args?: string }>;
  /**
   * The child Pi session files this run is writing, with the agent that owns
   * each — `steps[].sessionFile` / `steps[].agent`, verbatim.
   *
   * This is the ONLY link between a run and its own spend, and it has to be
   * read rather than derived: the directory pi-subagents writes the child
   * session into is named after the run's INNER id, while every id the app
   * holds for a run (the poller key, the audit rows, `details.asyncId`) is the
   * WORKFLOW async id. Measured 2026-08-22 — async id
   * `72e6fd2e-…` wrote into `…/8a2f9f62-…/run-0/session.jsonl`. Resolving a path
   * from the async id therefore finds nothing, silently, which is exactly how
   * the first implementation shipped a card that never showed a number.
   */
  children?: Array<{ sessionFile: string; agent?: string }>;
}

/**
 * Read + normalize `<asyncDir>/status.json`. Returns null on a missing/torn read
 * (atomic writes mean a torn read just means "poll again next tick"). asyncDir
 * MUST be under os.tmpdir() (it comes from our own extension, but we confine fs
 * reads on principle — CLAUDE.md).
 */
export function readSubagentStatus(asyncDir: string): SubagentStatus | null {
  if (!asyncDir.startsWith(os.tmpdir())) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(`${asyncDir}/status.json`, "utf8");
  } catch {
    return null;
  }
  let s: Record<string, unknown>;
  try {
    s = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const steps = Array.isArray(s.steps) ? (s.steps as Array<Record<string, unknown>>) : [];
  const step = steps[0];
  // Every step, not just the first: a fan-out writes one child session per step,
  // and the run's spend is all of them.
  const children = steps
    .filter((st) => typeof st?.sessionFile === "string")
    .map((st) => ({
      sessionFile: st.sessionFile as string,
      ...(typeof st.agent === "string" ? { agent: st.agent } : {}),
    }));
  return {
    ...(children.length ? { children } : {}),
    state: s.state as string | undefined,
    activityState: s.activityState as string | undefined,
    currentTool: (s.currentTool ?? step?.currentTool) as string | undefined,
    currentPath: (s.currentPath ?? step?.currentPath) as string | undefined,
    turnCount: (s.turnCount ?? step?.turnCount) as number | undefined,
    toolCount: (s.toolCount ?? step?.toolCount) as number | undefined,
    recentTools: (step?.recentTools ?? []) as Array<{ tool: string; args?: string }>,
  };
}

/** True when two consecutive reads carry the same live-progress fields (skip the push). */
export function statusUnchanged(a: SubagentStatus | null, b: SubagentStatus | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.state === b.state &&
    a.activityState === b.activityState &&
    a.currentTool === b.currentTool &&
    a.turnCount === b.turnCount &&
    a.toolCount === b.toolCount &&
    // The child session file arriving is itself news: it is what unlocks the
    // run's cost readout, and it can land on a tick where nothing else moved.
    (a.children ?? []).map((c) => c.sessionFile).join("|") ===
      (b.children ?? []).map((c) => c.sessionFile).join("|")
  );
}

/**
 * Poll one run's status.json, invoking onChange only when the live fields move.
 * Returns a stop function. Pure timing wrapper (no Electron) so it's testable.
 */
export function pollSubagentStatus(
  asyncDir: string,
  onChange: (status: SubagentStatus) => void,
  intervalMs = 500,
): () => void {
  let last: SubagentStatus | null = null;
  const tick = (): void => {
    const s = readSubagentStatus(asyncDir);
    if (s && !statusUnchanged(last, s)) {
      last = s;
      onChange(s);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
