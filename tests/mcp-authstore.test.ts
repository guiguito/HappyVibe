/**
 * mcpAuthStore holds PKCE/CSRF state ONLY since 2026-08-14. Credentials live in
 * the OS keychain, reached through mcpAdapterStore — see docs/validation/m1.md
 * §Phase 3. What these cases guard is that nothing credential-shaped comes back,
 * and that the file main used to write gets cleaned up rather than left on disk.
 */
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  serverDir,
  flowPath,
  legacyAuthEntryPath,
  readFlowState,
  writeFlowState,
  clearFlowState,
  sweepLegacyCredentials,
} from "../src/main/mcpAuthStore";
import type { AdapterStore } from "../src/main/mcpAdapterStore";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-auth-test-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

/** Writes the plaintext file main used to produce, so the sweep has something to find. */
function writeLegacyEntry(agentDir: string, name: string, entry: unknown): void {
  const p = legacyAuthEntryPath(agentDir, name);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(entry), { mode: 0o600 });
}

const noopStore = (over: Partial<AdapterStore> = {}): AdapterStore => ({
  read: async () => ({}),
  migrate: async () => undefined,
  writeTokens: async () => undefined,
  writeClientInfo: async () => undefined,
  remove: async () => undefined,
  ...over,
});

describe("mcpAuthStore flow state", () => {
  it("legacyAuthEntryPath still matches the adapter's own path", async () => {
    // The sweep has to find exactly the file the adapter would import, so this
    // path equality outlives the credentials that used to live at it.
    const { getAuthEntryFilePath } = await import(
      "../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts"
    );
    const priorPiDir = process.env.PI_CODING_AGENT_DIR;
    const priorMcpDir = process.env.MCP_OAUTH_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = tmp;
      delete process.env.MCP_OAUTH_DIR;
      expect(legacyAuthEntryPath(tmp, "notion")).toBe(getAuthEntryFilePath("notion"));
    } finally {
      if (priorPiDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorPiDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      if (priorMcpDir !== undefined) process.env.MCP_OAUTH_DIR = priorMcpDir;
      else delete process.env.MCP_OAUTH_DIR;
    }
  });

  it("flow state is NOT written where the adapter would import it", () => {
    // Load-bearing, not cosmetic: the adapter's legacy path looks for
    // tokens.json specifically. Flow state living there would be imported and
    // DELETED mid-authorization, turning every re-auth into "No code verifier
    // saved for MCP server".
    expect(flowPath(tmp, "notion").endsWith("flow.json")).toBe(true);
    expect(flowPath(tmp, "notion")).not.toBe(legacyAuthEntryPath(tmp, "notion"));
  });

  it("round-trips flow state", () => {
    writeFlowState(tmp, "notion", { codeVerifier: "v-1", oauthState: "s-1" });
    expect(readFlowState(tmp, "notion")).toEqual({ codeVerifier: "v-1", oauthState: "s-1" });
  });

  it("returns undefined for an unknown server and for malformed json", () => {
    expect(readFlowState(tmp, "never-seen")).toBeUndefined();
    mkdirSync(serverDir(tmp, "broken"), { recursive: true });
    writeFileSync(flowPath(tmp, "broken"), "{not json");
    expect(readFlowState(tmp, "broken")).toBeUndefined();
  });

  it("clearFlowState leaves no readable file", () => {
    writeFlowState(tmp, "notion", { codeVerifier: "v-1" });
    clearFlowState(tmp, "notion");
    expect(readFlowState(tmp, "notion")).toBeUndefined();
    expect(existsSync(serverDir(tmp, "notion"))).toBe(false);
  });

  it("never writes a token or client secret to disk", () => {
    // The point of the split: with nothing credential-shaped left on disk there
    // is nothing for the adapter's legacy-import path to consume.
    writeFlowState(tmp, "notion", { codeVerifier: "v-1", oauthState: "s-1" });
    expect(readFileSync(flowPath(tmp, "notion"), "utf-8")).not.toMatch(
      /accessToken|refreshToken|clientSecret/,
    );
  });
});

