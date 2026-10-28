/**
 * Web mode — whether to serve, and where. Read once at startup from the
 * environment, like every other `HV_*` switch:
 *
 *   HV_SERVE=8787          serve on 127.0.0.1:8787 (`1`/`true`/`on`/`yes`: the default port)
 *   HV_SERVE_HOST=0.0.0.0  listen beyond this machine (the token still guards it)
 *   HV_SERVE_TOKEN=…       a fixed token, so a bookmarked link survives a restart
 *
 * Unset, empty or `0` means no server — the desktop app exactly as before.
 * Imports nothing.
 */

export const DEFAULT_SERVE_PORT = 8787;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Whether a host name or address is this machine only. */
export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host);
}

export interface ServeConfig {
  host: string;
  port: number;
  token?: string;
}

/** A value that cannot be what the user meant throws — a server on a port they did not ask for is worse than none. */
export function serveConfig(env: Record<string, string | undefined>): ServeConfig | null {
  const raw = (env.HV_SERVE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "0" || raw === "false" || raw === "off" || raw === "no") return null;
  let port: number;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") port = DEFAULT_SERVE_PORT;
  else if (/^\d+$/.test(raw) && Number(raw) >= 1024 && Number(raw) <= 65535) port = Number(raw);
  else throw new Error(`HV_SERVE must be a port between 1024 and 65535 (or 1 for ${DEFAULT_SERVE_PORT}), not "${env.HV_SERVE}".`);

  const host = (env.HV_SERVE_HOST ?? "").trim() || "127.0.0.1";
  const token = (env.HV_SERVE_TOKEN ?? "").trim();
  // 22 characters of this alphabet is 128 bits — the floor for a secret that opens a shell.
  if (token && (token.length < 22 || !/^[A-Za-z0-9_-]+$/.test(token))) {
    throw new Error("HV_SERVE_TOKEN must be at least 22 characters of letters, digits, '-' or '_' (a random one: openssl rand -base64 24 | tr '+/' '-_' | tr -d '=').");
  }
  return { host, port, ...(token ? { token } : {}) };
}
