import type { McpServerConfig } from "./mcp";

/**
 * MCP servers HappyVibe can never authenticate with, because the vendor issues
 * credentials only to an allowlist of pre-registered clients while
 * `mcpOAuth.ts` implements **Dynamic Client Registration only**.
 *
 * §25 uses this to keep such plugins out of the store entirely: a card that
 * installs a server which can never connect is worse than no card.
 *
 * THE CRITERION IS "no DCR **and** no token path" — not "no DCR".
 * GitHub advertises no `registration_endpoint` either, and a rule written the
 * obvious way would exclude the most-installed connector in the research. Its
 * server genuinely evaluates a bearer PAT (a bad one returns
 * `401 invalid_token` rather than rejecting the method), which is exactly why
 * the MCP catalog ships GitHub as a *token* entry. So a host belongs here only
 * when there is no way in at all.
 *
 * Audited live 2026-08-01 (see the Notion "Curated MCP List"); the same audit
 * cleared Atlassian, Notion, Linear, Supabase and Neon, which is pinned by
 * `tests/mcp-catalog.test.ts`.
 */
export interface PreregisteredHost {
  /** Registrable host, matched exactly or as a parent of the server's host. */
  host: string;
  vendor: string;
  /** Shown to the user as the reason a plugin is not offered. */
  reason: string;
}

export const PREREGISTERED_OAUTH_HOSTS: PreregisteredHost[] = [
  {
    host: "mcp.figma.com",
    vendor: "Figma",
    reason:
      "Figma only authorises MCP clients it has pre-registered, so HappyVibe cannot obtain credentials for it",
  },
  {
    host: "mcp.slack.com",
    vendor: "Slack",
    reason:
      "Slack requires a pre-registered app with its own client secret, so HappyVibe cannot obtain credentials for it",
  },
];

/** Hosts that are always the user's own machine — never a vendor's allowlist. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * The vendor blocking this server, or null when it can work here.
 *
 * A stdio server (`command`, no `url`) never authenticates, so it is never
 * blocked. Loopback is never blocked either: Figma's local Dev Mode server
 * (`http://127.0.0.1:3845/mcp`) is unauthenticated and works — it merely needs
 * the desktop app running, which is a different problem from having no way to
 * register a client.
 */
export function preregisteredVendor(cfg: McpServerConfig): PreregisteredHost | null {
  const url = typeof cfg.url === "string" ? cfg.url.trim() : "";
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null; // not a URL we can reason about — other checks will catch it
  }
  if (LOOPBACK.has(host)) return null;
  return (
    PREREGISTERED_OAUTH_HOSTS.find(
      // Exact, or a subdomain OF the listed host — never a suffix match, which
      // would let "mcp.figma.com.attacker.test" pass as Figma.
      (h) => host === h.host || host.endsWith(`.${h.host}`),
    ) ?? null
  );
}
