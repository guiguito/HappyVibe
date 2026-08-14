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

import type { AdapterStore, AdapterEntry } from "./mcpAdapterStore.js";

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

/** The legacy shape main used to write. Read only by the sweep below. */
interface LegacyEntry {
  tokens?: { accessToken?: string; refreshToken?: string; expiresAt?: number; scope?: string };
  clientInfo?: { clientId: string; clientSecret?: string; redirectUris?: string[] };
  serverUrl?: string;
}

function readLegacyEntry(agentDir: string, name: string): LegacyEntry | undefined {
  try {
    return JSON.parse(readFileSync(legacyAuthEntryPath(agentDir, name), "utf-8")) as LegacyEntry;
  } catch {
    return undefined;
  }
}

/**
 * One-time migration of the credentials main wrote before it stopped owning
 * this store.
 *
 * The obvious implementation — "ask the adapter to migrate, it knows how" — is
 * WRONG, and destructively so. The adapter's migrating read returns the KEYCHAIN
 * entry whenever one exists and deletes the legacy file **unread**
 * (`readAuthEntryFromStore`: `if (payload !== undefined) { … removeLegacyAuthEntry(); return entry }`).
 * On a real install that is exactly backwards: `miro` had an expired keychain
 * copy from 4 August beside a file main had rewritten that morning, so migrating
 * would have discarded the only usable credential and kept the dead one.
 *
 * So main compares the two itself and adopts its own only when it is strictly
 * better, then removes the file either way. An ORPHAN — a server no longer in
 * any mcp.json — is deleted outright: we cannot know its URL, nothing reads it,
 * and nobody will ever migrate it, so leaving a plaintext credential on disk for
 * a server the user believes they removed is the worse of the two outcomes.
 * (Also real: a `canva` entry for a server deconfigured ten days earlier.)
 */
export async function sweepLegacyCredentials(
  agentDir: string,
  configured: readonly { name: string; url: string }[],
  store: AdapterStore,
): Promise<{ adopted: number; discarded: number; deleted: number }> {
  const root = join(agentDir, "mcp-oauth");
  if (!existsSync(root)) return { adopted: 0, discarded: 0, deleted: 0 };

  const withFile = configured.filter((s) => existsSync(legacyAuthEntryPath(agentDir, s.name)));
  let adopted = 0;
  let discarded = 0;

  if (withFile.length) {
    let current: Record<string, AdapterEntry>;
    try {
      current = await store.read(withFile);
    } catch {
      // A store that cannot answer is not a licence to delete the only copy.
      return { adopted: 0, discarded: 0, deleted: 0 };
    }

    for (const s of withFile) {
      const mine = readLegacyEntry(agentDir, s.name);
      const entry = current[s.name];
      const theirs = entry?.status === "present" ? entry.tokens : undefined;
      // Adopt only when ours is genuinely better: they have nothing, or ours
      // outlives theirs. A missing expiry on either side is not evidence, so it
      // loses — the adapter may have refreshed silently and we would not know.
      const better =
        !!mine?.tokens?.accessToken &&
        (!theirs?.accessToken ||
          (mine.tokens.expiresAt !== undefined &&
            theirs.expiresAt !== undefined &&
            mine.tokens.expiresAt > theirs.expiresAt));
      if (better && mine?.tokens?.accessToken) {
        try {
          if (mine.clientInfo) await store.writeClientInfo(s.name, s.url, mine.clientInfo);
          await store.writeTokens(s.name, s.url, {
            accessToken: mine.tokens.accessToken,
            refreshToken: mine.tokens.refreshToken,
            expiresAt: mine.tokens.expiresAt,
            scope: mine.tokens.scope,
          });
          adopted++;
        } catch {
          continue; // leave the file rather than lose it to a failed write
        }
      } else if (mine?.tokens?.accessToken) {
        discarded++;
      }
      clearLegacyFile(agentDir, s.name);
    }
  }

  const keep = new Set(configured.map((s) => serverDir(agentDir, s.name)));
  let deleted = 0;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (keep.has(dir) || !existsSync(join(dir, "tokens.json"))) continue;
    writeFileSync(join(dir, "tokens.json"), "{}", { mode: 0o600 });
    rmSync(dir, { recursive: true, force: true });
    deleted++;
  }
  return { adopted, discarded, deleted };
}

/** Blank then unlink — never leave a readable credential behind on a partial failure. */
function clearLegacyFile(agentDir: string, name: string): void {
  const p = legacyAuthEntryPath(agentDir, name);
  if (!existsSync(p)) return;
  writeFileSync(p, "{}", { mode: 0o600 });
  rmSync(p, { force: true });
}
