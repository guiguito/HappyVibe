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
 * The `source` values Pi can report that HappyVibe did NOT store and therefore
 * cannot remove. Anything not in here is treated as ours (round 11's rule —
 * see below), so a credential kind Pi adds later still shows as signed in
 * rather than silently reverting to "Sign in".
 *
 * Derived from Pi's own `getProviderAuthStatus` + `configuredRequestAuthStatus`
 * and PINNED against them by `tests/auth-sources.test.ts`, because guessing one
 * of these strings is exactly what broke it the first time.
 */
export const UNMANAGED_AUTH_SOURCES: ReadonlySet<string> = new Set([
  "environment",       // an env var — .env, or the shell the app was launched from
  "env",               // kept: the spelling this file guessed before 2026-09-03
  "runtime",           // an in-process key we never set
  "models_json_command", // `!command` in models.json
  "models_json_key",   // a literal key in models.json
  "fallback",          // supplied by a provider extension
]);

/**
 * Round 11: is this provider signed in through HappyVibe — i.e. is there a
 * credential we stored and can sign out of again?
 *
 * The original test was `configured && source === "stored"`. That was replaced
 * because "stored" was only ever verified against an api_key, so any other
 * spelling for an OAuth credential would have left the card on "Sign in"
 * permanently. The deny-list shape is kept for that reason.
 *
 * What it got wrong, fixed 2026-09-03: it excluded the literal `"env"`, and Pi
 * says **`"environment"`**. So a provider that is BOTH an OAuth provider and
 * configured by an environment variable — OpenRouter with `OPENROUTER_API_KEY`
 * in a `.env` is the everyday case — rendered a "Sign out" button for a
 * credential HappyVibe never stored. `/hv-logout` had nothing to remove, so the
 * click did nothing at all, forever.
 */
export function isSignedIn(entry: AuthProviderStatus | undefined): boolean {
  return entry?.configured === true && !UNMANAGED_AUTH_SOURCES.has(entry.source ?? "");
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
