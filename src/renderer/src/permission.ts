import type { AskUserInfo } from "./askUser";

export interface UiRequest {
  id: string;
  method?: string;
  title?: string;
  options?: string[];
}

export interface PermissionInfo {
  tool: string;
  summary: string;
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

/** Pending prompt count per session — sidebar attention dots. */
export function pendingCounts(queue: QueuedPrompt[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of queue) {
    const sid = q.req.sessionId;
    if (sid) out[sid] = (out[sid] ?? 0) + 1;
  }
  return out;
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
export function parsePlan(r: UiRequest & { message?: string }): { enabled: boolean; planPath?: string } | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "");
    if (p?.kind === "hv.plan" && typeof p.enabled === "boolean") {
      return { enabled: p.enabled, planPath: typeof p.planPath === "string" ? p.planPath : undefined };
    }
  } catch {
    /* not ours */
  }
  return null;
}

/** §23: an hv.plan.blocked notify → the blocked tool-call id, null otherwise. */
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
