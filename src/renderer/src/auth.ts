/**
 * hv.auth wire parsing — mirrors permission.ts. The bridge wraps every auth
 * UI payload in structured JSON: notify carries it in `message`, input/select
 * in `title` (pi-runtime/extensions/happyvibe-bridge.ts).
 */
export interface AuthUiRequest {
  id: string;
  method?: string;
  title?: string;
  message?: string;
  options?: string[];
}

export type AuthStage =
  | "status" | "auth_url" | "device_code" | "progress"
  | "prompt" | "manual_code" | "select"
  | "success" | "error" | "logged_out";

export interface AuthProviderStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

export interface AuthEvent {
  stage: AuthStage;
  provider?: string;
  /** notify=fire-and-forget; input/select need respondInput/respondPermission */
  reqId: string;
  method: string;
  // stage-specific payloads
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  message?: string;
  placeholder?: string;
  options?: string[];
  providers?: Record<string, AuthProviderStatus>;
}

export function parseAuth(r: AuthUiRequest): AuthEvent | null {
  const raw = r.method === "notify" ? r.message : r.title;
  try {
    const p = JSON.parse(raw ?? "");
    if (p?.kind !== "hv.auth") return null;
    return { ...p, reqId: r.id, method: r.method ?? "", options: r.options } as AuthEvent;
  } catch {
    return null; // not JSON → not ours
  }
}
