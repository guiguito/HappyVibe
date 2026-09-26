/**
 * tintinweb's lifecycle → HappyVibe's `hv.subagent` notifies (PRD §12, 2026-09-26).
 *
 * The envelope is the SAME one the nicobailon relay sends (stage started/complete/
 * active/interrupt-*), so main's activity gate, audit rows and the renderer's cards
 * need no second parser. The mapping is pure (`twNotify`) so vitest pins it against
 * the captured wire shapes (docs/validation/d1.md § tintinweb wire shapes).
 *
 * Children run IN this Pi process, so a respawn ends them all: `running` is the whole
 * truth about what is live, and after a respawn it is empty — which is exactly what
 * the `/hv-subagent-list` resync must report.
 */

export interface TwNotify {
  stage: "started" | "complete" | "session" | "workflow-progress";
  runId: string;
  agent?: string;
  task?: string;
  status?: "success" | "error" | "interrupted";
  summary?: string;
  sessionFile?: string;
  entries?: unknown[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** One bus event → the notify main already understands, or null for events it does not need. */
export function twNotify(event: string, payload: unknown): TwNotify | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (event === "subagents:workflow-progress") {
    const runId = str(p.runId);
    return runId ? { stage: "workflow-progress", runId, entries: Array.isArray(p.entries) ? p.entries : [] } : null;
  }
  const runId = str(p.id);
  if (!runId) return null;
  if (event === "subagents:started") {
    return { stage: "started", runId, agent: str(p.type), task: str(p.description) };
  }
  if (event === "subagents:completed" || event === "subagents:failed") {
    // "stopped" is a user STOP (agent-manager.ts:601); "aborted" is a hard abort and
    // "error" a failure — both read as errors, never as the user having stopped it.
    const status = event === "subagents:completed" ? "success" : p.status === "stopped" ? "interrupted" : "error";
    const text = str(p.result) ?? str(p.error) ?? "";
    return { stage: "complete", runId, agent: str(p.type), status, summary: text.slice(0, 500) };
  }
  return null;
}

/** Everything the relay needs from the bridge, injected so the wiring stays testable. */
export interface TwRelayDeps {
  on(event: string, handler: (payload: unknown) => void): unknown;
  relay(n: TwNotify): void;
  /** The child's session file, once tintinweb has built its session (registry lookup). */
  sessionFileOf(runId: string): string | undefined;
  /** Called with each completed run's FULL result (the delivery repair's store). */
  onResult?(runId: string, agent: string | undefined, result: string): void;
}

/** Subscribe the relay; returns the live set of running run ids. */
export function registerTwRelay(deps: TwRelayDeps, pollMs = 200, giveUpMs = 15_000): Set<string> {
  const running = new Set<string>();
  for (const ev of ["subagents:started", "subagents:completed", "subagents:failed", "subagents:workflow-progress"]) {
    deps.on(ev, (payload) => {
      const n = twNotify(ev, payload);
      if (!n) return;
      if (n.stage === "started") {
        running.add(n.runId);
        deps.relay(n);
        watchSessionFile(n.runId);
      } else if (n.stage === "complete") {
        running.delete(n.runId);
        const result = (payload as { result?: unknown }).result;
        if (typeof result === "string") deps.onResult?.(n.runId, n.agent, result);
        deps.relay(n);
      } else {
        deps.relay(n);
      }
    });
  }
  // The session is built shortly AFTER `started` (measured ~2 s, tw1.md check 6), so the
  // file path is announced on its own stage once it exists.
  const watchSessionFile = (runId: string): void => {
    const t0 = Date.now();
    const tick = (): void => {
      const f = deps.sessionFileOf(runId);
      if (f) { deps.relay({ stage: "session", runId, sessionFile: f }); return; }
      if (running.has(runId) && Date.now() - t0 < giveUpMs) setTimeout(tick, pollMs).unref?.();
    };
    tick();
  };
  return running;
}
