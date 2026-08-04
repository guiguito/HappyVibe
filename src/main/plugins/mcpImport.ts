import type { McpServerConfig } from "../mcp";

/**
 * §25 — normalise a PLUGIN's MCP server config for the vendored adapter.
 *
 * A plugin author writes their `.mcp.json` for a host that always performs OAuth
 * explicitly. Our adapter instead auto-detects it, and switches that
 * auto-detection off the moment any custom header is present
 * (`mcp-auth-flow.ts`: *"Configured custom headers take precedence over implicit
 * OAuth auto-detection"*).
 *
 * That heuristic is correct for `Authorization: Bearer …` — there the header IS
 * the credential — and wrong for a header that carries no credential at all. The
 * Miro plugin ships `X-AI-Source: claude-code-plugin`, a vendor telemetry tag, so
 * its server connected UNAUTHENTICATED inside a session and every call failed,
 * while the MCP page's own sign-in and tool listing worked perfectly, because
 * main's connect path does OAuth explicitly. Symptom without the cause: "I can
 * log in and list tools, but I can't use it in a session."
 *
 * So when a remote server's headers contain nothing that looks like a credential,
 * declare `auth: "oauth"` and restore the adapter's own default behaviour.
 *
 * Conservative on purpose: anything that MIGHT be a credential is left alone, so
 * the fallback is the adapter's existing behaviour rather than an OAuth flow
 * fighting a key the author already supplied. Pinned end-to-end by
 * `tests/mcp-plugin-import-auth.test.ts`, which asserts the adapter's own
 * `supportsOAuth` returns true afterwards — delete this the day a pin bump makes
 * the adapter distinguish auth headers itself.
 */

/**
 * Header-name fragments that could carry a credential. Substring match, so
 * `x-consumer-api-key`, `X-Auth-Token` and `Proxy-Authorization` all count.
 */
const CREDENTIAL_HINTS = ["auth", "key", "token", "secret", "credential", "password", "bearer"];

function looksLikeCredential(headerName: string): boolean {
  const n = headerName.toLowerCase();
  return CREDENTIAL_HINTS.some((h) => n.includes(h));
}

/**
 * @returns the config to write. Unchanged unless it is a remote server with
 * headers that are all non-credential and no explicit auth choice of its own.
 */
export function normalizePluginMcpServer(cfg: McpServerConfig): McpServerConfig {
  // stdio servers never authenticate; nothing to decide.
  if (typeof cfg.url !== "string" || !cfg.url) return cfg;
  // Respect whatever the author chose, including turning auth off.
  if (cfg.auth !== undefined || cfg.oauth !== undefined) return cfg;
  const headers = cfg.headers;
  if (!headers || Object.keys(headers).length === 0) return cfg; // auto-detect already works
  if (Object.keys(headers).some(looksLikeCredential)) return cfg; // the headers are the auth
  return { ...cfg, auth: "oauth" };
}
