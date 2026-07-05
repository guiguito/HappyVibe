export interface UiRequest {
  id: string;
  method?: string;
  title?: string;
  options?: string[];
}

export interface PermissionInfo {
  tool: string;
  summary: string;
}

export type PermissionChoice = "Allow" | "Allow for session" | "Deny";

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
      return { tool: String(p.tool ?? ""), summary: String(p.summary ?? "") };
    }
  } catch {
    /* not JSON → not ours */
  }
  return null;
}
