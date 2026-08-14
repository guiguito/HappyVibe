/**
 * CONTRACT test (adapter-pin-bump gate).
 * Proves an AuthEntry written by HappyVibe's main-side store is readable by the
 * vendored pi-mcp-adapter via getAuthForUrl(name, url). If a pi-mcp-adapter pin
 * bump changes the on-disk shape or path, this test breaks — that is the gate.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { writeAuthEntry, type AuthEntry } from "../src/main/mcpAuthStore";

/**
 * The adapter reads the OS KEYCHAIN first and treats tokens.json as a legacy
 * entry to import. Two consequences for this test, both learned the hard way:
 * an unforced run resolves whatever the developer really authenticated under
 * this server name (a real "notion" login made this fail on one machine and
 * pass on CI), and the import path WRITES to that developer's keychain. The
 * adapter's own memory store gives an empty secure store, which is the only
 * state in which the legacy path — the on-disk contract this test exists for —
 * is reached at all.
 */
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-authformat-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("mcp adapter auth format contract", () => {
  it("still offers the memory store — without it the test above reads the real keychain", () => {
    const src = readFileSync(
      join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter", "mcp-auth.ts"),
      "utf-8",
    );
    expect(src).toContain("PI_MCP_ADAPTER_TEST_AUTH_STORE");
    expect(src).toMatch(/TEST_AUTH_STORE_ENV\] === 'memory'/);
  });

  it("adapter getAuthForUrl reads back an AuthEntry written by the store", async () => {
    const { getAuthForUrl } = await import(
      "../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts"
    );

    const url = "https://mcp.example.com/mcp";
    const entry: AuthEntry = {
      tokens: { accessToken: "tok-xyz", refreshToken: "ref-1", expiresAt: 9999999999, scope: "read" },
      clientInfo: { clientId: "client-123", redirectUris: ["http://127.0.0.1:5555/callback"] },
      serverUrl: url,
    };
    writeAuthEntry(tmp, "notion", entry);

    const priorPiDir = process.env.PI_CODING_AGENT_DIR;
    const priorMcpDir = process.env.MCP_OAUTH_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = tmp;
      delete process.env.MCP_OAUTH_DIR; // adapter resolves <PI_CODING_AGENT_DIR>/mcp-oauth
      const read = getAuthForUrl("notion", url);
      expect(read).toBeDefined();
      expect(read.tokens?.accessToken).toBe("tok-xyz");
      expect(read.clientInfo?.clientId).toBe("client-123");
      expect(read.serverUrl).toBe(url);

      // getAuthForUrl invalidates on URL mismatch — our serverUrl write is load-bearing
      expect(getAuthForUrl("notion", "https://other.example.com")).toBeUndefined();
    } finally {
      if (priorPiDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorPiDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      if (priorMcpDir !== undefined) process.env.MCP_OAUTH_DIR = priorMcpDir;
      else delete process.env.MCP_OAUTH_DIR;
    }
  });
});
