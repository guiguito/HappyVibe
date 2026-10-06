/**
 * MCP server entries: the shape pi-mcp-adapter read → the shape Pi's built-in MCP reads
 * (PRD §13, Decision 2026-10-05). PURE, zero imports: main runs it on the global
 * <agentDir>/mcp.json at launch (persisted), the bridge on a workspace .mcp.json at
 * registration (in memory — a repo file is never rewritten).
 *
 * Pi ignores unknown keys (so `disabled`/`excludeTools` silently stop working) and
 * REJECTS a non-object `auth`, `oauth: false` and SSE, skipping the whole entry
 * (core/mcp-servers.js validateMcpServerConfig). Both failure modes are handled here.
 */
export type McpEntry = Record<string, unknown>;
export const DEFAULT_EXPOSURE = "deferred";
export const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

export function isOff(e: McpEntry | undefined): boolean {
  return e?.enabled === false || e?.disabled === true;
}

export function toPiEntry(input: McpEntry): { entry: McpEntry; changed: boolean } {
  const e: McpEntry = { ...input };
  const te: Record<string, string> = isRecord(e.toolExposure) ? { ...(e.toolExposure as Record<string, string>) } : {};
  let touchedTe = false;
  if ("disabled" in e) {
    if (e.disabled === true) e.enabled = false;
    delete e.disabled;
  }
  if ("directTools" in e) {
    if (e.directTools === true && e.exposure === undefined) e.exposure = "direct";
    for (const n of names(e.directTools)) { te[n] ??= "direct"; touchedTe = true; }
    delete e.directTools;
  }
  if ("includeTools" in e) {
    const inc = names(e.includeTools);
    if (inc.length) {
      const reach = typeof e.exposure === "string" && e.exposure !== "hidden" ? e.exposure : DEFAULT_EXPOSURE;
      for (const n of inc) { te[n] ??= reach; touchedTe = true; }
      e.exposure = "hidden";
    }
    delete e.includeTools;
  }
  if ("excludeTools" in e) {
    for (const n of names(e.excludeTools)) { te[n] = "hidden"; touchedTe = true; }
    delete e.excludeTools;
  }
  const headers = isRecord(e.headers) ? (e.headers as Record<string, string>) : undefined;
  const hasAuthHeader = !!headers && Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
  const bearer = typeof e.bearerToken === "string" && e.bearerToken ? e.bearerToken
    : typeof e.bearerTokenEnv === "string" && e.bearerTokenEnv ? `\${${e.bearerTokenEnv}}` : undefined;
  if (bearer && !hasAuthHeader) e.headers = { ...(headers ?? {}), Authorization: `Bearer ${bearer}` };
  delete e.bearerToken;
  delete e.bearerTokenEnv;
  delete e.bearerTokenStore; // keychain-held: Pi cannot read it; the server asks to sign in instead
  if ("auth" in e && !isRecord(e.auth)) delete e.auth;
  if (e.oauth === false) delete e.oauth;
  if (touchedTe) e.toolExposure = te;
  if (e.exposure === undefined) e.exposure = DEFAULT_EXPOSURE;
  return { entry: e, changed: JSON.stringify(e) !== JSON.stringify(input) };
}

export function workspaceRegistrations(raw: unknown): { servers: Array<[string, McpEntry]>; errors: string[] } {
  const servers: Array<[string, McpEntry]> = [];
  const errors: string[] = [];
  const all = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : {};
  for (const [name, cfg] of Object.entries(all)) {
    if (!SERVER_NAME.test(name) || !isRecord(cfg)) { errors.push(`${name}: not a valid server entry`); continue; }
    const { entry } = toPiEntry(cfg);
    // Pi refuses `auth` (a /login provider's token) in PROJECT files so a repository cannot
    // pick where the credential goes (extensions/mcp/config.js:94) — registerMcpServer()
    // has no such check, and a cloned repo's .mcp.json reaches Pi through it.
    delete entry.auth;
    servers.push([name, entry]);
  }
  return { servers, errors };
}
