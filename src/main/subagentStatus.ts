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
  const step = Array.isArray(s.steps) ? (s.steps[0] as Record<string, unknown> | undefined) : undefined;
  return {
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
    a.toolCount === b.toolCount
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
