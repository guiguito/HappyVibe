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

/**
 * Round 11: is this provider signed in through HappyVibe?
 *
 * The old test was `configured && source === "stored"` — "stored" is what Pi
 * reports for an **api_key** credential, and the only test evidence we had was
 * an api_key. Any other spelling for an OAuth credential therefore left the card
 * on "Sign in" permanently, even after a successful browser round-trip.
 *
 * So: any credential Pi has is signed in, EXCEPT one coming from the
 * environment — that one HappyVibe did not store and cannot sign out of.
 */
export function isSignedIn(entry: AuthProviderStatus | undefined): boolean {
  return entry?.configured === true && entry.source !== "env";
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
