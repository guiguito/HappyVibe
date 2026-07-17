/**
 * Parse the bridge's `hv.subagent` notify (docs/validation/d1.md §hv.subagent)
 * on the main side. Electron-free + pure so vitest drives it and ipc.ts stays
 * thin. Mirrors the renderer's parseSubagentEvent — same envelope, but main only
 * cares about the lifecycle fields that drive activity gating + status polling.
 */

export type SubagentStage = "started" | "control" | "complete" | "active" | "interrupt-sent" | "interrupt-error";

export interface SubagentNotify {
  stage: SubagentStage;
  runId?: string;
  agent?: string;
  asyncDir?: string;
  status?: "success" | "error" | "interrupted";
  runs?: Array<{ runId: string; agent?: string; asyncDir: string }>;
}

/** The hv.subagent payload when this ui-request is that notify, else null. */
export function parseSubagentNotify(r: { method?: string; message?: string }): SubagentNotify | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    if (p?.kind !== "hv.subagent" || typeof p.stage !== "string") return null;
    return p as unknown as SubagentNotify;
  } catch {
    return null;
  }
}
