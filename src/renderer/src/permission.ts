import type { AskUserInfo } from "./askUser";

export interface UiRequest {
  id: string;
  method?: string;
  title?: string;
  options?: string[];
}

import type { BoundarySummary } from "../../../pi-runtime/extensions/hv-subagent-boundary";

export interface PermissionInfo {
  tool: string;
  summary: string;
  /**
   * §12: the child's resolved reach, present only on a delegation prompt.
   *
   * Typed from the bridge's own pure module so the renderer cannot drift from
   * what was enforced — the prompt and the ceiling must agree, or the user
   * approves one thing while another is applied.
   */
  boundary?: BoundarySummary;
  /** v5: set when the call reached outside the workspace root. */
  reason?: "outside-workspace";
  /** v5: the offending path, for the outside-workspace badge. */
  path?: string;
}

// Round 3 #13: "Allow for workspace" / "Always allow" persist a rule (workspace /
// global scope). They are renderer-level choices — the bridge only ever receives
// Allow / Allow for session / Deny (the persistent ones map to a bridge "Allow"
// plus a written rule).
export type PermissionChoice =
  | "Allow"
  | "Allow for session"
  | "Allow for workspace"
  | "Always allow"
  | "Deny";

/**
 * Returns {tool, summary} iff this ui-request is a HappyVibe permission
 * prompt: method === "select" AND title is JSON with kind === "hv.permission".
 * Anything else (setStatus, foreign selects…) must NOT open the modal —
 * routing those to the modal was a CRITICAL bug once.
 */
export function parsePermission(r: UiRequest): PermissionInfo | null {
  if (r.method !== "select") return null;
  try {
    const p = JSON.parse(r.title ?? "");
    if (p?.kind === "hv.permission") {
      const info: PermissionInfo = { tool: String(p.tool ?? ""), summary: String(p.summary ?? "") };
      // Validated structurally rather than trusted: a malformed boundary must
      // degrade to "no boundary block" (the prompt still shows the factual
      // summary), never throw and lose the whole prompt — which never times out
      // and would leave the agent blocked forever.
      const bnd = p.boundary as Record<string, unknown> | undefined;
      if (bnd && typeof bnd === "object" && typeof bnd.agent === "string" && Array.isArray(bnd.tools)) {
        info.boundary = {
          agent: bnd.agent,
          tools: (bnd.tools as unknown[]).filter((t): t is string => typeof t === "string"),
          declared: bnd.declared === true,
          writeCapable: Array.isArray(bnd.writeCapable) ? (bnd.writeCapable as unknown[]).filter((t): t is string => typeof t === "string") : [],
          fanout: bnd.fanout === true,
          skills: Array.isArray(bnd.skills) ? (bnd.skills as unknown[]).filter((t): t is string => typeof t === "string") : [],
          context: typeof bnd.context === "string" ? bnd.context : "fresh",
          declarations: Array.isArray(bnd.declarations) ? (bnd.declarations as unknown[]).filter((t): t is string => typeof t === "string") : [],
        };
      }
      if (p.reason === "outside-workspace") {
        info.reason = "outside-workspace";
        if (typeof p.path === "string") info.path = p.path;
      }
      return info;
    }
  } catch {
    /* not JSON → not ours */
  }
  return null;
}

// ── B4: cross-session pending queues + dangerous mode ──────────────────────

/**
 * V2.B: the queue carries permission prompts AND ask_user questions —
 * headFor/pendingCounts/dropSession only read req.sessionId, so badges and
 * routing work identically for both kinds.
 */
export type QueuedPrompt =
  | { kind: "permission"; req: UiRequest & { sessionId?: string }; info: PermissionInfo }
  | { kind: "askUser"; req: UiRequest & { sessionId?: string }; ask: AskUserInfo };

/**
 * The prompt the modal should show for the focused session: its oldest
 * pending one. Prompts without a session (utility client) always surface —
 * a prompt nobody can see would violate "never auto-allow, never time out".
 */
export function headFor(queue: QueuedPrompt[], selectedId: string | null): QueuedPrompt | null {
  return queue.find((q) => !q.req.sessionId || q.req.sessionId === "__utility__" || q.req.sessionId === selectedId) ?? null;
}

/** Drop a session's pending prompts (its Pi exited — nothing left to answer). */
export function dropSession(queue: QueuedPrompt[], sessionId: string): QueuedPrompt[] {
  return queue.filter((q) => q.req.sessionId !== sessionId);
}

/**
 * Parses an hv.dangerous notify → true/false (mode on/off), null when the
 * request is anything else (incl. the usage-error notify, which has no `on`).
 */
export function parseDangerous(r: UiRequest & { message?: string }): boolean | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "");
    if (p?.kind === "hv.dangerous" && typeof p.on === "boolean") return p.on;
  } catch {
    /* not JSON → not ours */
  }
  return null;
}

/** §23: an hv.plan mode notify → {enabled, planPath}, null otherwise. */
export function parsePlan(
  r: UiRequest & { message?: string },
): { enabled: boolean; planPath?: string; restored: boolean } | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "");
    if (p?.kind === "hv.plan" && typeof p.enabled === "boolean") {
      return {
        enabled: p.enabled,
        planPath: typeof p.planPath === "string" ? p.planPath : undefined,
        // The bridge sets this on the session_start replay only. The caller must
        // not append a bottom plan card for a replay — the card belongs at its
        // position in restored history, or nowhere if compaction dropped it.
        restored: p.restored === true,
      };
    }
  } catch {
    /* not ours */
  }
  return null;
}

/** §23: an hv.plan.blocked notify → the blocked tool-call id, null otherwise. */
/**
 * §35: this session is a scheduled READ-ONLY run.
 *
 * A notify rather than restored state, because the mode comes from the
 * environment at every spawn — a respawn simply re-announces it, and there is
 * nothing on disk that could go stale.
 */
export function parseReadonlyRun(r: UiRequest & { message?: string }): boolean {
  if (r.method !== "notify") return false;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; enabled?: boolean };
    return p?.kind === "hv.readonly" && p.enabled === true;
  } catch {
    return false;
  }
}

export function parsePlanBlocked(r: UiRequest & { message?: string }): { toolCallId: string } | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "");
    if (p?.kind === "hv.plan.blocked" && typeof p.toolCallId === "string") return { toolCallId: p.toolCallId };
  } catch {
    /* not ours */
  }
  return null;
}
