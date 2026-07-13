/**
 * mcpAuthStore — electron-free MCP OAuth token store.
 * Mirrors the on-disk format of pi-mcp-adapter/mcp-auth.ts exactly so that
 * main-process and the adapter read/write the same files.
 * Takes agentDir explicitly (no global env reads) so it is vitest-importable.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Interfaces mirror pi-mcp-adapter/mcp-auth.ts lines 17-40 verbatim.
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in seconds
  scope?: string;
}

export interface StoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
}

export interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

/** <agentDir>/mcp-oauth/sha256-<sha256hex(name)> */
export function serverDir(agentDir: string, name: string): string {
  const hash = createHash("sha256").update(name, "utf8").digest("hex");
  return join(agentDir, "mcp-oauth", `sha256-${hash}`);
}

/** serverDir + /tokens.json */
export function authEntryPath(agentDir: string, name: string): string {
  return join(serverDir(agentDir, name), "tokens.json");
}

/** Read AuthEntry from disk; returns undefined if missing or unreadable. */
export function readAuthEntry(agentDir: string, name: string): AuthEntry | undefined {
  const p = authEntryPath(agentDir, name);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as AuthEntry;
  } catch {
    return undefined;
  }
}

/** Write AuthEntry to disk. Dir mode 0o700, file mode 0o600. */
export function writeAuthEntry(agentDir: string, name: string, entry: AuthEntry): void {
  const dir = serverDir(agentDir, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(authEntryPath(agentDir, name), JSON.stringify(entry, null, 2), { mode: 0o600 });
}

/**
 * Remove all stored credentials for a server. Blanks tokens.json (mode 0o600)
 * first, THEN removes the dir — mirrors adapter removeAuthEntry (mcp-auth.ts
 * 142-155) so a partial failure never leaves readable secrets on disk.
 */
export function deleteAuthEntry(agentDir: string, name: string): void {
  const p = authEntryPath(agentDir, name);
  if (existsSync(p)) writeFileSync(p, "{}", { mode: 0o600 });
  const dir = serverDir(agentDir, name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/**
 * Mirrors adapter's getAuthForUrl validity check (mcp-auth.ts lines 114-125)
 * plus token expiry (isTokenExpired, lines 260-265).
 * Returns "needs-auth" when: no entry, serverUrl mismatch, or token expired.
 */
export function authState(
  agentDir: string,
  name: string,
  url: string
): "authenticated" | "needs-auth" {
  const entry = readAuthEntry(agentDir, name);
  if (!entry?.serverUrl || entry.serverUrl !== url) return "needs-auth";
  // ponytail: expiresAt is seconds; Date.now() is ms
  if (entry.tokens?.expiresAt !== undefined && entry.tokens.expiresAt < Date.now() / 1000) {
    return "needs-auth";
  }
  return "authenticated";
}