describe("sweepLegacyCredentials", () => {
  const NOTION = [{ name: "notion", url: "https://mcp.notion.com/mcp" }];
  const soon = Math.floor(Date.now() / 1000) + 3600;
  const past = Math.floor(Date.now() / 1000) - 3600;

  it("deletes an orphan's plaintext credential", async () => {
    writeLegacyEntry(tmp, "gone-server", { tokens: { accessToken: "orphan-tok" } });
    const res = await sweepLegacyCredentials(tmp, [], noopStore(), {});
    expect(res.deleted).toBe(1);
    expect(existsSync(serverDir(tmp, "gone-server"))).toBe(false);
  });

  it("ADOPTS our copy when the adapter's is older — the case that loses a live credential", async () => {
    // This is the real `miro`: an expired keychain copy beside a file main had
    // just rewritten. Letting the adapter "migrate" would keep the dead one and
    // silently delete the good one, so main decides instead.
    writeLegacyEntry(tmp, "notion", { tokens: { accessToken: "fresh-tok", expiresAt: soon } });
    const writes: { name: string; url: string; tokens: { accessToken?: string } }[] = [];
    const res = await sweepLegacyCredentials(tmp, NOTION, noopStore({
      writeTokens: async (name, url, tokens) => { writes.push({ name, url, tokens }); },
    }), { notion: { status: "present", tokens: { accessToken: "stale-tok", expiresAt: past } } });
    expect(writes).toHaveLength(1);
    expect(writes[0].tokens.accessToken).toBe("fresh-tok");
    expect(res.adopted).toBe(1);
    expect(existsSync(legacyAuthEntryPath(tmp, "notion"))).toBe(false);
  });

  it("adopts ours when the adapter has nothing at all", async () => {
    writeLegacyEntry(tmp, "notion", { tokens: { accessToken: "only-copy", expiresAt: soon } });
    const res = await sweepLegacyCredentials(tmp, NOTION, noopStore(), { notion: { status: "absent" } });
    expect(res.adopted).toBe(1);
  });

  it("DISCARDS ours when the adapter's outlives it — it may have refreshed since", async () => {
    writeLegacyEntry(tmp, "notion", { tokens: { accessToken: "old-tok", expiresAt: past } });
    const writes: unknown[] = [];
    const res = await sweepLegacyCredentials(tmp, NOTION, noopStore({
      writeTokens: async (...a) => { writes.push(a); },
    }), { notion: { status: "present", tokens: { accessToken: "newer-tok", expiresAt: soon } } });
    expect(writes).toHaveLength(0);
    expect(res).toMatchObject({ adopted: 0, discarded: 1 });
    expect(existsSync(legacyAuthEntryPath(tmp, "notion"))).toBe(false);
  });

  it("touches nothing when the credential store is unavailable", async () => {
    // A store that cannot answer is not a licence to start removing the only
    // copy of someone's credentials.
    writeLegacyEntry(tmp, "notion", { tokens: { accessToken: "live-tok" } });
    writeLegacyEntry(tmp, "gone-server", { tokens: { accessToken: "orphan-tok" } });
    const res = await sweepLegacyCredentials(tmp, NOTION, noopStore(),
      { notion: { status: "unavailable", message: "keyring locked" } });
    expect(res).toEqual({ adopted: 0, discarded: 0, deleted: 0 });
    expect(existsSync(legacyAuthEntryPath(tmp, "notion"))).toBe(true);
    expect(existsSync(legacyAuthEntryPath(tmp, "gone-server"))).toBe(true);
  });

  it("keeps the file when adopting it fails, rather than losing it", async () => {
    writeLegacyEntry(tmp, "notion", { tokens: { accessToken: "only-copy", expiresAt: soon } });
    const res = await sweepLegacyCredentials(tmp, NOTION, noopStore({
      writeTokens: async () => { throw new Error("keyring write failed"); },
    }), { notion: { status: "absent" } });
    expect(res.adopted).toBe(0);
    expect(existsSync(legacyAuthEntryPath(tmp, "notion"))).toBe(true);
  });

  it("is a no-op when there is no mcp-oauth directory at all", async () => {
    expect(await sweepLegacyCredentials(tmp, [], noopStore(), {}))
      .toEqual({ adopted: 0, discarded: 0, deleted: 0 });
  });
});
