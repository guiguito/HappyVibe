/**
 * mcpAuthStore — per-flow OAuth state ONLY (PKCE verifier + CSRF state).
 *
 * Credentials do NOT live here any more. pi-mcp-adapter >=2.17.0 keeps them in
 * the OS keychain and treats a plaintext `tokens.json` as a legacy artefact to
 * import and DELETE, so main persists tokens and client info through
 * mcpAdapterStore instead. See docs/validation/m1.md §Phase 3.
 *
 * What is left is transient state that only main reads and that lives for the
 * duration of one browser round-trip. It is written to `flow.json`, NOT
 * `tokens.json`, and the filename is load-bearing: the adapter's legacy-import
 * path looks for `tokens.json` specifically, so writing flow state there would
 * let it import and delete our PKCE verifier in the middle of an authorization
 * — turning every re-auth into "No code verifier saved for MCP server".
 *
 * Electron-free (no global env reads) so it stays vitest-importable.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { AdapterStore } from "./mcpAdapterStore.js";

/** Transient per-flow state. Deliberately NOT credential-shaped. */
export interface FlowState {
  codeVerifier?: string;
  oauthState?: string;
}

/** <agentDir>/mcp-oauth/sha256-<sha256hex(name)> */
export function serverDir(agentDir: string, name: string): string {
  const hash = createHash("sha256").update(name, "utf8").digest("hex");
  return join(agentDir, "mcp-oauth", `sha256-${hash}`);
}

/** serverDir + /flow.json — ours, and invisible to the adapter. */
export function flowPath(agentDir: string, name: string): string {
  return join(serverDir(agentDir, name), "flow.json");
}

/**
 * serverDir + /tokens.json — the LEGACY credential file main used to write.
 * Exported only so the sweep below (and its test) can find it; nothing writes
 * to this path any more.
 */
export function legacyAuthEntryPath(agentDir: string, name: string): string {
  return join(serverDir(agentDir, name), "tokens.json");
}

export function readFlowState(agentDir: string, name: string): FlowState | undefined {
  const p = flowPath(agentDir, name);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as FlowState;
  } catch {
    return undefined;
  }
}

/** Dir mode 0o700, file mode 0o600 — same care as the credentials it replaces. */
export function writeFlowState(agentDir: string, name: string, state: FlowState): void {
  const dir = serverDir(agentDir, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(flowPath(agentDir, name), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/**
 * Blank the file (0o600) first, THEN remove the dir — a partial failure must
 * never leave a readable file behind. Same order the credential delete used.
 */
export function clearFlowState(agentDir: string, name: string): void {
  const p = flowPath(agentDir, name);
  if (existsSync(p)) writeFileSync(p, "{}", { mode: 0o600 });
  const dir = serverDir(agentDir, name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/**
 * One-time migration of the credentials main wrote before it stopped owning
 * this store.
 *
 * A CONFIGURED server is handed to the adapter first: a migrating read imports
 * its file into the keychain and deletes it, so no live credential is lost. An
 * ORPHAN — a server no longer in any mcp.json — is deleted outright: we cannot
 * know its URL, nothing reads it, and nobody will ever migrate it, so leaving a
 * plaintext credential on disk for a server the user believes they removed is
 * the worse of the two outcomes. (Found on a real install: a `canva` entry from
 * a server that had long since been deconfigured.)
 */
export async function sweepLegacyCredentials(
  agentDir: string,
  configured: readonly { name: string; url: string }[],
  store: AdapterStore,
): Promise<{ migrated: number; deleted: number }> {
  const root = join(agentDir, "mcp-oauth");
  if (!existsSync(root)) return { migrated: 0, deleted: 0 };

  // Ask the adapter to MIGRATE every configured server that still has a file.
  // A plain read would not do it — the read path is deliberately non-migrating,
  // so that a status probe never consumes anything.
  const before = configured.filter((s) => existsSync(legacyAuthEntryPath(agentDir, s.name)));
  if (before.length) {
    try {
      await store.migrate(before.map((s) => s.name));
    } catch {
      // The store being unavailable is not a reason to start deleting files.
      return { migrated: 0, deleted: 0 };
    }
  }
  const migrated = before.filter((s) => !existsSync(legacyAuthEntryPath(agentDir, s.name))).length;

  const keep = new Set(configured.map((s) => serverDir(agentDir, s.name)));
  let deleted = 0;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    const legacy = join(dir, "tokens.json");
    if (keep.has(dir) || !existsSync(legacy)) continue;
    writeFileSync(legacy, "{}", { mode: 0o600 });
    rmSync(dir, { recursive: true, force: true });
    deleted++;
  }
  return { migrated, deleted };
}
