/**
 * §39 — one turn's counts, from the tool events main already sees. Counts,
 * never content: the edited-file set exists only to dedupe and is dropped at
 * end(). A turn ends once — an agent_end after a pi_exit (or the reverse) is null.
 */
import { isDelegationTool } from "../../../pi-runtime/extensions/hv-rules";
import type { UsageParams } from "./events";

export type TurnEnd = { outcome: "completed" | "aborted" } | { outcome: "error"; errorKind: string };
interface Turn {
  startedAt: number;
  scheduled: boolean;
  toolCalls: number;
  files: Set<string>;
  subagentRuns: number;
}
const EDIT_TOOLS = new Set(["edit", "write"]);

export class TurnTracker {
  private turns = new Map<string, Turn>();

  start(sessionId: string, scheduled: boolean, now = Date.now()): void {
    this.turns.set(sessionId, { startedAt: now, scheduled, toolCalls: 0, files: new Set(), subagentRuns: 0 });
  }

  isBusy(sessionId: string): boolean {
    return this.turns.has(sessionId);
  }

  onEvent(sessionId: string, e: { type: string; toolName?: string; args?: unknown }): void {
    const t = this.turns.get(sessionId);
    if (!t || e.type !== "tool_execution_start" || !e.toolName) return;
    t.toolCalls++;
    if (isDelegationTool(e.toolName)) t.subagentRuns++;
    const p = (e.args as { path?: unknown } | undefined)?.path;
    if (EDIT_TOOLS.has(e.toolName) && typeof p === "string") t.files.add(p);
  }

  end(sessionId: string, how: TurnEnd, now = Date.now()): UsageParams | null {
    const t = this.turns.get(sessionId);
    if (!t) return null;
    this.turns.delete(sessionId);
    return {
      outcome: how.outcome,
      ...(how.outcome === "error" ? { errorKind: how.errorKind } : {}),
      durationSec: Math.round((now - t.startedAt) / 1000),
      toolCalls: t.toolCalls,
      filesEdited: t.files.size,
      subagentRuns: t.subagentRuns,
      scheduled: t.scheduled,
    };
  }
}
